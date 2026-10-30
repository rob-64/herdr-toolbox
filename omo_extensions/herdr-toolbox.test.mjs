import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardHelp, getModeArgumentCompletions, resolveMode } from "./herdr-toolbox.js";

const PANE = "w1:p1";

describe("resolveMode", () => {
	it("maps short and long names case-insensitively", () => {
		assert.equal(resolveMode("p")?.name, "popup");
		assert.equal(resolveMode("SD")?.name, "split-down");
		assert.equal(resolveMode("split-down")?.name, "split-down");
		assert.equal(resolveMode("t")?.name, "tab");
	});

	it("defaults empty input to split", () => {
		assert.equal(resolveMode("")?.name, "split");
		assert.equal(resolveMode("   ")?.name, "split");
	});

	it("returns herdr args for resolved modes", () => {
		assert.deepEqual(resolveMode("p").args(PANE), ["--entrypoint", "board", "--focus"]);
		assert.deepEqual(resolveMode("SD").args(PANE), [
			"--entrypoint",
			"side",
			"--placement",
			"split",
			"--direction",
			"down",
			"--target-pane",
			PANE,
			"--no-focus",
		]);
		assert.deepEqual(resolveMode("t").args(PANE), ["--entrypoint", "side", "--placement", "tab", "--focus"]);
	});

	it("recognizes help aliases", () => {
		assert.deepEqual(resolveMode("h"), { help: true });
		assert.deepEqual(resolveMode("help"), { help: true });
	});

	it("returns undefined for unknown modes", () => {
		assert.equal(resolveMode("nope"), undefined);
	});
});

describe("getModeArgumentCompletions", () => {
	it("matches name or short prefix and keeps full name as value", () => {
		const items = getModeArgumentCompletions("sp");
		assert.deepEqual(
			items.map((item) => item.value),
			["split", "split-down"],
		);
		assert.ok(items.every((item) => item.label.includes("(")));
	});

	it("offers nothing for an empty argument, so Enter runs the default split", () => {
		assert.equal(getModeArgumentCompletions(""), null);
		assert.equal(getModeArgumentCompletions("  "), null);
		assert.equal(resolveMode("").name, "split");
	});

	it("offers nothing for an exact short or full name, so one Enter runs it", () => {
		for (const arg of ["p", "sd", "s", "popup", "split-down"]) assert.equal(getModeArgumentCompletions(arg), null, arg);
		assert.deepEqual(getModeArgumentCompletions("spl").map((item) => item.value), ["split", "split-down"]);
	});

	it("never offers help as a completion", () => {
		assert.equal(getModeArgumentCompletions("h"), null);
	});
});

describe("boardHelp", () => {
	it("includes short aliases in each mode line", () => {
		const help = boardHelp();
		assert.match(help, /split \(s\)/);
		assert.match(help, /split-down \(sd\)/);
	});
});

async function run(arg, { command = "agents-board", bin = "/usr/bin/true" } = {}) {
	const commands = {};
	const { default: register } = await import("./herdr-toolbox.js");
	register({ registerCommand: (name, def) => { commands[name] = def; } });
	const saved = { pane: process.env.HERDR_PANE_ID, bin: process.env.HERDR_BIN_PATH };
	process.env.HERDR_PANE_ID = PANE;
	process.env.HERDR_BIN_PATH = bin;
	const notes = [];
	try {
		await commands[command].handler(arg, { ui: { notify: (message) => notes.push(message) } });
	} finally {
		if (saved.pane === undefined) delete process.env.HERDR_PANE_ID; else process.env.HERDR_PANE_ID = saved.pane;
		if (saved.bin === undefined) delete process.env.HERDR_BIN_PATH; else process.env.HERDR_BIN_PATH = saved.bin;
	}
	return notes;
}

// A fake herdr that fails and prints its argv, so the handler's error note carries the exact args.
async function herdrArgs(command, arg) {
	const dir = mkdtempSync(join(tmpdir(), "herdr-toolbox-ext-"));
	const bin = join(dir, "herdr");
	writeFileSync(bin, "#!/bin/sh\nprintf '%s\\n' \"$@\" >&2\nexit 1\n");
	chmodSync(bin, 0o755);
	try {
		const [note] = await run(arg, { command, bin });
		return note.slice(`/${command}: `.length).split("\n");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const OPEN = ["plugin", "pane", "open", "--plugin", "herdr-toolbox"];

describe("/agents-board handler", () => {
	it("opens a board (no help) for a bare command and for every mode", async () => {
		for (const arg of ["", " ", "s", "split", "sd", "p", "o", "z", "t"]) {
			assert.deepEqual(await run(arg), [], `arg ${JSON.stringify(arg)}`);
		}
	});

	it("shows help only when asked", async () => {
		const [note] = await run("h");
		assert.match(note, /^\/agents-board \[mode\]/);
	});

	it("opens the agents view in the agents entrypoints", async () => {
		assert.deepEqual(await herdrArgs("agents-board", "p"), [...OPEN, "--env", "OMO_BOARD_VIEW=agents", "--entrypoint", "board", "--focus"]);
		assert.deepEqual((await herdrArgs("agents-board", "")).slice(5, 9), ["--env", "OMO_BOARD_VIEW=agents", "--entrypoint", "side"]);
	});
});

describe("/pr-board handler", () => {
	it("opens the PR board entrypoints for every mode", async () => {
		assert.deepEqual(await herdrArgs("pr-board", "p"), [...OPEN, "--entrypoint", "prs", "--focus"]);
		assert.deepEqual(await herdrArgs("pr-board", ""), [...OPEN, "--entrypoint", "prs-side", "--placement", "split", "--direction", "right", "--target-pane", PANE, "--no-focus"]);
		for (const arg of ["sd", "o", "z", "t"]) assert.deepEqual((await herdrArgs("pr-board", arg)).slice(5, 7), ["--entrypoint", "prs-side"], arg);
	});

	it("shows its own help and rejects unknown modes", async () => {
		const [help] = await run("h", { command: "pr-board" });
		assert.match(help, /^\/pr-board \[mode\]\n {2}split \(s\)/);
		const [unknown] = await run("nope", { command: "pr-board" });
		assert.match(unknown, /^\/pr-board: unknown mode "nope"/);
	});
});

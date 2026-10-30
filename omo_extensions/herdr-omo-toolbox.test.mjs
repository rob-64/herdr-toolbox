import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boardHelp, getModeArgumentCompletions, resolveMode } from "./herdr-omo-toolbox.js";

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

describe("/agents-board handler", () => {
	async function run(arg) {
		const commands = {};
		const { default: register } = await import("./herdr-omo-toolbox.js");
		register({ registerCommand: (name, def) => { commands[name] = def; } });
		const saved = { pane: process.env.HERDR_PANE_ID, bin: process.env.HERDR_BIN_PATH };
		process.env.HERDR_PANE_ID = PANE;
		process.env.HERDR_BIN_PATH = "/usr/bin/true";
		const notes = [];
		try {
			await commands["agents-board"].handler(arg, { ui: { notify: (message) => notes.push(message) } });
		} finally {
			if (saved.pane === undefined) delete process.env.HERDR_PANE_ID; else process.env.HERDR_PANE_ID = saved.pane;
			if (saved.bin === undefined) delete process.env.HERDR_BIN_PATH; else process.env.HERDR_BIN_PATH = saved.bin;
		}
		return notes;
	}

	it("opens a board (no help) for a bare command and for every mode", async () => {
		for (const arg of ["", " ", "s", "split", "sd", "p", "o", "z", "t"]) {
			assert.deepEqual(await run(arg), [], `arg ${JSON.stringify(arg)}`);
		}
	});

	it("shows help only when asked", async () => {
		const [note] = await run("h");
		assert.match(note, /^\/agents-board \[mode\]/);
	});
});

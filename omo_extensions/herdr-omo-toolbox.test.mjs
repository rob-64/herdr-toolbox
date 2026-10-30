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
		const items = getModeArgumentCompletions("s");
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

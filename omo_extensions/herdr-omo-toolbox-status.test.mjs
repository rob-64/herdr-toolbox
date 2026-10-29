import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	cleanText,
	computeState,
	readEnvironment,
	releaseArgs,
	reportAgentArgs,
	reportMetadataArgs,
	taskCounts,
	DeliveryQueue,
} from "./herdr-omo-toolbox-status.js";

describe("readEnvironment", () => {
	const valid = {
		HERDR_ENV: "1",
		HERDR_BIN_PATH: "/usr/local/bin/herdr",
		HERDR_PANE_ID: "w1:p1",
		HERDR_SOCKET_PATH: "/tmp/herdr.sock",
	};

	it("returns bin, pane, and socket when env is valid", () => {
		assert.deepEqual(readEnvironment(valid), {
			bin: "/usr/local/bin/herdr",
			pane: "w1:p1",
			socket: "/tmp/herdr.sock",
		});
	});

	it("rejects a relative bin path", () => {
		assert.equal(readEnvironment({ ...valid, HERDR_BIN_PATH: "herdr" }), undefined);
	});

	it("rejects missing pane id", () => {
		assert.equal(readEnvironment({ ...valid, HERDR_PANE_ID: "" }), undefined);
	});
});

describe("taskCounts", () => {
	const sessionId = "sess-1";
	const payload = {
		parent_session_id: sessionId,
		tasks: [
			{ task_id: "a", status: "running" },
			{ task_id: "b", status: "pending" },
			{ task_id: "c", status: "completed", parent_session_id: "other" },
			{ task_id: "d", status: "error" },
		],
	};

	it("returns undefined for the wrong session", () => {
		assert.equal(taskCounts(payload, "other-session"), undefined);
	});

	it("ignores tasks with a foreign parent_session_id", () => {
		const counts = taskCounts(payload, sessionId);
		assert.deepEqual(counts, { running: 1, pending: 1, other: 1 });
	});
});

describe("computeState", () => {
	it("prefers blocked over working", () => {
		assert.deepEqual(
			computeState({ prompts: [{}], active: true, compacting: false, busyTasks: 3 }),
			{ state: "blocked", message: "Waiting for user input" },
		);
	});

	it("reports working with a label when only background tasks are busy", () => {
		assert.deepEqual(
			computeState({ prompts: [], active: false, compacting: false, busyTasks: 2 }),
			{ state: "working", label: "Waiting on 2 tasks" },
		);
	});

	it("returns idle when nothing is active", () => {
		assert.deepEqual(
			computeState({ prompts: [], active: false, compacting: false, busyTasks: 0 }),
			{ state: "idle" },
		);
	});

	it("returns working without a label when the agent is active", () => {
		assert.deepEqual(
			computeState({ prompts: [], active: true, compacting: false, busyTasks: 0 }),
			{ state: "working" },
		);
	});
});

describe("argv helpers", () => {
	it("builds report-agent argv", () => {
		assert.deepEqual(
			reportAgentArgs({
				pane: "w1:p1",
				seq: 42,
				state: "blocked",
				message: "Waiting for user input",
				sessionId: "sess-9",
			}),
			[
				"pane",
				"report-agent",
				"w1:p1",
				"--source",
				"custom:omo",
				"--agent",
				"omo",
				"--seq",
				"42",
				"--state",
				"blocked",
				"--message",
				"Waiting for user input",
				"--agent-session-id",
				"sess-9",
			],
		);
	});

	it("uses --clear-title when session name is empty", () => {
		const args = reportMetadataArgs({ pane: "w1:p1", seq: 7, sessionName: "" });
		assert.ok(args.includes("--clear-title"));
		assert.ok(args.includes("--clear-state-labels"));
	});

	it("adds a state label when only tasks keep the agent working", () => {
		const args = reportMetadataArgs({
			pane: "w1:p1",
			seq: 8,
			sessionName: "Plan refactor",
			busyTasks: 1,
			tasksOnlyWorking: true,
		});
		assert.ok(args.includes("--title"));
		assert.ok(args.includes("Plan refactor"));
		assert.ok(args.includes("--state-label"));
		assert.ok(args.some((part) => part.includes("Waiting on 1 task")));
	});

	it("builds release argv", () => {
		assert.deepEqual(releaseArgs({ pane: "w1:p1", seq: 99 }), [
			"pane",
			"release-agent",
			"w1:p1",
			"--source",
			"custom:omo",
			"--agent",
			"omo",
			"--seq",
			"99",
		]);
	});
});

describe("cleanText", () => {
	it("strips control characters, collapses whitespace, and caps length", () => {
		const input = "  hello\u0007\nworld  " + "x".repeat(100);
		const out = cleanText(input);
		assert.equal(out.length, 80);
		assert.match(out, /^hello world x+$/);
	});
});

describe("DeliveryQueue", () => {
	it("keeps a newer pending snapshot when delivery fails", () => {
		const globalState = { seq: 0 };
		let calls = 0;
		const queue = new DeliveryQueue({
			bin: "/bin/herdr",
			socket: "/tmp/herdr.sock",
			globalState,
			exec: (_bin, _args, _opts, cb) => {
				calls++;
				if (calls === 1) {
					queue.enqueue({
						pane: "w1:p1",
						agent: { state: "working", sessionId: "new" },
						metadata: { sessionName: "new", busyTasks: 0, tasksOnlyWorking: false },
					});
					cb(new Error("fail"));
					return;
				}
				cb(new Error("fail"));
			},
		});
		queue.claimed = true;
		queue.enqueue({
			pane: "w1:p1",
			agent: { state: "idle", sessionId: "old" },
			metadata: { sessionName: "old", busyTasks: 0, tasksOnlyWorking: false },
		});
		assert.equal(queue.pending?.agent?.sessionId, "new");
	});
});

describe("session lifecycle", () => {
	const ENV = {
		HERDR_ENV: "1",
		HERDR_BIN_PATH: "/usr/local/bin/herdr",
		HERDR_PANE_ID: "w1:p1",
		HERDR_SOCKET_PATH: "/tmp/herdr.sock",
	};

	// Records every herdr call; `hold` keeps release-agent calls pending until released by the test.
	function fakeExec({ hold = false } = {}) {
		const calls = [];
		const held = [];
		const exec = (_bin, args, _opts, cb) => {
			calls.push(args[1]);
			if (hold && args[1] === "release-agent") held.push(() => cb(null));
			else queueMicrotask(() => cb(null));
		};
		return { calls, exec, releaseHeld: () => held.splice(0).forEach((done) => done()) };
	}

	function fakePi() {
		const handlers = {};
		return { handlers, on: (name, fn) => { handlers[name] = fn; }, events: { on: () => () => {} } };
	}

	function fakeCtx(id) {
		return {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			hasPendingMessages: () => false,
			sessionManager: { getSessionId: () => id, getSessionName: () => `Session ${id}` },
		};
	}

	const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

	async function withEnv(fn) {
		const saved = { ...process.env };
		Object.assign(process.env, ENV);
		delete process.env.HERDR_OMO_TOOLBOX_STATUS_OWNER;
		delete globalThis[Symbol.for("herdr-omo-toolbox.status.v1")];
		try { await fn(); } finally {
			process.env = saved;
			delete globalThis[Symbol.for("herdr-omo-toolbox.status.v1")];
		}
	}

	it("keeps the pane across /new and reports the new session", () => withEnv(async () => {
		const { install } = await import("./herdr-omo-toolbox-status.js");
		const { calls, exec } = fakeExec();
		const pi = fakePi();
		install(pi, { exec });
		pi.handlers.session_start({}, fakeCtx("a"));
		await tick();
		pi.handlers.session_shutdown({ reason: "new" });
		pi.handlers.session_start({}, fakeCtx("b"));
		await tick();
		assert.ok(!calls.includes("release-agent"), calls.join(","));
		assert.equal(calls.filter((c) => c === "report-agent").length, 2, calls.join(","));
	}));

	it("delays a reloaded instance's first report until the old release lands", () => withEnv(async () => {
		const { install } = await import("./herdr-omo-toolbox-status.js");
		const { calls, exec, releaseHeld } = fakeExec({ hold: true });
		const oldPi = fakePi();
		install(oldPi, { exec });
		oldPi.handlers.session_start({}, fakeCtx("a"));
		await tick();
		oldPi.handlers.session_shutdown({ reason: "reload" });
		const newPi = fakePi();
		install(newPi, { exec });
		newPi.handlers.session_start({}, fakeCtx("a"));
		await tick();
		const releaseAt = calls.lastIndexOf("release-agent");
		assert.ok(releaseAt >= 0, calls.join(","));
		assert.equal(calls.slice(releaseAt + 1).length, 0, "new instance reported before the release finished");
		releaseHeld();
		await tick();
		assert.equal(calls.slice(releaseAt + 1)[0], "report-agent", calls.join(","));
	}));
});

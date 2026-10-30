import { execFile } from "node:child_process";
import path from "node:path";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";

// Debug log: on while ~/.local/state/herdr-toolbox/status-debug exists.
const DEBUG_DIR = path.join(homedir(), ".local", "state", "herdr-toolbox");
function debug(...parts) {
	try {
		if (!existsSync(path.join(DEBUG_DIR, "status-debug"))) return;
		appendFileSync(path.join(DEBUG_DIR, "status.log"), `${new Date().toISOString()} pid=${process.pid} pane=${process.env.HERDR_PANE_ID} ${parts.join(" ")}\n`);
	} catch {}
}

// Guard keys keep the pre-rename herdr-omo-toolbox names: if an old copy of this extension is still
// installed beside the new one, they share the guard and only one status reporter runs.
const GLOBAL_KEY = Symbol.for("herdr-omo-toolbox.status.v1");
const OWNER_ENV = "HERDR_OMO_TOOLBOX_STATUS_OWNER";

export function readEnvironment(env) {
	if (env.HERDR_ENV !== "1") return undefined;
	const bin = env.HERDR_BIN_PATH;
	if (!bin || !path.isAbsolute(bin)) return undefined;
	const pane = env.HERDR_PANE_ID;
	const socket = env.HERDR_SOCKET_PATH;
	if (!pane || !socket) return undefined;
	return { bin, pane, socket };
}

export function taskCounts(data, sessionId) {
	if (!data || data.parent_session_id !== sessionId) return undefined;
	let running = 0, pending = 0, other = 0;
	for (const task of data.tasks ?? []) {
		const parent = task.parent_session_id ?? data.parent_session_id;
		if (parent !== data.parent_session_id) continue;
		if (task.status === "running") running++;
		else if (task.status === "pending") pending++;
		else other++;
	}
	return { running, pending, other };
}

const AGENT_DIR = process.env.OMO_AGENTS_DIR || path.join(homedir(), ".omo", "agent");
const SCAN_WINDOW_MS = 24 * 60 * 60 * 1000;

function pidAlive(pid) {
	try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

function listDir(dir) {
	try { return readdirSync(dir); } catch { return []; }
}

/** OmO task stores: the registry plus every project's senpi-task dir. */
export function taskStores(agentDir = AGENT_DIR) {
	const stores = new Set();
	try {
		const registry = JSON.parse(readFileSync(path.join(agentDir, "rpc", "task-stores.json"), "utf8"));
		for (const store of Object.keys(registry?.stores ?? {})) stores.add(store);
	} catch {}
	for (const project of listDir(path.join(agentDir, "projects"))) stores.add(path.join(agentDir, "projects", project, "senpi-task"));
	return [...stores];
}

/**
 * Running/pending tasks of a session read from OmO's task files, for when no
 * omo.task.updated event has arrived yet (e.g. after a reload mid-task).
 * Tasks whose host process is gone don't count; files older than a day are skipped.
 */
export function scanBusyTasks(sessionId, { agentDir = AGENT_DIR, now = Date.now(), alive = pidAlive } = {}) {
	if (!sessionId) return 0;
	let busy = 0;
	for (const store of taskStores(agentDir)) {
		const dir = path.join(store, "tasks");
		for (const file of listDir(dir)) {
			if (!file.endsWith(".json")) continue;
			const full = path.join(dir, file);
			try {
				if (now - statSync(full).mtimeMs > SCAN_WINDOW_MS) continue;
				const task = JSON.parse(readFileSync(full, "utf8"));
				if (task?.parent_session_id !== sessionId) continue;
				if (task.status !== "running" && task.status !== "pending") continue;
				if (Number.isSafeInteger(task.host_pid) && task.host_pid > 0 && !alive(task.host_pid)) continue;
				busy++;
			} catch {}
		}
	}
	return busy;
}

export function computeState({ prompts, active, compacting, busyTasks }) {
	if (prompts.length > 0) return { state: "blocked", message: "Waiting for user input" };
	if (active || compacting || busyTasks > 0) {
		if (busyTasks > 0 && !active && !compacting) {
			const label = busyTasks === 1 ? "Waiting on 1 task" : `Waiting on ${busyTasks} tasks`;
			return { state: "working", label };
		}
		return { state: "working" };
	}
	return { state: "idle" };
}

export function cleanText(value) {
	return String(value ?? "")
		.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
}

export function reportAgentArgs({ pane, seq, state, message, sessionId }) {
	const args = ["pane", "report-agent", pane, "--source", "custom:omo", "--agent", "omo", "--seq", String(seq), "--state", state];
	if (message) args.push("--message", message);
	if (sessionId) args.push("--agent-session-id", sessionId);
	return args;
}

export function reportMetadataArgs({ pane, seq, sessionName, busyTasks, tasksOnlyWorking, clearing }) {
	const args = [
		"pane", "report-metadata", pane, "--source", "custom:omo:metadata", "--agent", "omo",
		"--applies-to-source", "custom:omo", "--seq", String(seq), "--ttl-ms", "45000",
	];
	if (clearing) return [...args, "--clear-title", "--clear-state-labels"];
	const title = cleanText(sessionName);
	if (title) args.push("--title", title);
	else args.push("--clear-title");
	if (tasksOnlyWorking && busyTasks > 0) {
		const suffix = busyTasks === 1 ? "task" : "tasks";
		args.push("--state-label", `working=Waiting on ${busyTasks} ${suffix}`);
	} else args.push("--clear-state-labels");
	return args;
}

export function releaseArgs({ pane, seq }) {
	return ["pane", "release-agent", pane, "--source", "custom:omo", "--agent", "omo", "--seq", String(seq)];
}

function nextSeq(globalState) {
	const seq = Math.max(globalState.seq + 1, Date.now() * 1000);
	globalState.seq = seq;
	return seq;
}

function defaultExec(bin, args, opts, cb) {
	execFile(bin, args, opts, cb);
}

export class DeliveryQueue {
	constructor({ bin, socket, globalState, exec = defaultExec }) {
		this.bin = bin;
		this.execFn = exec;
		this.execEnv = { ...process.env, HERDR_SOCKET_PATH: socket };
		this.globalState = globalState;
		this.closed = false;
		this.busy = false;
		this.pending = null;
		this.lastAgent = null;
		this.lastMeta = null;
		this.lastMetaAt = 0;
		this.claimed = false;
		this.retry = null;
	}

	close() {
		this.closed = true;
		if (this.retry) clearTimeout(this.retry);
	}

	enqueue(snapshot) {
		if (this.closed) return;
		if (this.pending?.shutdown && !snapshot.shutdown) return;
		this.pending = snapshot;
		this.#drain();
	}

	#keyAgent(agent) {
		return agent ? `${agent.state}\0${agent.message ?? ""}\0${agent.sessionId ?? ""}` : null;
	}

	#keyMeta(meta) {
		return meta?.clearing ? "clear" : `${meta?.sessionName ?? ""}\0${meta?.tasksOnlyWorking ? meta.busyTasks : ""}`;
	}

	#drain() {
		if (this.busy || this.closed || !this.pending) return;
		const snap = this.pending;
		const releasing = this.globalState.releasing;
		if (releasing && !snap.shutdown) {
			if (!this.waitingRelease) {
				this.waitingRelease = true;
				releasing.then(() => {
					this.waitingRelease = false;
					this.#drain();
				});
			}
			return;
		}
		this.pending = null;
		if (snap.shutdown) return this.#shutdown(snap, 0);
		const steps = [];
		if (snap.agent) {
			const key = this.#keyAgent(snap.agent);
			if (key !== this.lastAgent) {
				steps.push({ kind: "agent", key, args: reportAgentArgs({ pane: snap.pane, seq: nextSeq(this.globalState), ...snap.agent }) });
			}
		}
		if (snap.metadata && this.claimed) {
			const key = this.#keyMeta(snap.metadata);
			if (key !== this.lastMeta || Date.now() - this.lastMetaAt >= 15000) {
				steps.push({
					kind: "meta",
					key,
					args: reportMetadataArgs({ pane: snap.pane, seq: nextSeq(this.globalState), ...snap.metadata }),
				});
			}
		}
		if (!steps.length) return this.pending && this.#drain();
		this.#runSteps(snap, steps, 0);
	}

	#runSteps(snap, steps, i) {
		if (this.closed || i >= steps.length) return this.pending && this.#drain();
		const step = steps[i];
		this.busy = true;
		this.#exec(step.args, (ok) => {
			this.busy = false;
			if (this.closed) return;
			if (!ok) {
				this.pending ??= snap;
				if (!this.retry) {
					this.retry = setTimeout(() => {
						this.retry = null;
						this.#drain();
					}, 2000);
					this.retry.unref();
				}
				return;
			}
			if (step.kind === "agent") this.lastAgent = step.key;
			if (step.kind === "meta") {
				this.lastMeta = step.key;
				this.lastMetaAt = Date.now();
			}
			this.#runSteps(snap, steps, i + 1);
		});
	}

	#shutdown(snap, attempt) {
		this.busy = true;
		this.#exec(reportMetadataArgs({ pane: snap.pane, seq: nextSeq(this.globalState), clearing: true }), (metaOk) => {
			if (!metaOk && attempt === 0) {
				this.busy = false;
				return this.#shutdown(snap, 1);
			}
			this.#exec(releaseArgs({ pane: snap.pane, seq: nextSeq(this.globalState) }), (relOk) => {
				this.busy = false;
				if (!relOk && attempt === 0) return this.#shutdown(snap, 1);
				this.close();
				snap.onReleased?.();
			});
		});
	}

	#exec(args, done) {
		this.execFn(this.bin, args, { env: this.execEnv, timeout: 750, killSignal: "SIGKILL", maxBuffer: 65536, shell: false }, (err, _out, stderr) => {
			debug("exec", args[1], args.includes("--state") ? args[args.indexOf("--state") + 1] : "", err ? `FAIL ${String(stderr || err.message).trim().slice(0, 200)}` : "ok");
			done(!err);
		});
	}
}

function createReporter(pi, config, globalState, token, exec) {
	let queue = new DeliveryQueue({ ...config, globalState, exec });
	let sessionId = "", sessionName = "", active = false, compacting = false, claimed = false, closing = false;
	let refreshMeta = null;
	const prompts = [], tools = new Set(), taskSnapshots = new Map();

	const owns = () => globalState.owner === token;

	const clearRefreshMeta = () => {
		if (refreshMeta) {
			clearInterval(refreshMeta);
			refreshMeta = null;
		}
	};

	const readSession = (ctx) => {
		sessionId = ctx.sessionManager.getSessionId() ?? "";
		sessionName = ctx.sessionManager.getSessionName() ?? "";
	};

	// Live events win; until one arrives, use the last task-file scan.
	let scannedBusy = 0;
	const rescan = () => { scannedBusy = scanBusyTasks(sessionId); };
	const busyTasks = () => {
		const counts = taskSnapshots.has(sessionId) ? taskCounts(taskSnapshots.get(sessionId), sessionId) : undefined;
		return counts ? counts.running + counts.pending : scannedBusy;
	};

	const publish = () => {
		if (!claimed || closing || !owns()) return debug("publish skipped", `claimed=${claimed}`, `closing=${closing}`, `owns=${owns()}`);
		const bt = busyTasks();
		const isActive = active || tools.size > 0;
		const { state, message } = computeState({ prompts, active: isActive, compacting, busyTasks: bt });
		const tasksOnly = state === "working" && bt > 0 && !isActive && !compacting && !prompts.length;
		queue.enqueue({
			pane: config.pane,
			agent: { state, message, sessionId },
			metadata: { sessionName, busyTasks: bt, tasksOnlyWorking: tasksOnly },
		});
	};

	pi.events.on("senpi:extension-rpc-event", (envelope) => {
		if (envelope?.name !== "omo.task.updated") return;
		const data = envelope.data;
		if (!data?.parent_session_id) return;
		taskSnapshots.set(data.parent_session_id, data);
		while (taskSnapshots.size > 4) taskSnapshots.delete(taskSnapshots.keys().next().value);
		if (data.parent_session_id === sessionId) publish();
	});

	const handlers = {
		session_start: (_e, ctx) => {
			debug("session_start", `mode=${ctx.mode}`, `hasUI=${ctx.hasUI}`, `session=${ctx.sessionManager.getSessionId()}`);
			readSession(ctx);
			if (ctx.mode === "tui" && ctx.hasUI) {
				globalState.owner = token;
				claimed = true;
				closing = false;
				// A quit/reload shutdown closes the queue; the first report of a new session is never deduped.
				if (queue.closed) queue = new DeliveryQueue({ ...config, globalState, exec });
				else queue.lastAgent = queue.lastMeta = null;
				queue.claimed = true;
				active = !ctx.isIdle?.() || !!ctx.hasPendingMessages?.();
				compacting = !!ctx.isCompacting?.();
				tools.clear();
				prompts.length = 0;
				rescan();
				clearRefreshMeta();
				refreshMeta = setInterval(() => {
					if (!owns()) {
						clearRefreshMeta();
						return;
					}
					// Resend state too, so a release from another reporter (e.g. old omo-herdr) heals.
					queue.lastAgent = null;
					rescan();
					publish();
				}, 15000);
				refreshMeta.unref();
				publish();
			}
		},
		agent_start: () => { active = true; publish(); },
		agent_settled: () => { active = false; tools.clear(); publish(); },
		session_abort: () => { active = false; compacting = false; tools.clear(); publish(); },
		ui_prompt_start: (e) => { prompts.push({ kind: e.kind, title: e.title }); publish(); },
		ui_prompt_end: (e) => {
			for (let i = prompts.length - 1; i >= 0; i--) {
				if (prompts[i].kind === e.kind && prompts[i].title === e.title) { prompts.splice(i, 1); break; }
			}
			publish();
		},
		tool_execution_start: (e) => { active = true; if (e.toolCallId) tools.add(e.toolCallId); publish(); },
		tool_execution_end: (e) => { if (e.toolCallId) tools.delete(e.toolCallId); publish(); },
		session_before_compact: () => { compacting = true; publish(); },
		session_compact: (e) => { compacting = false; if (e.willRetry) active = true; publish(); },
		session_compact_failed: (e) => { compacting = false; if (e.aborted) active = false; publish(); },
		session_info_changed: (_e, ctx) => { readSession(ctx); publish(); },
		message_end: (_e, ctx) => { readSession(ctx); publish(); },
		session_shutdown: (e) => {
			debug("session_shutdown", `reason=${e?.reason}`, `claimed=${claimed}`, `owns=${owns()}`);
			if (!claimed || !owns()) return;
			// /new, resume and fork reuse this instance: keep the pane, session_start republishes.
			if (["new", "resume", "fork"].includes(e?.reason)) {
				active = compacting = false;
				tools.clear();
				prompts.length = 0;
				return;
			}
			globalState.owner = undefined;
			closing = true;
			clearRefreshMeta();
			// Later reports (a reloaded instance, a new session) wait until this release lands.
			let released;
			const releasing = new Promise((resolve) => { released = resolve; });
			globalState.releasing = releasing;
			const closingQueue = queue;
			closingQueue.enqueue({
				pane: config.pane,
				shutdown: true,
				onReleased: () => {
					claimed = false;
					closingQueue.claimed = false;
					if (globalState.releasing === releasing) delete globalState.releasing;
					released();
				},
			});
		},
	};

	for (const [name, handler] of Object.entries(handlers)) pi.on(name, handler);
}

export default function (pi) {
	install(pi);
}

/** The extension body; tests pass a fake `exec(bin, args, opts, cb)`. */
export function install(pi, { exec } = {}) {
	const config = readEnvironment(process.env);
	if (!config) return debug("skip: not in herdr", `HERDR_ENV=${process.env.HERDR_ENV}`, `bin=${process.env.HERDR_BIN_PATH}`);
	const owner = process.env[OWNER_ENV];
	if (owner && owner !== String(process.pid)) return debug("skip: owned by", owner);
	const globalState = globalThis[GLOBAL_KEY] ?? { seq: 0 };
	if (!owner) process.env[OWNER_ENV] = String(process.pid);
	globalThis[GLOBAL_KEY] = globalState;
	const token = {};
	debug("loaded");
	createReporter(pi, config, globalState, token, exec);
}

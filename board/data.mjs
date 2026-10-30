import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const TERMINAL = new Set(['completed', 'error', 'failed', 'cancelled', 'interrupted', 'lost', 'skipped']);
export const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'abandoned'];

const SESSION_FILE = /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

export function defaultAgentDir(env = process.env) {
  return env.OMO_AGENTS_DIR || env.OMO_CODING_AGENT_DIR || join(homedir(), '.omo', 'agent');
}

const clean = value => String(value ?? '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim();
const text = value => (typeof value === 'string' && value.trim() ? clean(value) : undefined);
const time = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
};
const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : undefined);

export function projectName(store) {
  return basename(dirname(store)).replace(/-[0-9a-f]{12}$/, '');
}

export function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export function normalizeTask(raw, store, alive = pidAlive) {
  if (!raw || typeof raw.task_id !== 'string') return null;
  const live = raw.live_progress ?? {};
  const stats = raw.run_stats ?? {};
  const status = text(raw.status) ?? 'unknown';
  const terminal = TERMINAL.has(status);
  const sessionId = text(raw.parent_session_id);
  const stale = !terminal && Number.isSafeInteger(raw.host_pid) && !alive(raw.host_pid);
  return {
    id: raw.task_id,
    status: stale ? 'stale' : status,
    rawStatus: status,
    terminal: terminal || stale,
    sessionId,
    rootSessionId: text(raw.root_session_id) ?? sessionId,
    childSessionId: text(raw.child_session_id),
    depth: count(raw.depth) ?? 1,
    name: text(raw.name),
    summary: text(raw.task_summary) ?? text(raw.description) ?? text(raw.name) ?? raw.task_id,
    agent: (text(raw.agent_type) ?? text(raw.subagent_type) ?? text(raw.category) ?? 'task').replace(/^omo-native-/, ''),
    model: text(raw.resolved_model?.display) ?? text(raw.effective_model?.display) ?? text(raw.model),
    startedAt: time(live.started_at) ?? time(raw.started_at) ?? time(raw.created_at),
    endedAt: time(raw.terminal_at) ?? (terminal ? time(raw.updated_at) : undefined),
    updatedAt: time(raw.updated_at) ?? time(raw.created_at) ?? 0,
    turns: count(live.turns) ?? count(stats.turns),
    toolCalls: count(live.tool_calls) ?? count(stats.tool_calls),
    costUsd: typeof stats.cost_usd === 'number' ? stats.cost_usd : undefined,
    tool: text(live.current_tool),
    line: text(live.last_assistant_line) ?? text(live.activity),
    error: text(raw.error_message) ?? text(raw.error?.message) ?? text(raw.error),
    cwd: text(raw.spawn_spec?.cwd),
    project: projectName(store),
    transcript: text(raw.host_session?.session_path) ?? join(store, 'children', raw.task_id, 'sessions', raw.task_id),
  };
}

export function normalizeRun(raw, store) {
  if (!raw || !Array.isArray(raw.nodes)) return null;
  const id = text(raw.runId) ?? text(raw.run_id);
  if (!id) return null;
  const definitions = new Map((raw.definition?.nodes ?? []).map(node => [node.id, node]));
  const nodes = raw.nodes.filter(node => node && typeof node.id === 'string').map(node => {
    const definition = definitions.get(node.id) ?? {};
    const deps = node.dependsOn ?? definition.dependsOn ?? [];
    return {
      id: node.id,
      state: text(node.state) ?? 'pending',
      attempt: count(node.attempt) ?? 0,
      taskId: text(node.taskId) ?? text(node.task_id),
      deps: Array.isArray(deps) ? deps.filter(dep => typeof dep === 'string') : [],
      summary: text(definition.task_summary) ?? text(node.task_summary) ?? node.id,
      route: text(node.route?.category) ?? text(node.route?.agent) ?? text(node.route?.subagent_type) ?? text(definition.category) ?? text(definition.subagent_type),
      startedAt: time(node.startedAt),
      endedAt: time(node.completedAt) ?? time(node.failedAt),
      error: text(node.lastError?.message) ?? text(node.last_error?.message) ?? text(node.error?.message) ?? text(node.error),
    };
  });
  const ids = new Set(nodes.map(node => node.id));
  for (const edge of raw.edges ?? []) {
    const target = nodes.find(node => node.id === edge?.to);
    if (target && ids.has(edge.from) && !target.deps.includes(edge.from)) target.deps.push(edge.from);
  }
  const sessionId = text(raw.parentSessionId) ?? text(raw.parent_session_id);
  return {
    id,
    key: text(raw.runKey) ?? text(raw.run_key),
    name: text(raw.name) ?? text(raw.runKey) ?? id,
    status: text(raw.status) ?? 'pending',
    sessionId,
    rootSessionId: text(raw.rootSessionId) ?? text(raw.root_session_id) ?? sessionId,
    createdAt: time(raw.createdAt) ?? 0,
    updatedAt: time(raw.updatedAt) ?? time(raw.createdAt) ?? 0,
    nodes,
    project: projectName(store),
  };
}

export function normalizeTodos(details) {
  if (!details?.phases || !Array.isArray(details.phases)) return null;
  return details.phases.map(phase => ({
    name: text(phase.name) ?? '',
    tasks: (Array.isArray(phase.tasks) ? phase.tasks : []).map(task => {
      const content = text(task?.content);
      if (!content) return null;
      const status = TODO_STATUSES.includes(task.status) ? task.status : 'pending';
      return { content, status };
    }).filter(Boolean),
  }));
}

export function stages(run) {
  const byId = new Map(run.nodes.map(node => [node.id, node]));
  const placed = new Set();
  const rows = [];
  let remaining = run.nodes.slice();
  while (remaining.length) {
    const row = remaining.filter(node => node.deps.every(dep => placed.has(dep) || !byId.has(dep)));
    if (!row.length) { rows.push(remaining); break; }
    rows.push(row);
    for (const node of row) placed.add(node.id);
    remaining = remaining.filter(node => !placed.has(node.id));
  }
  return rows;
}

export class Store {
  constructor(agentDir = defaultAgentDir()) {
    this.agentDir = agentDir;
    this.cache = new Map();
    this.todoCache = new Map();
  }

  readJson(path) {
    let info;
    try { info = statSync(path); }
    catch { this.cache.delete(path); return null; }
    const cached = this.cache.get(path);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.value;
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      this.cache.set(path, { mtimeMs: info.mtimeMs, size: info.size, value });
      return value;
    } catch {
      return cached?.value ?? null;
    }
  }

  stores() {
    const found = new Set();
    const registry = this.readJson(join(this.agentDir, 'rpc', 'task-stores.json'));
    for (const store of Object.keys(registry?.stores ?? {})) found.add(store);
    for (const project of list(join(this.agentDir, 'projects'))) found.add(join(this.agentDir, 'projects', project, 'senpi-task'));
    return [...found];
  }

  load(alive = pidAlive) {
    const tasks = [];
    const runs = [];
    for (const store of this.stores()) {
      const taskDir = join(store, 'tasks');
      for (const file of list(taskDir)) {
        if (!file.endsWith('.json')) continue;
        const task = normalizeTask(this.readJson(join(taskDir, file)), store, alive);
        if (task && !task.terminal && !task.tool && !task.line) Object.assign(task, this.activity(task.transcript));
        if (task) tasks.push(task);
      }
      const runDir = join(store, 'dag', 'runs');
      for (const file of list(runDir)) {
        if (!file.endsWith('.json')) continue;
        const run = normalizeRun(this.readJson(join(runDir, file)), store);
        if (run) runs.push(run);
      }
    }
    return { tasks: dedupe(tasks), runs: dedupe(runs) };
  }

  activity(path) {
    let file = path;
    if (!file.endsWith('.jsonl')) {
      const newest = list(path).filter(name => name.endsWith('.jsonl')).sort().pop();
      if (!newest) return {};
      file = join(path, newest);
    }
    let info;
    try { info = statSync(file); }
    catch { return {}; }
    const cached = this.cache.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.value;
    const value = lastActivity(tail(file, info.size, 256 * 1024));
    this.cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, value });
    return value;
  }

  loadTodos({ since = 0, include = new Set() } = {}) {
    const states = [];
    const sessionsDir = join(this.agentDir, 'sessions');
    for (const dir of list(sessionsDir)) {
      if (dir.endsWith('-artifacts')) continue;
      const sub = join(sessionsDir, dir);
      for (const file of list(sub)) {
        const match = file.match(SESSION_FILE);
        if (!match) continue;
        const path = join(sub, file);
        let info;
        try { info = statSync(path); }
        catch { this.todoCache.delete(path); continue; }
        const sessionId = match[1];
        if (info.mtimeMs < since && !include.has(sessionId)) continue;
        const state = this.todosAt(path, sessionId);
        if (state?.phases) states.push(state);
      }
    }
    const byId = new Map();
    for (const state of states) {
      const tasks = state.phases.reduce((n, phase) => n + phase.tasks.length, 0);
      if (tasks < 1) continue;
      const previous = byId.get(state.id);
      if (!previous || previous.updatedAt < state.updatedAt) byId.set(state.id, state);
    }
    return [...byId.values()];
  }

  todosAt(path, fileSessionId) {
    let info;
    try { info = statSync(path); }
    catch { this.todoCache.delete(path); return null; }
    if (!path.endsWith('.jsonl')) {
      const newest = list(path).filter(name => name.endsWith('.jsonl')).sort().pop();
      if (!newest) return null;
      path = join(path, newest);
      try { info = statSync(path); }
      catch { return null; }
    }
    const size = info.size;
    let cached = this.todoCache.get(path);
    if (!cached || size < cached.offset) {
      cached = { offset: 0, state: { id: fileSessionId, cwd: undefined, project: undefined, name: undefined, phases: null, updatedAt: 0 } };
    }
    const chunk = readBytes(path, cached.offset, size);
    if (!chunk.buffer.length) {
      this.todoCache.set(path, cached);
      return cached.state.phases ? { ...cached.state } : null;
    }
    const lastNewline = chunk.buffer.lastIndexOf(10);
    if (lastNewline < 0) {
      this.todoCache.set(path, cached);
      return cached.state.phases ? { ...cached.state } : null;
    }
    const complete = chunk.buffer.subarray(0, lastNewline + 1).toString('utf8');
    const lines = complete.split('\n').filter(Boolean);
    for (const line of lines) {
      if (!line.includes('"type":"session"') && !line.includes('"type":"session_info"') && !line.includes('"toolName":"todo"')) continue;
      let entry;
      try { entry = JSON.parse(line); }
      catch { continue; }
      if (entry.type === 'session') {
        if (text(entry.id)) cached.state.id = text(entry.id);
        const cwd = text(entry.cwd);
        if (cwd) {
          cached.state.cwd = cwd;
          cached.state.project = basename(cwd);
        }
      } else if (entry.type === 'session_info') {
        const name = text(entry.name);
        if (name) cached.state.name = name;
      } else if (entry.type === 'message' && entry.message?.role === 'toolResult' && entry.message?.toolName === 'todo') {
        const phases = normalizeTodos(entry.message.details);
        if (phases) {
          cached.state.phases = phases;
          cached.state.updatedAt = time(entry.timestamp) ?? cached.state.updatedAt;
        }
      }
    }
    cached.offset += lastNewline + 1;
    this.todoCache.set(path, cached);
    return cached.state.phases ? { ...cached.state } : null;
  }

  shardOwners() {
    const owners = new Map();
    const dir = join(this.agentDir, 'rpc', 'shards');
    for (const file of list(dir)) {
      if (!file.endsWith('.meta.json')) continue;
      const meta = this.readJson(join(dir, file));
      if (!meta?.owner_session_id || !Number.isSafeInteger(meta.created_by_pid)) continue;
      const at = time(meta.created_at) ?? 0;
      const previous = owners.get(meta.created_by_pid);
      if (!previous || previous.at < at) owners.set(meta.created_by_pid, { sessionId: meta.owner_session_id, at });
    }
    return owners;
  }
}

function list(dir) {
  try { return readdirSync(dir); }
  catch { return []; }
}

function readBytes(file, offset, size) {
  const length = Math.max(0, size - offset);
  if (!length) return { buffer: Buffer.alloc(0) };
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try { readSync(fd, buffer, 0, length, offset); }
  finally { closeSync(fd); }
  return { buffer };
}

function tail(file, size, bytes) {
  const start = Math.max(0, size - bytes);
  const buffer = Buffer.alloc(size - start);
  const fd = openSync(file, 'r');
  try { readSync(fd, buffer, 0, buffer.length, start); }
  finally { closeSync(fd); }
  const lines = buffer.toString('utf8').split('\n');
  return start > 0 ? lines.slice(1) : lines;
}

function toolArgument(args) {
  if (!args || typeof args !== 'object') return '';
  const value = args.command ?? args.path ?? args.pattern ?? args.url ?? args.query ?? args.summary ?? args.description ?? args.prompt;
  if (typeof value !== 'string') return '';
  const short = clean(value).replaceAll(homedir(), '~').replace(/(?:~|\/)?(?:[^\s/]+\/){2,}([^\s/]+\/[^\s/]+)/g, '…/$1');
  return short.slice(0, 60);
}

export function lastActivity(lines) {
  let lastAt;
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); }
    catch { continue; }
    lastAt ??= time(entry.timestamp);
    const message = entry.message;
    if (entry.type !== 'message' || message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const call = message.content.findLast(part => part?.type === 'toolCall');
    const said = message.content.findLast(part => part?.type === 'text' && text(part.text))?.text
      ?? message.content.findLast(part => part?.type === 'thinking' && text(part.thinking))?.thinking;
    const line = said ? clean(said.split(/\n+/).find(piece => piece.trim()) ?? '').slice(0, 300) : undefined;
    const tool = call?.name ? [call.name, toolArgument(call.arguments)].filter(Boolean).join(' ') : undefined;
    return { tool, line, lastAt };
  }
  return lastAt ? { lastAt } : {};
}

function dedupe(items) {
  const byId = new Map();
  for (const item of items) {
    const previous = byId.get(item.id);
    if (!previous || previous.updatedAt < item.updatedAt) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function run(command, args, options = {}) {
  return new Promise(resolve => {
    execFile(command, args, { timeout: 5000, maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout) => resolve(error ? null : stdout));
  });
}

async function paneProcesses() {
  const panes = [];
  if (process.platform === 'linux') {
    for (const pid of list('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const environ = readFileSync(`/proc/${pid}/environ`, 'utf8');
        const pane = environ.split('\0').find(entry => entry.startsWith('HERDR_PANE_ID='));
        if (!pane) continue;
        const ppid = Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ')[1]);
        panes.push({ pid: Number(pid), ppid, pane: pane.slice('HERDR_PANE_ID='.length) });
      } catch { /* processes exit between readdir and read */ }
    }
  } else {
    const stdout = await run('ps', ['-Ewwo', 'pid=,ppid=,command=']);
    for (const line of (stdout ?? '').split('\n')) {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      const pane = match?.[3].match(/(?:^|\s)HERDR_PANE_ID=(\S+)/);
      if (pane) panes.push({ pid: Number(match[1]), ppid: Number(match[2]), pane: pane[1] });
    }
  }
  return panes;
}

export async function herdrPanes(env = process.env) {
  const stdout = await run(env.HERDR_BIN_PATH || 'herdr', ['pane', 'list'], { env });
  try { return JSON.parse(stdout ?? '').result?.panes ?? []; }
  catch { return []; }
}

export async function paneSessions(store, env = process.env) {
  const [processes, panes] = await Promise.all([paneProcesses(), herdrPanes(env)]);
  const owners = store.shardOwners();
  const pids = new Set(processes.map(entry => entry.pid));
  const bySession = new Map();
  const byPane = new Map();
  const info = new Map(panes.map(pane => [pane.pane_id, pane]));
  const candidates = [];
  for (const entry of processes) {
    const owner = owners.get(entry.pid);
    if (owner) candidates.push({ ...entry, ...owner, top: !pids.has(entry.ppid) });
  }
  candidates.sort((a, b) => Number(a.top) - Number(b.top) || a.at - b.at);
  for (const candidate of candidates) {
    const pane = info.get(candidate.pane);
    if (panes.length && !pane) continue;
    const record = {
      paneId: candidate.pane,
      title: text(pane?.title) ?? text(pane?.display_agent) ?? text(pane?.terminal_title_stripped),
      agentStatus: text(pane?.agent_status),
      workspaceId: text(pane?.workspace_id),
      pid: candidate.pid,
    };
    bySession.set(candidate.sessionId, record);
    byPane.set(candidate.pane, candidate.sessionId);
  }
  return { bySession, byPane, panes: info };
}

export function anchorPane(env = process.env) {
  let context;
  try { context = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON ?? ''); }
  catch { context = undefined; }
  const own = env.HERDR_PLUGIN_ENTRYPOINT_ID ? env.HERDR_PANE_ID : undefined;
  const found = [];
  const visit = (value, key = '') => {
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' && /pane_id$|^pane$/.test(key) && value !== own) found.push({ key, value });
      return;
    }
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  };
  visit(context);
  const preferred = found.find(entry => entry.key.startsWith('focused')) ?? found[0];
  return preferred?.value ?? (own ? undefined : env.HERDR_PANE_ID);
}

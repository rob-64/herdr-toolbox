import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { anchorPane, defaultAgentDir, paneSessions, Store } from './data.mjs';
import { buildView, emptyRows, FILTERS, footer, header, paint } from './render.mjs';

const VIEWS = ['agents', 'dag'];
const SCOPES = ['global', 'session'];
const SELECTED_BG = '48;5;237';

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === '--once') options.once = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-color') options.color = false;
    else if (arg === '--color') options.color = true;
    else if (arg === '--view') options.view = value();
    else if (arg === '--scope') options.scope = value();
    else if (arg === '--filter') options.filter = value();
    else if (arg === '--session') options.session = value();
    else if (arg === '--session-pane') options.sessionPane = value();
    else if (arg === '--width') options.width = Number(value());
    else if (arg === '--height') options.height = Number(value());
    else if (arg === '--agent-dir') options.agentDir = value();
    else if (arg === '-h' || arg === '--help') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  for (const [key, allowed] of [['view', VIEWS], ['scope', SCOPES], ['filter', FILTERS]]) {
    if (options[key] !== undefined && !allowed.includes(options[key])) throw new Error(`--${key} must be one of ${allowed.join(', ')}`);
  }
  return options;
}

const USAGE = `omo-agents: live board of OmO subagents and DAG runs

  --view agents|dag         --scope global|session     --filter active|today|all
  --session <id>            --session-pane <herdr pane id>
  --once                    print one frame and exit   --json   print the resolved model
  --width N --height N      frame size for --once      --no-color
  --agent-dir <path>        OmO agent dir (default ~/.omo/agent)

keys: g global/session  s selected session  v/Tab agents/dag  a filter  [ ] session  j/k move  Enter jump  r refresh  q quit`;

function prefsPath() {
  return process.env.HERDR_PLUGIN_STATE_DIR ? join(process.env.HERDR_PLUGIN_STATE_DIR, 'prefs.json') : undefined;
}

function loadPrefs() {
  const path = prefsPath();
  if (!path) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return {}; }
}

function savePrefs(ui) {
  const path = prefsPath();
  if (!path) return;
  try {
    mkdirSync(process.env.HERDR_PLUGIN_STATE_DIR, { recursive: true });
    writeFileSync(path, JSON.stringify({ view: ui.view, scope: ui.scope, filter: ui.filter }));
  } catch { /* prefs are a convenience; the board works without them */ }
}

function herdr(args) {
  return new Promise(resolve => {
    execFile(process.env.HERDR_BIN_PATH || 'herdr', args, { timeout: 5000 }, (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr }));
  });
}

class Board {
  constructor(options) {
    this.options = options;
    this.store = new Store(options.agentDir ?? defaultAgentDir());
    const prefs = loadPrefs();
    this.ui = {
      view: options.view ?? prefs.view ?? 'agents',
      scope: options.scope ?? prefs.scope ?? 'session',
      filter: options.filter ?? prefs.filter ?? 'today',
      sessionId: options.session,
      selectedKey: undefined,
      selectedIndex: 0,
      scroll: 0,
      message: undefined,
    };
    this.anchor = options.sessionPane ?? anchorPane();
    this.data = { tasks: [], runs: [] };
    this.panes = { bySession: new Map(), byPane: new Map(), panes: new Map() };
    this.tick = 0;
    this.last = '';
  }

  refreshData() {
    this.data = this.store.load();
  }

  async refreshPanes() {
    this.panes = await paneSessions(this.store);
    this.resolveSession();
  }

  resolveSession() {
    if (this.ui.sessionId) return;
    if (this.anchor && this.panes.byPane.has(this.anchor)) {
      this.ui.sessionId = this.panes.byPane.get(this.anchor);
      return;
    }
    const cwd = this.panes.panes.get(this.anchor)?.cwd;
    const match = cwd && this.data.tasks.filter(task => task.cwd === cwd).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (match) this.ui.sessionId = match.rootSessionId;
  }

  view(columns) {
    const view = buildView(this.data, this.panes, this.ui, Date.now(), columns, this.tick);
    this.sessions = view.sessions;
    const selectable = view.rows.map((row, index) => (row.key ? index : -1)).filter(index => index >= 0);
    let position = selectable.findIndex(index => view.rows[index].key === this.ui.selectedKey);
    if (position < 0) position = Math.min(this.ui.selectedIndex, selectable.length - 1);
    this.ui.selectedIndex = Math.max(0, position);
    const selectedRow = view.rows[selectable[this.ui.selectedIndex]];
    this.ui.selectedKey = selectedRow?.key;
    this.selected = selectedRow;
    this.selectable = selectable;
    return { ...view, selectedRow, selectedRowIndex: selectable[this.ui.selectedIndex] };
  }

  frame(columns, rows) {
    const now = Date.now();
    const view = this.view(columns);
    const color = this.options.color ?? true;
    const top = header(view, this.ui, now, columns);
    const bottom = footer(view.selectedRow, columns, this.ui.message);
    const bodyHeight = Math.max(1, rows - top.length - bottom.length);
    const body = view.rows.length ? view.rows : emptyRows(this.ui).map(segments => ({ segments }));
    const target = view.selectedRowIndex ?? 0;
    if (target < this.ui.scroll) this.ui.scroll = Math.max(0, target - (body[target - 1]?.key ? 0 : 1));
    if (target >= this.ui.scroll + bodyHeight) this.ui.scroll = target - bodyHeight + 1;
    this.ui.scroll = Math.max(0, Math.min(this.ui.scroll, Math.max(0, body.length - bodyHeight)));
    const visible = body.slice(this.ui.scroll, this.ui.scroll + bodyHeight);
    const lines = top.map(segments => paint(segments, columns, { color }));
    visible.forEach((row, index) => {
      const selected = view.rows.length && this.ui.scroll + index === target;
      lines.push(paint(row.segments, columns, { color, background: selected ? SELECTED_BG : undefined }));
    });
    while (lines.length < rows - bottom.length) lines.push(' '.repeat(columns));
    lines.push(...bottom.map(segments => paint(segments, columns, { color })));
    return lines;
  }

  move(delta) {
    const count = this.selectable?.length ?? 0;
    if (!count) return;
    this.ui.selectedIndex = Math.max(0, Math.min(count - 1, this.ui.selectedIndex + delta));
    this.ui.selectedKey = undefined;
  }

  cycleSession(delta) {
    const list = this.sessions ?? [];
    if (!list.length) return;
    const index = list.findIndex(session => session.id === this.ui.sessionId);
    const next = list[(index + delta + list.length) % list.length] ?? list[0];
    this.ui.scope = 'session';
    this.ui.sessionId = next.id;
    this.ui.selectedKey = undefined;
    this.ui.selectedIndex = 0;
  }

  toggleScope() {
    this.ui.scope = this.ui.scope === 'global' ? 'session' : 'global';
    if (this.ui.scope === 'session') {
      this.resolveSession();
      if (!this.ui.sessionId && this.sessions?.length) {
        this.ui.sessionId = this.sessions[0].id;
        this.ui.message = 'No OmO session in the pane that opened this board; showing the most recent one.';
      }
    }
    this.ui.selectedKey = undefined;
    this.ui.selectedIndex = 0;
  }

  showSelectedSession() {
    const sessionId = this.selected?.target?.sessionId;
    if (!sessionId) return;
    this.ui.scope = 'session';
    this.ui.sessionId = sessionId;
    this.ui.selectedKey = undefined;
    this.ui.selectedIndex = 0;
  }

  async jump() {
    const sessionId = this.selected?.target?.sessionId;
    const pane = sessionId && this.panes.bySession.get(sessionId);
    if (!pane) { this.ui.message = 'That session has no live herdr pane.'; return false; }
    const result = await herdr(['agent', 'focus', pane.paneId]);
    if (!result.ok) { this.ui.message = `Could not focus ${pane.paneId}: ${(result.stderr || result.stdout || '').trim().slice(0, 120)}`; return false; }
    return true;
  }
}

async function interactive(board) {
  const out = process.stdout;
  const input = process.stdin;
  let closing = false;
  const timers = [];
  const restore = () => {
    for (const timer of timers) clearInterval(timer);
    if (input.isTTY) input.setRawMode(false);
    out.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  };
  const quit = (code = 0) => {
    if (closing) return;
    closing = true;
    restore();
    savePrefs(board.ui);
    process.exit(code);
  };
  const draw = () => {
    if (closing) return;
    const lines = board.frame(out.columns || 100, out.rows || 30);
    const frame = lines.map((line, index) => `\x1b[${index + 1};1H${line}`).join('');
    if (frame !== board.last) out.write(frame);
    board.last = frame;
  };
  out.write('\x1b[?1049h\x1b[?25l\x1b[2J');
  process.on('SIGTERM', () => quit(0));
  process.on('SIGHUP', () => quit(0));
  process.on('uncaughtException', error => { restore(); console.error(error); process.exit(1); });
  out.on('resize', () => { board.last = ''; out.write('\x1b[2J'); draw(); });

  board.refreshData();
  draw();
  await board.refreshPanes();
  board.refreshData();
  draw();

  timers.push(setInterval(() => { board.refreshData(); }, 1500));
  timers.push(setInterval(() => { board.refreshPanes().then(draw, () => {}); }, 4000));
  timers.push(setInterval(() => { board.tick += 1; draw(); }, 250));

  if (input.isTTY) input.setRawMode(true);
  input.setEncoding('utf8');
  input.on('data', async chunk => {
    const popup = process.env.HERDR_PLUGIN_ENTRYPOINT_ID === 'board';
    for (const key of chunk.match(/\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Z]|[\s\S]/g) ?? []) {
      board.ui.message = undefined;
      if (key === 'q' || key === '\x03' || key === '\x1b') return quit(0);
      if (key === 'j' || key === '\x1b[B' || key === '\x1bOB') board.move(1);
      else if (key === 'k' || key === '\x1b[A' || key === '\x1bOA') board.move(-1);
      else if (key === '\x1b[6~' || key === ' ') board.move(10);
      else if (key === '\x1b[5~') board.move(-10);
      else if (key === 'G') board.move(1e6);
      else if (key === 'g') board.toggleScope();
      else if (key === 's') board.showSelectedSession();
      else if (key === 'v' || key === '\t') { board.ui.view = board.ui.view === 'agents' ? 'dag' : 'agents'; board.ui.selectedKey = undefined; board.ui.selectedIndex = 0; }
      else if (key === 'a') board.ui.filter = FILTERS[(FILTERS.indexOf(board.ui.filter) + 1) % FILTERS.length];
      else if (key === ']') board.cycleSession(1);
      else if (key === '[') board.cycleSession(-1);
      else if (key === 'r') { board.refreshData(); await board.refreshPanes(); }
      else if (key === '\r' || key === '\n') { if (await board.jump() && popup) return quit(0); }
      savePrefs(board.ui);
    }
    draw();
  });
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`omo-agents: ${error.message}\n\n${USAGE}`); process.exit(2); }
  if (options.help) { console.log(USAGE); return; }
  const board = new Board(options);
  if (process.env.HERDR_PLUGIN_STATE_DIR) {
    try { writeFileSync(join(process.env.HERDR_PLUGIN_STATE_DIR, 'last-context.json'), process.env.HERDR_PLUGIN_CONTEXT_JSON ?? '{}'); }
    catch { /* diagnostics only */ }
  }
  if (options.once || options.json || !process.stdout.isTTY) {
    board.refreshData();
    await board.refreshPanes();
    board.refreshData();
    if (options.color === undefined) board.options.color = Boolean(process.stdout.isTTY);
    const lines = board.frame(options.width ?? process.stdout.columns ?? 120, options.height ?? process.stdout.rows ?? 40);
    if (options.json) {
      console.log(JSON.stringify({
        anchor: board.anchor ?? null,
        scope: board.ui.scope,
        sessionId: board.ui.sessionId ?? null,
        tasks: board.data.tasks.length,
        runs: board.data.runs.length,
        sessions: board.sessions.map(session => ({ id: session.id, pane: session.pane?.paneId ?? null, title: session.pane?.title ?? null, project: session.project, tasks: session.tasks.length, runs: session.runs.length })),
      }, null, 2));
    } else console.log(lines.map(line => line.replace(/\s+$/, '')).join('\n'));
    return;
  }
  await interactive(board);
}

main();

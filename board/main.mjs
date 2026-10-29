import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { anchorPane, defaultAgentDir, paneSessions, Store } from './data.mjs';
import { buildView, emptyRows, FILTERS, footer, header, paint, width } from './render.mjs';

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

const USAGE = `agents-board: live board of OmO subagents and DAG runs

  --view agents|dag         --scope global|session     --filter active|today|all
  --session <id>            --session-pane <herdr pane id>
  --once                    print one frame and exit   --json   print the resolved model
  --width N --height N      frame size for --once      --no-color
  --agent-dir <path>        OmO agent dir (default ~/.omo/agent)

keys: g global/session  s selected session  v/Tab agents/dag  a filter  [ ] session  j/k move  Enter jump  r refresh  q quit
mouse: click a row to select it, click it again to jump to its pane; click a session header to open/close
       that session; click GLOBAL/SESSION, Agents/DAG, or filter in the header; wheel scrolls`;

function herdr(args) {
  return new Promise(resolve => {
    execFile(process.env.HERDR_BIN_PATH || 'herdr', args, { timeout: 5000 }, (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr }));
  });
}

class Board {
  constructor(options) {
    this.options = options;
    this.store = new Store(options.agentDir ?? defaultAgentDir());
    this.ui = {
      view: options.view ?? 'agents',
      scope: options.scope ?? 'global',
      filter: options.filter ?? 'active',
      sessionId: options.session,
      activeSessionId: undefined,
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
    this.trackActiveSession();
  }

  trackActiveSession() {
    const own = process.env.HERDR_PLUGIN_ENTRYPOINT_ID ? process.env.HERDR_PANE_ID : undefined;
    for (const pane of this.panes.panes.values()) {
      if (pane.focused && pane.pane_id !== own && this.panes.byPane.has(pane.pane_id)) {
        this.ui.activeSessionId = this.panes.byPane.get(pane.pane_id);
        return;
      }
    }
    this.ui.activeSessionId ??= this.anchor ? this.panes.byPane.get(this.anchor) : undefined;
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
    const hits = [];
    let x = 1;
    for (const part of top[0]) {
      const w = width(part.text);
      if (part.action) hits.push({ from: x, to: x + w, action: part.action });
      x += w;
    }
    this.layout = { hits, bodyStart: top.length + 1, visible: view.rows.length ? visible : [] };
    visible.forEach((row, index) => {
      const selected = view.rows.length && this.ui.scroll + index === target;
      lines.push(paint(row.segments, columns, { color, background: selected ? SELECTED_BG : row.background }));
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
      this.ui.sessionId ??= this.ui.activeSessionId;
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
    if (sessionId) this.showSession(sessionId);
  }

  showSession(sessionId) {
    this.ui.scope = 'session';
    this.ui.sessionId = sessionId;
    this.ui.selectedKey = undefined;
    this.ui.selectedIndex = 0;
  }

  toggleView(view) {
    this.ui.view = view ?? (this.ui.view === 'agents' ? 'dag' : 'agents');
    this.ui.selectedKey = undefined;
    this.ui.selectedIndex = 0;
  }

  cycleFilter() {
    this.ui.filter = FILTERS[(FILTERS.indexOf(this.ui.filter) + 1) % FILTERS.length];
  }

  click(x, y) {
    if (!this.layout) return undefined;
    if (y === 1) {
      const hit = this.layout.hits.find(entry => x >= entry.from && x < entry.to);
      if (hit?.action === 'scope') this.toggleScope();
      else if (hit?.action === 'filter') this.cycleFilter();
      else if (hit?.action?.startsWith('view:')) this.toggleView(hit.action.slice(5));
      return undefined;
    }
    const row = this.layout.visible[y - this.layout.bodyStart];
    if (!row?.key) return undefined;
    if (row.header) {
      const open = this.ui.scope === 'session' && this.ui.sessionId === row.target.sessionId;
      if (open) { this.ui.scope = 'global'; this.ui.selectedKey = row.key; }
      else this.showSession(row.target.sessionId);
      return undefined;
    }
    if (row.key === this.ui.selectedKey) return 'jump';
    this.ui.selectedKey = row.key;
    return undefined;
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
    out.write('\x1b[?1000l\x1b[?1006l\x1b[0m\x1b[?25h\x1b[?1049l');
  };
  const quit = (code = 0) => {
    if (closing) return;
    closing = true;
    restore();
    process.exit(code);
  };
  const draw = () => {
    if (closing) return;
    const lines = board.frame(out.columns || 100, out.rows || 30);
    const frame = lines.map((line, index) => `\x1b[${index + 1};1H${line}`).join('');
    if (frame !== board.last) out.write(frame);
    board.last = frame;
  };
  out.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[?1000h\x1b[?1006h');
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
  timers.push(setInterval(() => { board.refreshPanes().then(draw, () => {}); }, 2000));
  timers.push(setInterval(() => { board.tick += 1; draw(); }, 250));

  if (input.isTTY) input.setRawMode(true);
  input.setEncoding('utf8');
  input.on('data', async chunk => {
    const popup = process.env.HERDR_PLUGIN_ENTRYPOINT_ID === 'board';
    for (const key of chunk.match(/\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Z]|[\s\S]/g) ?? []) {
      board.ui.message = undefined;
      const mouse = key.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
      if (mouse) {
        const [button, x, y] = mouse.slice(1, 4).map(Number);
        if (button === 64) board.move(-3);
        else if (button === 65) board.move(3);
        else if (button === 0 && mouse[4] === 'M' && board.click(x, y) === 'jump' && await board.jump() && popup) return quit(0);
        continue;
      }
      if (key === 'q' || key === '\x03' || key === '\x1b') return quit(0);
      if (key === 'j' || key === '\x1b[B' || key === '\x1bOB') board.move(1);
      else if (key === 'k' || key === '\x1b[A' || key === '\x1bOA') board.move(-1);
      else if (key === '\x1b[6~' || key === ' ') board.move(10);
      else if (key === '\x1b[5~') board.move(-10);
      else if (key === 'G') board.move(1e6);
      else if (key === 'g') board.toggleScope();
      else if (key === 's') board.showSelectedSession();
      else if (key === 'v' || key === '\t') board.toggleView();
      else if (key === 'a') board.cycleFilter();
      else if (key === ']') board.cycleSession(1);
      else if (key === '[') board.cycleSession(-1);
      else if (key === 'r') { board.refreshData(); await board.refreshPanes(); }
      else if (key === '\r' || key === '\n') { if (await board.jump() && popup) return quit(0); }
    }
    draw();
  });
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`agents-board: ${error.message}\n\n${USAGE}`); process.exit(2); }
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
        activeSessionId: board.ui.activeSessionId ?? null,
        view: board.ui.view,
        filter: board.ui.filter,
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

import { execFile } from 'node:child_process';
import { paint, width } from '../board/render.mjs';
import { PrStore, ghRunner } from './data.mjs';
import { buildRows, emptyRows, FILTERS, footer, header, ROLE_FILTERS } from './render.mjs';

const SELECTED_BG = '48;5;237';
const REFRESH_MS = 60_000;

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === '--once') options.once = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-color') options.color = false;
    else if (arg === '--color') options.color = true;
    else if (arg === '--filter') options.filter = value();
    else if (arg === '--role') options.role = value();
    else if (arg === '--width') options.width = Number(value());
    else if (arg === '--height') options.height = Number(value());
    else if (arg === '-h' || arg === '--help') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  for (const [key, allowed] of [['filter', FILTERS], ['role', ROLE_FILTERS]]) {
    if (options[key] !== undefined && !allowed.includes(options[key])) throw new Error(`--${key} must be one of ${allowed.join(', ')}`);
  }
  return options;
}

const USAGE = `pr-board: GitHub pull requests you opened, committed to, commented on, or reviewed (via gh)

  --filter open|recent|all            open (default), updated in the last 30 days, or everything
  --role any|opened|committed|commented
  --once                              print one frame and exit   --json   print the loaded PRs
  --width N --height N                frame size for --once      --no-color

keys: j/k move  Enter/o open in browser  f filter  m role  r refresh  g/G top/bottom  q quit
mouse: click a row to select it, click it again to open it; wheel scrolls
env: GH_BIN overrides the gh binary`;

class Board {
  constructor(options) {
    this.options = options;
    this.store = new PrStore({ run: ghRunner() });
    const envFilter = process.env.PR_BOARD_FILTER;
    this.ui = {
      filter: options.filter ?? (FILTERS.includes(envFilter) ? envFilter : 'open'),
      role: options.role ?? 'any',
      selectedKey: undefined,
      selectedIndex: 0,
      scroll: 0,
      message: undefined,
    };
    this.data = { prs: [], errors: [], loading: false };
    this.loadedFilter = undefined;
    this.pending = undefined;
    this.last = '';
  }

  // Only one fetch at a time; a filter change while loading refetches when the current one ends.
  refresh() {
    if (this.pending) { this.again = true; return this.pending; }
    const filter = this.ui.filter;
    this.data = { ...this.data, loading: true };
    this.pending = this.store.load(filter).then(result => {
      this.data = { ...result, loading: false };
      this.loadedFilter = filter;
    }).finally(() => {
      this.pending = undefined;
      if (this.again || this.loadedFilter !== this.ui.filter) { this.again = false; this.onChange?.(); return this.refresh(); }
    });
    return this.pending;
  }

  view(columns) {
    const now = Date.now();
    const { rows } = buildRows(this.data, this.ui, now, columns);
    const selectable = rows.map((row, index) => (row.key ? index : -1)).filter(index => index >= 0);
    let position = selectable.findIndex(index => rows[index].key === this.ui.selectedKey);
    if (position < 0) position = Math.min(this.ui.selectedIndex, selectable.length - 1);
    this.ui.selectedIndex = Math.max(0, position);
    const selectedRowIndex = selectable[this.ui.selectedIndex];
    this.selected = rows[selectedRowIndex];
    this.ui.selectedKey = this.selected?.key;
    this.selectable = selectable;
    return { rows, selectedRowIndex, now };
  }

  frame(columns, rows) {
    const color = this.options.color ?? true;
    const view = this.view(columns);
    const top = header(this.data, this.ui, view, view.now, columns);
    const bottom = footer(this.selected, this.data, columns, this.ui.message);
    const bodyHeight = Math.max(1, rows - top.length - bottom.length);
    const body = view.rows.length ? view.rows : emptyRows(this.data, this.ui).map(segments => ({ segments }));
    const target = view.selectedRowIndex ?? 0;
    // Keep the repo header above the first PR of a group in view when scrolling up.
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

  cycleFilter() {
    this.ui.filter = FILTERS[(FILTERS.indexOf(this.ui.filter) + 1) % FILTERS.length];
    this.ui.selectedKey = undefined;
    this.ui.selectedIndex = 0;
    this.refresh();
  }

  cycleRole() {
    this.ui.role = ROLE_FILTERS[(ROLE_FILTERS.indexOf(this.ui.role) + 1) % ROLE_FILTERS.length];
    this.ui.selectedKey = undefined;
    this.ui.selectedIndex = 0;
  }

  click(x, y) {
    if (!this.layout) return undefined;
    if (y === 1) {
      const hit = this.layout.hits.find(entry => x >= entry.from && x < entry.to);
      if (hit?.action === 'filter') this.cycleFilter();
      else if (hit?.action === 'role') this.cycleRole();
      return undefined;
    }
    const row = this.layout.visible[y - this.layout.bodyStart];
    if (!row?.key) return undefined;
    if (row.key === this.ui.selectedKey) return 'open';
    this.ui.selectedKey = row.key;
    return undefined;
  }

  openSelected() {
    const url = this.selected?.target?.url;
    if (!url) return Promise.resolve(false);
    return new Promise(resolve => {
      execFile(process.env.GH_BIN || 'gh', ['pr', 'view', url, '--web'], { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) this.ui.message = `Could not open ${url}: ${String(stderr || error.message).trim().split('\n')[0].slice(0, 120)}`;
        resolve(!error);
      });
    });
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

  board.onChange = draw;
  board.refresh().then(draw);
  draw();
  timers.push(setInterval(() => { board.refresh().then(draw); }, REFRESH_MS));
  // Redraw every second so the "updated Ns ago" clock and loading state stay current.
  timers.push(setInterval(draw, 1000));

  if (input.isTTY) input.setRawMode(true);
  input.setEncoding('utf8');
  input.on('data', async chunk => {
    // Popup mode: close after handing the PR to the browser.
    const popup = process.env.HERDR_PLUGIN_ENTRYPOINT_ID === 'prs';
    for (const key of chunk.match(/\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Z]|[\s\S]/g) ?? []) {
      board.ui.message = undefined;
      const mouse = key.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
      if (mouse) {
        const [button, x, y] = mouse.slice(1, 4).map(Number);
        if (button === 64) board.move(-3);
        else if (button === 65) board.move(3);
        else if (button === 0 && mouse[4] === 'M' && board.click(x, y) === 'open' && await board.openSelected() && popup) return quit(0);
        continue;
      }
      if (key === 'q' || key === '\x03' || key === '\x1b') return quit(0);
      if (key === 'j' || key === '\x1b[B' || key === '\x1bOB') board.move(1);
      else if (key === 'k' || key === '\x1b[A' || key === '\x1bOA') board.move(-1);
      else if (key === '\x1b[6~' || key === ' ') board.move(10);
      else if (key === '\x1b[5~') board.move(-10);
      else if (key === 'g') board.move(-1e6);
      else if (key === 'G') board.move(1e6);
      else if (key === 'f') board.cycleFilter();
      else if (key === 'm') board.cycleRole();
      else if (key === 'r') board.refresh().then(draw);
      else if (key === '\r' || key === '\n' || key === 'o') { if (await board.openSelected() && popup) return quit(0); }
    }
    draw();
  });
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`pr-board: ${error.message}\n\n${USAGE}`); process.exit(2); }
  if (options.help) { console.log(USAGE); return; }
  const board = new Board(options);
  if (options.once || options.json || !process.stdout.isTTY) {
    await board.refresh();
    if (options.json) {
      const prs = board.data.prs.map(pr => ({ ...pr, roles: [...pr.roles] }));
      const roles = {};
      for (const pr of prs) for (const role of pr.roles) roles[role] = (roles[role] ?? 0) + 1;
      console.log(JSON.stringify({ login: board.data.login ?? null, filter: board.ui.filter, total: prs.length, roles, errors: board.data.errors, prs }, null, 2));
      return;
    }
    if (options.color === undefined) board.options.color = Boolean(process.stdout.isTTY);
    const lines = board.frame(options.width ?? process.stdout.columns ?? 120, options.height ?? process.stdout.rows ?? 40);
    console.log(lines.map(line => line.replace(/\s+$/, '')).join('\n'));
    return;
  }
  await interactive(board);
}

main();

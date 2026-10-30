import { stages, TERMINAL } from './data.mjs';
import { iconFor } from '../tabs/labels.mjs';
import { loadConfig } from '../tabs/state.mjs';

/** @type {object | undefined} */
let iconConfigOverride;

export function setIconConfig(config) {
  iconConfigOverride = config;
}

function iconConfig() {
  if (iconConfigOverride !== undefined) return iconConfigOverride;
  return loadConfig();
}

export function modelVendor(model) {
  if (!model) return undefined;
  const s = String(model).toLowerCase();
  if (/claude|opus|sonnet|haiku|fable/.test(s)) return 'claude';
  if (/gpt|codex|chatgpt|openai/.test(s)) return 'codex';
  if (/composer|cursor/.test(s)) return 'cursor';
  if (/gemini/.test(s)) return 'gemini';
  return undefined;
}

export function vendorColor(kind) {
  const k = kind ?? 'default';
  if (k === 'claude') return '38;5;209';
  if (k === 'codex') return '37';
  if (k === 'cursor') return '36';
  if (k === 'gemini') return '34';
  return '35';
}

export function agentGlyph(kind) {
  return iconFor(kind ?? 'default', iconConfig());
}

function sessionAgentIconSeg(agentKind) {
  const kind = agentKind ?? 'omo';
  const glyph = agentGlyph(kind);
  if (!glyph) return [];
  return [seg(`${glyph} `, vendorColor(kind))];
}

function modelIconParts(model) {
  const vendor = modelVendor(model) ?? 'default';
  const glyph = agentGlyph(vendor);
  if (!glyph) return { segs: [], extra: 0 };
  return { segs: [seg(glyph, vendorColor(vendor)), seg(' ')], extra: width(glyph) + 1 };
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
export const FILTERS = ['active', 'today', 'all'];
export const STATUS_FILTERS = ['all', 'open', 'in_progress', 'pending', 'completed', 'abandoned'];

const TODO_GLYPH = {
  pending: ['○', '90', 'todo'],
  in_progress: ['◐', '1;33', 'in progress'],
  completed: ['✔', '32', 'done'],
  abandoned: ['⊘', '9;90', 'abandoned'],
};

export const STATUS = {
  running: ['', '33'], starting: ['○', '33'], retrying: ['↻', '33'],
  pending: ['○', '90'], queued: ['○', '90'], scheduled: ['○', '90'],
  blocked: ['◇', '35'], paused: ['‖', '34'],
  completed: ['✔', '32'], error: ['✖', '31'], failed: ['✖', '31'],
  cancelled: ['⊘', '90'], skipped: ['↷', '90'],
  interrupted: ['!', '33'], lost: ['!', '33'], stale: ['!', '33'],
};

export const seg = (text, style = '', action) => ({ text: String(text ?? ''), style, action });
const ACTIVE_BG = '48;5;53';

export function icon(status, tick) {
  const [glyph, color] = STATUS[status] ?? ['?', '90'];
  return seg(status === 'running' ? SPINNER[tick % SPINNER.length] : glyph, color);
}

export function charWidth(code) {
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if ((code >= 0x300 && code <= 0x36f) || (code >= 0x200b && code <= 0x200f) || (code >= 0xfe00 && code <= 0xfe0f)) return 0;
  if ((code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1faff) || (code >= 0x20000 && code <= 0x3fffd)) return 2;
  return 1;
}

export function width(text) {
  let total = 0;
  for (const char of text) total += charWidth(char.codePointAt(0));
  return total;
}

export function wrap(text, size) {
  if (size <= 0) return [''];
  const raw = String(text ?? '').split('\n');
  const collapsed = [];
  let blank = false;
  for (const line of raw) {
    if (!line) {
      if (!blank) collapsed.push('');
      blank = true;
      continue;
    }
    blank = false;
    collapsed.push(line);
  }
  const out = [];
  for (const line of collapsed) {
    if (!line) { out.push(''); continue; }
    let rest = line;
    while (rest) {
      if (width(rest) <= size) { out.push(rest); break; }
      let used = 0;
      let cut = 0;
      let lastSpace = -1;
      for (const char of rest) {
        const w = charWidth(char.codePointAt(0));
        if (used + w > size) break;
        if (char === ' ') lastSpace = cut + char.length;
        used += w;
        cut += char.length;
      }
      if (cut <= 0) {
        used = 0;
        cut = 0;
        for (const char of rest) {
          const w = charWidth(char.codePointAt(0));
          if (used + w > size) break;
          used += w;
          cut += char.length;
        }
        if (cut <= 0) cut = 1;
      } else if (lastSpace > 0) {
        out.push(rest.slice(0, lastSpace).trimEnd());
        rest = rest.slice(lastSpace).trimStart();
        continue;
      }
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
  }
  return out.length ? out : [''];
}

export function fit(text, size, align = 'left') {
  if (size <= 0) return '';
  let out = '';
  let used = 0;
  const full = width(text);
  const limit = full > size ? size - 1 : size;
  for (const char of text) {
    const w = charWidth(char.codePointAt(0));
    if (used + w > limit) break;
    out += char;
    used += w;
  }
  if (full > size) { out += '…'; used += 1; }
  const pad = ' '.repeat(Math.max(0, size - used));
  return align === 'right' ? pad + out : out + pad;
}

export function paint(segments, columns, { color = true, background } = {}) {
  let out = '';
  let used = 0;
  for (const part of segments) {
    if (used >= columns) break;
    const room = columns - used;
    const piece = width(part.text) > room ? fit(part.text, room) : part.text;
    used += width(piece);
    out += color && part.style ? `\x1b[${part.style}m${piece}\x1b[0m${background && color ? `\x1b[${background}m` : ''}` : piece;
  }
  out += ' '.repeat(Math.max(0, columns - used));
  return color && background ? `\x1b[${background}m${out}\x1b[0m` : out;
}

export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d`;
}

const ago = (now, at) => (at ? `${duration(now - at).replace(/(\d+[a-z]+).*/, '$1')} ago` : '');
const shortModel = model => (model ? model.split('/').pop() : '');
const elapsed = (item, now) => (item.startedAt ? duration((item.endedAt ?? now) - item.startedAt) : '');

export function keepTask(task, filter, now) {
  if (filter === 'all') return true;
  if (!task.terminal) return true;
  return filter === 'today' && now - (task.endedAt ?? task.updatedAt) < DAY;
}

function keepRun(run, filter, now) {
  if (filter === 'all') return true;
  if (!TERMINAL.has(run.status)) return true;
  return filter === 'today' && now - run.updatedAt < DAY;
}

export function sessionLabel(session) {
  if (session.pane) return `${session.pane.paneId} · ${session.pane.title ?? session.project}`;
  return `${session.project} · ${session.id.slice(0, 8)}`;
}

export function buildSessions(data, panes, filter, now) {
  const sessions = new Map();
  const get = (id, project) => {
    if (!sessions.has(id)) sessions.set(id, { id, project, tasks: [], runs: [], allTasks: 0, lastActivity: 0, pane: panes?.bySession?.get(id) });
    return sessions.get(id);
  };
  for (const task of data.tasks) {
    const session = get(task.rootSessionId ?? task.sessionId ?? 'unknown', task.project);
    session.allTasks += 1;
    session.lastActivity = Math.max(session.lastActivity, task.updatedAt);
    if (keepTask(task, filter, now)) session.tasks.push(task);
  }
  for (const run of data.runs) {
    const session = get(run.rootSessionId ?? run.sessionId ?? 'unknown', run.project);
    session.lastActivity = Math.max(session.lastActivity, run.updatedAt);
    if (keepRun(run, filter, now)) session.runs.push(run);
  }
  for (const [sessionId, pane] of panes?.bySession ?? []) {
    if (!sessions.has(sessionId)) sessions.set(sessionId, { id: sessionId, project: pane.title ?? 'omo', tasks: [], runs: [], allTasks: 0, lastActivity: 0, pane });
  }
  const list = [...sessions.values()];
  for (const session of list) {
    session.active = session.tasks.filter(task => !task.terminal).length + session.runs.filter(run => !TERMINAL.has(run.status)).length;
  }
  const busy = session => Number(session.active > 0) * 2 + Number(['working', 'blocked'].includes(session.pane?.agentStatus));
  return list.sort((a, b) => busy(b) - busy(a) || b.lastActivity - a.lastActivity);
}

function orderTasks(tasks) {
  const byChild = new Map(tasks.filter(task => task.childSessionId).map(task => [task.childSessionId, task]));
  const children = new Map();
  const roots = [];
  for (const task of tasks) {
    const parent = byChild.get(task.sessionId);
    if (parent && parent !== task) {
      if (!children.has(parent.id)) children.set(parent.id, []);
      children.get(parent.id).push(task);
    } else roots.push(task);
  }
  const sort = list => list.sort((a, b) => Number(a.terminal) - Number(b.terminal) || (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const out = [];
  const walk = (task, level) => {
    out.push({ task, level });
    for (const child of sort(children.get(task.id) ?? [])) walk(child, level + 1);
  };
  for (const task of sort(roots)) walk(task, 0);
  return out;
}

function counts(sessions) {
  const total = { running: 0, waiting: 0, completed: 0, failed: 0 };
  for (const session of sessions) {
    for (const task of session.tasks) {
      if (task.status === 'running') total.running += 1;
      else if (!task.terminal) total.waiting += 1;
      else if (task.status === 'completed') total.completed += 1;
      else if (['error', 'failed', 'stale', 'lost', 'interrupted'].includes(task.status)) total.failed += 1;
    }
  }
  return total;
}

function sessionHeader(session, now, tick, columns, active) {
  const live = session.pane;
  const status = live?.agentStatus;
  const running = session.tasks.filter(task => task.status === 'running').length;
  const done = session.tasks.filter(task => task.status === 'completed').length;
  const failed = session.tasks.filter(task => ['error', 'failed', 'stale'].includes(task.status)).length;
  const parts = [seg('▍', active ? '1;35' : live ? '36' : '90'), ...sessionAgentIconSeg(live?.agent ?? 'omo'), seg(sessionLabel(session), active ? '1;35' : '1')];
  if (columns >= 110 && session.pane && session.pane.title && session.project && !session.pane.title.includes(session.project)) parts.push(seg(`  ${session.project}`, '90'));
  parts.push(seg('  '));
  if (live) parts.push(status === 'working' ? seg(`${SPINNER[tick % SPINNER.length]} working`, '33') : status === 'blocked' ? seg('◇ needs input', '35') : seg(`● ${status ?? 'live'}`, '36'));
  else parts.push(seg('○ closed', '90'));
  const tail = [];
  if (running) tail.push(seg(`${running} running`, '33'));
  if (done) tail.push(seg(`${done} done`, '32'));
  if (failed) tail.push(seg(`${failed} failed`, '31'));
  if (session.runs.length) tail.push(seg(`${session.runs.length} dag`, '36'));
  if (tail.length) parts.push(seg('   '), ...tail.flatMap((part, index) => (index ? [seg(' · ', '90'), part] : [part])));
  parts.push(seg(`   ${ago(now, session.lastActivity)}`, '90'));
  return parts;
}

function taskRow(task, level, columns, now, tick, dagTag) {
  const indent = '  '.repeat(level + 1);
  const agentW = 16;
  const modelW = columns >= 120 ? 22 : columns >= 96 ? 16 : 0;
  const timeW = 8;
  const statsW = columns >= 110 ? 12 : 0;
  const { segs: vendorSegs, extra: vendorExtra } = modelIconParts(task.model);
  const fixed = width(indent) + 2 + vendorExtra + agentW + 1 + (modelW ? modelW + 1 : 0) + timeW + 1 + (statsW ? statsW : 0);
  const summaryW = Math.max(10, columns - fixed - 1);
  const summary = dagTag ? `⧉ ${dagTag}  ${task.summary}` : task.summary;
  const stats = [task.turns !== undefined ? `t${task.turns}` : '', task.toolCalls !== undefined ? `⚒${task.toolCalls}` : ''].filter(Boolean).join(' ');
  const row = [seg(indent), icon(task.status, tick), seg(' '), ...vendorSegs, seg(fit(task.agent, agentW), task.terminal ? '90' : '36'), seg(' '),
    seg(fit(summary, summaryW), task.terminal ? '' : '1')];
  if (modelW) row.push(seg(' '), seg(fit(shortModel(task.model), modelW), '90'));
  row.push(seg(' '), seg(fit(elapsed(task, now), timeW, 'right'), task.terminal ? '90' : '33'));
  if (statsW) row.push(seg(' '), seg(fit(stats, statsW - 1, 'right'), '90'));
  return row;
}

function detailRow(level, text, style) {
  return [seg('  '.repeat(level + 1) + '   '), seg('└ ', '90'), seg(text, style)];
}

function progressText(task, now) {
  if (!task.tool && !task.line) return null;
  const quiet = task.lastAt && now - task.lastAt > 15000 ? `  · quiet ${duration(now - task.lastAt)}` : '';
  return [task.tool ? `[${task.tool}]` : '', task.line ?? ''].filter(Boolean).join(' ') + quiet;
}

function todoBar(done, total, size = 12) {
  const denom = total || 1;
  const a = Math.round((done / denom) * size);
  return [seg('█'.repeat(a), '32'), seg('░'.repeat(Math.max(0, size - a)), '90')];
}

function todoGlyph(status) {
  const [glyph, color, label] = TODO_GLYPH[status] ?? TODO_GLYPH.pending;
  return { glyph, color, label, segments: [seg(glyph, color)] };
}

function itemVisible(status, filter) {
  if (filter === 'all') return true;
  if (filter === 'open') return status === 'pending' || status === 'in_progress';
  return status === filter;
}

function openItem(task) {
  return task.status === 'pending' || task.status === 'in_progress';
}

function countTodoItems(phases) {
  const total = { in_progress: 0, pending: 0, completed: 0, abandoned: 0 };
  for (const phase of phases ?? []) {
    for (const task of phase.tasks) {
      if (task.status === 'in_progress') total.in_progress += 1;
      else if (task.status === 'pending') total.pending += 1;
      else if (task.status === 'completed') total.completed += 1;
      else if (task.status === 'abandoned') total.abandoned += 1;
    }
  }
  return total;
}

function phaseAllDone(phase) {
  return phase.tasks.length > 0 && phase.tasks.every(task => task.status === 'completed' || task.status === 'abandoned');
}

function todoDoneTotal(phases) {
  let done = 0;
  let total = 0;
  for (const phase of phases ?? []) {
    for (const task of phase.tasks) {
      total += 1;
      if (task.status === 'completed') done += 1;
    }
  }
  return { done, total };
}

export function isTaskFolded(folded, key, defaultValue) {
  return folded.has(key) ? folded.get(key) : defaultValue;
}

export function toggleTaskFold(folded, key, defaultValue) {
  const next = new Map(folded);
  next.set(key, !isTaskFolded(folded, key, defaultValue));
  return next;
}

export function setTaskFold(folded, key, value) {
  const next = new Map(folded);
  next.set(key, value);
  return next;
}

export function foldAllTaskFolds(folded, keys) {
  const next = new Map(folded);
  for (const key of keys) next.set(key, true);
  return next;
}

export function expandAllTaskFolds(folded, keys) {
  const next = new Map(folded);
  for (const key of keys) next.set(key, false);
  return next;
}

function sortSubagents(tasks) {
  return tasks.slice().sort((a, b) => Number(a.terminal) - Number(b.terminal) || (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

function linkSessionTasks(tasks) {
  const byChild = new Map(tasks.filter(task => task.childSessionId).map(task => [task.childSessionId, task]));
  const children = new Map();
  const roots = [];
  for (const task of tasks) {
    const parent = byChild.get(task.sessionId);
    if (parent && parent !== task) {
      if (!children.has(parent.id)) children.set(parent.id, []);
      children.get(parent.id).push(task);
    } else roots.push(task);
  }
  for (const [id, list] of children) children.set(id, sortSubagents(list));
  return { roots: sortSubagents(roots), children };
}

function treePrefix(depth, lastFlags) {
  let out = '';
  for (let i = 0; i < depth; i++) out += lastFlags[i] ? '  ' : '│ ';
  return out;
}

function foldCaret(folded, key, defaultValue, hasChildren) {
  if (!hasChildren) return seg('  ', '90');
  const closed = isTaskFolded(folded, key, defaultValue);
  return seg(closed ? '▸' : '▾', '90');
}

function todoSessionLabel(session) {
  if (session.pane) return sessionLabel(session);
  const name = session.name ?? session.id.slice(0, 8);
  return `${session.project ?? 'omo'} · ${name}`;
}

function keepTodoSession(session, filter, now) {
  const live = Boolean(session.pane);
  const recent = now - (session.updatedAt ?? 0) < DAY;
  const open = (session.phases ?? []).some(phase => phase.tasks.some(openItem));
  if (filter === 'all') return true;
  if (filter === 'today') return recent || live;
  if (filter === 'active') return open && (live || recent);
  return true;
}

function sortTodoSessions(a, b) {
  const aProg = Number((a.phases ?? []).some(phase => phase.tasks.some(task => task.status === 'in_progress')));
  const bProg = Number((b.phases ?? []).some(phase => phase.tasks.some(task => task.status === 'in_progress')));
  if (bProg !== aProg) return bProg - aProg;
  const aLive = Number(Boolean(a.pane));
  const bLive = Number(Boolean(b.pane));
  if (bLive !== aLive) return bLive - aLive;
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

function todoSessionHeader(session, now, tick, columns, active, { ownDone, ownTotal, subagents, subRunning } = {}) {
  const live = session.pane;
  const status = live?.agentStatus;
  const parts = [seg('▍', active ? '1;35' : live ? '36' : '90'), ...sessionAgentIconSeg(live?.agent ?? 'omo'), seg(todoSessionLabel(session), active ? '1;35' : '1')];
  parts.push(seg('  '));
  if (live) parts.push(status === 'working' ? seg(`${SPINNER[tick % SPINNER.length]} working`, '33') : status === 'blocked' ? seg('◇ needs input', '35') : seg(`● ${status ?? 'live'}`, '36'));
  else parts.push(seg('○ closed', '90'));
  if (ownTotal) parts.push(seg('  '), ...todoBar(ownDone, ownTotal), seg(` ${ownDone}/${ownTotal} done`, '90'));
  if (subagents) {
    const word = subagents === 1 ? 'subagent' : 'subagents';
    const sub = subRunning ? `${subagents} ${word} (${subRunning} running)` : `${subagents} ${word}`;
    parts.push(seg(` · ${sub}`, '90'));
  }
  if (live?.title && !todoSessionLabel(session).includes(live.title)) parts.push(seg(`  ${live.title}`, '90'));
  parts.push(seg(`  ${ago(now, session.updatedAt)}`, '90'));
  return parts;
}

function activePhaseIndex(phases) {
  for (let i = 0; i < phases.length; i++) {
    if (phases[i].tasks.some(task => task.status === 'in_progress')) return i;
  }
  for (let i = 0; i < phases.length; i++) {
    if (phases[i].tasks.some(openItem)) return i;
  }
  return 0;
}

function subagentHasVisibleDescendants(task, children, statusFilter) {
  for (const phase of task.todos?.phases ?? []) {
    if (phase.tasks.some(item => itemVisible(item.status, statusFilter))) return true;
  }
  for (const child of children.get(task.id) ?? []) {
    if (statusFilter === 'all' || subagentHasVisibleDescendants(child, children, statusFilter)) return true;
  }
  return false;
}

function appendPhaseRows(ctx, phases, phaseScope, depth, lastFlags, ancestorTerminal) {
  const { session, rows, ui, statusFilter, columns, folded, foldKeys, boldPhase } = ctx;
  const visiblePhases = [];
  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
    const phase = phases[phaseIndex];
    const visibleTasks = phase.tasks.map((task, itemIndex) => ({ task, itemIndex })).filter(({ task }) => itemVisible(task.status, statusFilter));
    if (visibleTasks.length) visiblePhases.push({ phase, phaseIndex, visibleTasks });
  }
  visiblePhases.forEach(({ phase, phaseIndex, visibleTasks }, index) => {
    const isLast = index === visiblePhases.length - 1 && !ctx.pendingAfterPhases;
    const branch = isLast ? '└ ' : '├ ';
    const prefix = treePrefix(depth, lastFlags);
    const foldKey = `phase:${phaseScope}:${phaseIndex}`;
    const defaultFold = phaseAllDone(phase) || (ancestorTerminal && ui.scope === 'global');
    foldKeys.add(foldKey);
    const hasChildren = visibleTasks.length > 0;
    const closed = isTaskFolded(folded, foldKey, defaultFold);
    const done = phase.tasks.filter(task => task.status === 'completed').length;
    const phaseStyle = phaseIndex === boldPhase ? '1' : '90';
    const caret = foldCaret(folded, foldKey, defaultFold, hasChildren);
    rows.push({
      key: foldKey,
      foldKey,
      foldDefault: defaultFold,
      foldToggleTo: width(prefix + branch) + width(caret.text),
      parentKey: ctx.parentKey,
      target: { sessionId: session.id },
      segments: [seg(prefix + branch, '90'), caret, seg(` ${phase.name || 'phase'}`, phaseStyle), seg(`  ${done}/${phase.tasks.length}`, '90')],
    });
    if (closed || !hasChildren) return;
    const nextFlags = lastFlags.slice();
    nextFlags[depth] = isLast;
    visibleTasks.forEach(({ task, itemIndex }, itemPos) => {
      const itemLast = itemPos === visibleTasks.length - 1;
      const itemBranch = itemLast ? '└ ' : '├ ';
      const itemPrefix = treePrefix(depth + 1, nextFlags);
      const { label, segments: iconSeg } = todoGlyph(task.status);
      const lead = itemPrefix + itemBranch;
      const contentStyle = task.status === 'in_progress' ? '1' : (task.status === 'completed' || task.status === 'abandoned') ? '90' : '';
      const strike = task.status === 'abandoned' ? '9' : '';
      const measureSegs = [seg(lead, '90'), ...iconSeg, seg(' '), seg('', strike || contentStyle)];
      const used = measureSegs.reduce((n, s) => n + width(s.text), 0);
      const contentW = Math.max(8, columns - used);
      rows.push({
        key: `todo:${phaseScope}:${phaseIndex}:${itemIndex}`,
        parentKey: foldKey,
        target: { sessionId: session.id },
        segments: [seg(lead, '90'), ...iconSeg, seg(' '), seg(fit(task.content, contentW), strike || contentStyle)],
        detail: `${label} · ${phase.name || 'phase'} · ${task.content}`,
      });
    });
  });
}

function appendSubagentRows(ctx, task, depth, lastFlags, ancestorTerminal) {
  const { session, rows, ui, now, tick, columns, folded, foldKeys, statusFilter, children } = ctx;
  const foldKey = `subagent:${session.id}:${task.id}`;
  const defaultFold = task.terminal || (ancestorTerminal && ui.scope === 'global');
  foldKeys.add(foldKey);
  const childTasks = children.get(task.id) ?? [];
  const phases = task.todos?.phases ?? [];
  const hasChildren = phases.some(phase => phase.tasks.some(item => itemVisible(item.status, statusFilter)))
    || childTasks.some(child => statusFilter === 'all' || subagentHasVisibleDescendants(child, children, statusFilter));
  if (statusFilter !== 'all' && !hasChildren && !subagentHasVisibleDescendants(task, children, statusFilter)) return;
  const isLast = ctx.nextIsLast;
  const branch = isLast ? '└ ' : '├ ';
  const prefix = treePrefix(depth, lastFlags);
  const closed = isTaskFolded(folded, foldKey, defaultFold);
  const counts = todoDoneTotal(phases);
  const stats = counts.total ? `${counts.done}/${counts.total}` : '—';
  const timeW = 8;
  const statsW = 6;
  const lead = prefix + branch;
  const caret = foldCaret(folded, foldKey, defaultFold, phases.length > 0 || childTasks.length > 0);
  const elapsedText = elapsed(task, now);
  const { segs: vendorSegs } = modelIconParts(task.model);
  const buildRowSeg = (summary, summaryWidth) => {
    const summaryStyle = task.terminal ? '90' : '1';
    return [seg(lead, '90'), caret, seg(' '),
      icon(task.status, tick), seg(' '), ...vendorSegs, seg(fit(task.agent, 16), task.terminal ? '90' : '36'), seg(' · '), seg(fit(summary, summaryWidth), summaryStyle),
      seg(' '), seg(fit(stats, statsW, 'right'), '90'), seg(' '), seg(fit(elapsedText, timeW, 'right'), task.terminal ? '90' : '33')];
  };
  const measureSegs = buildRowSeg('', 0);
  const used = measureSegs.reduce((n, s) => n + width(s.text), 0);
  const summaryW = Math.max(10, columns - used);
  const rowSeg = buildRowSeg(task.summary, summaryW);
  rows.push({
    key: foldKey,
    foldKey,
    foldDefault: defaultFold,
    foldToggleTo: width(lead) + width(caret.text),
    parentKey: ctx.parentKey,
    target: { sessionId: session.id, taskId: task.id },
    segments: rowSeg,
    detail: `${task.id} · ${task.agent} · ${task.model ?? 'model ?'} · ${task.status}${task.costUsd ? ` · $${task.costUsd.toFixed(2)}` : ''} · ${task.summary}`,
  });
  if (closed) return;
  const nextFlags = lastFlags.slice();
  nextFlags[depth] = isLast;
  const nextTerminal = ancestorTerminal || task.terminal;
  if (phases.length) {
    appendPhaseRows({ ...ctx, parentKey: foldKey, pendingAfterPhases: childTasks.length > 0, phaseScope: task.id, boldPhase: activePhaseIndex(phases) }, phases, task.id, depth + 1, nextFlags, nextTerminal);
  }
  childTasks.forEach((child, index) => {
    appendSubagentRows({ ...ctx, parentKey: foldKey, nextIsLast: index === childTasks.length - 1 }, child, depth + 1, nextFlags, nextTerminal);
  });
}

function todoView(data, panes, ui, now, columns, tick) {
  const folded = ui.folded ?? new Map();
  const byId = new Map((data.todos ?? []).map(todo => [todo.id, { ...todo, pane: panes?.bySession?.get(todo.id) }]));
  const tasksByRoot = new Map();
  for (const task of data.tasks ?? []) {
    if (!keepTask(task, ui.filter, now)) continue;
    const root = task.rootSessionId ?? task.sessionId ?? 'unknown';
    if (!tasksByRoot.has(root)) tasksByRoot.set(root, []);
    tasksByRoot.get(root).push(task);
  }
  for (const [sessionId, pane] of panes?.bySession ?? []) {
    if (!byId.has(sessionId)) byId.set(sessionId, { id: sessionId, project: pane.title ?? 'omo', name: undefined, phases: [], updatedAt: 0, pane });
  }
  for (const rootId of tasksByRoot.keys()) {
    if (!byId.has(rootId)) {
      const sample = tasksByRoot.get(rootId)[0];
      byId.set(rootId, { id: rootId, project: sample?.project ?? 'omo', name: undefined, phases: [], updatedAt: 0, pane: panes?.bySession?.get(rootId) });
    }
  }
  const all = [...byId.values()];
  const sessionList = all.filter(session => {
    const hasTodos = session.phases?.some(phase => phase.tasks.length);
    const hasSubs = (tasksByRoot.get(session.id)?.length ?? 0) > 0;
    return hasTodos || hasSubs || session.pane;
  });
  const filtered = all.filter(session => {
    const hasTodos = session.phases?.some(phase => phase.tasks.length);
    const hasSubs = (tasksByRoot.get(session.id)?.length ?? 0) > 0;
    if (!hasTodos && !hasSubs) return keepTodoSession(session, ui.filter, now) && session.pane;
    return keepTodoSession(session, ui.filter, now) || hasSubs;
  }).sort(sortTodoSessions);
  let scoped = filtered;
  let current;
  if (ui.scope === 'session') {
    current = all.find(session => session.id === ui.sessionId) ?? filtered.find(session => session.id === ui.sessionId);
    scoped = current ? [current] : [];
  }
  const statusFilter = ui.status ?? 'all';
  const totals = { in_progress: 0, pending: 0, completed: 0, abandoned: 0 };
  for (const session of scoped) {
    const part = countTodoItems(session.phases);
    totals.in_progress += part.in_progress;
    totals.pending += part.pending;
    totals.completed += part.completed;
    totals.abandoned += part.abandoned;
    for (const task of tasksByRoot.get(session.id) ?? []) {
      const sub = countTodoItems(task.todos?.phases);
      totals.in_progress += sub.in_progress;
      totals.pending += sub.pending;
      totals.completed += sub.completed;
      totals.abandoned += sub.abandoned;
    }
  }
  const rows = [];
  const foldKeys = new Set();
  for (const session of scoped) {
    const phases = session.phases ?? [];
    const sessionTasks = tasksByRoot.get(session.id) ?? [];
    const { roots, children } = linkSessionTasks(sessionTasks);
    const hasOwn = phases.some(phase => phase.tasks.length);
    const hasSubs = roots.length > 0;
    if (ui.scope === 'global' && !hasOwn && !hasSubs && !session.pane) continue;
    if (rows.length) rows.push({ segments: [] });
    const active = session.id === ui.activeSessionId;
    const own = todoDoneTotal(phases);
    const subRunning = sessionTasks.filter(task => task.status === 'running').length;
    const headerAt = rows.length;
    rows.push({
      key: `todosession:${session.id}`,
      target: { sessionId: session.id },
      header: true,
      background: active ? ACTIVE_BG : undefined,
      segments: todoSessionHeader(session, now, tick, columns, active, { ownDone: own.done, ownTotal: own.total, subagents: sessionTasks.length || undefined, subRunning: subRunning || undefined }),
      detail: `session ${session.id}${session.pane ? ` · pane ${session.pane.paneId}` : ''}`,
    });
    if (!hasOwn && !hasSubs) {
      if (ui.scope === 'session') rows.push({ segments: [seg('    no todo list in this session', '90')] });
      continue;
    }
    const ctx = { session, rows, ui, now, tick, columns, folded, foldKeys, statusFilter, children, parentKey: `todosession:${session.id}` };
    const top = [];
    if (hasOwn) top.push('phases');
    if (hasSubs) top.push('subs');
    top.forEach((kind, index) => {
      const isLast = index === top.length - 1;
      if (kind === 'phases') {
        appendPhaseRows({ ...ctx, pendingAfterPhases: !isLast && hasSubs, phaseScope: session.id, boldPhase: activePhaseIndex(phases) }, phases, session.id, 0, [], false);
      } else {
        const finishedLimit = ui.scope === 'global' ? 5 : Infinity;
        let finished = 0;
        let hidden = 0;
        const visibleRoots = [];
        for (const task of roots) {
          if (task.terminal && ui.scope === 'global' && ++finished > finishedLimit) {
            hidden += 1;
            continue;
          }
          visibleRoots.push(task);
        }
        const hasMoreRow = hidden > 0;
        visibleRoots.forEach((task, tIndex) => {
          const nextIsLast = isLast && tIndex === visibleRoots.length - 1 && !hasMoreRow;
          appendSubagentRows({ ...ctx, nextIsLast }, task, 0, [], false);
        });
        if (hasMoreRow) {
          rows.push({
            segments: [seg('└ ', '90'), seg(`+${hidden} more finished · s shows this whole session`, '90')],
          });
        }
      }
    });
    const body = rows.slice(headerAt + 1);
    const hasVisibleItems = body.some(row => row.key?.startsWith('todo:'));
    if (!hasVisibleItems && hasOwn && ui.scope === 'session' && statusFilter !== 'all') {
      rows.push({ segments: [seg('    no items match', '90')] });
    }
  }
  const listForCycle = filtered.slice();
  for (const session of sessionList) {
    if (!listForCycle.some(entry => entry.id === session.id)) listForCycle.push(session);
  }
  listForCycle.sort(sortTodoSessions);
  return { rows, sessions: listForCycle, current, totals, foldKeys: [...foldKeys] };
}

function bar(run, size) {
  const total = run.nodes.length || 1;
  const done = run.nodes.filter(node => node.state === 'completed' || node.state === 'skipped').length;
  const failed = run.nodes.filter(node => node.state === 'failed' || node.state === 'cancelled').length;
  const running = run.nodes.filter(node => node.state === 'running').length;
  const cells = n => Math.round((n / total) * size);
  const a = cells(done);
  const b = Math.min(size - a, cells(failed));
  const c = Math.min(size - a - b, Math.max(running ? 1 : 0, cells(running)));
  return [seg('█'.repeat(a), '32'), seg('█'.repeat(b), '31'), seg('█'.repeat(c), '33'), seg('░'.repeat(Math.max(0, size - a - b - c)), '90'),
    seg(` ${done}/${run.nodes.length}`, '90')];
}

function dagRows(run, session, tasksById, columns, now, tick, showSession, active) {
  const rows = [];
  const runStart = Math.min(...run.nodes.map(node => node.startedAt ?? Infinity), run.createdAt || Infinity);
  const runEnd = TERMINAL.has(run.status) ? run.updatedAt : now;
  const head = [seg('⧉ ', '36'), seg(run.name, '1'), seg('  '), icon(run.status, tick), seg(` ${run.status}  `, STATUS[run.status]?.[1] ?? '90'), ...bar(run, 16),
    seg(`  ${Number.isFinite(runStart) ? duration(runEnd - runStart) : ''}`, '90')];
  if (showSession) head.push(seg(`   ${sessionLabel(session)}`, active ? '1;35' : '90'));
  rows.push({ key: `run:${run.id}`, target: { sessionId: session.id }, background: active ? ACTIVE_BG : undefined, segments: head, detail: `${run.name} · ${run.key ?? run.id} · ${run.nodes.length} nodes` });
  const layers = stages(run);
  layers.forEach((layer, index) => {
    const last = index === layers.length - 1;
    rows.push({ segments: [seg(`  ${last ? '└' : '├'}─ `, '90'), seg(`stage ${index + 1}`, '90'), seg(layer.length > 1 ? `  ×${layer.length} parallel` : '', '90')] });
    for (const node of layer) {
      const task = node.taskId ? tasksById.get(node.taskId) : undefined;
      const rail = last ? '     ' : '  │  ';
      const deps = node.deps.length ? ` ← ${node.deps.join(', ')}` : '';
      const idW = Math.min(36, Math.max(14, Math.floor(columns * 0.28)));
      const routeW = columns >= 100 ? 16 : 0;
      const timeW = 9;
      const { segs: vendorSegs, extra: vendorExtra } = task ? modelIconParts(task.model) : { segs: [], extra: 0 };
      const summaryW = Math.max(8, columns - width(rail) - 2 - vendorExtra - idW - 1 - (routeW ? routeW + 1 : 0) - timeW - 2);
      const nodeElapsed = node.startedAt ? duration((node.endedAt ?? (TERMINAL.has(node.state) ? node.startedAt : now)) - node.startedAt) : '';
      const segments = [seg(rail, '90'), icon(node.state, tick), seg(' '), ...vendorSegs, seg(fit(node.id, Math.min(idW, width(node.id))), TERMINAL.has(node.state) ? '' : '1'),
        seg(fit(deps, Math.max(0, idW - width(node.id))), '90'), seg(' '), seg(fit(node.summary, summaryW), TERMINAL.has(node.state) ? '90' : '')];
      if (routeW) segments.push(seg(' '), seg(fit(node.route ?? task?.agent ?? '', routeW), '36'));
      segments.push(seg(' '), seg(fit(node.attempt > 1 ? `#${node.attempt} ${nodeElapsed}` : nodeElapsed, timeW, 'right'), node.state === 'running' ? '33' : '90'));
      rows.push({ key: `node:${run.id}:${node.id}`, target: { sessionId: session.id, taskId: node.taskId }, segments,
        detail: `${node.id} [${node.state}] ${node.summary}${node.taskId ? ` · ${node.taskId}` : ''}${task?.model ? ` · ${task.model}` : ''}` });
      const progress = task && !task.terminal ? progressText(task, now) : null;
      if (progress) rows.push({ segments: [seg(rail, '90'), seg('    └ ', '90'), seg(progress, '2')] });
      if (node.error && (node.state === 'failed' || node.state === 'cancelled')) rows.push({ segments: [seg(rail, '90'), seg('    └ ', '90'), seg(node.error, '31')] });
    }
  });
  return rows;
}

export function buildView(data, panes, ui, now, columns, tick = 0) {
  if (ui.view === 'tasks') return todoView(data, panes, ui, now, columns, tick);
  const all = buildSessions(data, panes, ui.filter, now);
  const sessionList = all.filter(session => session.allTasks || session.runs.length || session.pane);
  let scoped = all;
  let current;
  if (ui.scope === 'session') {
    current = all.find(session => session.id === ui.sessionId);
    scoped = current ? [current] : [];
  }
  const tasksById = new Map(data.tasks.map(task => [task.id, task]));
  const dagByTask = new Map();
  for (const run of data.runs) for (const node of run.nodes) if (node.taskId) dagByTask.set(node.taskId, run.key ?? run.name);
  const rows = [];
  if (ui.view === 'dag') {
    for (const session of scoped) {
      for (const run of session.runs.slice().sort((a, b) => Number(TERMINAL.has(a.status)) - Number(TERMINAL.has(b.status)) || b.updatedAt - a.updatedAt)) {
        if (rows.length) rows.push({ segments: [] });
        rows.push(...dagRows(run, session, tasksById, columns, now, tick, ui.scope === 'global', session.id === ui.activeSessionId));
      }
    }
  } else {
    for (const session of scoped) {
      if (ui.scope === 'global' && !session.tasks.length && !session.pane) continue;
      if (rows.length && (session.tasks.length || !rows[rows.length - 1].header)) rows.push({ segments: [] });
      const active = session.id === ui.activeSessionId;
      rows.push({ key: `session:${session.id}`, target: { sessionId: session.id }, header: true, background: active ? ACTIVE_BG : undefined,
        segments: sessionHeader(session, now, tick, columns, active),
        detail: `session ${session.id}${session.pane ? ` · pane ${session.pane.paneId}` : ''} · ${session.allTasks} subagents total` });
      const ordered = orderTasks(session.tasks);
      const finishedLimit = ui.scope === 'global' ? 5 : Infinity;
      let finished = 0;
      let hidden = 0;
      for (const { task, level } of ordered) {
        if (task.terminal && level === 0 && ++finished > finishedLimit) { hidden += 1; continue; }
        if (task.terminal && level > 0 && finished > finishedLimit) continue;
        rows.push({ key: `task:${task.id}`, target: { sessionId: session.id, taskId: task.id }, segments: taskRow(task, level, columns, now, tick, dagByTask.get(task.id)),
          detail: `${task.id} · ${task.agent} · ${task.model ?? 'model ?'} · ${task.status}${task.costUsd ? ` · $${task.costUsd.toFixed(2)}` : ''} · ${task.summary}` });
        const progress = !task.terminal ? progressText(task, now) : null;
        if (progress) rows.push({ segments: detailRow(level, progress, '2') });
        if (task.status === 'stale') rows.push({ segments: detailRow(level, 'host process is gone; this task will not finish', '33') });
        if (task.error && ['error', 'failed'].includes(task.status)) rows.push({ segments: detailRow(level, task.error, '31') });
      }
      if (hidden) rows.push({ segments: [seg(`    +${hidden} more finished · s shows this whole session`, '90')] });
      if (!session.tasks.length && ui.scope === 'session') rows.push({ segments: [seg('    no subagents match this filter', '90')] });
    }
  }
  return { rows, sessions: sessionList, current, totals: counts(scoped) };
}

export function header(view, ui, now, columns) {
  const scope = ui.scope === 'global'
    ? [seg(' GLOBAL ', '1;7;36', 'scope')]
    : [seg(' SESSION ', '1;7;35', 'scope'), seg(` ${view.current ? fit(ui.view === 'tasks' ? todoSessionLabel(view.current) : sessionLabel(view.current), Math.min(width(ui.view === 'tasks' ? todoSessionLabel(view.current) : sessionLabel(view.current)), Math.max(12, columns - 64))) : 'none selected'}`, '35', 'scope')];
  const tab = (name, id) => seg(` ${name} `, ui.view === id ? '1;7' : '90', `view:${id}`);
  if (ui.view === 'tasks') {
    const t = view.totals;
    const left = [seg(' OmO Tasks ', '1'), seg(' '), ...scope, seg('  '), tab('Agents', 'agents'), tab('DAG', 'dag'), tab('Tasks', 'tasks'), seg('  '),
      seg(`filter:${ui.filter}`, '90', 'filter'), seg('  '), seg(`status:${ui.status ?? 'all'}`, '90', 'status')];
    const right = [seg(`◐ ${t.in_progress} in progress`, t.in_progress ? '1;33' : '90'), seg('  '), seg(`○ ${t.pending} todo`, '90'), seg('  '),
      seg(`✔ ${t.completed} done`, '32'), seg('  '), seg(`⊘ ${t.abandoned}`, '90'), seg(`  ${new Date(now).toTimeString().slice(0, 8)} `, '90')];
    const compact = [seg(`◐${t.in_progress}`, t.in_progress ? '1;33' : '90'), seg(` ○${t.pending}`, '90'), seg(` ✔${t.completed}`, '32'), seg(` ⊘${t.abandoned} `, '90')];
    const leftW = left.reduce((sum, part) => sum + width(part.text), 0);
    const fits = parts => leftW + parts.reduce((sum, part) => sum + width(part.text), 0) + 1 <= columns;
    const chosen = fits(right) ? right : fits(compact) ? compact : null;
    const rightW = chosen ? chosen.reduce((sum, part) => sum + width(part.text), 0) : 0;
    const line = chosen ? [...left, seg(' '.repeat(Math.max(0, columns - leftW - rightW))), ...chosen] : left;
    return [line, [seg('─'.repeat(columns), '90')]];
  }
  const t = view.totals;
  const left = [seg(' OmO Agents ', '1'), seg(' '), ...scope, seg('  '), tab('Agents', 'agents'), tab('DAG', 'dag'), tab('Tasks', 'tasks'), seg('  '), seg(`filter:${ui.filter}`, '90', 'filter')];
  const right = [seg(`${SPINNER[0]} ${t.running} running`, t.running ? '33' : '90'), seg('  '), seg(`○ ${t.waiting}`, '90'), seg('  '),
    seg(`✔ ${t.completed}`, '32'), seg('  '), seg(`✖ ${t.failed}`, t.failed ? '31' : '90'), seg(`  ${new Date(now).toTimeString().slice(0, 8)} `, '90')];
  const compact = [seg(`${SPINNER[0]}${t.running}`, t.running ? '33' : '90'), seg(` ✔${t.completed}`, '32'), seg(` ✖${t.failed} `, t.failed ? '31' : '90')];
  const leftW = left.reduce((sum, part) => sum + width(part.text), 0);
  const fits = parts => leftW + parts.reduce((sum, part) => sum + width(part.text), 0) + 1 <= columns;
  const chosen = fits(right) ? right : fits(compact) ? compact : null;
  const rightW = chosen ? chosen.reduce((sum, part) => sum + width(part.text), 0) : 0;
  const line = chosen ? [...left, seg(' '.repeat(Math.max(0, columns - leftW - rightW))), ...chosen] : left;
  return [line, [seg('─'.repeat(columns), '90')]];
}

export const HINTS = 'click select · click again/⏎ live output  p pane  O split  g scope  s session  v view  a filter  [ ]  j/k  q quit';
const SHORT_HINTS = 'click  ⏎ live  p pane  O split  g scope  v view  a filter  [ ]  j/k  q quit';
const TASKS_HINTS = 'click  ⏎ live  p pane  O split  ▸ fold  g scope  v view  a/f filter  Space  z/Z  [ ]  j/k  q quit';
const TASKS_SHORT_HINTS = 'click  ⏎ live  p pane  ▸ fold  g scope  v view  a/f  Space  z/Z  [ ]  j/k  q quit';

export function footer(selected, columns, message, ui) {
  const hints = ui?.view === 'tasks'
    ? (width(TASKS_HINTS) <= columns ? TASKS_HINTS : TASKS_SHORT_HINTS)
    : (width(HINTS) <= columns ? HINTS : SHORT_HINTS);
  return [[seg('─'.repeat(columns), '90')], [seg(message ?? selected?.detail ?? '', message ? '33' : '')], [seg(hints, '90')]];
}

export function emptyRows(ui) {
  if (ui.scope === 'session' && !ui.sessionId) return [[seg('  No OmO session found for this pane. Press [ or ] to pick one, or g for global.', '90')]];
  if (ui.view === 'tasks') {
    const widen = ui.filter === 'all' ? '' : 'Press a to widen the filter';
    const global = ui.scope === 'session' ? 'g for global' : '';
    const hint = [widen, global].filter(Boolean).join(', ');
    return [[seg(`  No todo lists in this scope with filter "${ui.filter}" / status "${ui.status ?? 'all'}".${hint ? ` ${hint[0].toUpperCase()}${hint.slice(1)}.` : ''}`, '90')]];
  }
  const what = ui.view === 'dag' ? 'DAG runs' : 'subagents';
  const widen = ui.filter === 'all' ? '' : 'Press a to widen the filter';
  const global = ui.scope === 'session' ? 'g for global' : '';
  const hint = [widen, global].filter(Boolean).join(', ');
  return [[seg(`  No ${what} in this scope with filter "${ui.filter}".${hint ? ` ${hint[0].toUpperCase()}${hint.slice(1)}.` : ''}`, '90')]];
}

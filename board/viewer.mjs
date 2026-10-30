import { homedir } from 'node:os';
import { toolArgument, transcriptFile } from './data.mjs';
import { agentGlyph, contextFillStyle, duration, fit, formatTokenCount, icon, modelVendor, paint, seg, vendorColor, width, wrap } from './render.mjs';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const VIEWER_HINTS = 'j/k scroll  PgUp/PgDn  g/G top/bottom  t thinking  e expand  p pane  O split  Esc back';
const VIEWER_SHORT = 'j/k  g/G  t/e  p/O  Esc back';
const STANDALONE_HINTS = 'j/k scroll  PgUp/PgDn  g/G  t thinking  e expand  p pane  q quit';
const STANDALONE_SHORT = 'j/k  g/G  t/e  p  q quit';

const shortModel = model => (model ? model.split('/').pop() : '');
const elapsed = (task, now) => (task.startedAt ? duration((task.endedAt ?? now) - task.startedAt) : '');

function displayPath(path) {
  if (!path) return '';
  return path.replaceAll(homedir(), '~');
}

function viewerContextLabel(task) {
  const m = task.metrics;
  if (!m) return undefined;
  if (m.contextPct !== undefined && m.contextWindow && m.contextTokens !== undefined) {
    return { text: `ctx ${m.contextPct}% (${formatTokenCount(m.contextTokens)}/${formatTokenCount(m.contextWindow)})`, style: contextFillStyle(m.contextPct) };
  }
  if (m.contextPct !== undefined && m.contextWindow) return { text: `ctx ${m.contextPct}%`, style: contextFillStyle(m.contextPct) };
  if (m.contextTokens !== undefined) return { text: `ctx ${formatTokenCount(m.contextTokens)}`, style: '90' };
  return undefined;
}

function viewerPendingLabel(task, now) {
  const pending = task.metrics?.pending;
  if (!pending?.since || task.terminal) return undefined;
  const elapsedMs = now - pending.since;
  if (pending.kind === 'model') return { text: `⏳ model ${duration(elapsedMs)}`, style: '33' };
  return { text: `⚒ ${pending.name} ${duration(elapsedMs)}`, style: '33' };
}

function headerLine(task, columns, now, tick, following) {
  const back = seg('◂ back', '36', 'back');
  const vendor = modelVendor(task.model) ?? 'default';
  const vGlyph = agentGlyph(vendor);
  const vendorExtra = vGlyph ? width(vGlyph) + 1 : 0;
  const left = [back, seg(' '), icon(task.status, tick), seg(' ')];
  if (vGlyph) left.push(seg(`${vGlyph} `, vendorColor(vendor)));
  left.push(seg(task.agent, task.terminal ? '90' : '36'), seg(' · '));
  const stats = [task.turns !== undefined ? `t${task.turns}` : '', task.toolCalls !== undefined ? `⚒${task.toolCalls}` : ''].filter(Boolean).join(' ');
  const ctx = viewerContextLabel(task);
  const errors = task.metrics?.toolErrors > 0 ? `✖${task.metrics.toolErrors} failed` : undefined;
  const pending = viewerPendingLabel(task, now);
  const followParts = [];
  if (pending) followParts.push(pending.text);
  if (following) followParts.push('● following');
  const rightMeta = [
    shortModel(task.model),
    elapsed(task, now),
    stats,
    ctx?.text,
    errors,
    followParts.length ? followParts.join('  ') : '',
  ].filter(Boolean);
  const rightSegments = [];
  rightMeta.forEach((part, index) => {
    if (index) rightSegments.push(seg('  ', '90'));
    if (ctx && part === ctx.text) rightSegments.push(seg(part, ctx.style));
    else if (pending && part === pending.text) rightSegments.push(seg(part, pending.style));
    else if (errors && part === errors) rightSegments.push(seg(part, '31'));
    else if (part.includes('● following')) {
      const before = part.replace(/\s*● following$/, '').trim();
      if (before) rightSegments.push(seg(before, '33'));
      rightSegments.push(seg('  ', '90'));
      rightSegments.push(seg('● following', '90'));
    } else rightSegments.push(seg(part, '90'));
  });
  const rightText = rightMeta.join('  ');
  const rightW = rightSegments.reduce((n, part) => n + width(part.text), 0) || width(rightText);
  const fixed = width(back.text) + 1 + 2 + 1 + vendorExtra + 16 + 3;
  const summaryW = Math.max(8, columns - fixed - rightW - 2);
  left.push(seg(fit(task.summary, summaryW), task.terminal ? '90' : '1'));
  const leftW = left.reduce((n, part) => n + width(part.text), 0);
  const line = [...left, seg(' '.repeat(Math.max(1, columns - leftW - rightW)), ''), ...(rightSegments.length ? rightSegments : [seg(rightText, '90')])];
  return [line, [seg('─'.repeat(columns), '90')]];
}

function footerLines(columns, transcriptPath, standalone) {
  const hints = standalone
    ? (width(STANDALONE_HINTS) <= columns ? STANDALONE_HINTS : STANDALONE_SHORT)
    : (width(VIEWER_HINTS) <= columns ? VIEWER_HINTS : VIEWER_SHORT);
  const pathText = displayPath(transcriptPath);
  return [[seg('─'.repeat(columns), '90')], [seg(pathText ? `${pathText}, ~ for home` : '', '90')], [seg(hints, '90')]];
}

function buildBodyLines(entries, task, columns, { showThinking, expand }, tick, now) {
  if (!entries.length && !task.transcript) {
    return [[seg(`  No transcript for ${task.id} yet.`, '90')]];
  }
  if (!entries.length) return [[seg(`  No transcript for ${task.id} yet.`, '90')]];

  const lines = [];
  let userIndex = 0;
  for (const entry of entries) {
    if (entry.kind === 'user') {
      lines.push([]);
      userIndex += 1;
      const prefix = seg('▌ ', '36');
      const prefixW = width(prefix.text);
      const wrapped = wrap(entry.text, Math.max(1, columns - prefixW));
      const limit = userIndex === 1 && !expand ? 8 : wrapped.length;
      const shown = wrapped.slice(0, limit);
      shown.forEach((text, index) => {
        lines.push(index === 0 ? [prefix, seg(text)] : [seg(' '.repeat(prefixW)), seg(text)]);
      });
      if (userIndex === 1 && !expand && wrapped.length > 8) {
        lines.push([seg(`  … +${wrapped.length - 8} lines (e expands)`, '90')]);
      }
      continue;
    }
    if (entry.kind === 'thinking') {
      const prefix = seg('∴ ', '2');
      const prefixW = width(prefix.text);
      const wrapped = wrap(entry.text, Math.max(1, columns - prefixW));
      const limit = showThinking ? wrapped.length : Math.min(2, wrapped.length);
      wrapped.slice(0, limit).forEach((text, index) => {
        lines.push(index === 0 ? [prefix, seg(text, '2')] : [seg(' '.repeat(prefixW)), seg(text, '2')]);
      });
      if (!showThinking && wrapped.length > 2) lines.push([seg('  … thinking (t shows)', '90')]);
      continue;
    }
    if (entry.kind === 'text') {
      lines.push([]);
      const prefix = seg('● ', '');
      const prefixW = width(prefix.text);
      wrap(entry.text, Math.max(1, columns - prefixW)).forEach((text, index) => {
        lines.push(index === 0 ? [prefix, seg(text)] : [seg(' '.repeat(prefixW)), seg(text)]);
      });
      continue;
    }
    if (entry.kind === 'tool') {
      const lead = `⚒ ${entry.name} `;
      const summaryW = Math.max(1, columns - width(lead));
      const summary = fit(toolArgument(entry.args ?? {}, summaryW) || entry.summary || '', summaryW).trimEnd();
      lines.push([seg(`${lead}${summary}`, '36')]);
      const branch = seg('  └ ', '90');
      const branchW = width(branch.text);
      if (entry.result) {
        const style = entry.result.isError ? '31' : '2';
        const wrapped = wrap(entry.result.text, Math.max(1, columns - branchW));
        const limit = expand ? Math.min(60, wrapped.length) : Math.min(3, wrapped.length);
        wrapped.slice(0, limit).forEach((text, index) => {
          lines.push(index === 0 ? [branch, seg(text, style)] : [seg(' '.repeat(branchW)), seg(text, style)]);
        });
        const max = expand ? 60 : 3;
        if (wrapped.length > max) lines.push([seg(`  … +${wrapped.length - max} lines`, '90')]);
      } else if (!task.terminal) {
        const spin = SPINNER[tick % SPINNER.length];
        lines.push([branch, seg(`${spin} running…`, '33')]);
      }
      continue;
    }
    if (entry.kind === 'result') {
      const branch = seg('  └ ', '90');
      const branchW = width(branch.text);
      const style = entry.isError ? '31' : '2';
      wrap(`${entry.name}: ${entry.text}`, Math.max(1, columns - branchW)).forEach((text, index) => {
        lines.push(index === 0 ? [branch, seg(text, style)] : [seg(' '.repeat(branchW)), seg(text, style)]);
      });
    }
  }

  if (task.terminal) {
    lines.push([seg(`── ${task.status} after ${elapsed(task, now)} ──`, '90')]);
    if (task.error) lines.push([seg(task.error, '31')]);
  }
  return lines;
}

export class Viewer {
  constructor(store, task, { standalone = false } = {}) {
    this.store = store;
    this.taskId = task.id;
    this.task = task;
    this.standalone = standalone;
    this.scroll = 0;
    this.following = true;
    this.showThinking = false;
    this.expand = false;
    this.entries = [];
    this.transcriptPath = null;
    this.bodyLines = [];
    this.layout = { hits: [], bodyStart: 0 };
  }

  refresh() {
    const loaded = this.store.load();
    let task = loaded.tasks.find(item => item.id === this.taskId) ?? this.task;
    if (!task.metrics) this.store.attachTaskMetrics(task);
    this.task = task;
    const result = this.store.transcript(task.transcript);
    this.entries = result.entries;
    this.transcriptPath = result.file ?? transcriptFile(task.transcript);
  }

  rebuildBody(columns, tick, now) {
    this.bodyLines = buildBodyLines(this.entries, this.task, columns, {
      showThinking: this.showThinking,
      expand: this.expand,
    }, tick, now);
  }

  syncScroll(bodyHeight) {
    const maxScroll = Math.max(0, this.bodyLines.length - bodyHeight);
    if (this.following) this.scroll = maxScroll;
    else this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
  }

  scrollBy(delta, pageSize) {
    const maxScroll = Math.max(0, this.bodyLines.length - pageSize);
    const next = Math.max(0, Math.min(maxScroll, this.scroll + delta));
    if (next < maxScroll) this.following = false;
    if (next >= maxScroll) this.following = true;
    this.scroll = next;
  }

  frame(columns, rows, tick, { color = true } = {}) {
    const now = Date.now();
    this.rebuildBody(columns, tick, now);
    const top = headerLine(this.task, columns, now, tick, this.following);
    const bottom = footerLines(columns, this.transcriptPath, this.standalone);
    const bodyHeight = Math.max(1, rows - top.length - bottom.length);
    this.syncScroll(bodyHeight);
    const visible = this.bodyLines.slice(this.scroll, this.scroll + bodyHeight);
    const lines = top.map(segments => paint(segments, columns, { color }));
    const hits = [];
    let x = 1;
    for (const part of top[0]) {
      const w = width(part.text);
      if (part.action) hits.push({ from: x, to: x + w, action: part.action });
      x += w;
    }
    this.layout = { hits, bodyStart: top.length + 1, bodyHeight };
    visible.forEach(segments => lines.push(paint(segments, columns, { color })));
    while (lines.length < rows - bottom.length) lines.push(' '.repeat(columns));
    lines.push(...bottom.map(segments => paint(segments, columns, { color })));
    return lines;
  }

  click(x, y) {
    if (y === 1) {
      const hit = this.layout.hits.find(entry => x >= entry.from && x < entry.to);
      if (hit?.action === 'back') return 'back';
    }
    return undefined;
  }

  key(key, pageSize) {
    if (key === 'j' || key === '\x1b[B' || key === '\x1bOB') this.scrollBy(1, pageSize);
    else if (key === 'k' || key === '\x1b[A' || key === '\x1bOA') this.scrollBy(-1, pageSize);
    else if (key === '\x1b[6~' || key === ' ') this.scrollBy(pageSize, pageSize);
    else if (key === '\x1b[5~') this.scrollBy(-pageSize, pageSize);
    else if (key === 'g') { this.scroll = 0; this.following = false; }
    else if (key === 'G') { this.following = true; this.scroll = 1e9; }
    else if (key === 't') this.showThinking = !this.showThinking;
    else if (key === 'e') this.expand = !this.expand;
    else if (key === 'p') return 'pane';
    else if (key === 'O') return 'split';
    else if (key === '\x7f' || key === '\x08' || key === 'h' || key === '\x1b[D' || key === '\x1bOD') return this.standalone ? 'quit' : 'back';
    else if (key === 'q' || key === '\x1b') return this.standalone ? 'quit' : 'back';
    else return undefined;
  }

  wheel(delta, pageSize) {
    this.scrollBy(delta, pageSize);
  }
}

import { duration, fit, seg, width } from '../board/render.mjs';

export const FILTERS = ['open', 'recent', 'all'];
export const ROLE_FILTERS = ['any', 'opened', 'committed', 'commented'];
// Seconds between automatic refreshes; 120 is the default.
export const REFRESH_INTERVALS = [30, 60, 120, 300];

const DAY = 24 * 60 * 60 * 1000;
const RECENT_MS = 30 * DAY;

export const STATE = {
  open: ['●', '32', 'open'],
  draft: ['○', '90', 'draft'],
  merged: ['◆', '35', 'merged'],
  closed: ['✖', '31', 'closed'],
};

// Fixed role column: one slot per role so the badges line up across rows.
const ROLE_BADGES = [['opened', 'O', '36'], ['committed', 'C', '33'], ['commented', '✎', '34'], ['reviewed', 'R', '35']];

const CHECKS = {
  SUCCESS: ['✔', '32'], FAILURE: ['✖', '31'], ERROR: ['✖', '31'],
  PENDING: ['●', '33'], EXPECTED: ['●', '33'],
};

// Glyphs for one check (job, status) or a group of them; states come from data.mjs checkState().
export const CHECK_GLYPH = {
  success: ['✔', '32'], failure: ['✖', '31'], pending: ['●', '33'], cancelled: ['⊘', '90'], skipped: ['↷', '90'],
};

const REVIEW = {
  APPROVED: ['approved', '32'],
  CHANGES_REQUESTED: ['changes', '31'],
  REVIEW_REQUIRED: ['review', '33'],
};

export function ago(now, at) {
  if (!at) return '';
  return duration(Math.max(0, now - at)).replace(/^(\d+[a-z]).*/, '$1');
}

export function keepPr(pr, ui, now) {
  if (ui.filter === 'open' && !(pr.state === 'open' || pr.state === 'draft')) return false;
  if (ui.filter === 'recent' && !(pr.updatedAt && now - pr.updatedAt <= RECENT_MS)) return false;
  if (ui.role === 'commented') return pr.roles.has('commented') || pr.roles.has('reviewed');
  if (ui.role && ui.role !== 'any') return pr.roles.has(ui.role);
  return true;
}

function roleSegs(roles) {
  return ROLE_BADGES.map(([role, letter, color]) => (roles.has(role) ? seg(letter, color) : seg('·', '90')));
}

const CI_WIDTH = 7;

/** "✔ 6/6": passed out of the checks that matter; the glyph says whether any failed or are still running. */
export function ciText(pr) {
  const ci = pr.ci;
  if (!ci?.relevant) {
    const [glyph, color] = CHECKS[pr.checks] ?? [' ', ''];
    return seg(fit(glyph, CI_WIDTH), color);
  }
  const [glyph, color] = ci.failed ? CHECK_GLYPH.failure : ci.pending ? CHECK_GLYPH.pending : CHECK_GLYPH.success;
  return seg(fit(`${glyph} ${ci.passed}/${ci.relevant}`, CI_WIDTH), color);
}

export const hasChecks = pr => Boolean(pr.checks || pr.ci?.relevant);

function prRow(pr, data, ui, now, columns) {
  const [glyph, color] = STATE[pr.state] ?? ['?', '90'];
  const number = `#${pr.number}`;
  const author = !pr.author ? '' : pr.author === data.login ? 'you' : pr.author;
  // "review required" is noise once a PR is merged or closed; approved / changes requested stay informative.
  const pendingReview = pr.review === 'REVIEW_REQUIRED' && (pr.state === 'merged' || pr.state === 'closed');
  const [review, reviewColor] = pendingReview ? ['', ''] : REVIEW[pr.review] ?? ['', ''];
  const age = ago(now, pr.updatedAt);
  const foldable = hasChecks(pr);
  const marker = !foldable ? ' ' : ui.expanded?.has(pr.url) ? '▾' : '▸';
  // prefix: " ▸ ● #1234 " · suffix: " OC✎R  author  ✔ 12/12 approved  12d"
  const numberWidth = 6;
  const authorWidth = Math.min(18, Math.max(3, Math.floor(columns / 8)));
  const prefix = 5 + numberWidth + 1;
  const suffix = 1 + 4 + 2 + authorWidth + 2 + CI_WIDTH + 1 + 8 + 2 + 4;
  const titleWidth = Math.max(8, columns - prefix - suffix);
  return {
    key: pr.url,
    target: { url: pr.url },
    foldable,
    segments: [
      seg(' '), seg(marker, '90'), seg(' '), seg(glyph, color), seg(' '),
      seg(fit(number, numberWidth), color), seg(' '),
      seg(fit(pr.title, titleWidth), pr.state === 'merged' || pr.state === 'closed' ? '90' : ''),
      seg(' '), ...roleSegs(pr.roles), seg('  '),
      seg(fit(author, authorWidth), author === 'you' ? '36' : '90'), seg('  '),
      ciText(pr), seg(' '),
      seg(fit(review, 8), reviewColor), seg('  '),
      seg(fit(age, 4, 'right'), '90'),
    ],
  };
}

function took(item, now) {
  if (!item.startedAt) return '';
  const end = item.completedAt ?? (item.state === 'pending' ? now : undefined);
  return end ? duration(Math.max(0, end - item.startedAt)) : '';
}

/** Rows under an expanded PR: one per check group, its jobs beneath, skipped jobs folded into one summary row. */
export function checkRows(pr, entry, now, columns) {
  const parentKey = pr.url;
  const note = (text, style) => [{ key: `${pr.url}#note`, parentKey, target: {}, segments: [seg('      '), seg(text, style)] }];
  if (!entry || (entry.loading && !entry.groups)) return note('⟳ loading checks…', '90');
  if (entry.error && !entry.groups) return note(`⚠ ${entry.error}`, '31');
  if (!entry.groups.length) return note('no checks on the last commit', '90');
  const rows = [];
  const line = (key, target, indent, state, name, nameStyle, middle, right) => {
    const [glyph, color] = CHECK_GLYPH[state] ?? CHECK_GLYPH.pending;
    const nameWidth = Math.max(8, columns - indent - 2 - 1 - 12 - 1 - 8);
    rows.push({
      key, parentKey, target,
      segments: [seg(' '.repeat(indent)), seg(glyph, color), seg(' '), seg(fit(name, nameWidth), nameStyle), seg(' '), seg(fit(middle, 12), '90'), seg(' '), seg(fit(right, 8, 'right'), '90')],
    });
  };
  for (const group of entry.groups) {
    const failed = group.jobs.filter(job => job.state === 'failure' || job.state === 'cancelled').length;
    const unit = group.kind === 'status' ? ['status', 'statuses'] : ['job', 'jobs'];
    const count = `${group.jobs.length} ${unit[group.jobs.length === 1 ? 0 : 1]}`;
    line(`${pr.url}#${group.key}`, { url: group.url }, 6, group.state, group.name, '1', failed ? `${failed} failed` : count, took(group, now));
    const skipped = group.jobs.filter(job => job.state === 'skipped');
    group.jobs.forEach((job, index) => {
      if (job.state === 'skipped') return;
      line(`${pr.url}#${group.key}#${index}`, { url: job.url }, 8, job.state, job.name, '', job.description ?? '', took(job, now));
    });
    if (skipped.length) line(`${pr.url}#${group.key}#skipped`, {}, 8, 'skipped', `${skipped.length} skipped: ${skipped.map(job => job.name).join(', ')}`, '90', '', '');
  }
  return rows;
}

/** Rows grouped by repository; repos ordered by their most recently updated PR. */
export function buildRows(data, ui, now, columns) {
  const prs = (data.prs ?? []).filter(pr => keepPr(pr, ui, now));
  const byRepo = new Map();
  for (const pr of prs) {
    if (!byRepo.has(pr.repo)) byRepo.set(pr.repo, []);
    byRepo.get(pr.repo).push(pr);
  }
  const groups = [...byRepo.entries()]
    .map(([repo, list]) => [repo, list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))])
    .sort((a, b) => (b[1][0].updatedAt ?? 0) - (a[1][0].updatedAt ?? 0));
  const rows = [];
  for (const [repo, list] of groups) {
    const open = list.filter(pr => pr.state === 'open' || pr.state === 'draft').length;
    rows.push({ segments: [seg('▍', '35'), seg(repo, '1'), seg(`  ${list.length} PR${list.length === 1 ? '' : 's'}${open && open !== list.length ? ` · ${open} open` : ''}`, '90')] });
    for (const pr of list) {
      rows.push(prRow(pr, data, ui, now, columns));
      if (ui.expanded?.has(pr.url) && hasChecks(pr)) rows.push(...checkRows(pr, ui.checks?.get(pr.url), now, columns));
    }
  }
  return { rows, count: prs.length };
}

export function header(data, ui, view, now, columns) {
  const counts = { open: 0, draft: 0, merged: 0, closed: 0 };
  for (const pr of data.prs ?? []) if (keepPr(pr, ui, now)) counts[pr.state] += 1;
  const stats = [];
  for (const state of ['open', 'draft', 'merged', 'closed']) {
    if (!counts[state]) continue;
    const [glyph, color] = STATE[state];
    stats.push(seg(` ${glyph}${counts[state]}`, color));
  }
  const status = data.loading ? ' ⟳ loading' : data.fetchedAt ? ` ${ago(now, data.fetchedAt) || '0s'} ago` : '';
  // No board title: the herdr pane label already says "GitHub PRs".
  const left = [
    seg(data.login ? ` @${data.login}   ` : ' ', '36'),
    seg(`filter:${ui.filter}`, '1', 'filter'),
    seg('   '),
    seg(`role:${ui.role}`, '1', 'role'),
    seg('   '),
    seg(`refresh:${ui.refresh}s`, '1', 'refresh'),
  ];
  const right = [...stats, seg(status, data.loading ? '33' : '90')];
  const gap = Math.max(1, columns - left.reduce((sum, part) => sum + width(part.text), 0) - right.reduce((sum, part) => sum + width(part.text), 0) - 1);
  return [[...left, seg(' '.repeat(gap)), ...right], [seg('─'.repeat(columns), '90')]];
}

export const HINTS = 'click select · click again/⏎ open  l/→ checks  h/← back  f filter  m role  t timer  r refresh  j/k  q quit   O opened C committed ✎ commented R reviewed';

export function footer(selected, data, columns, message) {
  const detail = message
    ? seg(message, '33')
    : data.errors?.length ? seg(`⚠ ${data.errors.join(' · ')}`, '31')
      : seg(selected?.target?.url ?? '', '36');
  return [[seg('─'.repeat(columns), '90')], [seg(' '), detail], [seg(` ${HINTS}`, '90')]];
}

/** One notification per kind of change; several PRs in one refresh are batched. */
export function notifications(events) {
  const out = [];
  for (const [kind, one, many] of [['new', 'New PR', 'new PRs'], ['approved', 'PR approved', 'PRs approved']]) {
    const prs = events.filter(event => event.kind === kind).map(event => event.pr);
    if (!prs.length) continue;
    const line = pr => `${pr.repo}#${pr.number} ${pr.title}${kind === 'new' && pr.author ? ` (${pr.author})` : ''}`;
    const more = prs.length > 3 ? [`+${prs.length - 3} more`] : [];
    out.push({ title: prs.length === 1 ? one : `${prs.length} ${many}`, body: [...prs.slice(0, 3).map(line), ...more].join('\n') });
  }
  return out;
}

export function emptyRows(data, ui) {
  if (data.loading && !data.fetchedAt) return [[seg('  Loading pull requests from GitHub…', '90')]];
  if (data.errors?.length && !data.prs?.length) return [[seg(`  ${data.errors[0]}`, '31')]];
  const which = ui.role === 'any' ? '' : ` you ${ui.role}`;
  return [[seg(`  No ${ui.filter === 'all' ? '' : `${ui.filter} `}pull requests${which}. Press f to change the filter.`, '90')]];
}

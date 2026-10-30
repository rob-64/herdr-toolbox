import { duration, fit, seg, width } from '../board/render.mjs';

export const FILTERS = ['open', 'recent', 'all'];
export const ROLE_FILTERS = ['any', 'opened', 'committed', 'commented'];

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

function prRow(pr, data, now, columns) {
  const [glyph, color] = STATE[pr.state] ?? ['?', '90'];
  const number = `#${pr.number}`;
  const author = !pr.author ? '' : pr.author === data.login ? 'you' : pr.author;
  const [checkGlyph, checkColor] = CHECKS[pr.checks] ?? [' ', ''];
  // "review required" is noise once a PR is merged or closed; approved / changes requested stay informative.
  const pendingReview = pr.review === 'REVIEW_REQUIRED' && (pr.state === 'merged' || pr.state === 'closed');
  const [review, reviewColor] = pendingReview ? ['', ''] : REVIEW[pr.review] ?? ['', ''];
  const age = ago(now, pr.updatedAt);
  // prefix: "  ● #1234  " · suffix: " OC✎R  author  ✔ approved  12d"
  const numberWidth = 6;
  const authorWidth = Math.min(18, Math.max(3, Math.floor(columns / 8)));
  const prefix = 4 + numberWidth + 1;
  const suffix = 1 + 4 + 2 + authorWidth + 2 + 1 + 1 + 8 + 2 + 4;
  const titleWidth = Math.max(8, columns - prefix - suffix);
  return {
    key: pr.url,
    target: { url: pr.url },
    segments: [
      seg('  '), seg(glyph, color), seg(' '),
      seg(fit(number, numberWidth), color), seg(' '),
      seg(fit(pr.title, titleWidth), pr.state === 'merged' || pr.state === 'closed' ? '90' : ''),
      seg(' '), ...roleSegs(pr.roles), seg('  '),
      seg(fit(author, authorWidth), author === 'you' ? '36' : '90'), seg('  '),
      seg(checkGlyph, checkColor), seg(' '),
      seg(fit(review, 8), reviewColor), seg('  '),
      seg(fit(age, 4, 'right'), '90'),
    ],
  };
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
    for (const pr of list) rows.push(prRow(pr, data, now, columns));
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
  const left = [
    seg(' GitHub PRs ', '1;30;45'),
    seg(data.login ? ` @${data.login}` : '', '36'),
    seg('   '),
    seg(`filter:${ui.filter}`, '1', 'filter'),
    seg('   '),
    seg(`role:${ui.role}`, '1', 'role'),
  ];
  const right = [...stats, seg(status, data.loading ? '33' : '90')];
  const gap = Math.max(1, columns - left.reduce((sum, part) => sum + width(part.text), 0) - right.reduce((sum, part) => sum + width(part.text), 0) - 1);
  return [[...left, seg(' '.repeat(gap)), ...right], [seg('─'.repeat(columns), '90')]];
}

export const HINTS = 'click select · click again/⏎ open in browser  f filter  m role  r refresh  j/k  q quit   O opened C committed ✎ commented R reviewed';

export function footer(selected, data, columns, message) {
  const detail = message
    ? seg(message, '33')
    : data.errors?.length ? seg(`⚠ ${data.errors.join(' · ')}`, '31')
      : seg(selected?.target?.url ?? '', '36');
  return [[seg('─'.repeat(columns), '90')], [seg(' '), detail], [seg(` ${HINTS}`, '90')]];
}

export function emptyRows(data, ui) {
  if (data.loading && !data.fetchedAt) return [[seg('  Loading pull requests from GitHub…', '90')]];
  if (data.errors?.length && !data.prs?.length) return [[seg(`  ${data.errors[0]}`, '31')]];
  const which = ui.role === 'any' ? '' : ` you ${ui.role}`;
  return [[seg(`  No ${ui.filter === 'all' ? '' : `${ui.filter} `}pull requests${which}. Press f to change the filter.`, '90')]];
}

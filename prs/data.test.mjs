import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterQualifier, mergePrs, normalizePr, prChanges, PrStore, pushedBranches } from './data.mjs';

const now = Date.parse('2026-10-30T12:00:00.000Z');
const LOGIN = 'me';

const pr = (number, extra = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/app/pull/${number}`,
  state: 'OPEN',
  isDraft: false,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: `2026-10-${String(10 + number).padStart(2, '0')}T00:00:00Z`,
  repository: { nameWithOwner: 'acme/app' },
  author: { login: 'alice' },
  reviewDecision: 'REVIEW_REQUIRED',
  comments: { totalCount: 1 },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...extra,
});

const ok = value => ({ ok: true, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });
const fail = stderr => ({ ok: false, stdout: '', stderr });

/** Fake `gh`: answers by the qualifier in the search query, the endpoint, or the aliases in a GraphQL query. */
function fakeGh(overrides = {}) {
  const calls = [];
  const run = async args => {
    calls.push(args);
    const text = args.join(' ');
    if (text.startsWith('api user')) return overrides.user ?? ok(`${LOGIN}\n`);
    if (text.includes('/events')) return overrides.events ?? ok('acme/app\trefs/heads/fix-x\nacme/app\trefs/heads/fix-x\nacme/app\trefs/tags/v1\n');
    if (text.includes('search/commits')) return overrides.commits ?? ok({ items: [{ repository: { full_name: 'acme/app' }, sha: 'a'.repeat(40) }] });
    if (text.includes(`author:${LOGIN}`)) return overrides.opened ?? ok({ data: { search: { nodes: [pr(1, { author: { login: LOGIN } })] } } });
    if (text.includes(`commenter:${LOGIN}`)) return overrides.commented ?? ok({ data: { search: { nodes: [pr(2), pr(3)] } } });
    if (text.includes(`reviewed-by:${LOGIN}`)) return overrides.reviewed ?? ok({ data: { search: { nodes: [pr(3)] } } });
    if (text.includes(': repository(')) {
      if (overrides.committed) return overrides.committed;
      const answers = {
        b0: { pullRequests: { nodes: [pr(2)] } },
        c0: { object: { associatedPullRequests: { nodes: [pr(4, { state: 'MERGED', author: { login: LOGIN } })] } } },
      };
      return ok({ data: Object.fromEntries(Object.entries(answers).filter(([alias]) => text.includes(`${alias}: repository(`))) });
    }
    return fail(`unexpected gh call: ${text}`);
  };
  return { run, calls };
}

test('prChanges reports open PRs others opened that are new, and approvals on PRs you opened or committed to', () => {
  const seen = new Map();
  const load = (...raws) => mergePrs(raws.map(([role, raw]) => ({ role, nodes: [raw] })), LOGIN);
  const changes = prs => prChanges(seen, prs, LOGIN).map(event => `${event.kind} #${event.pr.number}`);
  assert.deepEqual(changes(load(['commented', pr(1)], ['opened', pr(2, { author: { login: LOGIN } })])), ['new #1']);
  assert.deepEqual(changes(load(['commented', pr(1)], ['opened', pr(2, { author: { login: LOGIN } })])), [], 'nothing changed');
  assert.deepEqual(changes(load(
    ['opened', pr(2, { author: { login: LOGIN }, reviewDecision: 'APPROVED' })],
    ['reviewed', pr(1, { reviewDecision: 'APPROVED' })],
    ['committed', pr(3, { state: 'MERGED' })],
    ['opened', pr(4, { author: { login: LOGIN } })],
  )), ['approved #2'], 'reviewer-only approval, merged and your own new PRs are not news');
  assert.deepEqual(changes(load(['opened', pr(2, { author: { login: LOGIN }, reviewDecision: 'APPROVED' })])), [], 'approval reported once');
});

test('normalizePr maps state, draft, checks and strips control characters', () => {
  assert.equal(normalizePr(pr(1, { isDraft: true })).state, 'draft');
  assert.equal(normalizePr(pr(1, { state: 'MERGED' })).state, 'merged');
  assert.equal(normalizePr(pr(1, { state: 'CLOSED' })).state, 'closed');
  const normalized = normalizePr(pr(1, { title: 'evil\x1b[31m title\n' }));
  assert.equal(normalized.title, 'evil title');
  assert.equal(normalized.checks, 'SUCCESS');
  assert.equal(normalizePr({}), undefined);
});

test('mergePrs dedupes by url, unions roles and tags PRs the user authored as opened', () => {
  const prs = mergePrs([
    { role: 'commented', nodes: [pr(2)] },
    { role: 'reviewed', nodes: [pr(2)] },
    { role: 'committed', nodes: [pr(5, { author: { login: LOGIN } })] },
  ], LOGIN);
  assert.deepEqual(prs.map(item => item.number), [5, 2]);
  assert.deepEqual([...prs[1].roles].sort(), ['commented', 'reviewed']);
  assert.deepEqual([...prs[0].roles].sort(), ['committed', 'opened']);
});

test('filterQualifier narrows searches for open and recent', () => {
  assert.equal(filterQualifier('open', now), 'is:open');
  assert.equal(filterQualifier('recent', now), 'updated:>=2026-09-30');
  assert.equal(filterQualifier('all', now), '');
});

test('pushedBranches keeps unique branch pushes and skips tags', async () => {
  const { run } = fakeGh();
  assert.deepEqual(await pushedBranches(run, LOGIN), [{ repo: 'acme/app', branch: 'fix-x' }]);
});

test('load combines opened, commented, reviewed and committed PRs', async () => {
  const { run, calls } = fakeGh();
  const data = await new PrStore({ run, now: () => now }).load('all');
  assert.deepEqual(data.errors, []);
  assert.equal(data.login, LOGIN);
  const roles = Object.fromEntries(data.prs.map(item => [item.number, [...item.roles].sort()]));
  assert.deepEqual(roles, {
    1: ['opened'],
    2: ['commented', 'committed'],
    3: ['commented', 'reviewed'],
    4: ['committed', 'opened'],
  });
  const committedQuery = calls.find(args => args.join(' ').includes(': repository(')).join(' ');
  assert.match(committedQuery, /headRefName: "fix-x"/);
  assert.match(committedQuery, new RegExp(`oid: "${'a'.repeat(40)}"`));
});

test('the open filter skips commit search, which only finds merged PRs', async () => {
  const { run, calls } = fakeGh();
  await new PrStore({ run, now: () => now }).load('open');
  assert.equal(calls.some(args => args.join(' ').includes('search/commits')), false);
  assert.ok(calls.filter(args => args.join(' ').includes('is:open')).length === 3);
});

test('a failing source is reported while the others still load', async () => {
  const { run } = fakeGh({ commented: fail('HTTP 502'), events: fail('HTTP 403: rate limited') });
  const data = await new PrStore({ run, now: () => now }).load('all');
  assert.deepEqual(data.errors.sort(), ['commented search: HTTP 502', 'push events: HTTP 403: rate limited']);
  assert.deepEqual(data.prs.map(item => item.number).sort(), [1, 3, 4]);
});

test('an unauthenticated gh yields an error instead of throwing', async () => {
  const { run, calls } = fakeGh({ user: fail('To get started with GitHub CLI, please run:  gh auth login') });
  const data = await new PrStore({ run, now: () => now }).load('open');
  assert.deepEqual(data.prs, []);
  assert.deepEqual(data.errors, ['gh: To get started with GitHub CLI, please run:  gh auth login']);
  assert.equal(calls.length, 1);
});

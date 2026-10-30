import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paint, width } from '../board/render.mjs';
import { buildRows, checkRows, ciText, emptyRows, footer, header, keepPr, notifications } from './render.mjs';

const now = Date.parse('2026-10-30T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const pr = (number, repo, extra = {}) => ({
  key: `https://github.com/${repo}/pull/${number}`,
  url: `https://github.com/${repo}/pull/${number}`,
  number,
  repo,
  title: `PR ${number}`,
  author: 'alice',
  state: 'open',
  review: 'REVIEW_REQUIRED',
  checks: 'SUCCESS',
  updatedAt: now - number * HOUR,
  roles: new Set(['commented']),
  ...extra,
});

const data = {
  login: 'me',
  fetchedAt: now - 5000,
  errors: [],
  prs: [
    pr(1, 'acme/web', { roles: new Set(['opened']), author: 'me' }),
    pr(2, 'acme/api', { roles: new Set(['committed']), state: 'merged', updatedAt: now - 3 * DAY }),
    pr(3, 'acme/web', { roles: new Set(['reviewed']), state: 'draft' }),
    pr(4, 'acme/api', { roles: new Set(['commented']), state: 'closed', updatedAt: now - 60 * DAY }),
    pr(5, 'acme/cjk', { title: '修复登录页面的布局问题并且更新文档说明以及测试用例 🚀🚀🚀', roles: new Set(['opened', 'committed', 'commented', 'reviewed']) }),
  ],
};

const ui = (extra = {}) => ({ filter: 'all', role: 'any', refresh: 120, ...extra });
const numbers = rows => rows.filter(row => row.key).map(row => Number(row.key.split('/').pop()));

test('filters by state and age', () => {
  assert.deepEqual(numbers(buildRows(data, ui({ filter: 'open' }), now, 120).rows).sort(), [1, 3, 5]);
  assert.deepEqual(numbers(buildRows(data, ui({ filter: 'recent' }), now, 120).rows).sort(), [1, 2, 3, 5]);
  assert.deepEqual(numbers(buildRows(data, ui(), now, 120).rows).sort(), [1, 2, 3, 4, 5]);
});

test('role filter: commented includes reviewed', () => {
  assert.deepEqual(numbers(buildRows(data, ui({ role: 'commented' }), now, 120).rows).sort(), [3, 4, 5]);
  assert.deepEqual(numbers(buildRows(data, ui({ role: 'committed' }), now, 120).rows).sort(), [2, 5]);
  assert.deepEqual(numbers(buildRows(data, ui({ role: 'opened' }), now, 120).rows).sort(), [1, 5]);
  assert.equal(keepPr(data.prs[0], ui({ role: 'committed' }), now), false);
});

test('groups PRs under repo headers, most recently updated repo first', () => {
  const { rows } = buildRows(data, ui(), now, 120);
  const headers = rows.filter(row => !row.key).map(row => row.segments.map(part => part.text).join(''));
  assert.match(headers[0], /^▍acme\/web/);
  assert.match(headers[1], /^▍acme\/cjk {2}1 PR$/);
  assert.match(headers[2], /^▍acme\/api {2}2 PRs$/);
  assert.deepEqual(numbers(rows), [1, 3, 5, 2, 4]);
});

test('rows never exceed the frame width, including CJK and emoji titles', () => {
  for (const columns of [40, 80, 120, 200]) {
    const lines = [
      ...buildRows(data, ui(), now, columns).rows.map(row => row.segments),
      ...header(data, ui(), undefined, now, columns),
      ...footer(undefined, { ...data, errors: ['commented search: HTTP 502'] }, columns),
    ];
    for (const segments of lines) {
      const painted = paint(segments, columns, { color: false });
      assert.equal(width(painted), columns, `columns=${columns}: ${painted}`);
    }
  }
  const row = buildRows(data, ui(), now, 120).rows.find(entry => entry.key?.endsWith('/5'));
  assert.ok(row.segments.reduce((sum, part) => sum + width(part.text), 0) <= 120);
});

test('role badges keep a fixed column', () => {
  const text = number => buildRows(data, ui(), now, 120).rows.find(row => row.key?.endsWith(`/${number}`)).segments.map(part => part.text).join('');
  const column = (number, badge) => width(text(number).slice(0, text(number).indexOf(badge)));
  assert.match(text(5), /OC✎R/);
  assert.match(text(1), /O··· {2}you/);
  assert.equal(column(1, 'O···'), column(5, 'OC✎R'));
});

test('notifications batch each kind and cap the body at three PRs', () => {
  const events = [1, 3, 5, 4].map(number => ({ kind: 'new', pr: data.prs.find(item => item.number === number) }));
  events.push({ kind: 'approved', pr: data.prs[0] });
  assert.deepEqual(notifications(events), [
    { title: '4 new PRs', body: 'acme/web#1 PR 1 (me)\nacme/web#3 PR 3 (alice)\nacme/cjk#5 修复登录页面的布局问题并且更新文档说明以及测试用例 🚀🚀🚀 (alice)\n+1 more' },
    { title: 'PR approved', body: 'acme/web#1 PR 1' },
  ]);
  assert.deepEqual(notifications([]), []);
});

test('header shows clickable filter, role and refresh interval', () => {
  const [top] = header(data, ui({ refresh: 30 }), undefined, now, 120);
  const actions = Object.fromEntries(top.filter(part => part.action).map(part => [part.action, part.text]));
  assert.deepEqual(actions, { filter: 'filter:all', role: 'role:any', refresh: 'refresh:30s' });
});

test('CI column shows passed out of relevant checks, coloured by failures and running checks', () => {
  const text = ci => ciText({ ci, checks: 'SUCCESS' }).text.trim();
  assert.equal(text({ passed: 9, failed: 1, pending: 0, relevant: 10 }), '✖ 9/10');
  assert.equal(text({ passed: 3, failed: 0, pending: 5, relevant: 8 }), '● 3/8');
  assert.equal(text({ passed: 6, failed: 0, pending: 0, relevant: 6 }), '✔ 6/6');
  assert.equal(ciText({ ci: { passed: 0, failed: 0, pending: 0, relevant: 0 }, checks: 'SUCCESS' }).text.trim(), '✔', 'only skipped checks: rollup glyph');
  assert.equal(ciText({}).text.trim(), '');
});

const ciGroups = [
  { key: 'run:5', kind: 'workflow', name: 'ci #5', url: 'https://ci/5', state: 'failure', startedAt: now - 65_000, completedAt: now, jobs: [
    { name: 'lint', state: 'success', url: 'https://ci/5/lint', startedAt: now - 60_000, completedAt: now - 30_000 },
    { name: 'deps', state: 'failure', url: 'https://ci/5/deps', startedAt: now - 65_000, completedAt: now },
    { name: 'build', state: 'skipped', url: 'https://ci/5/build' },
    { name: 'release', state: 'skipped', url: 'https://ci/5/release' },
  ] },
  { key: 'statuses', kind: 'status', name: 'Commit statuses', state: 'success', jobs: [{ name: 'security/snyk', state: 'success', url: 'https://snyk/1', description: 'passed' }] },
];

test('an expanded PR lists its check groups, their jobs and one row for skipped jobs', () => {
  const expanded = ui({ expanded: new Set([data.prs[0].url]), checks: new Map([[data.prs[0].url, { groups: ciGroups }]]) });
  const { rows } = buildRows(data, expanded, now, 120);
  const start = rows.findIndex(row => row.key === data.prs[0].url);
  const text = row => row.segments.map(part => part.text).join('').trimEnd();
  const children = rows.slice(start + 1, start + 6);
  assert.match(text(rows[start]), /^ ▾ ● #1 /);
  assert.match(text(children[0]), /^ {6}✖ ci #5 +1 failed +1m05s$/);
  assert.match(text(children[1]), /^ {8}✔ lint +30s$/);
  assert.match(text(children[2]), /^ {8}✖ deps +1m05s$/);
  assert.match(text(children[3]), /^ {8}↷ 2 skipped: build, release$/);
  assert.match(text(children[4]), /^ {6}✔ Commit statuses +1 status$/);
  assert.deepEqual(children.map(row => row.parentKey), Array(5).fill(data.prs[0].url));
  assert.deepEqual([children[0].target.url, children[2].target.url, children[3].target.url], ['https://ci/5', 'https://ci/5/deps', undefined]);
  for (const columns of [40, 80, 160]) {
    for (const row of buildRows(data, expanded, now, columns).rows) assert.equal(width(paint(row.segments, columns, { color: false })), columns);
  }
});

test('checks still loading or failed show one note; PRs without checks have no marker and never expand', () => {
  const pr = data.prs[0];
  const note = entry => checkRows(pr, entry, now, 100).map(row => row.segments.map(part => part.text).join('').trim());
  assert.deepEqual(note(undefined), ['⟳ loading checks…']);
  assert.deepEqual(note({ loading: true }), ['⟳ loading checks…']);
  assert.deepEqual(note({ error: 'gh: HTTP 502' }), ['⚠ gh: HTTP 502']);
  assert.deepEqual(note({ groups: [] }), ['no checks on the last commit']);
  assert.equal(note({ loading: true, groups: ciGroups }).length, 6, 'a refetch keeps the last checks on screen');
  const bare = { ...data, prs: [{ ...pr, checks: undefined, ci: undefined }] };
  const rows = buildRows(bare, ui({ expanded: new Set([pr.url]), checks: new Map() }), now, 100).rows;
  assert.equal(rows.length, 2, 'repo header + PR, no check rows');
  assert.equal(rows[1].foldable, false);
  assert.match(rows[1].segments.map(part => part.text).join(''), /^ {3}● #1 /);
});

test('empty and error states', () => {
  const text = rows => rows.map(segments => segments.map(part => part.text).join('')).join('\n');
  assert.match(text(emptyRows({ loading: true }, ui())), /Loading/);
  assert.match(text(emptyRows({ prs: [], errors: ['gh: not logged in'] }, ui())), /gh: not logged in/);
  assert.match(text(emptyRows({ prs: [], errors: [] }, ui({ filter: 'open', role: 'committed' }))), /No open pull requests you committed/);
});

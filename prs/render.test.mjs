import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paint, width } from '../board/render.mjs';
import { buildRows, emptyRows, footer, header, keepPr } from './render.mjs';

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

const ui = (extra = {}) => ({ filter: 'all', role: 'any', ...extra });
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

test('empty and error states', () => {
  const text = rows => rows.map(segments => segments.map(part => part.text).join('')).join('\n');
  assert.match(text(emptyRows({ loading: true }, ui())), /Loading/);
  assert.match(text(emptyRows({ prs: [], errors: ['gh: not logged in'] }, ui())), /gh: not logged in/);
  assert.match(text(emptyRows({ prs: [], errors: [] }, ui({ filter: 'open', role: 'committed' }))), /No open pull requests you committed/);
});

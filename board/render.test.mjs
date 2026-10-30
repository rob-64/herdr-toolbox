import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildView, duration, expandAllTaskFolds, header, isTaskFolded, paint, toggleTaskFold, width } from './render.mjs';

const now = Date.parse('2026-10-29T18:00:00.000Z');
const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const parentTaskId = 'task-parent-001';
const runningTaskId = 'task-running-002';
const nestedTaskId = 'task-nested-003';

const todos = [{
  id: sessionId,
  project: 'demo',
  name: 'Demo session',
  cwd: '/tmp/demo',
  updatedAt: now - 60_000,
  phases: [
    {
      name: 'Done phase',
      tasks: [
        { content: 'finished one', status: 'completed' },
        { content: 'finished two', status: 'completed' },
      ],
    },
    {
      name: 'Mixed',
      tasks: [
        { content: 'open task', status: 'pending' },
        { content: 'done task', status: 'completed' },
      ],
    },
  ],
}];

const treeTasks = [
  {
    id: parentTaskId,
    status: 'completed',
    terminal: true,
    sessionId,
    rootSessionId: sessionId,
    childSessionId: 'child-sess-parent',
    agent: 'plan-consultant',
    summary: 'Gap-analyze plan',
    startedAt: now - 500_000,
    endedAt: now - 100_000,
    updatedAt: now - 100_000,
    todos: null,
  },
  {
    id: runningTaskId,
    status: 'running',
    terminal: false,
    sessionId,
    rootSessionId: sessionId,
    childSessionId: 'child-sess-run',
    agent: 'plan-reviewer',
    summary: 'Review CI parity',
    startedAt: now - 200_000,
    updatedAt: now - 30_000,
    todos: {
      phases: [
        { name: 'Prep', tasks: [{ content: 'Load context', status: 'completed' }] },
        { name: 'Review', tasks: [{ content: 'Read plan', status: 'completed' }, { content: 'Check workflows', status: 'in_progress' }] },
      ],
    },
  },
  {
    id: nestedTaskId,
    status: 'completed',
    terminal: true,
    sessionId: 'child-sess-nested',
    rootSessionId: sessionId,
    childSessionId: 'child-sess-explore',
    agent: 'explore',
    summary: 'Find workflow files',
    startedAt: now - 180_000,
    endedAt: now - 120_000,
    updatedAt: now - 120_000,
    todos: {
      phases: [{ name: 'Search', tasks: [{ content: 'Scan repo', status: 'completed' }] }],
    },
  },
];

const panes = { bySession: new Map(), byPane: new Map(), panes: new Map() };

function rowText(view) {
  return view.rows.map(row => row.segments.map(part => part.text).join('')).join('\n');
}

function rowWidths(view) {
  return view.rows.map(row => width(row.segments.map(part => part.text).join('')));
}

test('tasks view status open hides completed and empty phases', () => {
  const ui = { view: 'tasks', scope: 'global', filter: 'all', status: 'open', sessionId, activeSessionId: undefined, folded: new Map() };
  const view = buildView({ todos, tasks: [], runs: [] }, panes, ui, now, 120);
  const text = rowText(view);
  assert.match(text, /open task/);
  assert.doesNotMatch(text, /finished one/);
  assert.doesNotMatch(text, /Done phase/);
});

test('tasks view default-folds completed phases in global scope', () => {
  const ui = { view: 'tasks', scope: 'global', filter: 'all', status: 'all', sessionId, activeSessionId: undefined, folded: new Map() };
  const view = buildView({ todos, tasks: [], runs: [] }, panes, ui, now, 120);
  const text = rowText(view);
  assert.match(text, /▸ Done phase/);
  assert.doesNotMatch(text, /finished one/);
  assert.match(text, /open task/);
});

test('tasks view session scope shows items when phases expanded', () => {
  const folded = expandAllTaskFolds(new Map(), [`phase:${sessionId}:0`]);
  const ui = { view: 'tasks', scope: 'session', filter: 'all', status: 'all', sessionId, activeSessionId: undefined, folded };
  const view = buildView({ todos, tasks: [], runs: [] }, panes, ui, now, 120);
  const text = rowText(view);
  assert.match(text, /finished one/);
  assert.match(text, /open task/);
});

test('tasks view totals and header', () => {
  const ui = { view: 'tasks', scope: 'global', filter: 'all', status: 'all', sessionId, activeSessionId: undefined, folded: new Map() };
  const view = buildView({ todos, tasks: treeTasks, runs: [] }, panes, ui, now, 160);
  assert.equal(view.totals.in_progress, 1);
  assert.equal(view.totals.pending, 1);
  assert.equal(view.totals.completed, 6);
  const lines = header(view, ui, now, 160);
  const top = paint(lines[0], 160, { color: false });
  assert.match(top, /Tasks/);
  assert.match(top, /status:all/);
});

test('tasks tree order guides and default nested fold', () => {
  const ui = { view: 'tasks', scope: 'global', filter: 'all', status: 'all', sessionId, activeSessionId: undefined, folded: new Map() };
  const view = buildView({ todos, tasks: treeTasks, runs: [] }, panes, ui, now, 140);
  const text = rowText(view);
  assert.match(text, /Mixed/);
  assert.match(text, /plan-reviewer/);
  assert.match(text, /▸.*explore/);
  assert.doesNotMatch(text, /Scan repo/);
  assert.match(text, /│/);
  assert.match(text, /├/);
  const mixedIdx = text.indexOf('Mixed');
  const reviewerIdx = text.indexOf('plan-reviewer');
  assert.ok(mixedIdx < reviewerIdx);
});

test('toggleTaskFold expands a default-folded phase', () => {
  const key = `phase:${sessionId}:0`;
  const folded = toggleTaskFold(new Map(), key, true);
  assert.equal(isTaskFolded(folded, key, true), false);
  const ui = { view: 'tasks', scope: 'global', filter: 'all', status: 'all', sessionId, activeSessionId: undefined, folded };
  const view = buildView({ todos, tasks: [], runs: [] }, panes, ui, now, 120);
  assert.match(rowText(view), /finished one/);
});

test('status filter hides empty subagent phase at depth 2', () => {
  const ui = { view: 'tasks', scope: 'global', filter: 'all', status: 'in_progress', sessionId, activeSessionId: undefined, folded: new Map() };
  const view = buildView({ todos: [{ ...todos[0], phases: [] }], tasks: treeTasks, runs: [] }, panes, ui, now, 140);
  const text = rowText(view);
  assert.match(text, /Check workflows/);
  assert.doesNotMatch(text, /Read plan/);
  assert.doesNotMatch(text, /Prep/);
  assert.match(text, /Check workflows/);
});

test('tasks subagent rows fit column width and keep full elapsed time', () => {
  const longSummary = 'x'.repeat(200);
  const startedAt = now - 200_000;
  const tasks = [{
    id: 'task-wide-summary',
    status: 'running',
    terminal: false,
    sessionId,
    rootSessionId: sessionId,
    childSessionId: 'child-wide',
    agent: 'plan-reviewer',
    summary: longSummary,
    startedAt,
    updatedAt: now - 30_000,
    todos: {
      phases: [{ name: 'Work', tasks: [{ content: 'Step', status: 'in_progress' }] }],
    },
  }];
  const cols = 100;
  const ui = { view: 'tasks', scope: 'global', filter: 'all', status: 'all', sessionId, activeSessionId: undefined, folded: new Map() };
  const view = buildView({ todos: [{ ...todos[0], phases: [] }], tasks, runs: [] }, panes, ui, now, cols);
  const elapsedStr = duration(now - startedAt);
  for (const w of rowWidths(view)) assert.ok(w <= cols, `row width ${w} exceeds ${cols}`);
  const subRow = view.rows.find(row => row.segments.some(part => part.text.includes('plan-reviewer')));
  assert.ok(subRow);
  const subText = subRow.segments.map(part => part.text).join('');
  assert.match(subText, new RegExp(`${elapsedStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert.doesNotMatch(subText, /\d+[smhd]…/);
});

test('tasks leaf row has single space between branch and glyph', () => {
  const folded = expandAllTaskFolds(new Map(), [`phase:${sessionId}:1`]);
  const ui = { view: 'tasks', scope: 'global', filter: 'all', status: 'all', sessionId, activeSessionId: undefined, folded };
  const view = buildView({ todos, tasks: [], runs: [] }, panes, ui, now, 120);
  const leaf = view.rows.find(row => row.key?.startsWith('todo:') && row.segments.some(part => part.text.includes('open task')));
  assert.ok(leaf);
  const text = leaf.segments.map(part => part.text).join('');
  assert.match(text, /[├└] ○ open task/);
  assert.doesNotMatch(text, /[├└]   ○/);
});

test('tasks session header pluralizes subagent count', () => {
  const oneUi = { view: 'tasks', scope: 'global', filter: 'all', status: 'all', sessionId, activeSessionId: undefined, folded: new Map() };
  const oneTask = [treeTasks[1]];
  assert.match(rowText(buildView({ todos, tasks: oneTask, runs: [] }, panes, oneUi, now, 120)), /1 subagent\b/);
  assert.doesNotMatch(rowText(buildView({ todos, tasks: oneTask, runs: [] }, panes, oneUi, now, 120)), /1 subagents/);
  const twoUi = { ...oneUi };
  assert.match(rowText(buildView({ todos, tasks: treeTasks.slice(0, 2), runs: [] }, panes, twoUi, now, 120)), /2 subagents/);
});

test('tasks global scope caps terminal roots and shows more row', () => {
  const capSession = 'cap-session-00000000-0000-0000-0000-000000000001';
  const runningRoot = {
    id: 'cap-running',
    status: 'running',
    terminal: false,
    sessionId: capSession,
    rootSessionId: capSession,
    childSessionId: 'cap-child-run',
    agent: 'runner',
    summary: 'Still going',
    startedAt: now - 60_000,
    updatedAt: now - 10_000,
    todos: null,
  };
  const terminals = Array.from({ length: 7 }, (_, i) => ({
    id: `cap-term-${i}`,
    status: 'completed',
    terminal: true,
    sessionId: capSession,
    rootSessionId: capSession,
    childSessionId: `cap-child-${i}`,
    agent: `agent-${i}`,
    summary: `done ${i}`,
    startedAt: now - (i + 2) * 100_000,
    endedAt: now - (i + 1) * 100_000,
    updatedAt: now - (i + 1) * 100_000,
    todos: null,
  }));
  const capTodos = [{ id: capSession, project: 'demo', name: 'Cap', updatedAt: now, phases: [] }];
  const capTasks = [runningRoot, ...terminals];
  const globalUi = { view: 'tasks', scope: 'global', filter: 'all', status: 'all', sessionId: capSession, activeSessionId: undefined, folded: new Map() };
  const globalView = buildView({ todos: capTodos, tasks: capTasks, runs: [] }, panes, globalUi, now, 140);
  const globalText = rowText(globalView);
  assert.match(globalText, /runner/);
  assert.match(globalText, /\+2 more finished · s shows this whole session/);
  const subRows = globalView.rows.filter(row => row.key?.startsWith('subagent:'));
  assert.equal(subRows.length, 6);
  assert.match(subRows[subRows.length - 1].segments.map(part => part.text).join(''), /^├ /);
  const moreRow = globalView.rows.find(row => row.segments.some(part => part.text.includes('more finished')));
  assert.ok(moreRow);
  assert.match(moreRow.segments.map(part => part.text).join(''), /^└ \+2 more finished/);

  const sessionUi = { ...globalUi, scope: 'session' };
  const sessionView = buildView({ todos: capTodos, tasks: capTasks, runs: [] }, panes, sessionUi, now, 140);
  assert.equal(sessionView.rows.filter(row => row.key?.startsWith('subagent:')).length, 8);
  assert.doesNotMatch(rowText(sessionView), /more finished · s shows this whole session/);
});

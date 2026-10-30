import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { Store, normalizeTodos, toolArgument } from './data.mjs';

test('normalizeTodos rejects bad input', () => {
  assert.equal(normalizeTodos(null), null);
  assert.equal(normalizeTodos({ phases: 'nope' }), null);
});

test('normalizeTodos defaults status and cleans content', () => {
  const phases = normalizeTodos({
    phases: [{ name: '  Setup\x1b[0m ', tasks: [{ content: '  Do thing  ', status: 'weird' }, { content: '   ' }] }],
  });
  assert.deepEqual(phases, [{ name: 'Setup', tasks: [{ content: 'Do thing', status: 'pending' }] }]);
});

test('loadTodos incremental cache and filters', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'omo-todos-'));
  const encoded = '-Users-test-w-repo';
  const dir = join(agentDir, 'sessions', encoded);
  mkdirSync(dir, { recursive: true });
  const sessionId = '01a188c0-eea2-776c-91d8-f239726134c7';
  const file = join(dir, `2026-10-29T12-00-00.000Z_${sessionId}.jsonl`);
  const sessionLine = JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: '2026-10-29T12:00:00.000Z', cwd: '/Users/test/w/repo' });
  const infoLine = JSON.stringify({ type: 'session_info', id: sessionId, timestamp: '2026-10-29T12:01:00.000Z', name: 'My session' });
  const todo1 = JSON.stringify({
    type: 'message',
    timestamp: '2026-10-29T12:02:00.000Z',
    message: { role: 'toolResult', toolName: 'todo', details: { phases: [{ name: 'A', tasks: [{ content: 'first', status: 'pending' }] }] } },
  });
  const todo2 = JSON.stringify({
    type: 'message',
    timestamp: '2026-10-29T16:01:00.000Z',
    message: { role: 'toolResult', toolName: 'todo', details: { phases: [{ name: 'B', tasks: [{ content: 'second', status: 'completed' }] }] } },
  });
  writeFileSync(file, `${sessionLine}\n${infoLine}\n${todo1}\n${todo2}\n`);
  const store = new Store(agentDir);
  const first = store.loadTodos({ since: 0 });
  assert.equal(first.length, 1);
  assert.equal(first[0].id, sessionId);
  assert.equal(first[0].name, 'My session');
  assert.equal(first[0].project, 'repo');
  assert.equal(first[0].phases[0].tasks[0].content, 'second');

  const todo3 = JSON.stringify({
    type: 'message',
    timestamp: '2026-10-29T17:00:00.000Z',
    message: { role: 'toolResult', toolName: 'todo', details: { phases: [{ name: 'C', tasks: [{ content: 'third', status: 'in_progress' }] }] } },
  });
  appendFileSync(file, `${todo3}\n`);
  const second = store.loadTodos({ since: 0 });
  assert.equal(second[0].phases[0].tasks[0].content, 'third');

  const partial = '{"type":"message","timestamp":"2026-10-29T18:00:00.000Z","message":{"role":"toolResult","toolName":"todo","details":{"phases":[{"name":"D","tasks":[{"content":"partial"';
  appendFileSync(file, partial);
  const third = store.loadTodos({ since: 0 });
  assert.equal(third[0].phases[0].tasks[0].content, 'third');
  appendFileSync(file, ', "status":"pending"}]}]}}}\n');
  const fourth = store.loadTodos({ since: 0 });
  assert.equal(fourth[0].phases[0].tasks[0].content, 'partial');

  const old = mkdtempSync(join(tmpdir(), 'omo-todos-old-'));
  const oldDir = join(old, 'sessions', encoded);
  mkdirSync(oldDir, { recursive: true });
  const oldFile = join(oldDir, `old_${sessionId}.jsonl`);
  writeFileSync(oldFile, `${sessionLine}\n${todo2}\n`);
  const ancient = Date.now() - 7 * 24 * 60 * 60 * 1000;
  utimesSync(oldFile, ancient / 1000, ancient / 1000);
  const oldStore = new Store(old);
  assert.equal(oldStore.loadTodos({ since: Date.now() - 1000 }).length, 0);
  assert.equal(oldStore.loadTodos({ since: Date.now() - 1000, include: new Set([sessionId]) }).length, 1);
});

test('todosAt byte offsets with multi-byte UTF-8 across loads', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'omo-todos-mb-'));
  const encoded = '-Users-test-w-repo';
  const dir = join(agentDir, 'sessions', encoded);
  mkdirSync(dir, { recursive: true });
  const sessionId = '02b288c0-eea2-776c-91d8-f239726134c8';
  const file = join(dir, `2026-10-29T12-00-00.000Z_${sessionId}.jsonl`);
  const sessionLine = JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: '2026-10-29T12:00:00.000Z', cwd: '/Users/test/w/repo' });
  const todo1 = JSON.stringify({
    type: 'message',
    timestamp: '2026-10-29T12:02:00.000Z',
    message: { role: 'toolResult', toolName: 'todo', details: { phases: [{ name: 'A', tasks: [{ content: 'first … step', status: 'pending' }] }] } },
  });
  writeFileSync(file, `${sessionLine}\n${todo1}\n`);
  const store = new Store(agentDir);
  assert.equal(store.todosAt(file, sessionId).phases[0].tasks[0].content, 'first … step');

  const todo2 = JSON.stringify({
    type: 'message',
    timestamp: '2026-10-29T16:01:00.000Z',
    message: { role: 'toolResult', toolName: 'todo', details: { phases: [{ name: 'B', tasks: [{ content: 'second 󰄬 done 🎉', status: 'completed' }] }] } },
  });
  appendFileSync(file, `${todo2}\n`);
  assert.equal(store.todosAt(file, sessionId).phases[0].tasks[0].content, 'second 󰄬 done 🎉');
});

test('todosAt reads child transcript directory by path', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'omo-child-todo-'));
  const storePath = join(agentDir, 'projects', 'demo-abc', 'senpi-task');
  const childDir = join(storePath, 'children', 'task-child-1', 'sessions', 'task-child-1');
  mkdirSync(childDir, { recursive: true });
  const transcript = join(childDir, '2026-10-29T12-00-00.000Z_not-the-child-id.jsonl');
  const todo = JSON.stringify({
    type: 'message',
    timestamp: '2026-10-29T12:05:00.000Z',
    message: { role: 'toolResult', toolName: 'todo', details: { phases: [{ name: 'Work', tasks: [{ content: 'child item', status: 'pending' }] }] } },
  });
  writeFileSync(transcript, `${todo}\n`);
  const store = new Store(agentDir);
  const state = store.todosAt(childDir, 'task-child-1');
  assert.equal(state.phases[0].tasks[0].content, 'child item');
});

test('toolArgument prefers existing keys and respects max length', () => {
  assert.equal(toolArgument({ command: 'ls', path: '/tmp' }), 'ls');
  assert.equal(toolArgument({ path: '/tmp/a' }), '/tmp/a');
  assert.equal(toolArgument({ pattern: 'foo' }), 'foo');
  assert.equal(toolArgument({ command: 'x'.repeat(80) }, 10), 'x'.repeat(10));
});

test('toolArgument falls back to extended keys and todo op', () => {
  assert.equal(toolArgument({ file_path: '/repo/src/main.ts' }), '/repo/src/main.ts');
  assert.equal(toolArgument({ message: 'hello' }), 'hello');
  assert.equal(toolArgument({ objective: 'ship it' }), 'ship it');
  assert.equal(toolArgument({ task: 'fix bug' }), 'fix bug');
  assert.equal(toolArgument({ task_id: 'st_abc' }), 'st_abc');
  assert.equal(toolArgument({ bash_id: 'bash-1' }), 'bash-1');
  assert.equal(toolArgument({ op: 'add' }), 'add');
  assert.equal(toolArgument({ command: 'echo', op: 'add' }), 'echo');
});

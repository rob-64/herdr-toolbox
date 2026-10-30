import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { Store, transcriptFile } from './data.mjs';
import { paint, width, wrap } from './render.mjs';
import { Viewer } from './viewer.mjs';

function line(entry) {
  return `${JSON.stringify(entry)}\n`;
}

function buildFixture(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'session.jsonl');
  const user = {
    type: 'message',
    timestamp: '2026-10-29T12:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'Line1\nLine2\nLine3\nLine4\nLine5\nLine6\nLine7\nLine8\nLine9\nHidden' }] },
  };
  const assistant = {
    type: 'message',
    timestamp: '2026-10-29T12:01:00.000Z',
    message: {
      role: 'assistant',
      model: 'claude-sonnet',
      content: [
        { type: 'thinking', thinking: 'Think one\nThink two\nThink three' },
        { type: 'text', text: 'Hello world' },
        { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'echo hi' } },
      ],
    },
  };
  const toolOk = {
    type: 'message',
    timestamp: '2026-10-29T12:02:00.000Z',
    message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'bash', isError: false, content: [{ type: 'text', text: 'hi\nthere' }] },
  };
  const toolErr = {
    type: 'message',
    timestamp: '2026-10-29T12:03:00.000Z',
    message: { role: 'toolResult', toolName: 'orphan', isError: true, content: [{ type: 'text', text: 'boom' }] },
  };
  const wide = {
    type: 'message',
    timestamp: '2026-10-29T12:04:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: `${'W'.repeat(80)} 󰄬` }] },
  };
  writeFileSync(file, line(user) + line(assistant) + line(toolOk) + line(toolErr) + line(wide));
  return file;
}

test('Store.transcript parses, pairs tools, and reads incrementally', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omo-transcript-'));
  const file = buildFixture(dir);
  const store = new Store(mkdtempSync(join(tmpdir(), 'omo-agent-')));
  const first = store.transcript(dir);
  assert.equal(transcriptFile(dir), file);
  assert.ok(first.entries.some(entry => entry.kind === 'user'));
  assert.ok(first.entries.some(entry => entry.kind === 'thinking'));
  const tool = first.entries.find(entry => entry.kind === 'tool' && entry.name === 'bash');
  assert.ok(tool?.result);
  assert.equal(tool.result.text.includes('hi'), true);
  assert.ok(first.entries.some(entry => entry.kind === 'result' && entry.name === 'orphan'));

  const partial = '{"type":"message","timestamp":"2026-10-29T12:05:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"partial';
  appendFileSync(file, partial);
  const second = store.transcript(dir);
  assert.equal(second.entries.filter(entry => entry.kind === 'text' && entry.text === 'partial').length, 0);
  appendFileSync(file, ' tail"}]}}\n');
  const third = store.transcript(dir);
  assert.ok(third.entries.some(entry => entry.kind === 'text' && entry.text.includes('partial tail')));
});

test('wrap handles wide chars, long words, and blank-line collapse', () => {
  assert.deepEqual(wrap('a b c', 10), ['a b c']);
  assert.deepEqual(wrap('hello world', 5), ['hello', 'world']);
  assert.deepEqual(wrap('x'.repeat(12), 5), ['xxxxx', 'xxxxx', 'xx']);
  assert.deepEqual(wrap('a\n\n\nb', 10), ['a', '', 'b']);
  const wide = wrap('ok 󰄬 end', 6);
  assert.ok(wide.join(' ').includes('󰄬'));
});

test('Viewer frame layout, expand, thinking, following, and width', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omo-viewer-'));
  const file = buildFixture(dir);
  const task = {
    id: 'task-view-1',
    status: 'running',
    terminal: false,
    agent: 'explore',
    summary: 'Find files',
    transcript: dir,
    turns: 2,
    toolCalls: 1,
    startedAt: Date.now() - 60_000,
  };
  const store = new Store(mkdtempSync(join(tmpdir(), 'omo-agent-')));
  const viewer = new Viewer(store, task);
  viewer.refresh();
  const columns = 40;
  const rows = 30;
  viewer.following = false;
  viewer.scroll = 0;
  const frame = viewer.frame(columns, rows, 0);
  const plain = frame.map(line => line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ''));
  assert.ok(plain.some(line => line.includes('⚒ bash')));
  for (const line of plain) assert.ok(width(line) <= columns, line);
  const bodyText = viewer.bodyLines.map(segs => segs.map(part => part.text).join('')).join('\n');
  assert.match(bodyText, /\+\d+ lines \(e expands\)/);

  viewer.expand = true;
  const expanded = viewer.frame(columns, rows, 0).map(line => line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ''));
  assert.ok(!expanded.some(line => line.includes('+1 lines (e expands)')));

  viewer.expand = false;
  viewer.showThinking = true;
  const thinking = viewer.frame(columns, rows, 0).map(line => line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ''));
  assert.ok(thinking.some(line => line.includes('Think three')));

  viewer.showThinking = false;
  viewer.following = true;
  const before = viewer.frame(columns, rows, 0).map(line => line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')).join('\n');
  appendFileSync(file, line({
    type: 'message',
    timestamp: '2026-10-29T12:06:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'NEWLINE_MARKER' }] },
  }));
  viewer.refresh();
  const afterFollow = viewer.frame(columns, rows, 0).map(line => line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')).join('\n');
  assert.ok(afterFollow.includes('NEWLINE_MARKER'));

  viewer.scrollBy(-5, 10);
  assert.equal(viewer.following, false);
  viewer.key('G', 10);
  assert.equal(viewer.following, true);
});

test('Viewer tool line uses single space between name and summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omo-viewer-tool-'));
  const file = join(dir, 'session.jsonl');
  const readCall = {
    type: 'message',
    timestamp: '2026-10-29T12:00:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'c1', name: 'read', arguments: { file_path: '/Users/me/w/herdr-omo-toolbox/.github/workflows/ci.yml' } }],
    },
  };
  writeFileSync(file, `${JSON.stringify(readCall)}\n`);
  const store = new Store(mkdtempSync(join(tmpdir(), 'omo-agent-')));
  const viewer = new Viewer(store, {
    id: 'task-read-1',
    status: 'running',
    terminal: false,
    agent: 'explore',
    summary: 'Read workflow',
    transcript: dir,
  });
  viewer.refresh();
  const columns = 110;
  const plain = viewer.frame(columns, 20, 0).map(line => line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ''));
  const toolLine = plain.find(line => line.includes('⚒ read'));
  assert.ok(toolLine, plain.join('\n'));
  assert.match(toolLine, /^⚒ read \S/);
  assert.doesNotMatch(toolLine, /⚒ read {2,}/);
  assert.ok(toolLine.includes('ci.yml'));
});

test('wrap never drops characters at break points', () => {
  const text = '113: The last GitLab releases, `service-3.8.0` and `charts-bff-2.4.0`, are already tags on GitHub, so nothing needs seeding.';
  for (const size of [100, 104, 40, 13, 4]) {
    const lines = wrap(text, size);
    assert.ok(lines.every(line => width(line) <= size));
    assert.equal(lines.join('').replace(/\s+/g, ''), text.replace(/\s+/g, ''));
  }
  assert.deepEqual(wrap('abcdefghij klmnop', 4), ['abcd', 'efgh', 'ij', 'klmn', 'op']);
});

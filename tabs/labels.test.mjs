import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ICONS,
  folderName,
  iconFor,
  plan,
  STATUS_GLYPH,
  stripPrefix,
} from './labels.mjs';

const OMO = DEFAULT_ICONS.omo;

function snap(tabs, agents = [], extra = {}) {
  return {
    focused_tab_id: extra.focused_tab_id,
    focused_workspace_id: extra.focused_workspace_id ?? 'w0',
    tabs,
    agents,
    workspaces: [],
    panes: [],
  };
}

function tab(id, label, number = 1) {
  return { tab_id: id, workspace_id: 'w0', label, number, focused: false };
}

function agent(paneId, tabId, opts = {}) {
  return {
    pane_id: paneId,
    tab_id: tabId,
    workspace_id: 'w0',
    agent: 'omo',
    agent_status: 'working',
    title: 'Fix login',
    focused: false,
    ...opts,
  };
}

const defaultConfig = { icons: {}, max_title: 32 };

describe('plan', () => {
  it('names unnamed tab with omo agent', () => {
    const snapshot = snap([tab('w0:t1', '1', 1)], [agent('w0:p1', 'w0:t1')]);
    const { renames, state } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames.length, 1);
    assert.equal(renames[0].label, 'Fix login');
    assert.equal(state.owned['w0:t1'], 'Fix login');
  });

  it('does not rename when label already matches owned', () => {
    const snapshot = snap([tab('w0:t1', 'Fix login')], [agent('w0:p1', 'w0:t1')]);
    const { renames } = plan(
      snapshot,
      { owned: { 'w0:t1': 'Fix login' }, released: [] },
      defaultConfig,
    );
    assert.equal(renames.length, 0);
  });

  it('does not rename on status change', () => {
    const snapshot = snap(
      [tab('w0:t1', 'Fix login')],
      [agent('w0:p1', 'w0:t1', { agent_status: 'blocked' })],
    );
    const { renames } = plan(
      snapshot,
      { owned: { 'w0:t1': 'Fix login' }, released: [] },
      defaultConfig,
    );
    assert.equal(renames.length, 0);
  });

  it('follows the agent title when it changes', () => {
    const snapshot = snap(
      [tab('w0:t1', 'Fix login')],
      [agent('w0:p1', 'w0:t1', { title: 'Fix logout' })],
    );
    const { renames, state } = plan(
      snapshot,
      { owned: { 'w0:t1': 'Fix login' }, released: [] },
      defaultConfig,
    );
    assert.equal(renames[0].label, 'Fix logout');
    assert.equal(state.owned['w0:t1'], 'Fix logout');
  });

  it('releases tab when user renames owned tab', () => {
    const snapshot = snap([tab('w0:t1', 'My custom name')], [agent('w0:p1', 'w0:t1')]);
    const { renames, state } = plan(
      snapshot,
      { owned: { 'w0:t1': 'Fix login' }, released: [] },
      defaultConfig,
    );
    assert.equal(renames.length, 0);
    assert.equal(state.owned['w0:t1'], undefined);
    assert.ok(state.released.includes('w0:t1'));

    const again = plan(snapshot, state, defaultConfig);
    assert.equal(again.renames.length, 0);
  });

  it('leaves custom labels alone and claims OmO terminal titles', () => {
    const custom = snap([tab('w0:t1', 'my tab')], [agent('w0:p1', 'w0:t1')]);
    assert.equal(plan(custom, { owned: {}, released: [] }, defaultConfig).renames.length, 0);

    const stale = snap([tab('w0:t2', 'OmO - Running x')], [agent('w0:p2', 'w0:t2')]);
    const { renames } = plan(stale, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames.length, 1);
  });

  it('keeps the label and ownership when agent leaves', () => {
    const snapshot = snap([tab('w0:t1', 'Fix login')]);
    const { renames, state } = plan(
      snapshot,
      { owned: { 'w0:t1': 'Fix login' }, released: [] },
      defaultConfig,
    );
    assert.equal(renames.length, 0);
    assert.equal(state.owned['w0:t1'], 'Fix login');
  });

  it('strips old prefix from owned tab when agent leaves', () => {
    const label = `${OMO} ${STATUS_GLYPH.working} Fix login`;
    const snapshot = snap([tab('w0:t1', label)]);
    const { renames, state } = plan(
      snapshot,
      { owned: { 'w0:t1': label }, released: [] },
      defaultConfig,
    );
    assert.equal(renames[0].label, 'Fix login');
    assert.equal(state.owned['w0:t1'], 'Fix login');
  });

  it('renames tab again when an agent returns', () => {
    const first = plan(
      snap([tab('w0:t1', 'Fix login')]),
      { owned: { 'w0:t1': 'Fix login' }, released: [] },
      defaultConfig,
    );
    assert.equal(first.renames.length, 0);

    const returned = snap(
      [tab('w0:t1', 'Fix login')],
      [agent('w0:p1', 'w0:t1', { title: 'Next task' })],
    );
    const second = plan(returned, first.state, defaultConfig);
    assert.equal(second.renames.length, 1);
    assert.equal(second.renames[0].label, 'Next task');
    assert.equal(second.state.owned['w0:t1'], 'Next task');
  });

  it('does not touch unowned tab without agents', () => {
    const snapshot = snap([tab('w0:t1', 'my tab')]);
    const { renames } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames.length, 0);
  });

  it('blocked beats working in same tab', () => {
    const snapshot = snap(
      [tab('w0:t1', '1')],
      [
        agent('w0:p1', 'w0:t1', { agent_status: 'working', title: 'Working task' }),
        agent('w0:p2', 'w0:t1', { agent_status: 'blocked', title: 'Blocked task' }),
      ],
    );
    const { renames } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames[0].label, 'Blocked task');
  });

  it('uses tab number when title missing and agent has no cwd', () => {
    const snapshot = snap([tab('w0:t1', '1', 7)], [agent('w0:p1', 'w0:t1', { title: null })]);
    const { renames } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames[0].label, '7');
  });

  it('keeps previous base when owned and title missing and agent has no cwd', () => {
    const snapshot = snap(
      [tab('w0:t1', 'Keep this base')],
      [agent('w0:p1', 'w0:t1', { title: null })],
    );
    const { renames } = plan(
      snapshot,
      { owned: { 'w0:t1': 'Keep this base' }, released: [] },
      defaultConfig,
    );
    assert.equal(renames.length, 0);
  });

  it('uses folder name when title missing and cwd is set', () => {
    const snapshot = snap(
      [tab('w0:t1', '1', 1)],
      [
        agent('w0:p1', 'w0:t1', {
          title: null,
          cwd: '/Users/x/w/scratch',
          agent_status: 'working',
        }),
      ],
    );
    const { renames } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames[0].label, 'scratch');
  });

  it('prefers foreground_cwd over cwd for folder name', () => {
    const snapshot = snap(
      [tab('w0:t1', '1')],
      [
        agent('w0:p1', 'w0:t1', {
          title: null,
          cwd: '/a/old',
          foreground_cwd: '/a/new',
        }),
      ],
    );
    const { renames } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames[0].label, 'new');
  });

  it('uses task title over folder name when both present', () => {
    const snapshot = snap(
      [tab('w0:t1', '1')],
      [agent('w0:p1', 'w0:t1', { title: 'Fix login', cwd: '/Users/x/w/scratch' })],
    );
    const { renames } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames[0].label, 'Fix login');
  });

  it('truncates long titles', () => {
    const long = 'A'.repeat(40);
    const snapshot = snap(
      [tab('w0:t1', '1')],
      [agent('w0:p1', 'w0:t1', { title: long })],
    );
    const { renames } = plan(
      snapshot,
      { owned: {}, released: [] },
      { ...defaultConfig, max_title: 10 },
    );
    assert.equal(renames[0].label, `${'A'.repeat(9)}…`);
  });

  it('leaves icons config out of tab labels', () => {
    const snapshot = snap([tab('w0:t1', '1')], [agent('w0:p1', 'w0:t1')]);
    const { renames } = plan(snapshot, { owned: {}, released: [] }, {
      ...defaultConfig,
      icons: { omo: '★' },
    });
    assert.equal(renames[0].label, 'Fix login');
  });

  it('prunes closed tabs from owned and released', () => {
    const snapshot = snap([tab('w0:t1', '1')]);
    const { state } = plan(
      snapshot,
      { owned: { 'w0:gone': 'x', 'w0:t1': '1' }, released: ['w0:old'] },
      defaultConfig,
    );
    assert.equal(state.owned['w0:gone'], undefined);
    assert.ok(!state.released.includes('w0:old'));
  });

  it('claims tab with old managed prefix after restart', () => {
    const stale = `${OMO} ◐ Old task`;
    const snapshot = snap(
      [tab('w0:t1', stale)],
      [agent('w0:p1', 'w0:t1', { title: 'New task' })],
    );
    const { renames, state } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames.length, 1);
    assert.equal(renames[0].label, 'New task');
    assert.equal(state.owned['w0:t1'], 'New task');
  });

  it('does not claim prefixed label when tab is released', () => {
    const stale = `${OMO} ◐ Old task`;
    const snapshot = snap(
      [tab('w0:t1', stale)],
      [agent('w0:p1', 'w0:t1', { title: 'New task' })],
    );
    const { renames } = plan(
      snapshot,
      { owned: {}, released: ['w0:t1'] },
      defaultConfig,
    );
    assert.equal(renames.length, 0);
  });

  it('does not claim custom user label without agents pattern', () => {
    const snapshot = snap([tab('w0:t1', 'my tab')], [agent('w0:p1', 'w0:t1')]);
    const { renames } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames.length, 0);
  });

  it('strips icon and status from owned tab', () => {
    const ownedLabel = `${OMO} ${STATUS_GLYPH.working} Fix login`;
    const snapshot = snap(
      [tab('w0:t1', ownedLabel)],
      [agent('w0:p1', 'w0:t1', { agent_status: 'blocked' })],
    );
    const { renames, state } = plan(
      snapshot,
      { owned: { 'w0:t1': ownedLabel }, released: [] },
      defaultConfig,
    );
    assert.equal(renames.length, 1);
    assert.equal(renames[0].label, 'Fix login');
    assert.equal(state.owned['w0:t1'], 'Fix login');
  });

  it('strips legacy omo icon from owned tab', () => {
    const legacyOmo = '\u{F09DF}';
    const ownedLabel = `${legacyOmo} ✓ Fix login`;
    const snapshot = snap(
      [tab('w0:t1', ownedLabel)],
      [agent('w0:p1', 'w0:t1', { agent_status: 'idle' })],
    );
    const { renames } = plan(
      snapshot,
      { owned: { 'w0:t1': ownedLabel }, released: [] },
      defaultConfig,
    );
    assert.equal(renames.length, 1);
    assert.equal(renames[0].label, 'Fix login');
  });

  it('strips legacy status glyph from owned tab', () => {
    const ownedLabel = `${OMO} ◐ Fix login`;
    const snapshot = snap(
      [tab('w0:t1', ownedLabel)],
      [agent('w0:p1', 'w0:t1', { agent_status: 'idle' })],
    );
    const { renames } = plan(
      snapshot,
      { owned: { 'w0:t1': ownedLabel }, released: [] },
      defaultConfig,
    );
    assert.equal(renames.length, 1);
    assert.equal(renames[0].label, 'Fix login');
  });
});

describe('folderName', () => {
  it('returns last segment with trailing slash', () => {
    assert.equal(folderName('/a/b/'), 'b');
  });

  it('returns empty for root', () => {
    assert.equal(folderName('/'), '');
  });

  it('returns empty for non-string', () => {
    assert.equal(folderName(undefined), '');
  });
});

describe('helpers', () => {
  it('stripPrefix removes icon and glyph', () => {
    const label = `${OMO} ${STATUS_GLYPH.working} Fix login`;
    assert.equal(stripPrefix(label), 'Fix login');
  });

  it('stripPrefix removes legacy status glyph prefix', () => {
    const label = `${OMO} ◐ Fix login`;
    assert.equal(stripPrefix(label), 'Fix login');
  });

  it('stripPrefix removes new status glyph without icon', () => {
    const label = `${STATUS_GLYPH.blocked} Fix login`;
    assert.equal(stripPrefix(label), 'Fix login');
  });

  it('iconFor respects false and overrides', () => {
    assert.equal(iconFor('omo', { icons: false }), '');
    assert.equal(iconFor('omo', { icons: { omo: 'X' } }), 'X');
  });
});

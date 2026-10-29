import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ICONS,
  glyphFor,
  iconFor,
  plan,
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

const defaultConfig = { icons: {}, status: true, max_title: 32 };

describe('plan', () => {
  it('names unnamed tab with omo agent', () => {
    const snapshot = snap([tab('w0:t1', '1', 1)], [agent('w0:p1', 'w0:t1')]);
    const { renames, state } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames.length, 1);
    assert.equal(renames[0].label, `${OMO} ◐ Fix login`);
    assert.equal(state.owned['w0:t1'], renames[0].label);
  });

  it('does not rename when label already matches owned', () => {
    const label = `${OMO} ◐ Fix login`;
    const snapshot = snap([tab('w0:t1', label)], [agent('w0:p1', 'w0:t1')]);
    const { renames } = plan(
      snapshot,
      { owned: { 'w0:t1': label }, released: [] },
      defaultConfig,
    );
    assert.equal(renames.length, 0);
  });

  it('updates glyph on status change', () => {
    const old = `${OMO} ◐ Fix login`;
    const snapshot = snap(
      [tab('w0:t1', old)],
      [agent('w0:p1', 'w0:t1', { agent_status: 'blocked' })],
    );
    const { renames } = plan(
      snapshot,
      { owned: { 'w0:t1': old }, released: [] },
      defaultConfig,
    );
    assert.equal(renames[0].label, `${OMO} ◉ Fix login`);
  });

  it('releases tab when user renames owned tab', () => {
    const owned = `${OMO} ◐ Fix login`;
    const snapshot = snap([tab('w0:t1', 'My custom name')], [agent('w0:p1', 'w0:t1')]);
    const { renames, state } = plan(
      snapshot,
      { owned: { 'w0:t1': owned }, released: [] },
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

  it('keeps ownership of bare label when agent leaves', () => {
    const label = `${OMO} ◐ Fix login`;
    const snapshot = snap([tab('w0:t1', label)]);
    const { renames, state } = plan(
      snapshot,
      { owned: { 'w0:t1': label }, released: [] },
      defaultConfig,
    );
    assert.equal(renames[0].label, 'Fix login');
    assert.equal(state.owned['w0:t1'], 'Fix login');
  });

  it('reclaims tab when agent returns after bare rename', () => {
    const label = `${OMO} ◐ Fix login`;
    const snapshot = snap([tab('w0:t1', label)]);
    const first = plan(
      snapshot,
      { owned: { 'w0:t1': label }, released: [] },
      defaultConfig,
    );
    assert.equal(first.renames[0].label, 'Fix login');
    assert.equal(first.state.owned['w0:t1'], 'Fix login');

    const restored = snap([tab('w0:t1', 'Fix login')], [agent('w0:p1', 'w0:t1')]);
    const second = plan(restored, first.state, defaultConfig);
    assert.equal(second.renames.length, 1);
    assert.equal(second.renames[0].label, `${OMO} ◐ Fix login`);
    assert.equal(second.state.owned['w0:t1'], `${OMO} ◐ Fix login`);
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
    assert.match(renames[0].label, /Blocked task/);
    assert.match(renames[0].label, /◉/);
  });

  it('uses tab number when title missing', () => {
    const snapshot = snap([tab('w0:t1', '1', 7)], [agent('w0:p1', 'w0:t1', { title: null })]);
    const { renames } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.match(renames[0].label, /7$/);
  });

  it('keeps previous base when owned and title missing', () => {
    const label = `${OMO} ◐ Keep this base`;
    const snapshot = snap(
      [tab('w0:t1', label)],
      [agent('w0:p1', 'w0:t1', { title: null })],
    );
    const { renames } = plan(
      snapshot,
      { owned: { 'w0:t1': label }, released: [] },
      defaultConfig,
    );
    assert.equal(renames.length, 0);
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
    assert.match(renames[0].label, /A{9}…$/);
  });

  it('respects icons:false and status:false', () => {
    const snapshot = snap([tab('w0:t1', '1')], [agent('w0:p1', 'w0:t1')]);
    const noIcons = plan(snapshot, { owned: {}, released: [] }, {
      ...defaultConfig,
      icons: false,
    });
    assert.equal(noIcons.renames[0].label, '◐ Fix login');

    const noStatus = plan(snapshot, { owned: {}, released: [] }, {
      ...defaultConfig,
      status: false,
    });
    assert.equal(noStatus.renames[0].label, `${OMO} Fix login`);
  });

  it('uses default robot icon for unknown agent kind', () => {
    const snapshot = snap(
      [tab('w0:t1', '1')],
      [agent('w0:p1', 'w0:t1', { agent: 'unknown-bot' })],
    );
    const { renames } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.ok(renames[0].label.startsWith(DEFAULT_ICONS.default));
  });

  it('applies config icon override', () => {
    const snapshot = snap([tab('w0:t1', '1')], [agent('w0:p1', 'w0:t1')]);
    const { renames } = plan(snapshot, { owned: {}, released: [] }, {
      ...defaultConfig,
      icons: { omo: '★' },
    });
    assert.ok(renames[0].label.startsWith('★'));
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

  it('claims tab with managed prefix after restart', () => {
    const stale = `${OMO} ◐ Old task`;
    const snapshot = snap(
      [tab('w0:t1', stale)],
      [agent('w0:p1', 'w0:t1', { title: 'New task' })],
    );
    const { renames, state } = plan(snapshot, { owned: {}, released: [] }, defaultConfig);
    assert.equal(renames.length, 1);
    assert.equal(renames[0].label, `${OMO} ◐ New task`);
    assert.equal(state.owned['w0:t1'], renames[0].label);
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
});

describe('helpers', () => {
  it('glyphFor maps statuses', () => {
    assert.equal(glyphFor('working'), '◐');
    assert.equal(glyphFor('nope'), '○');
  });

  it('stripPrefix removes icon and glyph', () => {
    const label = `${OMO} ◐ Fix login`;
    assert.equal(stripPrefix(label), 'Fix login');
  });

  it('iconFor respects false and overrides', () => {
    assert.equal(iconFor('omo', { icons: false }), '');
    assert.equal(iconFor('omo', { icons: { omo: 'X' } }), 'X');
  });
});

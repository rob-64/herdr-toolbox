import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growPlan, splitPath } from './focus.mjs';

// Captured from a live herdr 0.9.5 tab: left column (p1 over p3), right
// half split down into two rows of two panes each.
const layout = {
  zoomed: false,
  panes: [
    { pane_id: 'p1', rect: { x: 0, y: 0, width: 67, height: 14 } },
    { pane_id: 'p3', rect: { x: 0, y: 14, width: 67, height: 47 } },
    { pane_id: 'p6', rect: { x: 67, y: 0, width: 90, height: 31 } },
    { pane_id: 'p8', rect: { x: 157, y: 0, width: 119, height: 31 } },
    { pane_id: 'p5', rect: { x: 67, y: 31, width: 113, height: 30 } },
    { pane_id: 'p7', rect: { x: 180, y: 31, width: 96, height: 30 } },
  ],
  splits: [
    { id: 'split_0_root', direction: 'right', ratio: 0.244, rect: { x: 0, y: 0, width: 276, height: 61 } },
    { id: 'split_1_0', direction: 'down', ratio: 0.225, rect: { x: 0, y: 0, width: 67, height: 61 } },
    { id: 'split_2_1', direction: 'down', ratio: 0.513, rect: { x: 67, y: 0, width: 209, height: 61 } },
    { id: 'split_3_10', direction: 'right', ratio: 0.43, rect: { x: 67, y: 0, width: 209, height: 31 } },
    { id: 'split_4_11', direction: 'right', ratio: 0.542, rect: { x: 67, y: 31, width: 209, height: 30 } },
  ],
};

test('splitPath decodes herdr split ids', () => {
  assert.deepEqual(splitPath('split_0_root'), []);
  assert.deepEqual(splitPath('split_3_10'), [true, false]);
});

test('growPlan grows the ancestor splits and evens out the rest', () => {
  assert.deepEqual(growPlan(layout, 'p7', 0.7), [
    { path: [], ratio: 0.30000000000000004 },
    { path: [false], ratio: 0.5 },
    { path: [true], ratio: 0.30000000000000004 },
    { path: [true, false], ratio: 0.5 },
    { path: [true, true], ratio: 0.30000000000000004 },
  ]);
  assert.deepEqual(growPlan(layout, 'p1', 0.7), [
    { path: [], ratio: 0.7 },
    { path: [false], ratio: 0.7 },
    { path: [true], ratio: 0.5 },
    { path: [true, false], ratio: 0.5 },
    { path: [true, true], ratio: 0.5 },
  ]);
});

test('growPlan leaves zoomed tabs and unknown panes alone', () => {
  assert.deepEqual(growPlan({ ...layout, zoomed: true }, 'p7', 0.7), []);
  assert.deepEqual(growPlan(layout, 'nope', 0.7), []);
});

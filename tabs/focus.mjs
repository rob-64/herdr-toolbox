/**
 * Focus grow: give the focused pane `share` of every split it sits in.
 *
 * herdr split ids encode the tree path after the depth: `split_3_10` is
 * path [true, false] (true = second child). The root is `split_0_root`.
 */

/** @param {string} id */
export function splitPath(id) {
  const bits = id.split('_')[2];
  if (bits === undefined || bits === 'root') return [];
  return [...bits].map((b) => b === '1');
}

function contains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Ratio changes that grow `paneId` to `share` of each ancestor split and
 * even out every other split, so panes that lost focus shrink back.
 * @param {{ panes: Array<{ pane_id: string, rect: object }>, splits: Array<object>, zoomed?: boolean }} layout
 * @param {string} paneId
 * @param {number} share fraction in (0.5, 1)
 * @returns {Array<{ path: boolean[], ratio: number }>}
 */
export function growPlan(layout, paneId, share) {
  if (layout.zoomed) return [];
  const pane = layout.panes.find((p) => p.pane_id === paneId);
  if (!pane) return [];
  const changes = [];
  for (const split of layout.splits) {
    const r = split.rect;
    if (!contains(r, pane.rect)) {
      if (Math.abs(split.ratio - 0.5) >= 0.01) changes.push({ path: splitPath(split.id), ratio: 0.5 });
      continue;
    }
    const horizontal = split.direction === 'right';
    const start = horizontal ? r.x : r.y;
    const size = horizontal ? r.width : r.height;
    // Compare the pane's center: its edge can sit a rounded cell off the boundary.
    const paneCenter = horizontal
      ? pane.rect.x + pane.rect.width / 2
      : pane.rect.y + pane.rect.height / 2;
    const first = paneCenter < start + split.ratio * size;
    const ratio = first ? share : 1 - share;
    if (Math.abs(ratio - split.ratio) < 0.01) continue;
    changes.push({ path: splitPath(split.id), ratio });
  }
  return changes;
}

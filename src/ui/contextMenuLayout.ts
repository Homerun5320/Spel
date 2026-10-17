// The pure parts of the right-click menu (Ctx-1): where the box goes inside the window and how the arrow keys walk the rows. No DOM, no clock, so the unit tests drive both.
// Loaded lazily with the rest of the menu.

export interface MenuPlacement {
  readonly left: number;
  readonly top: number;
  /** The box never gets taller than this (it scrolls inside). */
  readonly maxHeight: number;
}

/**
 * The top-left corner of a `w` x `h` box that opens at the pointer (`x`, `y`) inside a `vw` x `vh` window with `margin` pixels kept free on every side. The box opens to the
 * right of and below the pointer; where that does not fit it opens to the left / above (flipped), and where neither side fits it is pushed back inside. A box taller than the
 * window gets `maxHeight` = window - 2 margins and sits at the top margin.
 */
export function placeMenu(x: number, y: number, w: number, h: number, vw: number, vh: number, margin: number): MenuPlacement {
  const maxHeight = Math.max(0, vh - 2 * margin);
  const height = Math.min(h, maxHeight);
  const maxLeft = Math.max(margin, vw - margin - w);
  let left = x;
  if (left > maxLeft) left = x - w >= margin ? x - w : maxLeft; // flip to the left of the pointer when there is room, else push back
  left = Math.min(Math.max(left, margin), maxLeft);
  const maxTop = Math.max(margin, vh - margin - height);
  let top = y;
  if (top > maxTop) top = y - height >= margin ? y - height : maxTop;
  top = Math.min(Math.max(top, margin), maxTop);
  return { left, top, maxHeight };
}

/** One walkable row: a group header or an entry of an unfolded group. */
export interface NavRow {
  readonly kind: 'group' | 'entry';
  readonly id: string;
  /** For an entry, the group it sits in; for a header, its own id. */
  readonly group: string;
}

/** The index the arrow keys / Home / End lead to from `index` (-1 = nothing focused yet); wraps round. Returns `index` for any other key. */
export function moveFocus(count: number, index: number, key: string): number {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
  return index;
}

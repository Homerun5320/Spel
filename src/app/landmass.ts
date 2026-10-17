// Connected land masses (M06, the fair-start rule): the cells you can own, 4-neighbour connected (x wraps around the world, y does
// not), exactly the connectivity a Spawn disc walks through. Ice, Peak, Shallows and sea are not land here: a land mass is a set of
// PLAYABLE cells (the classes of `isPlayableClass`), which is what makes "a land mass of at least K cells" a promise that a Spawn
// there claims exactly K cells.
import { isPlayableClass } from '../sim/terrain';

export interface Landmasses {
  readonly width: number;
  readonly height: number;
  /** Land mass index per cell, -1 where the cell is not playable. */
  readonly label: Int32Array;
  /** Cells per land mass index. */
  readonly size: Uint32Array;
}

/** Labels the land masses of a terrain class grid. One pass, no recursion (an explicit queue), O(cells). */
export function computeLandmasses(width: number, height: number, terrain: ArrayLike<number>): Landmasses {
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const sizes: number[] = [];
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || !isPlayableClass(terrain[start] as number)) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const c = queue[head++] as number;
      const x = c % width;
      const y = (c - x) / width;
      const row = y * width;
      const east = row + (x + 1 === width ? 0 : x + 1);
      const west = row + (x === 0 ? width - 1 : x - 1);
      const north = y > 0 ? c - width : -1;
      const south = y + 1 < height ? c + width : -1;
      for (const m of [north, south, east, west]) {
        if (m >= 0 && label[m] === -1 && isPlayableClass(terrain[m] as number)) {
          label[m] = id;
          queue[tail++] = m;
        }
      }
    }
    sizes.push(tail);
  }
  return { width, height, label, size: Uint32Array.from(sizes) };
}

/** The number of cells of the land mass a cell belongs to; 0 for a cell that is not playable (or outside the grid). */
export function landmassSizeAt(land: Landmasses, cell: number): number {
  if (!Number.isInteger(cell) || cell < 0 || cell >= land.label.length) return 0;
  const id = land.label[cell] as number;
  return id < 0 ? 0 : (land.size[id] as number);
}

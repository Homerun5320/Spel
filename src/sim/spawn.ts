// Spawn: a seat claims its capital disc. The K = START_DISC_CELLS nearest CONTIGUOUS unowned playable land cells around the
// chosen cell, taken in order of distance from it (squared Euclidean distance, x wrapping), ties broken by a hash of the
// cell, never by array order. A landmass smaller than K gives all of its cells. The region grows like Prim's algorithm:
// a heap holds the cells next to the claimed region keyed by (distance, hash, cell), the smallest is claimed, its
// unowned land neighbours join the heap. Cost O(K log K) and no scan of the map (the per-cell mark lives in state.scratch
// and is cleared again through the list of cells that were touched).
import { applyStartValues } from './economy';
import { hash2 } from './fixture';
import { REJECT_NONE, REJECT_OWNED, REJECT_SPAWNED, REJECT_TERRAIN } from './intents';
import { START_DISC_CELLS } from './rules';
import { NO_OWNER, seatToOwner, type GameState } from './state';
import { setOwner } from './territory';

/** Salt of the tie-break hash of the capital disc. */
const SPAWN_SALT = 0x5ba7;

/** Heap order: nearer first, then the smaller hash, then the smaller cell index (a total order, no two entries are equal). */
function before(d2: Uint32Array, h: Uint32Array, cells: Int32Array, a: number, b: number): boolean {
  const da = d2[a] as number;
  const db = d2[b] as number;
  if (da !== db) return da < db;
  const ha = h[a] as number;
  const hb = h[b] as number;
  if (ha !== hb) return ha < hb;
  return (cells[a] as number) < (cells[b] as number);
}

/**
 * Claims the disc around `center` for `owner` (an ownerId), stamping every cell with `stamp`. The caller has checked that
 * `center` is playable and unowned. Returns the number of cells claimed (1..START_DISC_CELLS); the claimed cells are
 * appended to `claimed` in claim order when it is given.
 */
export function claimDisc(state: GameState, center: number, owner: number, stamp: number, claimed?: number[]): number {
  const grid = state.grid;
  const seed = state.header.seed;
  const mark = state.scratch.mark;
  // Each claimed cell adds at most 4 entries, each cell enters the heap once.
  const capacity = START_DISC_CELLS * 4 + 8;
  const heapCells = new Int32Array(capacity);
  const heapD2 = new Uint32Array(capacity);
  const heapH = new Uint32Array(capacity);
  const touched = new Int32Array(capacity);
  const nb = new Int32Array(4);
  let size = 0;
  let touchedCount = 0;

  const push = (cell: number): void => {
    mark[cell] = 1;
    touched[touchedCount++] = cell;
    let i = size++;
    heapCells[i] = cell;
    heapD2[i] = grid.distance2(cell, center);
    heapH[i] = hash2(seed, cell, SPAWN_SALT);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heapD2, heapH, heapCells, i, parent)) break;
      swap(parent, i);
      i = parent;
    }
  };
  const swap = (a: number, b: number): void => {
    const c = heapCells[a] as number;
    const d = heapD2[a] as number;
    const h = heapH[a] as number;
    heapCells[a] = heapCells[b] as number;
    heapD2[a] = heapD2[b] as number;
    heapH[a] = heapH[b] as number;
    heapCells[b] = c;
    heapD2[b] = d;
    heapH[b] = h;
  };
  const pop = (): number => {
    const top = heapCells[0] as number;
    size--;
    if (size > 0) {
      heapCells[0] = heapCells[size] as number;
      heapD2[0] = heapD2[size] as number;
      heapH[0] = heapH[size] as number;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < size && before(heapD2, heapH, heapCells, l, m)) m = l;
        if (r < size && before(heapD2, heapH, heapCells, r, m)) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    return top;
  };

  push(center);
  let taken = 0;
  while (size > 0 && taken < START_DISC_CELLS) {
    const cell = pop();
    setOwner(state, cell, owner, stamp);
    if (claimed !== undefined) claimed.push(cell);
    taken++;
    const count = grid.neighbours(cell, nb);
    for (let k = 0; k < count; k++) {
      const c = nb[k] as number;
      if (mark[c] === 0 && grid.playable[c] === 1 && state.owner[c] === 0) push(c);
    }
  }
  for (let i = 0; i < touchedCount; i++) mark[touched[i] as number] = 0;
  return taken;
}

/**
 * Applies a Spawn of `seat` at `cell` (the intent's id is the stamp): REJECT_NONE after claiming the disc, recording the
 * capital and giving the start troops and gold, else the reason it was refused (the state is untouched then).
 */
export function applySpawn(state: GameState, seat: number, cell: number, stamp: number): number {
  const owner = seatToOwner(seat);
  if ((state.capital[owner] as number) !== 0) return REJECT_SPAWNED;
  if (state.grid.playable[cell] !== 1) return REJECT_TERRAIN;
  if (state.owner[cell] !== NO_OWNER) return REJECT_OWNED;
  claimDisc(state, cell, owner, stamp);
  state.capital[owner] = cell + 1;
  applyStartValues(state, owner);
  return REJECT_NONE;
}

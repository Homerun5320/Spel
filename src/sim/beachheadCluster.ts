// The cluster of a helicopter beachhead (M12a-3): a bounded breadth-first search from the seed cell over the owner's cells (the eight neighbours),
// and the cache of the land that is cut off, which the economy leaves out. Pure functions of the state (no random, no clock); the table
// `state.beachheads` keeps the cache DERIVED (never hashed or serialised): it is recomputed from the cells whenever a cell changed owner or a row
// came or went (`dirty`), and a restored state starts dirty, so a restore answers exactly as the straight run does.
//
// "Established" = the search reaches BEACHHEAD_ESTABLISH_CELLS cells or meets a City. Only cut-off clusters (fewer cells, no City) are left out of
// the troop cap, the regeneration and the gold land.
import { BEACHHEAD_CAPACITY, BEACHHEAD_ESTABLISH_CELLS } from './rules';
import { BEACH_CUT_OFF } from './heliTable';
import type { GameState } from './state';
import { STRUCT_CITY } from './structureRules';

/** The cells of the last search, in the order the search found them (the seed first). Valid up to the count `scanCluster` returned. */
export const CLUSTER_CELLS = new Int32Array(BEACHHEAD_ESTABLISH_CELLS);
/** Did the last search meet a City? */
let sawCity = false;

/** True when the last `scanCluster` met a City on one of the cells it counted. */
export function clusterHasCity(): boolean {
  return sawCity;
}

/**
 * Searches the cells connected (8 neighbours, x wrapping, playable, owned by `ownerId`) to `seed`, at most BEACHHEAD_ESTABLISH_CELLS of them
 * (the search stops at that many). Returns the count and leaves the cells in CLUSTER_CELLS and marked 1 in `state.scratch.mark`: the caller MUST
 * call `clearCluster` before anything else uses the marks. Cells already marked are walls to the search (`mark` is not touched for them); 0 when the
 * seed is not the owner's playable cell or is itself marked.
 */
export function scanCluster(state: GameState, seed: number, ownerId: number): number {
  const grid = state.grid;
  const owner = state.owner;
  const playable = grid.playable;
  const mark = state.scratch.mark;
  const w = grid.width;
  const h = grid.cells / w;
  const st = state.structures;
  const cities = st.liveCount !== 0;
  sawCity = false;
  if (owner[seed] !== ownerId || playable[seed] === 0 || mark[seed] !== 0) return 0;
  let size = 0;
  let head = 0;
  mark[seed] = 1;
  CLUSTER_CELLS[size++] = seed;
  while (head < size) {
    const c = CLUSTER_CELLS[head++] as number;
    if (cities) {
      const id = st.idAt(c);
      if (id >= 0 && st.type[id] === STRUCT_CITY) sawCity = true;
    }
    if (size >= BEACHHEAD_ESTABLISH_CELLS) continue; // full: only the City test of the cells that are in
    const x = c % w;
    const y = (c - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx < 0 ? w - 1 : x + dx >= w ? 0 : x + dx;
        const n = yy * w + xx;
        if (mark[n] !== 0 || owner[n] !== ownerId || playable[n] === 0) continue;
        if (size >= BEACHHEAD_ESTABLISH_CELLS) break;
        mark[n] = 1;
        CLUSTER_CELLS[size++] = n;
      }
    }
  }
  return size;
}

/** Clears the marks of the first `count` cells of CLUSTER_CELLS (after a `scanCluster`). */
export function clearCluster(state: GameState, count: number): void {
  const mark = state.scratch.mark;
  for (let i = 0; i < count; i++) mark[CLUSTER_CELLS[i] as number] = 0;
}

/**
 * The Q15 cos-weighted area the economy leaves out for `owner`: the cells of its CUT-OFF beachhead clusters (fewer than BEACHHEAD_ESTABLISH_CELLS
 * cells; a City makes a cluster established at the next check of its row, which frees the row). Zero without beachheads (one comparison). Cheap between changes: one array read. Two clusters that already touch are counted once
 * (the second one's search treats the first one's cells as walls), so the figure never counts a cell twice.
 */
export function cutOffWeightOf(state: GameState, owner: number): number {
  const b = state.beachheads;
  if (b.liveCount === 0) return 0;
  if (b.dirty) refreshCutOff(state);
  return (b.cutWeight as Uint32Array)[owner] as number;
}

/** Recomputes the cache from the cells (a pure function of the state). */
function refreshCutOff(state: GameState): void {
  const b = state.beachheads;
  const slots = state.agg.area.length; // one slot per ownerId (0 = nobody)
  if (b.cutWeight === null || b.cutWeight.length !== slots) b.cutWeight = new Uint32Array(slots);
  const out = b.cutWeight;
  out.fill(0);
  const grid = state.grid;
  const mark = state.scratch.mark;
  // Every cluster of this refresh stays marked until the end, so that two touching clusters are not both added up.
  let kept = 0;
  const keep = REFRESH_KEEP;
  for (let i = 0; i < b.capacity; i++) {
    const ownerId = b.owner[i] as number;
    if (ownerId === 0 || b.status[i] !== BEACH_CUT_OFF) continue;
    const n = scanCluster(state, b.seed[i] as number, ownerId);
    if (n === 0) continue;
    const established = n >= BEACHHEAD_ESTABLISH_CELLS; // a City counts at the next check of the row (heliLanding.ts), not here: the cache depends on the cells only
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const c = CLUSTER_CELLS[k] as number;
      sum += grid.weight(c);
      if (kept < keep.length) keep[kept++] = c; // marks stay for the next cluster of this refresh
    }
    if (!established) out[ownerId] = (out[ownerId] as number) + sum;
  }
  for (let k = 0; k < kept; k++) mark[keep[k] as number] = 0;
  b.dirty = false;
}

/** Cells that stay marked during one refresh (at most BEACHHEAD_CAPACITY clusters of fewer than BEACHHEAD_ESTABLISH_CELLS + 1 cells). */
const REFRESH_KEEP = new Int32Array(BEACHHEAD_CAPACITY * BEACHHEAD_ESTABLISH_CELLS);

/**
 * Does the enclave fill that is marked `fillMark` in `state.scratch.mark` hold the seed of a cut-off beachhead of `ownerId`, or one of the eight cells
 * around it? Such a region is never an enclave (the exemption of DECISIONS M04 audit 5 / M12a-3): a landing behind the enemy line is surrounded by
 * design and must live its 450 ticks. The eight cells cover the diagonal corner cells of a fresh landing.
 */
export function holdsBeachhead(state: GameState, ownerId: number, fillMark: number): boolean {
  const b = state.beachheads;
  if (b.liveCount === 0) return false;
  const mark = state.scratch.mark;
  const w = state.grid.width;
  const h = state.grid.cells / w;
  for (let i = 0; i < b.capacity; i++) {
    if (b.owner[i] !== ownerId || b.status[i] !== BEACH_CUT_OFF) continue;
    const seed = b.seed[i] as number;
    if (mark[seed] === fillMark) return true;
    const x = seed % w;
    const y = (seed - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx < 0 ? w - 1 : x + dx >= w ? 0 : x + dx;
        if (mark[yy * w + xx] === fillMark) return true;
      }
    }
  }
  return false;
}

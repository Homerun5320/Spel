// The enclave phase: land that one player has closed in flips to that player.
//
// An ENCLAVE is a connected region of cells with one owner X (X may be 0, unowned land) such that every cell next to the
// region, outside it, is playable land of ONE other owner S > 0. Sea, Peak and Ice next to the region, a second neighbouring
// owner, or a region larger than ENCLAVE_MAX_CELLS all make it "open": it stays as it is. An enclave changes hands for
// free, all at once.
//
// Which cells are checked: the candidates in the bucket `tick % ENCLAVE_FLIP_TICKS` of the queue (enclaveQueue.ts). A cell
// is queued whenever a cell next to it changes owner (territory.ts), into the bucket given by a hash of the cell, so it is
// checked within ENCLAVE_FLIP_TICKS ticks of the change that may have closed it in. A tick therefore does the work of one
// bucket, at most ENCLAVE_PASS_BUDGET_CELLS visited cells (the rest waits for the next pass), and never scans the map.
import { ENCLAVE_FLIP_TICKS, ENCLAVE_MAX_CELLS, ENCLAVE_PASS_BUDGET_CELLS } from './rules';
import type { GameState } from './state';
import { setOwner } from './territory';

/** Marks in state.scratch.mark during a pass: 1 = in the fill being made, 2 = known open until the pass ends. */
const MARK_FILL = 1;
const MARK_OPEN = 2;

/**
 * Checks the region of `start` and flips it when it is an enclave. Returns the number of cells the fill visited. Cells of a
 * region that stays open are left marked MARK_OPEN and appended to `state.enclaves.touched` (counted by `touchedCount`),
 * so that the pass can clear the marks when it ends.
 */
function checkRegion(state: GameState, start: number): number {
  const grid = state.grid;
  const playable = grid.playable;
  const owner = state.owner;
  const mark = state.scratch.mark;
  const nb = state.scratch.nb;
  const q = state.enclaves;
  const fill = q.fill;
  const x = owner[start] as number;
  let size = 0;
  let head = 0;
  let surround = -1;
  let open = false;
  mark[start] = MARK_FILL;
  fill[size++] = start;
  while (head < size && !open) {
    const c = fill[head++] as number;
    const cnt = grid.neighbours(c, nb);
    for (let k = 0; k < cnt; k++) {
      const m = nb[k] as number;
      if (m === c) continue;
      if (playable[m] === 0) {
        open = true;
        break;
      }
      const o = owner[m] as number;
      if (o === x) {
        const mk = mark[m] as number;
        if (mk === MARK_OPEN) {
          open = true;
          break;
        }
        if (mk === 0) {
          if (size >= ENCLAVE_MAX_CELLS) {
            open = true;
            break;
          }
          mark[m] = MARK_FILL;
          fill[size++] = m;
        }
      } else if (surround === -1) surround = o;
      else if (surround !== o) {
        open = true;
        break;
      }
    }
  }
  if (!open && surround > 0) {
    for (let i = 0; i < size; i++) mark[fill[i] as number] = 0;
    for (let i = 0; i < size; i++) setOwner(state, fill[i] as number, surround, 0);
    state.work.enclaveFlipped += size;
    return size;
  }
  for (let i = 0; i < size; i++) {
    const c = fill[i] as number;
    mark[c] = MARK_OPEN;
    q.touched[q.touchedCount++] = c;
  }
  return size;
}

/** The enclave phase of a tick (see the header of this file). */
export function enclavePhase(state: GameState): void {
  const q = state.enclaves;
  const bucket = state.tick % ENCLAVE_FLIP_TICKS;
  const n = q.counts[bucket] as number;
  if (n === 0) return;
  if (q.batch.length < n) q.batch = new Int32Array(Math.max(n, 2 * q.batch.length));
  const batch = q.batch;
  batch.set((q.buckets[bucket] as Int32Array).subarray(0, n));
  q.counts[bucket] = 0;
  for (let i = 0; i < n; i++) q.queued[batch[i] as number] = 0;
  const mark = state.scratch.mark;
  const playable = state.grid.playable;
  const seed = state.header.seed;
  const work = state.work;
  let visits = 0;
  q.touchedCount = 0;
  for (let i = 0; i < n; i++) {
    if (visits >= ENCLAVE_PASS_BUDGET_CELLS) {
      // Out of budget: the rest of the batch waits for the next pass of its bucket.
      for (let j = i; j < n; j++) q.push(batch[j] as number, seed);
      break;
    }
    const cell = batch[i] as number;
    visits++;
    work.candidates++;
    work.enclaveVisited++;
    if (playable[cell] === 0 || mark[cell] === MARK_OPEN) continue;
    const visited = checkRegion(state, cell);
    visits += visited;
    work.enclaveVisited += visited;
  }
  for (let i = 0; i < q.touchedCount; i++) mark[q.touched[i] as number] = 0;
  q.touchedCount = 0;
}

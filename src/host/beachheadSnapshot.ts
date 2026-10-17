// The beachhead table on its way to the page (Fix-4B), in the pattern of the helicopter snapshot: `snapshotBeachheads` copies the live rows (plus the cells each cluster
// holds now) into plain typed arrays, `beachheadSignature` is a cheap fingerprint the host uses to send the table in a frame's diff only when it changed. Both are called
// by the host, never the page. The cluster search leaves the scratch marks clean; nothing here is game state.
import type { GameState } from '../sim/state';
import { clearCluster, scanCluster } from '../sim/beachheadCluster';
import type { BeachheadSnapshot } from './protocol';

/** A snapshot with no rows (what a mirror holds before the first table). */
export const NO_BEACHHEADS: BeachheadSnapshot = Object.freeze({
  count: 0,
  slot: new Uint8Array(0),
  owner: new Uint16Array(0),
  seed: new Int32Array(0),
  landTick: new Uint32Array(0),
  status: new Uint8Array(0),
  cells: new Uint16Array(0),
});

/** The live rows in slot order, each with the cells its cluster holds now (at most BEACHHEAD_ESTABLISH_CELLS). */
export function snapshotBeachheads(state: GameState): BeachheadSnapshot {
  const b = state.beachheads;
  const n = b.liveCount;
  if (n === 0) return NO_BEACHHEADS;
  const slot = new Uint8Array(n);
  const owner = new Uint16Array(n);
  const seed = new Int32Array(n);
  const landTick = new Uint32Array(n);
  const status = new Uint8Array(n);
  const cells = new Uint16Array(n);
  let k = 0;
  for (let i = 0; i < b.capacity && k < n; i++) {
    const o = b.owner[i] as number;
    if (o === 0) continue;
    slot[k] = i;
    owner[k] = o;
    seed[k] = b.seed[i] as number;
    landTick[k] = b.landTick[i] as number;
    status[k] = b.status[i] as number;
    const c = scanCluster(state, b.seed[i] as number, o);
    clearCluster(state, c);
    cells[k] = c;
    k++;
  }
  return { count: k, slot, owner, seed, landTick, status, cells };
}

/** A 32-bit fingerprint of everything a snapshot carries (FNV-style fold). Costs one cluster search per row, and nothing when there is no row. */
export function beachheadSignature(state: GameState): number {
  const b = state.beachheads;
  let h = 0x811c9dc5;
  const fold = (x: number): void => {
    h = Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0;
  };
  fold(b.liveCount);
  if (b.liveCount === 0) return h;
  for (let i = 0; i < b.capacity; i++) {
    const o = b.owner[i] as number;
    if (o === 0) continue;
    fold(i);
    fold(o);
    fold(b.seed[i] as number);
    fold(b.landTick[i] as number);
    fold(b.status[i] as number);
    const c = scanCluster(state, b.seed[i] as number, o);
    clearCluster(state, c);
    fold(c);
  }
  return h;
}

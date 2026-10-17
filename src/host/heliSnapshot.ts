// The helicopter table on its way to the page (M12a-1): `snapshotHelis` copies the sim's table into plain typed arrays (the host calls it, never the
// page), `heliSignature` is a cheap fingerprint the host uses to send the table in a frame's diff only when it changed. Nothing here is game state.
import type { HeliTable } from '../sim/heliTable';
import type { HeliSight } from '../sim/heliVisibility';
import type { HeliSnapshot } from './protocol';

/**
 * Copies of the table's arrays for the slots 0..highWater-1 (a free slot has owner 0) and the per-owner counts. With `sight` (M17-pre: the viewer's visibility, see
 * src/sim/heliVisibility.ts) a row the viewer may not see is sent as a FREE slot (all zero) and counts for nothing: the page never receives it, ids stay in place.
 */
export function snapshotHelis(t: HeliTable, ownerSlots: number, sight: HeliSight | null = null): HeliSnapshot {
  const n = t.highWater;
  const snap = {
    capacity: t.capacity,
    highWater: n,
    liveCount: t.liveCount,
    owner: t.owner.slice(0, n),
    state: t.state.slice(0, n),
    factory: t.factory.slice(0, n),
    readyTick: t.readyTick.slice(0, n),
    x: t.x.slice(0, n),
    y: t.y.slice(0, n),
    alt: t.alt.slice(0, n),
    hp: t.hp.slice(0, n),
    load: t.load.slice(0, n),
    fuel: t.fuel.slice(0, n),
    counts: new Uint16Array(ownerSlots),
  };
  let live = 0;
  for (let id = 0; id < n; id++) {
    if (snap.owner[id] === 0) continue;
    if (sight !== null && !sight.has(id)) {
      snap.owner[id] = 0;
      snap.state[id] = 0;
      snap.factory[id] = 0;
      snap.readyTick[id] = 0;
      snap.x[id] = 0;
      snap.y[id] = 0;
      snap.alt[id] = 0;
      snap.hp[id] = 0;
      snap.load[id] = 0;
      snap.fuel[id] = 0;
      continue;
    }
    live++;
    const o = snap.owner[id] as number;
    snap.counts[o] = (snap.counts[o] as number) + 1;
  }
  return sight === null ? snap : { ...snap, liveCount: live };
}

/** A 32-bit fingerprint of everything a snapshot carries (FNV-style fold, no allocation). With `sight` only the rows the viewer may see are folded, so a row that comes into or leaves the viewer's sight changes it. */
export function heliSignature(t: HeliTable, sight: HeliSight | null = null): number {
  let h = 0x811c9dc5;
  const fold = (x: number): void => {
    h = Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0;
  };
  fold(t.highWater);
  fold(sight === null ? t.liveCount : sight.count);
  for (let i = 0; i < t.highWater; i++) {
    if (sight !== null && !sight.has(i)) {
      fold(0);
      continue;
    }
    fold(t.owner[i] as number);
    fold(t.state[i] as number);
    fold(t.factory[i] as number);
    fold(t.readyTick[i] as number);
    fold(t.x[i] as number);
    fold(t.y[i] as number);
    fold(t.alt[i] as number);
    fold(t.hp[i] as number);
    fold(t.load[i] as number);
    fold(t.fuel[i] as number);
  }
  return h;
}

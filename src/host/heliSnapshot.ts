// The helicopter table on its way to the page (M12a-1): `snapshotHelis` copies the sim's table into plain typed arrays (the host calls it, never the
// page), `heliSignature` is a cheap fingerprint the host uses to send the table in a frame's diff only when it changed. Nothing here is game state.
import type { HeliTable } from '../sim/heliTable';
import type { HeliSnapshot } from './protocol';

/** Copies of the table's arrays for the slots 0..highWater-1 (a free slot has owner 0) and the per-owner counts. */
export function snapshotHelis(t: HeliTable, ownerSlots: number): HeliSnapshot {
  const n = t.highWater;
  const counts = new Uint16Array(ownerSlots);
  for (let id = 0; id < n; id++) {
    const o = t.owner[id] as number;
    if (o !== 0) counts[o] = (counts[o] as number) + 1;
  }
  return {
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
    counts,
  };
}

/** A 32-bit fingerprint of everything a snapshot carries (FNV-style fold, no allocation). */
export function heliSignature(t: HeliTable): number {
  let h = 0x811c9dc5;
  const fold = (x: number): void => {
    h = Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0;
  };
  fold(t.highWater);
  fold(t.liveCount);
  for (let i = 0; i < t.highWater; i++) {
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

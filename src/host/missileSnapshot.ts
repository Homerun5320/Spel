// The missile table on its way to the page (M14a), in the pattern of the ship snapshot: `snapshotMissiles` copies the live rows into plain typed arrays, `missileSignature` is a cheap
// fingerprint the host uses to send the table in a frame's diff only when it changed. A flight is a pure function of its row, so the table changes only at a launch and at a blast: the
// page works the position out with `missilePosition`. Every missile is visible in v1. Nothing here is game state.
import { MISSILE_CAPACITY } from '../sim/rules';
import type { MissileTable } from '../sim/missileTable';
import type { MissileSnapshot } from './protocol';

/** A snapshot with no rows (what a mirror holds before the first table). */
export const NO_MISSILES: MissileSnapshot = Object.freeze({
  count: 0,
  slot: new Uint8Array(0),
  owner: new Uint16Array(0),
  cls: new Uint8Array(0),
  silo: new Uint16Array(0),
  launchTick: new Uint32Array(0),
  impactTick: new Uint32Array(0),
  startCell: new Int32Array(0),
  targetCell: new Int32Array(0),
  launches: new Uint16Array(0),
});

/** The live rows in slot order, and the launch counters (per ownerId and class). */
export function snapshotMissiles(t: MissileTable): MissileSnapshot {
  const n = t.liveCount;
  const launches = t.launches.slice();
  const slot = new Uint8Array(n);
  const owner = new Uint16Array(n);
  const cls = new Uint8Array(n);
  const silo = new Uint16Array(n);
  const launchTick = new Uint32Array(n);
  const impactTick = new Uint32Array(n);
  const startCell = new Int32Array(n);
  const targetCell = new Int32Array(n);
  let k = 0;
  for (let i = 0; i < MISSILE_CAPACITY && k < n; i++) {
    const o = t.owner[i] as number;
    if (o === 0) continue;
    slot[k] = i;
    owner[k] = o;
    cls[k] = t.cls[i] as number;
    silo[k] = t.silo[i] as number;
    launchTick[k] = t.launchTick[i] as number;
    impactTick[k] = t.impactTick[i] as number;
    startCell[k] = t.startCell[i] as number;
    targetCell[k] = t.targetCell[i] as number;
    k++;
  }
  return { count: k, slot, owner, cls, silo, launchTick, impactTick, startCell, targetCell, launches };
}

/** A 32-bit fingerprint of everything a snapshot carries (FNV-style fold; 64 rows at most and the launch counters). */
export function missileSignature(t: MissileTable): number {
  let h = 0x811c9dc5;
  const fold = (v: number): void => {
    h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0;
  };
  fold(t.liveCount);
  for (let i = 0; i < MISSILE_CAPACITY; i++) {
    const o = t.owner[i] as number;
    if (o === 0) continue;
    fold(i);
    fold(o);
    fold(t.cls[i] as number);
    fold(t.silo[i] as number);
    fold(t.launchTick[i] as number);
    fold(t.impactTick[i] as number);
    fold(t.startCell[i] as number);
    fold(t.targetCell[i] as number);
  }
  for (let i = 0; i < t.launches.length; i++) fold(t.launches[i] as number);
  return h;
}

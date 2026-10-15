// The structure table on its way to the page (M10): `snapshotStructures` copies the sim's table into plain typed arrays (the host calls it,
// never the page), `structureSignature` is a cheap fingerprint the host uses to send the table in a frame's diff only when it changed.
// Nothing here is game state: it reads the table and returns copies.
import type { StructureTable } from '../sim/structures';
import type { StructureSnapshot } from './protocol';

/** Copies of the table's arrays for the slots 0..highWater-1, the delete cooldowns and the per-(owner, type) counts. */
export function snapshotStructures(t: StructureTable): StructureSnapshot {
  const n = t.highWater;
  return {
    capacity: t.capacity,
    highWater: n,
    liveCount: t.liveCount,
    type: t.type.slice(0, n),
    owner: t.owner.slice(0, n),
    cell: t.cell.slice(0, n),
    level: t.level.slice(0, n),
    buildTick: t.buildTick.slice(0, n),
    readyTick: t.readyTick.slice(0, n),
    upgradeReadyTick: t.upgradeReadyTick.slice(0, n),
    deleteReady: t.deleteReady.slice(),
    counts: t.counts.slice(),
  };
}

/** A 32-bit fingerprint of everything a snapshot carries (FNV-style fold, no allocation). Equal tables give equal numbers; a change gives a different one with overwhelming probability. */
export function structureSignature(t: StructureTable): number {
  let h = 0x811c9dc5;
  const fold = (x: number): void => {
    h = Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0;
  };
  fold(t.highWater);
  fold(t.liveCount);
  for (let i = 0; i < t.highWater; i++) {
    fold(t.owner[i] as number);
    fold(t.type[i] as number);
    fold(t.cell[i] as number);
    fold(t.level[i] as number);
    fold(t.buildTick[i] as number);
    fold(t.readyTick[i] as number);
    fold(t.upgradeReadyTick[i] as number);
  }
  for (let i = 0; i < t.deleteReady.length; i++) fold(t.deleteReady[i] as number);
  return h;
}

// The page's copy of the structure table (M10): a `StructureView` over the arrays of the last `StructureSnapshot` the host sent. It is
// replaced as a whole when a frame brings a new table (a few kilobytes; nothing is patched), and the per-cell index is rebuilt then.
// UI, AI-facing helpers (`validateBuild`, the price functions) and the renderer read it exactly like the sim's own table.
import type { StructureView } from '../sim/structureRules';
import { DISTRICT_KIND_SLOTS, type DistrictView } from '../sim/districtRules';
import { STRUCT_TYPE_SLOTS } from '../sim/structureRules';
import type { StructureSnapshot } from './protocol';

const EMPTY: StructureSnapshot = Object.freeze({
  capacity: 0,
  highWater: 0,
  liveCount: 0,
  type: new Uint8Array(0),
  owner: new Uint16Array(0),
  cell: new Int32Array(0),
  level: new Uint8Array(0),
  buildTick: new Uint32Array(0),
  readyTick: new Uint32Array(0),
  upgradeReadyTick: new Uint32Array(0),
  deleteReady: new Uint32Array(0),
  counts: new Uint16Array(0),
  districtKind: new Uint8Array(0),
  districtLevel: new Uint8Array(0),
  districtReadyTick: new Uint32Array(0),
  districtUpgradeReadyTick: new Uint32Array(0),
  districtCounts: new Uint16Array(0),
});

export class MirrorStructures implements StructureView, DistrictView {
  private snap: StructureSnapshot = EMPTY;
  private byCell = new Map<number, number>();
  /** Increases whenever a new table was adopted (the renderer rebuilds its instances only then). */
  version = 0;

  adopt(s: StructureSnapshot): void {
    this.snap = s;
    this.byCell = new Map();
    for (let i = 0; i < s.highWater; i++) if ((s.owner[i] as number) !== 0) this.byCell.set(s.cell[i] as number, i);
    this.version++;
  }

  get capacity(): number {
    return this.snap.capacity;
  }
  get highWater(): number {
    return this.snap.highWater;
  }
  get liveCount(): number {
    return this.snap.liveCount;
  }
  get type(): ArrayLike<number> {
    return this.snap.type;
  }
  get owner(): ArrayLike<number> {
    return this.snap.owner;
  }
  get cell(): ArrayLike<number> {
    return this.snap.cell;
  }
  get level(): ArrayLike<number> {
    return this.snap.level;
  }
  get buildTick(): ArrayLike<number> {
    return this.snap.buildTick;
  }
  get readyTick(): ArrayLike<number> {
    return this.snap.readyTick;
  }
  get upgradeReadyTick(): ArrayLike<number> {
    return this.snap.upgradeReadyTick;
  }
  get districtKind(): ArrayLike<number> {
    return this.snap.districtKind;
  }
  get districtLevel(): ArrayLike<number> {
    return this.snap.districtLevel;
  }
  get districtReadyTick(): ArrayLike<number> {
    return this.snap.districtReadyTick;
  }
  get districtUpgradeReadyTick(): ArrayLike<number> {
    return this.snap.districtUpgradeReadyTick;
  }
  districtsOwned(ownerId: number, kind: number): number {
    if (ownerId < 0 || kind < 0 || kind >= DISTRICT_KIND_SLOTS) return 0;
    return (this.snap.districtCounts[ownerId * DISTRICT_KIND_SLOTS + kind] as number | undefined) ?? 0;
  }
  idAt(cell: number): number {
    return this.byCell.get(cell) ?? -1;
  }
  ownedCount(ownerId: number, type: number): number {
    if (ownerId < 0 || type < 0 || type >= STRUCT_TYPE_SLOTS) return 0;
    return (this.snap.counts[ownerId * STRUCT_TYPE_SLOTS + type] as number | undefined) ?? 0;
  }
  deleteReadyTick(ownerId: number): number {
    return (this.snap.deleteReady[ownerId] as number | undefined) ?? 0;
  }
}

/**
 * How far a structure is built, 0 to 1, at a (fractional) tick: the share of the time from `buildTick` to `readyTick` that has passed.
 * 1 for a finished structure (and for a slot with no build time). The renderer draws it scaled and see-through while it is below 1.
 */
export function structureProgress(s: StructureView, id: number, tick: number): number {
  const from = s.buildTick[id] as number;
  const span = (s.readyTick[id] as number) - from;
  if (span <= 0) return 1;
  const p = (tick - from) / span;
  return p <= 0 ? 0 : p >= 1 ? 1 : p;
}

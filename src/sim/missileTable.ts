// The missile table (M14a): missiles in the air, the launch counters that make the next launch dearer, and the fallout layer. GAME STATE: serialised and hashed (src/sim/serialize.ts).
//
// Structure-of-arrays, MISSILE_CAPACITY slots, owner 0 = a free slot. A new missile takes the LOWEST free slot (a scan of 64: the free list is a pure function of the live rows and needs no stored
// word, as the ship and beachhead tables). A row exists from LaunchMissile until the tick of the blast (`impactTick`). The flight is a pure function of (startCell, targetCell, launchTick,
// impactTick): the position is worked out when somebody asks (src/sim/missileGeom.ts), nothing moves per tick.
//
// The fallout layer (`fallout`) is one u32 per cell: the tick until which the cell is contaminated, 0 = never. An expired value stays in the array (it is part of the state and the hash as long as
// it is there); `falloutCount` is the number of non-zero entries and keeps the hash and the save free of a scan when there are none.
import { foldWord } from './hash';
import { INTERCEPTOR_CAPACITY, MISSILE_CAPACITY } from './rules';

/** Missile classes: the index into the per-class tables of rules.ts. Own names; the numbers are on the wire. */
export const MISSILE_TACTICAL = 0;
export const MISSILE_FISSION = 1;
export const MISSILE_FUSION = 2;
export const MISSILE_CLASS_COUNT = 3;

/** The read-only window onto the missile table (what `SimView.missiles` is). Arrays are indexed by missile id; owner 0 = a free slot. */
export interface MissileView {
  readonly capacity: number;
  /** Missiles in the air. */
  readonly liveCount: number;
  /** ownerId (0 = free slot). */
  readonly owner: ArrayLike<number>;
  /** MISSILE_* class. */
  readonly cls: ArrayLike<number>;
  /** The id of the Silo in the structure table. */
  readonly silo: ArrayLike<number>;
  /** The tick of the launch and the tick of the blast. */
  readonly launchTick: ArrayLike<number>;
  readonly impactTick: ArrayLike<number>;
  /** The cell of the Silo at launch and the cell aimed at. */
  readonly startCell: ArrayLike<number>;
  readonly targetCell: ArrayLike<number>;
  /** How many missiles of `cls` the ownerId has launched so far (the price of the next one follows it). */
  launchesOf(ownerId: number, cls: number): number;
}

export class MissileTable implements MissileView {
  readonly capacity = MISSILE_CAPACITY;
  liveCount = 0;
  readonly owner = new Uint16Array(MISSILE_CAPACITY);
  readonly cls = new Uint8Array(MISSILE_CAPACITY);
  readonly silo = new Uint16Array(MISSILE_CAPACITY);
  readonly launchTick = new Uint32Array(MISSILE_CAPACITY);
  readonly impactTick = new Uint32Array(MISSILE_CAPACITY);
  readonly startCell = new Int32Array(MISSILE_CAPACITY);
  readonly targetCell = new Int32Array(MISSILE_CAPACITY);
  /** Game state: launches so far per (ownerId, class), index ownerId * MISSILE_CLASS_COUNT + class; the price of the next launch follows it. */
  readonly launches: Uint16Array;
  /** Game state: the tick until which each cell is fallout (0 = never). */
  readonly fallout: Uint32Array;
  /** Derived: the number of non-zero entries of `fallout`. */
  falloutCount = 0;
  // The interceptors (M14b, game state): a dense list in firing order. A row is (missile slot, SAM structure id, fire tick, meeting tick, hit); it stays until its MISSILE ends (so a SAM
  // never fires twice at the same warhead) and is dropped by `remove`. The outcome `iHit` was rolled when the interceptor left and applies at the meeting tick.
  interceptorCount = 0;
  readonly iMissile = new Uint8Array(INTERCEPTOR_CAPACITY);
  readonly iSam = new Uint16Array(INTERCEPTOR_CAPACITY);
  readonly iFire = new Uint32Array(INTERCEPTOR_CAPACITY);
  readonly iMeet = new Uint32Array(INTERCEPTOR_CAPACITY);
  readonly iHit = new Uint8Array(INTERCEPTOR_CAPACITY);

  constructor(cells: number, ownerSlotCount: number) {
    this.fallout = new Uint32Array(cells);
    this.launches = new Uint16Array(ownerSlotCount * MISSILE_CLASS_COUNT);
  }

  launchesOf(ownerId: number, cls: number): number {
    const k = ownerId * MISSILE_CLASS_COUNT + cls;
    return k >= 0 && k < this.launches.length ? (this.launches[k] as number) : 0;
  }

  /** The lowest free slot, or -1 when the table is full. */
  freeSlot(): number {
    for (let i = 0; i < MISSILE_CAPACITY; i++) if (this.owner[i] === 0) return i;
    return -1;
  }

  /** Puts a missile in slot `id` (a free one; the caller has checked the rules). */
  add(id: number, ownerId: number, cls: number, silo: number, launchTick: number, impactTick: number, startCell: number, targetCell: number): void {
    this.owner[id] = ownerId;
    this.cls[id] = cls;
    this.silo[id] = silo;
    this.launchTick[id] = launchTick;
    this.impactTick[id] = impactTick;
    this.startCell[id] = startCell;
    this.targetCell[id] = targetCell;
    this.liveCount++;
  }

  /** Has SAM `sam` already fired at missile `missile`? */
  hasInterceptor(missile: number, sam: number): boolean {
    for (let i = 0; i < this.interceptorCount; i++) if (this.iMissile[i] === missile && this.iSam[i] === sam) return true;
    return false;
  }

  /** Appends an interceptor row; false when the table is full. */
  addInterceptor(missile: number, sam: number, fireTick: number, meetTick: number, hit: number): boolean {
    const n = this.interceptorCount;
    if (n >= INTERCEPTOR_CAPACITY) return false;
    this.iMissile[n] = missile;
    this.iSam[n] = sam;
    this.iFire[n] = fireTick;
    this.iMeet[n] = meetTick;
    this.iHit[n] = hit;
    this.interceptorCount = n + 1;
    return true;
  }

  /** Drops every interceptor row of `missile`, keeping the order of the rest. */
  dropInterceptors(missile: number): void {
    let k = 0;
    const n = this.interceptorCount;
    for (let i = 0; i < n; i++) {
      if (this.iMissile[i] === missile) continue;
      if (k !== i) {
        this.iMissile[k] = this.iMissile[i] as number;
        this.iSam[k] = this.iSam[i] as number;
        this.iFire[k] = this.iFire[i] as number;
        this.iMeet[k] = this.iMeet[i] as number;
        this.iHit[k] = this.iHit[i] as number;
      }
      k++;
    }
    this.interceptorCount = k;
  }

  /** Drops every interceptor row fired by SAM structure `sam`, keeping the order of the rest (Fix-6A1: the site was destroyed, so its id may be recycled by another site). */
  dropInterceptorsOfSam(sam: number): void {
    let k = 0;
    const n = this.interceptorCount;
    for (let i = 0; i < n; i++) {
      if (this.iSam[i] === sam) continue;
      if (k !== i) {
        this.iMissile[k] = this.iMissile[i] as number;
        this.iSam[k] = this.iSam[i] as number;
        this.iFire[k] = this.iFire[i] as number;
        this.iMeet[k] = this.iMeet[i] as number;
        this.iHit[k] = this.iHit[i] as number;
      }
      k++;
    }
    this.interceptorCount = k;
  }

  /** Frees a slot (and the interceptors that were fired at it). */
  remove(id: number): void {
    if (this.owner[id] === 0) return;
    if (this.interceptorCount !== 0) this.dropInterceptors(id);
    this.owner[id] = 0;
    this.cls[id] = 0;
    this.silo[id] = 0;
    this.launchTick[id] = 0;
    this.impactTick[id] = 0;
    this.startCell[id] = 0;
    this.targetCell[id] = 0;
    this.liveCount--;
  }

  /** Marks a cell as fallout until `until` (a value of 0 clears it). */
  setFallout(cell: number, until: number): void {
    const was = this.fallout[cell] as number;
    if (was === 0 && until !== 0) this.falloutCount++;
    else if (was !== 0 && until === 0) this.falloutCount--;
    this.fallout[cell] = until;
  }

  /** Recomputes the derived counts from the stored arrays (what deserialize does). */
  rebuildIndex(): void {
    let live = 0;
    for (let id = 0; id < MISSILE_CAPACITY; id++) if (this.owner[id] !== 0) live++;
    this.liveCount = live;
    let n = 0;
    const f = this.fallout;
    for (let i = 0; i < f.length; i++) if (f[i] !== 0) n++;
    this.falloutCount = n;
  }
}

/** Folds the stored part into a running hash: the live rows by ascending id, the launch counters, the fallout entries by ascending cell. */
export function foldMissiles(h: number, t: MissileTable): number {
  let x = foldWord(h, t.liveCount);
  for (let id = 0; id < MISSILE_CAPACITY; id++) {
    if (t.owner[id] === 0) continue;
    x = foldWord(x, id);
    x = foldWord(x, t.owner[id] as number);
    x = foldWord(x, t.cls[id] as number);
    x = foldWord(x, t.silo[id] as number);
    x = foldWord(x, t.launchTick[id] as number);
    x = foldWord(x, t.impactTick[id] as number);
    x = foldWord(x, t.startCell[id] as number);
    x = foldWord(x, t.targetCell[id] as number);
  }
  for (let i = 0; i < t.launches.length; i++) x = foldWord(x, t.launches[i] as number);
  x = foldWord(x, t.falloutCount);
  if (t.falloutCount !== 0) {
    const f = t.fallout;
    for (let i = 0; i < f.length; i++) {
      const v = f[i] as number;
      if (v === 0) continue;
      x = foldWord(x, i);
      x = foldWord(x, v);
    }
  }
  x = foldWord(x, t.interceptorCount);
  for (let i = 0; i < t.interceptorCount; i++) {
    x = foldWord(x, t.iMissile[i] as number);
    x = foldWord(x, t.iSam[i] as number);
    x = foldWord(x, t.iFire[i] as number);
    x = foldWord(x, t.iMeet[i] as number);
    x = foldWord(x, t.iHit[i] as number);
  }
  return x;
}

// SimView: the read-only window onto a match that the UI and the AI read (CHARTER section 2, invariant 6). A view is bound to
// ONE snapshot: width, height, tick, the ownerId array, the terrain class layer and the per-seat statistics all describe the
// same moment. The arrays are typed as read-only index access (`ReadonlyNumbers`): there is no way to write through the type.
//
// Two producers exist. `StateView` (below) wraps a live GameState without copying and is for code that runs in the sim's own
// thread (the AI driver of M09; it is rebuilt by `refresh()` at a tick boundary). `ViewMirror` (src/host/viewMirror.ts) keeps
// typed-array COPIES that the host's events update, and is what the page reads; nothing in a snapshot refers to the sim.
import { ownerCapQt, goldMilliPerTick, ownedStdAreaQ15 } from './economy';
import { PHASE_PLAY, phaseAt, phaseTicksLeft, type MatchPhase } from './flow';
import { TICK_HZ } from './rules';
import { isPlayableClass } from './terrain';
import { ownerSlots, seatToOwner, type GameState } from './state';
import { structGoldMilliPerSec } from './structureEffects';
import { landShareQ15 } from './territory';
import type { StructureView } from './structureRules';
import type { DistrictView } from './districtRules';
import { fillMatchView, matchPackedLength, matchViewOf, type MatchView } from './matchView';

/** An array you can index and measure but not write to (the type of a typed array without its mutators). */
export interface ReadonlyNumbers {
  readonly length: number;
  readonly [index: number]: number;
}

/** The per-seat statistics, in the order of their blocks in the packed array (`statIndex`). All are integers. */
export const STAT_FIELDS = ['troopsQt', 'capQt', 'goldMilli', 'goldPerSecMilli', 'cells', 'landShareQ15', 'alive', 'capital'] as const;
export type StatField = (typeof STAT_FIELDS)[number];
export const STAT_COUNT = STAT_FIELDS.length;

/** Index of seat `seat` in block `field` of a packed statistics array of a match with `seats` seats. */
export function statIndex(field: StatField, seats: number, seat: number): number {
  return STAT_FIELDS.indexOf(field) * seats + seat;
}

/** Length of the packed statistics array of a match. */
export function statsLength(seats: number): number {
  return STAT_COUNT * seats;
}

/**
 * The statistics of every seat, one read-only array per field, indexed by SEAT (0-based; ownerId = seat + 1).
 *  troopsQt, capQt     troops and the troop cap in quarter troops (4 QT = 1 troop)
 *  goldMilli           gold in thousandths; goldPerSecMilli the income per second at the current land, in thousandths
 *  cells               sim cells owned; landShareQ15 the cos-weighted share of all land, Q15 (32768 = everything)
 *  alive               1 while the seat owns land, else 0 (also 0 before it has spawned)
 *  capital             the capital cell + 1, 0 = has not spawned
 */
export interface SeatStatsView {
  readonly seats: number;
  readonly troopsQt: ReadonlyNumbers;
  readonly capQt: ReadonlyNumbers;
  readonly goldMilli: ReadonlyNumbers;
  readonly goldPerSecMilli: ReadonlyNumbers;
  readonly cells: ReadonlyNumbers;
  readonly landShareQ15: ReadonlyNumbers;
  readonly alive: ReadonlyNumbers;
  readonly capital: ReadonlyNumbers;
}

export interface SimView {
  readonly width: number;
  readonly height: number;
  /** Completed steps of the snapshot. */
  readonly tick: number;
  /** Seats in the match (players first, then tribes). */
  readonly seats: number;
  /** Seats 0..players-1 are players (you and the AI nations), the rest are tribes. */
  readonly players: number;
  /** ownerId per cell (0 = unowned), row 0 = north. */
  readonly owner: ReadonlyNumbers;
  /** Increases whenever `owner` changed since the previous snapshot (it may also increase without a change; consumers re-upload / re-scan only when it moved). */
  readonly ownerVersion: number;
  /** Terrain class per cell (the numbering of the baked sim pack), the class layer. */
  readonly terrainClass: ReadonlyNumbers;
  readonly stats: SeatStatsView;
  /** Intents the sim has refused so far. */
  readonly rejects: number;
  /** Match flow (src/sim/flow.ts): PHASE_SPAWN, PHASE_IMMUNITY or PHASE_PLAY. */
  readonly phase: MatchPhase;
  /** Ticks left of the spawn phase or the immunity, 0 in play. */
  readonly phaseTicksLeft: number;
  /** Whether the match runs the match flow (config.spawnPhase); when false `phase` is always PHASE_PLAY. */
  readonly flow: boolean;
  /** Whether the debug intents are enabled (tests only). */
  readonly debugIntents: boolean;
  /**
   * The contact length between two owners in cells: the number of 4-neighbour adjacencies between a playable cell of one and a
   * playable cell of the other (owner 0 = unowned land; sea, Peak and Ice take part in none, so the coast is no contact). 0 for
   * the same owner or for owners that do not touch. Cheap on a StateView (the sim's border index); a ViewMirror scans the map
   * once per ownerVersion.
   */
  contactLength(a: number, b: number): number;
  /** The structure table (M09 part A), read-only: arrays by structure id, `idAt(cell)`, `ownedCount(ownerId, type)`. A ViewMirror carries a copy of it (M10: the host sends the table in the snapshot, src/host/structureMirror.ts). */
  readonly structures: StructureView;
  /** The district table (Districts-1), read-only: kind, level, readyTick and upgradeReadyTick per (structure, slot) at `structureId * DISTRICT_MAX_SLOTS + slot`, and `districtsOwned(ownerId, kind)`. A ViewMirror carries a copy of it with the structure table. */
  readonly districts: DistrictView;
  /** The tick until which a cell is fallout, 0 = not (the FALLOUT_UNTIL layer: zero until M14). */
  falloutUntilAt(cell: number): number;
  /**
   * Whether `attacker` has an attack running on `target` right now (owner ids; owner 0 = unowned land). An attack ends silently when
   * its troops or its front run out, so a seat that wants to call one off (CancelAttack) or to answer one asks first: the sim refuses
   * a CancelAttack of an attack that does not exist (D143).
   */
  attackRunning(attacker: number, target: number): boolean;
  /** The match end (M18-1): result, win progress for the HUD and the per-seat statistics. Read-only; a match without win rules has `winFlags` 0 and never ends. */
  readonly match: MatchView;
}

/**
 * Counts the adjacencies between every pair of owners into `out` (slots * slots, the pair (a, b) with a < b at a * slots + b),
 * the same numbers as the sim's border index (src/sim/borders.ts): east and south neighbours with x wrapping, playable cells only.
 */
export function countContacts(width: number, height: number, owner: ReadonlyNumbers, terrain: ReadonlyNumbers, slots: number, out: Int32Array): void {
  out.fill(0);
  const playable = new Uint8Array(256);
  for (let c = 0; c < 256; c++) playable[c] = isPlayableClass(c) ? 1 : 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const c = row + x;
      if (playable[terrain[c] as number] === 0) continue;
      const o = owner[c] as number;
      const e = x + 1 === width ? row : c + 1;
      if (e !== c && playable[terrain[e] as number] === 1) {
        const r = owner[e] as number;
        if (r !== o) {
          const i = o < r ? o * slots + r : r * slots + o;
          out[i] = (out[i] as number) + 1;
        }
      }
      if (y + 1 < height) {
        const s = c + width;
        if (playable[terrain[s] as number] === 1) {
          const r = owner[s] as number;
          if (r !== o) {
            const i = o < r ? o * slots + r : r * slots + o;
            out[i] = (out[i] as number) + 1;
          }
        }
      }
    }
  }
}

/** The attacks running as pairs (attacker ownerId, target ownerId), one pair per attack in creation order; what a ViewMirror answers `attackRunning` from. */
export function attackPairs(state: GameState): Uint16Array {
  const list = state.attacks.list;
  const out = new Uint16Array(list.length * 2);
  for (let i = 0; i < list.length; i++) {
    const a = list[i] as { attacker: number; target: number };
    out[2 * i] = a.attacker;
    out[2 * i + 1] = a.target;
  }
  return out;
}

/** Packed statistics of a state, written into `out` (statsLength(seats) long). No allocation. */
export function fillSeatStats(state: GameState, out: Uint32Array): void {
  const seats = state.header.seats;
  const base = (field: StatField): number => STAT_FIELDS.indexOf(field) * seats;
  const bTroops = base('troopsQt');
  const bCap = base('capQt');
  const bGold = base('goldMilli');
  const bRate = base('goldPerSecMilli');
  const bCells = base('cells');
  const bShare = base('landShareQ15');
  const bAlive = base('alive');
  const bCapital = base('capital');
  for (let seat = 0; seat < seats; seat++) {
    const owner = seatToOwner(seat);
    const cells = state.agg.area[owner] as number;
    out[bTroops + seat] = state.troops[owner] as number;
    out[bGold + seat] = state.gold[owner] as number;
    out[bCells + seat] = cells;
    out[bAlive + seat] = cells > 0 ? 1 : 0;
    out[bCapital + seat] = state.capital[owner] as number;
    if (cells > 0) {
      out[bCap + seat] = ownerCapQt(state, owner);
      out[bRate + seat] = goldMilliPerTick(ownedStdAreaQ15(state, owner)) * TICK_HZ + structGoldMilliPerSec(state, owner);
      out[bShare + seat] = landShareQ15(state, owner);
    } else {
      out[bCap + seat] = 0;
      out[bRate + seat] = 0;
      out[bShare + seat] = 0;
    }
  }
}

/** Splits a packed statistics array into per-field read-only views over the SAME memory. */
export function statsViewOf(seats: number, packed: Uint32Array): SeatStatsView {
  const f = (field: StatField): Uint32Array => packed.subarray(STAT_FIELDS.indexOf(field) * seats, (STAT_FIELDS.indexOf(field) + 1) * seats);
  return {
    seats,
    troopsQt: f('troopsQt'),
    capQt: f('capQt'),
    goldMilli: f('goldMilli'),
    goldPerSecMilli: f('goldPerSecMilli'),
    cells: f('cells'),
    landShareQ15: f('landShareQ15'),
    alive: f('alive'),
    capital: f('capital'),
  };
}

/**
 * A SimView over a live state, without copying. For code that runs in the sim's own thread and reads between steps (the AI
 * driver of M09); call `refresh()` at every tick boundary before handing the view out. The owner array is the sim's own, typed
 * read-only: the type forbids writing, and nothing but the host that owns the state ever holds the writable form.
 */
export class StateView implements SimView {
  private readonly packed: Uint32Array;
  private readonly matchPacked: Uint32Array;
  private readonly scoreScratch: Uint32Array;
  readonly stats: SeatStatsView;
  readonly match: MatchView;
  ownerVersion = 0;
  private lastOwnerStamp = -1;

  constructor(private readonly state: GameState) {
    const seats = state.header.seats;
    this.packed = new Uint32Array(statsLength(seats));
    this.stats = statsViewOf(seats, this.packed);
    this.matchPacked = new Uint32Array(matchPackedLength(seats));
    this.scoreScratch = new Uint32Array(ownerSlots(seats));
    this.match = matchViewOf(seats, this.matchPacked);
    this.refresh();
  }

  /** Recomputes the statistics; call it after the steps of a frame and before a reader looks. */
  refresh(): void {
    fillSeatStats(this.state, this.packed);
    fillMatchView(this.state, this.matchPacked, this.scoreScratch);
    // The version follows the tick (a StateView cannot see single cell changes); the mirror of the page counts real changes.
    if (this.lastOwnerStamp !== this.state.tick) {
      this.lastOwnerStamp = this.state.tick;
      this.ownerVersion++;
    }
  }

  get width(): number {
    return this.state.width;
  }
  get height(): number {
    return this.state.height;
  }
  get tick(): number {
    return this.state.tick;
  }
  get seats(): number {
    return this.state.header.seats;
  }
  get players(): number {
    return this.state.header.players;
  }
  get owner(): ReadonlyNumbers {
    return this.state.owner;
  }
  get terrainClass(): ReadonlyNumbers {
    return this.state.terrain;
  }
  get rejects(): number {
    return this.state.rejects;
  }
  get flow(): boolean {
    return this.state.header.config.spawnPhase === true;
  }
  get phase(): MatchPhase {
    return this.flow ? phaseAt(this.state.tick) : PHASE_PLAY;
  }
  get phaseTicksLeft(): number {
    return this.flow ? phaseTicksLeft(this.state.tick) : 0;
  }
  get debugIntents(): boolean {
    return this.state.header.config.debugIntents;
  }
  contactLength(a: number, b: number): number {
    return this.state.borders.contact(a, b);
  }
  get structures(): StructureView {
    return this.state.structures;
  }
  get districts(): DistrictView {
    return this.state.structures;
  }
  falloutUntilAt(): number {
    return 0;
  }
  attackRunning(attacker: number, target: number): boolean {
    const slots = this.state.attacks.slots;
    if (attacker < 0 || target < 0 || attacker >= slots || target >= slots) return false;
    return this.state.attacks.find(attacker, target) !== null;
  }
}

// Intents: everything that can change game state, as plain serialisable data. UI, AI and the network emit intents
// and never touch the state; only step() (src/sim/step.ts) applies them.
//
// Every intent has a seat (0-based) and an id (unsigned 32 bit, unique per seat, handed out by an IdAllocator).
// Inside one turn intents run in the canonical order (seat, id, kind, payload); the id is the tie-break between the
// intents of one seat, so the result never depends on the order in which they arrived.
import { STRUCT_CAPACITY } from './rules';
import { MAX_SEATS } from './state';

export type IntentKind = 'Noop' | 'DebugPaint' | 'Spawn' | 'Attack' | 'CancelAttack' | 'DebugGive' | 'Build' | 'Upgrade' | 'Delete';

/** The intent kinds in wire order (the index is the kind byte of the codec). Append only: a published code never changes meaning. */
export const INTENT_KINDS: readonly IntentKind[] = ['Noop', 'DebugPaint', 'Spawn', 'Attack', 'CancelAttack', 'DebugGive', 'Build', 'Upgrade', 'Delete'];

/** Does nothing; valid for any seat. Exists to prove the pipeline (and as the heartbeat of a lockstep client). */
export interface NoopBody {
  readonly kind: 'Noop';
  readonly seat: number;
}

/** Gives one cell to a seat. Valid only when the match config has debugIntents. Kept next to Spawn for the golden scenario and the sensitivity tests (D74). */
export interface DebugPaintBody {
  readonly kind: 'DebugPaint';
  readonly seat: number;
  readonly cell: number;
}

/**
 * A seat claims its capital: the START_DISC_CELLS nearest contiguous unowned land cells around `cell` become its own and
 * it receives its start troops and gold (src/sim/spawn.ts). Refused when the cell is not playable land, is owned, or the
 * seat has spawned before.
 */
export interface SpawnBody {
  readonly kind: 'Spawn';
  readonly seat: number;
  readonly cell: number;
}

/**
 * A seat commits `pct` percent of its current troops (a tribe: troops / TRIBE_ATTACK_DIV, whatever pct says) to an attack on
 * the land of `target`, an ownerId (0 = unowned land). One attack per (attacker, target): a second Attack on the same target
 * adds its troops to the first; an Attack on a seat that is attacking the sender nets the two forces against each other
 * (src/sim/conquest.ts). Refused when the seat has not spawned, the target is the seat itself, the two share no border or
 * the committed amount is zero.
 */
export interface AttackBody {
  readonly kind: 'Attack';
  readonly seat: number;
  /** ownerId of the target, 0 for unowned land. */
  readonly target: number;
  /** Percent of the seat's troops, 1..100. */
  readonly pct: number;
}

/** Ends the attack of `seat` on `target` (an ownerId) and returns its remaining troops to the seat. */
export interface CancelAttackBody {
  readonly kind: 'CancelAttack';
  readonly seat: number;
  readonly target: number;
}

/** The most gold or troops one DebugGive may add (a structural bound of the wire value, not a tunable). */
export const DEBUG_GIVE_MAX = 1000000;

/**
 * TEST ONLY (valid only when the match config has debugIntents): adds `gold` gold and `troops` troops (whole units, 0..DEBUG_GIVE_MAX)
 * to a seat that has land. It is how the test hook `__test.give` changes a seat's purse: through an intent, never by writing
 * the state. M09 extends it with buildings.
 */
export interface DebugGiveBody {
  readonly kind: 'DebugGive';
  readonly seat: number;
  /** Gold in whole gold. */
  readonly gold: number;
  /** Troops in whole troops. */
  readonly troops: number;
}

/**
 * A seat builds a structure of `type` (1 City, 2 Factory, 3 Port, 4 Silo, 5 SAM, 6 Post: src/sim/structureRules.ts) on `cell`. The
 * price is taken at once; the structure works when its build time (BUILD_TICKS) has run out. The refusals are the REJECT_BUILD_* codes.
 */
export interface BuildBody {
  readonly kind: 'Build';
  readonly seat: number;
  readonly type: number;
  readonly cell: number;
}

/** A seat upgrades its structure `structure` (a table id) one level; the price is taken at once, the level rises when the build time has run out. */
export interface UpgradeBody {
  readonly kind: 'Upgrade';
  readonly seat: number;
  readonly structure: number;
}

/** A seat removes its structure `structure` (a table id); nothing is refunded and the seat may not Delete again for DELETE_COOLDOWN_TICKS. */
export interface DeleteBody {
  readonly kind: 'Delete';
  readonly seat: number;
  readonly structure: number;
}

/** An intent before it has an id (what the UI submits to a host). */
export type IntentBody = NoopBody | DebugPaintBody | SpawnBody | AttackBody | CancelAttackBody | DebugGiveBody | BuildBody | UpgradeBody | DeleteBody;

export type Intent = IntentBody & { readonly id: number };

/** Constructors of the intents the AI sends (pure; the host hands out the id). */
export function spawnBody(seat: number, cell: number): SpawnBody {
  return { kind: 'Spawn', seat, cell };
}
export function attackBody(seat: number, target: number, pct: number): AttackBody {
  return { kind: 'Attack', seat, target, pct };
}
export function cancelAttackBody(seat: number, target: number): CancelAttackBody {
  return { kind: 'CancelAttack', seat, target };
}
export function buildBody(seat: number, type: number, cell: number): BuildBody {
  return { kind: 'Build', seat, type, cell };
}
export function upgradeBody(seat: number, structure: number): UpgradeBody {
  return { kind: 'Upgrade', seat, structure };
}
export function deleteBody(seat: number, structure: number): DeleteBody {
  return { kind: 'Delete', seat, structure };
}

/** The intents of one turn: all intents that run in the step that starts at tick `turn`. */
export interface TurnIntents {
  readonly turn: number;
  readonly intents: readonly Intent[];
}

// Reject reasons. 0 means valid. The numbers are part of the outbox, never of the hash.
export const REJECT_NONE = 0;
export const REJECT_SHAPE = 1;
export const REJECT_KIND = 2;
export const REJECT_SEAT = 3;
export const REJECT_ID = 4;
export const REJECT_CELL = 5;
export const REJECT_DISABLED = 6;
export const REJECT_DUPLICATE = 7;
/** Spawn on a cell that cannot be owned (sea, shallows, Peak, Ice). Found by step(), not by validateIntent. */
export const REJECT_TERRAIN = 8;
/** Spawn on a cell somebody already owns. */
export const REJECT_OWNED = 9;
/** Spawn by a seat that has spawned before. */
export const REJECT_SPAWNED = 10;
/** Attack / CancelAttack whose target is not an ownerId of this match (0..seats). */
export const REJECT_TARGET = 11;
/** Attack whose pct is not an integer in 1..100. */
export const REJECT_PCT = 12;
/** Attack by a seat without land (it has not spawned, or has lost everything). */
export const REJECT_NOT_SPAWNED = 13;
/** Attack on the seat's own land. */
export const REJECT_SELF = 14;
/** Attack on a target that does not border the seat. */
export const REJECT_NO_CONTACT = 15;
/** Attack that would commit no troops at all. */
export const REJECT_NO_TROOPS = 16;
/** CancelAttack of an attack that does not exist. */
export const REJECT_NO_ATTACK = 17;
/** Match flow (config.spawnPhase): an Attack during the spawn phase, or a Spawn after it. */
export const REJECT_PHASE = 18;
/** Match flow (config.spawnPhase): an Attack on owned land during the immunity that follows the spawn phase. */
export const REJECT_IMMUNE = 19;
/** DebugGive with a gold or troops amount that is not an integer in 0..DEBUG_GIVE_MAX. */
export const REJECT_AMOUNT = 20;
/** Build of a type that is not 1..6. */
export const REJECT_BUILD_TYPE = 21;
/** Build on a cell the seat does not own. */
export const REJECT_BUILD_NOT_OWNED = 22;
/** Build on a Peak (nothing can be built there). */
export const REJECT_BUILD_PEAK = 23;
/** Build on a Mountain of anything but SAM, Post or Silo. */
export const REJECT_BUILD_MOUNTAIN = 24;
/** A Port on Hills. */
export const REJECT_BUILD_HILLS = 25;
/** A Silo in Forest. */
export const REJECT_BUILD_FOREST = 26;
/** A Port on a cell that is not on the coast. */
export const REJECT_BUILD_NO_COAST = 27;
/** Build on a cell that already has a structure. */
export const REJECT_BUILD_OCCUPIED = 28;
/** Build closer than SPACING_CELLS to a structure in the spacing scope. */
export const REJECT_BUILD_SPACING = 29;
/** Build on fallout. */
export const REJECT_BUILD_FALLOUT = 30;
/** A Silo without a finished Factory of the same seat. */
export const REJECT_BUILD_NO_FACTORY = 31;
/** Build or Upgrade the purse cannot pay. */
export const REJECT_BUILD_GOLD = 32;
/** Build while the structure table is full. */
export const REJECT_BUILD_FULL = 33;
/** Upgrade / Delete of a structure id that does not exist. */
export const REJECT_STRUCT_ID = 34;
/** Upgrade / Delete of another seat's structure. */
export const REJECT_STRUCT_NOT_OWNER = 35;
/** Upgrade of a structure that is at the top level. */
export const REJECT_STRUCT_MAX_LEVEL = 36;
/** Upgrade of a structure that is still being built or upgraded. */
export const REJECT_STRUCT_BUSY = 37;
/** Delete inside the seat's Delete cooldown. */
export const REJECT_DELETE_COOLDOWN = 38;

export interface ValidateContext {
  readonly seats: number;
  readonly cells: number;
  readonly debugIntents: boolean;
}

/** Code of a kind name for sorting and the wire; -1 when unknown. */
export function kindCode(kind: unknown): number {
  for (let i = 0; i < INTENT_KINDS.length; i++) if (INTENT_KINDS[i] === kind) return i;
  return -1;
}

function isIntegerIn(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/** Why an intent is not valid in this match (REJECT_*), or REJECT_NONE. Total: any value whatsoever may be passed in. */
export function validateIntent(x: unknown, ctx: ValidateContext): number {
  if (typeof x !== 'object' || x === null) return REJECT_SHAPE;
  const o = x as { kind?: unknown; seat?: unknown; id?: unknown; cell?: unknown; target?: unknown; pct?: unknown; gold?: unknown; troops?: unknown; type?: unknown; structure?: unknown };
  const code = kindCode(o.kind);
  if (code < 0) return REJECT_KIND;
  if (!isIntegerIn(o.seat, 0, MAX_SEATS - 1) || (o.seat as number) >= ctx.seats) return REJECT_SEAT;
  if (!isIntegerIn(o.id, 0, 4294967295)) return REJECT_ID;
  if (o.kind === 'DebugPaint') {
    if (!ctx.debugIntents) return REJECT_DISABLED;
    if (!isIntegerIn(o.cell, 0, ctx.cells - 1)) return REJECT_CELL;
  } else if (o.kind === 'Spawn') {
    if (!isIntegerIn(o.cell, 0, ctx.cells - 1)) return REJECT_CELL;
  } else if (o.kind === 'Attack') {
    if (!isIntegerIn(o.target, 0, ctx.seats)) return REJECT_TARGET;
    if (!isIntegerIn(o.pct, 1, 100)) return REJECT_PCT;
  } else if (o.kind === 'CancelAttack') {
    if (!isIntegerIn(o.target, 0, ctx.seats)) return REJECT_TARGET;
  } else if (o.kind === 'DebugGive') {
    if (!ctx.debugIntents) return REJECT_DISABLED;
    if (!isIntegerIn(o.gold, 0, DEBUG_GIVE_MAX) || !isIntegerIn(o.troops, 0, DEBUG_GIVE_MAX)) return REJECT_AMOUNT;
  } else if (o.kind === 'Build') {
    if (!isIntegerIn(o.type, 1, 6)) return REJECT_BUILD_TYPE;
    if (!isIntegerIn(o.cell, 0, ctx.cells - 1)) return REJECT_CELL;
  } else if (o.kind === 'Upgrade' || o.kind === 'Delete') {
    if (!isIntegerIn(o.structure, 0, STRUCT_CAPACITY - 1)) return REJECT_STRUCT_ID;
  }
  return REJECT_NONE;
}

/** Orders the payloads of two valid intents of the SAME kind. A new kind adds its case here (all fields, most significant first). */
function comparePayload(a: Intent, b: Intent): number {
  if (a.kind === 'DebugPaint' && b.kind === 'DebugPaint') return a.cell - b.cell;
  if (a.kind === 'Spawn' && b.kind === 'Spawn') return a.cell - b.cell;
  if (a.kind === 'Attack' && b.kind === 'Attack') return a.target !== b.target ? a.target - b.target : a.pct - b.pct;
  if (a.kind === 'CancelAttack' && b.kind === 'CancelAttack') return a.target - b.target;
  if (a.kind === 'DebugGive' && b.kind === 'DebugGive') return a.gold !== b.gold ? a.gold - b.gold : a.troops - b.troops;
  if (a.kind === 'Build' && b.kind === 'Build') return a.type !== b.type ? a.type - b.type : a.cell - b.cell;
  if ((a.kind === 'Upgrade' && b.kind === 'Upgrade') || (a.kind === 'Delete' && b.kind === 'Delete')) return a.structure - b.structure;
  return 0;
}

/** Canonical order of VALID intents: seat, then id, then kind, then payload. A total order on valid intents. */
export function compareIntents(a: Intent, b: Intent): number {
  if (a.seat !== b.seat) return a.seat - b.seat;
  if (a.id !== b.id) return a.id - b.id;
  const ka = kindCode(a.kind);
  const kb = kindCode(b.kind);
  if (ka !== kb) return ka - kb;
  return comparePayload(a, b);
}

/** An intent that step() always refuses (seat -1); what a host stores for input that is not an intent at all. */
export const INVALID_BODY: IntentBody = Object.freeze({ kind: 'Noop', seat: -1 });

/**
 * A fresh copy of an intent body made only from its known fields. Total: input that is not an object, has an unknown
 * kind, or lacks a numeric seat gives INVALID_BODY; other bad field values are copied as they are and refused by step().
 * The copy shares nothing with the input (the host stores copies, never the caller's object).
 */
export function copyBody(x: unknown): IntentBody {
  if (typeof x !== 'object' || x === null) return INVALID_BODY;
  const o = x as { kind?: unknown; seat?: unknown; cell?: unknown; target?: unknown; pct?: unknown; gold?: unknown; troops?: unknown; type?: unknown; structure?: unknown };
  const seat = typeof o.seat === 'number' ? o.seat : -1;
  if (o.kind === 'Noop') return { kind: 'Noop', seat };
  if (o.kind === 'DebugPaint') return { kind: 'DebugPaint', seat, cell: typeof o.cell === 'number' ? o.cell : -1 };
  if (o.kind === 'Spawn') return { kind: 'Spawn', seat, cell: typeof o.cell === 'number' ? o.cell : -1 };
  if (o.kind === 'Attack') return { kind: 'Attack', seat, target: typeof o.target === 'number' ? o.target : -1, pct: typeof o.pct === 'number' ? o.pct : -1 };
  if (o.kind === 'CancelAttack') return { kind: 'CancelAttack', seat, target: typeof o.target === 'number' ? o.target : -1 };
  if (o.kind === 'DebugGive') return { kind: 'DebugGive', seat, gold: typeof o.gold === 'number' ? o.gold : -1, troops: typeof o.troops === 'number' ? o.troops : -1 };
  if (o.kind === 'Build') return { kind: 'Build', seat, type: typeof o.type === 'number' ? o.type : -1, cell: typeof o.cell === 'number' ? o.cell : -1 };
  if (o.kind === 'Upgrade') return { kind: 'Upgrade', seat, structure: typeof o.structure === 'number' ? o.structure : -1 };
  if (o.kind === 'Delete') return { kind: 'Delete', seat, structure: typeof o.structure === 'number' ? o.structure : -1 };
  return INVALID_BODY;
}

/** Attaches an id to a body (a new object). */
export function withId(body: IntentBody, id: number): Intent {
  switch (body.kind) {
    case 'DebugPaint':
      return { kind: 'DebugPaint', seat: body.seat, cell: body.cell, id };
    case 'Spawn':
      return { kind: 'Spawn', seat: body.seat, cell: body.cell, id };
    case 'Attack':
      return { kind: 'Attack', seat: body.seat, target: body.target, pct: body.pct, id };
    case 'CancelAttack':
      return { kind: 'CancelAttack', seat: body.seat, target: body.target, id };
    case 'DebugGive':
      return { kind: 'DebugGive', seat: body.seat, gold: body.gold, troops: body.troops, id };
    case 'Build':
      return { kind: 'Build', seat: body.seat, type: body.type, cell: body.cell, id };
    case 'Upgrade':
      return { kind: 'Upgrade', seat: body.seat, structure: body.structure, id };
    case 'Delete':
      return { kind: 'Delete', seat: body.seat, structure: body.structure, id };
    default:
      return { kind: 'Noop', seat: body.seat, id };
  }
}

/** Hands out intent ids: one counter per seat, starting at 0. A seat outside 0..MAX_SEATS-1 gets id 0 and no counter. */
export class IdAllocator {
  private readonly next = new Uint32Array(MAX_SEATS);

  /** Starts from the counters of an earlier allocator (a copy of `counters`, MAX_SEATS long); omitted = all zero. */
  constructor(counters?: Uint32Array) {
    if (counters !== undefined) this.next.set(counters.subarray(0, MAX_SEATS));
  }

  /** The next id of every seat (a copy): what a resumed allocator needs to carry on. */
  counters(): Uint32Array {
    return this.next.slice();
  }

  alloc(seat: number): number {
    if (!isIntegerIn(seat, 0, MAX_SEATS - 1)) return 0;
    const id = this.next[seat] as number;
    this.next[seat] = id + 1;
    return id;
  }
}

// Intents: everything that can change game state, as plain serialisable data. UI, AI and the network emit intents
// and never touch the state; only step() (src/sim/step.ts) applies them.
//
// Every intent has a seat (0-based) and an id (unsigned 32 bit, unique per seat, handed out by an IdAllocator).
// Inside one turn intents run in the canonical order (seat, id, kind, payload); the id is the tie-break between the
// intents of one seat, so the result never depends on the order in which they arrived.
import { DISTRICT_MAX_SLOTS, HELI_CAPACITY, STRUCT_CAPACITY } from './rules';
import { MAX_SEATS } from './state';

export type IntentKind = 'Noop' | 'DebugPaint' | 'Spawn' | 'Attack' | 'CancelAttack' | 'DebugGive' | 'Build' | 'Upgrade' | 'Delete' | 'BuildDistrict' | 'UpgradeDistrict' | 'RemoveDistrict' | 'ProduceHeli' | 'LaunchHeli' | 'RecallHeli' | 'ProposeTreaty' | 'AcceptTreaty' | 'DeclineTreaty' | 'BreakTreaty' | 'ImposeEmbargo' | 'LiftEmbargo';

/** The intent kinds in wire order (the index is the kind byte of the codec). Append only: a published code never changes meaning. */
export const INTENT_KINDS: readonly IntentKind[] = ['Noop', 'DebugPaint', 'Spawn', 'Attack', 'CancelAttack', 'DebugGive', 'Build', 'Upgrade', 'Delete', 'BuildDistrict', 'UpgradeDistrict', 'RemoveDistrict', 'ProduceHeli', 'LaunchHeli', 'RecallHeli', 'ProposeTreaty', 'AcceptTreaty', 'DeclineTreaty', 'BreakTreaty', 'ImposeEmbargo', 'LiftEmbargo'];

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

/** A seat builds a district of `kind` (1 Housing, 2 Market, 3 Barracks, 4 Walls: src/sim/districtRules.ts) in slot `slot` of its City `structure` (a table id). The price is taken at once; the district works when its build time has run out. */
export interface BuildDistrictBody {
  readonly kind: 'BuildDistrict';
  readonly seat: number;
  readonly structure: number;
  readonly slot: number;
  readonly districtKind: number;
}

/** A seat upgrades the district in slot `slot` of its City `structure` one level (price base * new level, taken at once). */
export interface UpgradeDistrictBody {
  readonly kind: 'UpgradeDistrict';
  readonly seat: number;
  readonly structure: number;
  readonly slot: number;
}

/** A seat removes the district in slot `slot` of its City `structure`; nothing is refunded and the seat's Delete cooldown starts (the same one as a structure Delete). */
export interface RemoveDistrictBody {
  readonly kind: 'RemoveDistrict';
  readonly seat: number;
  readonly structure: number;
  readonly slot: number;
}

/** A seat orders a helicopter in its Factory `factory` (a structure table id): 200 gold at once, ready after 12 s, one at a time per Factory, within the fleet cap. The refusals are the REJECT_HELI_* codes (and REJECT_PHASE in the spawn phase). */
export interface ProduceHeliBody {
  readonly kind: 'ProduceHeli';
  readonly seat: number;
  readonly factory: number;
}

/**
 * A seat sends the parked helicopter of its Factory `factory` (the lowest id in state HELI_PAD) with `troops` (1..HELI_MAX_TROOPS, taken from the seat's
 * troops at once) to the landing zone `lzCell` in flight mode `altMode` (0 = Low, 1 = High). The refusals are REJECT_PHASE, REJECT_HELI_NO_FACTORY,
 * REJECT_HELI_NOT_OWNER, REJECT_HELI_NO_PAD, REJECT_HELI_BAD_TROOPS, the landing-zone reason of `scoreLz` (65..72) and REJECT_HELI_NO_ROUTE.
 */
export interface LaunchHeliBody {
  readonly kind: 'LaunchHeli';
  readonly seat: number;
  readonly factory: number;
  readonly lzCell: number;
  readonly troops: number;
  readonly altMode: number;
}

/** A seat sends its airborne helicopter `heli` (a helicopter table id) home to the nearest own Factory; a load it still carries goes back to the seat on arrival. */
export interface RecallHeliBody {
  readonly kind: 'RecallHeli';
  readonly seat: number;
  readonly heli: number;
}

/**
 * M18c-1 (wire kinds 15 to 20): a seat proposes a treaty to the player seat `to`: `treaty` 1 = truce (TRUCE_TICKS from the acceptance), 2 = alliance (until somebody breaks it).
 * At most one open proposal per directed pair; it lasts PROPOSAL_TTL_TICKS. All seats in these bodies are SEATS (0-based), never ownerIds. The refusals are the REJECT_DIPLO_* codes.
 */
export interface ProposeTreatyBody {
  readonly kind: 'ProposeTreaty';
  readonly seat: number;
  readonly to: number;
  readonly treaty: number;
}

/** A seat accepts the open proposal that `from` made to it: the relation changes at once, in both directions, and attacks between the two are called off. */
export interface AcceptTreatyBody {
  readonly kind: 'AcceptTreaty';
  readonly seat: number;
  readonly from: number;
}

/** A seat declines (removes) the open proposal that `from` made to it. */
export interface DeclineTreatyBody {
  readonly kind: 'DeclineTreaty';
  readonly seat: number;
  readonly from: number;
}

/** A seat breaks its truce or alliance with `with`: war at once, the betrayal cooldown starts and the betrayal is counted. */
export interface BreakTreatyBody {
  readonly kind: 'BreakTreaty';
  readonly seat: number;
  readonly with: number;
}

/** A seat puts an embargo on `target`: the trade between their Ports is worth nothing to either, until the seat lifts it. Free of charge, one-sided to impose, two-sided in effect. */
export interface ImposeEmbargoBody {
  readonly kind: 'ImposeEmbargo';
  readonly seat: number;
  readonly target: number;
}

/** A seat lifts the embargo it put on `target` (the trade resumes unless `target` has an embargo of its own on the seat). */
export interface LiftEmbargoBody {
  readonly kind: 'LiftEmbargo';
  readonly seat: number;
  readonly target: number;
}

/** An intent before it has an id (what the UI submits to a host). */
export type IntentBody = NoopBody | DebugPaintBody | SpawnBody | AttackBody | CancelAttackBody | DebugGiveBody | BuildBody | UpgradeBody | DeleteBody | BuildDistrictBody | UpgradeDistrictBody | RemoveDistrictBody | ProduceHeliBody | LaunchHeliBody | RecallHeliBody | ProposeTreatyBody | AcceptTreatyBody | DeclineTreatyBody | BreakTreatyBody | ImposeEmbargoBody | LiftEmbargoBody;

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
export function buildDistrictBody(seat: number, structure: number, slot: number, districtKind: number): BuildDistrictBody {
  return { kind: 'BuildDistrict', seat, structure, slot, districtKind };
}
export function upgradeDistrictBody(seat: number, structure: number, slot: number): UpgradeDistrictBody {
  return { kind: 'UpgradeDistrict', seat, structure, slot };
}
export function removeDistrictBody(seat: number, structure: number, slot: number): RemoveDistrictBody {
  return { kind: 'RemoveDistrict', seat, structure, slot };
}

export function produceHeliBody(seat: number, factory: number): ProduceHeliBody {
  return { kind: 'ProduceHeli', seat, factory };
}

export function launchHeliBody(seat: number, factory: number, lzCell: number, troops: number, altMode: number): LaunchHeliBody {
  return { kind: 'LaunchHeli', seat, factory, lzCell, troops, altMode };
}
export function recallHeliBody(seat: number, heli: number): RecallHeliBody {
  return { kind: 'RecallHeli', seat, heli };
}

export function proposeTreatyBody(seat: number, to: number, treaty: number): ProposeTreatyBody {
  return { kind: 'ProposeTreaty', seat, to, treaty };
}
export function acceptTreatyBody(seat: number, from: number): AcceptTreatyBody {
  return { kind: 'AcceptTreaty', seat, from };
}
export function declineTreatyBody(seat: number, from: number): DeclineTreatyBody {
  return { kind: 'DeclineTreaty', seat, from };
}
export function breakTreatyBody(seat: number, withSeat: number): BreakTreatyBody {
  return { kind: 'BreakTreaty', seat, with: withSeat };
}
export function imposeEmbargoBody(seat: number, target: number): ImposeEmbargoBody {
  return { kind: 'ImposeEmbargo', seat, target };
}
export function liftEmbargoBody(seat: number, target: number): LiftEmbargoBody {
  return { kind: 'LiftEmbargo', seat, target };
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
/** District intent on a structure that is not a City. */
export const REJECT_DISTRICT_NOT_CITY = 39;
/** District intent on a slot the City's level does not have (or a slot number outside 0..DISTRICT_MAX_SLOTS - 1). */
export const REJECT_DISTRICT_SLOT = 40;
/** BuildDistrict on a slot that holds a district. */
export const REJECT_DISTRICT_OCCUPIED = 41;
/** UpgradeDistrict / RemoveDistrict on an empty slot. */
export const REJECT_DISTRICT_EMPTY = 42;
/** BuildDistrict of a kind that is not 1..4. */
export const REJECT_DISTRICT_KIND = 43;
/** BuildDistrict in a City that is still being built. */
export const REJECT_DISTRICT_CITY_BUILDING = 44;

/** ProduceHeli on a structure that is not a live Factory (no such id, a free slot, or another type). */
export const REJECT_HELI_NO_FACTORY = 45;
/** ProduceHeli in another seat's Factory. */
export const REJECT_HELI_NOT_OWNER = 46;
/** ProduceHeli in a Factory that is still being built. */
export const REJECT_HELI_FACTORY_BUILDING = 47;
/** ProduceHeli in a Factory that already has a helicopter under production (one at a time per Factory). */
export const REJECT_HELI_QUEUE_BUSY = 48;
/** ProduceHeli beyond the fleet cap (2 + the sum of the Factory levels, at most 12; a helicopter under production counts). */
export const REJECT_HELI_FLEET_CAP = 49;
/** ProduceHeli the purse cannot pay. */
export const REJECT_HELI_NO_GOLD = 50;
/** LaunchHeli from a Factory with no helicopter parked on its pad. */
export const REJECT_HELI_NO_PAD = 51;
/** LaunchHeli with 0 troops, more than HELI_MAX_TROOPS, or more than the seat has. */
export const REJECT_HELI_BAD_TROOPS = 52;
/** LaunchHeli whose route cannot be planned (or does not fit the route buffer, or the world has no occluder layer). */
export const REJECT_HELI_NO_ROUTE = 53;
/** RecallHeli of a helicopter that is not in the air on a mission (no such helicopter, parked, in production, already returning or down). */
export const REJECT_HELI_NOT_FLYING = 54;
/** ProduceHeli while the global helicopter table (HELI_CAPACITY slots, all seats) is full (Fix-4A1; the seat's own fleet cap is REJECT_HELI_FLEET_CAP). */
export const REJECT_HELI_TABLE_FULL = 57;
/** LaunchHeli while the global beachhead table (BEACHHEAD_CAPACITY rows) is full: a landing would hold its land for ever, so no helicopter leaves (Fix-4A1). */
export const REJECT_HELI_BEACHHEAD_FULL = 58;

// M18c-1: the diplomacy refusals. Codes 55 to 63 and 73 to 79 are left to the helicopter milestone (landing-zone codes are 65..72), these start at 80.
/** Diplomacy intent whose target seat is not a player (a tribe). Also: a tribe as the sender. */
export const REJECT_DIPLO_NOT_PLAYER = 80;
/** Diplomacy intent aimed at the sender itself. */
export const REJECT_DIPLO_SELF = 81;
/** ProposeTreaty of a truce while there is a truce or an alliance already. */
export const REJECT_DIPLO_AT_PEACE = 82;
/** ProposeTreaty of an alliance while there is one already. */
export const REJECT_DIPLO_ALLIED = 83;
/** ProposeTreaty while the sender already has an open proposal to the same seat. */
export const REJECT_DIPLO_PENDING = 84;
/** AcceptTreaty / DeclineTreaty without an open proposal (none was made, or it ran out, or was answered). */
export const REJECT_DIPLO_NO_PROPOSAL = 85;
/** ProposeTreaty inside the sender's betrayal cooldown. */
export const REJECT_DIPLO_COOLDOWN = 86;
/** BreakTreaty without a treaty. */
export const REJECT_DIPLO_NO_TREATY = 87;
/** A diplomacy intent by or at a seat that has been eliminated. */
export const REJECT_DIPLO_ELIMINATED = 88;
/** A diplomacy intent after the match has ended. */
export const REJECT_DIPLO_MATCH_ENDED = 89;
/** Attack on a seat the attacker has a truce or an alliance with. */
export const REJECT_DIPLO_TREATY_BOUND = 90;
/** ImposeEmbargo on a seat the sender already has an embargo on. */
export const REJECT_DIPLO_EMBARGO_SET = 91;
/** LiftEmbargo of an embargo the sender did not put on. */
export const REJECT_DIPLO_EMBARGO_NONE = 92;
/** ProposeTreaty while the proposal table is full. */
export const REJECT_DIPLO_FULL = 93;

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
  const o = x as { kind?: unknown; seat?: unknown; id?: unknown; cell?: unknown; target?: unknown; pct?: unknown; gold?: unknown; troops?: unknown; type?: unknown; structure?: unknown; slot?: unknown; districtKind?: unknown; factory?: unknown; lzCell?: unknown; altMode?: unknown; heli?: unknown; to?: unknown; treaty?: unknown; from?: unknown; with?: unknown };
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
  } else if (o.kind === 'ProduceHeli') {
    if (!isIntegerIn(o.factory, 0, STRUCT_CAPACITY - 1)) return REJECT_STRUCT_ID;
  } else if (o.kind === 'LaunchHeli') {
    if (!isIntegerIn(o.factory, 0, STRUCT_CAPACITY - 1)) return REJECT_STRUCT_ID;
    if (!isIntegerIn(o.lzCell, 0, ctx.cells - 1)) return REJECT_CELL;
    if (!isIntegerIn(o.troops, 0, 4294967295)) return REJECT_AMOUNT;
    if (!isIntegerIn(o.altMode, 0, 1)) return REJECT_SHAPE;
  } else if (o.kind === 'RecallHeli') {
    if (!isIntegerIn(o.heli, 0, HELI_CAPACITY - 1)) return REJECT_ID;
  } else if (o.kind === 'ProposeTreaty') {
    if (!isIntegerIn(o.to, 0, ctx.seats - 1)) return REJECT_TARGET;
    if (!isIntegerIn(o.treaty, 1, 2)) return REJECT_SHAPE;
  } else if (o.kind === 'AcceptTreaty' || o.kind === 'DeclineTreaty') {
    if (!isIntegerIn(o.from, 0, ctx.seats - 1)) return REJECT_TARGET;
  } else if (o.kind === 'BreakTreaty') {
    if (!isIntegerIn(o.with, 0, ctx.seats - 1)) return REJECT_TARGET;
  } else if (o.kind === 'ImposeEmbargo' || o.kind === 'LiftEmbargo') {
    if (!isIntegerIn(o.target, 0, ctx.seats - 1)) return REJECT_TARGET;
  } else if (o.kind === 'BuildDistrict' || o.kind === 'UpgradeDistrict' || o.kind === 'RemoveDistrict') {
    if (!isIntegerIn(o.structure, 0, STRUCT_CAPACITY - 1)) return REJECT_STRUCT_ID;
    if (!isIntegerIn(o.slot, 0, DISTRICT_MAX_SLOTS - 1)) return REJECT_DISTRICT_SLOT;
    if (o.kind === 'BuildDistrict' && !isIntegerIn(o.districtKind, 1, 4)) return REJECT_DISTRICT_KIND;
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
  if (a.kind === 'BuildDistrict' && b.kind === 'BuildDistrict') {
    if (a.structure !== b.structure) return a.structure - b.structure;
    return a.slot !== b.slot ? a.slot - b.slot : a.districtKind - b.districtKind;
  }
  if (a.kind === 'ProduceHeli' && b.kind === 'ProduceHeli') return a.factory - b.factory;
  if (a.kind === 'LaunchHeli' && b.kind === 'LaunchHeli') {
    if (a.factory !== b.factory) return a.factory - b.factory;
    if (a.lzCell !== b.lzCell) return a.lzCell - b.lzCell;
    return a.troops !== b.troops ? a.troops - b.troops : a.altMode - b.altMode;
  }
  if (a.kind === 'RecallHeli' && b.kind === 'RecallHeli') return a.heli - b.heli;
  if (a.kind === 'ProposeTreaty' && b.kind === 'ProposeTreaty') return a.to !== b.to ? a.to - b.to : a.treaty - b.treaty;
  if ((a.kind === 'AcceptTreaty' && b.kind === 'AcceptTreaty') || (a.kind === 'DeclineTreaty' && b.kind === 'DeclineTreaty')) return a.from - b.from;
  if (a.kind === 'BreakTreaty' && b.kind === 'BreakTreaty') return a.with - b.with;
  if ((a.kind === 'ImposeEmbargo' && b.kind === 'ImposeEmbargo') || (a.kind === 'LiftEmbargo' && b.kind === 'LiftEmbargo')) return a.target - b.target;
  if ((a.kind === 'UpgradeDistrict' && b.kind === 'UpgradeDistrict') || (a.kind === 'RemoveDistrict' && b.kind === 'RemoveDistrict')) {
    return a.structure !== b.structure ? a.structure - b.structure : a.slot - b.slot;
  }
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
  const o = x as { kind?: unknown; seat?: unknown; cell?: unknown; target?: unknown; pct?: unknown; gold?: unknown; troops?: unknown; type?: unknown; structure?: unknown; slot?: unknown; districtKind?: unknown; factory?: unknown; lzCell?: unknown; altMode?: unknown; heli?: unknown; to?: unknown; treaty?: unknown; from?: unknown; with?: unknown };
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
  const num = (v: unknown): number => (typeof v === 'number' ? v : -1);
  if (o.kind === 'BuildDistrict') return { kind: 'BuildDistrict', seat, structure: num(o.structure), slot: num(o.slot), districtKind: num(o.districtKind) };
  if (o.kind === 'UpgradeDistrict') return { kind: 'UpgradeDistrict', seat, structure: num(o.structure), slot: num(o.slot) };
  if (o.kind === 'RemoveDistrict') return { kind: 'RemoveDistrict', seat, structure: num(o.structure), slot: num(o.slot) };
  if (o.kind === 'ProduceHeli') return { kind: 'ProduceHeli', seat, factory: num(o.factory) };
  if (o.kind === 'LaunchHeli') return { kind: 'LaunchHeli', seat, factory: num(o.factory), lzCell: num(o.lzCell), troops: num(o.troops), altMode: num(o.altMode) };
  if (o.kind === 'RecallHeli') return { kind: 'RecallHeli', seat, heli: num(o.heli) };
  if (o.kind === 'ProposeTreaty') return { kind: 'ProposeTreaty', seat, to: num(o.to), treaty: num(o.treaty) };
  if (o.kind === 'AcceptTreaty') return { kind: 'AcceptTreaty', seat, from: num(o.from) };
  if (o.kind === 'DeclineTreaty') return { kind: 'DeclineTreaty', seat, from: num(o.from) };
  if (o.kind === 'BreakTreaty') return { kind: 'BreakTreaty', seat, with: num(o.with) };
  if (o.kind === 'ImposeEmbargo') return { kind: 'ImposeEmbargo', seat, target: num(o.target) };
  if (o.kind === 'LiftEmbargo') return { kind: 'LiftEmbargo', seat, target: num(o.target) };
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
    case 'BuildDistrict':
      return { kind: 'BuildDistrict', seat: body.seat, structure: body.structure, slot: body.slot, districtKind: body.districtKind, id };
    case 'UpgradeDistrict':
      return { kind: 'UpgradeDistrict', seat: body.seat, structure: body.structure, slot: body.slot, id };
    case 'RemoveDistrict':
      return { kind: 'RemoveDistrict', seat: body.seat, structure: body.structure, slot: body.slot, id };
    case 'ProduceHeli':
      return { kind: 'ProduceHeli', seat: body.seat, factory: body.factory, id };
    case 'LaunchHeli':
      return { kind: 'LaunchHeli', seat: body.seat, factory: body.factory, lzCell: body.lzCell, troops: body.troops, altMode: body.altMode, id };
    case 'RecallHeli':
      return { kind: 'RecallHeli', seat: body.seat, heli: body.heli, id };
    case 'ProposeTreaty':
      return { kind: 'ProposeTreaty', seat: body.seat, to: body.to, treaty: body.treaty, id };
    case 'AcceptTreaty':
      return { kind: 'AcceptTreaty', seat: body.seat, from: body.from, id };
    case 'DeclineTreaty':
      return { kind: 'DeclineTreaty', seat: body.seat, from: body.from, id };
    case 'BreakTreaty':
      return { kind: 'BreakTreaty', seat: body.seat, with: body.with, id };
    case 'ImposeEmbargo':
      return { kind: 'ImposeEmbargo', seat: body.seat, target: body.target, id };
    case 'LiftEmbargo':
      return { kind: 'LiftEmbargo', seat: body.seat, target: body.target, id };
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

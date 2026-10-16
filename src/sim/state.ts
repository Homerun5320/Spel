// The game state: structure-of-arrays, parameterised by (width, height). Typed arrays and plain integers only.
//
// Seats are 0-based; ownerId = seat + 1 and 0 means unowned. seatToOwner / ownerToSeat below are the ONLY place where
// the two are converted: intents and seat lists use `seat`, ownership arrays and textures use `ownerId`.
import { AttackTable } from './attacks';
import { BorderIndex } from './borders';
import { EnclaveQueues } from './enclaveQueue';
import { SimEnv } from './env';
import { BeachheadTable, HeliTable } from './heliTable';
import { Grid, rowCosFromLut } from './grid';
import { foldBytes, foldU16, finishHash, FNV_OFFSET } from './hash';
import { createHomeRules, type HomeRules } from './homeRules';
import { MatchState, normalWin, type WinConfig } from './matchState';
import { DiplomacyTable } from './diplomacyTable';
import { Outbox } from './outbox';
import { StructureTable } from './structures';
import { createRng } from './rng';
import { WEIGHT_ONE } from './rules';
import { WorkCounters } from './work';

/** Bumped whenever a rule, a constant in rules.ts or the meaning of a state array changes. Part of the match header. 2: M04 (economy, Spawn, owner arrays). 3: M04 conquest (attacks, enclaves, calibrated constants). 4: M04 fix pass (the exposure array, the enclave candidate rule). 5: the M05 audit (terrain slows the capture, K 123). 6: the tempo pass, D142 (capture K 123 -> 420, troop regeneration 8 + 0.35 sqrt(T) -> 24 + 1.0 sqrt(T)). 7: M09 part A (the structure table is part of the state and the hash). 8: M09 part B (structure effects on troop cap and gold, Defense Post price, conquest of structures, embargo flags). 9: M09 part C (level effects of Factory and Port, the 3-City Factory cap, the Port income cap). 10: Districts-1 (the district table in the state and the hash, three district intents, their effects on gold, troop cap, regeneration and the attacker's cell price). 11: M18-1 (the match end: win block in the config, result, hold timer and statistics in the state and the hash; the anti-snowball discount in the cell price). 12: Sim-Growth (spacing per type, City levels 1 to 10 with small steps and their own price and time, five district slots, lower Market gold). 13: Sim-Levels2 (unlimited levels up to 999, one upgrade price rule base * L for every type and district, concave level curves with asymptotes, conquest keeps 75 percent of a level). 14: M12a-1 (the helicopter and beachhead tables in the state and the hash, the ProduceHeli intent with its price, time and fleet cap, Los / Nav reachable from step). 15: M12a-2 (LaunchHeli and RecallHeli, the helicopter flight with fuel, terrain following and return). 16: M12a-3 (the landing at the Attack cell price, the beachhead and its cut-off cluster that returns to neutral after 450 ticks, the cut-off land left out of the economy, the enclave exemption). 17: M18c-1 (diplomacy: relations, proposals, betrayal cooldowns and embargo owners in the state and the hash, six intents, the attack ban between treaty parties, alliance trade). 18: M18c-2 (the AI temperament: a more willing truce answer, a leader threshold of 25 percent, the truce proposal to the most frequent attacker; no state layout change). 19: Fix-4A1 (audit 3 helicopter, beachhead and treaty rules). 20: M12b (air defence: Defense Posts and SAM sites bring hostile helicopters down, the salvo clock in the structure table, a repaired helicopter on the pad). 21: M18d-1 (technology: 16 techs, the research state per seat in the match block and the hash, two intents, effects on gold, upgrade price, cell price, regeneration, troop cap, helicopter load / speed / fuel / fleet, SAM hit and salvo, Walls and Post). 22: M18b-2 (federations: a pair of sub-nations can be bound by an alliance with `until` 1 that BreakTreaty refuses; the match setup splits a country into allied sub-nations). */
export const ENGINE_VERSION = 22;

// Structural limits (not tunables): a seat is one byte on the wire (intents), so 255 seats at most; ownerId is a Uint16
// (room for tribes after the players), a cell index must stay below 2^22.
export const MAX_SEATS = 255;
export const MAX_DIMENSION = 4096;
export const MAX_CELLS = 4194304;

/** ownerId of a cell nobody owns. */
export const NO_OWNER = 0;
/** What ownerToSeat returns for NO_OWNER. */
export const NO_SEAT = -1;

/** The ownerId of a seat. */
export function seatToOwner(seat: number): number {
  return seat + 1;
}

/** Number of slots of a per-ownerId array: slot 0 is the unowned pseudo-owner, slots 1..seats the seats. The other place where the + 1 of ownerId = seat + 1 lives. */
export function ownerSlots(seats: number): number {
  return seats + 1;
}

/** The seat of an ownerId, or NO_SEAT for NO_OWNER. */
export function ownerToSeat(ownerId: number): number {
  return ownerId - 1;
}

/** Match options that change what is legal. Serialised as flag bits (CONFIG_FLAG_*). */
export interface MatchConfig {
  /** Allows the debug intents (DebugPaint, DebugGive). Always false in a real match. */
  readonly debugIntents: boolean;
  /**
   * The match flow of M05 (D92): during the first SPAWN_PHASE_TICKS no Attack is legal and a Spawn is legal only then; for the
   * IMMUNITY_TICKS after it an Attack on owned land is refused. Absent / false = the rules of M04 (unlimited Spawn, no immunity).
   */
  readonly spawnPhase?: boolean;
  /**
   * Home land and nation traits (M06, D112): the state carries `home` (country per cell, home country and trait multipliers per
   * seat); the owner of a home land pays half for its own country's cells, an attacker pays an owner's defence multiplier. Absent /
   * false = the rules of M05, and the state has no `home`, is not serialised with one and hashes as before.
   */
  readonly homeRules?: boolean;
  /**
   * The win conditions (M18-1): which of the three are on and their numbers. Absent, or all three off = the match never ends (every
   * pre-M18 test and golden match). Serialised in the match block of the state, not in the flag word; normalised by `normalWin`.
   */
  readonly win?: WinConfig;
}

export const CONFIG_FLAG_DEBUG_INTENTS = 1;
/** Bit 2 is left unused on purpose (tests/sim/serialize.test.ts pins it as an unknown bit). */
export const CONFIG_FLAG_SPAWN_PHASE = 4;
/** Bit 3 (value 8): the match has home rules (D112). */
export const CONFIG_FLAG_HOME_RULES = 8;
/** All flag bits this engine knows; a snapshot with other bits is refused. */
export const CONFIG_FLAGS_KNOWN = CONFIG_FLAG_DEBUG_INTENTS | CONFIG_FLAG_SPAWN_PHASE | CONFIG_FLAG_HOME_RULES;

export function configToFlags(config: MatchConfig): number {
  return (config.debugIntents ? CONFIG_FLAG_DEBUG_INTENTS : 0) | (config.spawnPhase === true ? CONFIG_FLAG_SPAWN_PHASE : 0) | (config.homeRules === true ? CONFIG_FLAG_HOME_RULES : 0);
}

/** A config with only the keys that are on (so that an M05 config compares equal to itself after a round trip). */
export function normalConfig(debugIntents: boolean, spawnPhase: boolean, homeRules: boolean, win?: WinConfig): MatchConfig {
  const c: { debugIntents: boolean; spawnPhase?: boolean; homeRules?: boolean; win?: WinConfig } = { debugIntents };
  if (spawnPhase) c.spawnPhase = true;
  if (homeRules) c.homeRules = true;
  const w = normalWin(win);
  if (w !== undefined) c.win = w;
  return c;
}

/** The config of a flag word, or null when it has unknown bits. A false `spawnPhase` is left out so that M04 configs compare equal. */
export function flagsToConfig(flags: number): MatchConfig | null {
  if ((flags & ~CONFIG_FLAGS_KNOWN) !== 0) return null;
  return normalConfig((flags & CONFIG_FLAG_DEBUG_INTENTS) !== 0, (flags & CONFIG_FLAG_SPAWN_PHASE) !== 0, (flags & CONFIG_FLAG_HOME_RULES) !== 0);
}

/** The match header: who and what this state belongs to. Part of the serialised form and of the hash. */
export interface MatchHeader {
  readonly engineVersion: number;
  /** Hash of the world the match started from (terrain and elevation); for packs, their checksum. */
  readonly mapHash: number;
  readonly seed: number;
  readonly config: MatchConfig;
  /** Seats in the match: players first, then tribes. ownerId = seat + 1. */
  readonly seats: number;
  /** How many of the seats are players (seats 0..players-1); the rest are tribes (bots with a weaker economy). */
  readonly players: number;
}

/** Counters derived from the owner array and kept in step by setOwner (src/sim/territory.ts). Not serialised, not hashed. */
export interface Aggregates {
  /** Cells owned, per ownerId (index 0 = unowned cells are not counted). */
  readonly area: Uint32Array;
  /** Sum of the Q15 cell weights of the owned cells, per ownerId. Below 2^32 because the Grid checks the whole world. */
  readonly warea: Uint32Array;
}

/** Scratch memory for algorithms that need a per-cell mark; always left all-zero between uses. Not serialised, not hashed. */
export interface Scratch {
  readonly mark: Uint8Array;
  /** The four neighbours of a cell (Grid.neighbours writes here). */
  readonly nb: Int32Array;
  /** The eight cells around a cell in cycle order (territory.ts). */
  readonly ring: Int32Array;
  /** Attack slots already offered a cell by the current owner change. */
  readonly seen: Int32Array;
}

export interface GameState {
  readonly header: MatchHeader;
  readonly width: number;
  readonly height: number;
  /** Completed steps. Unsigned 32 bit. */
  tick: number;
  /** Intents refused so far (invalid, disabled or duplicate). Unsigned 32 bit. */
  rejects: number;
  /** sfc32 state; advanced once by every step. */
  readonly rng: Uint32Array;
  /** Terrain class per cell (0 DeepSea .. 7 Ice, the numbering of the baked sim pack). Constant in M03. */
  readonly terrain: Uint8Array;
  /** Mean elevation in metres per cell. Constant in M03. */
  readonly elevation: Uint16Array;
  /** ownerId per cell (0 = unowned). Uint16 since M04 (D71). */
  readonly owner: Uint16Array;
  /** The id of the intent that last painted the cell (0 when never painted). */
  readonly stamp: Uint32Array;
  /**
   * How deep the cell was when a capture last exposed it to an attacker: `attacker << 8 | depth` (depth 0..D_MAX_CELLS), 0 =
   * never exposed. Cleared whenever the cell changes owner. A new attack of that attacker starts the cell at this depth, so
   * cancelling and relaunching an attack cannot reset the depth term of the price (D91).
   */
  readonly exposure: Uint16Array;
  /** Q15 cos(latitude) of each row: the cell weight. The committed table for the real world, the sine table for fixtures. Constant. */
  readonly rowCos: Uint16Array;
  /** Troops per ownerId (index 0 unused) in quarter troops. */
  readonly troops: Uint32Array;
  /** Remainder of the troop regeneration per ownerId in micro-QT, always below MICRO_QT_PER_QT. */
  readonly troopFrac: Uint32Array;
  /** Gold per ownerId in milli-gold. */
  readonly gold: Uint32Array;
  /** The capital cell + 1 per ownerId, 0 = has not spawned. */
  readonly capital: Uint32Array;
  /** The attacks in progress (game state: serialised and hashed; see src/sim/attacks.ts). */
  readonly attacks: AttackTable;
  /** Cells waiting for the enclave check (game state: serialised and hashed; see src/sim/enclaveQueue.ts). */
  readonly enclaves: EnclaveQueues;
  /** The structures (M09 part A: game state, serialised and hashed; the per-cell index and the counts are derived). See src/sim/structures.ts. */
  readonly structures: StructureTable;
  /** The helicopters (M12a-1: game state, serialised and hashed; the per-owner counts are derived). See src/sim/heliTable.ts. */
  readonly helis: HeliTable;
  /** The beachheads of landed troops (M12a-1: game state, serialised and hashed; part 3 fills it). See src/sim/heliTable.ts. */
  readonly beachheads: BeachheadTable;
  /** The diplomacy (M18c-1): relations, open proposals, betrayal cooldowns, embargo owners. Game state: serialised and hashed. See src/sim/diplomacyTable.ts and diplomacy.ts. */
  readonly diplo: DiplomacyTable;
  /** The occluder layer and the lazy Los / Nav caches (M12a-1): NOT game state, never hashed or serialised, dropped by deserialize. See src/sim/env.ts and access.ts. */
  readonly env: SimEnv;
  /** Derived (see Grid): neighbours, weights, playable cells. */
  readonly grid: Grid;
  /** Derived (see Aggregates). */
  readonly agg: Aggregates;
  /** Derived (see BorderIndex): contact lengths between owners, boundary cells. */
  readonly borders: BorderIndex;
  /** Home land and nation traits (M06, D112): present exactly when `header.config.homeRules` is on; serialised and hashed then, else null. */
  readonly home: HomeRules | null;
  /** Diagnostics: cells looked at per tick (see WorkCounters). Not hashed. */
  readonly work: WorkCounters;
  readonly scratch: Scratch;
  /** The match end (M18-1): result, hold timer, statistics. Game state: serialised and hashed. See src/sim/matchState.ts and win.ts. */
  readonly match: MatchState;
  /** Render-only events; NOT part of the state (not hashed, not serialised). */
  readonly outbox: Outbox;
}

/** The state arrays in their fixed order (serialisation and hash). Adding an array means adding it here, in serialize.ts and in the tests. */
export const STATE_ARRAY_NAMES = ['rng', 'terrain', 'elevation', 'owner', 'stamp', 'exposure', 'rowCos', 'troops', 'troopFrac', 'gold', 'capital'] as const;
export type StateArrayName = (typeof STATE_ARRAY_NAMES)[number];
export type StateArray = Uint8Array | Uint16Array | Uint32Array;

export function stateArray(state: GameState, name: StateArrayName): StateArray {
  switch (name) {
    case 'rng':
      return state.rng;
    case 'terrain':
      return state.terrain;
    case 'elevation':
      return state.elevation;
    case 'owner':
      return state.owner;
    case 'stamp':
      return state.stamp;
    case 'exposure':
      return state.exposure;
    case 'rowCos':
      return state.rowCos;
    case 'troops':
      return state.troops;
    case 'troopFrac':
      return state.troopFrac;
    case 'gold':
      return state.gold;
    default:
      return state.capital;
  }
}

/** The state scalars in their fixed order (serialisation and hash). */
export const STATE_SCALAR_NAMES = ['tick', 'rejects'] as const;

export interface CreateStateParams {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** Seats in total (players + tribes). */
  readonly seats: number;
  /** How many of the seats are players (default: all of them). */
  readonly players?: number;
  /** Q15 cos(lat) per row, `height` long, copied (default: computed from the integer sine table). */
  readonly rowCos?: Uint16Array;
  readonly config?: Partial<MatchConfig>;
  /** Terrain class per cell, width * height long. Copied. */
  readonly terrain: Uint8Array;
  /** Mean elevation per cell, width * height long. Copied. */
  readonly elevation: Uint16Array;
  /** Overrides the computed world hash (for a real match: the checksum of the sim pack). */
  readonly mapHash?: number;
  /** The country id of every cell, `width * height` long (copied). Required exactly when `config.homeRules` is true (then every seat starts without a home land and with neutral traits). */
  readonly countryMap?: ArrayLike<number>;
  /** The real maximum elevation per cell in metres (the occluder layer of the Los / Nav queries), `width * height` long, copied. Not part of the map hash; absent = Los / Nav questions throw. */
  readonly maxElev?: ArrayLike<number>;
}

/** Hash of a world (terrain and elevation). */
export function hashWorld(terrain: Uint8Array, elevation: Uint16Array): number {
  return finishHash(foldU16(foldBytes(FNV_OFFSET | 0, terrain), elevation));
}

/** Is `v` an integer in [lo, hi]? */
function inRange(v: number, lo: number, hi: number): boolean {
  return Number.isInteger(v) && v >= lo && v <= hi;
}

/** Is every row weight a Q15 cos value, 0..WEIGHT_ONE? */
export function validRowCos(rows: Uint16Array): boolean {
  for (let i = 0; i < rows.length; i++) if ((rows[i] as number) > WEIGHT_ONE) return false;
  return true;
}

/** Whether (width, height, seats) are within the structural limits. */
export function validDimensions(width: number, height: number): boolean {
  return inRange(width, 1, MAX_DIMENSION) && inRange(height, 1, MAX_DIMENSION) && width * height <= MAX_CELLS;
}

/** The stored arrays of a state (everything that is serialised and hashed). */
export interface StateParts {
  readonly header: MatchHeader;
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly rejects: number;
  readonly rng: Uint32Array;
  readonly terrain: Uint8Array;
  readonly elevation: Uint16Array;
  readonly owner: Uint16Array;
  readonly stamp: Uint32Array;
  readonly exposure: Uint16Array;
  readonly rowCos: Uint16Array;
  readonly troops: Uint32Array;
  readonly troopFrac: Uint32Array;
  readonly gold: Uint32Array;
  readonly capital: Uint32Array;
  readonly attacks: AttackTable;
  readonly enclaves: EnclaveQueues;
  readonly structures: StructureTable;
  readonly helis: HeliTable;
  readonly beachheads: BeachheadTable;
  readonly match: MatchState;
  readonly diplo: DiplomacyTable;
  /** Present exactly when `header.config.homeRules` is on. */
  readonly home?: HomeRules | null;
  /** The occluder layer for the Los / Nav caches (absent = none; M12a-1). */
  readonly env?: SimEnv;
}

/**
 * Puts the derived parts (grid, aggregates, scratch, outbox) around stored arrays. Used by createState and deserialize;
 * the arrays must already have the right lengths and ranges. Throws RangeError when the world is too heavy for the 32-bit
 * weight sums (see Grid).
 */
export function assembleState(parts: StateParts): GameState {
  const grid = new Grid(parts.width, parts.height, parts.terrain, parts.rowCos);
  const slots = ownerSlots(parts.header.seats);
  const wantsHome = parts.header.config.homeRules === true;
  if (wantsHome !== (parts.home !== undefined && parts.home !== null)) throw new RangeError('home rules are present exactly when the config says so');
  const state: GameState = {
    ...parts,
    home: parts.home ?? null,
    env: parts.env ?? new SimEnv(null),
    grid,
    agg: { area: new Uint32Array(slots), warea: new Uint32Array(slots) },
    borders: new BorderIndex(grid.cells, slots),
    work: new WorkCounters(),
    scratch: { mark: new Uint8Array(grid.cells), nb: new Int32Array(4), ring: new Int32Array(8), seen: new Int32Array(4) },
    outbox: new Outbox(),
  };
  parts.attacks.reindex();
  parts.enclaves.reindex();
  parts.structures.rebuildIndex();
  parts.helis.rebuildIndex();
  parts.beachheads.rebuildIndex();
  parts.diplo.rebuildPairs();
  rebuildAggregates(state);
  return state;
}

/** Recomputes everything derived from the owner array (aggregates, contact lengths, boundary lists; O(cells); what deserialize does, and what tests compare against). */
export function rebuildAggregates(state: GameState): void {
  const { area, warea } = state.agg;
  area.fill(0);
  warea.fill(0);
  const w = state.width;
  for (let y = 0; y < state.height; y++) {
    const weight = state.rowCos[y] as number;
    const base = y * w;
    for (let x = 0; x < w; x++) {
      const o = state.owner[base + x] as number;
      if (o !== NO_OWNER) {
        area[o] = (area[o] as number) + 1;
        warea[o] = (warea[o] as number) + weight;
      }
    }
  }
  state.borders.rebuild(state.owner, state.grid);
}

/** Builds a state at tick 0. Throws RangeError on parameters outside the limits (a programming error, never runtime data). */
export function createState(p: CreateStateParams): GameState {
  if (!validDimensions(p.width, p.height)) throw new RangeError(`bad dimensions ${p.width}x${p.height}`);
  if (!inRange(p.seats, 1, MAX_SEATS)) throw new RangeError(`bad seat count ${p.seats}`);
  const players = p.players ?? p.seats;
  if (!inRange(players, 1, p.seats)) throw new RangeError(`bad player count ${players}`);
  if (!inRange(p.seed, -2147483648, 4294967295)) throw new RangeError(`bad seed ${p.seed}`);
  const n = p.width * p.height;
  if (p.terrain.length !== n || p.elevation.length !== n) throw new RangeError('world arrays must be width * height long');
  if (p.rowCos !== undefined && (p.rowCos.length !== p.height || !validRowCos(p.rowCos))) throw new RangeError('rowCos must be height long with weights 0..WEIGHT_ONE');
  const homeRules = p.config?.homeRules === true;
  if (homeRules !== (p.countryMap !== undefined)) throw new RangeError('countryMap is required exactly when config.homeRules is true');
  if (p.countryMap !== undefined && p.countryMap.length !== n) throw new RangeError('countryMap must be width * height long');
  if (p.maxElev !== undefined && p.maxElev.length !== n) throw new RangeError('maxElev must be width * height long');
  const terrain = p.terrain.slice();
  const elevation = p.elevation.slice();
  const seed = p.seed >>> 0;
  const header: MatchHeader = Object.freeze({
    engineVersion: ENGINE_VERSION,
    mapHash: (p.mapHash ?? hashWorld(terrain, elevation)) >>> 0,
    seed,
    config: Object.freeze(normalConfig(p.config?.debugIntents === true, p.config?.spawnPhase === true, p.config?.homeRules === true, p.config?.win)),
    seats: p.seats,
    players,
  });
  return assembleState({
    header,
    width: p.width,
    height: p.height,
    tick: 0,
    rejects: 0,
    rng: createRng(seed),
    terrain,
    elevation,
    owner: new Uint16Array(n),
    stamp: new Uint32Array(n),
    exposure: new Uint16Array(n),
    rowCos: p.rowCos !== undefined ? p.rowCos.slice() : rowCosFromLut(p.height),
    troops: new Uint32Array(ownerSlots(p.seats)),
    troopFrac: new Uint32Array(ownerSlots(p.seats)),
    gold: new Uint32Array(ownerSlots(p.seats)),
    capital: new Uint32Array(ownerSlots(p.seats)),
    attacks: new AttackTable(ownerSlots(p.seats)),
    enclaves: new EnclaveQueues(n),
    structures: new StructureTable(n, ownerSlots(p.seats)),
    helis: new HeliTable(ownerSlots(p.seats)),
    beachheads: new BeachheadTable(),
    env: new SimEnv(p.maxElev === undefined ? null : Int16Array.from(p.maxElev)),
    match: new MatchState(ownerSlots(p.seats)),
    diplo: new DiplomacyTable(ownerSlots(p.seats)),
    home: p.countryMap !== undefined ? createHomeRules(p.countryMap, ownerSlots(p.seats)) : null,
  });
}

/** An all-zero world of the given size (what the performance test steps). */
export function createEmptyState(width: number, height: number, seed: number, seats: number, config?: Partial<MatchConfig>): GameState {
  const n = width * height;
  return createState({ width, height, seed, seats, config, terrain: new Uint8Array(n), elevation: new Uint16Array(n) });
}

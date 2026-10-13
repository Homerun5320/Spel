// The game state: structure-of-arrays, parameterised by (width, height). Typed arrays and plain integers only.
//
// Seats are 0-based; ownerId = seat + 1 and 0 means unowned. seatToOwner / ownerToSeat below are the ONLY place where
// the two are converted: intents and seat lists use `seat`, ownership arrays and textures use `ownerId`.
import { foldBytes, foldU16, finishHash, FNV_OFFSET } from './hash';
import { Outbox } from './outbox';
import { createRng } from './rng';

/** Bumped whenever a rule, a constant in rules.ts or the meaning of a state array changes. Part of the match header. */
export const ENGINE_VERSION = 1;

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

/** The seat of an ownerId, or NO_SEAT for NO_OWNER. */
export function ownerToSeat(ownerId: number): number {
  return ownerId - 1;
}

/** Match options that change what is legal. Serialised as flag bits (CONFIG_FLAG_*). */
export interface MatchConfig {
  /** Allows the debug intents (DebugPaint). Always false in a real match. */
  readonly debugIntents: boolean;
}

export const CONFIG_FLAG_DEBUG_INTENTS = 1;
/** All flag bits this engine knows; a snapshot with other bits is refused. */
export const CONFIG_FLAGS_KNOWN = CONFIG_FLAG_DEBUG_INTENTS;

export function configToFlags(config: MatchConfig): number {
  return config.debugIntents ? CONFIG_FLAG_DEBUG_INTENTS : 0;
}

/** The config of a flag word, or null when it has unknown bits. */
export function flagsToConfig(flags: number): MatchConfig | null {
  if ((flags & ~CONFIG_FLAGS_KNOWN) !== 0) return null;
  return { debugIntents: (flags & CONFIG_FLAG_DEBUG_INTENTS) !== 0 };
}

/** The match header: who and what this state belongs to. Part of the serialised form and of the hash. */
export interface MatchHeader {
  readonly engineVersion: number;
  /** Hash of the world the match started from (terrain and elevation); for packs, their checksum. */
  readonly mapHash: number;
  readonly seed: number;
  readonly config: MatchConfig;
  readonly seats: number;
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
  /** Render-only events; NOT part of the state (not hashed, not serialised). */
  readonly outbox: Outbox;
}

/** The state arrays in their fixed order (serialisation and hash). Adding an array means adding it here, in serialize.ts and in the tests. */
export const STATE_ARRAY_NAMES = ['rng', 'terrain', 'elevation', 'owner', 'stamp'] as const;
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
    default:
      return state.stamp;
  }
}

/** The state scalars in their fixed order (serialisation and hash). */
export const STATE_SCALAR_NAMES = ['tick', 'rejects'] as const;

export interface CreateStateParams {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly seats: number;
  readonly config?: Partial<MatchConfig>;
  /** Terrain class per cell, width * height long. Copied. */
  readonly terrain: Uint8Array;
  /** Mean elevation per cell, width * height long. Copied. */
  readonly elevation: Uint16Array;
  /** Overrides the computed world hash (for a real match: the checksum of the sim pack). */
  readonly mapHash?: number;
}

/** Hash of a world (terrain and elevation). */
export function hashWorld(terrain: Uint8Array, elevation: Uint16Array): number {
  return finishHash(foldU16(foldBytes(FNV_OFFSET | 0, terrain), elevation));
}

/** Is `v` an integer in [lo, hi]? */
function inRange(v: number, lo: number, hi: number): boolean {
  return Number.isInteger(v) && v >= lo && v <= hi;
}

/** Whether (width, height, seats) are within the structural limits. */
export function validDimensions(width: number, height: number): boolean {
  return inRange(width, 1, MAX_DIMENSION) && inRange(height, 1, MAX_DIMENSION) && width * height <= MAX_CELLS;
}

/** Builds a state at tick 0. Throws RangeError on parameters outside the limits (a programming error, never runtime data). */
export function createState(p: CreateStateParams): GameState {
  if (!validDimensions(p.width, p.height)) throw new RangeError(`bad dimensions ${p.width}x${p.height}`);
  if (!inRange(p.seats, 1, MAX_SEATS)) throw new RangeError(`bad seat count ${p.seats}`);
  if (!inRange(p.seed, -2147483648, 4294967295)) throw new RangeError(`bad seed ${p.seed}`);
  const n = p.width * p.height;
  if (p.terrain.length !== n || p.elevation.length !== n) throw new RangeError('world arrays must be width * height long');
  const terrain = p.terrain.slice();
  const elevation = p.elevation.slice();
  const seed = p.seed >>> 0;
  const header: MatchHeader = Object.freeze({
    engineVersion: ENGINE_VERSION,
    mapHash: (p.mapHash ?? hashWorld(terrain, elevation)) >>> 0,
    seed,
    config: Object.freeze({ debugIntents: p.config?.debugIntents === true }),
    seats: p.seats,
  });
  return {
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
    outbox: new Outbox(),
  };
}

/** An all-zero world of the given size (what the performance test steps). */
export function createEmptyState(width: number, height: number, seed: number, seats: number, config?: Partial<MatchConfig>): GameState {
  const n = width * height;
  return createState({ width, height, seed, seats, config, terrain: new Uint8Array(n), elevation: new Uint16Array(n) });
}

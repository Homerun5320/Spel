// The match-end state (M18-1): the win configuration of a match, the result once it is over, the hold timer and the per-seat statistics.
// Game state: serialised and hashed (src/sim/serialize.ts). The rules that write it are in src/sim/win.ts and the few counters in
// conquest.ts, structures.ts and districts.ts. Plain integers and typed arrays only.

/** The win conditions a match runs (`MatchConfig.win`). A match without one, or with all three off, never ends. */
export interface WinConfig {
  /** (a) hold `landSharePct` of the weighted land for `holdTicks` in a row. */
  readonly land: boolean;
  /** (b) the last nation alive (needs at least two players at the start). */
  readonly last: boolean;
  /** (c) the highest score when `timeLimitTicks` of play have passed. */
  readonly score: boolean;
  /** Ticks of play (counted from the end of the spawn phase) until condition (c) decides. 1 .. 2^31 - 1. */
  readonly timeLimitTicks: number;
  /** The share condition (a) asks for, percent, 1 .. 100. */
  readonly landSharePct: number;
  /** Ticks the share must be held, 1 .. 2^31 - 1. */
  readonly holdTicks: number;
}

export const WIN_FLAG_LAND = 1;
export const WIN_FLAG_LAST = 2;
export const WIN_FLAG_SCORE = 4;

/** Why a match ended. 0 = no winner (everybody was eliminated at once). */
export const WIN_REASON_NONE = 0;
export const WIN_REASON_LAND = 1;
export const WIN_REASON_LAST = 2;
export const WIN_REASON_SCORE = 3;

const INT31 = 2147483647;

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/** Is this a legal win block (all three flags booleans, the numbers in range)? */
export function validWinConfig(w: unknown): w is WinConfig {
  if (typeof w !== 'object' || w === null) return false;
  const c = w as Record<string, unknown>;
  return (
    typeof c.land === 'boolean' && typeof c.last === 'boolean' && typeof c.score === 'boolean' && isInt(c.timeLimitTicks, 1, INT31) && isInt(c.landSharePct, 1, 100) && isInt(c.holdTicks, 1, INT31)
  );
}

/** The normal form kept in the header: undefined when absent or when every condition is off (such a match never ends), else a frozen copy. Throws RangeError on a malformed block. */
export function normalWin(w: WinConfig | undefined): WinConfig | undefined {
  if (w === undefined) return undefined;
  if (!validWinConfig(w)) throw new RangeError('bad win config');
  if (!w.land && !w.last && !w.score) return undefined;
  return Object.freeze({ land: w.land, last: w.last, score: w.score, timeLimitTicks: w.timeLimitTicks, landSharePct: w.landSharePct, holdTicks: w.holdTicks });
}

export function winFlagsOf(w: WinConfig | undefined): number {
  return w === undefined ? 0 : (w.land ? WIN_FLAG_LAND : 0) | (w.last ? WIN_FLAG_LAST : 0) | (w.score ? WIN_FLAG_SCORE : 0);
}

/** The result, the hold timer and the statistics. Per-ownerId arrays have `seats + 1` slots (slot 0 unused and always 0). */
export class MatchState {
  /** 1 once the match is over (the rules then stop: step only counts ticks). */
  ended = 0;
  /** ownerId of the winner, 0 = none. */
  winner = 0;
  /** WIN_REASON_*. */
  reason = 0;
  /** The tick count at which the match ended (state.tick after the deciding step). */
  endTick = 0;
  /** ownerId that has held the land requirement for `holdCount` ticks in a row (0 = nobody). */
  holdOwner = 0;
  holdCount = 0;
  /** 1 = the seat has been eliminated (it spawned and owns no cell any more). Permanent. */
  readonly eliminated: Uint8Array;
  /** 1 while the seat has a capital whose cell another owner holds (the loss of the capital alone is only an event). */
  readonly capitalLost: Uint8Array;
  /** The most land the seat has held, in weighted std-cells. */
  readonly peakLand: Uint32Array;
  /** Structures the seat has built (Build intents applied). */
  readonly built: Uint32Array;
  /** Cells the seat has taken with attacks (from a nation, a tribe or free land). */
  readonly conquered: Uint32Array;
  /** Districts the seat has built (BuildDistrict intents applied). */
  readonly districts: Uint32Array;

  constructor(slots: number) {
    this.eliminated = new Uint8Array(slots);
    this.capitalLost = new Uint8Array(slots);
    this.peakLand = new Uint32Array(slots);
    this.built = new Uint32Array(slots);
    this.conquered = new Uint32Array(slots);
    this.districts = new Uint32Array(slots);
  }
}

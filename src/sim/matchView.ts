// The match end as the UI and the AI see it (M18-1): a packed Uint32Array (so that it crosses the host seam like the statistics) and a read-only
// `MatchView` over it. `fillMatchView(state, out, scores)` writes the packed form without allocating; the page's ViewMirror keeps a copy that the
// host's frames update. The header words are the whole state of the match (is it over, who won, why) and the win progress for the HUD (the leader,
// the hold timer, the land requirement now, the time left); the per-seat blocks are the statistics.
import { fillScores, landStdOf, playStartTick, requiredLandPct } from './win';
import { winFlagsOf } from './matchState';
import type { GameState } from './state';
import type { ReadonlyNumbers } from './view';

/** The scalar words at the start of the packed array, in order. */
export const MATCH_HEADER_FIELDS = [
  'ended',
  'winner1',
  'reason',
  'endTick',
  'winFlags',
  'timeLimitTicks',
  'landSharePct',
  'holdTicks',
  'leader1',
  'holdSeat1',
  'holdTicksLeft',
  'requiredPct',
  'timeLeftTicks',
] as const;
export const MATCH_HEADER_WORDS = MATCH_HEADER_FIELDS.length;
/** The per-seat blocks that follow the header words, `seats` values each, in order. */
export const MATCH_SEAT_FIELDS = ['eliminated', 'capitalLost', 'landStd', 'score', 'peakLand', 'built', 'conquered', 'districts'] as const;
export type MatchSeatField = (typeof MATCH_SEAT_FIELDS)[number];

/** Length of the packed array of a match with `seats` seats. */
export function matchPackedLength(seats: number): number {
  return MATCH_HEADER_WORDS + MATCH_SEAT_FIELDS.length * seats;
}

/**
 * The match end, read-only. Seats are 0-based (seat = ownerId - 1), -1 means nobody.
 *  ended, winnerSeat, reason (WIN_REASON_*: 0 none, 1 land, 2 last, 3 score), endTick   the result
 *  winFlags (1 land, 2 last, 4 score; 0 = this match never ends), timeLimitTicks, landSharePct, holdTicks   the rules of the match
 *  leaderSeat      the non-eliminated player with the most land (-1 before anybody has land)
 *  holdSeat        the player that currently meets the land requirement (-1 none); holdTicksLeft the ticks it must still hold (0 without one)
 *  requiredPct     the land share the land condition asks for NOW (the overtime curve applied)
 *  timeLeftTicks   ticks of play left until the score condition decides (0 when the match has no win rules, or it has ended)
 * Per seat: eliminated, capitalLost (0 / 1), landStd (weighted std-cells), score, and the statistics peakLand, built (structures), conquered (cells), districts.
 */
export interface MatchView {
  readonly seats: number;
  readonly ended: boolean;
  readonly winnerSeat: number;
  readonly reason: number;
  readonly endTick: number;
  readonly winFlags: number;
  readonly timeLimitTicks: number;
  readonly landSharePct: number;
  readonly holdTicks: number;
  readonly leaderSeat: number;
  readonly holdSeat: number;
  readonly holdTicksLeft: number;
  readonly requiredPct: number;
  readonly timeLeftTicks: number;
  readonly eliminated: ReadonlyNumbers;
  readonly capitalLost: ReadonlyNumbers;
  readonly landStd: ReadonlyNumbers;
  readonly score: ReadonlyNumbers;
  readonly peakLand: ReadonlyNumbers;
  readonly built: ReadonlyNumbers;
  readonly conquered: ReadonlyNumbers;
  readonly districts: ReadonlyNumbers;
}

/** Writes the packed match view of a state into `out` (`matchPackedLength(seats)` long) using `scores` (seats + 1 long) as scratch. No other allocation. */
export function fillMatchView(state: GameState, out: Uint32Array, scores: Uint32Array): void {
  const seats = state.header.seats;
  const m = state.match;
  const cfg = state.header.config.win;
  const players = state.header.players;
  const start = playStartTick(state);
  const elapsed = state.tick > start ? state.tick - start : 0;
  fillScores(state, scores);
  let leader = 0;
  for (let o = 1; o <= players; o++) {
    if (m.eliminated[o] === 1 || (state.agg.area[o] as number) === 0) continue;
    if (leader === 0 || (state.agg.warea[o] as number) > (state.agg.warea[leader] as number)) leader = o;
  }
  const holdOwner = m.ended === 1 ? 0 : m.holdOwner;
  out[0] = m.ended;
  out[1] = m.winner;
  out[2] = m.reason;
  out[3] = m.endTick;
  out[4] = winFlagsOf(cfg);
  out[5] = cfg === undefined ? 0 : cfg.timeLimitTicks;
  out[6] = cfg === undefined ? 0 : cfg.landSharePct;
  out[7] = cfg === undefined ? 0 : cfg.holdTicks;
  out[8] = leader;
  out[9] = holdOwner;
  out[10] = cfg === undefined || holdOwner === 0 ? 0 : Math.max(0, cfg.holdTicks - m.holdCount);
  out[11] = cfg === undefined ? 0 : requiredLandPct(cfg.landSharePct, elapsed);
  out[12] = cfg === undefined || m.ended === 1 ? 0 : Math.max(0, cfg.timeLimitTicks - elapsed);
  let at = MATCH_HEADER_WORDS;
  for (let s = 0; s < seats; s++) out[at + s] = m.eliminated[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = m.capitalLost[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = landStdOf(state, s + 1);
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = scores[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = m.peakLand[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = m.built[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = m.conquered[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = m.districts[s + 1] as number;
}

/** A read-only view over a packed array (shared memory: the owner of the array rewrites it, the view reads it live). */
export function matchViewOf(seats: number, p: Uint32Array): MatchView {
  const block = (i: number): Uint32Array => p.subarray(MATCH_HEADER_WORDS + i * seats, MATCH_HEADER_WORDS + (i + 1) * seats);
  const seatOf = (word: number): number => (p[word] as number) - 1;
  return {
    seats,
    get ended() {
      return p[0] === 1;
    },
    get winnerSeat() {
      return seatOf(1);
    },
    get reason() {
      return p[2] as number;
    },
    get endTick() {
      return p[3] as number;
    },
    get winFlags() {
      return p[4] as number;
    },
    get timeLimitTicks() {
      return p[5] as number;
    },
    get landSharePct() {
      return p[6] as number;
    },
    get holdTicks() {
      return p[7] as number;
    },
    get leaderSeat() {
      return seatOf(8);
    },
    get holdSeat() {
      return seatOf(9);
    },
    get holdTicksLeft() {
      return p[10] as number;
    },
    get requiredPct() {
      return p[11] as number;
    },
    get timeLeftTicks() {
      return p[12] as number;
    },
    eliminated: block(0),
    capitalLost: block(1),
    landStd: block(2),
    score: block(3),
    peakLand: block(4),
    built: block(5),
    conquered: block(6),
    districts: block(7),
  };
}

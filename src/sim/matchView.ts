// The match end as the UI and the AI see it (M18-1): a packed Uint32Array (so that it crosses the host seam like the statistics) and a read-only
// `MatchView` over it. `fillMatchView(state, out, scores)` writes the packed form without allocating; the page's ViewMirror keeps a copy that the
// host's frames update. The header words are the whole state of the match (is it over, who won, why) and the win progress for the HUD (the leader,
// the hold timer, the land requirement now, the time left); the per-seat blocks are the statistics.
import { fillScores, landStdOf, playStartTick, requiredLandPct } from './win';
import { federationRoots, groupSumScratch } from './groups';
import { winFlagsOf } from './matchState';
import type { GameState } from './state';
import { techCountOfMask, techFxOfMask } from './techTable';
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
export const MATCH_SEAT_FIELDS = ['eliminated', 'capitalLost', 'landStd', 'score', 'peakLand', 'built', 'conquered', 'districts', 'treaties', 'betrayals', 'relations', 'techMask', 'techCurrent1', 'techDone', 'techCount', 'group'] as const;
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
 * Per seat: eliminated, capitalLost (0 / 1), landStd (weighted std-cells), score, and the statistics peakLand, built (structures), conquered (cells), districts,
 * and (M18c-1) treaties (entered), betrayals (treaties the seat broke) and relations (truces and alliances the seat has right now).
 * M18b-3: `group` is the seat of the lowest member of the seat's federation (the seat itself without one); leaderSeat, holdSeat and winnerSeat are group
 * representatives (a root seat) when federations exist, and `groupMembers(view, seat)` lists the seats of a group.
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
  readonly treaties: ReadonlyNumbers;
  readonly betrayals: ReadonlyNumbers;
  readonly relations: ReadonlyNumbers;
  /** Technology (M18d-1), per seat: the researched techs as a bitmask (bit = tech index), the tech under research + 1 (0 = none), the tick it is finished (0 = none), the number researched. */
  readonly techMask: ReadonlyNumbers;
  readonly techCurrent1: ReadonlyNumbers;
  readonly techDone: ReadonlyNumbers;
  readonly techCount: ReadonlyNumbers;
  /** M18b-3, per seat: the root seat (lowest seat) of the seat's federation; the seat itself when it has none. Eliminated members have left their group. */
  readonly group: ReadonlyNumbers;
  /** The researched mask of a seat (the shape the helicopter rules read, `TechMaskSource`). */
  techMaskOfSeat(seat: number): number;
  /** The tech a seat is researching, -1 = none. */
  techCurrentOfSeat(seat: number): number;
  /** What the seat's researched techs give on an effect channel (TECH_FX_*, capped). */
  techFxOfSeat(seat: number, channel: number): number;
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
  const roots = federationRoots(state);
  if (roots === null) {
    for (let o = 1; o <= players; o++) {
      if (m.eliminated[o] === 1 || (state.agg.area[o] as number) === 0) continue;
      if (leader === 0 || (state.agg.warea[o] as number) > (state.agg.warea[leader] as number)) leader = o;
    }
  } else {
    // The leader is the group with the most land (its root seat); a group needs one living member that owns land.
    const sums = groupSumScratch(roots.length);
    for (let o = 1; o <= players; o++) sums[roots[o] as number] = (sums[roots[o] as number] as number) + (state.agg.warea[o] as number);
    for (let o = 1; o <= players; o++) {
      if (m.eliminated[o] === 1 || (state.agg.area[o] as number) === 0) continue;
      const r = roots[o] as number;
      if (leader === 0 || (sums[r] as number) > (sums[leader] as number)) leader = r;
    }
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
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = m.treatiesMade[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = m.treatiesBroken[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = state.diplo.activeCountOf(s + 1, state.tick, players);
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = m.techMask[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = m.techCurrent[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = m.techDone[s + 1] as number;
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = techCountOfMask(m.techMask[s + 1] as number);
  at += seats;
  for (let s = 0; s < seats; s++) out[at + s] = roots === null ? s : (roots[s + 1] as number) - 1;
}

/** The seats of the group `seat` belongs to (just `[seat]` without a federation), in ascending order. The result of a read; allocates. */
export function groupMembers(m: { readonly seats: number; readonly group: ReadonlyNumbers }, seat: number): number[] {
  if (seat < 0 || seat >= m.seats) return [];
  const root = m.group[seat] as number;
  const out: number[] = [];
  for (let s = 0; s < m.seats; s++) if (m.group[s] === root) out.push(s);
  return out;
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
    treaties: block(8),
    betrayals: block(9),
    relations: block(10),
    techMask: block(11),
    techCurrent1: block(12),
    techDone: block(13),
    techCount: block(14),
    group: block(15),
    techMaskOfSeat: (seat) => p[MATCH_HEADER_WORDS + 11 * seats + seat] as number,
    techCurrentOfSeat: (seat) => (p[MATCH_HEADER_WORDS + 12 * seats + seat] as number) - 1,
    techFxOfSeat: (seat, channel) => techFxOfMask(p[MATCH_HEADER_WORDS + 11 * seats + seat] as number, channel),
  };
}

// Federations in the lists (M18b-3): pure view-models that group the seats of one federation into ONE entry. The leaderboard (one row per federation with the
// summed land share, the number of living members and a flag, the members under it when expanded), the win meter (the share of a group) and the result screen
// (the winning group with its members, and a row per group with the members under it). The groups come from `SeatLabels.federations` (fixed by the match
// setup); the numbers come from the sim's statistics. No DOM, no clock; a match without a federation never calls the list builders.
import type { ReadonlyNumbers } from '../sim/public';
import type { FlagSpec } from './flag';
import type { SideInfo } from './matchFlow';
import type { SeatLabels } from './seatLabels';
import { sideName } from './seatLabels';

/** One line of the leaderboard: a seat on its own (`fed` -1) or a whole federation. `seats` are the members holding land (ascending) for a federation, else the one seat. */
export interface BoardEntry {
  readonly fed: number;
  /** The seat that stands for the entry (the lowest living member of a federation). */
  readonly seat: number;
  readonly shareQ15: number;
  /** Members that still hold land, and the members the federation started with (1 / 1 for a single seat). */
  readonly alive: number;
  readonly total: number;
  readonly seats: readonly number[];
}

export interface BoardStats {
  readonly landShareQ15: ArrayLike<number>;
  readonly cells: ArrayLike<number>;
}

/**
 * The entries that hold land among the seats `0..seatCount-1`, best first (higher summed share, ties to the lower representative seat). A federation is one
 * entry as long as one of its members holds land. Allocates (called once per tick, only in a match with federations).
 */
export function boardEntries(st: BoardStats, seatCount: number, labels: SeatLabels): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (let seat = 0; seat < seatCount; seat++) {
    if ((st.cells[seat] as number) <= 0) continue;
    const f = labels.federationOf(seat);
    if (f < 0) out.push({ fed: -1, seat, shareQ15: st.landShareQ15[seat] as number, alive: 1, total: 1, seats: [seat] });
  }
  labels.federations.forEach((fed, i) => {
    const living = fed.seats.filter((s) => (st.cells[s] as number) > 0);
    if (living.length === 0) return;
    let sum = 0;
    for (const s of living) sum += st.landShareQ15[s] as number;
    out.push({ fed: i, seat: living[0] as number, shareQ15: sum, alive: living.length, total: fed.seats.length, seats: living });
  });
  out.sort((a, b) => (a.shareQ15 !== b.shareQ15 ? b.shareQ15 - a.shareQ15 : a.seat - b.seat));
  return out;
}

/** The land share (Q15) of the side a seat is on: the summed share of its federation, else its own. The win meter's leader share. */
export function sideShareQ15(st: BoardStats, labels: SeatLabels, seat: number): number {
  const f = labels.federationOf(seat);
  if (f < 0) return st.landShareQ15[seat] as number;
  let sum = 0;
  for (const s of (labels.federations[f] as { seats: readonly number[] }).seats) sum += st.landShareQ15[s] as number;
  return sum;
}

/** One group of the result screen: a federation or a single nation, with its members. */
export interface ResultGroup {
  readonly rank: number;
  /** -1 for a single nation. */
  readonly fed: number;
  readonly name: string;
  readonly winner: boolean;
  readonly you: boolean;
  /** Summed score, land percent and the members (seats, in seat order). */
  readonly score: number;
  readonly landPct: number;
  readonly members: readonly number[];
  /** The federation's flag, null for a single nation. */
  readonly flag: FlagSpec | null;
}

/**
 * The groups of the result, the winning group first, the rest by summed score then summed land then the lower seat. A seat of a federation joins its
 * federation (also the members that were eliminated), every other player seat is a group of one.
 */
export function resultGroups(
  m: { readonly winnerSeat: number; readonly score: ReadonlyNumbers; readonly landStd: ReadonlyNumbers },
  players: number,
  localSeat: number,
  labels: SeatLabels,
  landPctOf: (seat: number) => number,
): ResultGroup[] {
  const out: Omit<ResultGroup, 'rank'>[] = [];
  const winnerFed = m.winnerSeat >= 0 ? labels.federationOf(m.winnerSeat) : -1;
  const make = (fed: number, members: readonly number[]): Omit<ResultGroup, 'rank'> => {
    let score = 0;
    let land = 0;
    for (const s of members) {
      score += m.score[s] as number;
      land += landPctOf(s);
    }
    const winner = fed >= 0 ? fed === winnerFed : members[0] === m.winnerSeat;
    return { fed, name: fed >= 0 ? labels.federationName(fed) : labels.name(members[0] as number), winner, you: members.includes(localSeat), score, landPct: land, members, flag: fed >= 0 ? (labels.federations[fed] as { flag: FlagSpec }).flag : null };
  };
  for (let s = 0; s < players && s < m.score.length; s++) if (labels.federationOf(s) < 0) out.push(make(-1, [s]));
  labels.federations.forEach((f, i) => out.push(make(i, f.seats.filter((s) => s < players))));
  const landOf = (g: Omit<ResultGroup, 'rank'>): number => g.members.reduce((a, s) => a + (m.landStd[s] as number), 0);
  out.sort((a, b) => {
    if (a.winner !== b.winner) return a.winner ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    const la = landOf(a);
    const lb = landOf(b);
    if (la !== lb) return lb - la;
    return (a.members[0] as number) - (b.members[0] as number);
  });
  return out.map((g, i) => ({ rank: i + 1, ...g }));
}

/** The name of the side that won (the federation's name for a member), '' without a winner. */
export function winnerSideName(winnerSeat: number, labels: SeatLabels): string {
  return winnerSeat >= 0 ? sideName(labels, winnerSeat) : '';
}

/** The side of a seat for `reasonLine`: its federation (offset past every seat number), else the seat; `shared` is true for a federation member. */
export function sideInfoOf(labels: SeatLabels): SideInfo {
  return {
    of: (seat) => {
      const f = labels.federationOf(seat);
      return f >= 0 ? 100000 + f : seat;
    },
    shared: (seat) => labels.federationOf(seat) >= 0,
  };
}

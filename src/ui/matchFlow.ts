// The view-models of the match flow (M18-2): what the result screen, the pause menu and the toasts show, as pure functions of the sim's
// read-only `MatchView` (src/sim/matchView.ts). Nothing here recomputes a statistic: the sim counted them, this file orders and names them.
// No DOM, no clock, no allocation per call except where a list is the result.
import { WIN_REASON_LAND, WIN_REASON_LAST, WIN_REASON_SCORE, type MatchView } from '../sim/public';
import { TICK_MS } from '../sim/rules';
import type { TextKey } from './i18n';

/** The one-shot pref a restart leaves for the next boot: 'built' = start the stored setup (its seed is already the next one), 'standard' = the standard match. */
export const RESTART_PREF = 'restart';

/** The state of the human player's seat as the panels see it. */
export type HumanStatus = 'playing' | 'eliminated' | 'over';
/** `over` once the match has ended (the result screen takes the place of everything), `eliminated` while the match goes on without the human. */
export function humanStatus(m: MatchView, localSeat: number): HumanStatus {
  if (m.ended) return 'over';
  return (m.eliminated[localSeat] ?? 0) === 1 ? 'eliminated' : 'playing';
}

/** The headline and the reason of a finished match: i18n keys with their numbers. */
export interface ReasonLine {
  readonly titleKey: TextKey;
  readonly titleParams: Readonly<Record<string, string | number>>;
  readonly reasonKey: TextKey;
  readonly reasonParams: Readonly<Record<string, string | number>>;
}

const secondsOf = (ticks: number): number => Math.round((ticks * TICK_MS) / 1000);
const minutesOf = (ticks: number): number => Math.round((ticks * TICK_MS) / 60000);

/**
 * The text of the result. "Ni erövrade 60 procent av världen i 30 sekunder" when you won by land, "{name} erövrade ..." for another nation,
 * "Sist kvar", "Högst poäng efter 12 minuter". `nameOf(seat)` is the nation's name in the UI language. The land share and hold time shown are
 * the rule the match was played under (`landSharePct`, `holdTicks`), not the overtime figure of the end tick.
 */
export function reasonLine(m: MatchView, localSeat: number, nameOf: (seat: number) => string): ReasonLine {
  const won = m.winnerSeat === localSeat;
  const name = m.winnerSeat >= 0 ? nameOf(m.winnerSeat) : '';
  const titleKey: TextKey = m.winnerSeat < 0 ? 'result.title.none' : won ? 'result.title.you' : 'result.title.other';
  const base = { titleKey, titleParams: { name } };
  if (m.reason === WIN_REASON_LAND) {
    const params = { name, pct: m.landSharePct, secs: secondsOf(m.holdTicks) };
    return { ...base, reasonKey: won ? 'result.reason.landYou' : 'result.reason.land', reasonParams: params };
  }
  if (m.reason === WIN_REASON_LAST) return { ...base, reasonKey: 'result.reason.last', reasonParams: { name } };
  if (m.reason === WIN_REASON_SCORE) return { ...base, reasonKey: 'result.reason.score', reasonParams: { name, min: minutesOf(m.timeLimitTicks) } };
  return { ...base, reasonKey: 'result.reason.none', reasonParams: {} };
}

/** One line of the result table. */
export interface ResultRow {
  readonly rank: number;
  readonly seat: number;
  readonly name: string;
  readonly color: string;
  readonly you: boolean;
  readonly winner: boolean;
  readonly eliminated: boolean;
  /** Share of the land in percent (from the sim's statistics via `landPctOf`). */
  readonly landPct: number;
  readonly score: number;
  readonly peakLand: number;
  readonly built: number;
  readonly conquered: number;
}

/**
 * The result table: one row per PLAYER seat (tribes are not nations that can win). Rank 1 is the winner; the others follow by the sim's own
 * tiebreak (higher score, then more land, then the lower seat id). Every number is read from the `MatchView`; the land percent comes from
 * `landPctOf` (the sim's land-share statistic).
 */
export function resultRows(m: MatchView, players: number, localSeat: number, nameOf: (seat: number) => string, colorOf: (seat: number) => string, landPctOf: (seat: number) => number): ResultRow[] {
  const seats: number[] = [];
  for (let s = 0; s < players && s < m.seats; s++) seats.push(s);
  seats.sort((a, b) => {
    const wa = a === m.winnerSeat ? 1 : 0;
    const wb = b === m.winnerSeat ? 1 : 0;
    if (wa !== wb) return wb - wa;
    const sa = m.score[a] as number;
    const sb = m.score[b] as number;
    if (sa !== sb) return sb - sa;
    const la = m.landStd[a] as number;
    const lb = m.landStd[b] as number;
    if (la !== lb) return lb - la;
    return a - b;
  });
  return seats.map((s, i) => ({
    rank: i + 1,
    seat: s,
    name: nameOf(s),
    color: colorOf(s),
    you: s === localSeat,
    winner: s === m.winnerSeat,
    eliminated: (m.eliminated[s] ?? 0) === 1,
    landPct: landPctOf(s),
    score: m.score[s] as number,
    peakLand: m.peakLand[s] as number,
    built: m.built[s] as number,
    conquered: m.conquered[s] as number,
  }));
}

/** The elimination and capital-lost events of OTHER nations that happened since the last scan (seats), for the toasts. */
export interface MatchEvents {
  readonly eliminated: readonly number[];
  readonly capitalLost: readonly number[];
}

const NO_EVENTS: MatchEvents | null = null;

/**
 * Remembers which flags it has seen. `scan` returns the seats whose `eliminated` / `capitalLost` flag turned on since the previous scan (null when
 * nothing did, so a quiet frame allocates nothing). The first scan only learns the state (a match loaded in the middle toasts nothing). The local
 * seat is left out: your own loss has its own panel. Only player seats are watched.
 */
export class MatchWatcher {
  private seen = new Uint8Array(0);
  private primed = false;

  scan(m: MatchView, players: number, localSeat: number): MatchEvents | null {
    if (this.seen.length !== players * 2) {
      this.seen = new Uint8Array(players * 2);
      this.primed = false;
    }
    let elim: number[] | null = null;
    let cap: number[] | null = null;
    for (let s = 0; s < players; s++) {
      const e = (m.eliminated[s] ?? 0) === 1 ? 1 : 0;
      const c = (m.capitalLost[s] ?? 0) === 1 ? 1 : 0;
      if (this.primed && s !== localSeat) {
        if (e === 1 && this.seen[s] === 0) (elim ??= []).push(s);
        // A nation that is eliminated has lost its capital too; only the elimination is reported then.
        else if (c === 1 && this.seen[players + s] === 0 && e === 0) (cap ??= []).push(s);
      }
      this.seen[s] = e;
      this.seen[players + s] = c;
    }
    this.primed = true;
    return elim === null && cap === null ? NO_EVENTS : { eliminated: elim ?? [], capitalLost: cap ?? [] };
  }
}

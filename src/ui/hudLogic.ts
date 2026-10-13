// The pure decisions of the HUD (no DOM, no clock): the troop bar and its warning, which prompt the banner shows, the ranking of
// the leaderboard, seat names and the text keys of the refusals. Unit-tested in tests/ui/hudLogic.test.ts.
import type { TextKey } from './i18n';
import {
  PHASE_IMMUNITY,
  PHASE_PLAY,
  PHASE_SPAWN,
  REJECT_AMOUNT,
  REJECT_IMMUNE,
  REJECT_NOT_SPAWNED,
  REJECT_NO_CONTACT,
  REJECT_NO_TROOPS,
  REJECT_OWNED,
  REJECT_PCT,
  REJECT_PHASE,
  REJECT_SELF,
  REJECT_SPAWNED,
  REJECT_TERRAIN,
  TICK_HZ,
} from './hudCodes';
import { TROOP_WARNING_FRACTION } from './uiConfig';

export interface TroopBar {
  /** Filled share of the bar, 0..1. */
  fraction: number;
  /** True from TROOP_WARNING_FRACTION of the cap on. */
  warning: boolean;
}

/** The troop bar for `troops` of a `cap` (any unit, the same for both). A cap of 0 gives an empty bar without a warning. */
export function troopBar(troops: number, cap: number): TroopBar {
  if (!(cap > 0) || !(troops > 0)) return { fraction: 0, warning: false };
  return { fraction: Math.min(1, troops / cap), warning: troops >= cap * TROOP_WARNING_FRACTION };
}

export type BannerTone = 'prompt' | 'wait' | 'safe' | 'play' | 'missed';

export interface BannerState {
  key: TextKey;
  /** Whole seconds left of the phase (rounded up), -1 when there is no countdown. */
  seconds: number;
  tone: BannerTone;
}

/** What the banner on top of the screen says for a phase (`phase` is a PHASE_* code of the sim). */
export function bannerState(phase: number, ticksLeft: number, spawned: boolean): BannerState {
  const seconds = ticksLeft > 0 ? Math.ceil(ticksLeft / TICK_HZ) : 0;
  if (phase === PHASE_SPAWN) return spawned ? { key: 'phase.spawnDone', seconds, tone: 'wait' } : { key: 'phase.spawnPick', seconds, tone: 'prompt' };
  if (!spawned) return { key: 'phase.spawnMissed', seconds: -1, tone: 'missed' };
  if (phase === PHASE_IMMUNITY) return { key: 'phase.immunity', seconds, tone: 'safe' };
  return { key: 'phase.play', seconds: -1, tone: 'play' };
}

/** The data attribute value for a phase. */
export function phaseName(phase: number): 'spawn' | 'immunity' | 'play' {
  return phase === PHASE_SPAWN ? 'spawn' : phase === PHASE_IMMUNITY ? 'immunity' : phase === PHASE_PLAY ? 'play' : 'play';
}

/** The land share in hundredths of a percent (Q15: 32768 = all the land). */
export function shareHundredths(landShareQ15: number): number {
  return Math.round((landShareQ15 * 10000) / 32768);
}

export interface RankStats {
  readonly landShareQ15: ArrayLike<number>;
  readonly cells: ArrayLike<number>;
}

/** True when seat `a` ranks above seat `b`: more land share, ties to the lower seat. */
function above(stats: RankStats, a: number, b: number): boolean {
  const sa = stats.landShareQ15[a] as number;
  const sb = stats.landShareQ15[b] as number;
  return sa > sb || (sa === sb && a < b);
}

/**
 * Writes the seats that hold land, best first, into `out` (at most `out.length` of them, among the seats `0..seatCount-1`)
 * and returns how many it wrote. Allocation free: an insertion into the small sorted prefix.
 */
export function rankTop(stats: RankStats, seatCount: number, out: Int32Array): number {
  let n = 0;
  for (let seat = 0; seat < seatCount; seat++) {
    if ((stats.cells[seat] as number) <= 0) continue;
    let at = n;
    while (at > 0 && above(stats, seat, out[at - 1] as number)) at--;
    if (at >= out.length) continue;
    const last = n < out.length ? n : out.length - 1;
    for (let k = last; k > at; k--) out[k] = out[k - 1] as number;
    out[at] = seat;
    if (n < out.length) n++;
  }
  return n;
}

/** The 1-based rank of `seat` among the seats `0..seatCount-1` that hold land; 0 when it holds none. */
export function rankOf(stats: RankStats, seatCount: number, seat: number): number {
  if ((stats.cells[seat] as number) <= 0) return 0;
  let rank = 1;
  for (let other = 0; other < seatCount; other++) if (other !== seat && (stats.cells[other] as number) > 0 && above(stats, other, seat)) rank++;
  return rank;
}

export interface SeatName {
  key: TextKey;
  /** Number for the `{n}` placeholder (0 when the key has none). */
  n: number;
}

/** How a seat is called in the leaderboard: you, the AI nations (numbered by seat) and the tribes (numbered from 1). */
export function seatName(seat: number, players: number, localSeat: number): SeatName {
  if (seat === localSeat) return { key: 'hud.you', n: 0 };
  if (seat < players) return { key: 'hud.nation', n: seat };
  return { key: 'hud.tribe', n: seat - players + 1 };
}

/** The text key of a refusal reason (a REJECT_* code of the sim). */
export function rejectKey(reason: number): TextKey {
  switch (reason) {
    case REJECT_TERRAIN:
      return 'reject.terrain';
    case REJECT_OWNED:
      return 'reject.owned';
    case REJECT_SPAWNED:
      return 'reject.spawned';
    case REJECT_PHASE:
      return 'reject.phase';
    case REJECT_IMMUNE:
      return 'reject.immune';
    case REJECT_NO_CONTACT:
      return 'reject.noContact';
    case REJECT_NO_TROOPS:
      return 'reject.noTroops';
    case REJECT_SELF:
      return 'reject.self';
    case REJECT_NOT_SPAWNED:
      return 'reject.notSpawned';
    case REJECT_AMOUNT:
      return 'reject.amount';
    case REJECT_PCT:
      return 'reject.pct';
    default:
      return 'reject.other';
  }
}

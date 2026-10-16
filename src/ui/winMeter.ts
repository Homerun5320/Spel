// The win meter of the top bar (M20a-lite): how close the leader is to the land condition, as a pure function of the sim's read-only `MatchView`
// (src/sim/matchView.ts: `leaderSeat`, `requiredPct`, `holdSeat`, `holdTicksLeft`, `winFlags`). Nothing is recomputed here that the sim knows: the
// requirement NOW (the overtime curve applied) and the hold count-down come from the view; the leader's share is the same Q15 land share the leaderboard
// shows. No DOM, no allocation: the caller owns one `WinMeterState` and `winMeterInto` fills it.
import { TICK_HZ } from './hudCodes';
import { shareHundredths } from './hudLogic';

/** The fields of `MatchView` the meter reads. */
export interface WinMeterSource {
  readonly ended: boolean;
  readonly winFlags: number;
  readonly leaderSeat: number;
  readonly requiredPct: number;
  readonly holdSeat: number;
  readonly holdTicksLeft: number;
}

export interface WinMeterState {
  /** The land condition is on and the match goes on: the meter is shown. */
  active: boolean;
  /** 0-based seat of the leader, -1 = nobody has land yet. */
  leaderSeat: number;
  /** The leader's land share and the share the condition asks for now, in hundredths of a percent. */
  leaderHundredths: number;
  requiredHundredths: number;
  /** The bar fill in quarters of a percent of the bar, 0..400 (the leader's share over the requirement). */
  fillQ: number;
  /** The seat that meets the requirement right now (-1 none) and the whole seconds it must still hold (0 without one). */
  holdSeat: number;
  holdSeconds: number;
}

export function newWinMeterState(): WinMeterState {
  return { active: false, leaderSeat: -1, leaderHundredths: 0, requiredHundredths: 0, fillQ: 0, holdSeat: -1, holdSeconds: 0 };
}

/** `WIN_LAND` of `winFlags` (bit 1 of `MatchView.winFlags`). */
export const WIN_FLAG_LAND = 1;

/** Fills `out` from the match view; `leaderShareQ15` is `stats.landShareQ15[leaderSeat]` (0 without a leader). */
export function winMeterInto(out: WinMeterState, m: WinMeterSource, leaderShareQ15: number): WinMeterState {
  out.active = !m.ended && (m.winFlags & WIN_FLAG_LAND) !== 0;
  out.leaderSeat = m.leaderSeat;
  out.holdSeat = m.holdSeat;
  out.holdSeconds = m.holdSeat >= 0 ? Math.ceil(m.holdTicksLeft / TICK_HZ) : 0;
  out.leaderHundredths = m.leaderSeat >= 0 ? shareHundredths(leaderShareQ15) : 0;
  out.requiredHundredths = Math.round(m.requiredPct * 100);
  out.fillQ = out.requiredHundredths > 0 ? Math.min(400, Math.round((out.leaderHundredths * 400) / out.requiredHundredths)) : 0;
  return out;
}

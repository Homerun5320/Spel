// Time types and the turn schedule of the simulation.
import { INTENT_DELAY_TURNS } from './rules';

/** A count of completed simulation steps (state.tick). Unsigned 32 bit, wraps after 2^32 steps (13 years at 10 Hz). */
export type Tick = number;

/**
 * The index of a turn: the tick at whose step the turn's intents run. In M03 one turn is exactly one tick, so a
 * Turn and a Tick are the same number; the two names keep the call sites honest for the day a turn spans several ticks.
 */
export type Turn = number;

/** The turn in which an intent submitted at `now` runs (T + INTENT_DELAY_TURNS, unsigned 32 bit). */
export function scheduledTurn(now: Tick): Turn {
  return (now + INTENT_DELAY_TURNS) >>> 0;
}

// Scripted bots for the headless scenarios. They live in tools/, never in src/sim: the simulation only ever sees their
// intents. A bot reads the state (the scenario tool may; the game's own AI will go through SimView in M05) and answers with
// IntentBody values. Deterministic: no clock, no Math.random; every choice is a function of the state.
import type { IntentBody } from '../../src/sim/intents';
import { seatToOwner, type GameState } from '../../src/sim/state';

/** A bot acts once per this many ticks (1 s at 10 Hz), each seat on its own phase. */
export const BOT_PERIOD_TICKS = 10;

/** Percent of its troops a player bot commits to an attack on unowned land / on a neighbour. Tribes ignore it (they commit T / 20). */
export const BOT_EXPAND_PCT = 100;
export const BOT_WAR_PCT = 60;
/** A player bot attacks a neighbour only when its troops are at least this many percent of the neighbour's. */
export const BOT_WAR_MIN_RATIO_PCT = 150;

export type BotKind = 'expander' | 'fighter';

/**
 * What the bot of `seat` does at this tick: nothing most ticks; once per BOT_PERIOD_TICKS it (1) attacks unowned land if it
 * touches any and no such attack is running, else (2) a fighter attacks the weakest neighbour it is stronger than.
 */
export function botIntents(state: GameState, seat: number, kind: BotKind): IntentBody[] {
  if ((state.tick + seat * 3) % BOT_PERIOD_TICKS !== 0) return [];
  const owner = seatToOwner(seat);
  if ((state.agg.area[owner] as number) === 0) return [];
  const b = state.borders;
  if (b.contact(owner, 0) > 0 && state.attacks.find(owner, 0) === null) return [{ kind: 'Attack', seat, target: 0, pct: BOT_EXPAND_PCT }];
  if (kind !== 'fighter') return [];
  let best = -1;
  let bestTroops = 0;
  for (let o = 1; o <= state.header.seats; o++) {
    if (o === owner || b.contact(owner, o) === 0 || state.attacks.find(owner, o) !== null) continue;
    const t = state.troops[o] as number;
    if (best === -1 || t < bestTroops) {
      best = o;
      bestTroops = t;
    }
  }
  if (best === -1) return [];
  if ((state.troops[owner] as number) * 100 < bestTroops * BOT_WAR_MIN_RATIO_PCT) return [];
  return [{ kind: 'Attack', seat, target: best, pct: BOT_WAR_PCT }];
}

// DebugGive (test only): adds gold and troops to a seat that has land. The intent is valid only when the match config has
// debugIntents (validateIntent), so a real match can never receive it.
import { addTroops } from './economy';
import { REJECT_NONE, REJECT_NOT_SPAWNED } from './intents';
import { MILLI_GOLD_PER_GOLD, QT_PER_TROOP } from './rules';
import { seatToOwner, type GameState } from './state';

const U32_MAX = 4294967295;

/** Adds `gold` gold and `troops` troops (whole units) to `seat`. Refused when the seat has no land (the spawn would overwrite the gift). */
export function applyDebugGive(state: GameState, seat: number, gold: number, troops: number): number {
  const owner = seatToOwner(seat);
  if ((state.agg.area[owner] as number) === 0) return REJECT_NOT_SPAWNED;
  const sum = (state.gold[owner] as number) + gold * MILLI_GOLD_PER_GOLD;
  state.gold[owner] = sum > U32_MAX ? U32_MAX : sum;
  addTroops(state, owner, troops * QT_PER_TROOP);
  return REJECT_NONE;
}

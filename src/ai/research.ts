// The AI's research (M18d-1). Deterministic, no randomness, no memory of its own: the back-off is the tick itself (a seat looks once per AI_TECH_PERIOD_TICKS, staggered by seat).
//
// A nation starts a research when it has no research running, at least AI_TECH_GOLD_RESERVE gold would be left after the price, and the tick is past AI_TECH_START_TICKS (expansion first).
// WHICH branch: the order depends on the situation. Under attack (an attack on it is running): DEFENCE, LAND, ECONOMY, AIR. With helicopters or a SAM site: AIR, ECONOMY, LAND, DEFENCE.
// Otherwise (rich and at peace): ECONOMY, LAND, DEFENCE, AIR. The first branch in the order that still has a step to research is the one; if it cannot be paid yet the AI waits (it
// does not drift to another branch). Every intent is checked with `validateResearch`, the very function the sim runs, so the AI never sends an invalid one.
import {
  AI_TECH_GOLD_RESERVE,
  AI_TECH_PERIOD_TICKS,
  AI_TECH_START_TICKS,
  AI_THINK_PERIOD_TICKS,
  AI_THINK_STAGGER_TICKS,
  MILLI_GOLD_PER_GOLD,
  REJECT_NONE,
  STRUCT_SAM,
  TECH_BRANCH_AIR,
  TECH_BRANCH_DEFENCE,
  TECH_BRANCH_ECONOMY,
  TECH_BRANCH_LAND,
  TECH_PRICE_GOLD,
  TECH_STEPS,
  fleetCountOf,
  researchBody,
  seatToOwner,
  validateResearch,
  type IntentBody,
  type SimView,
} from '../sim/public';
import type { AiMemory } from './memory';

const UNDER_ATTACK: readonly number[] = [TECH_BRANCH_DEFENCE, TECH_BRANCH_LAND, TECH_BRANCH_ECONOMY, TECH_BRANCH_AIR];
const AIRBORNE: readonly number[] = [TECH_BRANCH_AIR, TECH_BRANCH_ECONOMY, TECH_BRANCH_LAND, TECH_BRANCH_DEFENCE];
const PEACEFUL: readonly number[] = [TECH_BRANCH_ECONOMY, TECH_BRANCH_LAND, TECH_BRANCH_DEFENCE, TECH_BRANCH_AIR];

/** Is somebody attacking this seat right now? */
function underAttack(view: SimView, seat: number): boolean {
  const me = seatToOwner(seat);
  for (let other = 0; other < view.seats; other++) {
    if (other !== seat && view.attackRunning(seatToOwner(other), me)) return true;
  }
  return false;
}

/** The research the seat starts now, or null. */
export function researchMove(view: SimView, memory: AiMemory): IntentBody | null {
  if (memory.tribe || view.match.ended || view.tick < AI_TECH_START_TICKS) return null;
  const seat = memory.seat;
  // Half a think period away from the build rhythm of the seat (src/ai/build.ts acts on (tick + phase) % AI_THINK_PERIOD_TICKS === 0): the Build / Upgrade of a seat and its
  // Research are never decided on the same tick, so a purse that paid for the research at decision time still does when the intent runs (T + 2).
  if ((view.tick + seat * AI_THINK_STAGGER_TICKS + AI_THINK_PERIOD_TICKS / 2) % AI_TECH_PERIOD_TICKS !== 0) return null;
  if (view.stats.alive[seat] === 0 || view.match.techCurrentOfSeat(seat) >= 0) return null;
  const mask = view.match.techMaskOfSeat(seat);
  const order = underAttack(view, seat) ? UNDER_ATTACK : fleetCountOf(view, seat) > 0 || view.structures.ownedCount(seatToOwner(seat), STRUCT_SAM) > 0 ? AIRBORNE : PEACEFUL;
  for (let i = 0; i < order.length; i++) {
    const branch = order[i] as number;
    for (let step = 0; step < TECH_STEPS; step++) {
      const tech = branch * TECH_STEPS + step;
      if ((mask & (1 << tech)) !== 0) continue;
      // The next step of this branch: wait for the gold (price + reserve) rather than drift to another branch.
      if ((view.stats.goldMilli[seat] as number) < ((TECH_PRICE_GOLD[tech] as number) + AI_TECH_GOLD_RESERVE) * MILLI_GOLD_PER_GOLD) return null;
      return validateResearch(view, seat, tech) === REJECT_NONE ? researchBody(seat, tech) : null;
    }
  }
  return null;
}

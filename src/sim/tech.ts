// The technology mutators (M18d-1): Research, CancelResearch and the phase that finishes a research. The rules are in src/sim/techRules.ts (the same checks the
// public validators run); the numbers in rules.ts (TECH_*); the cached effects in MatchState.techFx, read by the economy, conquest, helicopter and air-defence code.
import { REJECT_NONE } from './intents';
import { checkCancelResearch, checkResearch, techPriceMilli, techTicksWithLab } from './techRules';
import { seatToOwner, type GameState } from './state';
import { spawnPhaseRefuses } from './structures';
import { labResearchPctOf } from './structureRules';

/** Applies a Research: the rules (checkResearch), then the price is taken NOW and the research runs for TECH_TICKS[tech] ticks, shortened by the percent the finished Labs give at this moment (M18e-1: fixed when it starts). */
export function applyResearch(state: GameState, seat: number, tech: number): number {
  const m = state.match;
  const o = seatToOwner(seat);
  const why = checkResearch(m.techMask[o] as number, (m.techCurrent[o] as number) - 1, state.gold[o] as number, spawnPhaseRefuses(state), m.ended === 1, m.eliminated[o] === 1, tech);
  if (why !== REJECT_NONE) return why;
  state.gold[o] = (state.gold[o] as number) - techPriceMilli(tech);
  m.techCurrent[o] = tech + 1;
  m.techDone[o] = state.tick + techTicksWithLab(tech, labResearchPctOf(state, o));
  return REJECT_NONE;
}

/** Applies a CancelResearch: the running research stops, no refund. */
export function applyCancelResearch(state: GameState, seat: number): number {
  const m = state.match;
  const o = seatToOwner(seat);
  const why = checkCancelResearch((m.techCurrent[o] as number) - 1, spawnPhaseRefuses(state), m.ended === 1, m.eliminated[o] === 1);
  if (why !== REJECT_NONE) return why;
  m.techCurrent[o] = 0;
  m.techDone[o] = 0;
  return REJECT_NONE;
}

/**
 * Phase of the tick (run after the tick counter has been incremented): a research whose finish tick has come becomes a researched tech. A research
 * started in the step of tick T lasting N ticks is therefore researched exactly when `state.tick` reaches T + N. The structure income cache is marked
 * dirty because the gold effect is part of it. O(seats), no scan of the map.
 */
export function techPhase(state: GameState): void {
  const m = state.match;
  const seats = state.header.seats;
  for (let o = 1; o <= seats; o++) {
    const cur = m.techCurrent[o] as number;
    if (cur === 0 || state.tick < (m.techDone[o] as number)) continue;
    m.setTechMask(o, (m.techMask[o] as number) | (1 << (cur - 1)));
    m.techCurrent[o] = 0;
    m.techDone[o] = 0;
    state.structures.effDirty = true;
  }
}

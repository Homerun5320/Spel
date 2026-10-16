// The research rules UI and AI may read (M18d-1): ONE implementation of the Research and CancelResearch checks (`checkResearch`, `checkCancelResearch`) that the
// sim's own `applyResearch` and the public `validateResearch` / `validateCancelResearch` both call (the pattern of `checkProduceHeli` / `validateProduceHeli`).
// Pure and read-only: the checks take plain numbers, the validators take a SimView.
import { PHASE_SPAWN } from './flow';
import {
  REJECT_NONE,
  REJECT_PHASE,
  REJECT_TECH_BUSY,
  REJECT_TECH_DONE,
  REJECT_TECH_ELIMINATED,
  REJECT_TECH_GOLD,
  REJECT_TECH_ID,
  REJECT_TECH_MATCH_ENDED,
  REJECT_TECH_NOT_ACTIVE,
  REJECT_TECH_PREREQ,
} from './intents';
import { MILLI_GOLD_PER_GOLD, TECH_PRICE_GOLD, TECH_TICKS } from './rules';
import { isTech, techPrereqOf } from './techTable';
import type { SimView } from './view';

/** What a rule that depends on the researched techs reads: a MatchState (the sim) and a MatchView (the page) both have it. */
export interface TechMaskSource {
  techMaskOfSeat(seat: number): number;
}

/** Price of a tech in milli-gold. */
export function techPriceMilli(tech: number): number {
  return (TECH_PRICE_GOLD[tech] as number) * MILLI_GOLD_PER_GOLD;
}

/** Research time of a tech in ticks. */
export function techTicksOf(tech: number): number {
  return TECH_TICKS[tech] as number;
}

/**
 * THE Research rules. Returns REJECT_NONE or the reason, checking in this order: the tech number, the match is over, the seat is eliminated, the spawn phase,
 * already researched, the previous step is missing, another research is running, the purse. `mask` is the seat's researched techs, `current` the tech it
 * is researching (-1 = none), `goldMilli` its gold.
 */
export function checkResearch(mask: number, current: number, goldMilli: number, phaseRefuses: boolean, matchEnded: boolean, eliminated: boolean, tech: number): number {
  if (!isTech(tech)) return REJECT_TECH_ID;
  if (matchEnded) return REJECT_TECH_MATCH_ENDED;
  if (eliminated) return REJECT_TECH_ELIMINATED;
  if (phaseRefuses) return REJECT_PHASE;
  if ((mask & (1 << tech)) !== 0) return REJECT_TECH_DONE;
  const pre = techPrereqOf(tech);
  if (pre >= 0 && (mask & (1 << pre)) === 0) return REJECT_TECH_PREREQ;
  if (current >= 0) return REJECT_TECH_BUSY;
  if (goldMilli < techPriceMilli(tech)) return REJECT_TECH_GOLD;
  return REJECT_NONE;
}

/** THE CancelResearch rules: the match is over, the seat is eliminated, the spawn phase, or no research is running. */
export function checkCancelResearch(current: number, phaseRefuses: boolean, matchEnded: boolean, eliminated: boolean): number {
  if (matchEnded) return REJECT_TECH_MATCH_ENDED;
  if (eliminated) return REJECT_TECH_ELIMINATED;
  if (phaseRefuses) return REJECT_PHASE;
  if (current < 0) return REJECT_TECH_NOT_ACTIVE;
  return REJECT_NONE;
}

/** Why `seat` could not start researching `tech` right now in the snapshot `view` (REJECT_NONE = it could). The sim runs the same `checkResearch`. */
export function validateResearch(view: SimView, seat: number, tech: number): number {
  const m = view.match;
  return checkResearch(m.techMaskOfSeat(seat), m.techCurrentOfSeat(seat), view.stats.goldMilli[seat] as number, view.flow && view.phase === PHASE_SPAWN, m.ended, m.eliminated[seat] === 1, tech);
}

/** Why `seat` could not cancel its research right now in the snapshot `view` (REJECT_NONE = it could). */
export function validateCancelResearch(view: SimView, seat: number): number {
  const m = view.match;
  return checkCancelResearch(m.techCurrentOfSeat(seat), view.flow && view.phase === PHASE_SPAWN, m.ended, m.eliminated[seat] === 1);
}

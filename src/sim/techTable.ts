// The research tree as pure numbers (M18d-1): which tech is in which branch and step, what a set of researched techs gives per effect channel. Imports only
// rules.ts, so the match state, the checks and the effect code can all use it. The numbers themselves are the TECH_* tables of rules.ts.
import { TECH_COUNT, TECH_FX, TECH_FX_CAP, TECH_FX_CHANNELS, TECH_STEPS } from './rules';

/** Branches. */
export const TECH_BRANCH_ECONOMY = 0;
export const TECH_BRANCH_LAND = 1;
export const TECH_BRANCH_AIR = 2;
export const TECH_BRANCH_DEFENCE = 3;

/** Effect channels (the column of TECH_FX). */
export const TECH_FX_GOLD = 0;
export const TECH_FX_UPGRADE = 1;
export const TECH_FX_COST = 2;
export const TECH_FX_REGEN = 3;
export const TECH_FX_CAP_TROOPS = 4;
export const TECH_FX_LOAD = 5;
export const TECH_FX_SPEED = 6;
export const TECH_FX_FUEL = 7;
export const TECH_FX_FLEET = 8;
export const TECH_FX_SAM_HIT = 9;
export const TECH_FX_WALLS_POST = 10;
export const TECH_FX_SAM_SALVO = 11;

/** The mask of all 16 techs. */
export const TECH_ALL_MASK = (1 << TECH_COUNT) - 1;

/** The branch (0..3) of a tech index. */
export function techBranchOf(tech: number): number {
  return Math.floor(tech / TECH_STEPS);
}

/** The step (0..3) of a tech index inside its branch. */
export function techStepOf(tech: number): number {
  return tech % TECH_STEPS;
}

/** The tech that must be researched first (the previous step of the same branch), or -1 for a first step. */
export function techPrereqOf(tech: number): number {
  return tech % TECH_STEPS === 0 ? -1 : tech - 1;
}

/** Is `tech` an integer 0..TECH_COUNT-1? */
export function isTech(tech: unknown): tech is number {
  return typeof tech === 'number' && Number.isInteger(tech) && tech >= 0 && tech < TECH_COUNT;
}

/** Number of researched techs in a mask. */
export function techCountOfMask(mask: number): number {
  let n = 0;
  for (let t = 0; t < TECH_COUNT; t++) if ((mask & (1 << t)) !== 0) n++;
  return n;
}

/** Is every researched step preceded by its previous step (the only masks a real match can reach)? */
export function techMaskValid(mask: number): boolean {
  if (!Number.isInteger(mask) || mask < 0 || mask > TECH_ALL_MASK) return false;
  for (let t = 0; t < TECH_COUNT; t++) {
    if ((mask & (1 << t)) !== 0 && techPrereqOf(t) >= 0 && (mask & (1 << techPrereqOf(t))) === 0) return false;
  }
  return true;
}

/** What the researched techs of `mask` give on one effect channel: the sum of their TECH_FX values, at most TECH_FX_CAP. */
export function techFxOfMask(mask: number, channel: number): number {
  let sum = 0;
  for (let t = 0; t < TECH_COUNT; t++) if ((mask & (1 << t)) !== 0) sum += TECH_FX[t * TECH_FX_CHANNELS + channel] as number;
  const cap = TECH_FX_CAP[channel] as number;
  return sum > cap ? cap : sum;
}

/** The sum of one branch's techs in `mask` on one channel, WITHOUT the cap (a test shows the branch sums stay at or under the cap). */
export function techBranchFxSum(mask: number, branch: number, channel: number): number {
  let sum = 0;
  for (let s = 0; s < TECH_STEPS; s++) {
    const t = branch * TECH_STEPS + s;
    if ((mask & (1 << t)) !== 0) sum += TECH_FX[t * TECH_FX_CHANNELS + channel] as number;
  }
  return sum;
}

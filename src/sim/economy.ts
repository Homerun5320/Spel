// The economy of a seat: troop cap, regeneration, gold, the start values and the per-tick update. All integer maths.
//
// Units (rules.ts, D73): troops in quarter troops (QT), the remainder of a tick in micro-QT, gold in milli-gold, areas as
// Q15 cos-weighted sums of sim cells; N in the cap formula is the owned area in std-cells (Q15). Every formula below is
// written out in the comment above it with the units of each step. Nothing here reads a float other than the exact
// results of + - * / and Math.sqrt on integers below 2^53.
import { floorDiv, isqrt } from './detmath';
import {
  CAP_BASE_QT,
  CAP_CITY_LEVEL_QT,
  CAP_N_COEF_QT,
  GOLD_PER_STD_CELL_MILLI_PER_SEC,
  MAX_DECAY_MICRO_QT_PER_TICK,
  MICRO_QT_PER_QT,
  QT_PER_TROOP,
  REGEN_BASE_TROOPS_PER_SEC,
  REGEN_SQRT_COEF_MILLI,
  SQRT_MILLI_PER_QT,
  START_GOLD_MILLI,
  START_TROOPS_QT,
  TICK_HZ,
  TRIBE_CAP_DIV,
  TRIBE_REGEN_PCT,
  WEIGHT_ONE,
} from './rules';
import type { GameState } from './state';
import { weightedSimToStdQ15 } from './units';
import { barracksPctOf, cityLevelsOf, housingQtOf, structGoldMilliPerTick } from './structureEffects';

/** Largest value of a Uint32 array element. */
const U32_MAX = 4294967295;

/** Is this ownerId a tribe (a seat after the players)? */
export function isTribe(state: GameState, owner: number): boolean {
  return owner > state.header.players;
}

/** Finished City levels of an owner (M09 part B: from the structure table; 0 without structures). */
export function cityLevels(state: GameState, owner: number): number {
  return cityLevelsOf(state, owner);
}

/** N in std-cells as Q15 for an owner: the Q15-weighted sim cells it owns divided by STD_CELL_AREA. */
export function ownedStdAreaQ15(state: GameState, owner: number): number {
  return weightedSimToStdQ15(state.agg.warea[owner] as number);
}

/**
 * N^0.75 in Q15 for N given in Q15, as sqrt(N) * sqrt(sqrt(N)) with integer square roots: s1 = isqrt(nQ15 * 2^15) is
 * sqrt(N) in Q15, s2 = isqrt(s1 * 2^15) is N^0.25 in Q15, and s1 * s2 / 2^15 is N^0.75 in Q15. Each step floors, so the
 * result is within a few Q15 units of the real power for every N up to the size of the world (a test measures it).
 */
export function pow075Q15(nQ15: number): number {
  const s1 = isqrt(nQ15 * WEIGHT_ONE);
  const s2 = isqrt(s1 * WEIGHT_ONE);
  return Math.floor((s1 * s2) / WEIGHT_ONE);
}

/**
 * Troop cap in QT: (CAP_BASE + CAP_N_COEF * N^0.75 + CAP_CITY_LEVEL * levels) troops, a tribe's divided by TRIBE_CAP_DIV.
 * `nQ15` is N in std-cells as Q15. `housingQt` (Districts-1) is the troop cap the owner's finished Housing districts add, in QT.
 */
export function troopCapQt(nQ15: number, levels: number, tribe: boolean, housingQt = 0): number {
  const cap = CAP_BASE_QT + Math.floor((CAP_N_COEF_QT * pow075Q15(nQ15)) / WEIGHT_ONE) + CAP_CITY_LEVEL_QT * levels + housingQt;
  return tribe ? Math.floor(cap / TRIBE_CAP_DIV) : cap;
}

/**
 * Troop regeneration in micro-QT per tick (negative above the cap):
 *   per second, in troops:   r = (REGEN_BASE + REGEN_SQRT_COEF * sqrt(T)) * (1 - T / Tmax),  at least -MAX_DECAY
 *   in micro-troops/second:  a = REGEN_BASE * 10^6 + REGEN_SQRT_COEF_MILLI * (sqrt(T) * 1000)   [sqrt(T)*1000 = isqrt(T_QT * 250000)]
 *                            x = floor(a * (Tmax - T) / Tmax)
 *   per tick in micro-QT:    floor(x * QT_PER_TROOP / TICK_HZ), a tribe's positive rate times TRIBE_REGEN_PCT / 100
 * T above 4 * Tmax is treated as 4 * Tmax: the rate is already below -MAX_DECAY there, and the clamp keeps every product
 * below 2^53 for any value a corrupt snapshot could hold. Returns 0 when tmaxQt is 0 (no division by zero).
 */
export function regenMicroQtPerTick(tQt: number, tmaxQt: number, tribe: boolean): number {
  if (tmaxQt <= 0) return 0;
  const t = tQt > 4 * tmaxQt ? 4 * tmaxQt : tQt;
  const sqrtMilli = isqrt(t * SQRT_MILLI_PER_QT);
  const a = REGEN_BASE_TROOPS_PER_SEC * 1000000 + REGEN_SQRT_COEF_MILLI * sqrtMilli;
  const x = floorDiv(a * (tmaxQt - t), tmaxQt);
  let rate = floorDiv(x * QT_PER_TROOP, TICK_HZ);
  if (tribe && rate > 0) rate = floorDiv(rate * TRIBE_REGEN_PCT, 100);
  return rate < -MAX_DECAY_MICRO_QT_PER_TICK ? -MAX_DECAY_MICRO_QT_PER_TICK : rate;
}

/** Gold income in milli-gold per tick for N in std-cells (Q15): N * GOLD_PER_STD_CELL_MILLI_PER_SEC / TICK_HZ, floored. */
export function goldMilliPerTick(nQ15: number): number {
  return Math.floor((nQ15 * GOLD_PER_STD_CELL_MILLI_PER_SEC) / (TICK_HZ * WEIGHT_ONE));
}

/**
 * Takes `amountQt` troops from an owner, never below 0 (T >= 0 after every deduction). Returns what was really taken,
 * which is less than asked when the owner had less. The regeneration remainder is untouched.
 */
export function deductTroops(state: GameState, owner: number, amountQt: number): number {
  const have = state.troops[owner] as number;
  const take = amountQt <= 0 ? 0 : amountQt > have ? have : amountQt;
  state.troops[owner] = have - take;
  return take;
}

/** Adds troops, saturating at the Uint32 maximum. */
export function addTroops(state: GameState, owner: number, amountQt: number): void {
  const sum = (state.troops[owner] as number) + (amountQt > 0 ? amountQt : 0);
  state.troops[owner] = sum > U32_MAX ? U32_MAX : sum;
}

/** The cap in QT of an owner right now. */
export function ownerCapQt(state: GameState, owner: number): number {
  return troopCapQt(ownedStdAreaQ15(state, owner), cityLevels(state, owner), isTribe(state, owner), housingQtOf(state, owner));
}

/** Gives a seat that just spawned its start troops (clamped to its cap) and start gold, and clears the remainder. */
export function applyStartValues(state: GameState, owner: number): void {
  const cap = ownerCapQt(state, owner);
  state.troops[owner] = START_TROOPS_QT > cap ? cap : START_TROOPS_QT;
  state.troopFrac[owner] = 0;
  state.gold[owner] = START_GOLD_MILLI;
}

/**
 * One tick of the economy for every owner that holds land: troops regenerate (or decay above the cap), gold comes in.
 * Owners without cells (not spawned yet, or wiped out) are skipped. O(seats), no scan of the map.
 */
export function economyTick(state: GameState): void {
  const seats = state.header.seats;
  for (let owner = 1; owner <= seats; owner++) {
    if ((state.agg.area[owner] as number) === 0) continue;
    const nQ15 = ownedStdAreaQ15(state, owner);
    const tribe = isTribe(state, owner);
    const cap = troopCapQt(nQ15, cityLevels(state, owner), tribe, housingQtOf(state, owner));
    let rate = regenMicroQtPerTick(state.troops[owner] as number, cap, tribe);
    // Barracks (Districts-1): the owner's finished Barracks raise a positive regeneration by their percent (decay is untouched).
    if (rate > 0) {
      const barracks = barracksPctOf(state, owner);
      if (barracks !== 0) rate = floorDiv(rate * (100 + barracks), 100);
    }
    const acc = (state.troopFrac[owner] as number) + rate;
    const whole = floorDiv(acc, MICRO_QT_PER_QT);
    const have = state.troops[owner] as number;
    if (have + whole <= 0) {
      state.troops[owner] = 0;
      state.troopFrac[owner] = 0;
    } else {
      state.troops[owner] = have + whole;
      state.troopFrac[owner] = acc - whole * MICRO_QT_PER_QT;
    }
    const income = goldMilliPerTick(nQ15) + structGoldMilliPerTick(state, owner);
    const gold = (state.gold[owner] as number) + income;
    state.gold[owner] = gold > U32_MAX ? U32_MAX : gold;
  }
}

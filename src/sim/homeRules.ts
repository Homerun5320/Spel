// Home land and nation traits (M06, D112 to D114): optional sim state of a match whose config has `homeRules`.
//  - `country`: the country id of every cell (a constant of the world, like the terrain);
//  - `homeLand[owner]`: the country the owner calls home (0 = none). A cell of that country costs its owner HOME_COST_PCT of the
//    normal price to conquer; nobody else gets the discount and no other cell does (D112);
//  - `portMilli[owner]`: the port income multiplier in thousandths, stored for M09 (nothing reads it yet);
//  - `defenceMilli[owner]`: the defence multiplier in thousandths; an attacker pays this many thousandths of the normal price for
//    a cell it takes from that owner (D113).
// Both multipliers stay within 1000 +- TRAIT_CAP_MILLI (the +-10 % cap): the setter clamps, deserialize refuses a state outside it.
// A match without the flag has no HomeRules (`state.home` is null), is not serialised with them and hashes exactly as in M05.
import {
  HOME_COST_PCT,
  TRAIT_CAP_MILLI,
  TRAIT_NEUTRAL_MILLI,
} from './rules';

export interface HomeRules {
  /** Country id per cell (0 = none), `width * height` long. Constant. */
  readonly country: Uint8Array;
  /** Home country per ownerId (slot 0 unused and 0). */
  readonly homeLand: Uint8Array;
  /** Port income multiplier per ownerId in thousandths (stored; M09 reads it). */
  readonly portMilli: Uint16Array;
  /** Defence multiplier per ownerId in thousandths (an attacker's price against that owner). */
  readonly defenceMilli: Uint16Array;
}

/** The lowest and highest legal trait multiplier in thousandths. */
export const TRAIT_MIN_MILLI = TRAIT_NEUTRAL_MILLI - TRAIT_CAP_MILLI;
export const TRAIT_MAX_MILLI = TRAIT_NEUTRAL_MILLI + TRAIT_CAP_MILLI;

/** Clamps a trait multiplier (thousandths) into the +-10 % cap; anything that is not an integer counts as neutral. */
export function clampTraitMilli(m: number): number {
  if (!Number.isInteger(m)) return TRAIT_NEUTRAL_MILLI;
  return m < TRAIT_MIN_MILLI ? TRAIT_MIN_MILLI : m > TRAIT_MAX_MILLI ? TRAIT_MAX_MILLI : m;
}

/**
 * The multiplier (thousandths) a country's share of some map feature earns: 1000 + (share - mid) * gain / 100, floored, then
 * clamped to the cap. `sharePermille` is the share in thousandths (0..1000), `midPermille` the share that gives x1 and `gainPct` the
 * gain in percent (25 = 0.25 multiplier thousandths per share thousandth).
 */
export function traitMilli(sharePermille: number, midPermille: number, gainPct: number): number {
  return clampTraitMilli(TRAIT_NEUTRAL_MILLI + Math.floor(((sharePermille - midPermille) * gainPct) / 100));
}

/** Fresh rules for a world: the given country map (copied), nobody has a home land, every multiplier neutral. */
export function createHomeRules(country: ArrayLike<number>, slots: number): HomeRules {
  const copy = new Uint8Array(country.length);
  for (let i = 0; i < country.length; i++) copy[i] = country[i] as number;
  return { country: copy, homeLand: new Uint8Array(slots), portMilli: new Uint16Array(slots).fill(TRAIT_NEUTRAL_MILLI), defenceMilli: new Uint16Array(slots).fill(TRAIT_NEUTRAL_MILLI) };
}

/** The home land, port income and defence of an owner (the setter used at match setup; the multipliers are clamped to the cap). */
export interface SeatRules {
  readonly homeLand: number;
  readonly portMilli: number;
  readonly defenceMilli: number;
}

export function setOwnerRules(home: HomeRules, owner: number, rules: SeatRules): void {
  home.homeLand[owner] = rules.homeLand >= 0 && rules.homeLand <= 255 && Number.isInteger(rules.homeLand) ? rules.homeLand : 0;
  home.portMilli[owner] = clampTraitMilli(rules.portMilli);
  home.defenceMilli[owner] = clampTraitMilli(rules.defenceMilli);
}

/**
 * The price (milli-QT) of taking `cell` for `attacker` from `target` (0 = unowned), after the rules of the match: the owner of a
 * home land pays HOME_COST_PCT of the price for a cell of that country; a cell taken from an owner costs that owner's defence
 * multiplier in thousandths. Floors once at the end: cost * pct * multiplier / (100 * 1000), far below 2^53.
 */
export function adjustedCostMilliQt(home: HomeRules, cost: number, cell: number, attacker: number, target: number): number {
  const mine = home.homeLand[attacker] as number;
  const pct = mine !== 0 && home.country[cell] === mine ? HOME_COST_PCT : 100;
  const mult = target === 0 ? TRAIT_NEUTRAL_MILLI : (home.defenceMilli[target] as number);
  if (pct === 100 && mult === TRAIT_NEUTRAL_MILLI) return cost;
  return Math.floor((cost * pct * mult) / (100 * TRAIT_NEUTRAL_MILLI));
}

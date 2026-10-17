// Home land and nation traits (M06, D112 to D114): the discount belongs to the owner of the home land and to the cells of that country
// only, the defence trait changes the attacker's price, the +-10 % cap holds in the setter and in the snapshot, a match without the flag
// is untouched, and the state with the flag round-trips and is covered by the hash.
import { describe, expect, it } from 'vitest';
import { applyAttack, conquestPhase } from '../../src/sim/conquest';
import { adjustedCostMilliQt, clampTraitMilli, createHomeRules, setOwnerRules, traitMilli, TRAIT_MAX_MILLI, TRAIT_MIN_MILLI } from '../../src/sim/homeRules';
import { REJECT_NONE } from '../../src/sim/intents';
import { HOME_COST_PCT, TRAIT_CAP_MILLI, TRAIT_COAST_GAIN_PCT, TRAIT_COAST_MID_PERMILLE, TRAIT_NEUTRAL_MILLI } from '../../src/sim/rules';
import { deserialize, hashState, serialize, serializedLengthOf } from '../../src/sim/serialize';
import { CONFIG_FLAG_HOME_RULES, configToFlags, createState, flagsToConfig, type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';
import { saveLayout } from '../helpers/saveLayout';

const LEN = 41; // the last column is sea (the world wraps east-west)
const SPLIT = 21; // cells x < SPLIT are country A_COUNTRY, the others B_COUNTRY
const A_COUNTRY = 5;
const B_COUNTRY = 6;

/** A one-cell-wide Plains corridor, 3 rows, with a country map: A_COUNTRY on the left half, B_COUNTRY on the right. */
function corridor(homeRules: boolean): GameState {
  const terrain = new Uint8Array(LEN * 3);
  const countryMap = new Uint8Array(LEN * 3);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < LEN; x++) {
      terrain[y * LEN + x] = y === 1 && x < LEN - 1 ? CLASS_PLAINS : CLASS_DEEP_SEA;
      countryMap[y * LEN + x] = x < SPLIT ? A_COUNTRY : B_COUNTRY;
    }
  }
  return createState({ width: LEN, height: 3, seed: 1, seats: 4, config: { debugIntents: false, homeRules }, terrain, elevation: new Uint16Array(LEN * 3), countryMap: homeRules ? countryMap : undefined });
}

const at = (x: number): number => LEN + x;

/**
 * Owner 1 owns the cells x < `from` and attacks unowned land with `commit` QT; runs the conquest until it has taken `cells` cells and returns the
 * QT the attack has paid. `home` is the home land of owner 1 (0 = none).
 */
function paidForCells(from: number, cells: number, home: number, homeRules = true): number {
  const s = corridor(homeRules);
  for (let x = 0; x < from; x++) setOwner(s, at(x), 1, 0);
  if (s.home !== null) setOwnerRules(s.home, 1, { homeLand: home, portMilli: 1000, defenceMilli: 1000 });
  const commit = 4000000;
  s.troops[1] = commit;
  expect(applyAttack(s, 0, 0, 100)).toBe(REJECT_NONE);
  let guard = 0;
  while ((s.agg.area[1] as number) < from + cells && guard++ < 5000) {
    conquestPhase(s);
    s.tick++;
  }
  expect(s.agg.area[1]).toBe(from + cells);
  const a = s.attacks.list[0];
  return commit - (a === undefined ? 0 : a.troops);
}

describe('adjustedCostMilliQt (the cost rule)', () => {
  const home = createHomeRules(new Uint8Array([A_COUNTRY, A_COUNTRY, B_COUNTRY, 0]), 4);
  setOwnerRules(home, 1, { homeLand: A_COUNTRY, portMilli: 1000, defenceMilli: 1000 });
  setOwnerRules(home, 2, { homeLand: B_COUNTRY, portMilli: 1000, defenceMilli: 1100 });
  setOwnerRules(home, 3, { homeLand: 0, portMilli: 1000, defenceMilli: 900 });

  it('the owner of a home land pays HOME_COST_PCT of the price for a cell of that country, and only for those cells', () => {
    expect(HOME_COST_PCT).toBe(50);
    expect(adjustedCostMilliQt(home, 3000, 0, 1, 0)).toBe(1500); // owner 1, a cell of country A, unowned
    expect(adjustedCostMilliQt(home, 3000, 1, 1, 3)).toBe(Math.floor((3000 * 50 * 900) / 100000)); // taken from owner 3, who defends at 0.9
    expect(adjustedCostMilliQt(home, 3000, 2, 1, 0)).toBe(3000); // a cell of country B: full price for owner 1
    expect(adjustedCostMilliQt(home, 3000, 3, 1, 0)).toBe(3000); // a cell with no country: full price
  });

  it('nobody else gets the discount: another owner pays full for the same cell, and an owner with no home land never gets it', () => {
    expect(adjustedCostMilliQt(home, 3000, 0, 2, 0)).toBe(3000); // owner 2's home is B
    expect(adjustedCostMilliQt(home, 3000, 0, 3, 0)).toBe(3000); // owner 3 has no home land (0), and a cell with country 0 must not match it
    expect(adjustedCostMilliQt(home, 3000, 3, 3, 0)).toBe(3000);
    expect(adjustedCostMilliQt(home, 3000, 2, 2, 0)).toBe(1500); // owner 2 on its own country B
  });

  it('the defence multiplier of the seat the cell is taken from scales the price (thousandths); unowned land has none', () => {
    expect(adjustedCostMilliQt(home, 3000, 3, 1, 2)).toBe(3300); // owner 2 defends at 1.1
    expect(adjustedCostMilliQt(home, 3000, 3, 1, 3)).toBe(2700); // owner 3 defends at 0.9
    expect(adjustedCostMilliQt(home, 3000, 3, 1, 0)).toBe(3000);
  });

  it('returns the price untouched when nothing applies, and never a fraction', () => {
    for (const cost of [0, 1, 7, 3000, 123457]) {
      expect(adjustedCostMilliQt(home, cost, 3, 2, 0)).toBe(cost);
      for (const target of [0, 1, 2, 3]) for (const cell of [0, 1, 2, 3]) for (const attacker of [1, 2, 3]) expect(Number.isInteger(adjustedCostMilliQt(home, cost, cell, attacker, target))).toBe(true);
    }
  });
});

describe('the discount in a running conquest', () => {
  it('a home-land conquest costs the owner about half of the same conquest without a home land', () => {
    const full = paidForCells(2, 12, 0);
    const half = paidForCells(2, 12, A_COUNTRY);
    expect(half / full).toBeGreaterThan(0.45);
    expect(half / full).toBeLessThan(0.55);
    // a match without the rule at all pays exactly what a rule-less owner pays
    expect(paidForCells(2, 12, 0, false)).toBe(full);
  });

  it('applies to home-land cells only: the same owner pays the full price on the cells of the other country', () => {
    // the cells x = SPLIT .. SPLIT + 11 belong to country B; an owner whose home is A pays full there, an owner whose home is B pays half
    const none = paidForCells(SPLIT, 12, 0);
    expect(paidForCells(SPLIT, 12, A_COUNTRY)).toBe(none);
    const mine = paidForCells(SPLIT, 12, B_COUNTRY);
    expect(mine / none).toBeGreaterThan(0.45);
    expect(mine / none).toBeLessThan(0.55);
  });

  it('only the owner of the home land profits: a seat that has a different home land pays the full price on the first country', () => {
    expect(paidForCells(2, 12, B_COUNTRY)).toBe(paidForCells(2, 12, 0));
  });

  it('the defence multiplier raises or lowers what an attacker pays for a nation land, and the discount does not disturb it', () => {
    const paid = (defence: number, attackerHome: number): number => {
      const s = corridor(true);
      for (let x = 0; x < 3; x++) setOwner(s, at(x), 1, 0);
      for (let x = 3; x < 25; x++) setOwner(s, at(x), 2, 0);
      setOwnerRules(s.home!, 1, { homeLand: attackerHome, portMilli: 1000, defenceMilli: 1000 });
      setOwnerRules(s.home!, 2, { homeLand: 0, portMilli: 1000, defenceMilli: defence });
      s.troops[1] = 4000000;
      s.troops[2] = 4000000;
      applyAttack(s, 0, 2, 100);
      const a = s.attacks.list[0]!;
      let guard = 0;
      while ((s.agg.area[1] as number) < 3 + 8 && guard++ < 5000) {
        conquestPhase(s);
        s.tick++;
      }
      return 4000000 - a.troops;
    };
    const base = paid(1000, 0);
    expect(paid(1100, 0) / base).toBeGreaterThan(1.07);
    expect(paid(1100, 0) / base).toBeLessThan(1.13);
    expect(paid(900, 0) / base).toBeGreaterThan(0.87);
    expect(paid(900, 0) / base).toBeLessThan(0.93);
    // both together: the home discount (cells 3..10 are country A) and the defence multiplier multiply
    const both = paid(1100, A_COUNTRY) / base;
    expect(both).toBeGreaterThan(0.5 * 1.07);
    expect(both).toBeLessThan(0.5 * 1.13);
  });
});

describe('the trait cap of +-10 %', () => {
  it('the mapping is monotone, neutral at the middle and never leaves 1000 +- TRAIT_CAP_MILLI', () => {
    expect(TRAIT_CAP_MILLI).toBe(100);
    expect(traitMilli(TRAIT_COAST_MID_PERMILLE, TRAIT_COAST_MID_PERMILLE, TRAIT_COAST_GAIN_PCT)).toBe(TRAIT_NEUTRAL_MILLI);
    let last = 0;
    for (let share = 0; share <= 1000; share++) {
      const m = traitMilli(share, TRAIT_COAST_MID_PERMILLE, TRAIT_COAST_GAIN_PCT);
      expect(m).toBeGreaterThanOrEqual(TRAIT_MIN_MILLI);
      expect(m).toBeLessThanOrEqual(TRAIT_MAX_MILLI);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
    expect(traitMilli(0, TRAIT_COAST_MID_PERMILLE, TRAIT_COAST_GAIN_PCT)).toBeLessThan(TRAIT_NEUTRAL_MILLI);
    expect(traitMilli(1000, TRAIT_COAST_MID_PERMILLE, TRAIT_COAST_GAIN_PCT)).toBe(TRAIT_MAX_MILLI);
    // absurd inputs are still inside the cap
    for (const [share, mid, gain] of [[1e9, 0, 100000], [-1e9, 0, 100000], [0, 1e9, 100000], [5, 5, 0]] as const) {
      const m = traitMilli(share, mid, gain);
      expect(m).toBeGreaterThanOrEqual(TRAIT_MIN_MILLI);
      expect(m).toBeLessThanOrEqual(TRAIT_MAX_MILLI);
    }
  });

  it('the setter clamps whatever it is given and treats a non-integer as neutral', () => {
    const home = createHomeRules(new Uint8Array(4), 3);
    setOwnerRules(home, 1, { homeLand: 7, portMilli: 5000, defenceMilli: -5000 });
    expect([home.portMilli[1], home.defenceMilli[1], home.homeLand[1]]).toEqual([TRAIT_MAX_MILLI, TRAIT_MIN_MILLI, 7]);
    setOwnerRules(home, 2, { homeLand: 999, portMilli: Number.NaN, defenceMilli: 1050.5 });
    expect([home.portMilli[2], home.defenceMilli[2], home.homeLand[2]]).toEqual([TRAIT_NEUTRAL_MILLI, TRAIT_NEUTRAL_MILLI, 0]);
    expect([clampTraitMilli(0), clampTraitMilli(1000), clampTraitMilli(2000), clampTraitMilli(1100), clampTraitMilli(1101), clampTraitMilli(899)]).toEqual([900, 1000, 1100, 1100, 1100, 900]);
  });

  it('a snapshot that holds a multiplier outside the cap is refused (the cap is a rule of the state, not only of the setter)', () => {
    const s = corridor(true);
    const bytes = serialize(s);
    const slots = 5; // seats + 1
    const portAt = saveLayout(bytes, slots - 1).emptyAirBlockAt(0) - (8 + 12 * slots) - slots * 2 * 2; // the two u16 blocks end just before the (empty) missile block (M14a: 8 + 12 per ownerId) and the air block
    for (const [offset, value] of [[portAt + 2 * 2, 1101], [portAt + 2 * 2, 899], [portAt + slots * 2 + 3 * 2, 1500], [portAt + slots * 2 + 3 * 2, 0]] as const) {
      const bad = bytes.slice();
      new DataView(bad.buffer).setUint16(offset, value, true);
      const r = deserialize(bad);
      expect(r.ok, `${offset} ${value}`).toBe(false);
      if (!r.ok) expect(r.error).toBe('home-range');
    }
    // an in-range edit passes the range check and is then caught by the checksum
    const edited = bytes.slice();
    new DataView(edited.buffer).setUint16(portAt + 2 * 2, 1050, true);
    const r2 = deserialize(edited);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('checksum');
  });
});

describe('the state with home rules', () => {
  it('has no home block without the flag: the flag is the only difference in the config, `home` is null, the size is unchanged', () => {
    const plain = corridor(false);
    expect(plain.home).toBeNull();
    expect(plain.header.config).toEqual({ debugIntents: false });
    expect(configToFlags(plain.header.config)).toBe(0);
    expect(serializedLengthOf(plain)).toBe(serialize(plain).length);
    const withHome = corridor(true);
    expect(withHome.home).not.toBeNull();
    expect(configToFlags(withHome.header.config)).toBe(CONFIG_FLAG_HOME_RULES);
    expect(flagsToConfig(CONFIG_FLAG_HOME_RULES)).toEqual({ debugIntents: false, homeRules: true });
    expect(serialize(withHome).length).toBe(serialize(plain).length + LEN * 3 + 5 * 5);
  });

  it('createState needs the country map exactly when the flag is on', () => {
    const t = new Uint8Array(6);
    const e = new Uint16Array(6);
    expect(() => createState({ width: 3, height: 2, seed: 1, seats: 2, config: { debugIntents: false, homeRules: true }, terrain: t, elevation: e })).toThrow(RangeError);
    expect(() => createState({ width: 3, height: 2, seed: 1, seats: 2, config: { debugIntents: false }, terrain: t, elevation: e, countryMap: new Uint8Array(6) })).toThrow(RangeError);
    expect(() => createState({ width: 3, height: 2, seed: 1, seats: 2, config: { debugIntents: false, homeRules: true }, terrain: t, elevation: e, countryMap: new Uint8Array(5) })).toThrow(RangeError);
  });

  it('round-trips through serialize and deserialize with the same hash, and the rules survive', () => {
    const s = corridor(true);
    for (let x = 0; x < 5; x++) setOwner(s, at(x), 1, 0);
    setOwnerRules(s.home!, 1, { homeLand: A_COUNTRY, portMilli: 1075, defenceMilli: 925 });
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(s));
    expect([r.state.home!.homeLand[1], r.state.home!.portMilli[1], r.state.home!.defenceMilli[1]]).toEqual([A_COUNTRY, 1075, 925]);
    expect(Array.from(r.state.home!.country)).toEqual(Array.from(s.home!.country));
  });

  it('every byte of the home block is covered by the hash', () => {
    const base = corridor(true);
    setOwnerRules(base.home!, 1, { homeLand: A_COUNTRY, portMilli: 1000, defenceMilli: 1000 });
    const h0 = hashState(base);
    const edits: Array<(s: GameState) => void> = [
      (s) => (s.home!.country[7] = 99),
      (s) => (s.home!.homeLand[2] = 9),
      (s) => (s.home!.portMilli[3] = 1001),
      (s) => (s.home!.defenceMilli[4] = 999),
    ];
    for (const edit of edits) {
      const s = corridor(true);
      setOwnerRules(s.home!, 1, { homeLand: A_COUNTRY, portMilli: 1000, defenceMilli: 1000 });
      edit(s);
      expect(hashState(s)).not.toBe(h0);
    }
    expect(hashState(corridor(false))).not.toBe(hashState(corridor(true)));
  });

  it('a truncated or padded snapshot is an error result, never an exception', () => {
    const bytes = serialize(corridor(true));
    for (const cut of [1, 5, 40, LEN * 3, bytes.length - 5]) expect(deserialize(bytes.slice(0, bytes.length - cut)).ok).toBe(false);
    const longer = new Uint8Array(bytes.length + 3);
    longer.set(bytes);
    expect(deserialize(longer).ok).toBe(false);
  });
});

// M09c: the level effects of the Factory and the Port (formulas per level, the 10x City limit in the new worst case, the payback window of
// the upgrade prices). Every number comes from src/sim/rules.ts; the incomes are read from the real effects cache.
import { describe, expect, it } from 'vitest';
import {
  BUILD_BASE_GOLD,
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  FACTORY_BONUS_MAX_CITIES,
  PORT_INCOME_MAX_MILLI_PER_SEC,
} from '../../src/sim/rules';
import {
  FACTORY_CITY_BONUS_PCT_BY_LEVEL,
  FACTORY_GOLD_MILLI_BY_LEVEL,
  FACTORY_RADIUS_CELLS_BY_LEVEL,
  PORT_GOLD_MILLI_BY_LEVEL,
  PORT_TRADE_PCT_BY_LEVEL,
} from '../../src/sim/levelCurves';
import { createState, type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, cityGoldMilli, upgradePriceGold } from '../../src/sim/structureRules';
import { applyPortTrait, structGoldMilliPerSec, tradeMilliPerSec } from '../../src/sim/structureEffects';

const W = 1024;
const H = 64;
const at = (x: number, y = 32): number => y * W + x;
function strip(seats: number): GameState {
  const s = createState({ width: W, height: H, seed: 5, seats, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
  for (let o = 1; o <= seats; o++) setOwner(s, at(o), o, 0);
  s.tick = 5000;
  return s;
}
const add = (s: GameState, type: number, owner: number, cell: number, level = 1): number => {
  const id = s.structures.add(type, owner, cell, 0);
  s.structures.level[id] = level;
  s.structures.effDirty = true;
  return id;
};
const income = (s: GameState, o = 1): number => {
  s.structures.effDirty = true;
  return structGoldMilliPerSec(s, o);
};
const pct = (milli: number, p: number): number => Math.floor((milli * p) / 100);

describe('Factory levels', () => {
  it('its own gold is 2.0 / 2.5 / 2.8 gold/s at levels 1 to 3 (Sim-Levels2: the concave curve, was 2.0 / 4.5 / 8.5)', () => {
    expect([1, 2, 3].map((l) => FACTORY_GOLD_MILLI_BY_LEVEL[l])).toEqual([2000, 2500, 2800]);
    for (const l of [1, 2, 3]) {
      const s = strip(2);
      add(s, STRUCT_FACTORY, 1, at(100), l);
      expect(income(s)).toBe(FACTORY_GOLD_MILLI_BY_LEVEL[l]);
    }
  });

  it('the City bonus is 25 / 27 / 29 percent and the reach 20 / 21 / 21 cells at levels 1 to 3 (Sim-Levels2: was 25 / 30 / 35 and 20 / 22 / 24)', () => {
    expect([1, 2, 3].map((l) => FACTORY_CITY_BONUS_PCT_BY_LEVEL[l])).toEqual([25, 27, 29]);
    expect([1, 2, 3].map((l) => FACTORY_RADIUS_CELLS_BY_LEVEL[l])).toEqual([20, 21, 21]);
    for (const l of [1, 2, 3]) {
      const r = FACTORY_RADIUS_CELLS_BY_LEVEL[l] as number;
      const inside = strip(2);
      add(inside, STRUCT_FACTORY, 1, at(100), l);
      add(inside, STRUCT_CITY, 1, at(100 + r));
      expect(income(inside)).toBe((FACTORY_GOLD_MILLI_BY_LEVEL[l] as number) + CITY_GOLD_MILLI_PER_SEC_PER_LEVEL + pct(CITY_GOLD_MILLI_PER_SEC_PER_LEVEL, FACTORY_CITY_BONUS_PCT_BY_LEVEL[l] as number));
      const outside = strip(2);
      add(outside, STRUCT_FACTORY, 1, at(100), l);
      add(outside, STRUCT_CITY, 1, at(100 + r + 1));
      expect(income(outside)).toBe((FACTORY_GOLD_MILLI_BY_LEVEL[l] as number) + CITY_GOLD_MILLI_PER_SEC_PER_LEVEL);
    }
  });

  it('a Factory boosts at most 3 Cities (the lowest ids); a second, weaker Factory in reach takes the 4th', () => {
    expect(FACTORY_BONUS_MAX_CITIES).toBe(3);
    const s = strip(2);
    add(s, STRUCT_FACTORY, 1, at(100), 3);
    for (const [x, y] of [[100, 32], [116, 32], [84, 32], [100, 48]] as const) add(s, STRUCT_CITY, 1, at(x, y));
    const c = CITY_GOLD_MILLI_PER_SEC_PER_LEVEL;
    expect(income(s)).toBe(2800 + 3 * (c + pct(c, 29)) + c);
    add(s, STRUCT_FACTORY, 1, at(100, 40), 1);
    expect(income(s)).toBe(2800 + 2000 + 3 * (c + pct(c, 29)) + c + pct(c, 25));
  });
});

describe('Port levels', () => {
  it('its own gold is 2.0 / 2.5 / 2.8 gold/s and its trade share 100 / 105 / 108 percent at levels 1 to 3 (Sim-Levels2: was 2.0 / 4.5 / 8.5 and 100 / 110 / 120)', () => {
    expect([1, 2, 3].map((l) => PORT_GOLD_MILLI_BY_LEVEL[l])).toEqual([2000, 2500, 2800]);
    expect([1, 2, 3].map((l) => PORT_TRADE_PCT_BY_LEVEL[l])).toEqual([100, 105, 108]);
    for (const l of [1, 2, 3]) {
      const alone = strip(2);
      add(alone, STRUCT_PORT, 1, at(100), l);
      expect(income(alone)).toBe(PORT_GOLD_MILLI_BY_LEVEL[l]);
      const pair = strip(2);
      add(pair, STRUCT_PORT, 1, at(100), l);
      add(pair, STRUCT_PORT, 2, at(180));
      const trade = tradeMilliPerSec(80, false, false);
      expect(income(pair)).toBe((PORT_GOLD_MILLI_BY_LEVEL[l] as number) + pct(trade, PORT_TRADE_PCT_BY_LEVEL[l] as number));
      expect(income(pair, 2)).toBe((PORT_GOLD_MILLI_BY_LEVEL[1] as number) + trade); // the partner's level is its own business
    }
  });
});

describe('the limit of 10 level-1 Cities per structure (15 gold/s)', () => {
  const LIMIT = 10 * CITY_GOLD_MILLI_PER_SEC_PER_LEVEL;
  it('the worst Port is a level 3 Port with 3 partners at 120+ cells of other owners: 13 gold/s (the clamp), at most 15 with the +10 percent trait', () => {
    const s = strip(4);
    add(s, STRUCT_PORT, 1, at(100), 3);
    for (const [o, x] of [[2, 300], [3, 500], [4, 700]] as const) add(s, STRUCT_PORT, o, at(x), 3);
    const raw = (PORT_GOLD_MILLI_BY_LEVEL[3] as number) + pct(3 * 3300, PORT_TRADE_PCT_BY_LEVEL[3] as number); // 2800 + 10692 = 13 492
    expect(raw).toBeGreaterThan(PORT_INCOME_MAX_MILLI_PER_SEC); // without the clamp the limit would break
    expect(income(s)).toBe(PORT_INCOME_MAX_MILLI_PER_SEC);
    expect(income(s)).toBeLessThanOrEqual(13000);
    expect(applyPortTrait(income(s), 1100)).toBeLessThanOrEqual(LIMIT);
  });

  it('the worst Factory is a level 3 Factory beside 8 level 3 Cities: its own gold plus the bonus of 3 Cities stays under 15 gold/s', () => {
    const s = strip(2);
    add(s, STRUCT_FACTORY, 1, at(100), 3);
    const cityAll = 8 * cityGoldMilli(3);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      add(s, STRUCT_CITY, 1, at(100 + Math.round(20 * Math.cos(a)), 32 + Math.round(20 * Math.sin(a))), 3);
    }
    const factoryShare = income(s) - cityAll; // own gold plus the bonuses
    expect(factoryShare).toBe(2800 + 3 * pct(cityGoldMilli(3), 29));
    expect(factoryShare).toBeLessThanOrEqual(LIMIT);
  });
});

describe('payback of an upgrade', () => {
  /** Seconds until the upgrade to `level` has paid for itself, in a reference setting, from the income the real effects cache reports. */
  const payback = (type: number, level: number, scene: (s: GameState, lv: number) => void): number => {
    const a = strip(2);
    scene(a, level - 1);
    const b = strip(2);
    scene(b, level);
    return (upgradePriceGold(type, level) * 1000) / (income(b) - income(a));
  };
  const factoryScene = (s: GameState, lv: number): void => {
    add(s, STRUCT_FACTORY, 1, at(100), lv);
    for (const [x, y] of [[100, 40], [116, 32], [84, 32]] as const) add(s, STRUCT_CITY, 1, at(x, y), 2); // three level 2 Cities in reach
  };
  const portScene = (s: GameState, lv: number): void => {
    add(s, STRUCT_PORT, 1, at(100), lv);
    add(s, STRUCT_PORT, 2, at(200)); // one partner at 100 cells
  };

  it('Sim-Levels2: the payback of a Factory or Port upgrade is long and GROWS with the level (a soft cap through the price base * L); it is logged, the old window of 90 s to 6 minutes is gone (see DECISIONS Sim-Levels2)', () => {
    const rows: string[] = [];
    for (const [name, type, scene] of [['Factory', STRUCT_FACTORY, factoryScene], ['Port', STRUCT_PORT, portScene]] as const) {
      let last = 0;
      for (const level of [2, 3, 4, 6, 10]) {
        const sec = payback(type, level, scene);
        rows.push(`${name} -> L${level}: ${sec.toFixed(0)} s`);
        expect(sec, rows.join('; ')).toBeGreaterThan(last);
        last = sec;
      }
    }
    console.log(`[payback] ${rows.join('; ')}`);
    expect((BUILD_BASE_GOLD[STRUCT_CITY] as number) / ((CITY_GOLD_MILLI_PER_SEC_PER_LEVEL * 60) / 1000)).toBeCloseTo(4.44, 1);
  });

  it('Fix-4A2: an upper bound next to the strict growth (DECISIONS Fix-4A2 item 6): the paybacks are deliberately long, but not longer than about 10 percent above today\'s values', () => {
    // Today (logged above): Factory 1629 / 3650 / 7782 / 18182 / 108696 s, Port 1231 / 3077 / 6154 / 17391 / 52632 s for the levels 2 / 3 / 4 / 6 / 10.
    const LIMIT: Record<string, readonly number[]> = { Factory: [1800, 4000, 8600, 20000, 120000], Port: [1400, 3400, 6800, 19200, 58000] };
    for (const [name, type, scene] of [['Factory', STRUCT_FACTORY, factoryScene], ['Port', STRUCT_PORT, portScene]] as const) {
      [2, 3, 4, 6, 10].forEach((level, i) => {
        const sec = payback(type, level, scene);
        expect(sec, `${name} -> L${level}`).toBeLessThanOrEqual((LIMIT[name] as readonly number[])[i] as number);
        expect(sec, `${name} -> L${level} is not free money either`).toBeGreaterThan(90);
      });
    }
  });
});

// Fix-4A2 (audit 3, finding 1.0): the concave level curves of src/sim/levelCurves.ts pinned by EXACT values at ten levels, not only by properties and the
// three levels where 1000 * (L - 1) / (L + 2) happens to be a whole number (a rounding-direction change was invisible there). Two independent pins per curve:
// a literal table (generated once from the formula with a separate Python script, reviewed by hand) and a BigInt reference implementation in this file.
import { describe, expect, it } from 'vitest';
import {
  barracksRegenPctAt,
  cityGoldMilliAt,
  cityTroopCapAt,
  FACTORY_CITY_BONUS_PCT_BY_LEVEL,
  FACTORY_GOLD_MILLI_BY_LEVEL,
  FACTORY_RADIUS_CELLS_BY_LEVEL,
  factoryCityBonusPctAt,
  factoryGoldMilliAt,
  factoryRadiusCellsAt,
  housingTroopsAt,
  marketGoldMilliAt,
  PORT_GOLD_MILLI_BY_LEVEL,
  PORT_TRADE_PCT_BY_LEVEL,
  portGoldMilliAt,
  portTradePctAt,
  samRadiusBaseAt,
  satPermille,
  wallsCostPctAt,
} from '../../src/sim/levelCurves';
import {
  BARRACKS_REGEN_EXTRA_PCT,
  BARRACKS_REGEN_PCT_BASE,
  CAP_CITY_LEVEL_TROOPS,
  CITY_GOLD_EXTRA_MILLI,
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  CITY_TROOP_EXTRA_TROOPS,
  FACTORY_CITY_BONUS_EXTRA_PCT,
  FACTORY_CITY_BONUS_PCT,
  FACTORY_GOLD_EXTRA_MILLI,
  FACTORY_GOLD_MILLI_PER_SEC,
  FACTORY_RADIUS_CELLS,
  FACTORY_RADIUS_EXTRA_CELLS,
  HOUSING_TROOPS_BASE,
  HOUSING_TROOPS_EXTRA,
  LEVEL_SAT_K,
  MARKET_GOLD_EXTRA_MILLI,
  MARKET_GOLD_MILLI_BASE,
  PORT_GOLD_EXTRA_MILLI,
  PORT_GOLD_MILLI_PER_SEC,
  PORT_TRADE_EXTRA_PCT,
  SAM_RADIUS_BASE_CELLS,
  SAM_RADIUS_EXTRA_CELLS,
  STRUCT_LEVEL_HARD_CAP,
  WALLS_COST_EXTRA_PCT,
  WALLS_COST_PCT_BASE,
} from '../../src/sim/rules';

const LEVELS = [1, 2, 3, 5, 10, 20, 50, 100, 500, 999] as const;

/** The reference: the saturation as an exact BigInt quotient (floor of 1000 * (L - 1) / (L - 1 + K)), no float anywhere. */
function refSat(level: number): number {
  if (level <= 1) return 0;
  const x = BigInt(level - 1);
  return Number((1000n * x) / (x + BigInt(LEVEL_SAT_K)));
}
function refLift(base: number, extra: number, level: number): number {
  return base + Number((BigInt(extra) * BigInt(refSat(level))) / 1000n);
}

interface Curve {
  readonly name: string;
  readonly fn: (level: number) => number;
  readonly base: number;
  readonly extra: number;
  /** The values at LEVELS. */
  readonly table: readonly number[];
}

const CURVES: readonly Curve[] = [
  { name: 'City gold', fn: cityGoldMilliAt, base: CITY_GOLD_MILLI_PER_SEC_PER_LEVEL, extra: CITY_GOLD_EXTRA_MILLI, table: [1500, 1875, 2100, 2356, 2625, 2794, 2913, 2955, 2991, 2995] },
  { name: 'City troop cap', fn: cityTroopCapAt, base: CAP_CITY_LEVEL_TROOPS, extra: CITY_TROOP_EXTRA_TROOPS, table: [800, 1200, 1440, 1713, 2000, 2180, 2307, 2352, 2390, 2395] },
  { name: 'Factory gold', fn: factoryGoldMilliAt, base: FACTORY_GOLD_MILLI_PER_SEC, extra: FACTORY_GOLD_EXTRA_MILLI, table: [2000, 2500, 2800, 3142, 3500, 3726, 3884, 3940, 3988, 3994] },
  { name: 'Factory City bonus', fn: factoryCityBonusPctAt, base: FACTORY_CITY_BONUS_PCT, extra: FACTORY_CITY_BONUS_EXTRA_PCT, table: [25, 27, 29, 30, 32, 33, 34, 34, 34, 34] },
  { name: 'Factory radius', fn: factoryRadiusCellsAt, base: FACTORY_RADIUS_CELLS, extra: FACTORY_RADIUS_EXTRA_CELLS, table: [20, 21, 21, 22, 23, 23, 23, 23, 23, 23] },
  { name: 'Port gold', fn: portGoldMilliAt, base: PORT_GOLD_MILLI_PER_SEC, extra: PORT_GOLD_EXTRA_MILLI, table: [2000, 2500, 2800, 3142, 3500, 3726, 3884, 3940, 3988, 3994] },
  { name: 'Port trade percent', fn: portTradePctAt, base: 100, extra: PORT_TRADE_EXTRA_PCT, table: [100, 105, 108, 111, 115, 117, 118, 119, 119, 119] },
  { name: 'SAM radius', fn: samRadiusBaseAt, base: SAM_RADIUS_BASE_CELLS, extra: SAM_RADIUS_EXTRA_CELLS, table: [24, 26, 27, 28, 30, 30, 31, 31, 31, 31] },
  { name: 'Housing district', fn: housingTroopsAt, base: HOUSING_TROOPS_BASE, extra: HOUSING_TROOPS_EXTRA, table: [400, 600, 720, 856, 1000, 1090, 1153, 1176, 1195, 1197] },
  { name: 'Market district', fn: marketGoldMilliAt, base: MARKET_GOLD_MILLI_BASE, extra: MARKET_GOLD_EXTRA_MILLI, table: [300, 375, 420, 471, 525, 558, 582, 591, 598, 599] },
  { name: 'Barracks district', fn: barracksRegenPctAt, base: BARRACKS_REGEN_PCT_BASE, extra: BARRACKS_REGEN_EXTRA_PCT, table: [5, 7, 9, 10, 12, 13, 14, 14, 14, 14] },
  { name: 'Walls district', fn: wallsCostPctAt, base: WALLS_COST_PCT_BASE, extra: WALLS_COST_EXTRA_PCT, table: [150, 162, 170, 178, 187, 193, 197, 198, 199, 199] },
];

describe('the saturation curve', () => {
  it('K is the constant the tables below were made with', () => {
    expect(LEVEL_SAT_K).toBe(3);
  });
  it('exact values at ten levels (the literal table), 4 to 9 (where the quotient is not whole) and below level 1', () => {
    expect(LEVELS.map(satPermille)).toEqual([0, 250, 400, 571, 750, 863, 942, 970, 994, 997]);
    expect([4, 6, 7, 8, 9].map(satPermille)).toEqual([500, 625, 666, 700, 727]);
    expect([0, -5, 1].map(satPermille)).toEqual([0, 0, 0]);
  });
  it('equals the BigInt reference at every level 1 to 999 (floor, never round or ceil)', () => {
    for (let l = 1; l <= STRUCT_LEVEL_HARD_CAP; l++) expect(satPermille(l), `level ${l}`).toBe(refSat(l));
  });
  it('rounds DOWN: the levels whose quotient is fractional sit strictly below the real value', () => {
    for (const l of [5, 7, 9, 20, 100, 999]) {
      const x = l - 1;
      expect(satPermille(l) * (x + LEVEL_SAT_K), `level ${l}`).toBeLessThan(1000 * x);
    }
  });
});

describe('every curve: exact values at ten levels, the reference at every level, the bounds', () => {
  for (const c of CURVES) {
    it(`${c.name}: the literal table`, () => {
      expect(LEVELS.map((l) => c.fn(l))).toEqual([...c.table]);
    });
    it(`${c.name}: equals the reference at every level 1 to 999 and stays below base + extra`, () => {
      for (let l = 1; l <= STRUCT_LEVEL_HARD_CAP; l++) {
        const v = c.fn(l);
        expect(v, `level ${l}`).toBe(refLift(c.base, c.extra, l));
        expect(v).toBeLessThan(c.base + c.extra);
      }
      expect(c.fn(1)).toBe(c.base);
    });
    it(`${c.name}: level 0 and below give nothing`, () => {
      expect(c.fn(0)).toBe(0);
      expect(c.fn(-3)).toBe(0);
    });
  }
});

describe('the tables indexed by level (what the UI reads) are the curves', () => {
  const TABLES: Array<[string, readonly number[], (l: number) => number]> = [
    ['Factory gold', FACTORY_GOLD_MILLI_BY_LEVEL, factoryGoldMilliAt],
    ['Factory City bonus', FACTORY_CITY_BONUS_PCT_BY_LEVEL, factoryCityBonusPctAt],
    ['Factory radius', FACTORY_RADIUS_CELLS_BY_LEVEL, factoryRadiusCellsAt],
    ['Port gold', PORT_GOLD_MILLI_BY_LEVEL, portGoldMilliAt],
    ['Port trade', PORT_TRADE_PCT_BY_LEVEL, portTradePctAt],
  ];
  for (const [name, table, fn] of TABLES) {
    it(`${name}: slot 0 is empty, 1 to ${STRUCT_LEVEL_HARD_CAP} are the curve, and the sample levels are the literal values`, () => {
      expect(table.length).toBe(STRUCT_LEVEL_HARD_CAP + 1);
      expect(table[0]).toBe(0);
      for (const l of LEVELS) expect(table[l], `level ${l}`).toBe(fn(l));
    });
  }
});

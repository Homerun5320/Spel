// Sim-Levels2: unlimited levels (hard cap 999), ONE upgrade price rule for every structure type and district kind, gentle concave effect curves with an
// asymptote, the 15 gold/s limit for any single structure at any level, conquest keeping 75 percent of a level, the widened level fields in the
// serialised state. Every test drives the real path (apply functions, the effects cache, setOwner, serialize), so removing a rule fails here.
import { describe, expect, it } from 'vitest';
import { applyBuildDistrict, applyUpgradeDistrict } from '../../src/sim/districts';
import {
  DISTRICT_BARRACKS,
  DISTRICT_HOUSING,
  DISTRICT_MARKET,
  DISTRICT_WALLS,
  districtEffect,
  districtIndex,
  districtMaxLevel,
  districtSlotsOf,
  districtUpgradePriceGold,
} from '../../src/sim/districtRules';
import {
  barracksRegenPctAt,
  cityGoldMilliAt,
  cityTroopCapAt,
  factoryCityBonusPctAt,
  factoryGoldMilliAt,
  factoryRadiusCellsAt,
  housingTroopsAt,
  marketGoldMilliAt,
  portGoldMilliAt,
  portTradePctAt,
  samRadiusBaseAt,
  satPermille,
  wallsCostPctAt,
} from '../../src/sim/levelCurves';
import { REJECT_BUILD_GOLD, REJECT_NONE, REJECT_STRUCT_MAX_LEVEL } from '../../src/sim/intents';
import {
  BUILD_BASE_GOLD,
  BUILD_TICKS,
  CAP_CITY_LEVEL_TROOPS,
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  DISTRICT_BASE_GOLD,
  DISTRICT_BUILD_TICKS,
  DISTRICT_MAX_SLOTS,
  FACTORY_CITY_BONUS_PCT,
  FACTORY_GOLD_MILLI_PER_SEC,
  FACTORY_RADIUS_CELLS,
  MILLI_GOLD_PER_GOLD,
  PORT_GOLD_MILLI_PER_SEC,
  STRUCT_LEVEL_HARD_CAP,
} from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { createState, type GameState } from '../../src/sim/state';
import { applyUpgrade, levelAfterConquest } from '../../src/sim/structures';
import { applyPortTrait, samRadiusCells, structGoldMilliPerSec } from '../../src/sim/structureEffects';
import {
  STRUCT_CITY,
  STRUCT_FACTORY,
  STRUCT_PORT,
  STRUCT_POST,
  STRUCT_SAM,
  STRUCT_SILO,
  cityGoldMilli,
  cityTroopCap,
  maxLevelOf,
  upgradePriceGold,
  upgradeTicksOf,
} from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { setOwner } from '../../src/sim/territory';
import { landState } from './helpers/worlds';

const CAP = STRUCT_LEVEL_HARD_CAP;
const GOLD = MILLI_GOLD_PER_GOLD;
const LIMIT = 10 * CITY_GOLD_MILLI_PER_SEC_PER_LEVEL; // 15 gold/s: ten level 1 Cities
const W = 1024;
const H = 64;
const at = (x: number, y = 32): number => y * W + x;

function strip(seats = 4): GameState {
  const s = createState({ width: W, height: H, seed: 5, seats, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
  for (let o = 1; o <= seats; o++) setOwner(s, at(o), o, 0);
  s.tick = 5000;
  return s;
}
const add = (s: GameState, type: number, owner: number, cell: number, level: number): number => {
  const id = s.structures.add(type, owner, cell, 0);
  s.structures.level[id] = level;
  s.structures.effDirty = true;
  return id;
};
const income = (s: GameState, o = 1): number => {
  s.structures.effDirty = true;
  return structGoldMilliPerSec(s, o);
};

describe('the curves: level 1 unchanged, concave, hard asymptote, flat tail', () => {
  const GOLD_CURVES: [string, (l: number) => number, number, number][] = [
    ['city gold', cityGoldMilliAt, CITY_GOLD_MILLI_PER_SEC_PER_LEVEL, 3000],
    ['factory gold', factoryGoldMilliAt, FACTORY_GOLD_MILLI_PER_SEC, 4000],
    ['port gold', portGoldMilliAt, PORT_GOLD_MILLI_PER_SEC, 4000],
    ['market gold', marketGoldMilliAt, 300, 600],
  ];
  const OTHER: [string, (l: number) => number, number, number][] = [
    ['city troops', cityTroopCapAt, CAP_CITY_LEVEL_TROOPS, 2400],
    ['factory bonus', factoryCityBonusPctAt, FACTORY_CITY_BONUS_PCT, 35],
    ['factory radius', factoryRadiusCellsAt, FACTORY_RADIUS_CELLS, 24],
    ['port trade', portTradePctAt, 100, 120],
    ['sam radius', samRadiusBaseAt, 24, 32],
    ['housing', housingTroopsAt, 400, 1200],
    ['barracks', barracksRegenPctAt, 5, 15],
    ['walls', wallsCostPctAt, 150, 200],
  ];
  it('level 1 equals the value of today, every level is at least the one before, no level reaches the asymptote, level 0 gives nothing', () => {
    for (const [name, fn, base, asym] of [...GOLD_CURVES, ...OTHER]) {
      expect(fn(1), `${name} level 1`).toBe(base);
      expect(fn(0), `${name} level 0`).toBe(0);
      for (let l = 2; l <= CAP; l++) {
        expect(fn(l), `${name} level ${l}`).toBeGreaterThanOrEqual(fn(l - 1));
        expect(fn(l), `${name} level ${l} below the asymptote`).toBeLessThan(asym);
      }
      expect(fn(CAP), `${name} reaches its tail`).toBeGreaterThan(asym - (asym - base) * 0.02 - 1);
    }
  });
  it('the gold curves: level 10 is 1.6 to 2 times level 1, level 100 only a little (under 15 percent of the level 1 value) above level 10, level 999 under 4 percent of the level 1 value above level 100', () => {
    for (const [name, fn, base] of GOLD_CURVES) {
      expect(fn(10) / base, `${name} level 10`).toBeGreaterThanOrEqual(1.6);
      expect(fn(10) / base, `${name} level 10`).toBeLessThanOrEqual(2);
      expect(fn(100) - fn(10), `${name} 10 to 100`).toBeLessThan(0.3 * base);
      expect(fn(CAP) - fn(100), `${name} 100 to 999`).toBeLessThan(0.04 * base);
    }
  });
  it('the saturation is concave: its gain over a window of 20 levels never grows (up to one unit of rounding)', () => {
    for (let l = 21; l + 20 <= CAP; l += 11) expect(satPermille(l + 20) - satPermille(l)).toBeLessThanOrEqual(satPermille(l) - satPermille(l - 20) + 1);
    expect(satPermille(1)).toBe(0);
    expect(satPermille(CAP)).toBeLessThan(1000);
  });
  it('the public functions are the curves', () => {
    for (const l of [1, 2, 10, 100, CAP]) {
      expect(cityGoldMilli(l)).toBe(cityGoldMilliAt(l));
      expect(cityTroopCap(l)).toBe(cityTroopCapAt(l));
      expect(districtEffect(DISTRICT_MARKET, l).goldMilliPerSec).toBe(marketGoldMilliAt(l));
      expect(districtEffect(DISTRICT_HOUSING, l).capTroops).toBe(housingTroopsAt(l));
      expect(districtEffect(DISTRICT_BARRACKS, l).regenPct).toBe(barracksRegenPctAt(l));
      expect(districtEffect(DISTRICT_WALLS, l).wallsCostPct).toBe(wallsCostPctAt(l));
      expect(samRadiusCells(l, false)).toBe(samRadiusBaseAt(l));
    }
    expect(districtEffect(DISTRICT_MARKET, CAP + 1).goldMilliPerSec).toBe(0);
    expect(districtEffect(DISTRICT_MARKET, 0).goldMilliPerSec).toBe(0);
  });
});

describe('ONE price rule and the hard cap', () => {
  it('maxLevelOf is the hard cap for every type, districts too', () => {
    expect(CAP).toBe(999);
    for (const t of [STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_SILO, STRUCT_SAM, STRUCT_POST]) expect(maxLevelOf(t)).toBe(CAP);
    expect(districtMaxLevel()).toBe(CAP);
  });
  it('an upgrade to level L costs base * L and takes the build time of the type, for all six types and all four district kinds, at several levels', () => {
    for (const t of [STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_SILO, STRUCT_SAM, STRUCT_POST]) {
      for (const l of [2, 3, 7, 50, CAP]) {
        expect(upgradePriceGold(t, l), `type ${t} level ${l}`).toBe((BUILD_BASE_GOLD[t] as number) * l);
        expect(upgradeTicksOf(t, l), `time type ${t} level ${l}`).toBe(BUILD_TICKS[t]);
      }
    }
    for (const k of [DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_WALLS]) {
      for (const l of [2, 3, 7, 50, CAP]) expect(districtUpgradePriceGold(k, l), `kind ${k} level ${l}`).toBe((DISTRICT_BASE_GOLD[k] as number) * l);
    }
  });
  it('a real Upgrade at level 500 takes exactly base * 501 (no escalation by how many the seat owns) for a City and a Post alike, and a District too', () => {
    const s = strip(2);
    s.gold[1] = 4000000 * GOLD;
    const city = add(s, STRUCT_CITY, 1, at(100), 500);
    add(s, STRUCT_CITY, 1, at(110), 1);
    add(s, STRUCT_CITY, 1, at(120), 1);
    const post = add(s, STRUCT_POST, 1, at(130), 500);
    let before = s.gold[1] as number;
    expect(applyUpgrade(s, 0, city)).toBe(REJECT_NONE);
    expect(before - (s.gold[1] as number)).toBe(400 * 501 * GOLD);
    before = s.gold[1] as number;
    expect(applyUpgrade(s, 0, post)).toBe(REJECT_NONE);
    expect(before - (s.gold[1] as number)).toBe(250 * 501 * GOLD);
    s.structures.setDistrict(city, 2, DISTRICT_MARKET, 500, 100, 0);
    s.structures.level[city] = 10;
    before = s.gold[1] as number;
    expect(applyUpgradeDistrict(s, 0, city, 2)).toBe(REJECT_NONE);
    expect(before - (s.gold[1] as number)).toBe(40 * 501 * GOLD);
    expect(s.structures.districtUpgradeReadyTick[districtIndex(city, 2)]).toBe(s.tick + (DISTRICT_BUILD_TICKS[DISTRICT_MARKET] as number));
  });
  it('the dearest price fits the integer types (Int32 milli and the Uint32 purse); level 999 is the top: 998 to 999 pays exactly, one milli less is refused, 999 refuses', () => {
    const dearest = Math.max(...BUILD_BASE_GOLD) * CAP * GOLD;
    expect(dearest).toBeLessThan(2 ** 31);
    expect(Math.max(...DISTRICT_BASE_GOLD) * CAP * GOLD).toBeLessThan(2 ** 31);
    const s = strip(2);
    const silo = add(s, STRUCT_SILO, 1, at(100), CAP - 1);
    const price = upgradePriceGold(STRUCT_SILO, CAP) * GOLD;
    expect(price).toBe(999000000);
    s.gold[1] = price - 1;
    expect(applyUpgrade(s, 0, silo)).toBe(REJECT_BUILD_GOLD);
    expect(s.gold[1]).toBe(price - 1);
    s.gold[1] = price;
    expect(applyUpgrade(s, 0, silo)).toBe(REJECT_NONE);
    expect(s.gold[1]).toBe(0);
    s.structures.level[silo] = CAP;
    s.structures.upgradeReadyTick[silo] = 0;
    s.gold[1] = 4000000 * GOLD;
    expect(applyUpgrade(s, 0, silo)).toBe(REJECT_STRUCT_MAX_LEVEL);
  });
  it('district slots grow slowly and stop at DISTRICT_MAX_SLOTS: 2, 3, 4, 5 and 5 at level 999', () => {
    expect([1, 3, 6, 9, 10, 11, 100, CAP].map((l) => districtSlotsOf(l))).toEqual([2, 3, 4, 5, 5, 5, 5, 5]);
    expect(DISTRICT_MAX_SLOTS).toBe(5);
  });
});

describe('the 15 gold/s limit for ANY single structure at levels 1, 10, 100 and 999 (districts, Factory and the +10 percent trait)', () => {
  it('a City with five Markets under a Factory of the same level', () => {
    for (const level of [1, 10, 100, CAP]) {
      const s = strip(2);
      const f = add(s, STRUCT_FACTORY, 1, at(110), level);
      const alone = income(s);
      const city = add(s, STRUCT_CITY, 1, at(100), level);
      for (let k = 0; k < 5; k++) s.structures.setDistrict(city, k, DISTRICT_MARKET, level, 100, 0);
      const total = income(s) - alone;
      expect(total, `level ${level}`).toBeLessThanOrEqual(LIMIT);
      expect(applyPortTrait(total, 1100), `level ${level} with the trait`).toBeLessThanOrEqual(LIMIT);
      void f;
    }
  });
  it('a Factory with its own gold plus the bonus it gives three Cities of the same level, and each City with districts', () => {
    for (const level of [1, 10, 100, CAP]) {
      const s = strip(2);
      const withoutF = strip(2);
      add(s, STRUCT_FACTORY, 1, at(100), level);
      for (const [x, y] of [[100, 40], [108, 32], [92, 32]] as const) {
        for (const t of [s, withoutF]) {
          const c = add(t, STRUCT_CITY, 1, at(x, y), level);
          for (let k = 0; k < 5; k++) t.structures.setDistrict(c, k, DISTRICT_MARKET, level, 100, 0);
        }
      }
      const share = income(s) - income(withoutF); // the Factory's own gold and the bonuses it gives
      expect(share, `level ${level}`).toBeLessThanOrEqual(LIMIT);
    }
  });
  it('a Port with three partners far away (the clamp), also with the +10 percent trait', () => {
    for (const level of [1, 10, 100, CAP]) {
      const s = strip(4);
      add(s, STRUCT_PORT, 1, at(100), level);
      for (const [o, x] of [[2, 300], [3, 500], [4, 700]] as const) add(s, STRUCT_PORT, o, at(x), level);
      const got = income(s);
      expect(got, `level ${level}`).toBeLessThanOrEqual(13000);
      expect(applyPortTrait(got, 1100), `level ${level} with the trait`).toBeLessThanOrEqual(LIMIT);
    }
  });
  it('a level 999 City alone pays under twice a level 1 City, and 999 pays at least the level 10 City (the tail is flat but never falls)', () => {
    const one = (l: number): number => {
      const s = strip(2);
      add(s, STRUCT_CITY, 1, at(100), l);
      return income(s);
    };
    expect(one(CAP)).toBeLessThan(2 * one(1));
    expect(one(CAP)).toBeGreaterThanOrEqual(one(10));
    expect(one(10)).toBeGreaterThan(one(1));
  });
});

describe('conquest: a structure, City or district keeps 75 percent of its level (rounded down, at least 1)', () => {
  it('levelAfterConquest at levels 1, 2, 4, 10, 100 and 999', () => {
    expect([1, 2, 4, 10, 100, CAP].map((l) => levelAfterConquest(l))).toEqual([1, 1, 3, 7, 75, 749]);
  });
  const cell = (x: number, y: number): number => y * 40 + x;
  it('a conquered City, Factory and Port end at that level; a Post is destroyed; the City districts keep 75 percent of their level and slots follow the new City level', () => {
    for (const [from, to] of [[1, 1], [2, 1], [4, 3], [10, 7], [100, 75], [CAP, 749]] as const) {
      const s = landState(40, 20, { seats: 3 });
      for (let c = 0; c < s.grid.cells; c++) setOwner(s, c, c % 40 < 20 ? 1 : 2, 0);
      s.tick = 5000;
      const t = s.structures;
      const cityId = add(s, STRUCT_CITY, 2, cell(30, 10), from);
      const factory = add(s, STRUCT_FACTORY, 2, cell(33, 10), from);
      const port = add(s, STRUCT_PORT, 2, cell(36, 10), from);
      const post = add(s, STRUCT_POST, 2, cell(30, 15), from);
      for (let slot = 0; slot < districtSlotsOf(from); slot++) t.setDistrict(cityId, slot, 1 + (slot % 4), from, 100, 0);
      for (const x of [30, 33, 36]) setOwner(s, cell(x, 10), 1, 0);
      setOwner(s, cell(30, 15), 1, 0);
      expect([t.owner[cityId], t.level[cityId]], `city ${from}`).toEqual([1, to]);
      expect(t.level[factory], `factory ${from}`).toBe(to);
      expect(t.level[port], `port ${from}`).toBe(to);
      expect(t.owner[post], `post ${from}`).toBe(0);
      for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
        const i = districtIndex(cityId, slot);
        if (slot < Math.min(districtSlotsOf(from), districtSlotsOf(to))) expect(t.districtLevel[i], `district ${from} slot ${slot}`).toBe(levelAfterConquest(from));
        else expect(t.districtKind[i], `lost district ${from} slot ${slot}`).toBe(0);
      }
    }
  });
});

describe('serialisation of high levels', () => {
  function base(): GameState {
    const w = 128;
    const h = 64;
    const s = createState({ width: w, height: h, seed: 4, seats: 2, terrain: new Uint8Array(w * h).fill(CLASS_PLAINS), elevation: new Uint16Array(w * h) });
    for (let c = 0; c < w * h; c++) setOwner(s, c, 1, 0);
    s.structures.add(STRUCT_CITY, 1, 10, 0);
    s.structures.add(STRUCT_FACTORY, 1, 5000, 0);
    s.tick = 1000;
    return s;
  }
  it('levels 999 (structures and districts) and a running upgrade at 998 survive a round trip with the same hash and arrays', () => {
    const s = base();
    s.structures.level[0] = CAP;
    s.structures.level[1] = CAP - 1;
    s.structures.upgradeReadyTick[1] = 2000;
    for (let slot = 0; slot < 5; slot++) s.structures.setDistrict(0, slot, 1 + (slot % 4), CAP - slot, 1000, 0);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(s));
    expect(Array.from(r.state.structures.level.slice(0, 2))).toEqual([CAP, CAP - 1]);
    expect(Array.from(r.state.structures.districtLevel.slice(0, 5))).toEqual([CAP, CAP - 1, CAP - 2, CAP - 3, CAP - 4]);
  });
  it('forged levels with a valid checksum are refused: 0, the hard cap + 1, 65 536 + 5 (a u16 wrap), for a structure and for a district', () => {
    for (const bad of [0, CAP + 1, 65536 + 5]) {
      const s = base();
      s.structures.level[0] = 7;
      s.structures.setDistrict(0, 0, DISTRICT_MARKET, 1, 1000, 0);
      const bytes = serialize(s);
      expect(deserialize(bytes).ok).toBe(true);
      // The level is a u32 on the wire: patch the structure block and the district block directly would break the checksum, so forge through the state with a u32-wide shadow.
      const forged = base();
      forged.structures.level[0] = 7;
      forged.structures.setDistrict(0, 0, DISTRICT_MARKET, 1, 1000, 0);
      (forged.structures as unknown as { level: Float64Array }).level = Object.assign(new Float64Array(forged.structures.level.length), forged.structures.level);
      (forged.structures.level as unknown as number[])[0] = bad;
      const r1 = deserialize(serialize(forged));
      expect(r1.ok, `structure level ${bad}`).toBe(false);
      const forgedD = base();
      forgedD.structures.setDistrict(0, 0, DISTRICT_MARKET, 1, 1000, 0);
      (forgedD.structures as unknown as { districtLevel: Float64Array }).districtLevel = Object.assign(new Float64Array(forgedD.structures.districtLevel.length), forgedD.structures.districtLevel);
      (forgedD.structures.districtLevel as unknown as number[])[0] = bad;
      const r2 = deserialize(serialize(forgedD));
      expect(r2.ok, `district level ${bad}`).toBe(false);
    }
  });
});

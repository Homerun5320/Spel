// Districts-2a: the pure view model of the city view (src/ui/cityViewModel.ts) over a real sim state: tiles by level, the build choices with price,
// time and reason (the SAME checks the sim runs), progress, the effect lines, the totals against the sim's own income, the signature that drives
// the cheap per-frame redraw, the Remove arming timer, the refusal keys and the two small input helpers.
import { describe, expect, it } from 'vitest';
import { applyBuildDistrict, applyUpgradeDistrict } from '../../src/sim/districts';
import {
  DISTRICT_BARRACKS,
  DISTRICT_BUILD_TICKS,
  DISTRICT_HOUSING,
  DISTRICT_MARKET,
  DISTRICT_WALLS,
  REJECT_BUILD_GOLD,
  REJECT_DISTRICT_CITY_BUILDING,
  REJECT_DISTRICT_EMPTY,
  REJECT_DISTRICT_KIND,
  REJECT_DISTRICT_NOT_CITY,
  REJECT_DISTRICT_OCCUPIED,
  REJECT_DISTRICT_SLOT,
  REJECT_NONE,
  REJECT_STRUCT_MAX_LEVEL,
  DISTRICT_MAX_SLOTS,
  cityGoldMilli,
  cityTroopCap,
  districtBuildPriceGold,
  districtEffect,
  districtIndex,
  districtSlotsOf,
  maxLevelOf,
  upgradePriceGold,
} from '../../src/sim/public';
import { REJECT_PHASE } from '../../src/sim/intents';
import { PHASE_SPAWN } from '../../src/sim/flow';
import { MILLI_GOLD_PER_GOLD, STRUCT_LEVEL_HARD_CAP, TICK_HZ } from '../../src/sim/rules';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { structGoldMilliPerSec } from '../../src/sim/structureEffects';
import { STRUCT_CITY } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { structureRefusalKey } from '../../src/ui/buildReasons';
import { cityFlightNeeded, isDoubleClick } from '../../src/app/cityViewMode';
import {
  CITY_SIG_MAX,
  DISTRICT_KINDS,
  cityInfo,
  citySignature,
  districtNameKey,
  districtWhyKey,
  removeArmKey,
  removeArmed,
  removeClick,
  tileInfo,
} from '../../src/ui/cityViewModel';
import { formatFixed, formatGoldRate, t } from '../../src/ui/i18n';
import { DELETE_ARM_MS } from '../../src/ui/structureInfo';
import { CITY_VIEW } from '../../src/ui/uiConfig';

const W = 256;
const H = 32;
const at = (x: number, y = 16): number => y * W + x;
const GOLD = MILLI_GOLD_PER_GOLD;

function world(): GameState {
  const s = createState({ width: W, height: H, seed: 3, seats: 2, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
  for (let o = 1; o <= 2; o++) setOwner(s, at(o), o, 0);
  s.tick = 5000;
  return s;
}
function city(s: GameState, owner: number, x: number, level: number, ready = 0): number {
  const id = s.structures.add(STRUCT_CITY, owner, at(x), 0);
  s.structures.level[id] = level;
  s.structures.readyTick[id] = ready;
  s.structures.effDirty = true;
  return id;
}
const viewOf = (s: GameState): StateView => new StateView(s);
const purse = (s: GameState, gold: number): void => void (s.gold[1] = gold * GOLD);

describe('cityInfo: the tiles of a City', () => {
  it('2 / 3 / 4 / 5 tiles by the City level (Sim-Growth: levels 1 to 10); null for a missing id and for a structure that is not a City', () => {
    const s = world();
    const levels = [1, 2, 3, 6, 9, maxLevelOf(STRUCT_CITY)];
    const ids = levels.map((level, n) => city(s, 1, 100 + 20 * n, level));
    const v = viewOf(s);
    expect(ids.map((id) => cityInfo(v, 0, id)?.tiles.length)).toEqual([2, 2, 3, 4, 5, 5]);
    expect(ids.map((id) => cityInfo(v, 0, id)?.tiles.length)).toEqual(levels.map(districtSlotsOf));
    expect(Math.max(...levels.map(districtSlotsOf))).toBe(DISTRICT_MAX_SLOTS);
    // the top level shows no further upgrade, a lower one the sim's price of the next level
    expect(cityInfo(v, 0, ids[5] as number)?.upgradePrice).toBe(0);
    expect(cityInfo(v, 0, ids[0] as number)?.upgradePrice).toBe(upgradePriceGold(STRUCT_CITY, 2));
    expect(cityInfo(v, 0, ids[4] as number)?.upgradePrice).toBe(upgradePriceGold(STRUCT_CITY, 10));
    expect(cityInfo(v, 0, 99)).toBeNull();
    expect(cityInfo(v, 0, -1)).toBeNull();
    const f = s.structures.add(2, 1, at(240), 0); // a Factory
    expect(cityInfo(viewOf(s), 0, f)).toBeNull();
  });

  it('an empty tile offers the four kinds with the sim price, build seconds, effect line and the reason of the sim\'s own check', () => {
    const s = world();
    const id = city(s, 1, 100, 1);
    purse(s, 0);
    let tile = tileInfo(viewOf(s), 0, id, 0);
    expect(tile.state).toBe('empty');
    expect(tile.choices.map((c) => c.kind)).toEqual([...DISTRICT_KINDS]);
    expect(DISTRICT_KINDS).toEqual([DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_WALLS]);
    expect(tile.choices.map((c) => c.reason)).toEqual([REJECT_BUILD_GOLD, REJECT_BUILD_GOLD, REJECT_BUILD_GOLD, REJECT_BUILD_GOLD]);
    for (const c of tile.choices) {
      expect(c.price).toBe(districtBuildPriceGold(c.kind, 0));
      expect(c.buildSeconds).toBe((DISTRICT_BUILD_TICKS[c.kind] as number) / TICK_HZ);
    }
    purse(s, 10000);
    tile = tileInfo(viewOf(s), 0, id, 0);
    expect(tile.choices.every((c) => c.reason === REJECT_NONE)).toBe(true);
    // the price follows the number of districts of that kind the owner has
    expect(applyBuildDistrict(s, 0, id, 0, DISTRICT_MARKET)).toBe(REJECT_NONE);
    const next = tileInfo(viewOf(s), 0, id, 1).choices.find((c) => c.kind === DISTRICT_MARKET);
    expect(next?.price).toBe(districtBuildPriceGold(DISTRICT_MARKET, 1));
    expect(next?.price).toBeGreaterThan(districtBuildPriceGold(DISTRICT_MARKET, 0));
  });

  it('a City that is still building, the spawn phase and a foreign City each give their own reason', () => {
    const s = world();
    purse(s, 10000);
    const young = city(s, 1, 100, 1, s.tick + 500);
    expect(tileInfo(viewOf(s), 0, young, 0).choices[0]?.reason).toBe(REJECT_DISTRICT_CITY_BUILDING);
    const foreign = city(s, 2, 120, 1);
    expect(tileInfo(viewOf(s), 0, foreign, 0).choices[0]?.reason).not.toBe(REJECT_NONE);
    const ok = city(s, 1, 140, 1);
    const inSpawn = Object.create(viewOf(s), { flow: { value: true }, phase: { value: PHASE_SPAWN } }) as StateView;
    expect(tileInfo(inSpawn, 0, ok, 0).choices.every((c) => c.reason === REJECT_PHASE)).toBe(true);
    expect(tileInfo(viewOf(s), 0, ok, 0).choices.every((c) => c.reason === REJECT_NONE)).toBe(true);
  });

  it('an occupied tile: building with progress and no effect yet, ready with the effect now and next level, upgrading, and the top level', () => {
    const s = world();
    const id = city(s, 1, 100, 3);
    purse(s, 10000);
    expect(applyBuildDistrict(s, 0, id, 0, DISTRICT_MARKET)).toBe(REJECT_NONE);
    const total = DISTRICT_BUILD_TICKS[DISTRICT_MARKET] as number;
    let tile = tileInfo(viewOf(s), 0, id, 0);
    expect([tile.state, tile.kind, tile.level, tile.progressPct, tile.fxNow]).toEqual(['building', DISTRICT_MARKET, 1, 0, null]);
    expect(tile.choices).toEqual([]);
    s.tick += total / 2;
    tile = tileInfo(viewOf(s), 0, id, 0);
    expect(tile.progressPct).toBe(50);
    expect(tile.upgradeReason).not.toBe(REJECT_NONE); // busy
    s.tick += total;
    tile = tileInfo(viewOf(s), 0, id, 0);
    expect(tile.state).toBe('ready');
    const tenths = (level: number): string => formatGoldRate(districtEffect(DISTRICT_MARKET, level).goldMilliPerSec);
    expect(tile.fxNow).toEqual({ key: 'sel.district.fxMarket', params: { gold: tenths(1) } });
    expect(districtEffect(DISTRICT_MARKET, 1).goldMilliPerSec).toBe(300); // Sim-Growth: the lowered Market table 0.3 / 0.7 / 1.1 gold/s
    expect(tile.fxNext?.params.gold).toBe(tenths(2));
    expect(tile.upgradeReason).toBe(REJECT_NONE);
    expect(tile.removeReason).toBe(REJECT_NONE);
    expect(applyUpgradeDistrict(s, 0, id, 0)).toBe(REJECT_NONE);
    s.tick += total / 4;
    tile = tileInfo(viewOf(s), 0, id, 0);
    expect([tile.state, tile.progressPct, tile.level]).toEqual(['upgrading', 25, 1]);
    for (let i = 0; i <= total; i++) step(s, { turn: s.tick, intents: [] });
    for (let n = 0; n < 1; n++) {
      purse(s, 1000);
      expect(applyUpgradeDistrict(s, 0, id, 0)).toBe(REJECT_NONE);
      for (let i = 0; i <= total; i++) step(s, { turn: s.tick, intents: [] }); // the sim finishes the upgrade
    }
    s.structures.districtLevel[districtIndex(id, 0)] = STRUCT_LEVEL_HARD_CAP; // Sim-Levels2: the top level of a district is the hard cap
    tile = tileInfo(viewOf(s), 0, id, 0);
    expect([tile.level, tile.fxNext, tile.upgradePrice, tile.upgradeReason]).toEqual([STRUCT_LEVEL_HARD_CAP, null, 0, REJECT_STRUCT_MAX_LEVEL]);
  });

  it('the totals of the City equal the sim\'s own income, troop cap and the other effects of its FINISHED districts only', () => {
    const s = world();
    const level = 6; // four slots (Sim-Growth: a level 3 City has three)
    const id = city(s, 1, 100, level);
    purse(s, 100000);
    applyBuildDistrict(s, 0, id, 0, DISTRICT_MARKET);
    applyBuildDistrict(s, 0, id, 1, DISTRICT_HOUSING);
    applyBuildDistrict(s, 0, id, 2, DISTRICT_BARRACKS);
    applyBuildDistrict(s, 0, id, 3, DISTRICT_WALLS);
    const before = cityInfo(viewOf(s), 0, id)?.totals;
    expect(before).toEqual({ goldMilliPerSec: cityGoldMilli(level), capTroops: cityTroopCap(level), regenPct: 0, wallsCostPct: 100 }); // the City alone; nothing finished
    expect(before?.goldMilliPerSec).toBe(2437); // Sim-Levels2: 1500 + 1500 * 625 / 1000
    expect(before?.capTroops).toBe(1800);
    s.tick += 200;
    s.structures.effDirty = true;
    const done = cityInfo(viewOf(s), 0, id)?.totals;
    expect(done).toEqual({
      goldMilliPerSec: cityGoldMilli(level) + districtEffect(DISTRICT_MARKET, 1).goldMilliPerSec,
      capTroops: cityTroopCap(level) + districtEffect(DISTRICT_HOUSING, 1).capTroops,
      regenPct: districtEffect(DISTRICT_BARRACKS, 1).regenPct,
      wallsCostPct: districtEffect(DISTRICT_WALLS, 1).wallsCostPct,
    });
    expect(done?.goldMilliPerSec).toBe(structGoldMilliPerSec(s, 1));
  });
});

describe('citySignature: the per-frame change detector', () => {
  it('equal while nothing visible changes, different on progress, gold, tile state and City level; fits the buffer', () => {
    const s = world();
    const id = city(s, 1, 100, 3);
    purse(s, 400);
    const a = new Int32Array(CITY_SIG_MAX);
    const b = new Int32Array(CITY_SIG_MAX);
    const n = citySignature(viewOf(s), 0, id, a);
    expect(n).toBeLessThanOrEqual(CITY_SIG_MAX);
    expect(citySignature(viewOf(s), 0, id, b)).toBe(n);
    expect(b.subarray(0, n)).toEqual(a.subarray(0, n));
    const differs = (): boolean => {
      const m = citySignature(viewOf(s), 0, id, b);
      return m !== n || a.subarray(0, n).some((x, i) => x !== b[i]);
    };
    s.tick += 1; // a tick alone changes nothing the panel shows
    expect(differs()).toBe(false);
    purse(s, 0); // the buttons dim
    expect(differs()).toBe(true);
    purse(s, 400);
    expect(differs()).toBe(false);
    applyBuildDistrict(s, 0, id, 0, DISTRICT_HOUSING);
    expect(differs()).toBe(true);
    citySignature(viewOf(s), 0, id, a);
    s.tick += (DISTRICT_BUILD_TICKS[DISTRICT_HOUSING] as number) / 2;
    expect(differs()).toBe(true); // progress percent moved
  });
});

describe('the two-step Remove', () => {
  it('the first click arms that tile only, a second in time sends, an expired arm only arms again', () => {
    const r1 = removeClick(null, 7, 2, 1000);
    expect(r1.send).toBe(false);
    expect(removeArmed(r1.arm, 7, 2, 1000 + DELETE_ARM_MS - 1)).toBe(true);
    expect(removeArmed(r1.arm, 7, 1, 1000)).toBe(false); // another slot of the same City
    expect(removeArmed(r1.arm, 8, 2, 1000)).toBe(false); // the same slot of another City
    expect(removeArmed(r1.arm, 7, 2, 1000 + DELETE_ARM_MS)).toBe(false);
    expect(removeClick(r1.arm, 7, 2, 1000 + DELETE_ARM_MS - 1)).toEqual({ send: true, arm: null });
    expect(removeClick(r1.arm, 7, 2, 1000 + DELETE_ARM_MS).send).toBe(false);
    expect(removeClick(r1.arm, 7, 3, 1500).send).toBe(false);
    expect(new Set(Array.from({ length: DISTRICT_MAX_SLOTS }, (_, slot) => removeArmKey(5, slot))).size).toBe(DISTRICT_MAX_SLOTS);
  });
});

describe('reason texts', () => {
  it('every district code has its own tooltip key and toast key (sv and en both exist), the reused codes keep theirs', () => {
    const codes = [REJECT_DISTRICT_NOT_CITY, REJECT_DISTRICT_SLOT, REJECT_DISTRICT_OCCUPIED, REJECT_DISTRICT_EMPTY, REJECT_DISTRICT_KIND, REJECT_DISTRICT_CITY_BUILDING];
    expect(codes).toEqual([39, 40, 41, 42, 43, 44]);
    expect(new Set(codes.map(districtWhyKey)).size).toBe(6);
    const toasts = codes.map(structureRefusalKey);
    expect(new Set(toasts).size).toBe(6);
    for (const k of toasts) expect(k.startsWith('toast.district.')).toBe(true);
    for (const code of [...codes, REJECT_BUILD_GOLD, REJECT_PHASE]) expect(t(districtWhyKey(code)).length).toBeGreaterThan(0);
    expect(structureRefusalKey(REJECT_BUILD_GOLD)).toBe('toast.build.gold');
    expect(districtWhyKey(REJECT_PHASE)).toBe('sel.why.phase');
    expect(new Set(DISTRICT_KINDS.map(districtNameKey)).size).toBe(4);
  });
});

describe('opening the view', () => {
  it('the camera flies unless it is already within 5 km of the ground and the City is on screen; a double click is two clicks on the same structure in time', () => {
    expect(cityFlightNeeded(CITY_VIEW.flyNearM - 1, true)).toBe(false);
    expect(cityFlightNeeded(CITY_VIEW.flyNearM, true)).toBe(true);
    expect(cityFlightNeeded(300, false)).toBe(true);
    expect(isDoubleClick(4, 1000, 4, 1000 + CITY_VIEW.doubleClickMs)).toBe(true);
    expect(isDoubleClick(4, 1000, 4, 1001 + CITY_VIEW.doubleClickMs)).toBe(false);
    expect(isDoubleClick(4, 1000, 5, 1100)).toBe(false);
  });
});

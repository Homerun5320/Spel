// Districts-1: the district table, the three intents and their reason codes, prices, effects, the 10-City limit, the payback window, conquest, the
// codec and the validators. Every test drives the real path (apply functions, the effects cache, step, setOwner), so removing a rule fails here.
import { describe, expect, it } from 'vitest';
import { applyAttack } from '../../src/sim/conquest';
import { decodeTurn, encodeTurn } from '../../src/sim/codec';
import { floorDiv } from '../../src/sim/detmath';
import { applyBuildDistrict, applyRemoveDistrict, applyUpgradeDistrict } from '../../src/sim/districts';
import {
  DISTRICT_BARRACKS,
  DISTRICT_HOUSING,
  DISTRICT_MARKET,
  DISTRICT_WALLS,
  checkBuildDistrict,
  districtBuildPriceGold,
  districtEffect,
  districtIndex,
  districtUpgradePriceGold,
  validateBuildDistrict,
  validateRemoveDistrict,
  validateUpgradeDistrict,
} from '../../src/sim/districtRules';
import { ownerCapQt, regenMicroQtPerTick, economyTick, isTribe } from '../../src/sim/economy';
import {
  REJECT_BUILD_GOLD,
  REJECT_DELETE_COOLDOWN,
  REJECT_DISTRICT_CITY_BUILDING,
  REJECT_DISTRICT_EMPTY,
  REJECT_DISTRICT_KIND,
  REJECT_DISTRICT_NOT_CITY,
  REJECT_DISTRICT_OCCUPIED,
  REJECT_DISTRICT_SLOT,
  REJECT_NONE,
  REJECT_PHASE,
  REJECT_STRUCT_BUSY,
  REJECT_STRUCT_ID,
  REJECT_STRUCT_MAX_LEVEL,
  REJECT_STRUCT_NOT_OWNER,
  compareIntents,
  copyBody,
  validateIntent,
  withId,
  type Intent,
} from '../../src/sim/intents';
import {
  BARRACKS_REGEN_PCT_BY_LEVEL,
  BARRACKS_REGEN_PCT_MAX,
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  DELETE_COOLDOWN_TICKS,
  DISTRICT_BASE_GOLD,
  DISTRICT_BUILD_TICKS,
  DISTRICT_MAX_SLOTS,
  DISTRICT_WALLS_RADIUS_CELLS,
  ENCLAVE_FLIP_TICKS,
  FACTORY_CITY_BONUS_PCT_BY_LEVEL,
  HOUSING_TROOPS_PER_LEVEL,
  MARKET_GOLD_MILLI_BY_LEVEL,
  MICRO_QT_PER_QT,
  MILLI_GOLD_PER_GOLD,
  QT_PER_TROOP,
  SPAWN_PHASE_TICKS,
  WALLS_COST_PCT_BY_LEVEL,
} from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { createState, type GameState } from '../../src/sim/state';
import { applyIntent, step } from '../../src/sim/step';
import { applyDelete } from '../../src/sim/structures';
import { collectWalls, barracksPctOf, housingQtOf, cityLevelsOf, postAdjustedCost, collectPosts, structGoldMilliPerSec, wallAdjustedCost } from '../../src/sim/structureEffects';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_POST, cityGoldMilli } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { landState } from './helpers/worlds';

const W = 1024;
const H = 64;
const at = (x: number, y = 32): number => y * W + x;
const GOLD = MILLI_GOLD_PER_GOLD;

/** A wide strip of plains in which each seat owns one cell (so its economy runs); structures added at tick 0 are finished at tick 5000. */
function strip(seats = 2): GameState {
  const s = createState({ width: W, height: H, seed: 5, seats, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
  for (let o = 1; o <= seats; o++) setOwner(s, at(o), o, 0);
  s.tick = 5000;
  return s;
}
const addCity = (s: GameState, owner: number, x: number, level = 1, y = 32): number => {
  const id = s.structures.add(STRUCT_CITY, owner, at(x, y), 0);
  s.structures.level[id] = level;
  s.structures.effDirty = true;
  return id;
};
/** A FINISHED district put straight into the table. */
const district = (s: GameState, id: number, slot: number, kind: number, level = 1): void => s.structures.setDistrict(id, slot, kind, level, 1000, 0);
const income = (s: GameState, o = 1): number => {
  s.structures.effDirty = true;
  return structGoldMilliPerSec(s, o);
};
const gold = (s: GameState, owner: number, g: number): void => void (s.gold[owner] = g * GOLD);

describe('the district table', () => {
  it('a deleted City clears its districts, and the City that reuses the id starts with empty slots (free list, counts, kinds, levels, ticks)', () => {
    const s = strip();
    const a = addCity(s, 1, 100, 3);
    const b = addCity(s, 1, 300, 2);
    for (let slot = 0; slot < 4; slot++) district(s, a, slot, 1 + slot, 3);
    district(s, b, 0, DISTRICT_MARKET, 2);
    s.structures.districtUpgradeReadyTick[districtIndex(a, 1)] = 9999;
    const t = s.structures;
    expect([t.districtCount, t.districtsOwned(1, DISTRICT_MARKET), t.districtsOwned(1, DISTRICT_WALLS)]).toEqual([5, 2, 1]);
    t.remove(a);
    expect(t.districtCount).toBe(1);
    expect([t.districtsOwned(1, DISTRICT_MARKET), t.districtsOwned(1, DISTRICT_HOUSING), t.districtsOwned(1, DISTRICT_BARRACKS), t.districtsOwned(1, DISTRICT_WALLS)]).toEqual([1, 0, 0, 0]);
    for (let slot = 0; slot < 4; slot++) {
      const i = districtIndex(a, slot);
      expect([t.districtKind[i], t.districtLevel[i], t.districtReadyTick[i], t.districtUpgradeReadyTick[i]], `slot ${slot}`).toEqual([0, 0, 0, 0]);
    }
    const again = t.add(STRUCT_CITY, 2, at(500), 0); // the recycled id
    expect(again).toBe(a);
    for (let slot = 0; slot < 4; slot++) expect(t.districtKind[districtIndex(again, slot)]).toBe(0);
    expect(t.districtsOwned(2, DISTRICT_MARKET)).toBe(0);
    // The derived counts equal a rebuild.
    const counts = t.districtCounts.slice();
    const total = t.districtCount;
    t.rebuildIndex();
    expect(t.districtCounts).toEqual(counts);
    expect(t.districtCount).toBe(total);
  });

  it('Delete of a City goes through the same clearing, and the hash stops depending on the gone districts', () => {
    const s = strip();
    const empty = hashState(s);
    const a = addCity(s, 1, 100);
    const withCity = hashState(s);
    district(s, a, 0, DISTRICT_MARKET);
    expect(hashState(s)).not.toBe(withCity);
    expect(applyDelete(s, 0, a)).toBe(REJECT_NONE);
    expect(s.structures.districtCount).toBe(0);
    expect(s.structures.districtKind[districtIndex(a, 0)]).toBe(0);
    s.structures.deleteReady[1] = 0;
    expect(hashState(s)).not.toBe(empty); // the free list differs, but...
    const t = strip();
    const x = addCity(t, 1, 100);
    t.structures.remove(x);
    expect(hashState(t)).toBe(hashState(s)); // ...nothing of the district is left in the hash
  });

  it('every field of a district is part of the hash', () => {
    const base = (): GameState => {
      const s = strip();
      district(s, addCity(s, 1, 100, 3), 2, DISTRICT_BARRACKS, 2);
      return s;
    };
    const h0 = hashState(base());
    const edits: Array<(s: GameState) => void> = [
      (s) => (s.structures.districtKind[2] = DISTRICT_WALLS),
      (s) => (s.structures.districtLevel[2] = 3),
      (s) => (s.structures.districtReadyTick[2] = 1001),
      (s) => (s.structures.districtUpgradeReadyTick[2] = 7000),
    ];
    for (const [i, edit] of edits.entries()) {
      const s = base();
      edit(s);
      expect(hashState(s), `edit ${i}`).not.toBe(h0);
    }
  });
});

describe('the reason codes (one shared implementation: the validators equal what the sim answers)', () => {
  /** Seat 0 (owner 1) has a finished level 1 City `mine`, a finished Factory, an unfinished City, a level 3 City; seat 1 (owner 2) has a City. */
  function scene(): { s: GameState; mine: number; factory: number; fresh: number; theirs: number; l3: number } {
    const s = strip();
    const mine = addCity(s, 1, 100);
    const factory = s.structures.add(STRUCT_FACTORY, 1, at(200), 0);
    const theirs = addCity(s, 2, 400);
    const l3 = addCity(s, 1, 600, 6); // level 6: four slots (Sim-Growth: slots 2/3/4/5 by level)
    const fresh = s.structures.add(STRUCT_CITY, 1, at(800), s.tick); // still being built
    gold(s, 1, 100000);
    return { s, mine, factory, fresh, theirs, l3 };
  }
  /** Both answers for one BuildDistrict: the validator on a snapshot first, then the sim's apply. */
  const build = (s: GameState, structure: number, slot: number, kind: number): [number, number] => {
    const v = validateBuildDistrict(new StateView(s), 0, structure, slot, kind);
    return [v, applyBuildDistrict(s, 0, structure, slot, kind)];
  };
  const upgrade = (s: GameState, structure: number, slot: number): [number, number] => {
    const v = validateUpgradeDistrict(new StateView(s), 0, structure, slot);
    return [v, applyUpgradeDistrict(s, 0, structure, slot)];
  };
  const remove = (s: GameState, structure: number, slot: number): [number, number] => {
    const v = validateRemoveDistrict(new StateView(s), 0, structure, slot);
    return [v, applyRemoveDistrict(s, 0, structure, slot)];
  };
  const same = (r: [number, number], code: number): void => {
    expect(r).toEqual([code, code]);
  };

  it('BuildDistrict: kind, id, owner, not a City, slot, City still building, occupied, purse, then success', () => {
    const { s, mine, factory, fresh, theirs, l3 } = scene();
    const purse = s.gold[1] as number;
    for (const kind of [0, 5, -1, 1.5]) same(build(s, mine, 0, kind), REJECT_DISTRICT_KIND);
    same(build(s, 999, 0, DISTRICT_MARKET), REJECT_STRUCT_ID);
    same(build(s, -1, 0, DISTRICT_MARKET), REJECT_STRUCT_ID);
    same(build(s, theirs, 0, DISTRICT_MARKET), REJECT_STRUCT_NOT_OWNER);
    same(build(s, factory, 0, DISTRICT_MARKET), REJECT_DISTRICT_NOT_CITY);
    for (const slot of [2, 3, 4, -1, 0.5]) same(build(s, mine, slot, DISTRICT_MARKET), REJECT_DISTRICT_SLOT); // a level 1 City has slots 0 and 1
    same(build(s, fresh, 0, DISTRICT_MARKET), REJECT_DISTRICT_CITY_BUILDING);
    expect(s.gold[1]).toBe(purse); // refusals took nothing
    same(build(s, l3, 3, DISTRICT_MARKET), REJECT_NONE); // a level 6 City has slot 3
    s.gold[1] = purse;
    same(build(s, mine, 0, DISTRICT_MARKET), REJECT_NONE);
    same(build(s, mine, 0, DISTRICT_HOUSING), REJECT_DISTRICT_OCCUPIED);
    s.gold[1] = (DISTRICT_BASE_GOLD[DISTRICT_HOUSING] as number) * GOLD - 1;
    same(build(s, mine, 1, DISTRICT_HOUSING), REJECT_BUILD_GOLD);
    s.gold[1] = (DISTRICT_BASE_GOLD[DISTRICT_HOUSING] as number) * GOLD;
    same(build(s, mine, 1, DISTRICT_HOUSING), REJECT_NONE); // exactly the price pays
    expect(s.gold[1]).toBe(0);
  });

  it('UpgradeDistrict: id, owner, not a City, slot, empty, top level, busy (building and upgrading), purse, then success', () => {
    const { s, mine, factory, theirs, l3 } = scene();
    district(s, l3, 0, DISTRICT_MARKET, 3);
    district(s, mine, 0, DISTRICT_MARKET, 1);
    s.structures.setDistrict(mine, 1, DISTRICT_HOUSING, 1, s.tick + 50, 0); // still being built
    same(upgrade(s, 999, 0), REJECT_STRUCT_ID);
    same(upgrade(s, theirs, 0), REJECT_STRUCT_NOT_OWNER);
    same(upgrade(s, factory, 0), REJECT_DISTRICT_NOT_CITY);
    same(upgrade(s, mine, 2), REJECT_DISTRICT_SLOT);
    same(upgrade(s, l3, 1), REJECT_DISTRICT_EMPTY);
    same(upgrade(s, l3, 0), REJECT_STRUCT_MAX_LEVEL);
    same(upgrade(s, mine, 1), REJECT_STRUCT_BUSY);
    const price = districtUpgradePriceGold(DISTRICT_MARKET, 2) * GOLD;
    s.gold[1] = price - 1;
    same(upgrade(s, mine, 0), REJECT_BUILD_GOLD);
    s.gold[1] = price;
    same(upgrade(s, mine, 0), REJECT_NONE);
    expect(s.gold[1]).toBe(0);
    expect(s.structures.districtUpgradeReadyTick[districtIndex(mine, 0)]).toBe(s.tick + (DISTRICT_BUILD_TICKS[DISTRICT_MARKET] as number));
    s.gold[1] = 100000 * GOLD;
    same(upgrade(s, mine, 0), REJECT_STRUCT_BUSY); // already upgrading
  });

  it('RemoveDistrict: id, owner, not a City, slot, empty, the Delete cooldown (shared with Delete), then success', () => {
    const { s, mine, factory, theirs } = scene();
    district(s, mine, 0, DISTRICT_MARKET);
    district(s, mine, 1, DISTRICT_HOUSING);
    same(remove(s, 999, 0), REJECT_STRUCT_ID);
    same(remove(s, theirs, 0), REJECT_STRUCT_NOT_OWNER);
    same(remove(s, factory, 0), REJECT_DISTRICT_NOT_CITY);
    same(remove(s, mine, 3), REJECT_DISTRICT_SLOT);
    s.structures.clearDistrict(mine, 1);
    same(remove(s, mine, 1), REJECT_DISTRICT_EMPTY);
    district(s, mine, 1, DISTRICT_HOUSING);
    same(remove(s, mine, 0), REJECT_NONE);
    expect(s.structures.districtKind[districtIndex(mine, 0)]).toBe(0);
    expect(s.structures.deleteReadyTick(1)).toBe(s.tick + DELETE_COOLDOWN_TICKS);
    same(remove(s, mine, 1), REJECT_DELETE_COOLDOWN);
    expect(applyDelete(s, 0, mine)).toBe(REJECT_DELETE_COOLDOWN); // the cooldown is the structures' too
    s.tick += DELETE_COOLDOWN_TICKS;
    same(remove(s, mine, 1), REJECT_NONE);
  });

  it('all three are refused with REJECT_PHASE in the spawn phase and take nothing', () => {
    const s = createState({ width: 64, height: 32, seed: 2, seats: 2, config: { spawnPhase: true }, terrain: new Uint8Array(64 * 32).fill(CLASS_PLAINS), elevation: new Uint16Array(64 * 32) });
    for (let c = 0; c < 64 * 32; c++) setOwner(s, c, 1, 0);
    const city = s.structures.add(STRUCT_CITY, 1, 100, 0);
    district(s, city, 0, DISTRICT_MARKET);
    gold(s, 1, 5000);
    const purse = s.gold[1];
    expect(applyIntent(s, withId({ kind: 'BuildDistrict', seat: 0, structure: city, slot: 1, districtKind: DISTRICT_HOUSING }, 1))).toBe(REJECT_PHASE);
    expect(applyIntent(s, withId({ kind: 'UpgradeDistrict', seat: 0, structure: city, slot: 0 }, 2))).toBe(REJECT_PHASE);
    expect(applyIntent(s, withId({ kind: 'RemoveDistrict', seat: 0, structure: city, slot: 0 }, 3))).toBe(REJECT_PHASE);
    expect([s.gold[1], s.structures.districtCount, s.structures.deleteReadyTick(1)]).toEqual([purse, 1, 0]);
    s.tick = SPAWN_PHASE_TICKS;
    expect(applyIntent(s, withId({ kind: 'BuildDistrict', seat: 0, structure: city, slot: 1, districtKind: DISTRICT_HOUSING }, 4))).toBe(REJECT_NONE);
  });

  it('the validators and the sim answer the same over a sweep of every slot, kind and purse', () => {
    for (const purse of [0, 59, 60, 150, 100000]) {
      for (let slot = -1; slot <= 4; slot++) {
        for (let kind = 0; kind <= 5; kind++) {
          const { s, mine } = scene();
          district(s, mine, 1, DISTRICT_BARRACKS);
          s.gold[1] = purse * GOLD;
          const [v, a] = build(s, mine, slot, kind);
          expect(a, `purse ${purse} slot ${slot} kind ${kind}`).toBe(v);
        }
      }
    }
  });
});

describe('the intents on the wire', () => {
  const ctx = { seats: 2, cells: W * H, debugIntents: false };
  const intents: Intent[] = [
    { kind: 'BuildDistrict', seat: 1, id: 5, structure: 4095, slot: 3, districtKind: 4 },
    { kind: 'UpgradeDistrict', seat: 0, id: 6, structure: 17, slot: 2 },
    { kind: 'RemoveDistrict', seat: 1, id: 7, structure: 0, slot: 0 },
  ];

  it('validateIntent: ranges of structure, slot and kind (and the seat), each with its own code', () => {
    for (const i of intents) expect(validateIntent(i, ctx), i.kind).toBe(REJECT_NONE);
    const b = intents[0] as Intent;
    expect(validateIntent({ ...b, structure: 4096 }, ctx)).toBe(REJECT_STRUCT_ID);
    expect(validateIntent({ ...b, structure: -1 }, ctx)).toBe(REJECT_STRUCT_ID);
    expect(validateIntent({ ...b, slot: DISTRICT_MAX_SLOTS }, ctx)).toBe(REJECT_DISTRICT_SLOT);
    expect(validateIntent({ ...b, slot: DISTRICT_MAX_SLOTS - 1 }, ctx)).toBe(REJECT_NONE);
    expect(validateIntent({ ...b, slot: 1.5 }, ctx)).toBe(REJECT_DISTRICT_SLOT);
    expect(validateIntent({ ...b, districtKind: 0 }, ctx)).toBe(REJECT_DISTRICT_KIND);
    expect(validateIntent({ ...b, districtKind: 5 }, ctx)).toBe(REJECT_DISTRICT_KIND);
    for (const i of intents.slice(1)) {
      expect(validateIntent({ ...i, slot: DISTRICT_MAX_SLOTS }, ctx), i.kind).toBe(REJECT_DISTRICT_SLOT);
      expect(validateIntent({ ...i, structure: 4096 }, ctx), i.kind).toBe(REJECT_STRUCT_ID);
    }
    expect(validateIntent({ ...b, seat: 2 }, ctx)).not.toBe(REJECT_NONE);
  });

  it('the codec round trips all three exactly and refuses nothing it wrote; copyBody and withId keep every field', () => {
    const bytes = encodeTurn({ turn: 12, intents });
    const r = decodeTurn(bytes);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ turn: 12, intents });
    if (r.ok) expect(encodeTurn(r.value)).toEqual(bytes);
    for (const i of intents) {
      const { id, ...body } = i;
      expect(copyBody(body)).toEqual(body);
      expect(withId(body, id)).toEqual(i);
    }
    // a truncated BuildDistrict (kind missing) is an error result, not a throw
    const cut = bytes.slice(0, 8);
    expect(decodeTurn(cut).ok).toBe(false);
  });

  it('the canonical order is total over the new payloads (structure, then slot, then kind)', () => {
    const mk = (structure: number, slot: number, districtKind: number): Intent => ({ kind: 'BuildDistrict', seat: 0, id: 0, structure, slot, districtKind });
    expect(compareIntents(mk(1, 3, 4), mk(2, 0, 1))).toBeLessThan(0);
    expect(compareIntents(mk(1, 1, 4), mk(1, 2, 1))).toBeLessThan(0);
    expect(compareIntents(mk(1, 1, 1), mk(1, 1, 2))).toBeLessThan(0);
    expect(compareIntents(mk(1, 1, 2), mk(1, 1, 2))).toBe(0);
    const u = (structure: number, slot: number): Intent => ({ kind: 'UpgradeDistrict', seat: 0, id: 0, structure, slot });
    expect(compareIntents(u(1, 3), u(2, 0))).toBeLessThan(0);
    expect(compareIntents(u(1, 1), u(1, 2))).toBeLessThan(0);
  });

  it('through step(): a BuildDistrict intent builds, the next turn charges nothing twice, and a refused one raises state.rejects', () => {
    const s = strip();
    const city = addCity(s, 1, 100);
    gold(s, 1, 1000);
    const before = s.gold[1] as number;
    const r = step(s, { turn: s.tick, intents: [{ kind: 'BuildDistrict', seat: 0, id: 0, structure: city, slot: 0, districtKind: DISTRICT_MARKET }] });
    expect(r.ok && r.applied).toBe(1);
    expect(s.structures.districtKind[districtIndex(city, 0)]).toBe(DISTRICT_MARKET);
    expect(before - (s.gold[1] as number)).toBeGreaterThanOrEqual(60 * GOLD - 100000); // the price left, the tick's income came in
    const rejects = s.rejects;
    const r2 = step(s, { turn: s.tick, intents: [{ kind: 'BuildDistrict', seat: 0, id: 1, structure: city, slot: 0, districtKind: DISTRICT_MARKET }] });
    expect(r2.ok && r2.rejected).toBe(1);
    expect(s.rejects).toBe(rejects + 1);
  });
});

describe('prices and the staircase', () => {
  it('the n-th district of a kind costs base * min(12, 2 + n) / 2; kinds count separately; an upgrade to level L costs base * L', () => {
    expect([0, 1, 2, 3, 9, 10, 11, 40].map((n) => districtBuildPriceGold(DISTRICT_MARKET, n))).toEqual([40, 60, 80, 100, 220, 240, 240, 240]); // Market base 40 (Sim-Growth: was 60)
    expect(districtBuildPriceGold(DISTRICT_WALLS, 0)).toBe(300);
    expect(districtBuildPriceGold(DISTRICT_HOUSING, 1)).toBe(225);
    expect([2, 3].map((l) => districtUpgradePriceGold(DISTRICT_BARRACKS, l))).toEqual([500, 750]);
    const s = strip();
    const city = addCity(s, 1, 100, 6);
    gold(s, 1, 10000);
    const taken: number[] = [];
    for (const [slot, kind] of [[0, DISTRICT_MARKET], [1, DISTRICT_MARKET], [2, DISTRICT_HOUSING], [3, DISTRICT_MARKET]] as const) {
      const g = s.gold[1] as number;
      expect(applyBuildDistrict(s, 0, city, slot, kind)).toBe(REJECT_NONE);
      taken.push((g - (s.gold[1] as number)) / GOLD);
    }
    expect(taken).toEqual([40, 60, 150, 80]);
  });

  it('a build is finished after the kind\'s build time and an upgrade raises the level then, not before', () => {
    const s = strip();
    const city = addCity(s, 1, 100);
    gold(s, 1, 10000);
    const t0 = s.tick;
    expect(applyBuildDistrict(s, 0, city, 0, DISTRICT_BARRACKS)).toBe(REJECT_NONE);
    expect(s.structures.districtReadyTick[districtIndex(city, 0)]).toBe(t0 + (DISTRICT_BUILD_TICKS[DISTRICT_BARRACKS] as number));
    s.tick = s.structures.districtReadyTick[districtIndex(city, 0)] as number;
    expect(applyUpgradeDistrict(s, 0, city, 0)).toBe(REJECT_NONE);
    const done = s.tick + (DISTRICT_BUILD_TICKS[DISTRICT_BARRACKS] as number);
    while (s.tick < done) {
      expect(s.structures.districtLevel[districtIndex(city, 0)], `tick ${s.tick}`).toBe(1);
      step(s, { turn: s.tick, intents: [] });
    }
    step(s, { turn: s.tick, intents: [] });
    expect([s.structures.districtLevel[districtIndex(city, 0)], s.structures.districtUpgradeReadyTick[districtIndex(city, 0)]]).toEqual([2, 0]);
  });
});

describe('the effects (only finished districts, through the real economy)', () => {
  it('Market: 0.3 / 0.7 / 1.1 gold/s per level, nothing while it is being built, and it starts by itself at the finish tick', () => {
    for (const level of [1, 2, 3]) {
      const s = strip();
      const city = addCity(s, 1, 100);
      const base = income(s);
      district(s, city, 0, DISTRICT_MARKET, level);
      expect(income(s) - base).toBe(MARKET_GOLD_MILLI_BY_LEVEL[level]);
    }
    expect([1, 2, 3].map((l) => MARKET_GOLD_MILLI_BY_LEVEL[l])).toEqual([300, 700, 1100]);
    const s = strip();
    const city = addCity(s, 1, 100);
    gold(s, 1, 1000);
    const base = income(s);
    expect(applyBuildDistrict(s, 0, city, 0, DISTRICT_MARKET)).toBe(REJECT_NONE);
    expect(structGoldMilliPerSec(s, 1)).toBe(base); // under construction: nothing
    for (let i = 0; i < (DISTRICT_BUILD_TICKS[DISTRICT_MARKET] as number) - 1; i++) step(s, { turn: s.tick, intents: [] });
    expect(structGoldMilliPerSec(s, 1)).toBe(base);
    step(s, { turn: s.tick, intents: [] });
    step(s, { turn: s.tick, intents: [] });
    expect(structGoldMilliPerSec(s, 1)).toBe(base + (MARKET_GOLD_MILLI_BY_LEVEL[1] as number));
  });

  it('Housing: +400 troops of cap per level, exactly, on top of the City levels; none while being built', () => {
    for (const level of [1, 2, 3]) {
      const s = strip();
      const city = addCity(s, 1, 100);
      const base = ownerCapQt(s, 1);
      district(s, city, 0, DISTRICT_HOUSING, level);
      expect(ownerCapQt(s, 1) - base).toBe(HOUSING_TROOPS_PER_LEVEL * level * QT_PER_TROOP);
      district(s, city, 1, DISTRICT_HOUSING, level);
      expect(housingQtOf(s, 1)).toBe(2 * HOUSING_TROOPS_PER_LEVEL * level * QT_PER_TROOP);
    }
    const s = strip();
    const city = addCity(s, 1, 100);
    const base = ownerCapQt(s, 1);
    s.structures.setDistrict(city, 0, DISTRICT_HOUSING, 1, s.tick + 5, 0);
    expect(ownerCapQt(s, 1)).toBe(base);
    for (let i = 0; i < 6; i++) step(s, { turn: s.tick, intents: [] });
    expect(ownerCapQt(s, 1)).toBe(base + HOUSING_TROOPS_PER_LEVEL * QT_PER_TROOP);
    // another owner's Housing does not leak
    expect(housingQtOf(s, 2)).toBe(0);
  });

  it('Barracks: the regeneration is raised by 5 / 10 / 15 percent per level, capped at the sum of 50, and a decay above the cap is untouched', () => {
    const total = (s: GameState): number => (s.troops[1] as number) * MICRO_QT_PER_QT + (s.troopFrac[1] as number);
    const gain = (setup: (s: GameState) => void, troops: number): { got: number; rate: number } => {
      const s = strip();
      const city = addCity(s, 1, 100, 3);
      const city2 = addCity(s, 1, 300, 3);
      setup(s);
      void city;
      void city2;
      s.troops[1] = troops;
      s.troopFrac[1] = 0;
      const cap = ownerCapQt(s, 1);
      const rate = regenMicroQtPerTick(troops, cap, isTribe(s, 1));
      const start = total(s);
      economyTick(s);
      return { got: total(s) - start, rate };
    };
    const none = gain(() => undefined, 10000);
    expect(none.got).toBe(none.rate);
    expect(none.rate).toBeGreaterThan(0);
    for (const level of [1, 2, 3]) {
      const r = gain((s) => district(s, 0, 2, DISTRICT_BARRACKS, level), 10000);
      expect(r.got).toBe(floorDiv(r.rate * (100 + (BARRACKS_REGEN_PCT_BY_LEVEL[level] as number)), 100));
    }
    // three level 3 Barracks add 45, five add 75 which the cap holds at 50
    const three = gain((s) => [0, 1, 2].forEach((k) => district(s, 0, k, DISTRICT_BARRACKS, 3)), 10000);
    expect(three.got).toBe(floorDiv(three.rate * 145, 100));
    const many = gain((s) => {
      for (let k = 0; k < 4; k++) district(s, 0, k, DISTRICT_BARRACKS, 3);
      district(s, 1, 0, DISTRICT_BARRACKS, 3);
    }, 10000);
    expect(many.got).toBe(floorDiv(many.rate * (100 + BARRACKS_REGEN_PCT_MAX), 100));
    // above the cap the troops decay at the same speed with and without Barracks
    const over = gain((s) => district(s, 0, 0, DISTRICT_BARRACKS, 3), 4000000);
    const overNone = gain(() => undefined, 4000000);
    expect(over.rate).toBeLessThan(0);
    expect(over.got).toBe(overNone.got);
  });

  it('Barracks: the percent really reaches the cache of the owner, and not the other owner', () => {
    const s = strip();
    district(s, addCity(s, 1, 100), 0, DISTRICT_BARRACKS, 2);
    expect([barracksPctOf(s, 1), barracksPctOf(s, 2)]).toEqual([10, 0]);
  });

  it('Walls: the attacker\'s price is x1.5 / 1.8 / 2.0 on the City cell and within 2 cells, not beyond, not while being built', () => {
    expect(DISTRICT_WALLS_RADIUS_CELLS).toBe(2);
    expect([1, 2, 3].map((l) => WALLS_COST_PCT_BY_LEVEL[l])).toEqual([150, 180, 200]);
    for (const level of [1, 2, 3]) {
      const s = strip();
      district(s, addCity(s, 2, 100), 0, DISTRICT_WALLS, level);
      expect(collectWalls(s, 2)).toBe(1);
      const pct = WALLS_COST_PCT_BY_LEVEL[level] as number;
      for (const [dx = 0, dy = 0] of [[0, 0], [2, 0], [-2, 0], [0, 2], [1, 1], [1, -1]]) expect(wallAdjustedCost(s.structures, W, at(100 + dx, 32 + dy), 1000), `${dx},${dy}`).toBe(10 * pct);
      for (const [dx = 0, dy = 0] of [[3, 0], [0, -3], [2, 1], [2, 2]]) expect(wallAdjustedCost(s.structures, W, at(100 + dx, 32 + dy), 1000), `${dx},${dy}`).toBe(1000);
    }
    const t = strip();
    t.structures.setDistrict(addCity(t, 2, 100), 0, DISTRICT_WALLS, 3, t.tick + 5, 0);
    expect(collectWalls(t, 2)).toBe(0);
    expect(collectWalls(t, 1)).toBe(0);
  });

  /** Owner 1 attacks owner 2's 3x3 block (x 40..42, y 3..5, City at (41, 4)); returns the QT paid per cell taken. */
  function costPerCell(setup: ((s: GameState, city: number) => void) | null): number {
    const s = landState(80, 8, { seats: 2 });
    for (let y = 0; y < 8; y++) for (let x = 0; x < 80; x++) setOwner(s, y * 80 + x, x < 40 ? 1 : x <= 42 && y >= 3 && y <= 5 ? 2 : 0, 0);
    s.tick = 5000;
    const city = s.structures.add(STRUCT_CITY, 2, 4 * 80 + 41, 0);
    if (setup !== null) setup(s, city);
    s.troops[1] = 400000;
    expect(applyAttack(s, 0, 2, 100)).toBe(0);
    for (let i = 0; i < 6; i++) {
      step(s, { turn: s.tick, intents: [] });
      const taken = (s.agg.area[1] as number) - 320;
      const a = s.attacks.list[0];
      if (taken >= 2 && a !== undefined) return (400000 - a.troops) / taken;
    }
    throw new Error('the attack did not take two cells');
  }
  it('an attack on a walled City pays x1.5 / x2.0 per cell; with a Defense Post in reach the larger price applies, they do not stack', () => {
    const none = costPerCell(null);
    const l1 = costPerCell((s, c) => district(s, c, 0, DISTRICT_WALLS, 1));
    const l3 = costPerCell((s, c) => district(s, c, 0, DISTRICT_WALLS, 3));
    expect(l1 / none).toBeGreaterThan(1.4);
    expect(l1 / none).toBeLessThan(1.6);
    expect(l3 / none).toBeGreaterThan(1.9);
    expect(l3 / none).toBeLessThan(2.1);
    const post = costPerCell((s) => void s.structures.add(STRUCT_POST, 2, 5 * 80 + 42, 0));
    const both = costPerCell((s, c) => {
      s.structures.add(STRUCT_POST, 2, 5 * 80 + 42, 0);
      district(s, c, 0, DISTRICT_WALLS, 3);
    });
    expect(post / none).toBeGreaterThan(2.3);
    expect(both / none).toBeGreaterThan(2.3);
    expect(both / none).toBeLessThan(2.7); // 2.5 (the Post), not 2.5 x 2.0 = 5 and not the walls alone
    expect(both).toBeCloseTo(post, 0);
    // a Post alone and Walls alone leave a lower walls price below the Post's too
    const weak = costPerCell((s, c) => {
      s.structures.add(STRUCT_POST, 2, 5 * 80 + 42, 0);
      district(s, c, 0, DISTRICT_WALLS, 1);
    });
    expect(weak).toBeCloseTo(post, 0);
  });

  it('the Post helper alone is unchanged by Walls collection (collectPosts and collectWalls use separate scratch)', () => {
    const s = strip();
    s.structures.add(STRUCT_POST, 2, at(100), 0);
    district(s, addCity(s, 2, 300), 0, DISTRICT_WALLS, 2);
    expect([collectPosts(s, 2), collectWalls(s, 2)]).toEqual([1, 1]);
    expect(postAdjustedCost(s.structures, W, at(105), 1000)).toBe(2500);
    expect(wallAdjustedCost(s.structures, W, at(300), 1000)).toBe(1800);
  });
});

describe('the limit of 10 level-1 Cities (15 gold/s) for ONE City with four level 3 districts', () => {
  const LIMIT = 10 * CITY_GOLD_MILLI_PER_SEC_PER_LEVEL;
  /** The worst case: a level 3 City boosted by a level 3 Factory, four level 3 Markets. Returns what the City and its districts pay (the Factory's own gold taken out). */
  function worst(markets: number): number {
    const s = strip();
    const factory = s.structures.add(STRUCT_FACTORY, 1, at(110), 0);
    s.structures.level[factory] = 3;
    const alone = income(s);
    const city = addCity(s, 1, 100, 3);
    for (let k = 0; k < markets; k++) district(s, city, k, DISTRICT_MARKET, 3);
    return income(s) - alone;
  }
  it('stays under the 15 (Sim-Growth: a level 3 City pays 2.5 gold/s now, the level 10 worst case is in tests/sim/cityLevels.test.ts); the old per-level 1.5 gold/s would break it (so the table is not just a guess)', () => {
    const noMarkets = worst(0);
    expect(noMarkets).toBe(cityGoldMilli(3) + Math.floor((cityGoldMilli(3) * (FACTORY_CITY_BONUS_PCT_BY_LEVEL[3] as number)) / 100));
    const total = worst(4);
    expect(total - noMarkets).toBe(4 * (MARKET_GOLD_MILLI_BY_LEVEL[3] as number));
    expect(total).toBeLessThanOrEqual(LIMIT);
    expect(Math.floor((total * 1100) / 1000)).toBeLessThanOrEqual(LIMIT); // with the +10 percent trait
    expect(noMarkets + 4 * 1500 * 3).toBeGreaterThan(LIMIT); // at 1.5 gold/s per level it would have broken the limit
    expect(Math.floor(((noMarkets + 4 * 3000) * 1100) / 1000)).toBeGreaterThan(LIMIT); // and 3.0 gold/s at level 3 is too much with the trait (Sim-Growth: the level 3 City pays less now, so the mutant is larger)
  });
});

describe('payback of a Market upgrade (logged, the window of M09c: 90 s to 6 minutes)', () => {
  it('both upgrades of a Market pay back in a reference City (level 2, level 1 Factory in reach, a Market already there)', () => {
    const scene = (level: number): GameState => {
      const s = strip();
      s.structures.add(STRUCT_FACTORY, 1, at(110), 0);
      const city = addCity(s, 1, 100, 2);
      district(s, city, 0, DISTRICT_MARKET, level);
      return s;
    };
    const rows: string[] = [];
    for (const level of [2, 3]) {
      const gain = income(scene(level)) - income(scene(level - 1));
      const sec = (districtUpgradePriceGold(DISTRICT_MARKET, level) * 1000) / gain;
      rows.push(`Market -> L${level}: ${sec.toFixed(0)} s`);
      expect(sec, rows.join('; ')).toBeGreaterThanOrEqual(90);
      expect(sec, rows.join('; ')).toBeLessThanOrEqual(360);
    }
    const first = (districtBuildPriceGold(DISTRICT_MARKET, 0) * 1000) / (MARKET_GOLD_MILLI_BY_LEVEL[1] as number);
    rows.push(`first Market: ${first.toFixed(0)} s`);
    console.log(`[payback districts] ${rows.join('; ')}`);
    expect(first).toBeGreaterThanOrEqual(90);
    expect(first).toBeLessThanOrEqual(360);
  });
});

describe('conquest of Cities with districts', () => {
  const cellOf = (x: number, y: number): number => y * 40 + x;
  function pocket(): GameState {
    const s = landState(40, 20, { seats: 3 });
    for (let c = 0; c < s.grid.cells; c++) setOwner(s, c, c % 40 < 20 ? 1 : 2, 0);
    s.tick = 5000;
    return s;
  }
  /** Owner 2's level 3 City at (30, 10): Market L3, Housing L2 with a running upgrade, Barracks L1 still being built, Walls L3. */
  function fullCity(s: GameState, level = 6): number {
    const city = s.structures.add(STRUCT_CITY, 2, cellOf(30, 10), 0);
    s.structures.level[city] = level;
    s.structures.setDistrict(city, 0, DISTRICT_MARKET, 3, 100, 0);
    s.structures.setDistrict(city, 1, DISTRICT_HOUSING, 2, 100, 9000);
    s.structures.setDistrict(city, 2, DISTRICT_BARRACKS, 1, s.tick + 500, 0);
    s.structures.setDistrict(city, 3, DISTRICT_WALLS, 3, 100, 0);
    return city;
  }

  it('a conquered level 6 City becomes level 5: slots 0 to 2 stay, slot 3 (the highest) is lost, a building district is lost, levels drop by 1 (min 1), upgrades stop', () => {
    const s = pocket();
    const city = fullCity(s);
    const t = s.structures;
    const goldBefore = income(s, 1);
    setOwner(s, cellOf(30, 10), 1, 0);
    expect([t.owner[city], t.level[city]]).toEqual([1, 5]);
    const k = (slot: number): number[] => [t.districtKind[districtIndex(city, slot)] as number, t.districtLevel[districtIndex(city, slot)] as number, t.districtUpgradeReadyTick[districtIndex(city, slot)] as number];
    expect(k(0)).toEqual([DISTRICT_MARKET, 2, 0]);
    expect(k(1)).toEqual([DISTRICT_HOUSING, 1, 0]); // L2 -> L1, the running upgrade is gone
    expect(k(2)).toEqual([0, 0, 0]); // being built: lost
    expect(k(3)).toEqual([0, 0, 0]); // no such slot at level 2
    expect(t.districtCount).toBe(2);
    expect([t.districtsOwned(2, DISTRICT_MARKET), t.districtsOwned(2, DISTRICT_HOUSING), t.districtsOwned(2, DISTRICT_WALLS), t.districtsOwned(2, DISTRICT_BARRACKS)]).toEqual([0, 0, 0, 0]);
    expect([t.districtsOwned(1, DISTRICT_MARKET), t.districtsOwned(1, DISTRICT_HOUSING)]).toEqual([1, 1]);
    // the derived counts equal a rebuild
    const counts = t.districtCounts.slice();
    t.rebuildIndex();
    expect(t.districtCounts).toEqual(counts);
    // the new owner is paid by the kept Market (level 2) and the old owner loses it
    expect(income(s, 1) - goldBefore).toBe(cityGoldMilli(5) + (MARKET_GOLD_MILLI_BY_LEVEL[2] as number)); // a level 5 City and its kept Market L2
    expect(structGoldMilliPerSec(s, 2)).toBe(0);
    expect(housingQtOf(s, 1)).toBe(HOUSING_TROOPS_PER_LEVEL * 1 * QT_PER_TROOP);
    expect(cityLevelsOf(s, 1)).toBe(5); // the statistic adds the City's five levels
  });

  it('a level 2 City conquered to level 1 keeps two slots; a level 1 City stays level 1 and keeps its two (levels do not fall below 1)', () => {
    const s = pocket();
    const city = fullCity(s, 2);
    setOwner(s, cellOf(30, 10), 1, 0);
    const t = s.structures;
    expect(t.level[city]).toBe(1);
    expect([0, 1, 2, 3].map((slot) => t.districtKind[districtIndex(city, slot)])).toEqual([DISTRICT_MARKET, DISTRICT_HOUSING, 0, 0]);
    expect(t.districtLevel[districtIndex(city, 0)]).toBe(2);
    // conquered again while it is level 1: the level stays 1, the districts drop to 1 and keep their slots
    for (let c = 0; c < s.grid.cells; c++) if (c !== cellOf(30, 10)) setOwner(s, c, 2, 0);
    setOwner(s, cellOf(30, 10), 2, 0);
    expect(t.level[city]).toBe(1);
    expect([t.districtKind[districtIndex(city, 0)], t.districtLevel[districtIndex(city, 0)], t.districtKind[districtIndex(city, 1)], t.districtLevel[districtIndex(city, 1)]]).toEqual([DISTRICT_MARKET, 1, DISTRICT_HOUSING, 1]);
  });

  it('a City whose cell is freed (new owner 0) is destroyed with all its districts, and the id comes back clean', () => {
    const s = pocket();
    const city = fullCity(s);
    const t = s.structures;
    setOwner(s, cellOf(30, 10), 0, 0);
    expect(t.owner[city]).toBe(0);
    expect(t.districtCount).toBe(0);
    for (let slot = 0; slot < 4; slot++) expect(t.districtKind[districtIndex(city, slot)]).toBe(0);
    expect([2, 1].map((o) => t.districtsOwned(o, DISTRICT_MARKET))).toEqual([0, 0]);
    const reused = t.add(STRUCT_CITY, 1, cellOf(5, 5), s.tick);
    expect(reused).toBe(city);
    expect(t.districtKind[districtIndex(reused, 0)]).toBe(0);
  });

  it('an enclave that flips to the surrounding player takes its City with the districts that fit one level lower', () => {
    const s = landState(14, 10, { seats: 3 });
    for (let c = 0; c < s.grid.cells; c++) setOwner(s, c, 1, 0);
    for (let y = 4; y < 6; y++) for (let x = 5; x < 7; x++) setOwner(s, y * 14 + x, 2, 0);
    s.tick = 5000;
    const city = s.structures.add(STRUCT_CITY, 2, 4 * 14 + 5, 0);
    s.structures.level[city] = 6; // four slots; conquered to level 5 (three slots) it loses slot 3
    s.structures.setDistrict(city, 0, DISTRICT_MARKET, 2, 100, 0);
    s.structures.setDistrict(city, 3, DISTRICT_WALLS, 3, 100, 0);
    for (let i = 0; i < ENCLAVE_FLIP_TICKS; i++) step(s, { turn: s.tick, intents: [] });
    const t = s.structures;
    expect([t.owner[city], t.level[city]]).toEqual([1, 5]);
    expect([t.districtKind[districtIndex(city, 0)], t.districtLevel[districtIndex(city, 0)]]).toEqual([DISTRICT_MARKET, 1]);
    expect(t.districtKind[districtIndex(city, 3)]).toBe(0);
    expect([t.districtsOwned(2, DISTRICT_MARKET), t.districtsOwned(1, DISTRICT_MARKET), t.districtsOwned(1, DISTRICT_WALLS)]).toEqual([0, 1, 0]);
  });
});

describe('the pure check function is the one the validators use', () => {
  it('checkBuildDistrict on a snapshot equals validateBuildDistrict', () => {
    const s = strip();
    const city = addCity(s, 1, 100);
    gold(s, 1, 100);
    const view = new StateView(s);
    for (let slot = 0; slot < 4; slot++) {
      for (let kind = 0; kind < 6; kind++) {
        expect(checkBuildDistrict(view.structures, view.districts, view.tick, view.stats.goldMilli[0] as number, 0, city, slot, kind)).toBe(validateBuildDistrict(view, 0, city, slot, kind));
      }
    }
    expect(districtEffect(DISTRICT_MARKET, 3).goldMilliPerSec).toBe(1100);
    expect(districtEffect(DISTRICT_HOUSING, 2).capTroops).toBe(800);
    expect(districtEffect(DISTRICT_BARRACKS, 3).regenPct).toBe(15);
    expect(districtEffect(DISTRICT_WALLS, 2).wallsCostPct).toBe(180);
    expect(districtEffect(DISTRICT_WALLS, 0).wallsCostPct).toBe(100);
    expect(districtEffect(9, 1).wallsCostPct).toBe(100);
  });
});

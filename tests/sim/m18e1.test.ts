// M18e-1: Airfield, Lab and Plant (structure types 7, 8, 9). Every test drives the real sim path (applyIntent / step / the real phases), so a rule removed from
// structureRules.ts, heliRules.ts, heliPhase.ts, tech.ts or structureEffects.ts fails here. The mutants are tabulated in the M18e-1 block of docs/DECISIONS.md.
import { describe, expect, it } from 'vitest';
import { HELI_BUILD_TICKS_MIN, fleetCapOf, heliBuildTicksOf } from '../../src/sim/heliRules';
import {
  REJECT_BUILD_GOLD,
  REJECT_BUILD_MAX_COUNT,
  REJECT_BUILD_MOUNTAIN,
  REJECT_BUILD_NOT_OWNED,
  REJECT_BUILD_NO_NEIGHBOUR,
  REJECT_BUILD_SPACING,
  REJECT_BUILD_TYPE,
  REJECT_DELETE_COOLDOWN,
  REJECT_NONE,
  REJECT_STRUCT_BUSY,
  REJECT_TECH_GOLD,
  withId,
} from '../../src/sim/intents';
import {
  AIRFIELD_HELI_TIME_MAX_PCT,
  BUILD_BASE_GOLD,
  BUILD_TICKS,
  HELI_BUILD_TICKS,
  HELI_FLEET_AIRFIELD_MAX,
  HELI_FLEET_BASE,
  LAB_RESEARCH_MAX_PCT,
  MAX_PER_OWNER_BY_TYPE,
  MILLI_GOLD_PER_GOLD,
  PLANT_GOLD_EXTRA_MILLI,
  PLANT_GOLD_MILLI_BASE,
  PLANT_NEAR_CELLS,
  STRUCT_LEVEL_HARD_CAP,
  STRUCT_TYPE_COUNT,
  TECH_TICKS,
} from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { applyIntent, step } from '../../src/sim/step';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { structGoldMilliPerSec } from '../../src/sim/structureEffects';
import { structureCellChanged } from '../../src/sim/structures';
import {
  STRUCT_AIRFIELD,
  STRUCT_CITY,
  STRUCT_FACTORY,
  STRUCT_LAB,
  STRUCT_PLANT,
  STRUCT_PORT,
  STRUCT_POST,
  STRUCT_SAM,
  STRUCT_SILO,
  STRUCT_TYPE_SLOTS,
  airfieldFleetBonusOfLevels,
  airfieldTimePctOfLevels,
  cityGoldMilli,
  labResearchPctOfLevels,
  plantGoldMilli,
  upgradePriceGold,
  validateBuild,
} from '../../src/sim/structureRules';
import { StateView } from '../../src/sim/view';
import { CLASS_DEEP_SEA, CLASS_MOUNTAIN, CLASS_PLAINS } from '../../src/sim/terrain';

const W = 128;
const H = 64;
const at = (x: number, y: number): number => y * W + x;
const GOLD = 1000000;
const G = MILLI_GOLD_PER_GOLD;

/** Plains owned by seat 0 (ownerId 1) except a small block of seat 1 (ownerId 2) around (100..110, 40). */
function world(): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  terrain[at(50, 10)] = CLASS_MOUNTAIN;
  terrain[at(21, 50)] = CLASS_DEEP_SEA; // (20, 50) is a coast cell for the Port
  const s = createState({ width: W, height: H, seed: 3, seats: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) s.owner[c] = 1;
  for (let y = 38; y < 43; y++) for (let x = 100; x < 111; x++) s.owner[at(x, y)] = 2;
  rebuildAggregates(s);
  s.gold[1] = GOLD * G;
  s.gold[2] = GOLD * G;
  return s;
}

let nextId = 0;
const build = (s: GameState, type: number, cell: number, seat = 0): number => applyIntent(s, withId({ kind: 'Build', seat, type, cell }, nextId++));
const upgrade = (s: GameState, id: number, seat = 0): number => applyIntent(s, withId({ kind: 'Upgrade', seat, structure: id }, nextId++));
function idle(s: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
}
function mustBuild(s: GameState, type: number, cell: number, seat = 0): number {
  expect(build(s, type, cell, seat)).toBe(REJECT_NONE);
  return s.structures.idAt(cell);
}
/** Builds and lets it finish. */
function builtAndReady(s: GameState, type: number, cell: number): number {
  const id = mustBuild(s, type, cell);
  idle(s, BUILD_TICKS[type] as number);
  expect(s.tick).toBeGreaterThanOrEqual(s.structures.readyTick[id] as number);
  return id;
}
/** Sets a finished structure to a level directly (the upgrade path is tested on its own). */
function setLevel(s: GameState, id: number, level: number): void {
  s.structures.level[id] = level;
  s.structures.effDirty = true;
  s.structures.version++;
}

describe('the tables: three new types with their numbers', () => {
  it('the per-type arrays have one entry per type number and the limits sit on the new types only', () => {
    expect(STRUCT_TYPE_SLOTS).toBe(10);
    expect(STRUCT_TYPE_COUNT).toBe(STRUCT_TYPE_SLOTS - 1);
    expect(BUILD_BASE_GOLD.length).toBe(STRUCT_TYPE_SLOTS);
    expect(BUILD_TICKS.length).toBe(STRUCT_TYPE_SLOTS);
    expect(MAX_PER_OWNER_BY_TYPE.length).toBe(STRUCT_TYPE_SLOTS);
    expect([STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT]).toEqual([7, 8, 9]);
    expect(MAX_PER_OWNER_BY_TYPE.slice(1, 7)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(MAX_PER_OWNER_BY_TYPE.slice(7)).toEqual([3, 3, 6]);
  });
});

describe('Build, Upgrade and Delete of the new types', () => {
  it('Airfield: refused on a Mountain (REJECT_BUILD_MOUNTAIN), built on plains, upgraded for base * level and deleted', () => {
    const s = world();
    expect(build(s, STRUCT_AIRFIELD, at(50, 10))).toBe(REJECT_BUILD_MOUNTAIN);
    const id = mustBuild(s, STRUCT_AIRFIELD, at(20, 20));
    expect(s.gold[1]).toBe((GOLD - (BUILD_BASE_GOLD[STRUCT_AIRFIELD] as number)) * G);
    expect(upgrade(s, id)).toBe(REJECT_STRUCT_BUSY); // still being built
    idle(s, BUILD_TICKS[STRUCT_AIRFIELD] as number);
    const before = s.gold[1] as number;
    expect(upgrade(s, id)).toBe(REJECT_NONE);
    expect(before - (s.gold[1] as number)).toBe(upgradePriceGold(STRUCT_AIRFIELD, 2) * G);
    expect(upgradePriceGold(STRUCT_AIRFIELD, 2)).toBe(2 * (BUILD_BASE_GOLD[STRUCT_AIRFIELD] as number));
    idle(s, (BUILD_TICKS[STRUCT_AIRFIELD] as number) + 1);
    expect(s.structures.level[id]).toBe(2);
    expect(applyIntent(s, withId({ kind: 'Delete', seat: 0, structure: id }, nextId++))).toBe(REJECT_NONE);
    expect(s.structures.ownedCount(1, STRUCT_AIRFIELD)).toBe(0);
    const id2 = mustBuild(s, STRUCT_AIRFIELD, at(60, 20));
    expect(applyIntent(s, withId({ kind: 'Delete', seat: 0, structure: id2 }, nextId++))).toBe(REJECT_DELETE_COOLDOWN);
  });

  it('Lab: needs owned land (REJECT_BUILD_NOT_OWNED on a cell of the other seat, in sight of the same call for the owner), its spacing is 4 and its price base 600', () => {
    const s = world();
    expect(build(s, STRUCT_LAB, at(104, 40))).toBe(REJECT_BUILD_NOT_OWNED);
    mustBuild(s, STRUCT_LAB, at(20, 20));
    expect(build(s, STRUCT_LAB, at(23, 20))).toBe(REJECT_BUILD_SPACING); // 3 cells < 4
    expect(build(s, STRUCT_LAB, at(24, 20))).toBe(REJECT_NONE);
    expect(BUILD_BASE_GOLD[STRUCT_LAB]).toBe(600);
  });

  it('REJECT_BUILD_MAX_COUNT: the 4th Airfield, the 4th Lab and the 7th Plant are refused, the 3rd / 3rd / 6th are not, and an unfinished one counts', () => {
    const s = world();
    for (let i = 0; i < 3; i++) mustBuild(s, STRUCT_AIRFIELD, at(10 + 10 * i, 20));
    expect(build(s, STRUCT_AIRFIELD, at(60, 20))).toBe(REJECT_BUILD_MAX_COUNT);
    for (let i = 0; i < 3; i++) mustBuild(s, STRUCT_LAB, at(10 + 10 * i, 30));
    expect(build(s, STRUCT_LAB, at(60, 30))).toBe(REJECT_BUILD_MAX_COUNT);
    mustBuild(s, STRUCT_CITY, at(60, 50));
    const plantCells = [at(57, 50), at(63, 50), at(60, 47), at(60, 53), at(54, 50), at(66, 50)];
    for (const c of plantCells) mustBuild(s, STRUCT_PLANT, c);
    expect(build(s, STRUCT_PLANT, at(60, 44))).toBe(REJECT_BUILD_MAX_COUNT);
    // another owner's structures do not count against this seat
    mustBuild(s, STRUCT_LAB, at(104, 40), 1);
  });

  it('REJECT_BUILD_NO_NEIGHBOUR: a Plant needs a City or a Port of its own owner within PLANT_NEAR_CELLS (8), the edge included; a Factory or a stranger\'s City does not count', () => {
    const s = world();
    expect(PLANT_NEAR_CELLS).toBe(8);
    expect(build(s, STRUCT_PLANT, at(30, 30))).toBe(REJECT_BUILD_NO_NEIGHBOUR); // nothing at all
    mustBuild(s, STRUCT_FACTORY, at(30, 31));
    expect(build(s, STRUCT_PLANT, at(30, 30))).toBe(REJECT_BUILD_NO_NEIGHBOUR); // a Factory is not enough
    mustBuild(s, STRUCT_CITY, at(100, 40), 1); // seat 1's City
    expect(build(s, STRUCT_PLANT, at(102, 41))).toBe(REJECT_BUILD_NOT_OWNED); // not seat 0's land
    mustBuild(s, STRUCT_CITY, at(60, 10));
    expect(build(s, STRUCT_PLANT, at(69, 10))).toBe(REJECT_BUILD_NO_NEIGHBOUR); // 9 cells
    expect(build(s, STRUCT_PLANT, at(68, 10))).toBe(REJECT_NONE); // exactly 8
    mustBuild(s, STRUCT_PORT, at(20, 50));
    expect(build(s, STRUCT_PLANT, at(20, 58))).toBe(REJECT_NONE); // a Port counts, 8 cells
    expect(build(s, STRUCT_PLANT, at(29, 50))).toBe(REJECT_BUILD_NO_NEIGHBOUR); // 9 cells
    // a stranger's City: seat 0 owns land next to seat 1's City, still no neighbour (seat 0 has no City there)
    const v = new StateView(s) as unknown as Parameters<typeof validateBuild>[0];
    expect(validateBuild(v, 0, STRUCT_PLANT, at(98, 40))).toBe(REJECT_BUILD_NO_NEIGHBOUR);
  });

  it('the type after the last one (10) is REJECT_BUILD_TYPE', () => {
    const s = world();
    expect(build(s, 10, at(20, 20))).toBe(REJECT_BUILD_TYPE);
  });

  it('a Plant costs base 250 and the purse is checked (REJECT_BUILD_GOLD), the price escalates like the others', () => {
    const s = world();
    mustBuild(s, STRUCT_CITY, at(60, 10));
    s.gold[1] = 249 * G;
    expect(build(s, STRUCT_PLANT, at(62, 10))).toBe(REJECT_BUILD_GOLD);
    s.gold[1] = 250 * G;
    expect(build(s, STRUCT_PLANT, at(62, 10))).toBe(REJECT_NONE);
    expect(s.gold[1]).toBe(0);
    s.gold[1] = GOLD * G;
    const before = s.gold[1] as number;
    mustBuild(s, STRUCT_PLANT, at(66, 10));
    expect(before - (s.gold[1] as number)).toBe(375 * G); // the second costs x1.5
  });
});

describe('Airfield: the fleet cap and the helicopter production time with exact numbers', () => {
  it('the fleet cap is HELI_FLEET_BASE without an Airfield, +1 per level when it is FINISHED, and capped at +HELI_FLEET_AIRFIELD_MAX in all', () => {
    const s = world();
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_BASE);
    const a = mustBuild(s, STRUCT_AIRFIELD, at(20, 20));
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_BASE); // under construction: nothing
    idle(s, BUILD_TICKS[STRUCT_AIRFIELD] as number);
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_BASE + 1);
    setLevel(s, a, 3);
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_BASE + 3);
    const b = builtAndReady(s, STRUCT_AIRFIELD, at(40, 20));
    setLevel(s, b, 4);
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_BASE + 6); // 3 + 4 = 7 levels, capped at 6
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_BASE + HELI_FLEET_AIRFIELD_MAX);
    setLevel(s, b, 400);
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_BASE + HELI_FLEET_AIRFIELD_MAX);
    expect(fleetCapOf(s, 1)).toBe(HELI_FLEET_BASE); // the other seat has none
  });

  it('with a Factory: factory levels (capped at HELI_FLEET_MAX 12) plus the Airfield bonus on top', () => {
    const s = world();
    const f = builtAndReady(s, STRUCT_FACTORY, at(10, 10));
    setLevel(s, f, 50);
    expect(fleetCapOf(s, 0)).toBe(12);
    const a = builtAndReady(s, STRUCT_AIRFIELD, at(30, 10));
    setLevel(s, a, 2);
    expect(fleetCapOf(s, 0)).toBe(14);
  });

  it('the pure level functions give the same numbers (UI reads them)', () => {
    expect([0, 1, 5, 6, 7, 100].map(airfieldFleetBonusOfLevels)).toEqual([0, 1, 5, 6, 6, 6]);
    expect([0, 1, 2, 8, 9, 500].map(airfieldTimePctOfLevels)).toEqual([0, 5, 10, 40, 40, 40]);
    expect([0, 1, 2, 8, 9, 500].map(labResearchPctOfLevels)).toEqual([0, 5, 10, 40, 40, 40]);
  });

  it('ProduceHeli takes HELI_BUILD_TICKS (120) without an Airfield, 114 with a finished level 1, 108 with level 2, 72 at the cap of 40 percent, and an unfinished Airfield gives nothing', () => {
    const s = world();
    const f = builtAndReady(s, STRUCT_FACTORY, at(10, 10));
    const produce = (): number => {
      const t0 = s.tick;
      expect(applyIntent(s, withId({ kind: 'ProduceHeli', seat: 0, factory: f }, nextId++))).toBe(REJECT_NONE);
      const h = s.helis.highWater - 1;
      const dt = (s.helis.readyTick[h] as number) - t0;
      s.helis.remove(h); // free the queue for the next measurement
      return dt;
    };
    expect(produce()).toBe(HELI_BUILD_TICKS);
    const a = mustBuild(s, STRUCT_AIRFIELD, at(30, 10));
    expect(produce()).toBe(HELI_BUILD_TICKS); // not finished
    idle(s, BUILD_TICKS[STRUCT_AIRFIELD] as number);
    expect(produce()).toBe(114);
    expect(heliBuildTicksOf(s, 0)).toBe(114);
    setLevel(s, a, 2);
    expect(produce()).toBe(108);
    setLevel(s, a, 8);
    expect(produce()).toBe(HELI_BUILD_TICKS - Math.floor((HELI_BUILD_TICKS * AIRFIELD_HELI_TIME_MAX_PCT) / 100));
    expect(produce()).toBe(72);
    setLevel(s, a, 900);
    expect(produce()).toBe(72);
  });

  it('a helicopter queued with the shortened time is finished exactly at its ready tick, and a saved state with it comes back equal', () => {
    const s = world();
    const f = builtAndReady(s, STRUCT_FACTORY, at(10, 10));
    const a = builtAndReady(s, STRUCT_AIRFIELD, at(30, 10));
    setLevel(s, a, 2);
    expect(applyIntent(s, withId({ kind: 'ProduceHeli', seat: 0, factory: f }, nextId++))).toBe(REJECT_NONE);
    const t0 = s.tick;
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(s));
    idle(s, 107);
    expect(s.helis.state[0]).not.toBe(2 /* HELI_PAD */);
    idle(s, 1);
    expect(s.tick).toBe(t0 + 108);
    idle(s, 1);
    // the helicopter is a pad helicopter by now (the production phase has run)
    expect(s.helis.readyTick[0]).toBe(t0 + 108);
    expect(s.helis.state[0]).not.toBe(1 /* HELI_BUILDING */);
  });
});

describe('a saved queued helicopter: the production time must be one the rules can set', () => {
  it('readyTick - stateTick below HELI_BUILD_TICKS_MIN or above HELI_BUILD_TICKS is refused (air-range), the two edges are accepted', () => {
    const forged = (delta: number): string => {
      const s = world();
      const f = builtAndReady(s, STRUCT_FACTORY, at(10, 10));
      expect(applyIntent(s, withId({ kind: 'ProduceHeli', seat: 0, factory: f }, nextId++))).toBe(REJECT_NONE);
      s.helis.readyTick[0] = (s.helis.stateTick[0] as number) + delta;
      const r = deserialize(serialize(s));
      return r.ok ? 'ok' : r.error;
    };
    expect(forged(HELI_BUILD_TICKS)).toBe('ok');
    expect(forged(HELI_BUILD_TICKS_MIN)).toBe('ok');
    expect(forged(HELI_BUILD_TICKS_MIN - 1)).toBe('air-range');
    expect(forged(HELI_BUILD_TICKS + 1)).toBe('air-range');
  });
});

describe('Lab: the research time, tick exact', () => {
  /** Researches tech 0 (600 ticks) and returns after how many steps the tech was researched. */
  function stepsToResearch(s: GameState): number {
    const t0 = s.tick;
    s.gold[1] = GOLD * G;
    step(s, { turn: s.tick, intents: [withId({ kind: 'Research', seat: 0, tech: 0 }, nextId++)] });
    while ((s.match.techMask[1] as number) === 0) {
      expect(s.tick - t0).toBeLessThan(2000);
      step(s, { turn: s.tick, intents: [] });
    }
    return s.tick - t0;
  }

  it('without a Lab it is TECH_TICKS[0] steps, with a finished level 1 Lab 5 percent less (570), level 2 540, an unfinished Lab 600, the cap 40 percent (360)', () => {
    expect(TECH_TICKS[0]).toBe(600);
    expect(stepsToResearch(world())).toBe(600);
    const s1 = world();
    builtAndReady(s1, STRUCT_LAB, at(20, 20));
    expect(stepsToResearch(s1)).toBe(570);
    const s2 = world();
    setLevel(s2, builtAndReady(s2, STRUCT_LAB, at(20, 20)), 2);
    expect(stepsToResearch(s2)).toBe(540);
    const s3 = world();
    mustBuild(s3, STRUCT_LAB, at(20, 20)); // still under construction when the research starts
    expect(stepsToResearch(s3)).toBe(600);
    const s4 = world();
    setLevel(s4, builtAndReady(s4, STRUCT_LAB, at(20, 20)), 500);
    expect(stepsToResearch(s4)).toBe(600 - Math.floor((600 * LAB_RESEARCH_MAX_PCT) / 100));
    expect(stepsToResearch(world())).not.toBe(360);
  });

  it('Labs stack: two finished level 1 Labs give 10 percent (540); the time is fixed when the research STARTS (a Lab finished later does not shorten it)', () => {
    const s = world();
    builtAndReady(s, STRUCT_LAB, at(20, 20));
    builtAndReady(s, STRUCT_LAB, at(40, 20));
    expect(stepsToResearch(s)).toBe(540);
    const t = world();
    step(t, { turn: t.tick, intents: [withId({ kind: 'Research', seat: 0, tech: 0 }, nextId++)] });
    const lab = mustBuild(t, STRUCT_LAB, at(20, 20));
    idle(t, 400);
    expect(t.structures.readyTick[lab]).toBeLessThan(t.tick);
    idle(t, 198);
    expect(t.match.techMask[1]).toBe(0);
    idle(t, 1);
    expect(t.match.techMask[1]).toBe(1);
  });

  it('the Research price is unchanged by a Lab (REJECT_TECH_GOLD at one gold short) and the other seat\'s Lab does not help this seat', () => {
    const s = world();
    builtAndReady(s, STRUCT_LAB, at(20, 20));
    s.gold[2] = 10 * G;
    expect(applyIntent(s, withId({ kind: 'Research', seat: 1, tech: 0 }, nextId++))).toBe(REJECT_TECH_GOLD);
    s.gold[2] = GOLD * G;
    step(s, { turn: s.tick, intents: [withId({ kind: 'Research', seat: 1, tech: 0 }, nextId++)] });
    expect((s.match.techDone[2] as number) - (s.tick - 1)).toBe(600);
  });
});

describe('Plant: gold per second, the caps and the payback', () => {
  it('a finished Plant pays 0.8 gold/s at level 1, 1.0 at level 2, nothing while unfinished; the other types are unchanged', () => {
    const s = world();
    expect(structGoldMilliPerSec(s, 1)).toBe(0);
    mustBuild(s, STRUCT_CITY, at(60, 10));
    const plant = mustBuild(s, STRUCT_PLANT, at(62, 10));
    idle(s, BUILD_TICKS[STRUCT_CITY] as number);
    expect(s.tick).toBeGreaterThanOrEqual(s.structures.readyTick[plant] as number);
    expect(structGoldMilliPerSec(s, 1)).toBe(cityGoldMilli(1) + PLANT_GOLD_MILLI_BASE);
    expect(PLANT_GOLD_MILLI_BASE).toBe(800);
    setLevel(s, plant, 2);
    expect(structGoldMilliPerSec(s, 1)).toBe(cityGoldMilli(1) + 1000);
    expect(structGoldMilliPerSec(s, 2)).toBe(0);
    const t = world();
    mustBuild(t, STRUCT_CITY, at(60, 10));
    mustBuild(t, STRUCT_PLANT, at(62, 10));
    idle(t, BUILD_TICKS[STRUCT_PLANT] as number - 1); // the City (150) and the Plant (100): after 99 ticks neither is finished
    expect(structGoldMilliPerSec(t, 1)).toBe(0);
  });

  it('the economy techs\' gold percent applies to the Plant like to a City (5 percent of 800 = 40)', () => {
    const s = world();
    mustBuild(s, STRUCT_CITY, at(60, 10));
    mustBuild(s, STRUCT_PLANT, at(62, 10));
    idle(s, BUILD_TICKS[STRUCT_CITY] as number);
    const base = structGoldMilliPerSec(s, 1);
    s.match.setTechMask(1, 1); // ECONOMY step 1: +5 percent gold
    s.structures.effDirty = true;
    expect(structGoldMilliPerSec(s, 1) - base).toBe(Math.floor((cityGoldMilli(1) * 5) / 100) + 40);
  });

  it('the global limits hold: one Plant never pays 15 gold/s (the asymptote is 1.6), six Plants at the top level stay far below ten level-1 Cities, and the payback is not shorter than a City\'s', () => {
    expect(plantGoldMilli(1)).toBe(PLANT_GOLD_MILLI_BASE);
    expect(plantGoldMilli(STRUCT_LEVEL_HARD_CAP)).toBeLessThan(PLANT_GOLD_MILLI_BASE + PLANT_GOLD_EXTRA_MILLI);
    expect(plantGoldMilli(STRUCT_LEVEL_HARD_CAP)).toBeGreaterThan(PLANT_GOLD_MILLI_BASE + PLANT_GOLD_EXTRA_MILLI - 10);
    expect(plantGoldMilli(STRUCT_LEVEL_HARD_CAP)).toBeLessThan(15000);
    expect(6 * plantGoldMilli(STRUCT_LEVEL_HARD_CAP)).toBeLessThan(10 * cityGoldMilli(1));
    // payback in seconds of the first one: price * 1000 / milli-gold per second
    const plantPayback = ((BUILD_BASE_GOLD[STRUCT_PLANT] as number) * 1000) / PLANT_GOLD_MILLI_BASE;
    const cityPayback = ((BUILD_BASE_GOLD[STRUCT_CITY] as number) * 1000) / cityGoldMilli(1);
    expect(plantPayback).toBeGreaterThanOrEqual(cityPayback);
    expect(plantPayback).toBeLessThan(cityPayback * 1.5);
    // the upgrade (base * 2 = 500 gold for the first extra 200 milli) pays back slower than the build
    const upPayback = (upgradePriceGold(STRUCT_PLANT, 2) * 1000) / (plantGoldMilli(2) - plantGoldMilli(1));
    expect(upPayback).toBeGreaterThan(plantPayback);
  });
});

describe('conquest, state and replay with all nine types', () => {
  it('a conquered Airfield, Lab or Plant is destroyed (like Silo, SAM and Post), not handed over', () => {
    const s = world();
    mustBuild(s, STRUCT_CITY, at(60, 10));
    const ids = [mustBuild(s, STRUCT_AIRFIELD, at(20, 20)), mustBuild(s, STRUCT_LAB, at(30, 20)), mustBuild(s, STRUCT_PLANT, at(62, 10))];
    for (const id of ids) {
      const cell = s.structures.cell[id] as number;
      structureCellChanged(s, cell, 2);
      expect(s.structures.owner[id]).toBe(0);
      expect(s.structures.idAt(cell)).toBe(-1);
    }
  });

  /** One list of turns that builds every type, upgrades two, produces a helicopter and researches (seat 0). */
  function script(): Array<Parameters<typeof withId>[0][]> {
    const n = 900;
    const turns: Array<Parameters<typeof withId>[0][]> = Array.from({ length: n }, () => []);
    turns[0] = [
      { kind: 'Build', seat: 0, type: STRUCT_CITY, cell: at(60, 10) },
      { kind: 'Build', seat: 0, type: STRUCT_FACTORY, cell: at(10, 10) },
      { kind: 'Build', seat: 0, type: STRUCT_PORT, cell: at(20, 50) },
      { kind: 'Build', seat: 0, type: STRUCT_SAM, cell: at(30, 30) },
      { kind: 'Build', seat: 0, type: STRUCT_POST, cell: at(40, 30) },
      { kind: 'Build', seat: 0, type: STRUCT_AIRFIELD, cell: at(80, 20) },
      { kind: 'Build', seat: 0, type: STRUCT_LAB, cell: at(90, 20) },
      { kind: 'Build', seat: 0, type: STRUCT_PLANT, cell: at(62, 10) },
    ];
    turns[210] = [
      { kind: 'Build', seat: 0, type: STRUCT_SILO, cell: at(100, 5) },
      { kind: 'ProduceHeli', seat: 0, factory: 1 },
      { kind: 'Research', seat: 0, tech: 0 },
    ];
    turns[230] = [
      { kind: 'Upgrade', seat: 0, structure: 5 },
      { kind: 'Upgrade', seat: 0, structure: 6 },
    ];
    return turns;
  }
  function run(stopAt: number, s: GameState = world(), from = 0): { s: GameState; trace: number[] } {
    const trace: number[] = [];
    const turns = script();
    for (let t = from; t < stopAt; t++) {
      step(s, { turn: s.tick, intents: turns[t]!.map((b) => withId(b, 1000 + t * 10 + turns[t]!.indexOf(b))) });
      trace.push(hashState(s));
    }
    return { s, trace };
  }

  it('a replay with all nine types gives the same hash twice, really contains all nine types, and a mid-way serialize / restore does not change the end hash', () => {
    const a = run(900);
    const b = run(900);
    expect(a.trace).toEqual(b.trace);
    expect(a.s.rejects, "every intent of the script is legal").toBe(0);
    for (let type = 1; type < STRUCT_TYPE_SLOTS; type++) expect(a.s.structures.ownedCount(1, type), `type ${type}`).toBe(1);
    expect(a.s.helis.liveCount).toBe(1);
    expect(a.s.match.techMask[1]).toBe(1);
    const half = run(450);
    const r = deserialize(serialize(half.s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(half.s));
    const rest = run(900, r.state, 450);
    expect(rest.trace[rest.trace.length - 1]).toBe(a.trace[a.trace.length - 1]);
    expect(rest.trace).toEqual(a.trace.slice(450));
  });

  it('serialize guards: a saved structure of type 10, or a level above STRUCT_LEVEL_HARD_CAP, is refused as structure-range; types 7 to 9 at the cap are accepted', () => {
    const s = world();
    const id = mustBuild(s, STRUCT_LAB, at(20, 20));
    setLevel(s, id, STRUCT_LEVEL_HARD_CAP);
    const ok = deserialize(serialize(s));
    expect(ok.ok).toBe(true);
    for (const [field, tamper] of [
      ['type 10', (): void => { s.structures.type[id] = 10; }],
      ['level above the cap', (): void => { s.structures.level[id] = STRUCT_LEVEL_HARD_CAP + 1; }],
    ] as const) {
      const t = world();
      const tid = mustBuild(t, STRUCT_LAB, at(20, 20));
      const keep = s.structures.type[id] as number;
      void keep;
      s.structures.type[id] = STRUCT_LAB;
      s.structures.level[id] = STRUCT_LEVEL_HARD_CAP;
      tamper();
      const r = deserialize(serialize(s));
      expect(r.ok, field).toBe(false);
      if (!r.ok) expect(r.error, field).toBe('structure-range');
      void tid;
    }
  });
});

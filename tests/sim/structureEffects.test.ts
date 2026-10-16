// M09 part B: the effects of finished structures (City, Factory, Port and trade, Defense Post) and the conquest of structures.
// Every test drives the real economy / conquest path, so removing a rule fails here.
import { describe, expect, it } from 'vitest';
import { applyAttack } from '../../src/sim/conquest';
import { ownerCapQt } from '../../src/sim/economy';
import { createState, type GameState } from '../../src/sim/state';
import { setOwnerRules } from '../../src/sim/homeRules';
import {
  QT_PER_TROOP,
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  ENCLAVE_FLIP_TICKS,
  FACTORY_GOLD_MILLI_PER_SEC,
  PORT_GOLD_MILLI_PER_SEC,
  TICK_HZ,
  TRADE_BASE_MILLI,
} from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { step } from '../../src/sim/step';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST, STRUCT_SAM, STRUCT_SILO, cityGoldMilli, cityTroopCap } from '../../src/sim/structureRules';
import {
  applyPortTrait,
  collectPosts,
  dist2Cells,
  postAdjustedCost,
  samRadiusCells,
  structGoldMilliPerSec,
  tradeMilliPerSec,
} from '../../src/sim/structureEffects';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { landState } from './helpers/worlds';

const W = 1024;
const H = 8;
const at = (x: number, y = 4): number => y * W + x;

/** A wide strip of plains in which each seat owns one cell (so its economy runs), at the cells in `homes`. */
function strip(seats: number): GameState {
  const s = createState({ width: W, height: H, seed: 5, seats, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
  for (let o = 1; o <= seats; o++) setOwner(s, at(o), o, 0);
  s.tick = 5000; // structures added at tick 0 are finished
  return s;
}
const addDone = (s: GameState, type: number, owner: number, cell: number, level = 1): number => {
  const id = s.structures.add(type, owner, cell, 0);
  s.structures.level[id] = level;
  return id;
};

describe('trade income', () => {
  it('follows 1.5 * (1 + min(d, 120) / 100) gold/s per Port of a pair; 500 cells is worth exactly what 120 is; half for one owner; zero under embargo', () => {
    expect(tradeMilliPerSec(40, false, false)).toBe(2100);
    expect(tradeMilliPerSec(120, false, false)).toBe(3300);
    expect(tradeMilliPerSec(500, false, false)).toBe(tradeMilliPerSec(120, false, false));
    expect(tradeMilliPerSec(121, false, false)).toBe(3300);
    expect(tradeMilliPerSec(80, true, false)).toBe(tradeMilliPerSec(80, false, false) / 2);
    expect(tradeMilliPerSec(80, false, true)).toBe(0);
    expect(tradeMilliPerSec(80, true, true)).toBe(0);
    expect((TRADE_BASE_MILLI * 220) / 100).toBe(3300);
  });

  /** Gold gained by an owner over 100 ticks of the real economy, minus what its land alone gives (the same state without structures). */
  function gain(build: (s: GameState) => void): number {
    const withS = strip(3);
    build(withS);
    const plain = strip(3);
    const a = withS.gold[1] as number;
    const b = plain.gold[1] as number;
    for (let i = 0; i < 100; i++) {
      step(withS, { turn: withS.tick, intents: [] });
      step(plain, { turn: plain.tick, intents: [] });
    }
    return (withS.gold[1] as number) - a - ((plain.gold[1] as number) - b);
  }
  const PER_100_TICKS = 100 / TICK_HZ; // seconds

  it('two Ports of different owners: the gold that arrives matches the formula within 1 percent', () => {
    for (const d of [60, 100, 300]) {
      const got = gain((s) => {
        addDone(s, STRUCT_PORT, 1, at(100));
        addDone(s, STRUCT_PORT, 2, at(100 + d));
      });
      const want = (PORT_GOLD_MILLI_PER_SEC + tradeMilliPerSec(d, false, false)) * PER_100_TICKS;
      expect(Math.abs(got - want) / want, `d=${d}: got ${got}, want ${want}`).toBeLessThan(0.01);
    }
  });

  it('500 cells pay the same as 120; the same owner gets half of the trade; an embargo takes it all away', () => {
    const far = gain((s) => {
      addDone(s, STRUCT_PORT, 1, at(100));
      addDone(s, STRUCT_PORT, 2, at(600));
    });
    const cap = gain((s) => {
      addDone(s, STRUCT_PORT, 1, at(100));
      addDone(s, STRUCT_PORT, 2, at(220));
    });
    expect(far).toBe(cap);
    const own = gain((s) => {
      addDone(s, STRUCT_PORT, 1, at(100));
      addDone(s, STRUCT_PORT, 1, at(220));
    });
    // Two Ports of one owner: each earns the base and half of the trade.
    expect(own).toBe(2 * (PORT_GOLD_MILLI_PER_SEC + tradeMilliPerSec(120, true, false)) * PER_100_TICKS);
    const embargoed = gain((s) => {
      addDone(s, STRUCT_PORT, 1, at(100));
      addDone(s, STRUCT_PORT, 2, at(220));
      s.structures.setEmbargo(1, 2, true);
    });
    expect(embargoed).toBe(PORT_GOLD_MILLI_PER_SEC * PER_100_TICKS);
  });

  it('a partner closer than 40 cells does not trade; an unfinished Port does not either; only the 3 nearest partners count', () => {
    const s = strip(4);
    addDone(s, STRUCT_PORT, 1, at(100));
    addDone(s, STRUCT_PORT, 2, at(130)); // 30 cells: too close
    expect(structGoldMilliPerSec(s, 1)).toBe(PORT_GOLD_MILLI_PER_SEC);
    s.structures.add(STRUCT_PORT, 3, at(300), s.tick); // still being built
    expect(structGoldMilliPerSec(s, 1)).toBe(PORT_GOLD_MILLI_PER_SEC);
    for (const x of [200, 400, 500, 600]) addDone(s, STRUCT_PORT, 4, at(x));
    // Nearest three are 100, 300 and 400 cells away.
    expect(structGoldMilliPerSec(s, 1)).toBe(PORT_GOLD_MILLI_PER_SEC + tradeMilliPerSec(100, false, false) + tradeMilliPerSec(300, false, false) + tradeMilliPerSec(400, false, false));
  });

  it('the trait multiplier gives +10 percent and is clamped at +-10 percent', () => {
    const rich = (milli: number): number => {
      const s = createState({
        width: W,
        height: H,
        seed: 5,
        seats: 3,
        config: { homeRules: true },
        countryMap: new Uint8Array(W * H),
        terrain: new Uint8Array(W * H).fill(CLASS_PLAINS),
        elevation: new Uint16Array(W * H),
      });
      for (let o = 1; o <= 3; o++) setOwner(s, at(o), o, 0);
      s.tick = 5000;
      addDone(s, STRUCT_PORT, 1, at(100));
      addDone(s, STRUCT_PORT, 2, at(400));
      setOwnerRules(s.home as NonNullable<GameState['home']>, 1, { homeLand: 0, portMilli: milli, defenceMilli: 1000 });
      return structGoldMilliPerSec(s, 1);
    };
    const base = rich(1000);
    expect(base).toBe(PORT_GOLD_MILLI_PER_SEC + 3300);
    expect(rich(1100)).toBe(Math.floor((base * 1100) / 1000));
    expect(rich(1100) / base).toBeCloseTo(1.1, 3);
    expect(rich(1500)).toBe(rich(1100)); // clamped
    expect(rich(100)).toBe(rich(900));
    expect(applyPortTrait(1000, 1100)).toBe(1100);
  });
});

describe('income per structure', () => {
  it('no structure gives more than 10 City-levels-1 (15 gold/s): the worst Port (3 partners at 120+ cells, different owners) is at most 13 gold/s, 15 with +10 percent', () => {
    const s = strip(4);
    for (const [o, x] of [[1, 100], [2, 300], [3, 500], [4, 700]] as const) addDone(s, STRUCT_PORT, o, at(x));
    const worst = structGoldMilliPerSec(s, 1);
    expect(worst).toBe(PORT_GOLD_MILLI_PER_SEC + 3 * 3300);
    expect(worst).toBeLessThanOrEqual(13000);
    expect(applyPortTrait(worst, 1100)).toBeLessThanOrEqual(15000);
    expect(15000).toBe(10 * CITY_GOLD_MILLI_PER_SEC_PER_LEVEL);
    // A level 3 City with a Factory beside it is the other big one.
    const c = strip(2);
    addDone(c, STRUCT_CITY, 1, at(100), 3);
    addDone(c, STRUCT_FACTORY, 1, at(110));
    expect(structGoldMilliPerSec(c, 1)).toBeLessThanOrEqual(15000);
  });

  it('a finished City pays 1.5 gold/s at level 1 plus 0.5 per level and lifts the troop cap by 800 troops plus 250 per level; an unfinished one does nothing', () => {
    const s = strip(2);
    const cap0 = ownerCapQt(s, 1);
    const id = addDone(s, STRUCT_CITY, 1, at(100), 2);
    expect(structGoldMilliPerSec(s, 1)).toBe(cityGoldMilli(2));
    expect(ownerCapQt(s, 1) - cap0).toBe(cityTroopCap(2) * QT_PER_TROOP);
    s.structures.readyTick[id] = s.tick + 50; // not finished
    s.structures.effDirty = true;
    expect(structGoldMilliPerSec(s, 1)).toBe(0);
    expect(ownerCapQt(s, 1)).toBe(cap0);
    for (let i = 0; i < 50; i++) step(s, { turn: s.tick, intents: [] });
    expect(structGoldMilliPerSec(s, 1)).toBe(cityGoldMilli(2)); // finished by itself, with no change of the table
  });

  it('a Factory pays 2 gold/s and adds 25 percent to the Cities within 20 cells, once however many Factories', () => {
    const s = strip(2);
    addDone(s, STRUCT_CITY, 1, at(100));
    addDone(s, STRUCT_FACTORY, 1, at(130)); // 30 cells away: no bonus
    expect(structGoldMilliPerSec(s, 1)).toBe(CITY_GOLD_MILLI_PER_SEC_PER_LEVEL + FACTORY_GOLD_MILLI_PER_SEC);
    addDone(s, STRUCT_FACTORY, 1, at(115));
    addDone(s, STRUCT_FACTORY, 1, at(85));
    expect(structGoldMilliPerSec(s, 1)).toBe(Math.floor((CITY_GOLD_MILLI_PER_SEC_PER_LEVEL * 125) / 100) + 3 * FACTORY_GOLD_MILLI_PER_SEC);
  });

  it('the SAM radius grows with the level and is 20 percent longer on a Mountain', () => {
    expect([1, 2, 3].map((l) => samRadiusCells(l, false))).toEqual([24, 26, 27]); // Sim-Levels2: 24 + 8 * sat(L) / 1000, a concave curve towards 32
    expect([1, 2, 3].map((l) => samRadiusCells(l, true))).toEqual([28, 31, 32]);
  });
});

describe('Defense Post', () => {
  it('multiplies the cell price by 2.5 inside 12 cells of a finished Post of the owner and not outside', () => {
    const s = strip(2);
    addDone(s, STRUCT_POST, 2, at(100));
    expect(collectPosts(s, 2)).toBe(1);
    expect(postAdjustedCost(s.structures, W, at(112), 1000)).toBe(2500);
    expect(postAdjustedCost(s.structures, W, at(88), 1000)).toBe(2500);
    expect(postAdjustedCost(s.structures, W, at(113), 1000)).toBe(1000);
    expect(postAdjustedCost(s.structures, W, at(100, 4 + 12), 1000)).toBe(2500);
    expect(postAdjustedCost(s.structures, W, at(100, 4 + 13), 1000)).toBe(1000);
    expect(dist2Cells(W, at(1), at(W - 1))).toBe(4); // x wraps
    const t = strip(2);
    t.structures.add(STRUCT_POST, 2, at(100), t.tick); // still being built
    expect(collectPosts(t, 2)).toBe(0);
  });

  /** Owner 1 attacks owner 2 across a border at x = 40 with plenty of troops; returns the QT it paid per cell it took in 3 ticks. */
  function costPerCell(postAt: number | null): number {
    const s = landState(80, 8, { seats: 2 });
    for (let y = 0; y < 8; y++) for (let x = 0; x < 80; x++) setOwner(s, y * 80 + x, x < 40 ? 1 : 2, 0);
    s.tick = 5000;
    if (postAt !== null) s.structures.add(STRUCT_POST, 2, postAt, 0);
    s.troops[1] = 400000;
    expect(applyAttack(s, 0, 2, 100)).toBe(0);
    for (let i = 0; i < 3; i++) step(s, { turn: s.tick, intents: [] });
    const taken = (s.agg.area[1] as number) - 320;
    expect(taken).toBeGreaterThan(0);
    return (400000 - (s.attacks.list[0]?.troops ?? 0)) / taken;
  }
  it('an attack on land near a Post costs more of the attacker\'s troops; a Post far from the front changes nothing', () => {
    const none = costPerCell(null);
    const far = costPerCell(79 + 7 * 80); // the far corner, more than 12 cells from the cells taken in 3 ticks
    const near = costPerCell(4 * 80 + 41);
    expect(far).toBe(none);
    expect(near / none).toBeGreaterThan(2.3);
    expect(near / none).toBeLessThan(2.7);
  });
});

describe('conquest of structures', () => {
  function pocket(): GameState {
    const s = landState(40, 20, { seats: 3 });
    for (let c = 0; c < s.grid.cells; c++) setOwner(s, c, c % 40 < 20 ? 1 : 2, 0);
    s.tick = 5000;
    return s;
  }
  const cellOf = (x: number, y: number): number => y * 40 + x;

  it('City, Factory and Port change owner one level lower (at least 1); Silo, SAM and Post are destroyed', () => {
    const s = pocket();
    const city = addDone(s, STRUCT_CITY, 2, cellOf(30, 2), 3);
    const factory = addDone(s, STRUCT_FACTORY, 2, cellOf(30, 6), 1);
    const port = addDone(s, STRUCT_PORT, 2, cellOf(30, 10), 2);
    const silo = addDone(s, STRUCT_SILO, 2, cellOf(30, 14));
    const sam = addDone(s, STRUCT_SAM, 2, cellOf(30, 17));
    const post = addDone(s, STRUCT_POST, 2, cellOf(25, 17));
    s.structures.upgradeReadyTick[city] = 9000; // an upgrade in progress is lost with the conquest
    for (const y of [2, 6, 10, 14, 17]) setOwner(s, cellOf(30, y), 1, 0);
    setOwner(s, cellOf(25, 17), 1, 0);
    const t = s.structures;
    expect([t.owner[city], t.level[city], t.upgradeReadyTick[city]]).toEqual([1, 2, 0]);
    expect([t.owner[factory], t.level[factory]]).toEqual([1, 1]);
    expect([t.owner[port], t.level[port]]).toEqual([1, 1]);
    for (const id of [silo, sam, post]) expect(t.owner[id], `slot ${id}`).toBe(0);
    expect(t.idAt(cellOf(30, 14))).toBe(-1);
    expect([t.ownedCount(1, STRUCT_CITY), t.ownedCount(2, STRUCT_CITY), t.ownedCount(2, STRUCT_SILO), t.ownedCount(1, STRUCT_POST)]).toEqual([1, 0, 0, 0]);
    expect(t.liveCount).toBe(3);
    // The derived index and the counts equal a rebuild.
    const byCell = t.byCell.slice();
    const counts = t.counts.slice();
    t.rebuildIndex();
    expect(t.byCell).toEqual(byCell);
    expect(t.counts).toEqual(counts);
    // The conquered City now pays its new owner.
    expect(structGoldMilliPerSec(s, 1)).toBe(Math.floor((cityGoldMilli(2) * 125) / 100) + FACTORY_GOLD_MILLI_PER_SEC + PORT_GOLD_MILLI_PER_SEC); // the Factory is 4 cells from the City
    expect(structGoldMilliPerSec(s, 2)).toBe(0);
  });

  it('an enclave that flips to the surrounding player takes its City along (one level lower) and destroys its Post', () => {
    const s = landState(14, 10, { seats: 3 });
    for (let c = 0; c < s.grid.cells; c++) setOwner(s, c, 1, 0);
    for (let y = 4; y < 6; y++) for (let x = 5; x < 7; x++) setOwner(s, y * 14 + x, 2, 0);
    s.tick = 5000;
    const city = addDone(s, STRUCT_CITY, 2, 4 * 14 + 5, 2);
    const post = addDone(s, STRUCT_POST, 2, 5 * 14 + 6);
    for (let i = 0; i < ENCLAVE_FLIP_TICKS; i++) step(s, { turn: s.tick, intents: [] });
    expect(s.agg.area[2]).toBe(0);
    expect([s.structures.owner[city], s.structures.level[city]]).toEqual([1, 1]);
    expect(s.structures.owner[post]).toBe(0);
  });

  it('a state with structures and embargoes round-trips, and a restored run equals the straight run', () => {
    const a = strip(3);
    addDone(a, STRUCT_PORT, 1, at(100));
    addDone(a, STRUCT_PORT, 2, at(300));
    addDone(a, STRUCT_CITY, 3, at(500), 2);
    a.structures.setEmbargo(1, 2, true);
    for (let i = 0; i < 40; i++) step(a, { turn: a.tick, intents: [] });
    const r = deserialize(serialize(a));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.structures.embargoed(2, 1)).toBe(true);
    expect(hashState(r.state)).toBe(hashState(a));
    for (let i = 0; i < 60; i++) {
      step(a, { turn: a.tick, intents: [] });
      step(r.state, { turn: r.state.tick, intents: [] });
    }
    expect(hashState(r.state)).toBe(hashState(a));
    expect(r.state.gold[1]).toBe(a.gold[1]);
  });
});


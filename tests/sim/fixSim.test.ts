// Fix-Sim (audit 1): the test holes the mutation audit proved in the structure rules, the effects, the view and the snapshot guards.
// Each test pins one rule that a one-line mutant used to leave alive (the mutant is named in the comment).
import { describe, expect, it } from 'vitest';
import {
  REJECT_BUILD_FULL,
  REJECT_BUILD_GOLD,
  REJECT_DELETE_COOLDOWN,
  REJECT_NONE,
  REJECT_PHASE,
  REJECT_STRUCT_BUSY,
  withId,
} from '../../src/sim/intents';
import { FACTORY_CITY_BONUS_PCT_BY_LEVEL, FACTORY_GOLD_MILLI_BY_LEVEL, PORT_GOLD_MILLI_BY_LEVEL } from '../../src/sim/levelCurves';
import {
  BUILD_TICKS,
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  MILLI_GOLD_PER_GOLD,
  SPAWN_PHASE_TICKS,
  STRUCT_CAPACITY,
  TICK_HZ,
} from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/serialize';
import { applyIntent, step } from '../../src/sim/step';
import { createState, ENGINE_VERSION, type GameState } from '../../src/sim/state';
import { structGoldMilliPerSec, tradeMilliPerSec } from '../../src/sim/structureEffects';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, checkBuild, isCoastCell, upgradePriceGold } from '../../src/sim/structureRules';
import { StructureTable } from '../../src/sim/structures';
import { setOwner } from '../../src/sim/territory';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';
import { fillSeatStats, statIndex, statsLength } from '../../src/sim/view';
import { landState } from './helpers/worlds';

const SW = 1024;
const SH = 8;
const sat = (x: number, y = 4): number => y * SW + x;

/** A wide strip of plains with a one-cell home per seat, tick 5000 so structures added at tick 0 are finished. */
function strip(seats: number): GameState {
  const s = createState({ width: SW, height: SH, seed: 5, seats, terrain: new Uint8Array(SW * SH).fill(CLASS_PLAINS), elevation: new Uint16Array(SW * SH) });
  for (let o = 1; o <= seats; o++) setOwner(s, sat(o), o, 0);
  s.tick = 5000;
  return s;
}
const addDone = (s: GameState, type: number, owner: number, cell: number, level = 1): number => {
  const id = s.structures.add(type, owner, cell, 0);
  s.structures.level[id] = level;
  return id;
};

describe('Fix-Sim: engine version', () => {
  it('is 13 after Sim-Levels2, and a snapshot with another engine version is refused', () => {
    expect(ENGINE_VERSION).toBe(13);
    const s = strip(2);
    const bytes = serialize(s);
    expect(deserialize(bytes).ok).toBe(true);
    const other = bytes.slice();
    new DataView(other.buffer).setUint32(8, ENGINE_VERSION - 1, true); // an M09b snapshot says 8
    const r = deserialize(other);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('engine-version');
  });
});

describe('Fix-Sim: isCoastCell on every neighbour and both seams', () => {
  const w = 8;
  const h = 4;
  const grid = (sea: number[]): Uint8Array => {
    const t = new Uint8Array(w * h).fill(CLASS_PLAINS);
    for (const c of sea) t[c] = CLASS_DEEP_SEA;
    return t;
  };
  it('water only to the south, only to the north, only across the west seam, only across the east seam: a coast; water two cells away: not', () => {
    expect(isCoastCell(w, h, grid([3 * w + 2]), 2 * w + 2)).toBe(true); // south only
    expect(isCoastCell(w, h, grid([1 * w + 2]), 2 * w + 2)).toBe(true); // north only
    expect(isCoastCell(w, h, grid([1 * w + 7]), 1 * w + 0)).toBe(true); // west seam: (0,1) with sea at (7,1)
    expect(isCoastCell(w, h, grid([1 * w + 0]), 1 * w + 7)).toBe(true); // east seam
    expect(isCoastCell(w, h, grid([2 * w + 4]), 2 * w + 2)).toBe(false);
    expect(isCoastCell(w, h, grid([]), 0)).toBe(false);
  });
});

describe('Fix-Sim: table capacity, the full check and exact prices', () => {
  it('allocId never hands out an id past the capacity, and add returns -1 on a full table', () => {
    const t = new StructureTable(16, 3);
    t.highWater = STRUCT_CAPACITY - 1;
    expect(t.allocId()).toBe(STRUCT_CAPACITY - 1);
    expect(t.highWater).toBe(STRUCT_CAPACITY);
    expect(t.allocId()).toBe(-1);
    expect(t.highWater).toBe(STRUCT_CAPACITY);
    expect(t.add(STRUCT_CITY, 1, 3, 0)).toBe(-1);
    expect(t.liveCount).toBe(0);
  });

  it('REJECT_BUILD_FULL: refused exactly when liveCount has reached the capacity, allowed one below', () => {
    const s = landState(64, 32, { seats: 1 });
    for (let c = 0; c < 64 * 32; c++) setOwner(s, c, 1, 0);
    s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
    const src = {
      get width() {
        return s.width;
      },
      get height() {
        return s.height;
      },
      get tick() {
        return s.tick;
      },
      get owner() {
        return s.owner;
      },
      get terrainClass() {
        return s.terrain;
      },
      get structures() {
        return s.structures;
      },
      falloutUntilAt: () => 0,
    };
    s.structures.liveCount = STRUCT_CAPACITY - 1;
    expect(checkBuild(src, s.gold[1] as number, 0, STRUCT_CITY, 10)).toBe(REJECT_NONE);
    s.structures.liveCount = STRUCT_CAPACITY;
    expect(checkBuild(src, s.gold[1] as number, 0, STRUCT_CITY, 10)).toBe(REJECT_BUILD_FULL);
  });

  it('an Upgrade with exactly the price in the purse is allowed (and leaves 0), one milli less is refused', () => {
    const s = strip(2);
    const id = addDone(s, STRUCT_CITY, 1, sat(100));
    const price = upgradePriceGold(STRUCT_CITY, 2) * MILLI_GOLD_PER_GOLD;
    const up = (n: number): number => applyIntent(s, withId({ kind: 'Upgrade', seat: 0, structure: id }, n));
    s.gold[1] = price - 1;
    expect(up(1)).toBe(REJECT_BUILD_GOLD);
    s.gold[1] = price;
    expect(up(2)).toBe(REJECT_NONE);
    expect(s.gold[1]).toBe(0);
    expect(up(3)).toBe(REJECT_STRUCT_BUSY);
  });
});

describe('Fix-Sim: Build, Upgrade and Delete follow the match phase like Attack', () => {
  function matchState(): GameState {
    const s = createState({
      width: 64,
      height: 32,
      seed: 2,
      seats: 2,
      config: { spawnPhase: true },
      terrain: new Uint8Array(64 * 32).fill(CLASS_PLAINS),
      elevation: new Uint16Array(64 * 32),
    });
    for (let c = 0; c < 64 * 32; c++) setOwner(s, c, 1, 0);
    s.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
    return s;
  }
  it('REJECT_PHASE for all three in the spawn phase (nothing taken), allowed from its end on', () => {
    const s = matchState();
    const gold = s.gold[1];
    expect(applyIntent(s, withId({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: 100 }, 1))).toBe(REJECT_PHASE);
    expect(s.structures.liveCount).toBe(0);
    expect(s.gold[1]).toBe(gold);
    const id = addDone(s, STRUCT_CITY, 1, 200);
    expect(applyIntent(s, withId({ kind: 'Upgrade', seat: 0, structure: id }, 2))).toBe(REJECT_PHASE);
    expect(applyIntent(s, withId({ kind: 'Delete', seat: 0, structure: id }, 3))).toBe(REJECT_PHASE);
    expect(s.structures.liveCount).toBe(1);
    s.tick = SPAWN_PHASE_TICKS - 1;
    expect(applyIntent(s, withId({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: 1000 }, 4))).toBe(REJECT_PHASE);
    s.tick = SPAWN_PHASE_TICKS;
    expect(applyIntent(s, withId({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: 1000 }, 5))).toBe(REJECT_NONE);
    s.tick = SPAWN_PHASE_TICKS + (BUILD_TICKS[STRUCT_CITY] as number);
    expect(applyIntent(s, withId({ kind: 'Delete', seat: 0, structure: id }, 6))).toBe(REJECT_NONE);
    expect(applyIntent(s, withId({ kind: 'Delete', seat: 0, structure: s.structures.idAt(1000) }, 7))).toBe(REJECT_DELETE_COOLDOWN);
  });
  it('a match without a spawn phase (tests, scenarios) is not gated', () => {
    const s = strip(2);
    s.tick = 0;
    s.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
    expect(applyIntent(s, withId({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: sat(1) }, 1))).toBe(REJECT_NONE);
  });
});

describe('Fix-Sim: effect cache and conquest of the table', () => {
  it('setEmbargo dirties the income cache (a read before the flip, a read after), is symmetric, and ignores a == b', () => {
    const s = strip(3);
    addDone(s, STRUCT_PORT, 1, sat(100));
    addDone(s, STRUCT_PORT, 2, sat(200));
    const own = PORT_GOLD_MILLI_BY_LEVEL[1] as number;
    const trade = tradeMilliPerSec(100, false, false);
    expect(structGoldMilliPerSec(s, 1)).toBe(own + trade);
    s.structures.setEmbargo(1, 2, true);
    expect(structGoldMilliPerSec(s, 1)).toBe(own);
    expect(s.structures.embargoed(2, 1)).toBe(true);
    s.structures.setEmbargo(1, 2, false);
    expect(structGoldMilliPerSec(s, 1)).toBe(own + trade);
    s.structures.setEmbargo(1, 1, true);
    expect(s.structures.embargoed(1, 1)).toBe(false);
  });

  it('a cell freed to NO_OWNER destroys its structure and the table stays consistent', () => {
    const s = strip(2);
    setOwner(s, sat(300), 1, 0);
    const id = addDone(s, STRUCT_CITY, 1, sat(300));
    setOwner(s, sat(300), 0, 0);
    expect(s.structures.liveCount).toBe(0);
    expect(s.structures.idAt(sat(300))).toBe(-1);
    expect(s.structures.owner[id]).toBe(0);
    expect(s.structures.ownedCount(1, STRUCT_CITY)).toBe(0);
    expect(s.structures.recycledCount).toBe(1);
    expect(deserialize(serialize(s)).ok).toBe(true);
  });

  it('trade partners: nearest first, the LOWEST id wins a tie for the last slot', () => {
    // Port of owner 1 at 300; partners at 200 and 400 (d 100), at 100 (owner 4) and 500 (owner 5, embargoed) both at d 200.
    for (const lowerFirst of [true, false]) {
      const s = strip(5);
      addDone(s, STRUCT_PORT, 1, sat(300));
      addDone(s, STRUCT_PORT, 2, sat(200));
      addDone(s, STRUCT_PORT, 3, sat(400));
      if (lowerFirst) {
        addDone(s, STRUCT_PORT, 4, sat(100));
        addDone(s, STRUCT_PORT, 5, sat(500));
      } else {
        addDone(s, STRUCT_PORT, 5, sat(500));
        addDone(s, STRUCT_PORT, 4, sat(100));
      }
      s.structures.setEmbargo(1, 5, true);
      const own = PORT_GOLD_MILLI_BY_LEVEL[1] as number;
      const near = tradeMilliPerSec(100, false, false);
      const far = tradeMilliPerSec(200, false, false);
      // owner 4 first: it has the lower id and fills the third slot; otherwise the embargoed Port does and earns nothing
      expect(structGoldMilliPerSec(s, 1)).toBe(own + 2 * near + (lowerFirst ? far : 0));
    }
  });

  it('two equal-level Factories in reach: the lowest id boosts first (3-City cap each)', () => {
    const s = strip(2);
    addDone(s, STRUCT_FACTORY, 1, sat(300, 4)); // F1
    addDone(s, STRUCT_FACTORY, 1, sat(310, 4)); // F2
    for (let k = 0; k < 4; k++) addDone(s, STRUCT_CITY, 1, sat(305, k)); // in reach of both
    addDone(s, STRUCT_CITY, 1, sat(282, 7)); // only in reach of F1 (about 18 cells)
    const base = CITY_GOLD_MILLI_PER_SEC_PER_LEVEL;
    const bonus = Math.floor((base * (FACTORY_CITY_BONUS_PCT_BY_LEVEL[1] as number)) / 100);
    // F1 takes the first three, F2 the fourth; the lonely fifth City finds F1 full: 4 boosted, not 5
    expect(structGoldMilliPerSec(s, 1)).toBe(2 * (FACTORY_GOLD_MILLI_BY_LEVEL[1] as number) + 5 * base + 4 * bonus);
  });
});

describe('Fix-Sim: the HUD income stat includes the structure income', () => {
  it('goldPerSecMilli rises by exactly the Factory income, and equals the gold really gained over TICK_HZ ticks', () => {
    const s = landState(40, 20, { seats: 2 });
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) setOwner(s, y * 40 + x, 1, 0);
    s.tick = 5000;
    const out = new Uint32Array(statsLength(2));
    const rate = (): number => {
      fillSeatStats(s, out);
      return out[statIndex('goldPerSecMilli', 2, 0)] as number;
    };
    const plain = rate();
    s.structures.add(STRUCT_FACTORY, 1, 5 * 40 + 5, 0);
    expect(rate() - plain).toBe(FACTORY_GOLD_MILLI_BY_LEVEL[1]);
    const r = rate();
    const g0 = s.gold[1] as number;
    for (let i = 0; i < TICK_HZ; i++) step(s, { turn: s.tick, intents: [] });
    expect((s.gold[1] as number) - g0).toBe(r);
  });
});

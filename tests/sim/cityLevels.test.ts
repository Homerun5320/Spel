// Sim-Growth: City levels 1 to 10 with small steps, their price, time and payback, the 10-City limit for the worst single City (level 10 + five level 3
// districts + a level 3 Factory + the +10 percent trait), district slots per level, conquest at several levels, denser spacing per type, the forged-blob
// guards of the new level range and slot layout. Every test drives the real path (apply functions, the effects cache, setOwner), so removing a rule fails here.
import { describe, expect, it } from 'vitest';
import { applyBuildDistrict } from '../../src/sim/districts';
import { DISTRICT_MARKET, DISTRICT_HOUSING, DISTRICT_WALLS, DISTRICT_BARRACKS, districtIndex, districtSlotsOf } from '../../src/sim/districtRules';
import { ownerCapQt } from '../../src/sim/economy';
import { REJECT_BUILD_SPACING, REJECT_DISTRICT_SLOT, REJECT_NONE, REJECT_STRUCT_BUSY, REJECT_STRUCT_MAX_LEVEL } from '../../src/sim/intents';
import {
  CAP_CITY_LEVEL_TROOPS,
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  BUILD_BASE_GOLD,
  BUILD_TICKS,
  DISTRICT_MAX_SLOTS,
  DISTRICT_SLOTS_BY_LEVEL,
  MILLI_GOLD_PER_GOLD,
  QT_PER_TROOP,
  SPACING_CELLS_BY_TYPE,
  STRUCT_LEVEL_HARD_CAP,
} from '../../src/sim/rules';
import { FACTORY_CITY_BONUS_PCT_BY_LEVEL } from '../../src/sim/levelCurves';
import { districtEffect } from '../../src/sim/districtRules';
import { deserialize, serialize } from '../../src/sim/serialize';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { applyBuild, applyUpgrade } from '../../src/sim/structures';
import { applyPortTrait, structGoldMilliPerSec } from '../../src/sim/structureEffects';
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
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { landState } from './helpers/worlds';

const W = 1024;
const H = 64;
const at = (x: number, y = 32): number => y * W + x;
const GOLD = MILLI_GOLD_PER_GOLD;

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
const income = (s: GameState, o = 1): number => {
  s.structures.effDirty = true;
  return structGoldMilliPerSec(s, o);
};

describe('City levels (Sim-Levels2): a concave curve, unlimited in practice', () => {
  it('every type tops out at STRUCT_LEVEL_HARD_CAP (999); CITY_MAX_LEVEL and STRUCT_MAX_LEVEL are only the visual reference scale', () => {
    expect(STRUCT_LEVEL_HARD_CAP).toBe(999);
    for (const t of [STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_SILO, STRUCT_SAM, STRUCT_POST]) expect(maxLevelOf(t), `type ${t}`).toBe(STRUCT_LEVEL_HARD_CAP);
  });

  it('level 1 is unchanged, gold and troop cap never fall, the gain per window of levels shrinks, level 10 is 1.6 to 2 times level 1, level 100 only a little more than level 10, and the asymptote is never reached', () => {
    expect(cityGoldMilli(1)).toBe(CITY_GOLD_MILLI_PER_SEC_PER_LEVEL);
    expect(cityTroopCap(1)).toBe(CAP_CITY_LEVEL_TROOPS);
    // Concave up to the floor of the integer maths: the gain of a window of 10 levels is no larger than that of the window before it, plus two units of floor rounding.
    for (let l = 11; l + 10 <= STRUCT_LEVEL_HARD_CAP; l += 7) {
      expect(cityGoldMilli(l + 10) - cityGoldMilli(l), `gold concave ${l}`).toBeLessThanOrEqual(cityGoldMilli(l) - cityGoldMilli(l - 10) + 2);
      expect(cityTroopCap(l + 10) - cityTroopCap(l), `cap concave ${l}`).toBeLessThanOrEqual(cityTroopCap(l) - cityTroopCap(l - 10) + 2);
    }
    for (let l = 2; l <= STRUCT_LEVEL_HARD_CAP; l++) {
      expect(cityGoldMilli(l) - cityGoldMilli(l - 1), `gold step ${l}`).toBeGreaterThanOrEqual(0);
      expect(cityTroopCap(l) - cityTroopCap(l - 1), `cap step ${l}`).toBeGreaterThanOrEqual(0);
    }
    expect(cityGoldMilli(10)).toBe(2625);
    expect(cityGoldMilli(10) / cityGoldMilli(1)).toBeGreaterThanOrEqual(1.6);
    expect(cityGoldMilli(10) / cityGoldMilli(1)).toBeLessThanOrEqual(2);
    expect(cityGoldMilli(100)).toBeLessThan(1.15 * cityGoldMilli(10));
    expect(cityGoldMilli(STRUCT_LEVEL_HARD_CAP)).toBeLessThan(2 * CITY_GOLD_MILLI_PER_SEC_PER_LEVEL);
    expect(cityTroopCap(10)).toBe(2000);
    expect(cityTroopCap(STRUCT_LEVEL_HARD_CAP)).toBeLessThan(CAP_CITY_LEVEL_TROOPS + 1600);
  });

  it('the effects cache pays and caps exactly those numbers for a finished City of levels 1, 2, 5, 10, 100 and 999', () => {
    for (const l of [1, 2, 5, 10, 100, STRUCT_LEVEL_HARD_CAP]) {
      const s = strip();
      const base = ownerCapQt(s, 1);
      addCity(s, 1, 100, l);
      expect(income(s), `gold level ${l}`).toBe(cityGoldMilli(l));
      expect(ownerCapQt(s, 1) - base, `cap level ${l}`).toBe(cityTroopCap(l) * QT_PER_TROOP);
    }
  });

  it('ONE price rule: the upgrade to level L costs base * L for the City exactly like for every other type, and takes the build time of the type', () => {
    for (const t of [STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_SILO, STRUCT_SAM, STRUCT_POST]) {
      for (const l of [2, 3, 10, 100, STRUCT_LEVEL_HARD_CAP]) {
        expect(upgradePriceGold(t, l), `type ${t} level ${l}`).toBe((BUILD_BASE_GOLD[t] as number) * l);
        expect(upgradeTicksOf(t, l), `time type ${t} level ${l}`).toBe(BUILD_TICKS[t]);
      }
    }
    expect(upgradePriceGold(STRUCT_CITY, 2)).toBe(800);
    expect(upgradePriceGold(STRUCT_CITY, 10)).toBe(4000);
  });

  it('the payback of a City level step is long and grows with the level (a soft cap through the price); logged, the old window of 90 s to 6 minutes is gone', () => {
    const rows: string[] = [];
    let last = 0;
    for (const l of [2, 3, 4, 6, 10, 30]) {
      const a = strip();
      addCity(a, 1, 100, l - 1);
      const b = strip();
      addCity(b, 1, 100, l);
      const sec = (upgradePriceGold(STRUCT_CITY, l) * GOLD) / (income(b) - income(a));
      rows.push(`L${l}:${sec.toFixed(0)}s`);
      expect(sec, rows.join(' ')).toBeGreaterThan(last);
      last = sec;
    }
    console.log(`[payback city levels] ${rows.join(' ')}`);
  });

  it('Fix-4A2: an upper bound next to the strict growth (DECISIONS Fix-4A2 item 6): the City paybacks stay within about 10 percent of today\'s deliberately long values', () => {
    // Today: L2 2133 s, L3 5333 s, L4 10667 s, L6 29630 s, L10 114286 s, L30 2400000 s.
    const LIMIT = new Map<number, number>([[2, 2350], [3, 5870], [4, 11800], [6, 32600], [10, 125700], [30, 2640000]]);
    for (const [l, max] of LIMIT) {
      const a = strip();
      addCity(a, 1, 100, l - 1);
      const b = strip();
      addCity(b, 1, 100, l);
      const sec = (upgradePriceGold(STRUCT_CITY, l) * GOLD) / (income(b) - income(a));
      expect(sec, `City -> L${l}`).toBeLessThanOrEqual(max);
      expect(sec, `City -> L${l} is not free money either`).toBeGreaterThan(90);
    }
  });

  it('applyUpgrade walks a City from level 1 to 10 with the real price and time and refuses at the hard cap', () => {
    const s = strip();
    const id = addCity(s, 1, 100, 1);
    s.gold[1] = 100000 * GOLD;
    for (let l = 2; l <= 10; l++) {
      const before = s.gold[1] as number;
      expect(applyUpgrade(s, 0, id), `to ${l}`).toBe(REJECT_NONE);
      expect(before - (s.gold[1] as number)).toBe(upgradePriceGold(STRUCT_CITY, l) * GOLD);
      expect(applyUpgrade(s, 0, id)).toBe(REJECT_STRUCT_BUSY);
      const ready = s.structures.upgradeReadyTick[id] as number;
      expect(ready - s.tick).toBe(upgradeTicksOf(STRUCT_CITY, l));
      while (s.tick <= ready) step(s, { turn: s.tick, intents: [] });
      expect(s.structures.level[id]).toBe(l);
    }
    s.structures.level[id] = STRUCT_LEVEL_HARD_CAP;
    expect(applyUpgrade(s, 0, id)).toBe(REJECT_STRUCT_MAX_LEVEL);
  });
});

describe('the limit of 10 level-1 Cities (15 gold/s) for ONE City at any level', () => {
  const LIMIT = 10 * CITY_GOLD_MILLI_PER_SEC_PER_LEVEL;
  function worst(markets: number, level: number): number {
    const s = strip();
    const factory = s.structures.add(STRUCT_FACTORY, 1, at(110), 0);
    s.structures.level[factory] = level;
    const alone = income(s);
    const city = addCity(s, 1, 100, level);
    for (let k = 0; k < markets; k++) s.structures.setDistrict(city, k, DISTRICT_MARKET, level, 1000, 0);
    return income(s) - alone;
  }
  it('a City + its Factory bonus + five Markets of the same level pays under 15 gold/s, also with +10 percent, at levels 1, 10, 100 and 999', () => {
    for (const level of [1, 10, 100, STRUCT_LEVEL_HARD_CAP]) {
      const noMarkets = worst(0, level);
      expect(noMarkets, `level ${level}`).toBe(cityGoldMilli(level) + Math.floor((cityGoldMilli(level) * (FACTORY_CITY_BONUS_PCT_BY_LEVEL[level] as number)) / 100));
      const total = worst(DISTRICT_MAX_SLOTS, level);
      expect(total - noMarkets).toBe(5 * districtEffect(DISTRICT_MARKET, level).goldMilliPerSec);
      expect(total, `level ${level}`).toBeLessThanOrEqual(LIMIT);
      expect(applyPortTrait(total, 1100), `level ${level}`).toBeLessThanOrEqual(LIMIT);
    }
    expect(worst(DISTRICT_MAX_SLOTS, 1)).toBeLessThan(worst(DISTRICT_MAX_SLOTS, 10));
    expect(worst(DISTRICT_MAX_SLOTS, STRUCT_LEVEL_HARD_CAP) - worst(DISTRICT_MAX_SLOTS, 100)).toBeLessThan(300); // the tail is flat
  });
});

describe('district slots grow slowly with the City level', () => {
  it('districtSlotsOf: 2 at levels 1 to 2, 3 at 3 to 5, 4 at 6 to 8, 5 at 9 and above (never more), 0 below level 1', () => {
    expect(DISTRICT_SLOTS_BY_LEVEL.length).toBe(11);
    expect(Array.from({ length: 10 }, (_, i) => districtSlotsOf(i + 1))).toEqual([2, 2, 3, 3, 3, 4, 4, 4, 5, 5]);
    expect([districtSlotsOf(0), districtSlotsOf(11), districtSlotsOf(999)]).toEqual([0, 5, 5]);
    expect(Math.max(...DISTRICT_SLOTS_BY_LEVEL)).toBe(DISTRICT_MAX_SLOTS);
  });

  it('BuildDistrict into slot 4 is refused up to level 8 (REJECT_DISTRICT_SLOT) and accepted at level 9', () => {
    for (const [level, want] of [[8, REJECT_DISTRICT_SLOT], [9, REJECT_NONE]] as const) {
      const s = strip();
      const id = addCity(s, 1, 100, level);
      s.gold[1] = 100000 * GOLD;
      expect(applyBuildDistrict(s, 0, id, 4, DISTRICT_MARKET), `level ${level}`).toBe(want);
    }
  });
});

describe('conquest at several levels: 75 percent of the level, rounded down (at least 1); slots follow the new level', () => {
  const cell = (x: number, y: number): number => y * 40 + x;
  function conquered(level: number): { s: GameState; id: number } {
    const s = landState(40, 20, { seats: 3 });
    for (let c = 0; c < s.grid.cells; c++) setOwner(s, c, c % 40 < 20 ? 1 : 2, 0);
    s.tick = 5000;
    const id = s.structures.add(STRUCT_CITY, 2, cell(30, 10), 0);
    s.structures.level[id] = level;
    const kinds = [DISTRICT_MARKET, DISTRICT_HOUSING, DISTRICT_BARRACKS, DISTRICT_WALLS, DISTRICT_MARKET];
    for (let slot = 0; slot < districtSlotsOf(level); slot++) s.structures.setDistrict(id, slot, kinds[slot] as number, 3, 100, 0);
    setOwner(s, cell(30, 10), 1, 0);
    return { s, id };
  }
  it('levels 1, 2, 6, 7, 9 and 10 become 1, 1, 4, 5, 6 and 7; the districts that do not fit are lost, the others keep 75 percent of their level (3 becomes 2)', () => {
    for (const [from, to] of [[1, 1], [2, 1], [6, 4], [7, 5], [9, 6], [10, 7]] as const) {
      const { s, id } = conquered(from);
      const t = s.structures;
      expect([t.owner[id], t.level[id]], `from ${from}`).toEqual([1, to]);
      const kept = districtSlotsOf(to);
      for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
        const i = districtIndex(id, slot);
        if (slot < Math.min(kept, districtSlotsOf(from))) expect([t.districtKind[i] !== 0, t.districtLevel[i]], `from ${from} slot ${slot}`).toEqual([true, 2]);
        else expect(t.districtKind[i], `from ${from} slot ${slot}`).toBe(0);
      }
      expect(t.districtsOwned(2, DISTRICT_MARKET) + t.districtsOwned(2, DISTRICT_HOUSING) + t.districtsOwned(2, DISTRICT_BARRACKS) + t.districtsOwned(2, DISTRICT_WALLS)).toBe(0);
    }
  });
  it('a level 6 City (4 slots) conquered to 4 (3 slots) loses exactly slot 3; a level 10 City (5 slots) to 7 (4 slots) loses slot 4', () => {
    const six = conquered(6);
    expect(six.s.structures.districtCount).toBe(3);
    const ten = conquered(10);
    expect(ten.s.structures.districtCount).toBe(4);
  });
});

describe('denser placement: spacing per type', () => {
  function grid(): GameState {
    const s = landState(60, 60, { seats: 2, players: 2 });
    for (let c = 0; c < s.grid.cells; c++) setOwner(s, c, 1, 0);
    s.tick = 5000;
    s.gold[1] = 4000000 * GOLD;
    return s;
  }
  it('the numbers: City, Factory, Port, Post 3, SAM 5, Silo 6', () => {
    expect(SPACING_CELLS_BY_TYPE[STRUCT_CITY]).toBe(3);
    expect(SPACING_CELLS_BY_TYPE[STRUCT_FACTORY]).toBe(3);
    expect(SPACING_CELLS_BY_TYPE[STRUCT_PORT]).toBe(3);
    expect(SPACING_CELLS_BY_TYPE[STRUCT_POST]).toBe(3);
    expect(SPACING_CELLS_BY_TYPE[STRUCT_SAM]).toBe(5);
    expect(SPACING_CELLS_BY_TYPE[STRUCT_SILO]).toBe(6);
  });
  it('the exact edge of each type: one cell closer is refused, the limit itself is allowed (same row, any owner)', () => {
    for (const [type, d] of [[STRUCT_CITY, 3], [STRUCT_FACTORY, 3], [STRUCT_POST, 3], [STRUCT_SAM, 5]] as const) {
      const s = grid();
      expect(applyBuild(s, 0, type, 30 * 60 + 10), `first ${type}`).toBe(REJECT_NONE);
      expect(applyBuild(s, 0, type, 30 * 60 + 10 + d - 1), `type ${type} at ${d - 1}`).toBe(REJECT_BUILD_SPACING);
      expect(applyBuild(s, 0, type, 30 * 60 + 10 + d), `type ${type} at ${d}`).toBe(REJECT_NONE);
    }
    const silo = grid();
    expect(applyBuild(silo, 0, STRUCT_FACTORY, 5 * 60 + 5)).toBe(REJECT_NONE);
    silo.tick += 1000;
    expect(applyBuild(silo, 0, STRUCT_SILO, 30 * 60 + 10)).toBe(REJECT_NONE);
    expect(applyBuild(silo, 0, STRUCT_SILO, 30 * 60 + 10 + 5)).toBe(REJECT_BUILD_SPACING);
    expect(applyBuild(silo, 0, STRUCT_SILO, 30 * 60 + 10 + 6)).toBe(REJECT_NONE);
  });
  it('another type does not count: a Post may stand next to a City', () => {
    const s = grid();
    expect(applyBuild(s, 0, STRUCT_CITY, 30 * 60 + 10)).toBe(REJECT_NONE);
    expect(applyBuild(s, 0, STRUCT_POST, 30 * 60 + 11)).toBe(REJECT_NONE);
  });
  it('a small territory takes many structures: a 21x21 patch holds a City every 3 cells (49 of them), the old 16 cells held 4', () => {
    const s = grid();
    let built = 0;
    for (let y = 20; y <= 40; y += 3) for (let x = 20; x <= 40; x += 3) if (applyBuild(s, 0, STRUCT_CITY, y * 60 + x) === REJECT_NONE) built++;
    expect(built).toBe(49);
    expect(s.structures.ownedCount(1, STRUCT_CITY)).toBe(49);
    expect(applyBuild(s, 0, STRUCT_CITY, 21 * 60 + 21)).toBe(REJECT_BUILD_SPACING);
  });
  it('the economy stays bounded: the price of the next City stops at x6 (2400 gold) however many stand', () => {
    const s = grid();
    for (let k = 0; k < 20; k++) expect(applyBuild(s, 0, STRUCT_CITY, (20 + (k % 7) * 3) * 60 + 20 + Math.floor(k / 7) * 3)).toBe(REJECT_NONE);
    const before = s.gold[1] as number;
    expect(applyBuild(s, 0, STRUCT_CITY, 40 * 60 + 40)).toBe(REJECT_NONE);
    expect(before - (s.gold[1] as number)).toBe(400 * 6 * GOLD);
  });
});

describe('forged blobs with a valid checksum: the new level range and slot layout', () => {
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
  const refused = (tamper: (s: GameState) => void): void => {
    const s = base();
    expect(deserialize(serialize(s)).ok).toBe(true);
    tamper(s);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('structure-range');
  };
  it('a City of level 999 round trips with five districts of level 999; level 1000 is refused', () => {
    const s = base();
    s.structures.level[0] = STRUCT_LEVEL_HARD_CAP;
    for (let slot = 0; slot < 5; slot++) s.structures.setDistrict(0, slot, DISTRICT_MARKET, STRUCT_LEVEL_HARD_CAP, 1000, 0);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    refused((t) => (t.structures.level[0] = STRUCT_LEVEL_HARD_CAP + 1));
  });
  it('a Factory above the hard cap is refused, below it a Factory of level 500 is legal', () => {
    refused((t) => (t.structures.level[1] = STRUCT_LEVEL_HARD_CAP + 1));
    const s = base();
    s.structures.level[1] = 500;
    expect(deserialize(serialize(s)).ok).toBe(true);
  });
  it('an upgrade running on a level 999 City is refused, on a level 998 City it is legal', () => {
    refused((t) => {
      t.structures.level[0] = STRUCT_LEVEL_HARD_CAP;
      t.structures.upgradeReadyTick[0] = 2000;
    });
    const s = base();
    s.structures.level[0] = STRUCT_LEVEL_HARD_CAP - 1;
    s.structures.upgradeReadyTick[0] = 2000;
    expect(deserialize(serialize(s)).ok).toBe(true);
  });
  it('a district in slot 4 of a level 8 City, or in slot 2 of a level 2 City, is refused', () => {
    refused((t) => {
      t.structures.level[0] = 8;
      t.structures.setDistrict(0, 4, DISTRICT_MARKET, 1, 1000, 0);
    });
    refused((t) => {
      t.structures.level[0] = 2;
      t.structures.setDistrict(0, 2, DISTRICT_WALLS, 1, 1000, 0);
    });
    void DISTRICT_HOUSING;
    void DISTRICT_BARRACKS;
  });
});

// Conquest rules: the speed and price formulas (ratio tests, no magic numbers: everything is compared as a relation or against an
// independent restatement of the plan's formula), the attack life cycle, mutual attacks, tribes, and the refusals.
import { describe, expect, it } from 'vitest';
import { Attack, pickIndex } from '../../src/sim/attacks';
import {
  advanceAttack,
  applyAttack,
  applyCancelAttack,
  captureCostMilliQt,
  captureRateMicroPerTick,
  clampDepth,
  conquestPhase,
  riseUnits,
  uphillMilli,
} from '../../src/sim/conquest';
import { withId } from '../../src/sim/intents';
import {
  REJECT_NONE,
  REJECT_NOT_SPAWNED,
  REJECT_NO_ATTACK,
  REJECT_NO_CONTACT,
  REJECT_NO_TROOPS,
  REJECT_PCT,
  REJECT_SELF,
  REJECT_TARGET,
} from '../../src/sim/intents';
import { OUTBOX_REJECT } from '../../src/sim/outbox';
import * as rules from '../../src/sim/rules';
import {
  BASE_COST_MILLI_QT_PER_SIM_CELL,
  CAPTURE_K_MILLI,
  D_MAX_CELLS,
  DEPTH_COST_DIV_CELLS,
  HEIGHT_UNIT_M,
  MICRO_CELLS_PER_CELL,
  TERRAIN_COST_PCT,
  TICK_HZ,
  TRIBE_ATTACK_DIV,
  UPHILL_MAX_PCT,
} from '../../src/sim/rules';
import { step } from '../../src/sim/step';
import type { GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { CLASS_DEEP_SEA, CLASS_FOREST, CLASS_HILLS, CLASS_ICE, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS } from '../../src/sim/terrain';
import { landState } from './helpers/worlds';

const idx = (s: GameState, x: number, y: number): number => y * s.width + x;

/** A one-cell-wide corridor of the given class, `len` cells long, with sea above and below and at both ends (the world wraps east-west, so the last column is sea). */
function corridor(len: number, cls: number, elevationAt: (x: number) => number = () => 0, seats = 4): GameState {
  return landState(len, 3, { seats, classAt: (x, y) => (y === 1 && x < len - 1 ? cls : CLASS_DEEP_SEA), elevationAt: (x, y) => (y === 1 ? elevationAt(x) : 0) });
}

/** The conquest phase only (no economy), `ticks` times, so that troops are not refilled while a cost is measured. */
function conquer(s: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    conquestPhase(s);
    s.tick++;
  }
}

/** Runs the corridor attack of owner 1 on the free land until it has taken `cells` cells. Returns the troops spent in milli-QT. */
function spendOnCorridor(s: GameState, cells: number, committed: number): number {
  setOwner(s, idx(s, 0, 1), 1, 0);
  s.troops[1] = committed;
  expect(applyAttack(s, 0, 0, 100)).toBe(REJECT_NONE);
  const a = s.attacks.find(1, 0);
  expect(a).not.toBeNull();
  let guard = 0;
  while (s.agg.area[1] !== 1 + cells && guard++ < 100000) conquer(s, 1);
  expect(s.agg.area[1]).toBe(1 + cells);
  return (committed - (a?.troops ?? 0)) * rules.MILLI_QT_PER_QT + (a?.costFrac ?? 0);
}

describe('capture rate: the plan formula K * sqrt(L) * 2F / (F + Td)', () => {
  const L = 50;

  it('is zero without contact, without troops, and for F = 0 and Td = 0 (no division by zero, never NaN)', () => {
    expect(captureRateMicroPerTick(0, 1000, 1000)).toBe(0);
    expect(captureRateMicroPerTick(-3, 1000, 1000)).toBe(0);
    expect(captureRateMicroPerTick(L, 0, 0)).toBe(0);
    expect(captureRateMicroPerTick(L, 0, 5000)).toBe(0);
    expect(captureRateMicroPerTick(L, 1, 0)).toBeGreaterThan(0);
    for (const [c, f, t] of [[L, 0, 0], [0, 0, 0], [1, 0, 1], [1, 1, 0], [4294967295, 4294967295, 4294967295]] as const) {
      const r = captureRateMicroPerTick(c, f, t);
      expect(Number.isFinite(r) && r >= 0 && Number.isInteger(r), `${c} ${f} ${t}`).toBe(true);
    }
  });

  it('4:1 troops give at least 1.4x, and 1:4 at most 0.6x, the rate of 1:1 at equal contact length', () => {
    const even = captureRateMicroPerTick(L, 10000, 10000);
    expect(captureRateMicroPerTick(L, 40000, 10000) / even).toBeGreaterThanOrEqual(1.4);
    expect(captureRateMicroPerTick(L, 10000, 40000) / even).toBeLessThanOrEqual(0.6);
    // and they are the plan's exact ratios 2*4/5 = 1.6 and 2*1/5 = 0.4 (to within the thousandths the integer maths keeps)
    expect(captureRateMicroPerTick(L, 40000, 10000) / even).toBeCloseTo(1.6, 2);
    expect(captureRateMicroPerTick(L, 10000, 40000) / even).toBeCloseTo(0.4, 2);
  });

  it('grows with the troops committed, falls with the defender, and grows with the square root of the contact length', () => {
    let last = 0;
    for (const f of [100, 1000, 10000, 100000, 1000000]) {
      const r = captureRateMicroPerTick(L, f, 20000);
      expect(r).toBeGreaterThan(last);
      last = r;
    }
    last = Infinity;
    for (const t of [0, 100, 1000, 10000, 100000]) {
      const r = captureRateMicroPerTick(L, 20000, t);
      expect(r).toBeLessThan(last);
      last = r;
    }
    expect(captureRateMicroPerTick(4 * L, 5000, 5000) / captureRateMicroPerTick(L, 5000, 5000)).toBeCloseTo(2, 2);
    expect(captureRateMicroPerTick(100 * L, 5000, 5000) / captureRateMicroPerTick(L, 5000, 5000)).toBeCloseTo(10, 2);
  });

  it('equals the plan formula restated in std-cell units (distance /2, area x4, per tick /10), within 0.1 %', () => {
    for (const [c, f, t] of [[50, 8000, 8000], [7, 100, 5000], [900, 123456, 777], [1, 1, 1]] as const) {
      const lStd = c / rules.STD_CELL_SIDE;
      const vStd = (CAPTURE_K_MILLI / 1000) * Math.sqrt(lStd) * ((2 * f) / (f + t)); // std-cells per second
      const expected = vStd * rules.STD_CELL_AREA * (MICRO_CELLS_PER_CELL / TICK_HZ); // micro sim cells per tick
      const got = captureRateMicroPerTick(c, f, t);
      expect(Math.abs(got - expected) / expected, `${c} ${f} ${t}`).toBeLessThan(0.001);
    }
  });
});

describe('capture price: BASE * terrain * uphill * (1 + d / DIV) per sim cell, in milli-QT', () => {
  it('a Plains cell at the border on level ground costs BASE_COST QT per std-cell / 4: 0.75 troop, 3 QT, no rounding up', () => {
    expect(captureCostMilliQt(CLASS_PLAINS, 0, 0)).toBe(BASE_COST_MILLI_QT_PER_SIM_CELL);
    expect(captureCostMilliQt(CLASS_PLAINS, 0, 0)).toBe(3000);
    expect(captureCostMilliQt(CLASS_PLAINS, 0, 0) / rules.MILLI_QT_PER_QT / rules.QT_PER_TROOP).toBe(0.75);
    // the four sim cells of a std-cell cost exactly BASE_COST_TROOPS
    expect((4 * captureCostMilliQt(CLASS_PLAINS, 0, 0)) / rules.MILLI_QT_PER_QT / rules.QT_PER_TROOP).toBe(rules.BASE_COST_TROOPS);
  });

  it('Mountain costs the attacker at least 2.2x Plains (and Forest, Hills sit in between, in the plan order)', () => {
    const plains = captureCostMilliQt(CLASS_PLAINS, 0, 0);
    const mountain = captureCostMilliQt(CLASS_MOUNTAIN, 0, 0);
    expect(mountain / plains).toBeGreaterThanOrEqual(2.2);
    expect(mountain / plains).toBeCloseTo(2.5, 5);
    expect(captureCostMilliQt(CLASS_FOREST, 0, 0) / plains).toBeCloseTo(1.3, 5);
    expect(captureCostMilliQt(CLASS_HILLS, 0, 0) / plains).toBeCloseTo(1.6, 5);
    for (const d of [0, 7, D_MAX_CELLS]) expect(captureCostMilliQt(CLASS_MOUNTAIN, 0, d) / captureCostMilliQt(CLASS_PLAINS, 0, d)).toBeGreaterThanOrEqual(2.2);
  });

  it('uphill costs more than downhill over the same pair of cells; flat and downhill cost the same; the uphill factor stops at x2', () => {
    const lo = 100;
    const hi = 900; // metres
    const up = captureCostMilliQt(CLASS_PLAINS, riseUnits(hi, lo), 0); // attacking the high cell from the low one
    const down = captureCostMilliQt(CLASS_PLAINS, riseUnits(lo, hi), 0); // attacking the low cell from the high one
    expect(up).toBeGreaterThan(down);
    expect(down).toBe(captureCostMilliQt(CLASS_PLAINS, 0, 0));
    expect(captureCostMilliQt(CLASS_PLAINS, riseUnits(500, 500), 0)).toBe(down);
    expect(captureCostMilliQt(CLASS_PLAINS, 1000000, 0)).toBe(2 * captureCostMilliQt(CLASS_PLAINS, 0, 0));
    expect(uphillMilli(1000000)).toBe(UPHILL_MAX_PCT * 10);
    // the plan's 1 + 0.25 * dh / 32: dh = 32 units gives x1.25
    expect(uphillMilli(32)).toBe(1250);
    expect(riseUnits(HEIGHT_UNIT_M * 32, 0)).toBe(32);
    expect(riseUnits(0, 5000)).toBe(0);
  });

  it('the depth term is 1 + d / DEPTH_DIV, grows with d and is clamped at D_MAX: d never exceeds D_MAX', () => {
    const base = captureCostMilliQt(CLASS_PLAINS, 0, 0);
    expect(captureCostMilliQt(CLASS_PLAINS, 0, DEPTH_COST_DIV_CELLS) / base).toBeCloseTo(2, 5);
    expect(captureCostMilliQt(CLASS_PLAINS, 0, D_MAX_CELLS) / base).toBeCloseTo(1 + D_MAX_CELLS / DEPTH_COST_DIV_CELLS, 5);
    let last = 0;
    for (let d = 0; d <= D_MAX_CELLS; d++) {
      const c = captureCostMilliQt(CLASS_PLAINS, 0, d);
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
    expect(captureCostMilliQt(CLASS_PLAINS, 0, 10 * D_MAX_CELLS)).toBe(captureCostMilliQt(CLASS_PLAINS, 0, D_MAX_CELLS));
    expect(captureCostMilliQt(CLASS_PLAINS, 0, -5)).toBe(base);
    expect([clampDepth(-1), clampDepth(0), clampDepth(D_MAX_CELLS), clampDepth(D_MAX_CELLS + 1), clampDepth(1e9)]).toEqual([0, 0, D_MAX_CELLS, D_MAX_CELLS, D_MAX_CELLS]);
    // a frontier never stores a depth above D_MAX: a deeper cell goes into the D_MAX bag
    const a = new Attack(1, 1, 0, 1000);
    for (const d of [0, 1, D_MAX_CELLS, D_MAX_CELLS + 1, 255, 100000, -4]) a.push(1000 + d, d);
    expect(a.size).toBe(7);
    expect(a.counts.length).toBe(D_MAX_CELLS + 1);
    expect([a.counts[0], a.counts[1], a.counts[D_MAX_CELLS]]).toEqual([2, 1, 4]);
    const depths: number[] = [];
    for (let c = a.pick(5); c >= 0; c = a.pick(5)) depths.push(a.lastDepth);
    expect(depths).toEqual([0, 0, 1, D_MAX_CELLS, D_MAX_CELLS, D_MAX_CELLS, D_MAX_CELLS]);
  });

  it('no terrain class that nobody can own has a price (and the table says so)', () => {
    for (const cls of [CLASS_DEEP_SEA, 1, CLASS_PEAK, CLASS_ICE, 99, -1]) expect(captureCostMilliQt(cls, 0, 0)).toBe(0);
    expect(TERRAIN_COST_PCT.length).toBe(8);
  });
});

describe('what an attack really pays (corridor worlds: one cell wide, so the depth of the n-th cell is n - 1)', () => {
  // The independent restatement: cell i (0-based) costs floor(3000 * pct/100 * uphill/1000 * (40 + i) / 40) milli-QT.
  const price = (pct: number, up: number, i: number): number => Math.floor((3000 * pct * up * (DEPTH_COST_DIV_CELLS + i)) / (100 * 1000 * DEPTH_COST_DIV_CELLS));
  const total = (pct: number, up: number, n: number): number => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += price(pct, up, i);
    return sum;
  };

  it('Plains: the troops that leave the attack equal the sum of the prices of the cells it took, to the milli-QT', () => {
    const spent = spendOnCorridor(corridor(60, CLASS_PLAINS), 25, 1000000);
    expect(spent).toBe(total(100, 1000, 25));
  });

  it('Mountain costs 2.5x Plains for the same corridor and the same number of cells', () => {
    const plains = spendOnCorridor(corridor(60, CLASS_PLAINS), 20, 1000000);
    const mountain = spendOnCorridor(corridor(60, CLASS_MOUNTAIN), 20, 1000000);
    expect(mountain).toBe(total(250, 1000, 20));
    expect(mountain / plains).toBeGreaterThanOrEqual(2.2);
  });

  it('a corridor that climbs 10 height units per cell costs the uphill factor; the same corridor walked downhill costs the flat price', () => {
    const step10 = HEIGHT_UNIT_M * 10;
    const climbing = spendOnCorridor(corridor(60, CLASS_PLAINS, (x) => x * step10), 20, 1000000);
    const falling = spendOnCorridor(corridor(60, CLASS_PLAINS, (x) => (59 - x) * step10), 20, 1000000);
    // moving east from x = 0: climbing means each new cell is 10 units higher than the attacker cell before it
    expect(climbing).toBe(total(100, uphillMilli(10), 20));
    expect(falling).toBe(total(100, 1000, 20));
    expect(climbing).toBeGreaterThan(falling);
  });

  it('the attacker comes from its HIGHEST neighbouring cell: a cell with a high and a low attacker neighbour is priced from the high one', () => {
    // target (1,1) at 400 m; attacker cells (0,1) at 0 m and (1,0) at 400 m
    const make = (northHigh: boolean): GameState => {
      const s = landState(3, 3, { elevationAt: (x, y) => (x === 1 && y === 1 ? 400 : x === 1 && y === 0 ? (northHigh ? 400 : 0) : 0) });
      for (const [x, y] of [[0, 1], [1, 0]] as const) setOwner(s, idx(s, x, y), 1, 0);
      s.troops[1] = 100000;
      return s;
    };
    const spentFor = (s: GameState): number => {
      const a = s.attacks.create(1, 0, 100000);
      a.push(idx(s, 1, 1), 0);
      expect(advanceAttack(s, a, 0, 1)).toBe(1);
      return (100000 - a.troops) * 1000 + a.costFrac;
    };
    const flat = spentFor(make(true));
    const uphill = spentFor(make(false));
    expect(flat).toBe(3000);
    expect(uphill).toBe(captureCostMilliQt(CLASS_PLAINS, riseUnits(400, 0), 0));
    expect(uphill).toBeGreaterThan(flat);
  });
});

describe('speed, measured on whole attacks (equal contact length)', () => {
  /** A 60x40 plain with owner 1 on the left, owner 2 elsewhere; owner 1 attacks owner 2 with `f` QT while 2 holds `td`. Returns the cells taken in 600 ticks (one minute). */
  function takenInAMinute(f: number, td: number): number {
    const s = landState(60, 40, { seats: 3 });
    for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) setOwner(s, idx(s, x, y), x < 10 ? 1 : 2, 0);
    s.troops[1] = f;
    s.troops[2] = td;
    expect(applyAttack(s, 0, 2, 100)).toBe(REJECT_NONE);
    conquer(s, 600);
    return (s.agg.area[1] as number) - 400;
  }

  it('4:1 troops take at least 1.4x the cells of 1:1 in the same time, and 1:4 at most 0.6x', () => {
    const big = 4000000;
    const even = takenInAMinute(big, big);
    expect(even).toBeGreaterThan(100);
    expect(takenInAMinute(4 * big, big) / even).toBeGreaterThanOrEqual(1.4);
    expect(takenInAMinute(big, 4 * big) / even).toBeLessThanOrEqual(0.6);
  });

  /** Owner 1 holds the left 10 columns of a 120x40 field of free land of class `cls` and attacks it with plenty of troops; returns the cells taken in 100 ticks (D106). */
  function takenIn100Ticks(cls: number): number {
    const s = landState(120, 40, { seats: 2, classAt: () => cls });
    for (let y = 0; y < 40; y++) for (let x = 0; x < 10; x++) setOwner(s, idx(s, x, y), 1, 0);
    s.troops[1] = 40000000;
    expect(applyAttack(s, 0, 0, 100)).toBe(REJECT_NONE);
    const before = s.agg.area[1] as number;
    conquer(s, 100);
    return (s.agg.area[1] as number) - before;
  }

  it('terrain slows the front (D106): a Mountain front gains at most 0.6x the cells of a Plains front per 100 ticks, Hills and Forest lie in between, in the order of the cost table', () => {
    const plains = takenIn100Ticks(CLASS_PLAINS);
    const forest = takenIn100Ticks(CLASS_FOREST);
    const hills = takenIn100Ticks(CLASS_HILLS);
    const mountain = takenIn100Ticks(CLASS_MOUNTAIN);
    console.log(`[terrain speed] cells per 100 ticks: plains ${plains}, forest ${forest}, hills ${hills}, mountain ${mountain}`);
    expect(plains).toBeGreaterThan(50);
    expect(mountain / plains).toBeLessThanOrEqual(0.6);
    expect(mountain / plains).toBeGreaterThan(0.2); // slowed, not stopped
    expect(forest).toBeLessThan(plains);
    expect(hills).toBeLessThan(forest);
    expect(mountain).toBeLessThan(hills);
  });
});

describe('attack life cycle', () => {
  it('troops are conserved: the owner plus the attack pool never grow in the conquest phase, and what is left goes home when the attack ends', () => {
    const s = landState(12, 5, { classAt: (x) => (x < 9 ? CLASS_PLAINS : CLASS_DEEP_SEA) });
    for (let y = 0; y < 5; y++) setOwner(s, idx(s, 0, y), 1, 0);
    s.troops[1] = 100000;
    expect(applyAttack(s, 0, 0, 50)).toBe(REJECT_NONE);
    expect(s.troops[1]).toBe(50000);
    const before = 100000;
    let guard = 0;
    while (s.attacks.list.length > 0 && guard++ < 5000) {
      conquer(s, 1);
      const pool = s.attacks.list.reduce((n, a) => n + a.troops, 0);
      expect((s.troops[1] as number) + pool).toBeLessThanOrEqual(before);
    }
    expect(s.attacks.list.length).toBe(0);
    expect(s.agg.area[1]).toBe(45); // all 9 x 5 land cells taken, the sea is not
    const paid = before - (s.troops[1] as number);
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThan(50000);
  });

  it('an attack ends when the troops cannot pay for the next cell, returns them, and the owner keeps what it took', () => {
    const s = corridor(60, CLASS_PLAINS);
    setOwner(s, idx(s, 0, 1), 1, 0);
    s.troops[1] = 40; // 10 troops of 4 QT... 40 QT: 13 cells of 3 QT at most, fewer with the depth term
    expect(applyAttack(s, 0, 0, 100)).toBe(REJECT_NONE);
    expect(s.troops[1]).toBe(0);
    conquer(s, 3000);
    expect(s.attacks.list.length).toBe(0);
    expect(s.agg.area[1]).toBeGreaterThan(5);
    expect(s.agg.area[1]).toBeLessThan(15);
    expect((s.troops[1] as number) + (s.agg.area[1] as number)).toBeGreaterThan(0);
    expect(s.troops[1]).toBeLessThan(5); // less than one cell's price (3 QT plus the depth term) is left over
  });

  it('an attack ends at once when the border is gone or the attacker has no land; its troops go home', () => {
    const s = landState(8, 4, { seats: 3 });
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) setOwner(s, idx(s, x, y), x < 4 ? 1 : 2, 0);
    s.troops[1] = 100000;
    s.troops[2] = 100000;
    expect(applyAttack(s, 0, 2, 100)).toBe(REJECT_NONE);
    expect(s.troops[1]).toBe(0);
    // owner 2 loses everything to a third party in one go: no border left
    for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) setOwner(s, idx(s, x, y), 1, 0);
    conquer(s, 1);
    expect(s.attacks.list.length).toBe(0);
    expect(s.troops[1]).toBe(100000);
  });

  it('Peak, Ice and sea cannot be taken: a corridor with a Peak cell stops the attack there', () => {
    const s = landState(21, 3, { classAt: (x, y) => (y !== 1 || x === 20 ? CLASS_DEEP_SEA : x === 8 ? CLASS_PEAK : x === 12 ? CLASS_ICE : CLASS_PLAINS) });
    setOwner(s, idx(s, 0, 1), 1, 0);
    s.troops[1] = 1000000;
    expect(applyAttack(s, 0, 0, 100)).toBe(REJECT_NONE);
    conquer(s, 4000);
    expect(s.attacks.list.length).toBe(0);
    expect(s.agg.area[1]).toBe(8); // x = 0..7
    expect(s.owner[idx(s, 8, 1)]).toBe(0);
    expect(s.troops[1]).toBeGreaterThan(900000);
  });

  it('the attack on a seat takes ITS land, not unowned land, and a second Attack on the same target adds its troops to the first', () => {
    const s = landState(10, 4, { seats: 3 });
    for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) setOwner(s, idx(s, x, y), x < 3 ? 1 : x < 6 ? 2 : 0, 0);
    s.troops[1] = 100000;
    expect(applyAttack(s, 0, 2, 40)).toBe(REJECT_NONE);
    expect(s.attacks.list.length).toBe(1);
    expect((s.attacks.find(1, 2) ?? { troops: 0 }).troops).toBe(40000);
    expect(applyAttack(s, 0, 2, 50)).toBe(REJECT_NONE); // 50 % of the 60000 left
    expect(s.attacks.list.length).toBe(1);
    expect((s.attacks.find(1, 2) ?? { troops: 0 }).troops).toBe(70000);
    conquer(s, 3000);
    for (let y = 0; y < 4; y++) expect(s.owner[idx(s, 6, y)]).toBe(0); // never touched: owner 1 is not attacking unowned land
    expect(s.agg.area[2]).toBe(0);
  });
});

describe('mutual attacks cancel', () => {
  function front(): GameState {
    const s = landState(10, 6, { seats: 3 });
    for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) setOwner(s, idx(s, x, y), x < 5 ? 1 : 2, 0);
    s.troops[1] = 8000;
    s.troops[2] = 8000;
    return s;
  }

  it('equal forces end both attacks: no attack is left, both lost what they committed, no cell changed', () => {
    const s = front();
    expect(applyAttack(s, 0, 2, 50)).toBe(REJECT_NONE); // 1 commits 4000
    expect(applyAttack(s, 1, 1, 50)).toBe(REJECT_NONE); // 2 commits 4000 against it
    expect(s.attacks.list.length).toBe(0);
    expect([s.troops[1], s.troops[2]]).toEqual([4000, 4000]);
    conquer(s, 200);
    expect([s.agg.area[1], s.agg.area[2]]).toEqual([30, 30]);
  });

  it('unequal forces: the weaker one ends, the stronger goes on with the difference', () => {
    const s = front();
    expect(applyAttack(s, 0, 2, 75)).toBe(REJECT_NONE); // 1 commits 6000
    expect(applyAttack(s, 1, 1, 25)).toBe(REJECT_NONE); // 2 commits 2000 against it
    expect(s.attacks.list.length).toBe(1);
    const a = s.attacks.find(1, 2);
    expect(a?.troops).toBe(4000);
    expect(s.attacks.find(2, 1)).toBeNull();
    expect([s.troops[1], s.troops[2]]).toEqual([2000, 6000]);
  });

  it('the other order: the newer, stronger attack wins the clash and starts with the difference', () => {
    const s = front();
    expect(applyAttack(s, 0, 2, 25)).toBe(REJECT_NONE); // 1 commits 2000
    expect(applyAttack(s, 1, 1, 75)).toBe(REJECT_NONE); // 2 commits 6000
    expect(s.attacks.find(1, 2)).toBeNull();
    expect(s.attacks.find(2, 1)?.troops).toBe(4000);
  });

  it('attacks on unowned land are never mutual', () => {
    const s = landState(10, 4, { seats: 3 });
    for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) setOwner(s, idx(s, x, y), 1, 0);
    for (let y = 0; y < 4; y++) for (let x = 7; x < 10; x++) setOwner(s, idx(s, x, y), 2, 0);
    s.troops[1] = 4000;
    s.troops[2] = 4000;
    expect(applyAttack(s, 0, 0, 100)).toBe(REJECT_NONE);
    expect(applyAttack(s, 1, 0, 100)).toBe(REJECT_NONE);
    expect(s.attacks.list.length).toBe(2);
  });
});

describe('CancelAttack, tribes and refusals', () => {
  it('CancelAttack ends the attack of the sender on the target and returns its troops; nothing to cancel is refused', () => {
    const s = landState(10, 4, { seats: 3 });
    for (let y = 0; y < 4; y++) setOwner(s, idx(s, 0, y), 1, 0);
    s.troops[1] = 10000;
    expect(applyCancelAttack(s, 0, 0)).toBe(REJECT_NO_ATTACK);
    expect(applyAttack(s, 0, 0, 100)).toBe(REJECT_NONE);
    expect(s.troops[1]).toBe(0);
    expect(applyCancelAttack(s, 1, 0)).toBe(REJECT_NO_ATTACK); // another seat's has nothing to cancel
    expect(applyCancelAttack(s, 0, 0)).toBe(REJECT_NONE);
    expect(s.troops[1]).toBe(10000);
    expect(s.attacks.list.length).toBe(0);
    expect(applyCancelAttack(s, 0, 0)).toBe(REJECT_NO_ATTACK);
  });

  it('a tribe commits troops / TRIBE_ATTACK_DIV whatever pct it names; a player commits pct percent', () => {
    const s = landState(12, 4, { seats: 3, players: 1 });
    for (let y = 0; y < 4; y++) {
      setOwner(s, idx(s, 0, y), 1, 0);
      setOwner(s, idx(s, 11, y), 2, 0);
    }
    s.troops[1] = 20000;
    s.troops[2] = 20000; // owner 2 is a tribe (seat 1 >= players)
    expect(applyAttack(s, 1, 0, 100)).toBe(REJECT_NONE);
    expect(s.attacks.find(2, 0)?.troops).toBe(Math.floor(20000 / TRIBE_ATTACK_DIV));
    expect(s.troops[2]).toBe(20000 - Math.floor(20000 / TRIBE_ATTACK_DIV));
    expect(applyAttack(s, 0, 0, 30)).toBe(REJECT_NONE);
    expect(s.attacks.find(1, 0)?.troops).toBe(6000);
  });

  it('refuses: no land, own land, no border, nothing to commit; bad target or pct are refused by validation (all counted, none change the state)', () => {
    const s = landState(10, 4, { seats: 3 });
    for (let y = 0; y < 4; y++) setOwner(s, idx(s, 0, y), 1, 0);
    s.troops[1] = 10000;
    s.troops[2] = 10000;
    expect(applyAttack(s, 1, 0, 50)).toBe(REJECT_NOT_SPAWNED); // owner 2 has no land
    expect(applyAttack(s, 0, 1, 50)).toBe(REJECT_SELF);
    expect(applyAttack(s, 0, 3, 50)).toBe(REJECT_NO_CONTACT); // owner 3 has no land at all
    for (let y = 0; y < 4; y++) setOwner(s, idx(s, 5, y), 2, 0);
    expect(applyAttack(s, 0, 2, 50)).toBe(REJECT_NO_CONTACT); // land in between is unowned (the world wraps, so x = 5 is far from both ends): no shared border
    s.troops[1] = 1;
    expect(applyAttack(s, 0, 0, 50)).toBe(REJECT_NO_TROOPS);
    s.troops[1] = 0;
    expect(applyAttack(s, 0, 0, 100)).toBe(REJECT_NO_TROOPS);
    expect(s.attacks.list.length).toBe(0);
    expect(s.troops[1]).toBe(0);

    s.troops[1] = 10000;
    const bad = [
      withId({ kind: 'Attack', seat: 0, target: 99, pct: 50 }, 1),
      withId({ kind: 'Attack', seat: 0, target: 0, pct: 0 }, 2),
      withId({ kind: 'Attack', seat: 0, target: 0, pct: 101 }, 3),
      withId({ kind: 'Attack', seat: 0, target: 0.5, pct: 50 }, 4),
      withId({ kind: 'CancelAttack', seat: 0, target: 4 }, 5),
    ];
    const r = step(s, { turn: s.tick, intents: bad });
    expect(r).toEqual({ ok: true, applied: 0, rejected: 5 });
    expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_REJECT).map((e) => e.a)).toEqual([REJECT_TARGET, REJECT_PCT, REJECT_PCT, REJECT_TARGET, REJECT_TARGET]);
    expect(s.attacks.list.length).toBe(0);
  });

  it('through step(): an Attack intent starts the attack the same tick and the cells start to change', () => {
    const s = landState(30, 5, { seats: 2 });
    for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) setOwner(s, idx(s, x, y), 1, 0);
    s.troops[1] = 40000;
    s.outbox.clear();
    const r = step(s, { turn: 0, intents: [withId({ kind: 'Attack', seat: 0, target: 0, pct: 100 }, 0)] });
    expect(r).toEqual({ ok: true, applied: 1, rejected: 0 });
    expect(s.attacks.list.length).toBe(1);
    for (let i = 0; i < 100; i++) step(s, { turn: s.tick, intents: [] });
    expect(s.agg.area[1]).toBeGreaterThan(20);
  });
});

describe('the hash tie-break of the frontier', () => {
  /** The cells of one bag in the order an attack takes them. */
  function takeOrder(seed: number, cells: number[], depth = 0): number[] {
    const a = new Attack(7, 1, 0, 1000);
    for (const c of cells) a.push(c, depth);
    const out: number[] = [];
    for (let c = a.pick(seed); c >= 0; c = a.pick(seed)) out.push(c);
    return out;
  }

  it('cells of equal depth come out in an order that a hash of the seed decides: other seeds, other orders; the same seed, the same order', () => {
    const cells = Array.from({ length: 24 }, (_, i) => 100 + 7 * i);
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const order = takeOrder(seed, cells);
      expect([...order].sort((x, y) => x - y)).toEqual(cells); // every cell exactly once
      expect(takeOrder(seed, cells)).toEqual(order);
      seen.add(order.join(','));
    }
    expect(seen.size).toBe(8);
    // not simply sorted or reversed
    const order = takeOrder(1, cells);
    expect(order).not.toEqual(cells);
    expect(order).not.toEqual([...cells].reverse());
  });

  it('the choice is spread over the whole bag (no cell is favoured by its place in the array): the first pick is every position about equally often', () => {
    const counts = new Array<number>(8).fill(0);
    for (let seed = 0; seed < 800; seed++) {
      const first = takeOrder(seed, [10, 11, 12, 13, 14, 15, 16, 17])[0] as number;
      counts[first - 10] = (counts[first - 10] as number) + 1;
    }
    for (const n of counts) {
      expect(n).toBeGreaterThan(60);
      expect(n).toBeLessThan(140);
    }
  });

  it('depth comes before the hash: a shallow cell is always taken before a deeper one', () => {
    const a = new Attack(3, 1, 0, 1000);
    for (let c = 0; c < 60; c++) a.push(c, (c * 7) % 23);
    let last = -1;
    for (let c = a.pick(5); c >= 0; c = a.pick(5)) {
      expect(a.lastDepth).toBeGreaterThanOrEqual(last);
      last = a.lastDepth;
    }
    expect(a.size).toBe(0);
    // a shallow cell that arrives late is taken next
    a.push(500, 9);
    a.push(501, 2);
    expect(a.pick(5)).toBe(501);
    expect(a.pick(5)).toBe(500);
  });

  it('the pick index is exact over the whole range of bag sizes and never out of range', () => {
    for (const count of [1, 2, 3, 7, 1000, 65537, 4194303]) {
      for (const h of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
        const i = pickIndex(h, count);
        expect(Number.isInteger(i) && i >= 0 && i < count, `${h} ${count}`).toBe(true);
      }
    }
  });
});

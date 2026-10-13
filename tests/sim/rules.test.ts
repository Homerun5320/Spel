// The numbers of rules.ts: relations between constants (units), and the plan's values where the plan gave one.
import { describe, expect, it } from 'vitest';
import { TerrainClass } from '../../src/data/format';
import * as r from '../../src/sim/rules';
import * as t from '../../src/sim/terrain';
import { stdToSimArea, stdToSimCellRate, stdToSimDistance, stdToSimSpeed, troopsToQt, qtToTroops, weightedSimToStdQ15 } from '../../src/sim/units';

describe('rules.ts: units', () => {
  it('a std-cell is 2x2 sim cells: distance x2, area x4, speed x2, and a cell RATE x4', () => {
    expect(r.STD_CELL_SIDE).toBe(2);
    expect(r.STD_CELL_AREA).toBe(r.STD_CELL_SIDE * r.STD_CELL_SIDE);
    expect(stdToSimDistance(8)).toBe(16);
    expect(stdToSimArea(8)).toBe(32);
    expect(stdToSimSpeed(3)).toBe(6);
    expect(stdToSimCellRate(3)).toBe(12);
    expect(stdToSimDistance(r.D_MAX_STD)).toBe(r.D_MAX_CELLS);
    expect(stdToSimDistance(r.DEPTH_COST_DIV_STD)).toBe(r.DEPTH_COST_DIV_CELLS);
  });

  it('quarter troops: 4 QT = 1 troop, and a Plains sim cell costs 3 QT = 0.75 troop', () => {
    expect(troopsToQt(1)).toBe(4);
    expect(qtToTroops(3)).toBe(0.75);
    expect(r.BASE_COST_QT_PER_SIM_CELL).toBe(3);
    expect(qtToTroops(r.BASE_COST_QT_PER_SIM_CELL)).toBe(0.75);
    // the four sim cells of one std-cell cost exactly BASE_COST troops
    expect(r.BASE_COST_QT_PER_SIM_CELL * r.STD_CELL_AREA).toBe(troopsToQt(r.BASE_COST_TROOPS));
    expect(r.BASE_COST_QT_PER_SIM_CELL * r.STD_CELL_AREA * (r.TERRAIN_COST_PCT[t.CLASS_MOUNTAIN] as number)).toBeGreaterThanOrEqual(2.2 * r.BASE_COST_QT_PER_SIM_CELL * r.STD_CELL_AREA * 100);
  });

  it('a Q15 weighted sim-cell sum becomes std-cells (Q15) by dividing by the area of a std-cell', () => {
    expect(weightedSimToStdQ15(4 * r.WEIGHT_ONE)).toBe(r.WEIGHT_ONE); // four equatorial sim cells = one std-cell
    expect(weightedSimToStdQ15(0)).toBe(0);
    expect(weightedSimToStdQ15(7)).toBe(1);
  });

  it('the scales divide exactly', () => {
    expect(r.SQRT_MILLI_PER_QT * r.QT_PER_TROOP).toBe(1000000);
    expect(r.TICK_HZ * r.TICK_MS).toBe(1000);
    expect(r.START_TROOPS_QT).toBe(r.START_TROOPS * r.QT_PER_TROOP);
    expect(r.START_GOLD_MILLI).toBe(r.START_GOLD * r.MILLI_GOLD_PER_GOLD);
    expect(Number.isInteger(r.MAX_DECAY_MICRO_QT_PER_TICK)).toBe(true);
    expect(Number.isInteger(r.BASE_COST_QT_PER_SIM_CELL)).toBe(true);
    // 40 troops per second = 4 troops per tick = 16 QT per tick = 16 million micro-QT per tick
    expect(r.MAX_DECAY_MICRO_QT_PER_TICK).toBe(16 * r.MICRO_QT_PER_QT);
  });
});

describe('rules.ts: the capital disc', () => {
  it('START_DISC_CELLS is the number of integer points in the disc of START_DISC_RADIUS_CELLS', () => {
    const R = r.START_DISC_RADIUS_CELLS;
    let count = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) count++;
    expect(count).toBe(r.START_DISC_CELLS);
    expect(r.START_DISC_CELLS).toBe(197);
  });
});

describe('rules.ts: the plan values', () => {
  it('start values, cap, regeneration and tribe factors', () => {
    expect([r.START_TROOPS, r.START_GOLD]).toEqual([1200, 500]);
    expect([r.CAP_BASE_TROOPS, r.CAP_N_COEF_TROOPS, r.CAP_CITY_LEVEL_TROOPS]).toEqual([2000, 120, 800]);
    expect([r.REGEN_BASE_TROOPS_PER_SEC, r.REGEN_SQRT_COEF_MILLI]).toEqual([8, 350]);
    expect([r.TRIBE_CAP_DIV, r.TRIBE_REGEN_PCT, r.TRIBE_ATTACK_DIV]).toEqual([3, 50, 20]);
    expect(r.TICK_HZ).toBe(10);
  });

  it('the terrain table: Plains 1.0, Forest 1.3, Hills 1.6, Mountain 2.5; sea, Shallows, Peak and Ice cannot be entered', () => {
    expect(r.TERRAIN_COST_PCT).toEqual([0, 0, 100, 130, 160, 250, 0, 0]);
    expect((r.TERRAIN_COST_PCT[t.CLASS_MOUNTAIN] as number) / (r.TERRAIN_COST_PCT[t.CLASS_PLAINS] as number)).toBeGreaterThanOrEqual(2.2);
    for (const cls of [t.CLASS_DEEP_SEA, t.CLASS_SHALLOWS, t.CLASS_PEAK, t.CLASS_ICE]) expect(t.isPlayableClass(cls)).toBe(false);
    for (const cls of [t.CLASS_PLAINS, t.CLASS_FOREST, t.CLASS_HILLS, t.CLASS_MOUNTAIN]) expect(t.isPlayableClass(cls)).toBe(true);
    expect(t.isPlayableClass(8)).toBe(false);
    expect(t.isPlayableClass(-1)).toBe(false);
  });

  it('the terrain class numbers are those of the baked pack (src/data/format.ts)', () => {
    expect([t.CLASS_DEEP_SEA, t.CLASS_SHALLOWS, t.CLASS_PLAINS, t.CLASS_FOREST, t.CLASS_HILLS, t.CLASS_MOUNTAIN, t.CLASS_PEAK, t.CLASS_ICE]).toEqual([
      TerrainClass.DeepSea,
      TerrainClass.Shallows,
      TerrainClass.Plains,
      TerrainClass.Forest,
      TerrainClass.Hills,
      TerrainClass.Mountain,
      TerrainClass.Peak,
      TerrainClass.Ice,
    ]);
    expect(t.CLASS_COUNT).toBe(8);
    expect(r.TERRAIN_COST_PCT.length).toBe(t.CLASS_COUNT);
  });

  it('conquest constants are the plan values, except CAPTURE_K_MILLI which the solo calibration moved from the plan\'s 80 to 103 (D88; it stays inside the plan\'s 0.06 to 0.15)', () => {
    expect([r.BASE_COST_TROOPS, r.D_MAX_STD, r.DEPTH_COST_DIV_STD]).toEqual([3, 40, 20]);
    expect(r.CAPTURE_K_MILLI).toBeGreaterThanOrEqual(60);
    expect(r.CAPTURE_K_MILLI).toBeLessThanOrEqual(150);
    expect([r.UPHILL_PER_STEP_MILLI, r.UPHILL_STEP_UNITS, r.UPHILL_MAX_PCT, r.ENCLAVE_FLIP_TICKS]).toEqual([250, 32, 200, 20]);
    expect(r.HEIGHT_UNIT_M).toBeGreaterThan(0);
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addTroops,
  applyStartValues,
  deductTroops,
  economyTick,
  goldMilliPerTick,
  isTribe,
  ownerCapQt,
  ownedStdAreaQ15,
  pow075Q15,
  regenMicroQtPerTick,
  troopCapQt,
} from '../../src/sim/economy';
import {
  CAP_BASE_QT,
  CAP_CITY_LEVEL_QT,
  GOLD_PER_STD_CELL_MILLI_PER_SEC,
  MAX_DECAY_MICRO_QT_PER_TICK,
  MICRO_QT_PER_QT,
  QT_PER_TROOP,
  REGEN_BASE_TROOPS_PER_SEC,
  REGEN_SQRT_COEF_MILLI,
  START_GOLD_MILLI,
  START_TROOPS_QT,
  TICK_HZ,
  WEIGHT_ONE,
} from '../../src/sim/rules';
import { withId } from '../../src/sim/intents';
import { step } from '../../src/sim/step';
import { setOwner } from '../../src/sim/territory';
import { landState } from './helpers/worlds';

const ONE = WEIGHT_ONE;
/** The real formula in doubles (tests may use Math.pow): troops per second. The constants are those of rules.ts (the tempo pass moved them from 8 and 0.35, D142). */
const REGEN_SQRT = REGEN_SQRT_COEF_MILLI / 1000;
function refRegen(t: number, tmax: number): number {
  return Math.max((REGEN_BASE_TROOPS_PER_SEC + REGEN_SQRT * Math.sqrt(t)) * (1 - t / tmax), -40);
}

describe('N^0.75 in Q15 (sqrt(N) * sqrt(sqrt(N)) with integer roots)', () => {
  it('exact on the powers that have a rational answer', () => {
    expect(pow075Q15(0)).toBe(0);
    expect(pow075Q15(ONE)).toBe(ONE); // N = 1
    expect(Math.abs(pow075Q15(16 * ONE) - 8 * ONE)).toBeLessThanOrEqual(2); // 16^0.75 = 8
    expect(Math.abs(pow075Q15(81 * ONE) - 27 * ONE)).toBeLessThanOrEqual(4); // 81^0.75 = 27
  });

  it('close to the real power for every N from 0 to the size of the world (relative error below 0.1 %, or 4 units)', () => {
    let worst = 0;
    for (let n = 0; n <= 40000; n += 7) {
      const q15 = n * ONE + ((n * 977) % ONE);
      const want = (q15 / ONE) ** 0.75 * ONE;
      worst = Math.max(worst, Math.abs(pow075Q15(q15) - want) / Math.max(want, 4000));
    }
    expect(worst).toBeLessThan(0.001);
    const small = [1, 2, 3, 100, 1000, 5000, ONE / 2];
    for (const q15 of small) expect(Math.abs(pow075Q15(q15) - (q15 / ONE) ** 0.75 * ONE)).toBeLessThanOrEqual(64);
  });

  it('is monotone and never negative or fractional', () => {
    let prev = 0;
    for (let q15 = 0; q15 < 2000000; q15 += 997) {
      const v = pow075Q15(q15);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('troop cap = 2000 + 120 * N^0.75 + 800 * cityLevels (in QT)', () => {
  it('N = 0 gives the base, N = 1 and N = 16 the plan values', () => {
    expect(troopCapQt(0, 0, false)).toBe(CAP_BASE_QT);
    expect(troopCapQt(ONE, 0, false)).toBe((2000 + 120) * QT_PER_TROOP);
    expect(Math.abs(troopCapQt(16 * ONE, 0, false) - (2000 + 120 * 8) * QT_PER_TROOP)).toBeLessThanOrEqual(1);
  });

  it('city levels add 800 troops each; a tribe has a third of the cap', () => {
    expect(troopCapQt(ONE, 2, false) - troopCapQt(ONE, 0, false)).toBe(2 * CAP_CITY_LEVEL_QT);
    for (const n of [0, ONE, 50 * ONE, 3000 * ONE]) {
      expect(troopCapQt(n, 0, true)).toBe(Math.floor(troopCapQt(n, 0, false) / 3));
    }
  });

  it('is monotone in N', () => {
    let prev = 0;
    for (let n = 0; n < 30000 * ONE; n += 41 * ONE + 5) {
      const cap = troopCapQt(n, 0, false);
      expect(cap).toBeGreaterThanOrEqual(prev);
      prev = cap;
    }
  });

  it('matches the real formula within 0.1 % over the whole range', () => {
    for (const nStd of [0.5, 3, 49, 400, 2800, 25000]) {
      const want = (2000 + 120 * nStd ** 0.75) * QT_PER_TROOP;
      const got = troopCapQt(Math.floor(nStd * ONE), 0, false);
      expect(Math.abs(got - want) / want).toBeLessThan(0.001);
    }
  });
});

describe('regeneration (micro-QT per tick)', () => {
  const tmax = troopCapQt(49 * ONE, 0, false);

  it('at T = 0 a player regenerates REGEN_BASE troops per second: exactly REGEN_BASE * 4 / 10 QT per tick', () => {
    expect(regenMicroQtPerTick(0, 8000, false)).toBe(((REGEN_BASE_TROOPS_PER_SEC * QT_PER_TROOP) / TICK_HZ) * MICRO_QT_PER_QT);
  });

  it('is positive below the cap, zero at the cap, negative above it', () => {
    expect(regenMicroQtPerTick(START_TROOPS_QT, tmax, false)).toBeGreaterThan(0);
    expect(regenMicroQtPerTick(tmax - 1, tmax, false)).toBeGreaterThan(0);
    expect(regenMicroQtPerTick(tmax, tmax, false)).toBe(0);
    expect(regenMicroQtPerTick(tmax + 4, tmax, false)).toBeLessThan(0);
  });

  it('never below -MAX_DECAY, and exactly -MAX_DECAY far above the cap', () => {
    for (const t of [tmax * 2, tmax * 3, tmax * 4, tmax * 100, 4294967295]) {
      expect(regenMicroQtPerTick(t, tmax, false)).toBeGreaterThanOrEqual(-MAX_DECAY_MICRO_QT_PER_TICK);
    }
    expect(regenMicroQtPerTick(tmax * 4, tmax, false)).toBe(-MAX_DECAY_MICRO_QT_PER_TICK);
    expect(regenMicroQtPerTick(4294967295, tmax, false)).toBe(-MAX_DECAY_MICRO_QT_PER_TICK);
  });

  it('no division by zero: Tmax = 0 (and a negative one) give 0, T = 0 works, nothing is NaN', () => {
    expect(regenMicroQtPerTick(0, 0, false)).toBe(0);
    expect(regenMicroQtPerTick(5, 0, true)).toBe(0);
    expect(regenMicroQtPerTick(0, -1, false)).toBe(0);
    expect(regenMicroQtPerTick(0, 1, false)).toBeGreaterThan(0);
    expect(Number.isNaN(regenMicroQtPerTick(0, 1, false))).toBe(false);
  });

  it('follows the real formula (per second, in troops) within 0.1 % + a hair, over the whole range below 4 x the cap', () => {
    for (const cap of [tmax, 4 * tmax, 200 * tmax]) {
      for (let k = 0; k <= 100; k++) {
        const tQt = Math.floor((cap * k * 4) / 100);
        const got = (regenMicroQtPerTick(tQt, cap, false) / MICRO_QT_PER_QT / QT_PER_TROOP) * TICK_HZ; // troops per second
        const want = refRegen(tQt / QT_PER_TROOP, cap / QT_PER_TROOP);
        expect(Math.abs(got - want), `T=${tQt} cap=${cap}`).toBeLessThan(Math.max(0.001 * Math.abs(want), 0.0001));
      }
    }
  });

  it('a tribe regenerates at half the rate (positive side) and decays like a player', () => {
    const tribeCap = Math.floor(tmax / 3);
    for (const t of [0, 100, 1000, 4000]) {
      const player = regenMicroQtPerTick(t, tribeCap, false);
      const tribe = regenMicroQtPerTick(t, tribeCap, true);
      if (player > 0) expect(tribe).toBe(Math.floor((player * 50) / 100));
    }
    expect(regenMicroQtPerTick(tribeCap * 2, tribeCap, true)).toBe(regenMicroQtPerTick(tribeCap * 2, tribeCap, false));
  });

  it('property: always an integer within [-MAX_DECAY, REGEN_BASE troops per second + REGEN_SQRT sqrt(T)] for any T and Tmax', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4294967295 }), fc.integer({ min: 0, max: 100000000 }), fc.boolean(), (t, cap, tribe) => {
        const v = regenMicroQtPerTick(t, cap, tribe);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(-MAX_DECAY_MICRO_QT_PER_TICK);
        if (cap > 0 && t <= cap) expect(v).toBeGreaterThanOrEqual(0);
        if (t >= cap) expect(v).toBeLessThanOrEqual(0);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('gold', () => {
  it('one std-cell of equatorial land brings 5 milli-gold per tick (0.05 gold per second)', () => {
    expect(goldMilliPerTick(ONE)).toBe((GOLD_PER_STD_CELL_MILLI_PER_SEC / TICK_HZ) * 1);
    expect(goldMilliPerTick(ONE)).toBe(5);
    expect(goldMilliPerTick(0)).toBe(0);
  });

  it('is proportional to the weighted land (within the floor of one milli-gold)', () => {
    for (const n of [1, 10, 49, 400, 5000]) {
      const got = goldMilliPerTick(n * ONE);
      expect(got).toBe(n * 5);
      expect(goldMilliPerTick(Math.floor(n * ONE * 1.5))).toBeGreaterThanOrEqual(Math.floor(got * 1.5) - 1);
    }
  });
});

describe('deductions never make troops negative', () => {
  it('deductTroops takes at most what is there and says how much it took', () => {
    const s = landState(8, 8);
    s.troops[1] = 100;
    expect(deductTroops(s, 1, 30)).toBe(30);
    expect(s.troops[1]).toBe(70);
    expect(deductTroops(s, 1, 1000)).toBe(70);
    expect(s.troops[1]).toBe(0);
    expect(deductTroops(s, 1, 5)).toBe(0);
    expect(s.troops[1]).toBe(0);
    expect(deductTroops(s, 1, -9)).toBe(0);
    expect(deductTroops(s, 1, 0)).toBe(0);
    expect(deductTroops(s, 1, Number.MAX_SAFE_INTEGER)).toBe(0);
  });

  it('property: any sequence of deductions and additions leaves 0 <= T <= 2^32 - 1', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), fc.integer({ min: -5, max: 5000000000 })), { maxLength: 30 }), (ops) => {
        const s = landState(2, 2);
        for (const [add, amount] of ops) {
          if (add) addTroops(s, 1, amount);
          else deductTroops(s, 1, amount);
          expect(s.troops[1]).toBeGreaterThanOrEqual(0);
          expect(s.troops[1]).toBeLessThanOrEqual(4294967295);
        }
      }),
      { numRuns: 300 },
    );
  });
});

/** A state where `owner` holds a block of w x h cells at the top left. */
function withBlock(owner: number, w: number, h: number, tribePlayers?: number) {
  const s = landState(40, 20, { seats: 6, players: tribePlayers });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setOwner(s, y * 40 + x, owner, 0);
  return s;
}

describe('the per-tick update', () => {
  it('skips owners without land: nothing changes for them', () => {
    const s = landState(8, 8);
    s.troops[2] = 777;
    s.gold[2] = 55;
    economyTick(s);
    expect(s.troops[2]).toBe(777);
    expect(s.gold[2]).toBe(55);
    expect(s.troopFrac[2]).toBe(0);
  });

  it('a seat at its start values grows towards its cap, never beyond it, and the remainder stays below one QT', () => {
    const s = withBlock(1, 14, 14); // 196 cells
    applyStartValues(s, 1);
    expect(s.troops[1]).toBe(START_TROOPS_QT);
    expect(s.gold[1]).toBe(START_GOLD_MILLI);
    const cap = ownerCapQt(s, 1);
    let prev = s.troops[1] as number;
    for (let i = 0; i < 6000; i++) {
      economyTick(s);
      const now = s.troops[1] as number;
      expect(now).toBeGreaterThanOrEqual(prev);
      expect(now).toBeLessThanOrEqual(cap);
      expect(s.troopFrac[1]).toBeLessThan(MICRO_QT_PER_QT);
      prev = now;
    }
    // ten minutes later the seat is within 10 % of its cap but has not overshot
    expect(prev / cap).toBeGreaterThan(0.9);
  });

  it('above the cap (land lost) troops decay, at most MAX_DECAY per second, and stop at the cap', () => {
    const s = withBlock(1, 4, 4);
    const cap = ownerCapQt(s, 1);
    s.troops[1] = cap * 3;
    const before = s.troops[1] as number;
    economyTick(s);
    // one tick loses at most 16 QT (4 troops) + the carry
    expect(before - (s.troops[1] as number)).toBeLessThanOrEqual(17);
    expect(s.troops[1]).toBeLessThan(before);
    for (let i = 0; i < 30000; i++) economyTick(s);
    expect(s.troops[1]).toBeLessThanOrEqual(cap + 1);
    expect(s.troops[1]).toBeGreaterThan(cap * 0.99);
  });

  it('gold comes in from weighted land and saturates at 2^32 - 1', () => {
    const s = withBlock(1, 14, 14);
    const n = ownedStdAreaQ15(s, 1);
    economyTick(s);
    expect(s.gold[1]).toBe(goldMilliPerTick(n));
    s.gold[1] = 4294967290;
    economyTick(s);
    expect(s.gold[1]).toBe(4294967295);
  });

  it('a tribe has a third of the cap and regenerates slower; players and tribes are told apart by the header', () => {
    const s = withBlock(2, 14, 14, 1); // 1 player, seats 2..6 are tribes
    expect(isTribe(s, 1)).toBe(false);
    expect(isTribe(s, 2)).toBe(true);
    expect(ownerCapQt(s, 2)).toBe(Math.floor(troopCapQt(ownedStdAreaQ15(s, 2), 0, false) / 3));
    const p = withBlock(1, 14, 14, 1);
    s.troops[2] = 100;
    p.troops[1] = 100;
    const rt = regenMicroQtPerTick(100, ownerCapQt(s, 2), true);
    const rp = regenMicroQtPerTick(100, ownerCapQt(p, 1), false);
    expect(rt).toBeLessThan(rp);
    expect(rt).toBeGreaterThan(0);
  });

  it('the start troops are clamped to the cap', () => {
    const s = landState(4, 4, { seats: 3, players: 1 });
    // a tribe with one cell: cap/3 = about 689 troops, below the 1200 start troops
    setOwner(s, 0, 2, 0);
    applyStartValues(s, 2);
    expect(s.troops[2]).toBe(ownerCapQt(s, 2));
    expect(s.troops[2]).toBeLessThan(START_TROOPS_QT);
    expect(s.gold[2]).toBe(START_GOLD_MILLI);
  });
});

describe('economyTick integrated over thousands of ticks (the carry of the sub-QT remainder between ticks)', () => {
  /** A spawned seat on a 64x64 plain: 197 cells, a constant cap, and the first tick (the spawn) run. */
  function spawned(): { s: ReturnType<typeof landState>; cap: number } {
    const s = landState(64, 64, { seats: 2 });
    step(s, { turn: 0, intents: [withId({ kind: 'Spawn', seat: 0, cell: 32 * 64 + 32 }, 0)] });
    return { s, cap: ownerCapQt(s, 1) };
  }

  it('the troops follow the closed-form regeneration law (dT/dt = (REGEN_BASE + REGEN_SQRT sqrt(T)) (1 - T/Tmax), integrated by RK4 in doubles) within 0.1 % at 1200, 2400, ... 6000 ticks; a dropped remainder would be 4 to 6 % off', () => {
    const { s, cap } = spawned();
    let t = (s.troops[1] as number) / QT_PER_TROOP; // troops, as a float
    const tmax = cap / QT_PER_TROOP;
    const rate = (x: number): number => refRegen(x, tmax);
    const h = 1 / TICK_HZ;
    let worst = 0;
    for (let k = 1; k <= 6000; k++) {
      step(s, { turn: s.tick, intents: [] });
      const k1 = rate(t);
      const k2 = rate(t + (h * k1) / 2);
      const k3 = rate(t + (h * k2) / 2);
      const k4 = rate(t + h * k3);
      t += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      expect(s.troopFrac[1], `tick ${k}`).toBeLessThan(MICRO_QT_PER_QT);
      if (k % 1200 === 0) {
        const sim = (s.troops[1] as number) / QT_PER_TROOP;
        worst = Math.max(worst, Math.abs(sim / t - 1));
        expect(sim / t - 1, `tick ${k}: sim ${sim}, law ${t}`).toBeGreaterThan(-0.001);
        expect(sim / t - 1, `tick ${k}: sim ${sim}, law ${t}`).toBeLessThan(0.001);
      }
    }
    console.log(`[economy] 6000 ticks against the closed-form law: worst relative difference ${(worst * 100).toFixed(4)} %`);
  });

  it('a seat reaches its cap (within 0.1 %, never above it) and the remainder stays below one QT on the way', () => {
    const { s, cap } = spawned();
    for (let k = 0; k < 16000; k++) {
      step(s, { turn: s.tick, intents: [] });
      expect(s.troopFrac[1]).toBeLessThan(MICRO_QT_PER_QT);
      expect(s.troops[1] as number).toBeLessThanOrEqual(cap);
    }
    expect(s.troops[1] as number).toBeGreaterThanOrEqual(cap * 0.999);
  });
});

import { describe, expect, it } from 'vitest';
import {
  MAX_FACTOR,
  MIN_FACTOR,
  REFERENCE_MS,
  budgetMs,
  calibrationFactor,
  clampFactor,
  createPerfGuard,
  measureMedianMs,
  measureP99Ms,
  percentile,
  referenceWorkloadMs,
} from './perfguard';

describe('perfguard clamping (injected measurements)', () => {
  it('clamps a very fast machine to the lower bound', () => {
    const g = createPerfGuard(() => REFERENCE_MS * 0.01);
    expect(g.factor).toBe(MIN_FACTOR);
    expect(g.budgetMs(10)).toBe(10 * MIN_FACTOR);
  });
  it('clamps a very slow machine to the upper bound', () => {
    const g = createPerfGuard(() => REFERENCE_MS * 100);
    expect(g.factor).toBe(MAX_FACTOR);
    expect(g.budgetMs(10)).toBe(10 * MAX_FACTOR);
  });
  it('passes an in-range factor through unchanged', () => {
    const g = createPerfGuard(() => REFERENCE_MS * 1.5);
    expect(g.factor).toBeCloseTo(1.5, 10);
    expect(g.budgetMs(100)).toBeCloseTo(150, 8);
  });
  it('treats a non-finite measurement as factor 1', () => {
    expect(clampFactor(Number.NaN)).toBe(1);
    expect(clampFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('perfguard helpers', () => {
  it('percentile uses nearest rank', () => {
    const v = Array.from({ length: 200 }, (_, i) => i + 1);
    expect(percentile(v, 99)).toBe(198);
    expect(percentile(v, 100)).toBe(200);
  });
  it('refuses fewer than 5 runs / 2 warm-ups / 200 p99 samples', () => {
    expect(() => measureMedianMs(() => {}, { runs: 4 })).toThrow();
    expect(() => measureMedianMs(() => {}, { warmups: 1 })).toThrow();
    expect(() => measureP99Ms(() => {}, { runs: 199 })).toThrow();
  });
});

describe('perfguard process calibration', () => {
  it('has a clamped factor for this process', () => {
    const f = calibrationFactor();
    expect(f).toBeGreaterThanOrEqual(MIN_FACTOR);
    expect(f).toBeLessThanOrEqual(MAX_FACTOR);
  });
  // Budget statistic: median of 5 runs after 2 warm-ups. Nominal 5.5 ms for 5 M imul/array writes; budget 8x nominal.
  it('reference workload stays within a generous calibrated budget (median of 5)', () => {
    const med = measureMedianMs(() => {
      referenceWorkloadMs();
    });
    expect(med).toBeLessThanOrEqual(budgetMs(REFERENCE_MS * 8));
  });
});

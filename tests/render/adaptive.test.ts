// AutoTier-2 (D160): the adaptive-resolution regulator against a synthetic cost model (time = a + b * pixels). The named "mutant" tests run
// the same scenario on a regulator with one rule broken and require the scenario to FAIL there: they prove that the checks can fail.
import { describe, expect, it } from 'vitest';
import { ADAPTIVE_DEFAULTS, AdaptiveResolution, type AdaptiveConfig } from '../../src/render/adaptive';
import { ADAPT_DOWN_MS, ADAPT_MIN_INTERVAL_MS, ADAPT_SCALES, ADAPT_UP_MS, ADAPT_WARMUP_FRAMES, ADAPT_WINDOW } from '../../src/render/config';

/** Feeds `frames` frames; the time of frame i comes from `ms(i, reg)`. */
function run(reg: AdaptiveResolution, frames: number, ms: (i: number, reg: AdaptiveResolution) => number): void {
  for (let i = 0; i < frames; i++) reg.push(ms(i, reg));
}
const model = (a: number, b: number) => (_i: number, reg: AdaptiveResolution) => a + b * reg.scale * reg.scale * (reg.densityReduced ? 0.9 : 1);

describe('AdaptiveResolution: the model', () => {
  it('the defaults are the documented ones', () => {
    expect(ADAPT_SCALES).toEqual([1, 0.85, 0.72, 0.6, 0.5]);
    expect([ADAPT_WINDOW, ADAPT_WARMUP_FRAMES, ADAPT_DOWN_MS, ADAPT_UP_MS]).toEqual([30, 90, 30, 18]);
    expect(ADAPTIVE_DEFAULTS.downWindows).toBe(2);
    expect(ADAPTIVE_DEFAULTS.upWindows).toBe(4);
  });

  it('finds the highest scale that fits the budget and then holds it (time = 8 + 60 s^2 -> 0.6)', () => {
    const reg = new AdaptiveResolution();
    run(reg, 3000, model(8, 60));
    expect(reg.scale).toBe(0.6);
    const stepsAtConvergence = reg.steps.length;
    run(reg, 3000, model(8, 60));
    expect(reg.steps.length).toBe(stepsAtConvergence); // stable
    expect(reg.scale).toBe(0.6);
    expect(8 + 60 * 0.6 * 0.6).toBeLessThan(ADAPT_DOWN_MS);
    expect(8 + 60 * 0.72 * 0.72).toBeGreaterThan(ADAPT_DOWN_MS); // the next scale up would not fit
    expect(reg.densityReduced).toBe(false);
    expect(reg.scaleMin).toBe(0.6);
    expect(reg.scaleMean).toBeLessThan(1);
  });

  it('an even load that fits does not change anything, and a noisy one at the edge does not swing', () => {
    const reg = new AdaptiveResolution();
    run(reg, 6000, (i) => 24 + ((i * 7) % 11) - 5); // 19 to 29 ms, median 24: between the bands
    expect(reg.steps.length).toBe(0);
    const fast = new AdaptiveResolution();
    run(fast, 6000, () => 12);
    expect(fast.steps.length).toBe(0);
    expect(fast.scale).toBe(1);
    const edge = new AdaptiveResolution();
    run(edge, 20000, (i, r) => 6 + 56 * r.scale * r.scale + (((i * 13) % 7) - 3));
    expect(edge.steps.length).toBeLessThanOrEqual(6);
  });

  it('goes up again when the load drops, one step at a time, and ends at 1', () => {
    const reg = new AdaptiveResolution();
    run(reg, 3000, model(8, 60));
    expect(reg.scale).toBe(0.6);
    run(reg, 6000, model(8, 20)); // 15 ms at 0.6: up while under 18, stops where the time reaches the band
    expect(reg.scale).toBeGreaterThan(0.6);
    run(reg, 6000, model(8, 5));
    expect(reg.scale).toBe(1);
    for (let i = 1; i < reg.steps.length; i++) expect(Math.abs((reg.steps[i] as { index: number }).index - (reg.steps[i - 1] as { index: number }).index)).toBe(1);
  });

  it('changes are at least ADAPT_MIN_INTERVAL_MS of frame time apart', () => {
    const reg = new AdaptiveResolution();
    const at: number[] = [];
    let t = 0;
    for (let i = 0; i < 4000; i++) {
      const ms = i < 600 ? 60 : 10; // slow, then very fast
      t += ms;
      if (reg.push(ms)) at.push(t);
    }
    expect(at.length).toBeGreaterThan(3);
    for (let i = 1; i < at.length; i++) expect((at[i] as number) - (at[i - 1] as number)).toBeGreaterThanOrEqual(ADAPT_MIN_INTERVAL_MS);
  });

  it('ignores a stall (a tab switch) and a negative or NaN interval', () => {
    const reg = new AdaptiveResolution();
    run(reg, 200, () => 12);
    for (const v of [5000, Number.NaN, -3]) expect(reg.push(v)).toBe(false);
    run(reg, 600, (i) => (i === 40 ? 5000 : 12));
    expect(reg.steps.length).toBe(0);
  });
});

/** A scenario returns true when the regulator behaved as the rules say. Each mutant must make its scenario return false. */
const spikes = (cfg: Partial<AdaptiveConfig>): boolean => {
  const reg = new AdaptiveResolution(cfg);
  run(reg, 1500, (i) => (i % 10 === 9 ? 250 : 12)); // a median of 12, a mean of 36
  return reg.steps.length === 0;
};
const warmup = (cfg: Partial<AdaptiveConfig>): boolean => {
  const reg = new AdaptiveResolution(cfg);
  run(reg, ADAPT_WARMUP_FRAMES, () => 100); // shader compilation at the start
  run(reg, 600, () => 12);
  return reg.steps.length === 0;
};
const hysteresis = (cfg: Partial<AdaptiveConfig>): boolean => {
  // Windows of 35 ms and 10 ms alternate: a slow window is never followed by a second one, a fast one never by three more.
  const reg = new AdaptiveResolution(cfg);
  run(reg, ADAPT_WARMUP_FRAMES, () => 12);
  run(reg, 60 * ADAPT_WINDOW, (i) => (Math.floor(i / ADAPT_WINDOW) % 2 === 0 ? 35 : 10));
  // And a load in the band between the two limits from a lowered state: nothing moves.
  const low = new AdaptiveResolution(cfg);
  run(low, 1500, model(8, 60));
  const before = low.steps.length;
  run(low, 3000, () => 24);
  return reg.steps.length === 0 && low.steps.length === before;
};
const densityStep = (cfg: Partial<AdaptiveConfig>): boolean => {
  const reg = new AdaptiveResolution(cfg);
  run(reg, 4000, () => 100); // hopeless
  const idxAtDensity = reg.steps.find((s) => s.densityReduced)?.index;
  return reg.scale === 0.5 && reg.densityReduced && idxAtDensity === ADAPT_SCALES.length - 1;
};

describe('AdaptiveResolution: mutants are killed', () => {
  it('spikes: the median ignores them; the mutant "mean instead of median" does not', () => {
    expect(spikes({})).toBe(true);
    expect(spikes({ statistic: 'mean' })).toBe(false);
  });
  it('warm-up: the first frames are ignored; the mutant "no warm-up" steps down on them', () => {
    expect(warmup({})).toBe(true);
    expect(warmup({ warmupFrames: 0 })).toBe(false);
  });
  it('hysteresis: alternating windows and the band between the limits hold; the mutant "no hysteresis" moves', () => {
    expect(hysteresis({})).toBe(true);
    expect(hysteresis({ downWindows: 1, upWindows: 1, upMs: ADAPT_DOWN_MS })).toBe(false);
  });
  it('chunk density: stepped down only after the smallest scale, once; the mutant "no density step" never does', () => {
    expect(densityStep({})).toBe(true);
    expect(densityStep({ densityStep: false })).toBe(false);
  });
  it('the density comes back only when the scale is 1 again, after the fast frames', () => {
    const reg = new AdaptiveResolution();
    run(reg, 4000, () => 100);
    expect(reg.densityReduced).toBe(true);
    expect(reg.density).toBeLessThan(1);
    let restoredAtIndex = -1;
    for (let i = 0; i < 20000 && reg.densityReduced; i++) {
      reg.push(8);
      if (!reg.densityReduced) restoredAtIndex = reg.stepIndex;
    }
    expect(restoredAtIndex).toBe(0);
    expect(reg.density).toBe(1);
  });
  it('one slow window followed by a fast one does not step down (the down count needs two in a row)', () => {
    const reg = new AdaptiveResolution();
    run(reg, ADAPT_WARMUP_FRAMES, () => 12);
    run(reg, ADAPT_WINDOW, () => 60);
    run(reg, 10 * ADAPT_WINDOW, () => 12);
    expect(reg.steps.length).toBe(0);
  });
});

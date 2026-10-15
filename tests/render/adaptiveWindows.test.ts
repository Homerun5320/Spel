// Fix-UI: WHEN the adaptive regulator steps (the audit's surviving mutants D01 to D26). The smooth-input tests of adaptive.test.ts never pin the counts of
// windows, the reset rules, the even-window median, the guards against NaN and tab switches, or the floor. Defaults: window 30, warm-up 90 frames,
// down above 30 ms twice in a row, up below 18 ms four times in a row, changes at least 2000 ms of frame time apart.
import { describe, expect, it } from 'vitest';
import { AdaptiveResolution } from '../../src/render/adaptive';
import { ADAPT_WARMUP_FRAMES, ADAPT_WINDOW } from '../../src/render/config';

/** Feeds `n` frames of `ms`; returns the 1-based positions at which push() said "changed". */
function feed(a: AdaptiveResolution, ms: number, n: number): number[] {
  const at: number[] = [];
  for (let i = 1; i <= n; i++) if (a.push(ms)) at.push(i);
  return at;
}
const warmed = (): AdaptiveResolution => {
  const a = new AdaptiveResolution();
  expect(feed(a, 20, ADAPT_WARMUP_FRAMES)).toEqual([]);
  return a;
};

describe('the regulator steps exactly when the documented counts say', () => {
  it('constants of the tests: a window is 30 frames and the warm-up 90', () => {
    expect(ADAPT_WINDOW).toBe(30);
    expect(ADAPT_WARMUP_FRAMES).toBe(90);
  });

  it('exactly 60 slow frames after the warm-up step down, not 59 and not 90 (two windows, no waiting for the interval the first time)', () => {
    const a = warmed();
    expect(feed(a, 31, 59)).toEqual([]); // 31 ms: slow, and 60 frames are only 1860 ms (under the 2000 ms interval)
    expect(a.push(31)).toBe(true);
    expect(a.scale).toBe(0.85);
    expect(a.steps.length).toBe(1);
    expect(a.steps[0]?.frame).toBe(60);
  });

  it('the warm-up is exactly 90 frames: frames inside it never count, the 91st does', () => {
    const a = new AdaptiveResolution();
    expect(feed(a, 31, 90)).toEqual([]);
    expect(a.scaleMean).toBe(1); // nothing counted yet
    expect(feed(a, 31, 59)).toEqual([]);
    expect(a.push(31)).toBe(true);
  });

  it('the next step down also waits for the 2000 ms interval of frame time: 31 ms frames step again after 90 frames, not 60', () => {
    const a = warmed();
    feed(a, 31, 60);
    expect(feed(a, 31, 89)).toEqual([]); // two slow windows again (60 frames) but only 1860 ms since the change
    expect(a.push(31)).toBe(true); // the third window: 2790 ms
    expect(a.scale).toBe(0.72);
  });

  it('up needs four fast windows (120 frames) AND the interval: 15 ms frames step up on frame 150, not 90 or 120', () => {
    const a = warmed();
    feed(a, 40, 60); // down to 0.85
    expect(feed(a, 15, 149)).toEqual([]); // frame 120 has four fast windows but only 1800 ms since the change
    expect(a.push(15)).toBe(true);
    expect(a.scale).toBe(1);
  });

  it('a window between the limits resets the counts: slow, in-between, slow does not step', () => {
    const a = warmed();
    expect(feed(a, 40, 30)).toEqual([]);
    expect(feed(a, 24, 30)).toEqual([]); // between 18 and 30 ms
    expect(feed(a, 40, 30)).toEqual([]); // one slow window again, not two in a row
    expect(a.scale).toBe(1);
  });

  it('a slow window resets the fast count: three fast windows, a slow one, then three more fast ones do not step up', () => {
    const a = warmed();
    feed(a, 40, 60); // 0.85
    expect(feed(a, 15, 90)).toEqual([]); // three fast windows (the interval is not yet reached either)
    expect(feed(a, 40, 30)).toEqual([]); // a slow window: the fast count starts over
    expect(feed(a, 15, 90)).toEqual([]); // three fast windows only
    expect(a.scale).toBe(0.85);
    expect(feed(a, 15, 30)).toEqual([30]); // the fourth in a row
  });

  it('the median of an even window is the mean of the two middle values (15 x 20 ms + 15 x 50 ms = 35 ms)', () => {
    const a = warmed();
    const changes: number[] = [];
    for (let w = 0; w < 2; w++) {
      for (let i = 0; i < 15; i++) if (a.push(20)) changes.push(1);
      for (let i = 0; i < 15; i++) if (a.push(50)) changes.push(1);
    }
    expect(changes.length).toBe(1);
    expect(a.steps[0]?.statMs).toBe(35);
  });

  it('NaN, negative intervals and tab switches (over 1000 ms) are not frames: they complete no window', () => {
    const a = warmed();
    feed(a, 40, 59);
    expect(a.push(Number.NaN)).toBe(false);
    expect(a.push(-5)).toBe(false);
    expect(a.push(1001)).toBe(false);
    expect(a.push(Number.POSITIVE_INFINITY)).toBe(false);
    expect(a.steps.length).toBe(0);
    expect(a.push(40)).toBe(true); // the 60th REAL slow frame
  });

  it('a hopeless load changes exactly five times (four scales, then the density once) and never again; recovery undoes it step by step', () => {
    const a = warmed();
    const down = feed(a, 100, 3000);
    expect(down.length).toBe(5);
    expect(a.steps.length).toBe(5);
    expect(a.scale).toBe(0.5);
    expect(a.densityReduced).toBe(true);
    expect(a.density).toBe(0.7);
    expect(a.scaleMin).toBe(0.5);
    const up = feed(a, 10, 6000);
    expect(up.length).toBe(5); // four scales back, then the density (only once the scale is 1 again)
    expect(a.scale).toBe(1);
    expect(a.densityReduced).toBe(false);
    expect(a.density).toBe(1);
    expect(a.steps.length).toBe(10);
  });

  it('scaleMean and scaleMin follow the frames counted after the warm-up', () => {
    const a = warmed();
    feed(a, 40, 60); // 60 frames at scale 1 (the step happens on the 60th), then 0.85
    feed(a, 24, 60); // in-between frames: no further change
    expect(a.scale).toBe(0.85);
    expect(a.scaleMean).toBeCloseTo((60 * 1 + 60 * 0.85) / 120, 9);
    expect(a.scaleMin).toBe(0.85);
  });
});

// M08 item 5: the numbers the performance scene reports (src/ui/perfSceneReport.ts): the cadence histogram, the display refresh units, the
// capped-frame-rate verdict and the recorder, on synthetic frame series. Every assertion can fail: the verdict tests carry the series that
// must NOT be called capped next to the one that must.
import { describe, expect, it } from 'vitest';
import { PERF_CADENCE_EDGES_MS, PERF_MAX_FRAMES, PerfRecorder, cadenceCounts, cappedVerdict, refreshUnitShares } from '../src/ui/perfSceneReport';

const META = { completed: true, quick: false, fxDurationS: 12, canvas: { cssWidth: 1920, cssHeight: 1080, pixelWidth: 1920, pixelHeight: 1080, dpr: 1, devicePixelRatio: 1.25 }, phaseNames: ['a', 'b', 'c'] } as const;

describe('cadence histogram', () => {
  it('puts each interval in the bin [edge, next edge) and the slow tail in the last bin', () => {
    const e = PERF_CADENCE_EDGES_MS;
    const counts = cadenceCounts([5.9, 6, 8.99, 9, 16.6, 16.7, 33.3, 99.9, 100, 4000]);
    expect(counts.length).toBe(e.length);
    expect(counts[0]).toBe(1); // 5.9
    expect(counts[1]).toBe(2); // 6, 8.99
    expect(counts[2]).toBe(1); // 9
    expect(counts[3]).toBe(2); // 16.6, 16.7 are in [12.5, 18)
    expect(counts[4]).toBe(0);
    expect(counts[5]).toBe(1); // 33.3 in [25, 36)
    expect(counts[8]).toBe(1); // 99.9 in [75, 100)
    expect(counts[9]).toBe(2); // 100, 4000
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('refresh-unit shares count a frame by the whole number of display intervals it lasted', () => {
    const r = 1000 / 60;
    const frames = [r, r * 1.1, r * 2, r * 2.2, r * 1.9, r * 3, r * 7, r * 2.4, r * 0.9, r * 2];
    const s = refreshUnitShares(frames, r);
    expect(s).toEqual({ x1: 0.3, x2: 0.5, x3: 0.1, x4plus: 0.1 });
    expect(refreshUnitShares(frames, 0)).toEqual({ x1: 0, x2: 0, x3: 0, x4plus: 0 });
    expect(refreshUnitShares([], r)).toEqual({ x1: 0, x2: 0, x3: 0, x4plus: 0 });
  });
});

describe('the capped-frame-rate verdict', () => {
  const R = 1000 / 60;
  it('calls a rate locked to two display intervals in EVERY phase capped, and names the multiple', () => {
    const v = cappedVerdict(R, [{ frames: 100, medianMs: 33.3 }, { frames: 200, medianMs: 33.4 }, { frames: 150, medianMs: 33.2 }], 33.3, null);
    expect(v.verdict).toBe('likely-capped');
    expect(v.lockedMultiple).toBe(2);
    expect(v.note).toContain('2 refresh intervals');
  });
  it('does not call a slow GPU capped: medians that move with the work are "unclear"', () => {
    const v = cappedVerdict(R, [{ frames: 100, medianMs: 20 }, { frames: 200, medianMs: 33.3 }, { frames: 150, medianMs: 52 }], 33.3, null);
    expect(v.verdict).toBe('unclear');
    expect(v.lockedMultiple).toBe(0);
  });
  it('one phase that is not on the multiple breaks the lock; a phase with fewer than 10 frames does not count', () => {
    const broken = cappedVerdict(R, [{ frames: 100, medianMs: 33.3 }, { frames: 100, medianMs: 45 }], 33.3, null);
    expect(broken.verdict).toBe('unclear');
    const short = cappedVerdict(R, [{ frames: 100, medianMs: 33.3 }, { frames: 9, medianMs: 70 }], 33.3, null);
    expect(short.verdict).toBe('likely-capped');
  });
  it('a scene that runs at the display rate is "none"; a 144 Hz display at 72 fps is capped at 2', () => {
    expect(cappedVerdict(R, [{ frames: 300, medianMs: 16.7 }], 16.7, null).verdict).toBe('none');
    const hz144 = 1000 / 144;
    const v = cappedVerdict(hz144, [{ frames: 300, medianMs: 2 * hz144 }, { frames: 300, medianMs: 2 * hz144 * 1.02 }], 2 * hz144, null);
    expect(v.verdict).toBe('likely-capped');
    expect(v.lockedMultiple).toBe(2);
  });
  it('is unknown without a measured refresh or without enough frames', () => {
    expect(cappedVerdict(0, [{ frames: 100, medianMs: 33 }], 33, null).verdict).toBe('unknown');
    expect(cappedVerdict(R, [{ frames: 3, medianMs: 33 }], 33, null).verdict).toBe('unknown');
  });
  it('adds the GPU busy time to the note when the timer measured it', () => {
    const v = cappedVerdict(R, [{ frames: 100, medianMs: 33.3 }], 33.3, 6.2);
    expect(v.verdict).toBe('likely-capped');
    expect(v.note).toContain('6.2 ms');
  });
});

describe('PerfRecorder', () => {
  function fill(): PerfRecorder {
    const rec = new PerfRecorder();
    for (let i = 0; i < 12; i++) rec.probe(16.7);
    for (let i = 0; i < 100; i++) rec.frame(i < 95 ? 10 : 50, 2, 3 + (i % 2), 1000 * (i + 1), 5 + (i % 7), 10_000 - i * 50, i < 40 ? 0 : i < 70 ? 1 : 2);
    for (const g of [3, 4, 5]) rec.gpuSample(g);
    return rec;
  }
  it('summarises mean, p95, max, the maxima of the counters and the lowest height', () => {
    const s = fill().section(META, true);
    expect(s.frames).toBe(100);
    expect(s.truncated).toBe(false);
    expect(s.frameMs.mean).toBe(12);
    expect(s.frameMs.p95).toBe(10);
    expect(s.frameMs.max).toBe(50);
    expect(s.fps.mean).toBeCloseTo(83.33, 1);
    expect(s.maxTriangles).toBe(100_000);
    expect(s.maxDrawCalls).toBe(4);
    expect(s.maxChunks).toBe(11);
    expect(s.minAglM).toBe(5050);
    expect(s.durationS).toBeCloseTo(1.2, 3);
    expect(s.canvas).toEqual(META.canvas);
    expect(s.refresh).toEqual({ measured: true, samples: 12, medianIntervalMs: 16.7, hz: 59.9 });
    expect(s.cpuMs).toEqual({ mean: 2, p95: 2 });
    expect(s.gpuMs).toEqual({ available: true, samples: 3, mean: 4, p95: 5 });
  });
  it('splits the frames into the named phases', () => {
    const s = fill().section(META, false);
    expect(s.phases.map((p) => [p.name, p.frames])).toEqual([['a', 40], ['b', 30], ['c', 30]]);
    expect(s.phases[0]?.maxTriangles).toBe(40_000);
    expect(s.phases[2]?.maxChunks).toBe(11);
    expect(s.phases[2]?.meanMs).toBeCloseTo((25 * 10 + 5 * 50) / 30, 1);
    expect(s.gpuMs.available).toBe(false); // the page said the timer is off, whatever was fed
  });
  it('the cadence counts add up to the frames and the units sum to 1', () => {
    const s = fill().section(META, true);
    expect(s.cadence.counts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(s.cadence.edgesMs).toEqual([...PERF_CADENCE_EDGES_MS]);
    const u = s.cadence.refreshUnits;
    expect(u.x1 + u.x2 + u.x3 + u.x4plus).toBeCloseTo(1, 2);
  });
  it('ignores non-finite and non-positive intervals, never records past its size and says so', () => {
    const rec = new PerfRecorder();
    rec.frame(Number.NaN, 1, 1, 1, 1, 1, 0);
    rec.frame(0, 1, 1, 1, 1, 1, 0);
    rec.frame(-4, 1, 1, 1, 1, 1, 0);
    rec.probe(Number.NaN);
    rec.gpuSample(-1);
    expect(rec.frames).toBe(0);
    expect(rec.probeSamples).toBe(0);
    for (let i = 0; i < PERF_MAX_FRAMES + 5; i++) rec.frame(10, 1, 1, 1, 1, 1, 0);
    const s = rec.section(META, false);
    expect(s.frames).toBe(PERF_MAX_FRAMES + 5);
    expect(s.truncated).toBe(true);
    expect(s.cadence.counts.reduce((a, b) => a + b, 0)).toBe(PERF_MAX_FRAMES);
  });
  it('an empty recorder gives a section of finite zeros and an unknown verdict', () => {
    const s = new PerfRecorder().section(META, false);
    expect(s.frames).toBe(0);
    expect(s.frameMs).toEqual({ mean: 0, p95: 0, max: 0 });
    expect(s.minAglM).toBe(0);
    expect(s.cappedHint.verdict).toBe('unknown');
    expect(s.refresh.measured).toBe(false);
    expect(JSON.stringify(s)).not.toContain('null');
  });
  it('a 30 fps lock on a 60 Hz display, recorded end to end, is judged capped', () => {
    const rec = new PerfRecorder();
    for (let i = 0; i < 60; i++) rec.probe(16.67);
    for (let i = 0; i < 300; i++) rec.frame(33.33 + (i % 3) * 0.2, 1.5, 4, 20_000 * (1 + (i % 5)), 10, 500, i % 3); // very different work, the same rate
    const s = rec.section(META, true);
    expect(s.cappedHint.verdict).toBe('likely-capped');
    expect(s.cadence.refreshUnits.x2).toBeGreaterThan(0.95);
  });
});

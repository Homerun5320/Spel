import { describe, expect, it } from 'vitest';
import { FrameStats } from '../src/ui/frameStats';
import { buildPerfReport, PERF_SCHEMA_VERSION, perfLines } from '../src/ui/perfOverlay';

describe('FrameStats', () => {
  it('mean fps and p95 frame time over a known series', () => {
    const s = new FrameStats(200);
    for (let i = 0; i < 95; i++) s.push(10); // 100 fps
    for (let i = 0; i < 5; i++) s.push(50); // the slowest 5 %
    expect(s.frames).toBe(100);
    expect(s.meanMs()).toBeCloseTo(12, 6);
    expect(s.meanFps()).toBeCloseTo(1000 / 12, 6);
    expect(s.p95Ms()).toBe(10); // index ceil(0.95 * 100) - 1 = 94: the last 10 ms frame
    s.push(50);
    expect(s.p95Ms()).toBe(50);
    expect(s.p95Fps()).toBe(20);
  });

  it('is empty-safe, ignores bad values and keeps only the window', () => {
    const s = new FrameStats(4);
    expect([s.meanFps(), s.p95Ms(), s.p95Fps()]).toEqual([0, 0, 0]);
    s.push(NaN);
    s.push(-3);
    s.push(0);
    expect(s.frames).toBe(0);
    for (const v of [100, 100, 100, 100, 10, 10, 10, 10]) s.push(v);
    expect(s.frames).toBe(8);
    expect(s.meanMs()).toBe(10); // the window holds only the last four
  });
});

describe('perf report', () => {
  const snapshot = { renderer: 'R', vendor: 'V', glVersion: 'WebGL 2.0', webgl2: true, drawCalls: 3, triangles: 74560, geometries: 3, textures: 6, textureMB: 20.5, width: 960, height: 540, dpr: 1, tier: 'test' };
  it('has a schemaVersion, the renderer.info counters, texture MB and fps mean and p95', () => {
    const stats = new FrameStats();
    for (let i = 0; i < 20; i++) stats.push(16);
    const r = buildPerfReport({ snapshot: () => snapshot, stats, mode: { test: '1' } });
    expect(r.schemaVersion).toBe(PERF_SCHEMA_VERSION);
    expect(r).toMatchObject({ kind: 'perf', renderer: 'R', tier: 'test', textureMB: 20.5, renderInfo: { calls: 3, triangles: 74560, geometries: 3, textures: 6 } });
    expect(r.fps.mean).toBeCloseTo(62.5, 1);
    expect(r.fps.p95).toBeCloseTo(62.5, 1);
    expect(r.fps.frames).toBe(20);
    expect(perfLines(r).join('\n')).toMatch(/Renderer: R[\s\S]*fps: 62\.5 medel/);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
  it('without frames (test mode) the overlay says so', () => {
    const r = buildPerfReport({ snapshot: () => snapshot, stats: new FrameStats(), mode: {} });
    expect(perfLines(r).join('\n')).toMatch(/ingen ram/);
  });
});

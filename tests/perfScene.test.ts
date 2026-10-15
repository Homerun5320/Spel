// M08 item 5: the script of the performance scene (src/app/perfScene.ts) on a fake host and a fake fx clock: the phases run in order, a phase
// waits for its flight, the rests are fx time, the refresh probe draws nothing, the quick script skips the probe, and the run ends.
import { describe, expect, it } from 'vitest';
import type { ViewState } from '../src/render/camera';
import type { FlyOptions } from '../src/render/flyTo';
import { PERF_CONTINENT_KM, PERF_GROUND_AGL_M, PERF_HOLD_S, PERF_ORBIT_KM, PERF_PHASE_NAMES, PERF_PROBE_FRAMES, PERF_PROBE_SKIP, PERF_QUICK_FLIGHT_S, PERF_VALLEY_AGL_M, PerfSceneRun, type PerfSceneHost } from '../src/app/perfScene';

interface Call {
  at: number;
  kind: 'setView' | 'flyTo';
  lat: number;
  lon: number;
  distKm: number;
  options?: FlyOptions;
}

function fakeWorld(): { host: PerfSceneHost; calls: Call[]; clock: { t: number }; flightEnd: { t: number }; setAgl(v: number): void; gpu: number[] } {
  const clock = { t: 0 };
  const flightEnd = { t: -1 };
  const calls: Call[] = [];
  let agl = 1e7;
  const gpu: number[] = [];
  const host: PerfSceneHost = {
    setView: (v: ViewState) => {
      calls.push({ at: clock.t, kind: 'setView', lat: v.lat, lon: v.lon, distKm: v.distKm });
      agl = 1e7;
    },
    flyTo: (lat, lon, distKm, options) => {
      calls.push({ at: clock.t, kind: 'flyTo', lat, lon, distKm, ...(options ? { options } : {}) });
      flightEnd.t = clock.t + (options?.durationS ?? 3);
    },
    flightActive: () => clock.t < flightEnd.t,
    cameraAglM: () => agl,
    counters: () => ({ calls: 4, triangles: 50_000, chunks: 20 }),
    canvas: () => ({ cssWidth: 800, cssHeight: 450, pixelWidth: 800, pixelHeight: 450, dpr: 1, devicePixelRatio: 1 }),
    gpuMs: () => gpu.shift() ?? null,
    gpuAvailable: () => true,
  };
  return { host, calls, clock, flightEnd, setAgl: (v) => (agl = v), gpu };
}

function drive(run: PerfSceneRun, w: ReturnType<typeof fakeWorld>, dt: number, maxFrames = 100_000): number {
  let n = 0;
  while (!run.done && n < maxFrames) {
    w.clock.t += dt;
    run.beforeFrame();
    w.setAgl(Math.max(300, 1e7 * 0.9 ** n));
    run.afterFrame(dt * 1000, 1);
    n++;
  }
  return n;
}

describe('the performance scene script', () => {
  it('flies orbit -> continent -> valley -> 300 m -> cruise over the Himalaya, in that order, and ends', () => {
    const w = fakeWorld();
    const run = new PerfSceneRun(w.host, { quick: true, now: () => w.clock.t });
    expect(run.probing).toBe(false);
    const frames = drive(run, w, 1 / 30);
    expect(run.done).toBe(true);
    expect(frames).toBeGreaterThan(20);
    expect(w.calls.map((c) => c.kind)).toEqual(['setView', 'flyTo', 'flyTo', 'flyTo', 'flyTo']);
    expect(w.calls[0]).toMatchObject({ lat: 28, lon: 86.9, distKm: PERF_ORBIT_KM });
    expect(w.calls[1]).toMatchObject({ distKm: PERF_CONTINENT_KM, options: { durationS: PERF_QUICK_FLIGHT_S } });
    expect(w.calls[2]?.options?.altAglM).toBe(PERF_VALLEY_AGL_M);
    expect(w.calls[3]?.options?.altAglM).toBe(PERF_GROUND_AGL_M);
    expect(w.calls[4]?.options?.altAglM).toBe(PERF_GROUND_AGL_M);
    expect(w.calls[4]?.lat).toBeGreaterThan(w.calls[3]?.lat ?? 99); // the cruise moves north at 300 m
    for (const c of w.calls.slice(2)) expect(c.options?.tilt).toBeGreaterThanOrEqual(20);
    const s = run.section();
    expect(s.completed).toBe(true);
    expect(s.quick).toBe(true);
    expect(s.phases.map((p) => p.name)).toEqual([...PERF_PHASE_NAMES]);
    for (const p of s.phases) expect(p.frames).toBeGreaterThan(0);
    expect(s.frames).toBe(frames - 1); // the frame in which the script ends is not recorded
    expect(s.maxChunks).toBe(20);
    expect(s.maxTriangles).toBe(50_000);
    expect(s.minAglM).toBe(300);
  });

  it('a phase starts only after the flight of the one before has arrived and its rest has passed (fx time)', () => {
    const w = fakeWorld();
    const run = new PerfSceneRun(w.host, { quick: false, now: () => w.clock.t });
    for (let i = 0; i < PERF_PROBE_SKIP + PERF_PROBE_FRAMES; i++) run.probeFrame(16.7);
    drive(run, w, 1 / 60);
    expect(run.done).toBe(true);
    const [orbit, continent, valley, ground, cruise] = w.calls;
    // orbit: set at the first frame, 3 s rest, then the continent flight (4 s, the live duration)
    expect((continent?.at ?? 0) - (orbit?.at ?? 0)).toBeCloseTo(PERF_HOLD_S.orbit, 1);
    expect(continent?.options?.durationS).toBe(4);
    // each later phase: flight (3 s in the fake) + rest
    expect((valley?.at ?? 0) - (continent?.at ?? 0)).toBeCloseTo(4 + PERF_HOLD_S.continent, 1);
    expect((ground?.at ?? 0) - (valley?.at ?? 0)).toBeCloseTo(3 + PERF_HOLD_S.valley, 1);
    expect((cruise?.at ?? 0) - (ground?.at ?? 0)).toBeCloseTo(3 + PERF_HOLD_S.ground, 1);
    // the live ground flights are planned by the camera (no fixed duration)
    expect(valley?.options?.durationS).toBeUndefined();
    expect(ground?.options?.durationS).toBeUndefined();
    expect(run.section().fxDurationS).toBeCloseTo((cruise?.at ?? 0) - (orbit?.at ?? 0) + 3 + PERF_HOLD_S.cruise, 1);
  });

  it('a frozen fx clock freezes the script', () => {
    const w = fakeWorld();
    const run = new PerfSceneRun(w.host, { quick: true, now: () => w.clock.t });
    for (let i = 0; i < 500; i++) {
      run.beforeFrame();
      run.afterFrame(16, 1);
    }
    expect(run.done).toBe(false);
    expect(w.calls.length).toBe(1); // only the orbit view: its rest is fx time that never comes
  });

  it('measures the refresh before it draws anything: nothing is recorded or flown while probing', () => {
    const w = fakeWorld();
    const run = new PerfSceneRun(w.host, { quick: false, now: () => w.clock.t });
    expect(run.probing).toBe(true);
    for (let i = 0; i < PERF_PROBE_SKIP + PERF_PROBE_FRAMES - 1; i++) {
      run.probeFrame(i < PERF_PROBE_SKIP ? 90 : 16.7); // the first callbacks after the load are slow and are not used
      run.beforeFrame();
      run.afterFrame(16.7, 1);
    }
    expect(run.probing).toBe(true);
    expect(w.calls.length).toBe(0);
    expect(run.recorder.frames).toBe(0);
    run.probeFrame(16.7);
    expect(run.probing).toBe(false);
    expect(run.recorder.probeSamples).toBe(PERF_PROBE_FRAMES);
    drive(run, w, 1 / 60, 5);
    expect(w.calls.length).toBe(1);
    expect(run.section().refresh).toMatchObject({ measured: true, medianIntervalMs: 16.7 });
  });

  it('feeds the finished GPU times into the report and stops recording once the run is over', () => {
    const w = fakeWorld();
    const run = new PerfSceneRun(w.host, { quick: true, now: () => w.clock.t });
    w.gpu.push(2, 3, 4);
    drive(run, w, 0.1);
    const before = run.section();
    expect(before.gpuMs.samples).toBe(3);
    expect(before.gpuMs.mean).toBe(3);
    run.afterFrame(10, 1);
    run.afterFrame(10, 1);
    expect(run.section().frames).toBe(before.frames);
  });

  it('the overlay line says what is going on', () => {
    const w = fakeWorld();
    const run = new PerfSceneRun(w.host, { quick: false, now: () => w.clock.t });
    expect(run.line()).toContain('mäter');
    for (let i = 0; i < PERF_PROBE_SKIP + PERF_PROBE_FRAMES; i++) run.probeFrame(16.7);
    w.clock.t += 0.1;
    run.beforeFrame();
    expect(run.line()).toContain('fas 1 av 5 (orbit)');
    const q = new PerfSceneRun(fakeWorld().host, { quick: true, now: () => 0 });
    expect(q.line()).toContain('fas 1 av 5');
  });
});

describe('the address of the performance scene', () => {
  it('?scene=perf and #scene-perf give the scene "perf"; the Dev panel lists it as "Prestandascen"', async () => {
    const { parseSceneParams, parseAppState } = await import('../src/app/params');
    const { clearDevModes, devModes } = await import('../src/app/devpanel');
    const { registerAppModes } = await import('../src/app/modes');
    expect(parseSceneParams('?scene=perf').scene).toBe('perf');
    expect(parseSceneParams('', '#scene-perf').scene).toBe('perf');
    expect(parseSceneParams('', '#scene-perf_quality-high')).toEqual({ scene: 'perf', quality: 'high' });
    expect(parseAppState('', '#scene-perf').scene.scene).toBe('perf');
    expect(parseSceneParams('?scene=nonsense').scene).toBe('globe');
    clearDevModes();
    registerAppModes();
    const mode = devModes().find((m) => m.id === 'scene-perf');
    expect(mode?.label).toBe('Prestandascen');
    expect(mode?.params).toEqual({ scene: 'perf' });
  });
});

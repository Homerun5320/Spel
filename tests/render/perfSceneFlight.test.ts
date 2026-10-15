// M08 item 5: the LIVE script of the performance scene flown on the real height field in fx steps of 1/60 s, the way a 60 fps display runs it
// (the quick script of test mode takes larger steps and is not judged here). Every frame of the five phases: the camera moves at most 5 % of its
// height, turns at most 3 degrees, stays above the 300 m clearance; the script ends at 300 m over the plateau edge; and its length is the one the
// user is told (about 40 s on a fast machine).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { advanceFx, fxNow, setFxTime } from '../../src/render/clock';
import { ZOOM_MIN_AGL_M } from '../../src/render/config';
import { CameraFlight } from '../../src/render/flyTo';
import { dot, length, sub } from '../../src/render/geo';
import { PERF_GROUND_AGL_M, PERF_PHASE_NAMES, PERF_PROBE_FRAMES, PERF_PROBE_SKIP, PERF_VALLEY, PerfSceneRun, type PerfSceneHost } from '../../src/app/perfScene';
import { R_M, loadRtsWorld, makeRtsRig, type RtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});
afterEach(() => setFxTime(0));

describe('the live performance script on the real terrain at 60 fps', () => {
  it('flies every phase with at most 5 % of the height per frame and 3 degrees per frame, never under 300 m, and ends at 300 m over the valley', () => {
    setFxTime(100);
    const rig = makeRtsRig(w, { lat: 20, lon: 10, distKm: 21500, heading: 0, tilt: 0 });
    const flight = new CameraFlight(rig);
    const host: PerfSceneHost = {
      setView: (v) => rig.setViewUnclamped(v),
      flyTo: (lat, lon, distKm, o) => flight.flyTo(lat, lon, distKm, o),
      flightActive: () => flight.active,
      cameraAglM: () => rig.aglM(),
      counters: () => ({ calls: 3, triangles: 1, chunks: 1 }),
      canvas: () => ({ cssWidth: 960, cssHeight: 540, pixelWidth: 960, pixelHeight: 540, dpr: 1, devicePixelRatio: 1 }),
      gpuMs: () => null,
      gpuAvailable: () => false,
    };
    const run = new PerfSceneRun(host, { quick: false, now: fxNow });
    for (let i = 0; i < PERF_PROBE_SKIP + PERF_PROBE_FRAMES; i++) run.probeFrame(1000 / 60);
    let prev = rig.pose();
    let prevAgl = rig.aglM();
    let worstPos = 0;
    let worstPosFrame = 0;
    let worstDir = 0;
    let minAgl = Infinity;
    const perPhase: number[] = [];
    let frame = 0;
    let t0 = -1;
    while (!run.done && frame < 60 * 120) {
      advanceFx(1 / 60);
      run.beforeFrame();
      if (t0 < 0) t0 = fxNow();
      flight.update(fxNow());
      rig.update(fxNow());
      const pose = rig.pose();
      const agl = rig.aglM();
      if (frame > 0) {
        const ratio = (length(sub(pose.position, prev.position)) * R_M) / Math.max(Math.min(agl, prevAgl), 1);
        if (ratio > worstPos) {
          worstPos = ratio;
          worstPosFrame = frame;
        }
        worstDir = Math.max(worstDir, (Math.acos(Math.min(1, dot(pose.forward, prev.forward))) * 180) / Math.PI);
      }
      minAgl = Math.min(minAgl, agl);
      perPhase[run.phaseIndex] = (perPhase[run.phaseIndex] ?? 0) + 1;
      run.afterFrame(1000 / 60, 1);
      prev = pose;
      prevAgl = agl;
      frame++;
    }
    const seconds = (fxNow() - t0) / 1;
    console.log(`[perf-scene] live script at 60 fps: ${frame} frames (${seconds.toFixed(1)} fx s), worst step ${(100 * worstPos).toFixed(2)} % of the height (frame ${worstPosFrame}), worst turn ${worstDir.toFixed(2)} degrees, lowest ${minAgl.toFixed(1)} m; frames per phase ${PERF_PHASE_NAMES.map((n, i) => `${n} ${perPhase[i]}`).join(', ')}`);
    expect(run.done).toBe(true);
    expect(worstPos, `largest step as a share of the height (frame ${worstPosFrame})`).toBeLessThanOrEqual(0.05);
    expect(worstDir, 'largest turn of the look direction (deg)').toBeLessThanOrEqual(3);
    expect(minAgl, 'lowest height of the script (m)').toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1e-6);
    expect(rig.aglM()).toBeCloseTo(PERF_GROUND_AGL_M, 0);
    expect(rig.view.lat).toBeGreaterThan(PERF_VALLEY.lat - 1);
    // the whole script is the length the user is told: about 40 s, never under 25 or over 70
    expect(seconds).toBeGreaterThan(25);
    expect(seconds).toBeLessThan(70);
    for (const n of perPhase) expect(n).toBeGreaterThan(0);
    const s = run.section();
    expect(s.completed).toBe(true);
    expect(s.phases.every((p) => p.frames > 0)).toBe(true);
    expect(s.minAglM).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1e-6);
  });
});

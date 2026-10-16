// Look-1: the fast flight profile (`FlyOptions.fast`) of the UI's "open city": at most FLY_FAST_MAX_S fx seconds for any distance, above the
// clearance in every frame, deterministic on the fx clock, and a cancel keeps the camera where it is (no pop).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { advanceFx, fxNow, setFxTime } from '../../src/render/clock';
import { ZOOM_MIN_AGL_M } from '../../src/render/config';
import { CameraFlight, FLY_FAST_MAX_S } from '../../src/render/flyTo';
import { dot, length, sub } from '../../src/render/geo';
import { R_M, loadRtsWorld, makeRtsRig, type RtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});
afterEach(() => setFxTime(0));

function run(distKm: number, fast: boolean): { seconds: number; minAgl: number; endAgl: number; end: number[] } {
  setFxTime(100);
  const rig = makeRtsRig(w, { lat: 10, lon: 20, distKm, heading: 0, tilt: 0 });
  rig.setView({ lat: 10, lon: 20, distKm, heading: 0, tilt: 0 });
  const flight = new CameraFlight(rig);
  flight.flyTo(46.5, 8, 0, { altAglM: 1500, tilt: 50, fast });
  let frames = 0;
  let minAgl = Infinity;
  while (flight.active && frames < 4000) {
    advanceFx(1 / 60);
    flight.update(fxNow());
    rig.update(fxNow());
    minAgl = Math.min(minAgl, rig.aglM());
    frames++;
  }
  return { seconds: frames / 60, minAgl, endAgl: rig.aglM(), end: [...rig.pose().position] };
}

describe('the fast flight', () => {
  it('takes at most FLY_FAST_MAX_S from orbit, from 3 000 km and from 100 km, ends at 1500 m, never under the clearance, and is deterministic', () => {
    for (const km of [21500, 3000, 100]) {
      const a = run(km, true);
      expect(a.seconds, `from ${km} km`).toBeLessThanOrEqual(FLY_FAST_MAX_S + 0.05);
      expect(a.minAgl).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1e-6);
      expect(a.endAgl).toBeCloseTo(1500, 0);
      expect(run(km, true).end).toEqual(a.end);
    }
    expect(run(21500, false).seconds, 'the control: the normal flight is slow').toBeGreaterThan(8);
  });

  it('a cancel keeps the camera where it is: the next frame does not move it', () => {
    setFxTime(100);
    const rig = makeRtsRig(w, { lat: 10, lon: 20, distKm: 3000, heading: 0, tilt: 0 });
    rig.setView({ lat: 10, lon: 20, distKm: 3000, heading: 0, tilt: 0 });
    const flight = new CameraFlight(rig);
    flight.flyTo(46.5, 8, 0, { altAglM: 1500, tilt: 50, fast: true });
    for (let i = 0; i < 40; i++) {
      advanceFx(1 / 60);
      flight.update(fxNow());
      rig.update(fxNow());
    }
    const before = rig.pose();
    flight.cancel();
    advanceFx(1 / 60);
    flight.update(fxNow());
    rig.update(fxNow());
    const after = rig.pose();
    expect(flight.active).toBe(false);
    expect(length(sub(after.position, before.position)) * R_M).toBeLessThan(1);
    expect(dot(after.forward, before.forward)).toBeGreaterThan(0.99999);
  });
});

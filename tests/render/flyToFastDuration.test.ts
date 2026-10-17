// Fix-3B (mutation audit 11): with { fast: true, durationS } the explicit duration wins over the fast profile's own time.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { advanceFx, fxNow, setFxTime } from '../../src/render/clock';
import { CameraFlight, FLY_FAST_MAX_S } from '../../src/render/flyTo';
import { loadRtsWorld, makeRtsRig, type RtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});
afterEach(() => setFxTime(0));

function seconds(durationS: number | undefined): number {
  setFxTime(100);
  const rig = makeRtsRig(w, { lat: 10, lon: 20, distKm: 3000, heading: 0, tilt: 0 });
  rig.setView({ lat: 10, lon: 20, distKm: 3000, heading: 0, tilt: 0 });
  const flight = new CameraFlight(rig);
  flight.flyTo(46.5, 8, 0, { altAglM: 1500, tilt: 50, fast: true, ...(durationS === undefined ? {} : { durationS }) });
  let frames = 0;
  while (flight.active && frames < 4000) {
    advanceFx(1 / 60);
    flight.update(fxNow());
    rig.update(fxNow());
    frames++;
  }
  return frames / 60;
}

describe('fast + durationS', () => {
  it('an explicit duration is kept (shorter and longer than the fast maximum), the default is the fast profile', () => {
    const dflt = seconds(undefined);
    expect(dflt).toBeLessThanOrEqual(FLY_FAST_MAX_S + 0.05);
    expect(seconds(0.5)).toBeCloseTo(0.5, 0);
    expect(seconds(0.5)).toBeLessThan(dflt);
    expect(seconds(4)).toBeGreaterThan(FLY_FAST_MAX_S + 1);
  });
});

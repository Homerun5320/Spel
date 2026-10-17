// flyTo (M06 item 1): the camera reaches its end position on the FX clock, takes the short way round the antimeridian, can be
// cancelled and replaced, and puts the place where the screen shift asks for it.
import { afterEach, describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/camera';
import { advanceFx, fxNow, setFxTime } from '../../src/render/clock';
import { DIST_MAX_KM } from '../../src/render/config';
import { CameraFlight, FLY_EXTRA_S, FLY_MIN_S } from '../../src/render/flyTo';
import { latLonToVec } from '../../src/render/geo';

const W = 960;
const H = 540;

function setup(): { rig: CameraRig; flight: CameraFlight } {
  setFxTime(100);
  const rig = new CameraRig(W, H);
  rig.setView({ lat: 10, lon: 20, distKm: 14000, heading: 40, tilt: 20 });
  return { rig, flight: new CameraFlight(rig) };
}

/** Steps the fx clock in frames of dt and updates the flight each frame, like Globe.render does. */
function run(flight: CameraFlight, seconds: number, dt = 1 / 30): void {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) {
    advanceFx(dt);
    flight.update(fxNow());
  }
}

afterEach(() => setFxTime(0));

describe('flyTo on the FX clock', () => {
  it('reaches the exact end position (focus, distance, heading, tilt) after its duration', () => {
    const { rig, flight } = setup();
    flight.flyTo(59.33, 18.07, 1800);
    expect(flight.active).toBe(true);
    run(flight, FLY_MIN_S + FLY_EXTRA_S + 0.1);
    expect(flight.active).toBe(false);
    const v = rig.view;
    expect(v.lat).toBeCloseTo(59.33, 9);
    expect(v.lon).toBeCloseTo(18.07, 9);
    expect(v.distKm).toBeCloseTo(1800, 9);
    expect(v.heading).toBeCloseTo(0, 9);
    expect(v.tilt).toBeCloseTo(0, 9);
  });

  it('does not move before the clock does, and stays put once it has arrived', () => {
    const { rig, flight } = setup();
    const before = rig.view;
    flight.flyTo(-33.9, 151.2, 2500);
    flight.update(fxNow());
    expect(rig.view.lat).toBeCloseTo(before.lat, 6);
    expect(rig.view.lon).toBeCloseTo(before.lon, 6);
    run(flight, 5);
    const end = rig.view;
    run(flight, 2);
    expect(rig.view).toEqual(end);
  });

  it('a frozen FX clock freezes the flight (test mode); the flight time is the FX time, not the number of calls', () => {
    const { rig, flight } = setup();
    flight.flyTo(48.8, 2.3, 2000);
    for (let i = 0; i < 50; i++) flight.update(fxNow());
    expect(flight.active).toBe(true);
    expect(rig.view.lat).toBeCloseTo(10, 6);
    advanceFx(10);
    flight.update(fxNow());
    expect(flight.active).toBe(false);
    expect(rig.view.lat).toBeCloseTo(48.8, 9);
  });

  it('progresses monotonically towards the target and the longer the hop the longer the flight', () => {
    const { rig, flight } = setup();
    flight.flyTo(-40, 160, 3000);
    const target = latLonToVec(-40, 160);
    let last = Infinity;
    for (let i = 0; i < 80; i++) {
      advanceFx(1 / 30);
      flight.update(fxNow());
      const f = latLonToVec(rig.view.lat, rig.view.lon);
      const d = Math.acos(Math.max(-1, Math.min(1, f[0] * target[0] + f[1] * target[1] + f[2] * target[2])));
      expect(d).toBeLessThanOrEqual(last + 1e-9);
      last = d;
    }
    // a short hop is done sooner than half way round the world
    const a = setup();
    a.flight.flyTo(12, 25, 9000);
    run(a.flight, FLY_MIN_S + 0.05);
    expect(a.flight.active).toBe(false);
    const b = setup();
    b.flight.flyTo(-10, -160, 9000);
    run(b.flight, FLY_MIN_S + 0.05);
    expect(b.flight.active).toBe(true);
  });

  it('zooms out in the middle of a long hop and never leaves the distance limits', () => {
    const { rig, flight } = setup();
    rig.setView({ lat: 0, lon: 0, distKm: 3000, heading: 0, tilt: 0 });
    flight.flyTo(0, 120, 3000);
    let max = 0;
    for (let i = 0; i < 90; i++) {
      advanceFx(1 / 30);
      flight.update(fxNow());
      max = Math.max(max, rig.view.distKm);
      expect(rig.view.distKm).toBeLessThanOrEqual(DIST_MAX_KM);
    }
    expect(max).toBeGreaterThan(3600);
  });

  it('takes the short way across the antimeridian', () => {
    const { rig, flight } = setup();
    rig.setView({ lat: 0, lon: 170, distKm: 5000, heading: 0, tilt: 0 });
    flight.flyTo(0, -170, 5000);
    for (let i = 0; i < 100; i++) {
      advanceFx(1 / 30);
      flight.update(fxNow());
      const lon = rig.view.lon;
      expect(Math.abs(lon) >= 169.9, `lon ${lon}`).toBe(true);
    }
    expect(rig.view.lon).toBeCloseTo(-170, 9);
  });

  it('cancel keeps the camera where it is; a new flight starts from there', () => {
    const { rig, flight } = setup();
    flight.flyTo(60, 100, 3000);
    run(flight, 0.4);
    flight.cancel();
    const mid = rig.view;
    expect(flight.active).toBe(false);
    run(flight, 3);
    expect(rig.view).toEqual(mid);
    flight.flyTo(-20, -60, 4000);
    expect(flight.active).toBe(true);
    run(flight, 4);
    expect(rig.view.lat).toBeCloseTo(-20, 9);
    expect(rig.view.lon).toBeCloseTo(-60, 9);
  });

  it('a second flyTo during a flight replaces it and ends at the second target', () => {
    const { rig, flight } = setup();
    flight.flyTo(60, 100, 3000);
    run(flight, 0.5);
    flight.flyTo(35, -100, 2200);
    run(flight, 4);
    expect(rig.view.lat).toBeCloseTo(35, 9);
    expect(rig.view.lon).toBeCloseTo(-100, 9);
    expect(rig.view.distKm).toBeCloseTo(2200, 9);
  });

  it('a zero duration jumps at once', () => {
    const { rig, flight } = setup();
    flight.flyTo(-5, 77, 2500, { durationS: 0 });
    expect(flight.active).toBe(false);
    expect(rig.view.lat).toBeCloseTo(-5, 9);
    expect(rig.view.lon).toBeCloseTo(77, 9);
  });

  it('works to and from a pole and to the antipode', () => {
    const { rig, flight } = setup();
    rig.setView({ lat: 89, lon: 10, distKm: 8000, heading: 0, tilt: 0 });
    flight.flyTo(-89, -170, 6000);
    run(flight, 4);
    expect(rig.view.lat).toBeCloseTo(-89, 9);
    rig.setView({ lat: 20, lon: 30, distKm: 8000 });
    flight.flyTo(-20, -150, 8000);
    run(flight, 4);
    expect(Number.isFinite(rig.view.lat) && Number.isFinite(rig.view.lon)).toBe(true);
    expect(rig.view.lat).toBeCloseTo(-20, 9);
  });

  it('the screen shift puts the place right of the centre and above it, by the share asked for', () => {
    const { rig, flight } = setup();
    flight.flyTo(50, 10, 1500, { shiftX: 0.4, shiftY: 0.2 });
    run(flight, 4);
    const s = rig.project(latLonToVec(50, 10));
    // shares of half the viewport: 0.4 of 480 px to the right, 0.2 of 270 px up
    expect(s.x).toBeGreaterThan(W / 2 + 0.3 * (W / 2));
    expect(s.x).toBeLessThan(W / 2 + 0.5 * (W / 2));
    expect(s.y).toBeLessThan(H / 2 - 0.1 * (H / 2));
    expect(s.y).toBeGreaterThan(H / 2 - 0.3 * (H / 2));
    expect(s.inView).toBe(true);
  });

  it('without a shift the place is at the centre of the screen', () => {
    const { rig, flight } = setup();
    flight.flyTo(-23, 133, 3000);
    run(flight, 4);
    const s = rig.project(latLonToVec(-23, 133));
    expect(s.x).toBeCloseTo(W / 2, 3);
    expect(s.y).toBeCloseTo(H / 2, 3);
  });
});

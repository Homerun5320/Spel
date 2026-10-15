// M08 item 4: `flyTo` with an altitude, a tilt and a heading (the RTS mode), on the fx clock. The scripted flight from orbit down to 300 m over
// the ground is the acceptance of the camera: it is flown in fx steps of 1/60 s and every frame is checked - the camera moves at most 5 % of its
// height, turns at most 3 degrees, and is above the clearance.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/camera';
import { advanceFx, fxNow, setFxTime } from '../../src/render/clock';
import { FLY_RHO_MAX, RTS_TILT_MAX_DEG, RTS_TILT_MIN_DEG, ZOOM_MIN_AGL_M } from '../../src/render/config';
import { CameraFlight, planGroundFlight } from '../../src/render/flyTo';
import { dot, length, sub, vecToLatLon, type Vec3 } from '../../src/render/geo';
import { BOOKMARKS, BOOKMARK_NAMES } from '../../src/render/views';
import { R_M, loadRtsWorld, makeRtsRig, type RtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});
afterEach(() => setFxTime(0));

interface FlightLog {
  frames: number;
  maxAgl: number;
  worstPos: number;
  worstPosAt: number;
  worstDirDeg: number;
  minAgl: number;
  endAgl: number;
  seconds: number;
}

/** Flies a flight in fx steps of 1/60 s the way `Globe.render` does (flight, then rig) and logs the worst frame. */
function fly(rig: CameraRig, flight: CameraFlight, maxFrames = 4000): FlightLog {
  let prev = rig.pose();
  let prevAgl = rig.aglM();
  const log: FlightLog = { frames: 0, maxAgl: prevAgl, worstPos: 0, worstPosAt: 0, worstDirDeg: 0, minAgl: prevAgl, endAgl: prevAgl, seconds: 0 };
  while (flight.active && log.frames < maxFrames) {
    advanceFx(1 / 60);
    flight.update(fxNow());
    rig.update(fxNow());
    const pose = rig.pose();
    const agl = rig.aglM();
    const step = length(sub(pose.position, prev.position)) * R_M;
    const ratio = step / Math.max(Math.min(agl, prevAgl), 1);
    if (ratio > log.worstPos) {
      log.worstPos = ratio;
      log.worstPosAt = log.frames;
    }
    log.worstDirDeg = Math.max(log.worstDirDeg, (Math.acos(Math.min(1, dot(pose.forward, prev.forward))) * 180) / Math.PI);
    log.minAgl = Math.min(log.minAgl, agl);
    log.maxAgl = Math.max(log.maxAgl, agl);
    prev = pose;
    prevAgl = agl;
    log.frames++;
  }
  log.endAgl = prevAgl;
  log.seconds = log.frames / 60;
  return log;
}

function orbitRig(): { rig: CameraRig; flight: CameraFlight } {
  setFxTime(100);
  const rig = makeRtsRig(w, { lat: 10, lon: 20, distKm: 21500, heading: 0, tilt: 0 });
  rig.setView({ lat: 10, lon: 20, distKm: 21500, heading: 0, tilt: 0 });
  return { rig, flight: new CameraFlight(rig) };
}

const DESTINATIONS = [
  { name: 'the Himalaya (28.2 N 86.8 E), tilt 60, heading 30', lat: 28.2, lon: 86.8, tilt: 60, heading: 30 },
  { name: 'the Alps (46.5 N 8 E), tilt 55, heading 200', lat: 46.5, lon: 8, tilt: 55, heading: 200 },
  { name: 'the open Pacific (0 N 150 W), tilt 70, heading 0', lat: 0, lon: -150, tilt: 70, heading: 0 },
  { name: 'the Andes (32.65 S 70 W), tilt 45, heading 270', lat: -32.65, lon: -70, tilt: 45, heading: 270 },
] as const;

describe('the scripted flight from orbit to 300 m above the ground, fx clock in steps of 1/60 s', () => {
  for (const d of DESTINATIONS) {
    it(`${d.name}: at most 5 % of the height per frame, at most 3 degrees per frame, above the clearance in every frame, and it arrives`, () => {
      const { rig, flight } = orbitRig();
      flight.flyTo(d.lat, d.lon, 0, { altAglM: 300, tilt: d.tilt, heading: d.heading });
      expect(flight.active).toBe(true);
      const log = fly(rig, flight);
      expect(flight.active).toBe(false);
      expect(log.worstPos, `largest step as a share of the height (frame ${log.worstPosAt})`).toBeLessThanOrEqual(0.05);
      expect(log.worstDirDeg, 'largest turn of the look direction (deg)').toBeLessThanOrEqual(3);
      expect(log.minAgl, 'lowest height of the flight (m)').toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1e-6);
      expect(log.endAgl).toBeCloseTo(300, 1);
      expect(rig.holdAgl).toBeCloseTo(300, 1); // it keeps the height it arrived at
      // and it arrived where it was sent: the point is at the centre of the screen, the heading and the tilt are the ones asked for
      const centre = rig.project(w.ground ? latLonWorld(d.lat, d.lon, w.ground(d.lat, d.lon)) : [0, 0, 1]);
      expect(Math.hypot(centre.x - 480, centre.y - 270), 'the target at the screen centre (px)').toBeLessThan(0.5);
      expect(Math.abs(rig.view.heading - d.heading + 540) % 360).toBeCloseTo(180, 0);
    });
  }

  it('the flight is long enough to be gentle and short enough to be used: 10 to 20 seconds from orbit, and a short hop is quick', () => {
    const { rig, flight } = orbitRig();
    flight.flyTo(28.2, 86.8, 0, { altAglM: 300, tilt: 60, heading: 30 });
    const d = flight.groundDuration as number;
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(20);
    rig.setView({ lat: 46.5, lon: 8, distKm: 30, heading: 0, tilt: 50 });
    flight.flyTo(46.6, 8.1, 0, { altAglM: 2000, tilt: 50, heading: 0 });
    expect(flight.groundDuration as number).toBeLessThan(9); // a 12 km hop from a camera 300 m up: it climbs, hops, and settles
  });

  it('a flight that starts low and goes far (5 km over the Alps to 3 km over the Himalaya) rises first, so the ground never streams past faster than the camera is high', () => {
    setFxTime(100);
    const rig = makeRtsRig(w, { lat: 46.5, lon: 8, heading: 90, tilt: 55 }, 5000);
    const flight = new CameraFlight(rig);
    flight.flyTo(28.2, 86.8, 0, { altAglM: 3000, tilt: 50, heading: 0 });
    const log = fly(rig, flight);
    expect(log.maxAgl, 'the flight rose to at least 0.4 of the distance (4 500 km away)').toBeGreaterThan(1_500_000);
    expect(log.worstPos).toBeLessThanOrEqual(0.05);
    expect(log.worstDirDeg).toBeLessThanOrEqual(3);
    expect(log.minAgl).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1e-6);
    expect(log.endAgl).toBeCloseTo(3000, 0);
  });

  it('the plan: the height never changes faster than FLY_RHO_MAX e-folds per second and the move never faster than FLY_RHO_MAX heights per second (the cause of the 5 % bound, not an accident of the examples)', () => {
    for (const [a0, a1, angle] of [
      [15_000_000, 300, 0.2],
      [15_000_000, 300, 3],
      [30_000, 300, 0.001],
      [300, 40_000, 0.5],
      [2000, 2000, 1.5],
      [300, 2000, 0.004],
      [1_000_000, 500_000, 0.4],
    ] as const) {
      const plan = planGroundFlight(a0, a1, angle);
      const T = plan.duration;
      expect(T, `${a0} -> ${a1} over ${angle}`).toBeGreaterThan(0.9);
      expect(plan.peak).toBeGreaterThanOrEqual(Math.max(a0, a1));
      // 1.875 is the peak of the derivative of the eased ramp
      const rise = plan.rise[1] > plan.rise[0] ? (1.875 * Math.log(plan.peak / a0)) / ((plan.rise[1] - plan.rise[0]) * T) : 0;
      const dive = plan.dive[1] > plan.dive[0] ? (1.875 * Math.log(plan.peak / a1)) / ((plan.dive[1] - plan.dive[0]) * T) : 0;
      const move = (1.875 * angle * 6_371_000) / ((plan.move[1] - plan.move[0]) * T) / plan.peak;
      expect(rise, 'rise rate').toBeLessThanOrEqual(FLY_RHO_MAX + 1e-9);
      expect(dive, 'dive rate').toBeLessThanOrEqual(FLY_RHO_MAX + 1e-9);
      expect(move, 'move speed in heights per second').toBeLessThanOrEqual(FLY_RHO_MAX + 1e-9);
      expect(plan.move[1]).toBeLessThanOrEqual(plan.dive[0] + 1e-9); // the move is finished before the dive proper
    }
  });
});

describe('flyTo to 50 m above the ground ends at the clearance', () => {
  it('asks for 50 m (and 0, and a negative height): the camera arrives 300 m up and was never lower on the way', () => {
    for (const alt of [50, 0, -10]) {
      const { rig, flight } = orbitRig();
      flight.flyTo(28.2, 86.8, 0, { altAglM: alt, tilt: 60, heading: 30 });
      const log = fly(rig, flight);
      expect(log.endAgl, `asked for ${alt} m`).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1e-6);
      expect(log.endAgl).toBeLessThan(ZOOM_MIN_AGL_M + 1);
      expect(log.minAgl).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1e-6);
      expect(rig.holdAgl).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1e-6);
    }
  });

  it('the tilt is kept in the RTS limits (a flight to tilt 0 or 89 arrives at 20 or 80)', () => {
    for (const [asked, got] of [
      [0, RTS_TILT_MIN_DEG],
      [89, RTS_TILT_MAX_DEG],
    ] as const) {
      const { rig, flight } = orbitRig();
      flight.flyTo(46.5, 8, 0, { altAglM: 2000, tilt: asked, heading: 0, durationS: 0 });
      expect(rig.localTilt()).toBeCloseTo(got, 0);
    }
  });
});

describe('the flight runs on the fx clock and reaches its target at the stated time', () => {
  it('after durationS of fx time the camera is at the end pose (the target at the centre, the height and the angles as asked); a frame earlier it is not', () => {
    const { rig, flight } = orbitRig();
    flight.flyTo(28.2, 86.8, 0, { altAglM: 5000, tilt: 50, heading: 120, durationS: 8 });
    const t0 = fxNow();
    setFxTime(t0 + 6);
    flight.update(fxNow());
    rig.update(fxNow());
    expect(flight.active).toBe(true);
    expect(Math.abs(rig.aglM() - 5000)).toBeGreaterThan(5); // two seconds before the end it is not there
    setFxTime(t0 + 8 - 1 / 60);
    flight.update(fxNow());
    rig.update(fxNow());
    expect(flight.active).toBe(true);
    const near = rig.aglM();
    expect(Math.abs(near - 5000)).toBeLessThan(5000 * 0.01); // one frame before the end it is nearly there and still moving
    setFxTime(t0 + 8);
    flight.update(fxNow());
    rig.update(fxNow());
    expect(flight.active).toBe(false);
    expect(rig.aglM()).toBeCloseTo(5000, 5);
    expect(rig.localTilt()).toBeGreaterThan(49);
    expect(rig.localTilt()).toBeLessThan(51);
    const target = rig.project([0, 0, 0]);
    expect(Number.isFinite(target.x)).toBe(true);
    const ground = latLonWorld(28.2, 86.8, w.ground(28.2, 86.8));
    const s = rig.project(ground);
    expect(Math.hypot(s.x - 480, s.y - 270)).toBeLessThan(1e-3);
    const dh = ((rig.view.heading - 120 + 540) % 360) - 180;
    expect(Math.abs(dh)).toBeLessThan(2); // the focus is far away on the sea-level sphere: the heading there differs by a convergence of meridians
  });

  it('a frozen fx clock freezes the flight (test mode); advanceFx moves it; a zero duration jumps at once', () => {
    const { rig, flight } = orbitRig();
    flight.flyTo(46.5, 8, 0, { altAglM: 10_000, tilt: 50, heading: 0 });
    const a = rig.pose().position;
    for (let i = 0; i < 40; i++) flight.update(fxNow());
    const b = rig.pose().position;
    expect(length(sub(a, b))).toBe(0);
    expect(flight.active).toBe(true);
    advanceFx(3);
    flight.update(fxNow());
    expect(length(sub(a, rig.pose().position))).toBeGreaterThan(0);
    const { rig: rig2, flight: flight2 } = orbitRig();
    flight2.flyTo(46.5, 8, 0, { altAglM: 10_000, tilt: 50, heading: 0, durationS: 0 });
    expect(flight2.active).toBe(false);
    expect(rig2.aglM()).toBeCloseTo(10_000, 4);
  });

  it('cancel keeps the camera where it is and keeps its height; a second flyTo replaces the first and a classic flight still works', () => {
    const { rig, flight } = orbitRig();
    flight.flyTo(28.2, 86.8, 0, { altAglM: 300, tilt: 60, heading: 30 });
    advanceFx(6);
    flight.update(fxNow());
    flight.cancel();
    const here = rig.aglM();
    expect(flight.active).toBe(false);
    expect(rig.holdAgl).toBeCloseTo(here, 3);
    const p = rig.pose().position;
    advanceFx(2);
    flight.update(fxNow());
    expect(length(sub(p, rig.pose().position))).toBe(0);
    flight.flyTo(46.5, 8, 0, { altAglM: 20_000, tilt: 50, heading: 0, durationS: 3 });
    advanceFx(1);
    flight.update(fxNow());
    flight.flyTo(0, -150, 0, { altAglM: 8000, tilt: 40, heading: 90, durationS: 3 });
    advanceFx(3.1);
    flight.update(fxNow());
    expect(flight.active).toBe(false);
    expect(rig.aglM()).toBeCloseTo(8000, 3);
    // a classic orbit flight (no altitude) takes the old path and forgets the kept height
    flight.flyTo(10, 10, 5000);
    advanceFx(5);
    flight.update(fxNow());
    expect(rig.view.distKm).toBeCloseTo(5000, 6);
    expect(rig.holdAgl).toBeNull();
  });

  it('after the flight the camera is an RTS camera: a drag keeps its ground point under the cursor and the camera comes back to the height it arrived at', () => {
    const { rig, flight } = orbitRig();
    flight.flyTo(46.5, 8, 0, { altAglM: 4000, tilt: 55, heading: 0, durationS: 0 });
    expect(rig.holdAgl).toBeCloseTo(4000, 3);
    rig.dragStart(480, 270, 1);
    rig.dragMove(620, 330, 1.05);
    rig.update(1.1);
    rig.dragEnd(1.4);
    for (let i = 0; i < 300; i++) rig.update(1.4 + i / 60);
    expect(Math.abs(rig.aglM() - 4000)).toBeLessThan(80);
  });
});

describe('the bookmarks', () => {
  it('Alps, Himalaya and Andes are on land, high mountains, with an RTS tilt and a height of at least the clearance; the capital is the fourth', () => {
    expect([...BOOKMARK_NAMES]).toEqual(['alps', 'himalaya', 'andes', 'capital']);
    for (const name of ['alps', 'himalaya', 'andes'] as const) {
      const b = BOOKMARKS[name];
      expect(w.ground(b.lat, b.lon), name).toBeGreaterThan(1 + 1_500 / R_M); // land well above the sea
      expect(b.altAglM).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M);
      expect(b.tilt).toBeGreaterThanOrEqual(RTS_TILT_MIN_DEG);
      expect(b.tilt).toBeLessThanOrEqual(RTS_TILT_MAX_DEG);
    }
  });

  it('a flight from orbit to each of the three bookmarks obeys the same frame bounds', () => {
    for (const name of ['alps', 'himalaya', 'andes'] as const) {
      const b = BOOKMARKS[name];
      const { rig, flight } = orbitRig();
      flight.flyTo(b.lat, b.lon, 0, { altAglM: b.altAglM, tilt: b.tilt, heading: b.heading });
      const log = fly(rig, flight);
      expect(log.worstPos, name).toBeLessThanOrEqual(0.05);
      expect(log.worstDirDeg, name).toBeLessThanOrEqual(3);
      expect(log.minAgl, name).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1e-6);
      expect(log.endAgl, name).toBeCloseTo(b.altAglM, 0);
    }
  });
});

function latLonWorld(lat: number, lon: number, radius: number): Vec3 {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return [radius * Math.cos(la) * Math.sin(lo), radius * Math.sin(la), radius * Math.cos(la) * Math.cos(lo)];
}

// vecToLatLon is part of the public surface the test relies on for the sanity of latLonWorld
describe('helper sanity', () => {
  it('latLonWorld inverts vecToLatLon', () => {
    const p = latLonWorld(28.2, 86.8, 1.01);
    const g = vecToLatLon(p);
    expect(g.lat).toBeCloseTo(28.2, 9);
    expect(g.lon).toBeCloseTo(86.8, 9);
  });
});

// Fix-5A3 (audit 4, finding 2.9): the chase camera's geometry and easing beyond the single east-flying case: the camera stands BEHIND the heading at every compass course (the latitude
// and longitude terms), looks down at the helicopter (the lean), keeps its longitude step finite near the poles (the cosLat clamp), eases the heading the short way round with a clamped
// frame step, follows place and radius exactly, starts on the helicopter's own heading, and key H / repeat. Flat ground (radius 1) so that nothing depends on the data pack.
import { describe, expect, it } from 'vitest';
import { CameraRig, type ViewState } from '../../src/render/camera';
import { EARTH_RADIUS_KM, HELI_CHASE_BACK_M, HELI_CHASE_LEAN_DEG, HELI_CHASE_UP_M } from '../../src/render/config';
import { latLonToVec } from '../../src/render/geo';
import { chaseView, createChaseMode, type ChasePose, type ChaseTarget } from '../../src/app/chaseMode';

const R_M = EARTH_RADIUS_KM * 1000;
const DEG = Math.PI / 180;
const flat = (): number => 1;

/** Where chaseView puts the camera: its first look at the ground is under the camera. */
function cameraPlace(pose: ChasePose, back = HELI_CHASE_BACK_M): { lat: number; lon: number } {
  let seen: { lat: number; lon: number } | null = null;
  chaseView(pose, (lat, lon) => {
    seen ??= { lat, lon };
    return 1;
  }, back);
  return seen as unknown as { lat: number; lon: number };
}

describe('chaseView geometry', () => {
  const backDeg = HELI_CHASE_BACK_M / R_M / DEG;
  it.each([
    [0, -backDeg, 0], // flying north: the camera is south of it
    [180, backDeg, 0], // flying south: north of it
    [90, 0, -1], // flying east: west of it (longitude smaller)
    [270, 0, 1], // flying west: east of it
  ])('heading %d puts the camera behind the helicopter', (heading, dLat, lonSign) => {
    const pose: ChasePose = { lat: 10, lon: 20, heading, radius: 1 + 300 / R_M };
    const c = cameraPlace(pose);
    expect(c.lat - 10).toBeCloseTo(dLat, 6);
    if (lonSign === 0) expect(c.lon).toBeCloseTo(20, 6);
    else {
      expect(Math.sign(c.lon - 20)).toBe(lonSign);
      expect(Math.abs(c.lon - 20)).toBeCloseTo(backDeg / Math.cos(10 * DEG), 5); // a degree of longitude is shorter by cos(latitude)
    }
  });

  it('a diagonal course splits the step between latitude and longitude', () => {
    const c = cameraPlace({ lat: 0, lon: 0, heading: 45, radius: 1 });
    expect(c.lat).toBeCloseTo(-backDeg * Math.SQRT1_2, 6);
    expect(c.lon).toBeCloseTo(-backDeg * Math.SQRT1_2, 6);
  });

  it('keeps the longitude step finite near the pole: cos(latitude) is clamped at 0.05', () => {
    const c = cameraPlace({ lat: 89.9, lon: 0, heading: 90, radius: 1 });
    expect(c.lon).toBeCloseTo(-backDeg / 0.05, 5);
    expect(Number.isFinite(c.lon)).toBe(true);
    const s = cameraPlace({ lat: -89.9, lon: 0, heading: 270, radius: 1 });
    expect(s.lon).toBeCloseTo(backDeg / 0.05, 5);
  });

  it('puts the camera above the helicopter and looks down at it, a little more steeply than the straight line (the lean)', () => {
    const pose: ChasePose = { lat: 10, lon: 20, heading: 90, radius: 1 + 300 / R_M };
    const camAt = (lean: number): { r: number; sx: number; sy: number } => {
      const rig = new CameraRig(960, 540);
      rig.setGround(flat, flat);
      rig.setViewUnclamped(chaseView(pose, flat, HELI_CHASE_BACK_M, HELI_CHASE_UP_M, 70, lean) as ViewState);
      rig.update(0);
      const p = rig.pose().position;
      const heli = latLonToVec(pose.lat, pose.lon).map((x) => x * pose.radius) as [number, number, number];
      const alt = Math.hypot(p[0], p[1], p[2]);
      return { r: alt, sx: 0, sy: rig.project(heli).y };
    };
    const a = camAt(HELI_CHASE_LEAN_DEG);
    const b = camAt(0);
    const c = camAt(-HELI_CHASE_LEAN_DEG);
    expect(a.r).toBeCloseTo(pose.radius + HELI_CHASE_UP_M / R_M, 6); // up above the helicopter
    // with the lean the helicopter sits ABOVE the middle of the picture (the camera looks further down than at it), without it in the middle
    expect(a.sy).toBeLessThan(b.sy - 5);
    expect(c.sy).toBeGreaterThan(b.sy + 5);
    expect(Math.abs(b.sy - 270)).toBeLessThan(15);
  });
});

function drive() {
  const raw: ChasePose = { lat: 10, lon: 20, heading: 350, radius: 1 + 300 / R_M };
  const seen = { heading: NaN, lat: NaN, lon: NaN, camR: NaN, exits: [] as boolean[], applied: 0 };
  const target: ChaseTarget = {
    read: (_id, out) => {
      Object.assign(out, raw);
      return true;
    },
    groundRadius: (lat, lon) => {
      seen.lat = lat;
      seen.lon = lon;
      return 1;
    },
    apply: (v) => {
      seen.applied++;
      seen.heading = v.heading;
      const rig = new CameraRig(960, 540);
      rig.setGround(flat, flat);
      rig.setViewUnclamped(v);
      rig.update(0);
      const p = rig.pose().position;
      seen.camR = Math.hypot(p[0], p[1], p[2]);
    },
    cancelFlight: () => undefined,
    exit: (lost) => void seen.exits.push(lost),
    ended: () => undefined,
  };
  return { raw, seen, mode: createChaseMode(1, target) };
}
const norm = (h: number): number => ((h % 360) + 360) % 360;
const angDiff = (a: number, b: number): number => {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, 360 - d);
};

describe('the chase mode: heading easing, place following, keys', () => {
  it('starts on the helicopter own heading', () => {
    const d = drive();
    d.raw.heading = 200;
    d.mode.onPush?.();
    expect(angDiff(d.seen.heading, 200)).toBeLessThan(0.01);
  });

  it('eases the heading the short way round (350 to 10 through north), by 1 - exp(-dt / smooth) per step, and converges', () => {
    const d = drive();
    d.mode.onPush?.(); // heading 350 taken as it is
    d.raw.heading = 10;
    d.mode.tick?.(1); // first step has no earlier time: no move
    expect(angDiff(d.seen.heading, 350)).toBeLessThan(0.01);
    d.mode.tick?.(1.1);
    const a = 1 - Math.exp(-0.1 / 0.45);
    expect(angDiff(d.seen.heading, 350 + 20 * a)).toBeLessThan(0.05); // 353.98, never towards 180
    let t = 1.1;
    let prev = d.seen.heading;
    for (let i = 0; i < 60; i++) {
      t += 0.1;
      d.mode.tick?.(t);
      expect(angDiff(d.seen.heading, 10)).toBeLessThanOrEqual(angDiff(prev, 10) + 1e-3); // never moves away
      prev = d.seen.heading;
    }
    expect(angDiff(d.seen.heading, 10)).toBeLessThan(0.5);
  });

  it('eases the other way round for 10 to 350 (counter-clockwise through north)', () => {
    const d = drive();
    d.raw.heading = 10;
    d.mode.onPush?.();
    d.raw.heading = 350;
    d.mode.tick?.(1);
    d.mode.tick?.(1.1);
    const a = 1 - Math.exp(-0.1 / 0.45);
    expect(angDiff(d.seen.heading, 10 - 20 * a)).toBeLessThan(0.05);
  });

  it('clamps a long frame gap to half a second and does not run backwards for an earlier time', () => {
    const d = drive();
    d.mode.onPush?.();
    d.raw.heading = 50; // 60 degrees away
    d.mode.tick?.(1);
    d.mode.tick?.(101); // a 100 s gap: clamped to 0.5 s
    const a = 1 - Math.exp(-0.5 / 0.45);
    expect(angDiff(d.seen.heading, 350 + 60 * a)).toBeLessThan(0.1);
    expect(a).toBeLessThan(0.7); // the clamp matters: unclamped it would be 1
    const before = d.seen.heading;
    d.raw.heading = 200;
    d.mode.tick?.(50); // an earlier time: dt 0
    expect(angDiff(d.seen.heading, before)).toBeLessThan(0.01);
  });

  it('follows place and radius exactly, at once', () => {
    const d = drive();
    d.mode.onPush?.();
    d.mode.tick?.(1);
    d.raw.lat = 12;
    d.raw.lon = 25;
    d.raw.radius = 1 + 900 / R_M;
    d.mode.tick?.(1.1);
    const backDeg = HELI_CHASE_BACK_M / R_M / DEG;
    // heading is still about 350, so the camera is south-south-east... of the new place: within one back-step of (12, 25)
    expect(Math.abs(d.seen.lat - 12)).toBeLessThan(backDeg * 1.01);
    expect(Math.abs(d.seen.lon - 25)).toBeLessThan(backDeg * 1.01);
    expect(d.seen.camR).toBeCloseTo(1 + (900 + HELI_CHASE_UP_M) / R_M, 6);
  });

  it('H, h and a held (repeated) H', () => {
    const d = drive();
    const k = { ctrlKey: false, altKey: false, metaKey: false };
    expect(d.mode.key?.({ key: 'H', ...k })).toBe(true);
    expect(d.seen.exits).toEqual([false]);
    expect(d.mode.key?.({ key: 'h', ...k, repeat: true })).toBe(true); // swallowed, no second exit
    expect(d.seen.exits).toEqual([false]);
    expect(d.mode.key?.({ key: 'x', ...k })).toBe(false);
    expect(d.seen.exits).toEqual([false]);
  });
});

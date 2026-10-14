// M07a part B: the terrain-aware orbit camera. The mouse zoom stops 0.8 to 1.5 km above the ground over the sea, the Alps and the Himalaya
// (where the x12 terrain stands 100 km up), a wheel step is a share of the height above the floor, the ground views are exact, and the
// camera never ends below the ground after a drag. M08 replaces the orbit rig with the RTS camera and this file with its own test.
import { describe, expect, it } from 'vitest';
import { GROUND_VIEW_NAMES } from '../../src/app/params';
import { CameraRig, cameraPositionFor, distForAgl, viewFromGroundCamera, type GroundCameraSpec } from '../../src/render/camera';
import { CAMERA_FOV_DEG, DIST_MAX_KM, EARTH_RADIUS_KM, TILT_MAX_DEG, WHEEL_ZOOM_RATE, ZOOM_MIN_AGL_M } from '../../src/render/config';
import { DEG, length, vecToLatLon } from '../../src/render/geo';
import { GROUND_VIEWS } from '../../src/render/views';
import { loadChunkWorld, rng } from '../helpers/chunkWorld';

const R_M = EARTH_RADIUS_KM * 1000;
const PLACES = [
  { name: 'open sea (Pacific)', lat: 0, lon: -150 },
  { name: 'the Alps', lat: 46.5, lon: 8 },
  { name: 'the Himalaya', lat: 28.2, lon: 86.8 },
  { name: 'Everest', lat: 28.0, lon: 86.9 },
] as const;

async function rigOver(lat: number, lon: number, tilt: number, heading = 0, distKm = 3000): Promise<{ rig: CameraRig; agl: () => number }> {
  const world = await loadChunkWorld();
  const rig = new CameraRig(960, 540);
  rig.setGround((a, b) => world.field.surfaceRadius(a, b));
  rig.setView({ lat, lon, heading, tilt, distKm });
  rig.update(0);
  const agl = (): number => {
    const p = rig.pose().position;
    const g = vecToLatLon(p);
    return (length(p) - world.field.surfaceRadius(g.lat, g.lon)) * R_M;
  };
  return { rig, agl };
}

function settle(rig: CameraRig, from: number, seconds: number): number {
  let t = from;
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    t += 1 / 30;
    rig.update(t);
  }
  return t;
}

describe('the mouse zoom stops 0.8 to 1.5 km above the ground', () => {
  for (const place of PLACES) {
    for (const tilt of [0, 40, TILT_MAX_DEG]) {
      it(`${place.name}, tilt ${tilt}: wheel all the way in, the camera rests 0.8 to 1.5 km above the displaced ground under it`, async () => {
        const { rig, agl } = await rigOver(place.lat, place.lon, tilt);
        let t = 0;
        for (let i = 0; i < 40; i++) {
          rig.zoomAt(480 + 40 * ((i % 3) - 1), 270, -700); // a cursor that is not exactly at the centre: the anchor moves the focus too
          t = settle(rig, t, 0.5);
        }
        t = settle(rig, t, 3);
        expect(agl(), `${place.name} tilt ${tilt}`).toBeGreaterThan(800);
        expect(agl(), `${place.name} tilt ${tilt}`).toBeLessThan(1500);
        expect(rig.moving).toBe(false);
        // and out again: the way back is as short as the way in (no hidden over-scroll to undo)
        for (let i = 0; i < 6; i++) {
          rig.zoomAt(480, 270, 700);
          t = settle(rig, t, 0.5);
        }
        expect(agl()).toBeGreaterThan(5000);
      });
    }
  }

  it('without a ground (the fixed mesh) the old minimum distance stays', () => {
    const rig = new CameraRig(960, 540);
    rig.setView({ lat: 0, lon: 0, distKm: 5000 });
    rig.update(0);
    for (let i = 0; i < 30; i++) rig.zoomAt(480, 270, -2000);
    settle(rig, 0, 20);
    expect(rig.view.distKm).toBe(220);
  });

  it('setView over the Himalaya cannot put the camera into the mountain (the x12 ground stands 100 km above the sea-level focus)', async () => {
    const { rig, agl } = await rigOver(28, 86.9, 30, 0, 3000);
    rig.setView({ distKm: 150 });
    expect(agl()).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1);
    expect(rig.view.distKm).toBeGreaterThan(100); // the sea-level focus is far below the camera
    rig.setView({ distKm: 1e-3, tilt: 0 });
    expect(agl()).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1);
  });
});

describe('zoom steps are proportional to the height', () => {
  it('a wheel notch takes the same share of the camera height at 500 km, 50 km and 5 km (open sea, tilt 0)', async () => {
    const { rig, agl } = await rigOver(0, -150, 0, 0, 500);
    const f = Math.exp(-300 * WHEEL_ZOOM_RATE);
    let t = 0;
    const ratios: number[] = [];
    for (let i = 0; i < 12; i++) {
      const before = agl();
      rig.zoomAt(480, 270, -300);
      t = settle(rig, t, 2);
      ratios.push(agl() / before);
      if (before * f < 1.5 * ZOOM_MIN_AGL_M) break; // the floor interferes from here
    }
    expect(ratios.length).toBeGreaterThan(6);
    for (const r of ratios.slice(0, -1)) expect(Math.abs(r - f), `ratio ${r}`).toBeLessThan(0.01);
    // the absolute step shrinks with the height, and the camera does not cut through the floor
    expect(agl()).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1);
    expect(agl()).toBeLessThan(2000);
  });

  it('far out the zoom is what it was: the wheel factor on the distance', async () => {
    const { rig } = await rigOver(10, 10, 0, 0, 20_000);
    rig.zoomAt(480, 270, -500);
    settle(rig, 0, 3);
    expect(rig.view.distKm / 20_000).toBeCloseTo(Math.exp(-500 * WHEEL_ZOOM_RATE), 3);
    expect(rig.view.distKm).toBeLessThan(DIST_MAX_KM);
  });
});

describe('the ground below a dragged camera', () => {
  it('a drag across the Alps at the floor never leaves the camera below the ground', async () => {
    const world = await loadChunkWorld();
    const { rig, agl } = await rigOver(46.5, 8, 60, 90, 3000);
    let t = 0;
    for (let i = 0; i < 40; i++) {
      rig.zoomAt(480, 270, -700);
      t = settle(rig, t, 0.4);
    }
    expect(agl()).toBeLessThan(1500);
    let worst = Infinity;
    rig.dragStart(480, 270, t);
    for (let i = 1; i <= 60; i++) {
      rig.dragMove(480 + 5 * i, 270 + 2 * i, t + i / 60); // about 300 px: a few kilometres per pixel at this height
      rig.update(t + i / 60);
      worst = Math.min(worst, agl());
    }
    rig.dragEnd(t + 1);
    t = settle(rig, t + 1, 3);
    worst = Math.min(worst, agl());
    expect(worst).toBeGreaterThan(ZOOM_MIN_AGL_M - 5);
    expect(world.field.surfaceRadius(46.5, 8)).toBeGreaterThan(1); // the Alps are above sea level: the test did climb a ridge
  });

  it('right-drag only tilts DOWN from a ground view above the user limit (the first drag does not jump the picture)', () => {
    const rig = new CameraRig(960, 540);
    rig.setViewUnclamped({ lat: 30, lon: 10, distKm: 300, tilt: 87 });
    rig.rotateBy(0, 10);
    expect(rig.view.tilt).toBe(87);
    rig.rotateBy(0, -20);
    expect(rig.view.tilt).toBeCloseTo(87 - 20 * 0.35, 9);
    rig.rotateBy(0, -2000);
    expect(rig.view.tilt).toBe(0);
    rig.rotateBy(0, 2000);
    expect(rig.view.tilt).toBe(TILT_MAX_DEG);
  });
});

describe('cameraPositionFor, distForAgl and viewFromGroundCamera', () => {
  it('cameraPositionFor is the position of the rig pose', () => {
    const r = rng(11);
    for (let i = 0; i < 50; i++) {
      const rig = new CameraRig(960, 540);
      const v = { lat: 180 * r() - 90, lon: 360 * r() - 180, distKm: 1 + 30_000 * r(), heading: 360 * r() - 180, tilt: 89 * r() };
      rig.setViewUnclamped(v);
      const p = rig.pose().position;
      const q = cameraPositionFor(rig.view);
      for (let k = 0; k < 3; k++) expect(q[k]).toBeCloseTo(p[k] as number, 12);
    }
  });

  it('distForAgl returns the distance whose camera is exactly that high (flat ground, the Alps, the Himalaya)', async () => {
    const world = await loadChunkWorld();
    const ground = (a: number, b: number): number => world.field.surfaceRadius(a, b);
    for (const place of PLACES) {
      for (const alt of [1000, 5000, 80_000]) {
        const view = { lat: place.lat, lon: place.lon, heading: 33, tilt: 50, distKm: 1 };
        const d = distForAgl(view, ground, alt);
        const p = cameraPositionFor({ ...view, distKm: d });
        const g = vecToLatLon(p);
        expect(((length(p) - ground(g.lat, g.lon)) * R_M - alt) / alt, `${place.name} ${alt}`).toBeCloseTo(0, 6);
      }
    }
  });

  it('viewFromGroundCamera: the orbit view reproduces the camera position, its height above the ground and its look direction', async () => {
    const world = await loadChunkWorld();
    const ground = (a: number, b: number): number => world.field.surfaceRadius(a, b);
    const r = rng(23);
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      const spec: GroundCameraSpec = { lat: 80 * (2 * r() - 1), lon: 360 * r() - 180, heading: 360 * r() - 180, pitchDeg: 3 + 40 * r(), aglM: 300 + 20_000 * r() };
      const rig = new CameraRig(960, 540);
      const view = viewFromGroundCamera(spec, ground);
      if (view.tilt >= 89.4) continue; // setViewUnclamped stops at 89.5 degrees (a camera that high and that flat looks along the horizon)
      rig.setViewUnclamped(view);
      const pose = rig.pose();
      const g = vecToLatLon(pose.position);
      expect(Math.abs(g.lat - spec.lat), `lat ${i}`).toBeLessThan(1e-9);
      expect(Math.abs(g.lon - spec.lon), `lon ${i}`).toBeLessThan(1e-9);
      expect(((length(pose.position) - ground(g.lat, g.lon)) * R_M) / spec.aglM, `agl ${i}`).toBeCloseTo(1, 7);
      // the look direction: pitch below the local horizontal, heading as asked (a ray above the sea-level horizon, whose dip angle is
      // acos(1 / radius), meets no sea-level focus: it is aimed at the horizon instead, documented at viewFromGroundCamera)
      if (spec.pitchDeg < Math.acos(1 / length(pose.position)) / DEG + 1e-6) continue;
      checked++;
      const up = [pose.position[0] / length(pose.position), pose.position[1] / length(pose.position), pose.position[2] / length(pose.position)];
      const sinPitch = -(pose.forward[0] * up[0]! + pose.forward[1] * up[1]! + pose.forward[2] * up[2]!);
      expect(Math.asin(sinPitch) / DEG, `pitch ${i}`).toBeCloseTo(spec.pitchDeg, 6);
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('the named ground views', () => {
  it('src/render/views.ts has exactly the names the parser knows, 2 km above the ground, tilted toward the horizon', async () => {
    expect(Object.keys(GROUND_VIEWS).sort()).toEqual([...GROUND_VIEW_NAMES].sort());
    const world = await loadChunkWorld();
    const ground = (a: number, b: number): number => world.field.surfaceRadius(a, b);
    expect(GROUND_VIEWS['alps-valley']).toMatchObject({ lat: 46.5, lon: 8 });
    expect(GROUND_VIEWS['himalaya-valley']).toMatchObject({ lat: 28.2, lon: 86.8 });
    for (const name of GROUND_VIEW_NAMES) {
      const spec = GROUND_VIEWS[name];
      expect(spec.aglM).toBeGreaterThanOrEqual(1500);
      expect(spec.aglM).toBeLessThanOrEqual(2500);
      expect(spec.pitchDeg, name).toBeLessThan(CAMERA_FOV_DEG / 2); // the horizon is inside the picture
      const view = viewFromGroundCamera(spec, ground);
      expect(view.tilt, name).toBeGreaterThan(TILT_MAX_DEG); // so it is applied unclamped
      expect(view.tilt, name).toBeLessThan(89.5); // and survives setViewUnclamped
    }
  });
});

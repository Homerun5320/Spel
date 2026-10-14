import { describe, expect, it } from 'vitest';
import { CameraRig, clipPlanes, setViewAtAgl } from '../../src/render/camera';
import { ATMOSPHERE_TOP, CLIP_NEAR_FRACTION, DIST_MIN_KM, EARTH_RADIUS_KM, TILT_MAX_DEG } from '../../src/render/config';
import { length, vecToLatLon } from '../../src/render/geo';
import { ALTITUDE_VIEWS, loadChunkWorld, rng } from '../helpers/chunkWorld';

const R_M = EARTH_RADIUS_KM * 1000;

describe('setViewAtAgl (the altAglM test hook)', () => {
  it('puts the camera exactly at the wanted height above the displaced ground under it: the six altitudes, every heading, tilt up to 89.5, over the Alps and the Himalaya', async () => {
    const world = await loadChunkWorld();
    const ground = (lat: number, lon: number): number => world.field.surfaceRadius(lat, lon);
    const r = rng(5);
    for (let i = 0; i < 120; i++) {
      const alt = [300, 1500, 8000, 60_000, 500_000, 3_000_000, 15_000_000][i % 7] as number;
      const place = i % 2 === 0 ? { lat: 46.5, lon: 8 } : { lat: 28.2, lon: 86.8 };
      const rig = new CameraRig(960, 540);
      setViewAtAgl(rig, ground, { ...place, heading: 360 * r(), tilt: 89.5 * r() }, alt);
      const p = rig.pose().position;
      const { lat, lon } = vecToLatLon(p);
      const agl = (length(p) - ground(lat, lon)) * R_M;
      expect(Math.abs(agl - alt), `case ${i}: wanted ${alt} m, got ${agl.toFixed(3)} m`).toBeLessThan(0.05);
    }
  });

  it('works for the six altitudes of the crack test with the very views the tests use', async () => {
    const world = await loadChunkWorld();
    for (const v of ALTITUDE_VIEWS) {
      const rig = new CameraRig(960, 540);
      setViewAtAgl(rig, (a, b) => world.field.surfaceRadius(a, b), v.view, v.altAglM);
      const p = rig.pose().position;
      const { lat, lon } = vecToLatLon(p);
      expect(((length(p) - world.field.surfaceRadius(lat, lon)) * R_M) / v.altAglM, v.name).toBeCloseTo(1, 6);
    }
  });

  it('bypasses the user zoom limit and the tilt clamp, which stay in force for setView', async () => {
    const world = await loadChunkWorld();
    const rig = new CameraRig(960, 540);
    setViewAtAgl(rig, (a, b) => world.field.surfaceRadius(a, b), { lat: 0, lon: -150, heading: 0, tilt: 88 }, 300);
    expect(rig.view.distKm).toBeLessThan(DIST_MIN_KM);
    expect(rig.view.tilt).toBe(88);
    expect(rig.view.tilt).toBeGreaterThan(TILT_MAX_DEG);
    const user = new CameraRig(960, 540);
    user.setView({ lat: 0, lon: 0, distKm: 5, tilt: 88 });
    expect(user.view.distKm).toBe(DIST_MIN_KM);
    expect(user.view.tilt).toBe(TILT_MAX_DEG);
  });
});

describe('dynamic near / far planes', () => {
  const agl = (m: number): number => m / R_M;

  it('the near plane is a tenth of the height above the ground and the far plane reaches the horizon plus the sky shell', () => {
    for (const m of [300, 8000, 60_000, 500_000, 3_000_000, 15_000_000]) {
      const centre = 1 + agl(m);
      const c = clipPlanes(centre, agl(m));
      expect(c.near).toBeCloseTo(Math.max(2e-7, CLIP_NEAR_FRACTION * agl(m)), 12);
      const horizon = Math.sqrt(centre * centre - 1);
      const shell = Math.sqrt(ATMOSPHERE_TOP * ATMOSPHERE_TOP - 1);
      expect(c.far).toBeGreaterThan(horizon + shell); // the ray that grazes the planet must still reach the far side of the shell
      expect(c.far).toBeLessThan(horizon + shell + 0.2);
      expect(c.near).toBeLessThan(c.far);
    }
  });

  it('a 24-bit depth buffer resolves better than 0.5 percent of the distance at every altitude for everything beyond twice the near plane (no reversed depth needed)', () => {
    for (const m of [300, 8000, 60_000, 500_000, 3_000_000, 15_000_000]) {
      const { near, far } = clipPlanes(1 + agl(m), agl(m));
      // window depth z(d) = (far / (far - near)) * (1 - near / d); the smallest distance step that changes the 24-bit depth value at d
      const dz = 1 / 2 ** 24;
      for (const mult of [2, 10, 100]) {
        const d = near * mult;
        if (d >= far) continue;
        const step = (dz * d * d) / (near * (far / (far - near)));
        expect(step / d, `${m} m, ${mult} x near: resolves ${(100 * step / d).toFixed(4)} % of the distance`).toBeLessThan(0.005);
      }
    }
  });

  it('a camera on or under the ground still gets a valid (positive) near plane', () => {
    const c = clipPlanes(1, 0);
    expect(c.near).toBeGreaterThan(0);
    expect(c.far).toBeGreaterThan(c.near);
  });
});

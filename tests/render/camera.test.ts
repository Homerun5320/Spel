import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/camera';
import { CAMERA_FOV_DEG, DIST_MAX_KM, DIST_MIN_KM, LAT_LIMIT_DEG, TILT_MAX_DEG } from '../../src/render/config';
import { add, cross, dot, latLonToVec, length, normalize, scale, sub, vecToLatLon, type Vec3 } from '../../src/render/geo';
import { raySphere } from '../../src/render/heightField';

const W = 960;
const H = 540;

function finite(v: Vec3): boolean {
  return v.every((x) => Number.isFinite(x));
}

function angleDeg(a: Vec3, b: Vec3): number {
  const c = length(cross(a, b));
  return (Math.atan2(c, dot(a, b)) * 180) / Math.PI;
}

function spherePointAt(rig: CameraRig, px: number, py: number): Vec3 | null {
  const r = rig.rayAt(px, py);
  const t = raySphere(r.origin, r.dir, 1);
  return t === null ? null : add(r.origin, scale(r.dir, t));
}

describe('camera pose', () => {
  it('is finite and orthonormal for every state, looks at the focus point, the focus projects to the centre', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: 0, max: TILT_MAX_DEG, noNaN: true }),
        fc.double({ min: DIST_MIN_KM, max: DIST_MAX_KM, noNaN: true }),
        (lat, lon, heading, tilt, distKm) => {
          const rig = new CameraRig(W, H);
          rig.setView({ lat, lon, heading, tilt, distKm });
          const p = rig.pose();
          for (const v of [p.position, p.target, p.forward, p.up, p.right]) expect(finite(v)).toBe(true);
          expect(Number.isFinite(p.near) && Number.isFinite(p.far) && p.near > 0 && p.far > p.near).toBe(true);
          expect(length(p.forward)).toBeCloseTo(1, 9);
          expect(length(p.up)).toBeCloseTo(1, 9);
          expect(length(p.right)).toBeCloseTo(1, 9);
          expect(dot(p.forward, p.up)).toBeCloseTo(0, 9);
          expect(length(p.position)).toBeGreaterThan(1);
          const toTarget = normalize(sub(p.target, p.position));
          expect(dot(toTarget, p.forward)).toBeCloseTo(1, 9);
          const s = rig.project(p.target);
          expect(s.x).toBeCloseTo(W / 2, 4);
          expect(s.y).toBeCloseTo(H / 2, 4);
          expect(s.facing).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is stable at both poles for every heading and tilt (no NaN, up never parallel to forward)', () => {
    for (const lat of [90, -90]) {
      for (const heading of [0, 45, 90, 180, -135, 270]) {
        for (const tilt of [0, 25, 50, TILT_MAX_DEG]) {
          const rig = new CameraRig(W, H);
          rig.setView({ lat, lon: 0, heading, tilt, distKm: 3000 });
          const p = rig.pose();
          expect(finite(p.position) && finite(p.up) && finite(p.right) && finite(p.forward)).toBe(true);
          expect(length(cross(p.forward, p.up))).toBeGreaterThan(0.99);
          // a ray through the centre hits the pole
          const hit = spherePointAt(rig, W / 2, H / 2);
          expect(hit).not.toBeNull();
          expect(Math.abs(vecToLatLon(hit as Vec3).lat)).toBeCloseTo(90, 5);
        }
      }
    }
  });

  it('is continuous across the pole: lat 89.999 and lat 90 give the same pose', () => {
    for (const heading of [0, 90, 200]) {
      const a = new CameraRig(W, H);
      const b = new CameraRig(W, H);
      a.setView({ lat: 90, lon: 30, heading, tilt: 40, distKm: 4000 });
      b.setView({ lat: 89.999, lon: 30, heading, tilt: 40, distKm: 4000 });
      expect(length(sub(a.pose().position, b.pose().position))).toBeLessThan(1e-4);
      expect(length(sub(a.pose().up, b.pose().up))).toBeLessThan(1e-4);
    }
  });

  it('heading 0 puts north up on screen; heading 90 puts east up', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 40, lon: 10, heading: 0, tilt: 0, distKm: 4000 });
    const north = rig.project(latLonToVec(45, 10));
    const centre = rig.project(latLonToVec(40, 10));
    expect(north.y).toBeLessThan(centre.y);
    rig.setView({ heading: 90 });
    const east = rig.project(latLonToVec(40, 15));
    expect(east.y).toBeLessThan(rig.project(latLonToVec(40, 10)).y);
  });

  it('setView clamps to the zoom and tilt limits, wraps longitude and rejects non-finite values', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ distKm: 1, tilt: 200, lon: 190, lat: 120 });
    expect(rig.view).toMatchObject({ distKm: DIST_MIN_KM, tilt: TILT_MAX_DEG, lon: -170, lat: 90 });
    rig.setView({ distKm: 1e9, tilt: -5 });
    expect(rig.view).toMatchObject({ distKm: DIST_MAX_KM, tilt: 0 });
    expect(() => rig.setView({ lat: Number.NaN })).toThrow();
  });
});

describe('camera projection', () => {
  it('rayAt and project agree: the sphere point under a pixel projects back to that pixel', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 30, lon: -20, heading: 25, tilt: 45, distKm: 5000 });
    for (const [px, py] of [[480, 270], [300, 200], [700, 400], [100, 500], [900, 60]] as const) {
      const hit = spherePointAt(rig, px, py);
      if (!hit) continue;
      const s = rig.project(hit);
      expect(s.x).toBeCloseTo(px, 3);
      expect(s.y).toBeCloseTo(py, 3);
    }
  });

  it('the vertical field of view is CAMERA_FOV_DEG', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 0, lon: 0, heading: 0, tilt: 0, distKm: 20000 });
    const top = rig.rayAt(W / 2, 0);
    const bottom = rig.rayAt(W / 2, H);
    expect(angleDeg(top.dir, bottom.dir)).toBeCloseTo(CAMERA_FOV_DEG, 6);
  });

  it('points behind the horizon are not facing the camera', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 0, lon: 0, distKm: 8000, tilt: 0 });
    expect(rig.project(latLonToVec(0, 0)).facing).toBe(true);
    expect(rig.project(latLonToVec(0, 180)).facing).toBe(false);
  });
});

describe('camera motion', () => {
  it('wheel zoom respects both zoom limits, even after huge deltas and long time steps', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 10, lon: 10, distKm: 5000 });
    rig.update(0);
    for (let i = 0; i < 30; i++) rig.zoomAt(480, 270, -2000);
    rig.update(20);
    expect(rig.view.distKm).toBe(DIST_MIN_KM);
    for (let i = 0; i < 30; i++) rig.zoomAt(480, 270, 2000);
    rig.update(60);
    expect(rig.view.distKm).toBe(DIST_MAX_KM);
    expect(rig.moving).toBe(false);
  });

  it('zoom is anchored at the cursor: the sphere point under the cursor stays under it', () => {
    for (const [px, py, delta] of [[700, 300, -700], [250, 400, -500], [600, 150, 600]] as const) {
      const rig = new CameraRig(W, H);
      rig.setView({ lat: 59.3, lon: 18.1, heading: 0, tilt: 30, distKm: 6000 });
      rig.update(0);
      const before = spherePointAt(rig, px, py) as Vec3;
      expect(before).not.toBeNull();
      rig.zoomAt(px, py, delta);
      for (let t = 0.05; t < 4; t += 0.05) rig.update(t);
      const after = spherePointAt(rig, px, py) as Vec3;
      expect(after).not.toBeNull();
      expect(angleDeg(before, after)).toBeLessThan(0.05);
      expect(rig.view.distKm).not.toBe(6000);
    }
  });

  it('zoom-in at a point away from the centre moves the focus toward it (not a centre zoom)', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 0, lon: 0, tilt: 0, distKm: 8000 });
    rig.update(0);
    rig.zoomAt(800, 270, -800);
    for (let t = 0.05; t < 4; t += 0.05) rig.update(t);
    expect(rig.view.lon).toBeGreaterThan(1);
  });

  it('dragging grabs the globe: the point under the cursor follows the cursor', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 20, lon: 0, heading: 0, tilt: 0, distKm: 9000 });
    rig.update(0);
    const grabbed = spherePointAt(rig, 480, 270) as Vec3;
    rig.dragStart(480, 270, 0);
    for (let i = 1; i <= 10; i++) rig.dragMove(480 + i * 12, 270 - i * 4, i * 0.016);
    const now = spherePointAt(rig, 600, 230) as Vec3;
    expect(angleDeg(grabbed, now)).toBeLessThan(1.5);
    rig.dragEnd(10 * 0.016 + 0.3); // paused: no fling
    expect(rig.moving).toBe(false);
    // dragging right moved the focus west
    expect(rig.view.lon).toBeLessThan(0);
  });

  it('a fling keeps rotating, decays by itself and never produces NaN', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 0, lon: 0, tilt: 0, distKm: 9000 });
    rig.update(0);
    rig.dragStart(300, 270, 0);
    for (let i = 1; i <= 6; i++) rig.dragMove(300 + i * 30, 270, i * 0.016);
    rig.dragEnd(6 * 0.016 + 0.01);
    expect(rig.moving).toBe(true);
    const lon0 = rig.view.lon;
    rig.update(0.5);
    const lon1 = rig.view.lon;
    expect(lon1).toBeLessThan(lon0);
    rig.update(30);
    const lon2 = rig.view.lon;
    rig.update(60);
    expect(rig.view.lon).toBeCloseTo(lon2, 6);
    expect(rig.moving).toBe(false);
    expect(Number.isFinite(rig.view.lon) && Number.isFinite(rig.view.lat)).toBe(true);
  });

  it('dragging toward the pole stops at the latitude limit and stays finite', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 80, lon: 0, tilt: 0, distKm: 4000 });
    rig.update(0);
    rig.dragStart(480, 100, 0);
    for (let i = 1; i <= 60; i++) rig.dragMove(480 + (i % 3), 100 + i * 6, i * 0.016); // drag down: focus moves north
    expect(rig.view.lat).toBeLessThanOrEqual(LAT_LIMIT_DEG);
    expect(Number.isFinite(rig.view.lon)).toBe(true);
    const p = rig.pose();
    expect(finite(p.position) && finite(p.up)).toBe(true);
  });

  it('rotateBy changes heading and clamps the tilt', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 0, lon: 0, tilt: 10, heading: 0, distKm: 5000 });
    rig.rotateBy(100, 10000);
    expect(rig.view.heading).not.toBe(0);
    expect(rig.view.tilt).toBe(TILT_MAX_DEG);
    rig.rotateBy(0, -100000);
    expect(rig.view.tilt).toBe(0);
  });

  it('is deterministic: the same inputs on the fx clock give the same state', () => {
    const run = (): string => {
      const rig = new CameraRig(W, H);
      rig.setView({ lat: 45, lon: 8, tilt: 20, distKm: 7000 });
      rig.update(0);
      rig.dragStart(400, 300, 0);
      rig.dragMove(450, 280, 0.02);
      rig.dragMove(520, 250, 0.04);
      rig.dragEnd(0.05);
      rig.zoomAt(500, 260, -400);
      for (let t = 0.1; t < 3; t += 0.1) rig.update(t);
      return JSON.stringify(rig.view);
    };
    expect(run()).toBe(run());
  });
});

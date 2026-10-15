// CamFix (D158): the camera rig shows the whole globe, centred, when it is zoomed out, in every window shape and whatever tilt and heading it came with. The rig is the one
// `Globe` builds (the real height field as ground and picker); the outline of the disc is projected from first principles (tests/helpers/silhouette.ts).
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/camera';
import { DIST_MAX_KM, DIST_MIN_KM, FIT_FILL_SAFE, FIT_TILT_FREE_KM, TILT_MAX_DEG } from '../../src/render/config';
import { maxDistKm, maxTiltForDist, tiltEaseEndKm } from '../../src/render/fit';
import { add, cross, dot, length, scale, type Vec3 } from '../../src/render/geo';
import { raySphere } from '../../src/render/heightField';
import { pickGround } from '../../src/render/transforms';
import { rng } from '../helpers/rtsMath';
import { makeRtsRig, type RtsWorld, loadRtsWorld } from '../helpers/rtsRig';
import { discBox, rawPoseRig } from '../helpers/silhouette';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});

const FORMATS: ReadonlyArray<readonly [string, number, number]> = [
  ['0.4', 216, 540],
  ['9:16', 304, 540],
  ['4:3', 720, 540],
  ['16:9', 960, 540],
  ['21:9', 1260, 540],
  ['3:1', 1620, 540],
];

const clocks = new WeakMap<CameraRig, number>();
function frames(rig: CameraRig, n: number): void {
  let t = clocks.get(rig) ?? 0;
  for (let i = 0; i < n; i++) {
    t += 1 / 60;
    rig.update(t);
  }
  clocks.set(rig, t);
}

function headingDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

function angleDeg(a: Vec3, b: Vec3): number {
  return (Math.atan2(length(cross(a, b)), dot(a, b)) * 180) / Math.PI;
}

describe('the farthest distance of a window shows the whole globe with room to spare (ACCEPTANS 1 and 2)', () => {
  for (const [name, width, height] of FORMATS) {
    it(`${name} (${width}x${height}): at the maximum distance, tilts 0, 40 and 72 and headings 0, 90 and 200 have at least 5 % free on every side, the globe is centred and fills 55 to 80 % of the narrow half-extent`, () => {
      for (const tilt of [0, 40, 72]) {
        for (const heading of [0, 90, 200]) {
          const rig = new CameraRig(width, height);
          rig.setView({ lat: 20, lon: 10, distKm: 1e9, tilt, heading });
          frames(rig, 5);
          const where = `${name} tilt ${tilt} heading ${heading}`;
          expect(rig.view.distKm, where).toBe(maxDistKm(width / height));
          expect(rig.view.tilt, `${where}: the user's tilt is kept`).toBe(tilt);
          expect(rig.shownTilt, `${where}: nothing of it is shown`).toBe(0);
          const box = discBox(rig);
          expect(box.inFront).toBe(true);
          expect(box.margin, where).toBeGreaterThanOrEqual(0.05);
          expect(box.fillOfNarrow, where).toBeGreaterThanOrEqual(0.55);
          expect(box.fillOfNarrow, where).toBeLessThanOrEqual(0.8);
          expect(Math.abs(box.cx - width / 2) / (width / 2), where).toBeLessThan(0.03);
          expect(Math.abs(box.cy - height / 2) / (height / 2), where).toBeLessThan(0.03);
        }
      }
    });
  }

  it('the old limits, for the record: a camera at 42 000 km and tilt 72 as a raw pose cuts the disc in a 16:9 window (what the user saw), and the rig does not allow that distance with that tilt any more', () => {
    expect(discBox(rawPoseRig(16 / 9, 42_000, 72, 0)).margin).toBeLessThan(0);
    const rig = new CameraRig(960, 540);
    rig.setView({ lat: 20, lon: 10, distKm: 42_000, tilt: 72, heading: 0 });
    expect(rig.view.distKm).toBe(DIST_MAX_KM);
    expect(discBox(rig).margin).toBeGreaterThanOrEqual(0.05);
  });

  it('a window of any shape (random aspect 0.4 to 3) at the maximum distance and any tilt and heading: 5 % free on every side', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 3000 }), fc.double({ min: 0, max: TILT_MAX_DEG, noNaN: true }), fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: -80, max: 80, noNaN: true }), (aspect1000, tilt, heading, lat) => {
        const rig = new CameraRig(Math.round((540 * aspect1000) / 1000), 540);
        rig.setView({ lat, lon: 30, distKm: 1e9, tilt, heading });
        const box = discBox(rig);
        expect(box.margin).toBeGreaterThanOrEqual(0.05);
        expect(box.inFront).toBe(true);
      }),
      { numRuns: 80 },
    );
  });
});

describe('a wheel zoom straight out with the cursor in the middle (ACCEPTANS 3)', () => {
  const NOTCHES = 40;

  function wheelOut(width: number, height: number, tilt: number, heading: number, dist = 3000) {
    const rig = makeRtsRig(w, { lat: 46, lon: 10, distKm: dist, heading, tilt }, undefined, [width, height]);
    const start = rig.view;
    const cx = width / 2;
    const cy = height / 2;
    for (let i = 0; i < NOTCHES; i++) {
      rig.zoomAt(cx, cy, 100);
      frames(rig, 8);
    }
    frames(rig, 120);
    return { rig, start };
  }

  for (const [name, width, height] of FORMATS) {
    it(`${name}: from 3000 km and tilt 60 the whole globe ends up centred (within 3 %), with 5 % free on every side, the heading changes at most a degree and the user's tilt is still 60`, () => {
      const { rig, start } = wheelOut(width, height, 60, 0);
      expect(rig.view.distKm).toBe(maxDistKm(width / height));
      expect(rig.moving).toBe(false);
      const box = discBox(rig);
      expect(box.margin).toBeGreaterThanOrEqual(0.05);
      expect(Math.abs(box.cx - width / 2) / (width / 2)).toBeLessThan(0.03);
      expect(Math.abs(box.cy - height / 2) / (height / 2)).toBeLessThan(0.03);
      expect(headingDiff(rig.view.heading, start.heading)).toBeLessThanOrEqual(1);
      expect(rig.view.tilt).toBeCloseTo(60, 6);
      expect(rig.shownTilt).toBe(0);
      expect(rig.view.lat).toBeCloseTo(46, 6); // the cursor was on the focus: the focus does not move sideways either
      expect(rig.view.lon).toBeCloseTo(10, 6);
    });
  }

  it('whatever tilt (0, 40, 72) and heading (0, 90, 200) the camera came with, in every window shape: whole disc, centred, heading kept', () => {
    for (const [name, width, height] of FORMATS) {
      for (const tilt of [0, 40, 72]) {
        for (const heading of [0, 90, 200]) {
          const { rig, start } = wheelOut(width, height, tilt, heading, 6000);
          const where = `${name} tilt ${tilt} heading ${heading}`;
          const box = discBox(rig);
          expect(box.margin, where).toBeGreaterThanOrEqual(0.05);
          expect(Math.abs(box.cx - width / 2) / (width / 2), where).toBeLessThan(0.03);
          expect(Math.abs(box.cy - height / 2) / (height / 2), where).toBeLessThan(0.03);
          expect(headingDiff(rig.view.heading, start.heading), where).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('the same without a ground (the camera of the first milestones, the arcball zoom): the whole globe, centred', () => {
    for (const [name, width, height] of FORMATS) {
      const rig = new CameraRig(width, height);
      rig.setView({ lat: 46, lon: 10, distKm: 3000, heading: 90, tilt: 60 });
      rig.update(0);
      for (let i = 0; i < NOTCHES; i++) {
        rig.zoomAt(width / 2, height / 2, 100);
        frames(rig, 8);
      }
      frames(rig, 120);
      const box = discBox(rig);
      expect(box.margin, name).toBeGreaterThanOrEqual(0.05);
      expect(Math.abs(box.cx - width / 2) / (width / 2), name).toBeLessThan(0.03);
    }
  });
});

describe('zoom out and in again gives the user\'s tilt back (ACCEPTANS 4), and nothing pops', () => {
  it('3000 km, tilt 60, out to the maximum and the same number of notches back: the user\'s tilt is within a degree, in every window shape', () => {
    for (const [name, width, height] of FORMATS) {
      const rig = makeRtsRig(w, { lat: 46, lon: 10, distKm: 3000, heading: 30, tilt: 60 }, undefined, [width, height]);
      for (let i = 0; i < 30; i++) {
        rig.zoomAt(width / 2, height / 2, 100);
        frames(rig, 8);
      }
      frames(rig, 100);
      expect(rig.shownTilt, name).toBe(0);
      for (let i = 0; i < 30; i++) {
        rig.zoomAt(width / 2, height / 2, -100);
        frames(rig, 8);
      }
      frames(rig, 100);
      expect(rig.view.distKm, name).toBeLessThan(5000);
      expect(Math.abs(rig.view.tilt - 60), name).toBeLessThan(1);
      expect(Math.abs(rig.shownTilt - 60), name).toBeLessThan(1);
    }
  });

  it('a single wheel notch out and in from every distance changes the pose by at most 5 % of the camera\'s distance to the planet\'s centre and at most 3.5 degrees of look direction per frame at 60 fps', () => {
    let worstMove = 0;
    let worstTurn = 0;
    for (const dist of [3000, 6000, 8000, 10_000, 14_000, 18_000, 22_000, 26_000, 30_000]) {
      for (const notch of [100, -100]) {
        const rig = makeRtsRig(w, { lat: 46, lon: 10, distKm: dist, heading: 20, tilt: 60 });
        let prev = rig.pose();
        let t = clocks.get(rig) ?? 0;
        rig.zoomAt(480, 270, notch);
        for (let i = 0; i < 90; i++) {
          t += 1 / 60;
          rig.update(t);
          const p = rig.pose();
          worstMove = Math.max(worstMove, length(add(p.position, scale(prev.position, -1))) / length(p.position));
          worstTurn = Math.max(worstTurn, angleDeg(p.forward, prev.forward));
          prev = p;
        }
        clocks.set(rig, t);
      }
    }
    expect(worstMove).toBeLessThan(0.05);
    expect(worstTurn).toBeLessThanOrEqual(3.5);
  });

  it('a quick spin of the wheel (five notches at once, the zoom itself then moves the camera by a sixth of its distance in the fastest frame) from 8 000 and from 14 000 km: the shown tilt follows the distance, changes by at most 14 degrees and the camera moves at most 20 % of its distance in one frame, and it ends where the distance says', () => {
    for (const start of [8000, 14_000]) {
      const rig = makeRtsRig(w, { lat: 46, lon: 10, distKm: start, heading: 0, tilt: 70 });
      let t = clocks.get(rig) ?? 0;
      let prev = rig.shownTilt;
      let prevPos = rig.pose().position;
      let worstTilt = 0;
      let worstMove = 0;
      rig.zoomAt(480, 270, 500);
      for (let i = 0; i < 240; i++) {
        t += 1 / 60;
        rig.update(t);
        worstTilt = Math.max(worstTilt, Math.abs(rig.shownTilt - prev));
        const p = rig.pose().position;
        worstMove = Math.max(worstMove, length(add(p, scale(prevPos, -1))) / length(p));
        prev = rig.shownTilt;
        prevPos = p;
      }
      expect(worstTilt, `from ${start} km`).toBeLessThan(14);
      expect(worstMove, `from ${start} km`).toBeLessThan(0.2);
      expect(rig.shownTilt).toBeCloseTo(Math.min(70, maxTiltForDist(rig.view.distKm, 960 / 540)), 9);
    }
  });
});

describe('the eased tilt is the pose everywhere: the camera position, the rays, the clearance and the picking use the same pose', () => {
  it('view.tilt is the user\'s, pose() is the shown one: at 20 000 km and tilt 60 the camera is where tilt shownTilt puts it, and cameraPositionFor of the same window gives the same position', () => {
    const rig = new CameraRig(960, 540);
    rig.setView({ lat: 20, lon: 10, distKm: 20_000, tilt: 60, heading: 40 });
    const shown = rig.shownTilt;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(60);
    const other = new CameraRig(960, 540);
    other.setView({ lat: 20, lon: 10, distKm: 20_000, tilt: shown, heading: 40 });
    const a = rig.pose().position;
    const b = other.pose().position;
    for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k] as number, 9);
    // a window of another shape eases the same view differently
    const tall = new CameraRig(304, 540);
    tall.setView({ lat: 20, lon: 10, distKm: 20_000, tilt: 60, heading: 40 });
    expect(tall.shownTilt).toBeGreaterThan(shown);
  });

  it('the pick round trip (a pixel to the sphere or the ground and back) is within a pixel at zoomed-out poses with a tilt (ACCEPTANS 5), in six window shapes and from 8 000 to the maximum distance', () => {
    const r = rng(77);
    let worst = 0;
    let n = 0;
    for (const [, width, height] of FORMATS) {
      for (const dist of [8000, 12_000, 16_000, 22_000, 40_000]) {
        for (const tilt of [20, 45, 72]) {
          const rig = makeRtsRig(w, { lat: 10 + 40 * r(), lon: 360 * r() - 180, distKm: dist, heading: 360 * r(), tilt }, undefined, [width, height]);
          for (let i = 0; i < 12; i++) {
            const px = width * (0.1 + 0.8 * r());
            const py = height * (0.1 + 0.8 * r());
            const ray = rig.rayAt(px, py);
            const sphere = raySphere(ray.origin, ray.dir, 1);
            if (sphere !== null) {
              const q = add(ray.origin, scale(ray.dir, sphere));
              const s = rig.project(q);
              worst = Math.max(worst, Math.hypot(s.x - px, s.y - py));
              n++;
            }
            const hit = pickGround(w.world.detailField, ray);
            if (hit) {
              const s = rig.project(hit.point);
              worst = Math.max(worst, Math.hypot(s.x - px, s.y - py));
              n++;
            }
          }
        }
      }
    }
    expect(n).toBeGreaterThan(400);
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('a flight puts the camera by its pose and the pose stays as placed, even far out at a high tilt (the eased tilt is for what the user does, not for what a flight places); the first thing the user does hands it back', () => {
    const rig = makeRtsRig(w, { lat: 46, lon: 10, distKm: 3000, heading: 0, tilt: 0 });
    const src = new CameraRig(960, 540);
    src.setViewUnclamped({ lat: 30, lon: 20, distKm: 14_000, heading: 50, tilt: 65 });
    const raw = src.pose();
    rig.setPose(raw.position, raw.forward);
    const placed = rig.pose();
    for (let k = 0; k < 3; k++) {
      expect(placed.position[k]).toBeCloseTo(raw.position[k] as number, 9);
      expect(placed.forward[k]).toBeCloseTo(raw.forward[k] as number, 9);
    }
    expect(rig.shownTilt).toBeCloseTo(rig.view.tilt, 12);
    rig.zoomAt(480, 270, 10);
    frames(rig, 1);
    expect(rig.shownTilt).toBeLessThan(rig.view.tilt); // the user's input: the eased tilt is in force
  });
});

describe('the window shape follows a resize', () => {
  it('setViewport recomputes the farthest distance and brings a distance beyond it to it; a taller window allows farther', () => {
    const rig = new CameraRig(960, 540);
    rig.setView({ lat: 0, lon: 0, distKm: 1e9, tilt: 0 });
    expect(rig.view.distKm).toBe(maxDistKm(960 / 540));
    rig.setViewport(300, 540);
    expect(rig.maxDistKm).toBeGreaterThan(rig.view.distKm);
    rig.setView({ distKm: 1e9 });
    expect(rig.view.distKm).toBe(maxDistKm(300 / 540));
    rig.setViewport(1260, 540);
    expect(rig.view.distKm).toBe(DIST_MAX_KM); // 300 / 540 had more: the distance is brought down to the new maximum
    expect(discBox(rig).margin).toBeGreaterThanOrEqual(0.05);
    rig.setViewport(0, 0); // a canvas with no size yet: nothing breaks
    expect(Number.isFinite(rig.maxDistKm)).toBe(true);
    rig.setViewport(960, 540);
  });

  it('the distance target of a zoom under way is brought to the new maximum as well (no zoom that continues past the new limit)', () => {
    const rig = new CameraRig(300, 540);
    rig.setView({ lat: 0, lon: 0, distKm: 20_000, tilt: 0 });
    rig.update(0);
    rig.zoomAt(150, 270, 5000);
    rig.setViewport(1260, 540);
    frames(rig, 200);
    expect(rig.view.distKm).toBe(DIST_MAX_KM);
  });
});

describe('the user\'s tilt: dragging it works from what is shown (no dead zone) and never stores what cannot be shown', () => {
  it('far out, a right drag UP from a tilt that is eased to 10 starts at 10 and cannot go above what the distance allows; a drag that only turns the heading leaves the tilt alone', () => {
    const rig = new CameraRig(960, 540);
    rig.setView({ lat: 0, lon: 0, distKm: 18_000, tilt: 60, heading: 0 });
    rig.update(0);
    const cap = maxTiltForDist(18_000, 960 / 540);
    expect(cap).toBeLessThan(60);
    rig.rotateBy(30, 0);
    expect(rig.view.tilt).toBe(60);
    expect(rig.view.heading).not.toBe(0);
    rig.rotateBy(0, 20); // wanting more tilt than the distance shows
    expect(rig.view.tilt).toBeCloseTo(cap, 9);
    rig.rotateBy(0, -10); // and back down: the first pixel is felt
    expect(rig.view.tilt).toBeLessThan(cap - 0.1);
  });

  it('close in (under 8 000 km) a right drag is what it was: the tilt limits are the user\'s', () => {
    const rig = new CameraRig(960, 540);
    rig.setView({ lat: 0, lon: 0, distKm: 5000, tilt: 40, heading: 0 });
    rig.update(0);
    rig.rotateBy(0, 1000);
    expect(rig.view.tilt).toBe(TILT_MAX_DEG);
    rig.rotateBy(0, -1000);
    expect(rig.view.tilt).toBe(0);
  });
});

describe('no NaN, whatever the hands do far out', () => {
  it('600 random wheel notches, drags, turns and views in six window shapes, from 100 km to the maximum: every number of the pose and of the view is finite, the distance stays in its limits, the disc is never behind the camera', () => {
    const r = rng(2024);
    for (const [name, width, height] of FORMATS) {
      const rig = makeRtsRig(w, { lat: 30, lon: 20, distKm: 12_000, heading: 0, tilt: 30 }, undefined, [width, height]);
      let t = 0;
      for (let i = 0; i < 100; i++) {
        const k = Math.floor(r() * 5);
        const px = width * r();
        const py = height * r();
        if (k === 0) rig.zoomAt(px, py, (r() - 0.5) * 800);
        else if (k === 1) {
          rig.dragStart(px, py, t);
          rig.dragMove(px + (r() - 0.5) * 200, py + (r() - 0.5) * 200, t + 0.016);
          rig.dragEnd(t + 0.02);
        } else if (k === 2) rig.rotateBy((r() - 0.5) * 300, (r() - 0.5) * 300);
        else if (k === 3) rig.setView({ lat: 180 * r() - 90, lon: 360 * r() - 180, distKm: DIST_MIN_KM + r() * 1e5, tilt: TILT_MAX_DEG * r(), heading: 360 * r() });
        else rig.yawBy((r() - 0.5) * 90);
        for (let f = 0; f < 6; f++) {
          t += 1 / 60;
          rig.update(t);
        }
        const v = rig.view;
        const p = rig.pose();
        for (const x of [v.lat, v.lon, v.distKm, v.heading, v.tilt, rig.shownTilt, ...p.position, ...p.forward, ...p.up, ...p.right, p.near, p.far]) expect(Number.isFinite(x), `${name} step ${i}`).toBe(true);
        expect(v.distKm).toBeLessThanOrEqual(rig.maxDistKm + 1e-9);
      }
    }
  });
});

describe('the constants the camera uses', () => {
  it('the eased tilt starts after 8 000 km, where the RTS zoom ends, in a window of every shape (so the RTS camera never sees it)', () => {
    expect(FIT_TILT_FREE_KM).toBeGreaterThanOrEqual(7900);
    for (const [, width, height] of FORMATS) {
      const end = tiltEaseEndKm(width / height);
      expect(end).toBeGreaterThan(FIT_TILT_FREE_KM);
      expect(end).toBeLessThan(maxDistKm(width / height));
      expect(FIT_FILL_SAFE).toBeLessThan(0.95);
    }
  });
});

// M08 audit pass: the wheel zoom of the RTS camera over rugged ground. Four things the first build got wrong and no test caught: (1) a notch at a
// high tilt and a low height threw the camera thousands of kilometres away (the anchor correction fell back to the nearest point of a sphere
// the cursor ray missed), (2) the height regulator hunted for kilometres over a plateau, (3) a zoom could fail to settle, (4) the point under
// the cursor drifted by tens of pixels. All four are measured here on the REAL height field, per frame.
import { beforeAll, describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/camera';
import { DIST_MAX_KM, RTS_AGL_FULL_M, ZOOM_MIN_AGL_M } from '../../src/render/config';
import { GROUND_VIEWS } from '../../src/render/views';
import { viewFromGroundCamera } from '../../src/render/camera';
import { pickGround } from '../../src/render/transforms';
import { rng } from '../helpers/rtsMath';
import { cameraMovedM, loadRtsWorld, makeRigLookingAt, makeRtsRig, placeLookingAt, type RtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});

const PLACES = [
  { name: 'Andes', lat: -32.65, lon: -70.0 },
  { name: 'Alps', lat: 46.0, lon: 7.7 },
  { name: 'Himalaya', lat: 28.4, lon: 86.7 },
] as const;

const clocks = new WeakMap<CameraRig, number>();

/** Runs `frames` frames of 1/60 s on the rig's own fx clock (it starts at 0, where `makeRtsRig` updated it); returns the per-frame record: metres moved since the previous frame and the height over the ground. */
function runFrames(rig: CameraRig, frames: number): { moved: number[]; agl: number[]; total: number } {
  const moved: number[] = [];
  const agl: number[] = [];
  let t = clocks.get(rig) ?? 0;
  const start = rig.pose().position;
  let prev = start;
  for (let i = 0; i < frames; i++) {
    t += 1 / 60;
    rig.update(t);
    const p = rig.pose().position;
    moved.push(cameraMovedM(prev, p));
    agl.push(rig.aglM());
    prev = p;
  }
  clocks.set(rig, t);
  return { moved, agl, total: cameraMovedM(start, prev) };
}

describe('one wheel notch never throws the camera away (the 2 600 to 7 000 km teleport of the first build)', () => {
  // The bound: a notch is a share of the height and the camera travels along the cursor ray, at least ~11 degrees below the horizontal (the
  // clamp), so a zoom over smooth ground is about (share / 0.2) heights; a wall of rock behind a zoom out can make it a few heights more. The
  // first build threw the camera 2 600 to 7 000 KILOMETRES (thousands of heights); 10 heights and a kilometre is far outside any real zoom.
  const bound = (aglM: number): number => 10 * aglM + 1000;

  it('Andes, 620 m up, tilt 66 (the reproduction of the audit), cursor at the upper part of the screen: the first frame moves the camera less than 1 % of its distance to the sea-level focus, and no frame jumps', () => {
    const rig = makeRigLookingAt(w, -32.65, -70.0, 620, 66, 30, [480, 270]);
    const agl0 = rig.aglM();
    const focusDistM = rig.view.distKm * 1000;
    rig.zoomAt(240, 160, -100);
    const r = runFrames(rig, 120);
    expect(r.moved[0] as number, 'first frame (m)').toBeLessThan(0.01 * focusDistM);
    expect(r.total, 'whole zoom (m)').toBeLessThan(bound(agl0));
    expect(Math.max(...r.moved), 'worst frame (m)').toBeLessThan(0.25 * r.total + 5);
    expect(Math.min(...r.agl)).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.5);
  });

  it('a control: the displacement measure would flag a teleport (the camera put 5 000 km away is far above the bound)', () => {
    const rig = makeRigLookingAt(w, -32.65, -70.0, 620, 66, 30, [480, 270]);
    const a = rig.pose().position;
    placeLookingAt(w, rig, -18.7, -11.9, 47_700, 66, 30);
    expect(cameraMovedM(a, rig.pose().position)).toBeGreaterThan(100 * bound(620));
  });

  for (const place of PLACES) {
    it(`${place.name}: tilt 60 to 80 at 300 m and 2 km, a notch in and a notch out at three cursors: the whole zoom stays within a few heights, no frame jumps, and it settles`, () => {
      let cases = 0;
      for (const agl of [300, 2000]) {
        for (const tilt of [60, 65, 70, 75, 80]) {
          for (const notch of [-100, 100]) {
            for (const [cx, cy] of [
              [160, 110],
              [160, 40],
              [60, 150],
            ] as const) {
              const rig = makeRigLookingAt(w, place.lat, place.lon, agl, tilt, 30, [320, 180]);
              const agl0 = rig.aglM();
              rig.zoomAt(cx, cy, notch);
              const r = runFrames(rig, 150);
              const where = `${place.name} agl ${agl} tilt ${tilt} notch ${notch} cursor ${cx},${cy}`;
              expect(r.total, where).toBeLessThan(bound(agl0));
              expect(Math.max(...r.moved), where).toBeLessThan(0.25 * r.total + 5);
              expect(Math.min(...r.agl)).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.5);
              expect(rig.moving).toBe(false);
              cases++;
            }
          }
        }
      }
      expect(cases).toBe(2 * 5 * 2 * 3);
    });
  }
});

describe('the height does not hunt (the first wheel nudge after ?view=himalaya-valley raised the camera by 1.7 km instead of 62 m)', () => {
  it('one eighth of a notch outward in the Himalaya valley view: the height stays within +-25 % of the target in every frame and changes by at most 15 % per frame', () => {
    const rig = new CameraRig(960, 540);
    rig.setGround(w.ground, w.smooth);
    rig.setPicker((o, d) => w.world.detailField.pick(o, d)?.point ?? null);
    rig.setViewUnclamped(viewFromGroundCamera(GROUND_VIEWS['himalaya-valley'], w.ground));
    rig.update(0);
    const agl0 = rig.aglM();
    const target = agl0 * Math.exp(20 * 0.0016);
    rig.zoomAt(480, 300, 20);
    const r = runFrames(rig, 150);
    let prev = agl0;
    for (const a of r.agl) {
      expect(Math.abs(a - target) / target).toBeLessThan(0.25);
      expect(Math.abs(a - prev) / prev).toBeLessThan(0.15);
      prev = a;
    }
    expect(Math.abs((r.agl[r.agl.length - 1] as number) - target)).toBeLessThan(1);
  });

  it('a notch at 2 km and tilt 80 over the Himalaya valley: every frame within +-25 % of the target, then it rests there', () => {
    for (const notch of [-100, -40, 40, 100]) {
      const rig = makeRigLookingAt(w, 28.2, 86.8, 2000, 80, 0);
      const agl0 = rig.aglM();
      const target = Math.max(agl0 * Math.exp(notch * 0.0016), ZOOM_MIN_AGL_M);
      rig.zoomAt(480, 400, notch);
      const r = runFrames(rig, 150);
      for (const a of r.agl) expect(Math.abs(a - target) / target, `notch ${notch}`).toBeLessThan(0.25 + Math.abs(agl0 - target) / target);
      expect(Math.abs((r.agl[r.agl.length - 1] as number) - target), `notch ${notch}`).toBeLessThan(1.5);
    }
  });
});

describe('a zoom that eases the tilt on its way still ends at the height it asked for (the e2e of the globe scene found a zoom that stopped at 13 km instead of 300 m)', () => {
  it('the globe scene of e2e/globe.test.ts: a notch from 6 000 km, then twelve huge notches (the tilt is eased from 7 to 20 degrees on the way): the camera ends at the 300 m floor, and a single notch ends within 0.5 % of its goal', () => {
    const rig = makeRtsRig(w, { lat: 59.3, lon: 18.1, distKm: 6000, heading: 0, tilt: 0 });
    rig.zoomAt(700, 300, -700);
    runFrames(rig, 180);
    const agl0 = rig.aglM();
    for (let i = 0; i < 12; i++) rig.zoomAt(700, 300, -3000);
    runFrames(rig, 40 * 30);
    expect(rig.aglM()).toBeLessThan(ZOOM_MIN_AGL_M + 2);
    expect(rig.moving).toBe(false);
    const rig2 = makeRtsRig(w, { lat: 59.3, lon: 18.1, distKm: 2000, heading: 0, tilt: 0 });
    const start = rig2.aglM();
    rig2.zoomAt(700, 300, -250);
    runFrames(rig2, 600);
    const goal = Math.max(start * Math.exp(-250 * 0.0016), ZOOM_MIN_AGL_M);
    expect(agl0).toBeLessThan(4_000_000);
    expect(Math.abs(rig2.aglM() - goal) / goal).toBeLessThan(0.005);
    expect(rig2.moving).toBe(false);
  });
});

describe('a zoom out from the floor reaches the farthest view (e2e/globe.test.ts: twelve huge notches out end at DIST_MAX_KM)', () => {
  it('twelve notches of +3000 with no frame between them, from 300 m over Stockholm: the view ends at DIST_MAX_KM, in the globe regime, at rest', () => {
    const rig = makeRtsRig(w, { lat: 59.3, lon: 18.1, distKm: 200, heading: 0, tilt: 30 }, 300);
    for (let i = 0; i < 12; i++) rig.zoomAt(700, 300, 3000);
    runFrames(rig, 80 * 30);
    expect(rig.view.distKm).toBe(DIST_MAX_KM);
    expect(rig.rtsWeight).toBe(0);
    expect(rig.moving).toBe(false);
  });
});

describe('a wheel zoom ends: the camera rests, the held height is the one it reached', () => {
  it('the dive of the audit (Andes, tilt 83.7, a hold of 6.5 km, one notch in): it is not stuck at the 300 m floor, it rests, and its tilt is inside the limit', () => {
    const rig = makeRtsRig(w, { lat: -29.356231446626587, lon: -71.94277282826654, distKm: 422.4808027305167, heading: -26.324564123133882, tilt: 83.74440355136304 });
    rig.setHoldAgl(6555.8);
    const agl0 = rig.aglM();
    rig.zoomAt(394.91, 105.45, -477.58);
    const r = runFrames(rig, 12 * 60);
    expect(rig.moving).toBe(false);
    expect(Math.abs(rig.aglM() - (rig.holdAgl as number))).toBeLessThan(1);
    expect(rig.aglM()).toBeGreaterThan(Math.min(agl0, 3 * ZOOM_MIN_AGL_M) * 0.4);
    expect(rig.localTilt()).toBeLessThanOrEqual(80.05);
    expect(r.agl.every((a) => a >= ZOOM_MIN_AGL_M - 0.5)).toBe(true);
  });

  for (const place of PLACES.filter((p) => p.name !== 'Alps')) {
    it(`${place.name}: 100 single notches (random tilt, cursor, size, direction), each followed by 5 s of idle frames: moving is false and the height equals the held height within a metre`, () => {
      const r = rng(77);
      const rig = makeRigLookingAt(w, place.lat, place.lon, 5000, 55, 20);
      let unsettled = 0;
      for (let n = 0; n < 100; n++) {
        const agl = [1500, 6500, 30_000][n % 3] as number;
        placeLookingAt(w, rig, place.lat + 0.3 * (r() - 0.5), place.lon + 0.3 * (r() - 0.5), agl, 40 + 40 * r(), 360 * r());
        const notch = (r() < 0.5 ? -1 : 1) * (120 + 360 * r());
        rig.zoomAt(100 + 760 * r(), 40 + 460 * r(), notch);
        runFrames(rig, 5 * 60);
        const hold = rig.holdAgl;
        if (rig.moving || hold === null || Math.abs(rig.aglM() - hold) >= 1) unsettled++;
      }
      expect(unsettled).toBe(0);
    });
  }
});

describe('the ground point under the cursor stays under it during a wheel zoom over mountains (tolerance 3 px)', () => {
  it('Himalaya, Alps and Andes at 3 km, 30 km and 300 km, 40 random cursors each, a notch in or out: within 3 px in every frame of a second (a few notches that would need a flight of kilometres go straight up or down and are counted apart)', () => {
    const r = rng(2024);
    let measured = 0;
    let vertical = 0;
    let worst = 0;
    for (const place of PLACES) {
      for (const agl of [3000, 30_000, 300_000]) {
        const rig = makeRigLookingAt(w, place.lat, place.lon, agl, 50, 40);
        for (let n = 0; n < 40; n++) {
          placeLookingAt(w, rig, place.lat + 0.2 * (r() - 0.5), place.lon + 0.2 * (r() - 0.5), agl, 25 + 50 * r(), 360 * r());
          const x = 100 + 760 * r();
          const y = 100 + 400 * r();
          const hit = pickGround(w.world.detailField, rig.rayAt(x, y));
          if (!hit) continue;
          rig.zoomAt(x, y, (r() < 0.5 ? -1 : 1) * 120);
          measured++;
          if (rig.zoomKind === 'vertical') {
            vertical++;
            runFrames(rig, 60);
            continue;
          }
          expect(rig.zoomKind).toBe('ray');
          for (let i = 0; i < 60; i++) {
            runFrames(rig, 1);
            const s = rig.project(hit.point);
            worst = Math.max(worst, Math.hypot(s.x - x, s.y - y));
          }
        }
      }
    }
    expect(measured).toBeGreaterThan(300);
    expect(vertical / measured, 'share of notches that went straight up or down').toBeLessThan(0.04);
    expect(worst, 'worst distance of the ground point from the cursor (px)').toBeLessThan(3);
  });

  it('the control: without the anchoring (a plain dolly along the LOOK ray) the same point drifts far more than 3 px, so the measure can fail', () => {
    const rig = makeRigLookingAt(w, 28.2, 86.8, 3000, 55, 40);
    const x = 800;
    const y = 120;
    const P = pickGround(w.world.detailField, rig.rayAt(x, y))?.point;
    expect(P).toBeDefined();
    rig.zoomAt(480, 270, -300); // zoomed toward the centre, measured at the other pixel
    runFrames(rig, 60);
    const s = rig.project(P as [number, number, number]);
    expect(Math.hypot(s.x - x, s.y - y)).toBeGreaterThan(30);
    expect(RTS_AGL_FULL_M).toBeGreaterThan(rig.aglM());
  });
});

describe('a grip-pan that drags the cursor beyond the horizon of the grabbed ground does not throw the camera (the same fallback as the zoom)', () => {
  for (const place of PLACES) {
    it(`${place.name}: 300 m up, tilt 75 to 80, three headings, the cursor dragged up past the horizon in 3 px events: no call moves the camera more than the cap (a few times its range to the grabbed point), it rests at the end and keeps its clearance`, () => {
      for (const tilt of [75, 78, 80]) {
        for (const heading of [30, 120, 250]) {
          const rig = makeRigLookingAt(w, place.lat, place.lon, 300, tilt, heading, [320, 180]);
          const hit = pickGround(w.world.detailField, rig.rayAt(160, 150));
          if (!hit) continue;
          const where = `${place.name} tilt ${tilt} heading ${heading}`;
          let t = 0;
          let prev = rig.pose().position;
          const check = (what: string): void => {
            const p = rig.pose().position;
            // the cap of one correction is the range to the held point (and 2 km), several passes and the follow may each use it
            expect(cameraMovedM(prev, p), `${where} ${what}`).toBeLessThan(4 * cameraMovedM(prev, hit.point) + 4000);
            prev = p;
          };
          rig.dragStart(160, 150, t);
          for (let y = 147; y >= 0; y -= 3) {
            t += 1 / 60;
            rig.dragMove(160, y, t);
            check(`drag to ${y}`);
            rig.update(t);
            check(`frame at ${y}`);
            expect(rig.aglM()).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.5);
          }
          rig.dragEnd(t + 0.3);
          for (let i = 0; i < 240; i++) {
            t += 1 / 60;
            rig.update(t);
            check(`after the release, frame ${i}`);
          }
          const end = rig.pose().position;
          for (let i = 0; i < 30; i++) {
            t += 1 / 60;
            rig.update(t);
          }
          expect(cameraMovedM(end, rig.pose().position), `${where} at rest`).toBeLessThan(1);
        }
      }
    });
  }
});

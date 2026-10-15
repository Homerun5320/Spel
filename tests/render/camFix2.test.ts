// CamFix-2: four measured camera faults of CamFix, each with a test that fails on the code before: a flight grabbed mid-way, the right drag that lost the
// user's tilt, the quick wheel spin, and the start view in a tall window. (The fifth item is wording only.)
import { beforeAll, describe, expect, it } from 'vitest';
import { CameraRig, cameraPositionFor } from '../../src/render/camera';
import { DEFAULT_VIEW, FIT_FILL_SAFE, ROTATE_DEG_PER_PX, TILT_MAX_DEG } from '../../src/render/config';
import { CameraFlight } from '../../src/render/flyTo';
import { discExtent, fitViewDistKm, maxDistKm, maxTiltForDist } from '../../src/render/fit';
import { length, scale, add, type Vec3 } from '../../src/render/geo';
import { makeRtsRig, type RtsWorld, loadRtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});

const DT = 1 / 60;
const MAX_TILT_STEP_DEG = 2.2 + 1e-6; // M08's limit per frame
const MAX_MOVE = 0.029 + 1e-6; // M08's limit per frame, as a share of the camera's distance from the planet's centre

/** The camera position change of the SHOWN tilt alone, as a share of the position: the same view with the tilt of the last frame against the one of this frame. */
function tiltMove(rig: CameraRig, prevShown: number, aspect: number): number {
  const v = rig.view;
  const a = cameraPositionFor({ ...v, tilt: prevShown }, aspect);
  const b = cameraPositionFor({ ...v, tilt: rig.shownTilt }, aspect);
  return length(add(a, scale(b, -1))) / length(b);
}

describe('1. a flight that is grabbed mid-way does not make the picture jump', () => {
  for (const grab of ['wheel', 'drag'] as const) {
    it(`flight 21 500 km -> Himalaya 3 km, tilt 60, grabbed by the ${grab} at every tenth frame: after the grab no frame changes the shown tilt by more than 2.2 degrees or the pose by more than 2.9 %`, () => {
      const probe = makeRtsRig(w, { lat: 20, lon: 12, distKm: 21_500, heading: 0, tilt: 0 });
      const f0 = new CameraFlight(probe, () => 0);
      f0.flyTo(28.2, 86.8, 0, { altAglM: 3000, tilt: 60, heading: 30 });
      const frames = Math.ceil((f0.groundDuration as number) / DT);
      expect(frames).toBeGreaterThan(100);
      let worstTilt = 0;
      let worstMove = 0;
      let sawFarTilt = false;
      for (let k = 0; k < frames; k += 10) {
        const rig = makeRtsRig(w, { lat: 20, lon: 12, distKm: 21_500, heading: 0, tilt: 0 });
        let t = 0;
        const flight = new CameraFlight(rig, () => t);
        flight.flyTo(28.2, 86.8, 0, { altAglM: 3000, tilt: 60, heading: 30 });
        for (let i = 0; i < k; i++) {
          t += DT;
          flight.update(t);
          rig.update(t);
        }
        const farTilted = rig.view.distKm > 12_000 && rig.shownTilt > 20;
        if (farTilted) sawFarTilt = true;
        let prevShown = rig.shownTilt;
        const prevPos: Vec3 = rig.pose().position;
        flight.cancel();
        if (grab === 'wheel') rig.zoomAt(480, 270, 0); // a zero notch: the grab without a motion of its own
        else rig.dragStart(480, 270, t);
        let prev = prevPos;
        for (let i = 0; i < 90; i++) {
          t += DT;
          rig.update(t);
          worstTilt = Math.max(worstTilt, Math.abs(rig.shownTilt - prevShown));
          worstMove = Math.max(worstMove, tiltMove(rig, prevShown, 960 / 540));
          prevShown = rig.shownTilt;
          prev = rig.pose().position;
        }
        expect(prev).toBeDefined();
      }
      expect(sawFarTilt, 'the flight really is far out at a high tilt at some grab').toBe(true);
      expect(worstTilt).toBeLessThanOrEqual(MAX_TILT_STEP_DEG);
      expect(worstMove).toBeLessThanOrEqual(MAX_MOVE);
    });
  }
});

describe('2. a right drag that turns the globe far out keeps the user\'s tilt', () => {
  for (const distKm of [25_000, 18_000, 12_000]) {
    for (const dy of [0, 0.5, 1, 3, -3]) {
      it(`${distKm} km, vertical drag ${dy} px: the stored tilt changes by the drag's own delta, and zooming in gives it back`, () => {
        const rig = new CameraRig(960, 540);
        rig.setView({ lat: 40, lon: 10, distKm, tilt: 60, heading: 0 });
        rig.rotateBy(40, dy);
        const expected = Math.min(TILT_MAX_DEG, Math.max(0, 60 + dy * ROTATE_DEG_PER_PX));
        expect(Math.abs(rig.view.tilt - expected)).toBeLessThan(0.01);
        rig.setView({ distKm: 3000 });
        expect(Math.abs(rig.shownTilt - expected)).toBeLessThan(0.01);
      });
    }
  }
});

describe('3. a quick spin of the wheel does not jump the shown tilt', () => {
  for (const start of [8000, 14_000]) {
    it(`from ${start} km at tilt 70, 240 frames: at most 2.2 degrees and 2.9 % of the pose from the tilt per frame; it ends where the distance says, and the tilt is back after zooming in`, () => {
      const rig = makeRtsRig(w, { lat: 46, lon: 10, distKm: start, heading: 0, tilt: 70 });
      let t = 0;
      let prev = rig.shownTilt;
      let worstTilt = 0;
      let worstMove = 0;
      rig.zoomAt(480, 270, 500);
      for (let i = 0; i < 240; i++) {
        t += DT;
        rig.update(t);
        worstTilt = Math.max(worstTilt, Math.abs(rig.shownTilt - prev));
        worstMove = Math.max(worstMove, tiltMove(rig, prev, 960 / 540));
        prev = rig.shownTilt;
      }
      expect(worstTilt, `from ${start} km`).toBeLessThanOrEqual(MAX_TILT_STEP_DEG);
      expect(worstMove, `from ${start} km`).toBeLessThanOrEqual(MAX_MOVE);
      expect(rig.shownTilt).toBeCloseTo(Math.min(70, maxTiltForDist(rig.view.distKm, 960 / 540)), 9); // the value of a still picture is unchanged
      expect(rig.view.tilt).toBe(70);
      for (let i = 0; i < 3000 && rig.view.distKm >= 7000; i++) {
        if (i % 30 === 0) rig.zoomAt(480, 270, -100);
        t += DT;
        rig.update(t);
      }
      for (let i = 0; i < 400; i++) {
        t += DT;
        rig.update(t);
      }
      expect(rig.view.distKm).toBeLessThan(8000);
      expect(rig.shownTilt).toBeCloseTo(70, 9);
    });
  }
});

describe('4. the start view fits the disc in every window shape', () => {
  for (const aspect of [0.4, 9 / 16, 4 / 3, 16 / 9, 21 / 9]) {
    it(`aspect ${aspect.toFixed(3)}: the disc fits with the margin, and a window of 1 or more keeps 21 500 km`, () => {
      const d = fitViewDistKm(DEFAULT_VIEW.distKm, aspect);
      expect(discExtent(d, 0, aspect).fill).toBeLessThanOrEqual(FIT_FILL_SAFE + 1e-9);
      expect(d).toBeLessThanOrEqual(maxDistKm(aspect));
      if (aspect >= 1) expect(d).toBe(DEFAULT_VIEW.distKm);
    });
  }
  it('the old start view really was cut in a 9:16 window (the test can fail), and the 16:9 view is bit-identical', () => {
    expect(discExtent(DEFAULT_VIEW.distKm, 0, 9 / 16).fill).toBeGreaterThan(1);
    expect(Object.is(fitViewDistKm(21_500, 16 / 9), 21_500)).toBe(true);
    const rig = new CameraRig(304, 540);
    rig.setView({ ...DEFAULT_VIEW, distKm: fitViewDistKm(DEFAULT_VIEW.distKm, 304 / 540) });
    expect(discExtent(rig.view.distKm, rig.shownTilt, 304 / 540).fill).toBeLessThan(1);
  });
});

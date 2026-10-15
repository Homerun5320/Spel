// CamFix-2 regression (e2e/rts.test.ts, "wheel all the way in stops 300 m above the ground"): the rate-limited shown-tilt limit of CamFix-2 was clamped at
// 90 degrees even where it is not in force (every distance of 8 000 km and less). A stored tilt is the angle at the sea-level focus, and it is above 90
// for a camera that has dipped under the sea-level sphere, which a wheel zoom of 14 notches over open water does for a moment (the dolly lands a hair
// low and the pose is read back from the other side of the sphere). The clamp then showed that camera thousands of kilometres away, the dolly went on
// from there, and the camera ended 360 km up at a tilt of 83.6 instead of 300 m up. The experiment is the e2e test's, on the camera the page builds
// (the real height field and its picker), in the same simulated time: 14 real wheel events at the cursor (520, 280) from a view of 4 000 km at tilt 30
// (the fx clock then runs 60 frames of half a second).
import { beforeAll, describe, expect, it } from 'vitest';
import { FIT_TILT_FREE_KM, ZOOM_MIN_AGL_M } from '../../src/render/config';
import { loadRtsWorld, makeRtsRig, type RtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});

describe('wheel all the way in rests at the 300 m floor, over open sea and over a ridge, from tilt 30 with the cursor off the centre', () => {
  for (const [lat, lon, what] of [
    [0, -150, 'open sea (Pacific)'],
    [28.2, 86.8, 'the Himalaya'],
  ] as const) {
    it(`${what}: 14 notches of -1500 at (520, 280) from 4 000 km, then 60 frames of 0.5 s: 300 to 600 m over the ground, the RTS regime, and a shown tilt that is the stored one at every distance of 8 000 km and less`, () => {
      const rig = makeRtsRig(w, { lat, lon, distKm: 4000, heading: 0, tilt: 30 });
      rig.setView({ lat, lon, distKm: 4000, heading: 0, tilt: 30 }); // as the e2e hook does it (the limits of the user's view)
      for (let i = 0; i < 14; i++) rig.zoomAt(520, 280, -1500);
      let t = 0;
      let worstGap = 0; // the largest |shown - stored| at a distance where the limit is not in force
      for (let i = 0; i < 60; i++) {
        t += 0.5;
        rig.update(t);
        const v = rig.view;
        for (const x of [v.lat, v.lon, v.distKm, v.heading, v.tilt, rig.shownTilt, rig.aglM()]) expect(Number.isFinite(x), `${what} frame ${i}`).toBe(true);
        if (v.distKm <= FIT_TILT_FREE_KM) worstGap = Math.max(worstGap, Math.abs(rig.shownTilt - v.tilt));
      }
      const agl = rig.aglM();
      expect(agl, `${what}: rests ${agl.toFixed(1)} m over the ground, tilt ${rig.view.tilt.toFixed(1)}`).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.5);
      expect(agl, what).toBeLessThan(2 * ZOOM_MIN_AGL_M);
      expect(rig.rtsWeight, what).toBe(1);
      expect(rig.moving, what).toBe(false);
      expect(worstGap, what).toBe(0);
    });
  }
});

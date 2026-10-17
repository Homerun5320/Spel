// CamFix (D158): the maths of fitting the globe in the window. Properties over aspect ratios 0.4 to 3, tilts 0 to 80 degrees and distances up to the maximum; the closed-form
// extent of the disc is checked against a camera that projects the real outline of the sphere (tests/helpers/silhouette.ts).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CAMERA_FOV_DEG, DIST_ABS_MAX_KM, DIST_MAX_KM, EARTH_RADIUS_KM, FIT_ASPECT_MIN, FIT_FILL_SAFE, FIT_REFERENCE_ASPECT, FIT_TILT_FREE_KM } from '../../src/render/config';
import {
  TILT_CAP_FREE_DEG,
  clampAspect,
  discExtent,
  discFill,
  discFits,
  fitDistKm,
  geometricTiltLimit,
  maxDistKm,
  maxTiltForDist,
  shownTiltAt,
  tiltCapAt,
  tiltEaseEndKm,
} from '../../src/render/fit';
import { discBox, rawPoseRig } from '../helpers/silhouette';

const ASPECTS = [0.4, 9 / 16, 3 / 4, 1, 4 / 3, 16 / 9, 21 / 9, 3];
const aspectArb = fc.double({ min: 0.4, max: 3, noNaN: true });
/** An aspect that a window of 1000 pixels high has exactly (the rig's width is a whole number of pixels). */
const windowAspectArb = fc.integer({ min: 400, max: 3000 }).map((w) => w / 1000);
const DEG = Math.PI / 180;
const HALF_TAN = Math.tan((CAMERA_FOV_DEG * DEG) / 2);

const rigAtPose = rawPoseRig;

describe('the window and the disc: the numbers', () => {
  it('the aspect ratio is clamped: nothing that is not a positive finite number reaches the maths, and a very narrow window is the narrowest one it handles', () => {
    for (const bad of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(clampAspect(bad)).toBe(FIT_REFERENCE_ASPECT);
    expect(clampAspect(0.01)).toBe(FIT_ASPECT_MIN);
    expect(clampAspect(2)).toBe(2);
    expect(Number.isFinite(maxDistKm(Number.NaN))).toBe(true);
    expect(maxDistKm(0.001)).toBeLessThanOrEqual(DIST_ABS_MAX_KM);
  });

  it('discFill and fitDistKm are inverses, and the disc fills 55 to 80 % of the narrowest half-extent at the maximum distance of every window from 0.4 to 3', () => {
    for (const a of ASPECTS) {
      const d = maxDistKm(a);
      expect(discFill(d, a), `aspect ${a}`).toBeGreaterThanOrEqual(0.55);
      expect(discFill(d, a), `aspect ${a}`).toBeLessThanOrEqual(0.8);
      expect(fitDistKm(a, discFill(d, a))).toBeCloseTo(d, 6);
      expect(discFill(fitDistKm(a, 0.7), a)).toBeCloseTo(0.7, 9);
    }
    fc.assert(
      fc.property(aspectArb, (a) => {
        const f = discFill(maxDistKm(a), a);
        expect(f).toBeGreaterThanOrEqual(0.55);
        expect(f).toBeLessThanOrEqual(0.8);
      }),
    );
  });

  it('a window at least as wide as high has DIST_MAX_KM, a narrower one more, and the farthest distance is continuous and monotone in the aspect (a ceiling at DIST_ABS_MAX_KM)', () => {
    for (const a of [1, 4 / 3, 16 / 9, 21 / 9, 3, 4]) expect(maxDistKm(a)).toBe(DIST_MAX_KM);
    let prev = DIST_MAX_KM;
    let worstJump = 0;
    for (let i = 0; i <= 600; i++) {
      const a = 1 - (i / 600) * 0.75; // 1 down to 0.25
      const d = maxDistKm(a);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(d).toBeLessThanOrEqual(DIST_ABS_MAX_KM);
      worstJump = Math.max(worstJump, (d - prev) / prev);
      prev = d;
    }
    expect(worstJump).toBeLessThan(0.02); // 600 steps from 1 to 0.25: no jump anywhere
    expect(maxDistKm(0.4)).toBeLessThan(DIST_ABS_MAX_KM); // the ceiling does not bind in the range the acceptance names
  });

  it('the old 42 000 km was out of the 55 to 80 % band in a 16:9 window (50 %), a 9:16 window (88 %: it fitted, centred, with 12 % to spare and nothing for a tilt) and a 0.4 window (it did not fit at all)', () => {
    expect(discFill(42_000, 16 / 9)).toBeLessThan(0.55);
    expect(discFill(42_000, 9 / 16)).toBeGreaterThan(0.8);
    expect(discFill(42_000, 9 / 16)).toBeLessThan(1);
    expect(discFill(42_000, 0.4)).toBeGreaterThan(1);
    for (const a of [0.4, 9 / 16, 16 / 9]) expect(discFill(maxDistKm(a), a)).toBeLessThan(0.8);
  });
});

describe('the extent of the disc: the closed form against the real outline of the sphere', () => {
  it('discExtent agrees with the projected tangent circle of a camera, for random aspects, distances, tilts and headings (every side, to 3 decimals of the half-extent)', () => {
    fc.assert(
      fc.property(windowAspectArb, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 80, noNaN: true }), fc.double({ min: 0, max: 360, noNaN: true }), (a, share, t, hd) => {
        // from where the disc is a little bigger than the narrow half-extent (the sampled outline is exact only where the picture is not a sliver of a huge disc) to far out
        const d = fitDistKm(a, 1.2) + share * (90_000 - fitDistKm(a, 1.2));
        const rig = rigAtPose(a, d, t, hd);
        const box = discBox(rig, 2880);
        const e = discExtent(d, t, a);
        expect(box.inFront).toBe(true);
        // top / bottom: how far the outline reaches above and below the middle of the picture, as shares of the half-height; sides: of the half-width
        const hh = rig.viewport.height / 2;
        const hw = rig.viewport.width / 2;
        const near = (got: number, want: number): void => expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-3 * Math.max(1, Math.abs(want))); // the outline is 2 880 points: a relative 1e-3
        near((hh - box.minY) / hh, e.top);
        near((box.maxY - hh) / hh, e.bottom);
        near(Math.max(hw - box.minX, box.maxX - hw) / hw, e.side);
      }),
      { numRuns: 120 },
    );
  });

  it('a tilted disc sits below the middle of the picture (its centre at sin t / (d + cos t) over the half-height, d in Earth radii), further down the more the tilt, and the focus is always inside it', () => {
    const d = 20_000;
    let prev = -1;
    for (const t of [0, 10, 40, 72]) {
      const e = discExtent(d, t, 16 / 9);
      expect(e.top).toBeGreaterThanOrEqual(0); // the middle of the picture is the focus, a point of the sphere: it is inside the outline
      expect(e.centre).toBeCloseTo(Math.sin(t * DEG) / (d / EARTH_RADIUS_KM + Math.cos(t * DEG)) / HALF_TAN, 9);
      expect(e.centre).toBeGreaterThanOrEqual(prev);
      prev = e.centre;
    }
    expect(discExtent(d, 0, 16 / 9).centre).toBe(0);
    // the prompt's example: 42 000 km at 72 degrees puts the centre 7.85 degrees from the middle (not 8.6) and the far edge of the disc out of a 16:9 picture
    const far = discExtent(42_000, 72, 16 / 9);
    expect(Math.atan(far.centre * HALF_TAN) / DEG).toBeCloseTo(7.85, 1);
    expect(far.bottom).toBeGreaterThan(1);
  });

  it('a disc that reaches behind the camera has an infinite extent (never in the picture), and discFits says no', () => {
    const e = discExtent(300, 80, 16 / 9);
    expect(e.fill).toBe(Number.POSITIVE_INFINITY);
    expect(discFits(300, 80, 16 / 9)).toBe(false);
  });
});

describe('the eased tilt limit', () => {
  it('is the free value up to FIT_TILT_FREE_KM, 0 from where the disc fills FIT_FILL_SAFE at tilt 0, for every aspect from 0.25 to 4', () => {
    for (const a of [0.25, 0.4, 9 / 16, 1, 16 / 9, 21 / 9, 3, 4]) {
      const end = tiltEaseEndKm(a);
      expect(end).toBeGreaterThan(FIT_TILT_FREE_KM);
      expect(discFill(end, a)).toBeCloseTo(FIT_FILL_SAFE, 9);
      expect(maxTiltForDist(FIT_TILT_FREE_KM, a)).toBe(TILT_CAP_FREE_DEG);
      expect(maxTiltForDist(100, a)).toBe(TILT_CAP_FREE_DEG);
      expect(maxTiltForDist(end, a)).toBe(0);
      expect(maxTiltForDist(maxDistKm(a), a)).toBe(0);
      expect(maxTiltForDist((end + FIT_TILT_FREE_KM) / 2, a)).toBeGreaterThan(0);
      expect(maxTiltForDist((end + FIT_TILT_FREE_KM) / 2, a)).toBeLessThan(TILT_CAP_FREE_DEG);
    }
  });

  it('is monotone (never rises with the distance) and continuous (a Lipschitz bound in ln(distance): no step anywhere) for random aspects', () => {
    fc.assert(
      fc.property(aspectArb, fc.double({ min: 100, max: 100_000, noNaN: true }), fc.double({ min: 100, max: 100_000, noNaN: true }), (a, d1, d2) => {
        const lo = Math.min(d1, d2);
        const hi = Math.max(d1, d2);
        const c1 = maxTiltForDist(lo, a);
        const c2 = maxTiltForDist(hi, a);
        expect(c2).toBeLessThanOrEqual(c1 + 1e-12);
        const end = tiltEaseEndKm(a);
        const lipschitz = (1.5 * TILT_CAP_FREE_DEG) / Math.log(end / FIT_TILT_FREE_KM);
        expect(c1 - c2).toBeLessThanOrEqual(lipschitz * Math.log(hi / lo) + 1e-9);
      }),
      { numRuns: 300 },
    );
    // the same on a fine sweep: no step bigger than the slope allows
    for (const a of [9 / 16, 16 / 9]) {
      let prev = TILT_CAP_FREE_DEG;
      for (let i = 0; i <= 4000; i++) {
        const d = 7000 * Math.exp((Math.log(maxDistKm(a) / 7000) * i) / 4000);
        const c = maxTiltForDist(d, a);
        expect(c).toBeLessThanOrEqual(prev + 1e-12);
        expect(prev - c).toBeLessThan(0.08);
        prev = c;
      }
    }
  });

  it('the shown tilt is the smaller of the user tilt and the limit (the user tilt is never raised), and a tilt above the limit is the limit', () => {
    const end = tiltEaseEndKm(16 / 9);
    for (const d of [3000, 9000, 14_000, 19_000, 25_000, 32_000]) {
      for (const t of [0, 20, 40, 72, 80]) {
        const cap = tiltCapAt(d, end);
        expect(shownTiltAt(t, d, end)).toBe(Math.min(t, cap));
        expect(shownTiltAt(t, d, end)).toBeLessThanOrEqual(t);
      }
    }
  });

  it('the limit is far from the RTS camera: for every camera that has a positive RTS weight (under 4 000 km over the ground) at any tilt up to 80 degrees it is above the tilt limit of that weight', () => {
    // the RTS camera works under 5 000 km of height; the height of a camera at distance d and tilt t over the sea is |c| - 1 with |c|^2 = d^2 + 1 + 2 d cos t (Earth radii)
    for (const a of [9 / 16, 16 / 9]) {
      for (let t = 0; t <= 80; t += 2) {
        for (let dKm = 100; dKm < 40_000; dKm += 100) {
          const d = dKm / EARTH_RADIUS_KM;
          const height = (Math.sqrt(d * d + 1 + 2 * d * Math.cos(t * DEG)) - 1) * EARTH_RADIUS_KM;
          if (height < 5000) expect(maxTiltForDist(dKm, a), `aspect ${a} tilt ${t} distance ${dKm} (height ${Math.round(height)} km)`).toBeGreaterThanOrEqual(t);
        }
      }
    }
  });
});

describe('the whole disc is in the picture with room to spare wherever it can be', () => {
  it('from the distance where the disc fits at tilt 0 with the margin up to the maximum distance, whatever tilt (0 to 80) and heading the user came with: every side has at least 5 % free, the disc is centred, and it fills 55 to 80 % at the maximum', () => {
    fc.assert(
      fc.property(windowAspectArb, fc.double({ min: 0, max: 80, noNaN: true }), fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, userTilt, heading, share) => {
        const lo = fitDistKm(a, FIT_FILL_SAFE);
        const hi = maxDistKm(a);
        const d = lo + (hi - lo) * share;
        const shown = shownTiltAt(userTilt, d, tiltEaseEndKm(a));
        const rig = rigAtPose(a, d, shown, heading);
        const box = discBox(rig);
        expect(box.inFront).toBe(true);
        expect(box.margin, `aspect ${a} distance ${d} user tilt ${userTilt}`).toBeGreaterThanOrEqual(0.05);
        expect(discFits(d, shown, a, 0.05)).toBe(true);
        // centred: the middle of the outline's box is the middle of the picture (to a thousandth of the half-extent)
        expect(Math.abs(box.cx - rig.viewport.width / 2) / (rig.viewport.width / 2)).toBeLessThan(1e-3);
        expect(Math.abs(box.cy - rig.viewport.height / 2) / (rig.viewport.height / 2)).toBeLessThan(1e-3);
      }),
      { numRuns: 150 },
    );
    for (const a of ASPECTS) {
      const rig = rigAtPose(a, maxDistKm(a), 0, 0);
      const box = discBox(rig);
      expect(box.fillOfNarrow, `aspect ${a}`).toBeGreaterThanOrEqual(0.55);
      expect(box.fillOfNarrow, `aspect ${a}`).toBeLessThanOrEqual(0.8);
    }
  });

  it('the raw geometric limit (what a tilted disc could take without being cut) is 0 where the disc just fits and grows with the distance: the eased limit must not follow it (it would rise again with the distance and leave the globe off centre at the maximum)', () => {
    const a = 16 / 9;
    expect(geometricTiltLimit(fitDistKm(a, FIT_FILL_SAFE), a)).toBe(0);
    expect(geometricTiltLimit(maxDistKm(a), a)).toBeGreaterThan(20);
    let prev = 0;
    for (let d = fitDistKm(a, FIT_FILL_SAFE); d <= maxDistKm(a); d += 500) {
      const g = geometricTiltLimit(d, a);
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = g;
      // the eased limit is never above what the geometry allows from the point where the disc fits
      expect(maxTiltForDist(d, a)).toBeLessThanOrEqual(g + 1e-9);
    }
    // and the limit at the maximum distance puts the disc exactly at the safe fill
    const t = geometricTiltLimit(maxDistKm(a), a);
    expect(discExtent(maxDistKm(a), t, a).fill).toBeCloseTo(FIT_FILL_SAFE, 6);
  });

  it('the maximum distance has the same disc fill in a 16:9, a 21:9 and a 3:1 window (they are all limited by the vertical field) and the old constant would not have fitted 0.4 at all', () => {
    expect(discFill(maxDistKm(16 / 9), 16 / 9)).toBeCloseTo(discFill(maxDistKm(21 / 9), 21 / 9), 12);
    expect(discFill(maxDistKm(3), 3)).toBeCloseTo(discFill(DIST_MAX_KM, 16 / 9), 12);
    expect(discFill(42_000, 0.4)).toBeGreaterThan(1);
    expect(discFill(maxDistKm(0.4), 0.4)).toBeLessThan(0.8);
  });
});

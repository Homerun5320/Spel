// M08 item 2: the camera mix. Globe arcball above a height, local-tangent RTS camera below, a smooth transition between; the RTS camera keeps
// the ground point under the cursor, holds the height the user chose while the ground changes under it, brings the tilt into 20 to 80 degrees
// and never goes below the 300 m clearance.
import { beforeAll, describe, expect, it } from 'vitest';
import { CameraRig, setViewAtAgl } from '../../src/render/camera';
import {
  RTS_AGL_FULL_M,
  RTS_AGL_GLOBE_M,
  RTS_TILT_EASE_DEG_PER_S,
  RTS_TILT_MAX_DEG,
  RTS_TILT_MIN_DEG,
  TILT_MAX_DEG,
  WHEEL_ZOOM_RATE,
  ZOOM_MIN_AGL_M,
} from '../../src/render/config';
import { angleBetween, normalizeVec, rng } from '../helpers/rtsMath';
import { add, latLonToVec, scale, vecToLatLon } from '../../src/render/geo';
import { raySphere } from '../../src/render/heightField';
import { modelFromPose, poseFromModel, rtsMix, tiltBounds, viewFromPose } from '../../src/render/rts';
import { loadRtsWorld, makeRtsRig, type RtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});

describe('the mix weight and the tilt limits', () => {
  it('is 0 above the globe height, 1 below the RTS height, monotone and continuous in between (no step anywhere)', () => {
    expect(rtsMix(RTS_AGL_GLOBE_M)).toBe(0);
    expect(rtsMix(RTS_AGL_GLOBE_M * 3)).toBe(0);
    expect(rtsMix(Number.POSITIVE_INFINITY)).toBe(0);
    expect(rtsMix(RTS_AGL_FULL_M)).toBe(1);
    expect(rtsMix(300)).toBe(1);
    let prev = 0;
    let worstStep = 0;
    const n = 4000;
    for (let i = 0; i <= n; i++) {
      const agl = RTS_AGL_GLOBE_M * Math.exp((Math.log(RTS_AGL_FULL_M / RTS_AGL_GLOBE_M) * i) / n);
      const m = rtsMix(agl);
      expect(m).toBeGreaterThanOrEqual(prev - 1e-12);
      worstStep = Math.max(worstStep, Math.abs(m - prev));
      prev = m;
    }
    expect(worstStep).toBeLessThan(0.002); // 4000 log steps over a factor of 5: no jump
    expect(rtsMix(Math.sqrt(RTS_AGL_GLOBE_M * RTS_AGL_FULL_M))).toBeCloseTo(0.5, 6);
  });

  it('the tilt limits go from [0, 72] (globe) to [20, 80] (RTS) with the weight', () => {
    expect(tiltBounds(0)).toEqual({ min: 0, max: TILT_MAX_DEG });
    expect(tiltBounds(1)).toEqual({ min: RTS_TILT_MIN_DEG, max: RTS_TILT_MAX_DEG });
    const half = tiltBounds(0.5);
    expect(half.min).toBeCloseTo(RTS_TILT_MIN_DEG / 2, 9);
    expect(half.max).toBeCloseTo((TILT_MAX_DEG + RTS_TILT_MAX_DEG) / 2, 9);
  });

  it('the RTS regime needs a ground AND a picker: a rig with only a ground (or none) is the globe at every height', () => {
    const a = new CameraRig(960, 540);
    a.setGround((lat, lon) => w.ground(lat, lon));
    a.setView({ lat: 46.5, lon: 8, distKm: 20, tilt: 40 });
    expect(a.rtsWeight).toBe(0);
    const b = new CameraRig(960, 540);
    b.setView({ lat: 46.5, lon: 8, distKm: 20, tilt: 40 });
    expect(b.rtsWeight).toBe(0);
    expect(makeRtsRig(w, { lat: 46.5, lon: 8, distKm: 20, tilt: 40 }).rtsWeight).toBe(1);
  });
});

describe('pose maths: the orbit state, the pose and the camera model are one camera', () => {
  it('viewFromPose rebuilds exactly the view a pose came from (position and look direction), over 300 random states', () => {
    const r = rng(9);
    for (let i = 0; i < 300; i++) {
      const rig = new CameraRig(960, 540);
      rig.setViewUnclamped({ lat: 170 * r() - 85, lon: 360 * r() - 180, distKm: 0.5 + 8000 * r() ** 3, heading: 360 * r() - 180, tilt: 1 + 85 * r() });
      const p = rig.pose();
      const v = viewFromPose(p.position, p.forward);
      const q = new CameraRig(960, 540);
      q.setViewUnclamped(v);
      const p2 = q.pose();
      for (let k = 0; k < 3; k++) {
        expect(p2.position[k]).toBeCloseTo(p.position[k] as number, 11);
        expect(p2.forward[k]).toBeCloseTo(p.forward[k] as number, 9);
      }
    }
  });

  it('modelFromPose and poseFromModel are inverse: ground position, height, heading and tilt come back; the height is over the given ground', () => {
    const r = rng(10);
    for (let i = 0; i < 200; i++) {
      const rig = new CameraRig(960, 540);
      rig.setViewUnclamped({ lat: 150 * r() - 75, lon: 360 * r() - 180, distKm: 1 + 5000 * r(), heading: 360 * r() - 180, tilt: 5 + 80 * r() });
      const p = rig.pose();
      const m = modelFromPose(p.position, p.forward, w.ground);
      const back = poseFromModel(m, w.ground(m.lat, m.lon) + m.aglM / 6_371_000);
      for (let k = 0; k < 3; k++) {
        expect(back.position[k]).toBeCloseTo(p.position[k] as number, 11);
        expect(back.forward[k]).toBeCloseTo(p.forward[k] as number, 9);
      }
      expect(m.tilt).toBeGreaterThan(0);
      expect(m.tilt).toBeLessThan(180);
    }
  });
});

describe('the transition globe -> RTS does not pop', () => {
  // A plateau 100 km up (the x12 Himalaya) with nothing else on it: the only thing that changes with the height of the camera is the weight.
  const R_M = 6_371_000;
  const PLATEAU = 1 + 100_000 / R_M;
  function plateauRig(aglM: number): CameraRig {
    const rig = new CameraRig(960, 540);
    rig.setGround(() => PLATEAU);
    rig.setPicker((origin, dir) => {
      const t = raySphere(origin, dir, PLATEAU);
      return t === null ? null : add(origin, scale(dir, t));
    });
    setViewAtAgl(rig, () => PLATEAU, { lat: 28.2, lon: 86.8, heading: 0, tilt: 40 }, aglM);
    return rig;
  }

  it('the same left drag gives a result that changes smoothly with the height across the whole mix range (a plateau 100 km up, where a switch would show)', () => {
    const ratios: number[] = [];
    const n = 80;
    for (let i = 0; i <= n; i++) {
      const agl = 6_000_000 * Math.exp((Math.log(300_000 / 6_000_000) * i) / n);
      const rig = plateauRig(agl);
      const from = vecToLatLon(rig.pose().position);
      rig.dragStart(480, 270, 1);
      rig.dragMove(560, 300, 1.02); // 85 px
      rig.dragEnd(1.5);
      const to = vecToLatLon(rig.pose().position);
      const a = angleBetween(latLonToVec(from.lat, from.lon), latLonToVec(to.lat, to.lon));
      ratios.push(a / (agl / R_M)); // radians of travel per radian of camera height
    }
    let worst = 0;
    for (let i = 1; i < ratios.length; i++) worst = Math.max(worst, Math.abs((ratios[i] as number) / (ratios[i - 1] as number) - 1));
    expect(worst, 'largest relative change of the drag response between neighbouring heights').toBeLessThan(0.02);
    // what the weight is for: at 300 km a sea-level grab would move a 100 km plateau by (h + 100 km) / h (the globe regime's response), the RTS one does not
    const globe = plateauRig(300_000);
    globe.setPicker(null);
    const from = vecToLatLon(globe.pose().position);
    globe.dragStart(480, 270, 1);
    globe.dragMove(560, 300, 1.02);
    globe.dragEnd(1.5);
    const to = vecToLatLon(globe.pose().position);
    const globeRatio = angleBetween(latLonToVec(from.lat, from.lon), latLonToVec(to.lat, to.lon)) / (300_000 / R_M);
    expect(globeRatio / (ratios[ratios.length - 1] as number)).toBeGreaterThan(1.15);
  });

  it('the same turn (a right drag) and the same wheel notch also change smoothly with the height', () => {
    const turn: number[] = [];
    const share: number[] = [];
    const n = 60;
    for (let i = 0; i <= n; i++) {
      const agl = 6_000_000 * Math.exp((Math.log(300_000 / 6_000_000) * i) / n);
      const rig = plateauRig(agl);
      const before = rig.view;
      rig.rotateBy(0, 60); // 21 degrees of tilt
      turn.push(Math.abs(rig.view.distKm / before.distKm));
      const z = plateauRig(agl);
      z.zoomAt(480, 270, -300);
      for (let k = 1; k <= 120; k++) z.update(k / 60);
      share.push(z.aglM() / agl);
    }
    for (let i = 1; i < n; i++) {
      expect(Math.abs((turn[i] as number) / (turn[i - 1] as number) - 1), `turn ${i}`).toBeLessThan(0.08);
      expect(Math.abs((share[i] as number) - (share[i - 1] as number)), `notch ${i}`).toBeLessThan(0.01);
    }
    for (const sh of share) expect(sh).toBeCloseTo(Math.exp(-300 * WHEEL_ZOOM_RATE), 1); // the wheel is a share of the height at every height
  });
});

describe('the tilt limit near a very high ground', () => {
  it('over a plateau 160 km up (the x12 Everest region seen from above) the horizon dips 12 degrees: the camera cannot be tilted past 89 degrees minus the dip, and stays finite', () => {
    const R_M = 6_371_000;
    const high = 1 + 160_000 / R_M;
    const rig = new CameraRig(960, 540);
    rig.setGround(() => high);
    rig.setPicker((origin, dir) => {
      const t = raySphere(origin, dir, high);
      return t === null ? null : add(origin, scale(dir, t));
    });
    setViewAtAgl(rig, () => high, { lat: 28.2, lon: 86.8, heading: 0, tilt: 50 }, 20_000);
    rig.rotateBy(0, 100_000); // as far toward the horizon as the user may go
    const p = rig.pose().position;
    const dip = (Math.acos(1 / Math.hypot(p[0], p[1], p[2])) * 180) / Math.PI;
    expect(dip).toBeGreaterThan(11);
    expect(rig.localTilt()).toBeLessThanOrEqual(89 - dip + 1e-3);
    expect(rig.localTilt()).toBeGreaterThan(89 - dip - 1);
    expect(RTS_TILT_MAX_DEG - rig.localTilt()).toBeGreaterThan(2); // the cap, not the 80 degree limit, was what stopped it
    const v = rig.view;
    expect(Number.isFinite(v.lat + v.lon + v.distKm + v.heading + v.tilt)).toBe(true);
  });
});

describe('the RTS regime between the inputs', () => {
  it('zoom-in from straight down brings the tilt into 20 to 80 degrees at no more than RTS_TILT_EASE_DEG_PER_S, the globe above keeps 0', () => {
    const rig = makeRtsRig(w, { lat: 46.5, lon: 8, heading: 0, tilt: 0 }, 3_000_000);
    expect(rig.view.tilt).toBe(0);
    let t = 0;
    let prevTilt = 0;
    let worstRate = 0;
    for (let i = 0; i < 30; i++) {
      rig.zoomAt(480, 270, -400);
      for (let k = 0; k < 30; k++) {
        t += 1 / 60;
        rig.update(t);
        worstRate = Math.max(worstRate, Math.abs(rig.localTilt() - prevTilt) * 60);
        prevTilt = rig.localTilt();
      }
    }
    for (let k = 0; k < 120; k++) {
      t += 1 / 60;
      rig.update(t);
    }
    expect(rig.aglM()).toBeLessThan(RTS_AGL_FULL_M);
    expect(rig.localTilt()).toBeGreaterThanOrEqual(RTS_TILT_MIN_DEG - 0.02);
    expect(rig.localTilt()).toBeLessThan(RTS_TILT_MIN_DEG + 5); // the limit is a floor: the zoom itself leaves a few degrees above it
    expect(worstRate).toBeLessThan(RTS_TILT_EASE_DEG_PER_S * 1.6 + 1); // the zoom's own anchor adds a little; no jump of 20 degrees in a frame
  });

  it('a ground view above the RTS limit (tilt 87) only eases DOWN to 80 once the user takes the camera, and a camera nobody touched never moves by itself', () => {
    const rig = makeRtsRig(w, { lat: 46.5, lon: 8, heading: 0, tilt: 87 }, 2000);
    const before = rig.view;
    for (let i = 1; i <= 120; i++) rig.update(i / 60);
    expect(rig.view).toEqual(before); // no hold, no follower, no tilt easing: the test hooks and goldens depend on it
    expect(rig.holdAgl).toBeNull();
    const start = rig.localTilt();
    expect(start).toBeGreaterThan(RTS_TILT_MAX_DEG); // the ground view is flatter than the RTS limit
    rig.zoomAt(480, 270, 0.0001); // the user touches the wheel
    let prev = start;
    let worstRate = 0;
    for (let i = 121; i <= 400; i++) {
      rig.update(i / 60);
      worstRate = Math.max(worstRate, Math.abs(rig.localTilt() - prev) * 60);
      prev = rig.localTilt();
    }
    expect(rig.localTilt()).toBeLessThanOrEqual(RTS_TILT_MAX_DEG + 0.05);
    expect(rig.localTilt()).toBeGreaterThan(RTS_TILT_MAX_DEG - 1.5);
    expect(worstRate).toBeLessThan(RTS_TILT_EASE_DEG_PER_S + 8);
    expect(Math.abs(rig.aglM() - 2000)).toBeLessThan(60); // pitching in place does not lift the camera
  });

  it('setView, setViewUnclamped and setPose forget the kept height (the hooks and the flights put the camera somewhere)', () => {
    const rig = makeRtsRig(w, { lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 5000);
    rig.zoomAt(480, 270, -100);
    for (let i = 1; i <= 60; i++) rig.update(i / 60);
    expect(rig.holdAgl).not.toBeNull();
    rig.setView({ distKm: 30 });
    expect(rig.holdAgl).toBeNull();
    rig.setHoldAgl(1234);
    expect(rig.holdAgl).toBe(1234);
    rig.setViewUnclamped({ distKm: 40 });
    expect(rig.holdAgl).toBeNull();
    const p = rig.pose();
    rig.setHoldAgl(100);
    expect(rig.holdAgl).toBe(ZOOM_MIN_AGL_M); // never below the clearance
    rig.setPose(p.position, p.forward);
    expect(rig.holdAgl).toBeNull();
  });

  it('after a drag across the Alps the camera returns to the height the user had chosen (it follows the ground), and is never below the clearance on the way', () => {
    const rig = makeRtsRig(w, { lat: 46.5, lon: 8, heading: 90, tilt: 55 }, 3000);
    // the user has chosen 3 km by zooming
    rig.zoomAt(480, 270, 0.00001);
    for (let i = 1; i <= 60; i++) rig.update(i / 60);
    const chosen = rig.holdAgl as number;
    expect(chosen).toBeGreaterThan(2500);
    let t = 1;
    let worst = Infinity;
    rig.dragStart(480, 270, t);
    for (let i = 1; i <= 90; i++) {
      t += 1 / 60;
      rig.dragMove(480 + 6 * i, 270 + 2 * i, t);
      rig.update(t);
      worst = Math.min(worst, rig.aglM());
    }
    t += 0.2;
    rig.dragEnd(t);
    for (let i = 0; i < 240; i++) {
      t += 1 / 60;
      rig.update(t);
      worst = Math.min(worst, rig.aglM());
    }
    expect(worst).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.5);
    expect(Math.abs(rig.aglM() - chosen) / chosen).toBeLessThan(0.02);
  });

  it('240 random drags, turns and wheel steps over the Himalaya at heights from 300 m to 20 km: the camera is above the clearance in EVERY frame', () => {
    const r = rng(404);
    const rig = makeRtsRig(w, { lat: 28.2, lon: 86.8, heading: 0, tilt: 55 }, 5000);
    let t = 0;
    let worst = Infinity;
    let moved = 0;
    for (let step = 0; step < 240; step++) {
      const kind = Math.floor(r() * 3);
      const x = 100 + 760 * r();
      const y = 80 + 380 * r();
      if (kind === 0) {
        rig.dragStart(x, y, t);
        const dx = 200 * (r() - 0.5);
        const dy = 200 * (r() - 0.5);
        for (let i = 1; i <= 12; i++) {
          t += 1 / 60;
          rig.dragMove(x + (dx * i) / 12, y + (dy * i) / 12, t);
          rig.update(t);
          worst = Math.min(worst, rig.aglM());
        }
        rig.dragEnd(t + 0.2);
      } else if (kind === 1) {
        rig.rotateBy(300 * (r() - 0.5), 200 * (r() - 0.5));
        worst = Math.min(worst, rig.aglM());
      } else {
        rig.zoomAt(x, y, (r() - 0.6) * 900);
      }
      for (let i = 0; i < 20; i++) {
        t += 1 / 60;
        rig.update(t);
        worst = Math.min(worst, rig.aglM());
      }
      moved += Math.abs(rig.view.lat) > 0 ? 1 : 0;
    }
    expect(moved).toBeGreaterThan(0);
    expect(worst).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.5);
    const v = rig.view;
    expect(Number.isFinite(v.lat + v.lon + v.distKm + v.heading + v.tilt)).toBe(true);
  });

  it('the globe regime is as before: right drag at 9000 km turns the heading and stops at tilt 72', () => {
    const rig = makeRtsRig(w, { lat: 20, lon: 0, heading: 0, tilt: 0, distKm: 9000 });
    rig.rotateBy(0, 4000);
    expect(rig.view.tilt).toBe(TILT_MAX_DEG);
    rig.rotateBy(100, 0);
    expect(rig.view.heading).toBeCloseTo(35, 9);
    expect(rig.rtsWeight).toBe(0);
    expect(normalizeVec([0, 0, 2])[2]).toBe(1);
  });
});

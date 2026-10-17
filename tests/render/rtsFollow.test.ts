// M08 audit pass: the ground-follow of the RTS camera (D155 (3)) is pinned. The camera keeps the height over the ground the user chose; when the ground under
// it rises or falls it moves there with a time constant of RTS_FOLLOW_TAU_S (never a snap) and stops within RTS_FOLLOW_EPS_M; a wheel zoom and a drag set the
// height it holds. The ground is a flat shell whose height the test changes, so the numbers are exact.
import { describe, expect, it } from 'vitest';
import { CameraRig, setViewAtAgl } from '../../src/render/camera';
import { RTS_FOLLOW_EPS_M, RTS_FOLLOW_TAU_S, ZOOM_MIN_AGL_M } from '../../src/render/config';
import { add, scale } from '../../src/render/geo';
import { raySphere } from '../../src/render/heightField';

const R_M = 6_371_000;

interface Flat {
  rig: CameraRig;
  /** Sets the radius of the ground (Earth radii). */
  setRadius(r: number): void;
  /** Sets how many metres the ground rises from longitude 8.0 to 8.2 (the ramp the dragged camera climbs; 0 = none). */
  setRamp(metres: number): void;
  t: number;
  frame(n?: number): void;
}

/** A rig over a flat shell 20 km up, 2 km (default) over it, tilt 50, with the RTS regime on (a ground and a picker). */
function flatRig(aglM = 2000): Flat {
  const st = { r: 1 + 20_000 / R_M, rise: 0 };
  const rig = new CameraRig(960, 540);
  const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const ground = (_lat: number, lon: number): number => st.r + (st.rise * smooth((lon - 8) / 0.2)) / R_M;
  rig.setGround(ground);
  rig.setPicker((origin, dir) => {
    const t = raySphere(origin, dir, st.r);
    return t === null ? null : add(origin, scale(dir, t));
  });
  setViewAtAgl(rig, ground, { lat: 46.5, lon: 8, heading: 0, tilt: 50 }, aglM);
  const f: Flat = {
    rig,
    setRadius: (r) => {
      st.r = r;
    },
    setRamp: (metres) => {
      st.rise = metres;
    },
    t: 0,
    frame: (n = 1) => {
      for (let i = 0; i < n; i++) {
        f.t += 1 / 60;
        rig.update(f.t);
      }
    },
  };
  rig.update(0);
  return f;
}

describe('the camera follows the ground at the height it holds', () => {
  it('raising the ground under a held camera by 500 m: each frame closes at most 1 - exp(-dt / tau) of the gap (no snap), and the first frame does move', () => {
    const f = flatRig(2000);
    f.rig.setHoldAgl(2000);
    f.setRadius(1 + (20_000 + 500) / R_M);
    expect(f.rig.aglM()).toBeCloseTo(1500, 3);
    const k = 1 - Math.exp(-1 / 60 / RTS_FOLLOW_TAU_S);
    let prev = f.rig.aglM();
    for (let i = 0; i < 6; i++) {
      const gap = 2000 - prev;
      f.frame();
      const now = f.rig.aglM();
      const step = now - prev;
      expect(step, `frame ${i}`).toBeGreaterThan(0.5 * k * gap);
      expect(step, `frame ${i}`).toBeLessThanOrEqual(k * gap * 1.02 + 1e-6);
      prev = now;
    }
    // 0.25 s later it has covered 1 - exp(-1) of the way (within the small discretisation of the steps)
    const f2 = flatRig(2000);
    f2.rig.setHoldAgl(2000);
    f2.setRadius(1 + 20_500 / R_M);
    f2.frame(15);
    expect((f2.rig.aglM() - 1500) / 500).toBeGreaterThan(0.6);
    expect((f2.rig.aglM() - 1500) / 500).toBeLessThan(0.66);
  });

  it('falling ground works the same way (the camera comes down), and the settled height is within 0.1 m of the held one for a 300 m hold', () => {
    const f = flatRig(300);
    f.rig.setHoldAgl(300);
    f.setRadius(1 + (20_000 - 400) / R_M); // 400 m lower: 700 m up now
    expect(f.rig.aglM()).toBeCloseTo(700, 3);
    const k = 1 - Math.exp(-1 / 60 / RTS_FOLLOW_TAU_S);
    f.frame();
    expect(700 - f.rig.aglM()).toBeLessThanOrEqual(k * 400 * 1.02 + 1e-6);
    expect(700 - f.rig.aglM()).toBeGreaterThan(0.5 * k * 400);
    f.frame(60 * 6);
    expect(Math.abs(f.rig.aglM() - 300)).toBeLessThan(0.1);
    expect(Math.abs(f.rig.aglM() - 300)).toBeLessThanOrEqual(RTS_FOLLOW_EPS_M + 1e-6);
    // and then it rests: the position no longer changes
    const p = f.rig.pose().position;
    f.frame(30);
    expect(f.rig.pose().position).toEqual(p);
  });

  it('a camera nobody has touched (no held height) does not follow: the test hooks and the goldens rely on it', () => {
    const f = flatRig(2000);
    expect(f.rig.holdAgl).toBeNull();
    f.setRadius(1 + 20_500 / R_M);
    const before = f.rig.pose().position;
    f.frame(60);
    expect(f.rig.pose().position).toEqual(before);
  });
});

describe('a wheel zoom and a drag set the height the camera holds', () => {
  it('after a wheel zoom the held height is the height reached (the share of the old one the notch asked for), and the camera then follows the ground at it', () => {
    const f = flatRig(3000);
    expect(f.rig.holdAgl).toBeNull();
    f.rig.zoomAt(480, 270, -300);
    f.frame(60 * 3);
    const wanted = 3000 * Math.exp(-300 * 0.0016);
    expect(f.rig.holdAgl).not.toBeNull();
    expect(Math.abs((f.rig.holdAgl as number) - wanted)).toBeLessThan(1);
    expect(Math.abs(f.rig.aglM() - wanted)).toBeLessThan(1);
    // the user pans the camera east over a ground that rises by 400 m: it climbs with it and keeps the height the user chose
    f.setRamp(400);
    f.rig.dragStart(480, 270, f.t);
    for (let i = 1; i <= 40; i++) {
      f.t += 1 / 60;
      f.rig.dragMove(480 - 12 * i, 270, f.t);
      f.rig.update(f.t);
    }
    f.rig.dragEnd(f.t + 0.3);
    f.frame(60 * 5);
    expect(Math.abs(f.rig.aglM() - wanted)).toBeLessThan(0.5);
  });

  it('a zoom that has nothing to travel (at the floor) still takes the camera: the height it has is held', () => {
    const f = flatRig(ZOOM_MIN_AGL_M);
    expect(f.rig.holdAgl).toBeNull();
    f.rig.zoomAt(480, 270, -120);
    f.frame(30);
    expect(f.rig.holdAgl).not.toBeNull();
    expect(Math.abs((f.rig.holdAgl as number) - ZOOM_MIN_AGL_M)).toBeLessThan(0.5);
  });

  it('a drag holds the height the camera had when it was grabbed, and the camera follows the ground at it afterwards', () => {
    const f = flatRig(2500);
    expect(f.rig.holdAgl).toBeNull();
    f.rig.dragStart(480, 300, f.t);
    expect(f.rig.holdAgl).not.toBeNull();
    expect(Math.abs((f.rig.holdAgl as number) - 2500)).toBeLessThan(0.5);
    for (let i = 1; i <= 20; i++) {
      f.t += 1 / 60;
      f.rig.dragMove(480 + 4 * i, 300 - 2 * i, f.t);
      f.rig.update(f.t);
    }
    f.rig.dragEnd(f.t + 0.3);
    // a second drag, east, over a ramp of 700 m: the camera follows the ground at the height the first drag took
    f.setRamp(700);
    f.rig.dragStart(480, 270, f.t);
    for (let i = 1; i <= 40; i++) {
      f.t += 1 / 60;
      f.rig.dragMove(480 - 12 * i, 270, f.t);
      f.rig.update(f.t);
    }
    f.rig.dragEnd(f.t + 0.3);
    f.frame(60 * 5);
    expect(Math.abs(f.rig.aglM() - 2500)).toBeLessThan(0.5);
  });

  it('a drag that grabs a wheel zoom under way holds the height the zoom has reached by then', () => {
    const f = flatRig(3000);
    f.rig.zoomAt(480, 270, -400);
    f.frame(6);
    const mid = f.rig.aglM();
    expect(mid).toBeLessThan(3000);
    expect(mid).toBeGreaterThan(3000 * Math.exp(-400 * 0.0016));
    f.rig.dragStart(480, 270, f.t);
    expect(Math.abs((f.rig.holdAgl as number) - mid)).toBeLessThan(0.5);
    f.rig.dragEnd(f.t + 0.3);
    f.frame(120);
    expect(Math.abs(f.rig.aglM() - mid)).toBeLessThan(0.5); // the zoom is over; the camera stays where the user took it
  });
});

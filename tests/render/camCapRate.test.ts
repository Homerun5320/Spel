// Fix-UI: the rate of the shown-tilt cap in BOTH directions (the audit's mutants C08, C05, C24): zooming IN from far out lets the cap rise, and it must rise
// at exactly FIT_TILT_RATE_DEG_S (not jump, not crawl), as the down direction already does in camFix2.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { FIT_TILT_RATE_DEG_S } from '../../src/render/config';
import { loadRtsWorld, makeRtsRig, type RtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});

const DT = 1 / 60;

/** Runs `frames` frames and returns the shown tilt after each. */
function run(rig: ReturnType<typeof makeRtsRig>, frames: number, t0 = 0): { shown: number[]; t: number } {
  const shown: number[] = [];
  let t = t0;
  for (let i = 0; i < frames; i++) {
    t += DT;
    rig.update(t);
    shown.push(rig.shownTilt);
  }
  return { shown, t };
}

describe('the shown-tilt cap moves at the documented rate in both directions', () => {
  it('zooming in from far out: the shown tilt rises, never faster than the rate, and at the rate while it is catching up', () => {
    const rig = makeRtsRig(w, { lat: 46, lon: 10, distKm: 20_000, heading: 0, tilt: 70 });
    const before = rig.shownTilt;
    for (let i = 0; i < 4; i++) rig.zoomAt(480, 270, -300);
    const { shown } = run(rig, 240);
    let prev = before;
    let worst = 0;
    for (const s of shown) {
      worst = Math.max(worst, Math.abs(s - prev));
      prev = s;
    }
    const step = FIT_TILT_RATE_DEG_S * DT;
    expect(shown[shown.length - 1] as number).toBeGreaterThan(before + 60); // the tilt really came back
    expect(worst).toBeLessThanOrEqual(step + 1e-6); // no jump upward (C08)
    expect(worst).toBeGreaterThanOrEqual(step - 1e-6); // and it does move at the rate while catching up (C05, C24)
  });

  it('the rate itself: the shown tilt needs (70 - start) / (rate per frame) frames to come back, not much less and not much more', () => {
    const rig = makeRtsRig(w, { lat: 46, lon: 10, distKm: 20_000, heading: 0, tilt: 70 });
    const start = rig.shownTilt;
    for (let i = 0; i < 4; i++) rig.zoomAt(480, 270, -300);
    const { shown } = run(rig, 120);
    const frames = shown.findIndex((s) => s >= 70 - 1e-9) + 1;
    const expected = Math.ceil((70 - start) / (FIT_TILT_RATE_DEG_S * DT));
    expect(frames).toBeGreaterThan(0);
    expect(Math.abs(frames - expected)).toBeLessThanOrEqual(2);
    expect(expected).toBeGreaterThan(25);
  });
});

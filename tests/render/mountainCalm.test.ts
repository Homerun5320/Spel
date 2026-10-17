// CamFix item 6 (D158): how does the camera behave over textured mountains (follows the held height, keeps most of the roughness out; dips up to 79 % at the Himalaya wall, CamFix-2 wording)? The scripted measurement (tests/helpers/mountainRun.ts: the real height field, the rig as `Globe` builds it,
// the fx clock in steps of 1/60 s, inputs as the page gives them) drags the grip across the Alps and the Himalaya at the height the user holds and zooms in and out with the wheel.
// What is measured: how much of the terrain's roughness reaches the camera (the camera's radius high-passed at 1 s and at 1/6 s, against the same for the ground under it), how
// deep the camera sinks under the height it holds, that it never goes under the 300 m clearance, that a zoom never reverses, that the held height comes back. The numbers of the
// M08 head, of the v9 / M07b baseline (a git worktree of ec44223, the same script) and of the look-ahead that was tried and rejected are in docs/PROGRESS.md "Measurements CamFix".
// The thresholds below sit between M08's numbers and the numbers of a camera that copies the ground (the mutation "no smoothing") or has no clearance.
import { beforeAll, describe, expect, it } from 'vitest';
import { ZOOM_MIN_AGL_M } from '../../src/render/config';
import { dragMetrics, loadRtsWorld, rigOver, runDrag, runZoom, zoomMetrics, type MountainPlace, type RtsWorld } from '../helpers/mountainRun';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});

const PLACES: MountainPlace[] = ['Alps', 'Himalaya'];

describe('the held height is followed, not copied: the terrain\'s roughness does not reach the camera (mutation "no smoothing" is killed here)', () => {
  for (const place of PLACES) {
    for (const [agl, strokeFrames] of [
      [3000, 48],
      [3000, 96],
      [20_000, 48],
      [20_000, 96],
    ] as const) {
      it(`${place}, held at ${agl / 1000} km, ${strokeFrames === 48 ? 'a fast pan (625 px/s)' : 'a steady pan (312 px/s)'}: at most 70 % of the ground's roughness slower than a second reaches the camera and at most 45 % of the shake faster than a sixth of a second`, () => {
        const rig = rigOver(w, place, agl, 55);
        const m = dragMetrics(runDrag(rig, strokeFrames), rig.aglM());
        // M08: 0.46 to 0.64 of the slow part and 0.26 to 0.34 of the shake; a camera that copies the ground (no smoothing at all) has 1.0 of both
        expect(m.hfShare, `slow part ${JSON.stringify(m)}`).toBeLessThan(0.7);
        expect(m.shakeCamM / m.shakeGroundM, `shake ${JSON.stringify(m)}`).toBeLessThan(0.45);
        expect(m.endAglM, 'the height it holds comes back').toBeGreaterThan(0.995 * agl);
        expect(m.endAglM).toBeLessThan(1.005 * agl);
      });
    }
  }
});

describe('the dip below the held height when the ground rises under a pan is bounded (it is NOT zero: up to 79 % at the Himalaya wall, CamFix-2)', () => {
  it('the lowest height of a fast pan of six strokes, as a share of the held height, is at most M08\'s measured dip plus a margin: Alps 3 km (8 %) under 15 %, Alps 20 km (26 %) under 35 %, Himalaya 3 km (79 %: the follow lag at the wall, BACKLOG) under 85 %, Himalaya 20 km (29 %) under 40 %', () => {
    const cases: Array<[MountainPlace, number, number]> = [
      ['Alps', 3000, 0.15],
      ['Alps', 20_000, 0.35],
      ['Himalaya', 3000, 0.85],
      ['Himalaya', 20_000, 0.4],
    ];
    for (const [place, agl, maxDip] of cases) {
      const rig = rigOver(w, place, agl, 55);
      const m = dragMetrics(runDrag(rig, 48), rig.aglM());
      expect(m.dipShare, `${place} ${agl} ${JSON.stringify(m)}`).toBeLessThan(maxDip);
    }
  });

  it('the camera of the globe regime (no picker, v9 and M07b: the focus keeps its distance to the sea-level point while the ground goes by) is not calm in the same script: it ends 10 to 20 times higher or lower than it started, and goes under the ground (the control: the measurement can see trouble)', () => {
    let underground = 0;
    for (const place of PLACES) {
      const rig = rigOver(w, place, 3000, 55);
      rig.setPicker(null);
      const m = dragMetrics(runDrag(rig, 48), 3000);
      if (m.minAglM < 0) underground++;
      expect(m.endAglM > 6000 || m.endAglM < 500, `${place} ${m.endAglM}`).toBe(true);
    }
    expect(underground).toBeGreaterThanOrEqual(1);
  });
});

describe('the clearance of 300 m is never undercut (mutation "clearance removed" is killed here)', () => {
  for (const place of PLACES) {
    for (const strokeFrames of [48, 96]) {
      it(`${place}, held at 300 m: the lowest height of a pan of six strokes is ${ZOOM_MIN_AGL_M} m (${strokeFrames === 48 ? 'fast' : 'steady'}) and the camera holds 300 m at the end`, () => {
        const rig = rigOver(w, place, 300, 60);
        const hold = rig.aglM();
        expect(hold).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.01);
        const log = runDrag(rig, strokeFrames);
        const m = dragMetrics(log, hold);
        expect(m.minAglM, JSON.stringify(m)).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.01);
        expect(m.endAglM).toBeLessThan(ZOOM_MIN_AGL_M + 1);
      });
    }
  }

  it('a camera held at 1 km and panned over the Himalaya wall never goes under 300 m either, whatever the follower does', () => {
    const rig = rigOver(w, 'Himalaya', 1000, 55);
    const m = dragMetrics(runDrag(rig, 48), 1000);
    expect(m.minAglM).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.01);
  });
});

describe('the wheel zoom does not hunt: the camera never goes up where it went down, and the height comes back to where it started', () => {
  for (const place of PLACES) {
    for (const agl of [1000, 3000, 20_000]) {
      it(`${place}, ${agl / 1000} km: eight notches (in, in, out, out, in a lot, out a lot, out, in) with 1.5 s between them: no direction reversal of the camera's radius beyond the ones the notches ask for, no frame changes the height by more than 12 %, and it ends within 0.5 % of where it started`, () => {
        const notches = [-100, -100, 100, 100, -200, 200, 120, -120];
        const rig = rigOver(w, place, agl, 55);
        const start = rig.aglM();
        const m = zoomMetrics(runZoom(rig, notches), notches);
        expect(m.extraReversals, JSON.stringify(m)).toBe(0);
        expect(m.maxStepLnAgl, JSON.stringify(m)).toBeLessThan(0.12);
        expect(Math.abs(m.endAglM / start - 1), JSON.stringify(m)).toBeLessThan(0.005);
        expect(m.minAglM).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M);
      });
    }
  }
});

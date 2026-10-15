// CPU budget of the RTS camera (M08, perf project). Statistic for all: the MEDIAN of 15 measurements after 3 warm-ups (each measurement is the
// mean of many calls). The rule for M08 is "no extra per-frame cost from the camera and input code": the first test is the frame a player who
// has taken the camera and left it alone pays (`CameraRig.update` with a kept height, at the floor over the Himalaya), the second the frame of a
// camera nobody touched, the third a left-drag event (the grip: a ground pick and the turns that hold the point under the cursor), the fourth a
// right-drag event (a pivot pick and a turn). Measured here: 3 us, 0.2 us, 40 us and 230 us.
import { describe, expect, it } from 'vitest';
import { loadRtsWorld, makeRtsRig } from './helpers/rtsRig';
import { budgetMs, median, percentile } from './perfguard';

const WARMUPS = 3;
const MEASUREMENTS = 15;

async function rtsRigAtFloor() {
  const w = await loadRtsWorld();
  const rig = makeRtsRig(w, { lat: 28.2, lon: 86.8, heading: 20, tilt: 50, distKm: 3000 });
  let t = 0;
  for (let i = 0; i < 40; i++) {
    rig.zoomAt(480, 270, -700);
    for (let k = 0; k < 15; k++) rig.update((t += 1 / 30));
  }
  for (let k = 0; k < 300; k++) rig.update((t += 1 / 30));
  return rig;
}

/** Runs `run` WARMUPS + MEASUREMENTS times; returns the milliseconds per call (`per` calls in each run) of the measured ones. */
function measure(per: number, run: () => void): number[] {
  const samples: number[] = [];
  for (let m = 0; m < WARMUPS + MEASUREMENTS; m++) {
    const t0 = performance.now();
    run();
    if (m >= WARMUPS) samples.push((performance.now() - t0) / per);
  }
  return samples;
}

describe('RTS camera: CPU cost', () => {
  it('CameraRig.update at rest with a kept height at the floor over the Himalaya: median of 15 (mean ms per call) is at most budgetMs(0.02)', async () => {
    const rig = await rtsRigAtFloor();
    expect(rig.holdAgl).not.toBeNull();
    let t = 1000;
    const samples = measure(2000, () => {
      for (let i = 0; i < 2000; i++) rig.update((t += 1 / 60));
    });
    const med = median(samples);
    console.log(`[rts perf] update at rest with a kept height: median ${(med * 1000).toFixed(1)} us (p95 ${(percentile(samples, 95) * 1000).toFixed(1)} us)`);
    expect(med).toBeLessThanOrEqual(budgetMs(0.02));
  });

  it('a camera nobody touched (no kept height: every hook-made view and every classic flight) pays nothing for the RTS regime: update is at most budgetMs(0.02) too', async () => {
    const w = await loadRtsWorld();
    const rig = makeRtsRig(w, { lat: 28.2, lon: 86.8, heading: 20, tilt: 50, distKm: 4000 });
    expect(rig.holdAgl).toBeNull();
    let t = 1000;
    const samples = measure(2000, () => {
      for (let i = 0; i < 2000; i++) rig.update((t += 1 / 60));
    });
    const med = median(samples);
    console.log(`[rts perf] update of an untouched camera: median ${(med * 1000).toFixed(1)} us`);
    expect(med).toBeLessThanOrEqual(budgetMs(0.02));
  });

  it('one left-drag event over the Alps at 20 km plus its frame (the grip: a ground pick and the turns that hold the point under the cursor): median of 15 (mean ms per event) is at most budgetMs(0.4)', async () => {
    const w = await loadRtsWorld();
    const rig = makeRtsRig(w, { lat: 46.5, lon: 8, heading: 20, tilt: 55 }, 20_000);
    let t = 1;
    rig.dragStart(480, 300, t);
    const samples = measure(200, () => {
      for (let i = 0; i < 200; i++) {
        t += 1 / 60;
        rig.dragMove(480 + 60 * Math.sin(i / 20), 300 + 40 * Math.cos(i / 20), t);
        rig.update(t);
      }
    });
    rig.dragEnd(t + 1);
    const med = median(samples);
    console.log(`[rts perf] a drag event plus its frame: median ${(med * 1000).toFixed(0)} us (p95 ${(percentile(samples, 95) * 1000).toFixed(0)} us)`);
    expect(med).toBeLessThanOrEqual(budgetMs(0.4));
  });

  it('one right-drag event (the pivot pick on the centre ray and the turn): median of 15 (mean ms per event) is at most budgetMs(1)', async () => {
    const w = await loadRtsWorld();
    const rig = makeRtsRig(w, { lat: 28.2, lon: 86.8, heading: 20, tilt: 50 }, 40_000);
    const samples = measure(200, () => {
      for (let i = 0; i < 200; i++) rig.rotateBy(i % 2 === 0 ? 3 : -3, i % 4 < 2 ? 1 : -1);
    });
    const med = median(samples);
    console.log(`[rts perf] a right-drag event: median ${(med * 1000).toFixed(0)} us (p95 ${(percentile(samples, 95) * 1000).toFixed(0)} us)`);
    expect(med).toBeLessThanOrEqual(budgetMs(1));
  });

  it('one wheel notch over the Himalaya at 3 km (the dolly: the distance along the cursor ray is solved ONCE) plus the 30 frames of its ease: median of 15 (mean ms per notch with its frames) is at most budgetMs(2)', async () => {
    const w = await loadRtsWorld();
    const rig = makeRtsRig(w, { lat: 28.2, lon: 86.8, heading: 20, tilt: 50 }, 3000);
    let t = 1;
    const samples = measure(40, () => {
      for (let i = 0; i < 40; i++) {
        rig.zoomAt(300 + 360 * ((i * 37) % 10) / 10, 200 + 200 * ((i * 17) % 10) / 10, i % 2 === 0 ? -240 : 240);
        for (let k = 0; k < 30; k++) rig.update((t += 1 / 60));
      }
    });
    const med = median(samples);
    console.log(`[rts perf] a wheel notch with its 30 frames: median ${(med * 1000).toFixed(0)} us (p95 ${(percentile(samples, 95) * 1000).toFixed(0)} us)`);
    expect(med).toBeLessThanOrEqual(budgetMs(2));
  });
});

// CPU budget of the terrain-aware orbit camera (perf project). Statistic for both: the MEDIAN of 15 measurements after 3 warm-ups.
// 1. The per-frame cost with a ground: `CameraRig.update` at rest at the zoom floor over the Himalaya (the one height test of
//    `keepAboveGround` per frame), at most budgetMs(0.02) per call (the mean of 2000 calls is one measurement).
// 2. One wheel notch: the search for the distance of the wanted height (`distForAgl`, about 130 evaluations of the height field), at most
//    budgetMs(0.6) per notch (the mean of 100 notches is one measurement); it runs once per notch and once per frame while a zoom is under way.
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/render/camera';
import { loadChunkWorld } from './helpers/chunkWorld';
import { budgetMs, median, percentile } from './perfguard';

const WARMUPS = 3;
const MEASUREMENTS = 15;

async function rigAtFloor(): Promise<CameraRig> {
  const world = await loadChunkWorld();
  const rig = new CameraRig(960, 540);
  rig.setGround((a, b) => world.field.surfaceRadius(a, b));
  rig.setView({ lat: 28.2, lon: 86.8, distKm: 3000, tilt: 50, heading: 20 });
  rig.update(0);
  let t = 0;
  for (let i = 0; i < 40; i++) {
    rig.zoomAt(480, 270, -700);
    for (let k = 0; k < 15; k++) rig.update((t += 1 / 30));
  }
  for (let k = 0; k < 300; k++) rig.update((t += 1 / 30));
  return rig;
}

describe('terrain-aware orbit camera: CPU cost', () => {
  it('CameraRig.update at rest on the floor over the Himalaya: median of 15 measurements (mean ms per call) is at most budgetMs(0.02)', async () => {
    const rig = await rigAtFloor();
    let t = 1000;
    const samples: number[] = [];
    for (let m = 0; m < WARMUPS + MEASUREMENTS; m++) {
      const t0 = performance.now();
      for (let i = 0; i < 2000; i++) rig.update((t += 1 / 60));
      const per = (performance.now() - t0) / 2000;
      if (m >= WARMUPS) samples.push(per);
    }
    const med = median(samples);
    console.log(`[camera perf] update at the floor: median ${(med * 1000).toFixed(1)} us (p95 ${(percentile(samples, 95) * 1000).toFixed(1)} us)`);
    expect(med).toBeLessThanOrEqual(budgetMs(0.02));
  });

  it('one wheel notch (the search for the distance of the wanted height): median of 15 measurements (mean ms per notch) is at most budgetMs(0.6)', async () => {
    const rig = await rigAtFloor();
    let t = 2000;
    const samples: number[] = [];
    for (let m = 0; m < WARMUPS + MEASUREMENTS; m++) {
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        rig.zoomAt(480, 270, i % 2 === 0 ? 40 : -40);
        rig.update((t += 1 / 60));
      }
      const per = (performance.now() - t0) / 100;
      if (m >= WARMUPS) samples.push(per);
    }
    const med = median(samples);
    console.log(`[camera perf] wheel notch + one frame of the zoom: median ${(med * 1000).toFixed(0)} us (p95 ${(percentile(samples, 95) * 1000).toFixed(0)} us)`);
    expect(med).toBeLessThanOrEqual(budgetMs(0.6));
  });
});

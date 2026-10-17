// CPU budgets of the terrain detail (M07b, perf project). M08 calls `heightAt` as `groundHeightAt` (helicopters, props, the camera floor: a few
// hundred calls per frame), picking marches `HeightField.pick` over the detailed surface on every mouse move, and the quadtree asks
// `DetailBounds` once per new node. Statistic for every test: the MEDIAN of 15 measurements after 3 warm-ups (each measurement is the mean of a
// batch); every limit goes through budgetMs.
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/render/camera';
import { HeightSampler } from '../src/render/detail';
import { DetailBounds } from '../src/render/detailBounds';
import { HEIGHT_EXAGGERATION } from '../src/render/config';
import { QUALITY } from '../src/render/quality';
import { loadChunkWorld, poseOf, rng } from './helpers/chunkWorld';
import { budgetMs, median, percentile } from './perfguard';

const WARMUPS = 3;
const MEASUREMENTS = 15;

/** Runs `batch` (returning the mean ms per item) WARMUPS + MEASUREMENTS times and returns the measured ones. */
function measure(batch: () => number): number[] {
  const out: number[] = [];
  for (let m = 0; m < WARMUPS + MEASUREMENTS; m++) {
    const v = batch();
    if (m >= WARMUPS) out.push(v);
  }
  return out;
}

describe('terrain detail: CPU cost', () => {
  it('heightAt with all 12 octaves over the Himalaya: median of 15 measurements (mean ms per call of a batch of 500) is at most budgetMs(0.014)', async () => {
    const world = await loadChunkWorld();
    const s = new HeightSampler({ codes: world.codes, width: world.width, height: world.height, maxM: world.maxM });
    const r = rng(41);
    const pts = Array.from({ length: 500 }, () => [27 + 3 * r(), 84 + 6 * r()] as const);
    let sink = 0;
    const samples = measure(() => {
      const t0 = performance.now();
      for (const [la, lo] of pts) sink += s.heightAt(la, lo);
      return (performance.now() - t0) / pts.length;
    });
    const med = median(samples);
    console.log(`[heightAt perf] 12 octaves: median ${(med * 1000).toFixed(2)} us per call (p95 ${(percentile(samples, 95) * 1000).toFixed(2)} us)${sink < 0 ? '!' : ''}`);
    expect(med).toBeLessThanOrEqual(budgetMs(0.014));
  });

  it('heightAt with 4 octaves (a prop far from the camera) and the sea (no octaves): medians at most budgetMs(0.006) and budgetMs(0.0015)', async () => {
    const world = await loadChunkWorld();
    const s = new HeightSampler({ codes: world.codes, width: world.width, height: world.height, maxM: world.maxM });
    const r = rng(42);
    const pts = Array.from({ length: 500 }, () => [27 + 3 * r(), 84 + 6 * r()] as const);
    const sea = Array.from({ length: 500 }, () => [-40 + 3 * r(), -130 + 6 * r()] as const);
    let sink = 0;
    const four = median(measure(() => {
      const t0 = performance.now();
      for (const [la, lo] of pts) sink += s.heightAt(la, lo, 4);
      return (performance.now() - t0) / pts.length;
    }));
    const open = median(measure(() => {
      const t0 = performance.now();
      for (const [la, lo] of sea) sink += s.heightAt(la, lo);
      return (performance.now() - t0) / sea.length;
    }));
    console.log(`[heightAt perf] 4 octaves: median ${(four * 1000).toFixed(2)} us; open sea: ${(open * 1000).toFixed(2)} us${sink < 0 ? '!' : ''}`);
    expect(four).toBeLessThanOrEqual(budgetMs(0.006));
    expect(open).toBeLessThanOrEqual(budgetMs(0.0015));
  });

  it('HeightField.pick on the detailed surface (a steep ray from 1 km, 10 km and 50 km over the Himalaya): median of 15 measurements (mean ms per ray of 40) is at most budgetMs(1.2)', async () => {
    const world = await loadChunkWorld();
    const rig = new CameraRig(960, 540);
    const r = rng(43);
    const rays = Array.from({ length: 40 }, (_, i) => {
      const pose = poseOf(world, { lat: 28.2, lon: 86.8, heading: 360 * r(), tilt: 50 + 35 * r() }, [1000, 10000, 50000][i % 3] as number);
      return rig.rayAt(100 + 760 * r(), 80 + 380 * r(), pose);
    });
    let hits = 0;
    const samples = measure(() => {
      const t0 = performance.now();
      for (const ray of rays) if (world.detailField.pick(ray.origin, ray.dir)) hits++;
      return (performance.now() - t0) / rays.length;
    });
    const med = median(samples);
    console.log(`[pick perf] detailed pick: median ${med.toFixed(3)} ms per ray (p95 ${percentile(samples, 95).toFixed(3)} ms), ${hits} hits`);
    expect(hits).toBeGreaterThan(0);
    expect(med).toBeLessThanOrEqual(budgetMs(1.2));
  });

  it('DetailBounds: the first ask of a node at level 17 (five coarse octave sums, pyramid ranges) costs a median of at most budgetMs(0.05) ms; a table hit at most budgetMs(0.002)', async () => {
    const world = await loadChunkWorld();
    const r = rng(44);
    const nodes = Array.from({ length: 300 }, () => {
      const lat = 27 + 3 * r();
      const lon = 84 + 6 * r();
      return [Math.floor(((lon + 180) / 360) * 4 * 2 ** 17), Math.floor(((90 - lat) / 180) * 2 * 2 ** 17)] as const;
    });
    const out = { lo: 0, hi: 0 };
    const first = median(measure(() => {
      const db = new DetailBounds(new HeightSampler({ codes: world.codes, width: world.width, height: world.height, maxM: world.maxM }), world.pyramid, QUALITY.medium.chunkCells);
      const t0 = performance.now();
      for (const [ix, iy] of nodes) db.range(17, ix, iy, out);
      return (performance.now() - t0) / nodes.length;
    }));
    const db = new DetailBounds(new HeightSampler({ codes: world.codes, width: world.width, height: world.height, maxM: world.maxM }), world.pyramid, QUALITY.medium.chunkCells);
    for (const [ix, iy] of nodes) db.range(17, ix, iy, out);
    const hit = median(measure(() => {
      const t0 = performance.now();
      for (const [ix, iy] of nodes) db.range(17, ix, iy, out);
      return (performance.now() - t0) / nodes.length;
    }));
    console.log(`[detail bounds perf] first ask ${(first * 1000).toFixed(1)} us per node, table hit ${(hit * 1000).toFixed(2)} us (exaggeration ${HEIGHT_EXAGGERATION})`);
    expect(first).toBeLessThanOrEqual(budgetMs(0.05));
    expect(hit).toBeLessThanOrEqual(budgetMs(0.002));
  });
});

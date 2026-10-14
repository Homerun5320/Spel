// CPU budget of the terrain chunk update (perf project). Statistic: the MEDIAN of 15 measurements after 3 warm-ups at most budgetMs(1)
// (tests/perfguard.ts). One measurement is the mean cost of one `update` over a sweep of 48 slightly different cameras through the six
// altitudes of the crack test (orbit, 3000 km, 500 km, 60 km, 8 km, 300 m AGL; the camera moves a little every update, so no call is
// the cheap "camera unchanged" return and the hysteresis state is live). Two things are timed on the medium tier (the default): the
// bare quadtree selection (`ChunkQuadtree.update`) and the whole per-frame CPU path of the chunk terrain (`ChunkTerrain.update`: the
// selection plus the refill of the five instance buffers; the GL upload is not CPU work of ours).
import { describe, expect, it } from 'vitest';
import type { RenderPack, SimGrid, WorldMeta } from '../src/data';
import { ChunkTerrain } from '../src/render/chunkTerrain';
import { CameraRig, setViewAtAgl, type CameraPose } from '../src/render/camera';
import { QUALITY } from '../src/render/quality';
import { createTerrainMaterial } from '../src/render/terrainMaterial';
import { createWorldTextures } from '../src/render/textures';
import { ALTITUDE_VIEWS, loadChunkWorld, makeTree, quadCameraOf } from './helpers/chunkWorld';
import { worldLoader } from './helpers/dataFiles';
import { budgetMs, median, percentile } from './perfguard';

const WARMUPS = 3;
const MEASUREMENTS = 15;
const SWEEP = 48; // cameras per measurement: 8 per altitude

async function sweepPoses(): Promise<CameraPose[]> {
  const world = await loadChunkWorld();
  const poses: CameraPose[] = [];
  for (const v of ALTITUDE_VIEWS) {
    for (let k = 0; k < SWEEP / ALTITUDE_VIEWS.length; k++) {
      const rig = new CameraRig(960, 540);
      // each camera a little further along: heading and altitude drift so every update sees a different pose
      setViewAtAgl(rig, (lat, lon) => world.field.surfaceRadius(lat, lon), { ...v.view, heading: (v.view.heading ?? 0) + k * 1.3 }, v.altAglM * (1 + 0.01 * k));
      poses.push(rig.pose());
    }
  }
  return poses;
}

describe('terrain chunk update: CPU cost per frame (medium tier)', () => {
  it('ChunkQuadtree.update: median of 15 sweeps (mean ms per update) after 3 warm-ups is at most budgetMs(1)', async () => {
    const world = await loadChunkWorld();
    const poses = await sweepPoses();
    const tree = makeTree(world, 'medium');
    const cams = poses.map((p) => quadCameraOf(p));
    const samples: number[] = [];
    let sink = 0;
    for (let m = 0; m < WARMUPS + MEASUREMENTS; m++) {
      const t0 = performance.now();
      for (const c of cams) {
        tree.update(c);
        sink += tree.count;
      }
      const per = (performance.now() - t0) / cams.length;
      if (m >= WARMUPS) samples.push(per);
    }
    const med = median(samples);
    console.log(`[chunk perf] quadtree update: median ${(med * 1000).toFixed(0)} us over ${MEASUREMENTS} sweeps (p95 ${(percentile(samples, 95) * 1000).toFixed(0)} us, last count ${tree.count}, sink ${sink > 0})`);
    expect(med).toBeLessThanOrEqual(budgetMs(1));
  });

  it('ChunkTerrain.update (selection + instance refill): median of 15 sweeps (mean ms per update) after 3 warm-ups is at most budgetMs(1)', async () => {
    const w = worldLoader();
    const [render, sim, meta]: [RenderPack, SimGrid, WorldMeta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
    const tm = createTerrainMaterial(createWorldTextures(render, sim), render, sim, meta, undefined, undefined, 'chunks', QUALITY.medium.chunkCells);
    const terrain = new ChunkTerrain({ material: tm.material, quality: QUALITY.medium, codes: render.height8, width: render.width, height: render.height, maxM: meta.encoding.heightSqrt.maxM, exaggeration: 12 });
    const poses = await sweepPoses();
    const samples: number[] = [];
    for (let m = 0; m < WARMUPS + MEASUREMENTS; m++) {
      const t0 = performance.now();
      for (const p of poses) {
        // a different camera each call: nudge the position by a metre so the unchanged-camera shortcut cannot hit
        terrain.update({ ...p, position: [p.position[0] + 1e-7 * m, p.position[1], p.position[2]] });
      }
      const per = (performance.now() - t0) / poses.length;
      if (m >= WARMUPS) samples.push(per);
    }
    const med = median(samples);
    console.log(`[chunk perf] chunk terrain update (selection + refill): median ${(med * 1000).toFixed(0)} us over ${MEASUREMENTS} sweeps (p95 ${(percentile(samples, 95) * 1000).toFixed(0)} us)`);
    expect(med).toBeLessThanOrEqual(budgetMs(1));
    expect(terrain.getStats().chunkCount).toBeGreaterThan(0);
    terrain.dispose();
  });

  it('the unchanged-camera frame costs next to nothing: median of 15 measurements of 200 repeated updates is at most budgetMs(0.01) per update', async () => {
    const w = worldLoader();
    const [render, sim, meta]: [RenderPack, SimGrid, WorldMeta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
    const tm = createTerrainMaterial(createWorldTextures(render, sim), render, sim, meta, undefined, undefined, 'chunks', QUALITY.medium.chunkCells);
    const terrain = new ChunkTerrain({ material: tm.material, quality: QUALITY.medium, codes: render.height8, width: render.width, height: render.height, maxM: meta.encoding.heightSqrt.maxM, exaggeration: 12 });
    const pose = (await sweepPoses())[20] as CameraPose;
    terrain.update(pose);
    const samples: number[] = [];
    for (let m = 0; m < WARMUPS + MEASUREMENTS; m++) {
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) terrain.update(pose);
      if (m >= WARMUPS) samples.push((performance.now() - t0) / 200);
    }
    const med = median(samples);
    console.log(`[chunk perf] unchanged camera: median ${(med * 1000).toFixed(2)} us per update`);
    expect(med).toBeLessThanOrEqual(budgetMs(0.01));
    terrain.dispose();
  });
});

// The level of detail of the terrain detail (M07b): a vertex shared by two chunks of different levels gets the same height from both (no pop at
// an LOD switch) because the octaves follow the vertex's distance from the camera, a continuous function, and the level's octave count is
// only the cap against aliasing. Tested on the real quadtree at the three heights over the Alps, the Himalaya and western Norway.
import { beforeAll, describe, expect, it } from 'vitest';
import { chunkGeo, chunkSizeRad, makeChunkGeo } from '../../src/render/chunkMath';
import { CHUNK_SKIRT_CELLS, EARTH_RADIUS_KM, HEIGHT_EXAGGERATION } from '../../src/render/config';
import { HeightSampler, detailLod, octavesAtDistance, octavesForLevel } from '../../src/render/detail';
import { DEG, latLonToVec } from '../../src/render/geo';
import { QUALITY, type QualityTier } from '../../src/render/quality';
import { loadChunkWorld, makeTree, poseOf, quadCameraOf, type ChunkWorld } from '../helpers/chunkWorld';

const R_M = EARTH_RADIUS_KM * 1000;
let world: ChunkWorld;
let sampler: HeightSampler;
beforeAll(async () => {
  world = await loadChunkWorld();
  sampler = new HeightSampler({ codes: world.codes, width: world.width, height: world.height, maxM: world.maxM });
});

const PLACES = [
  { name: 'Alps', lat: 46.5, lon: 8, heading: 180, tilt: 60 },
  { name: 'Himalaya', lat: 28.2, lon: 86.8, heading: 0, tilt: 65 },
  { name: 'Norway', lat: 61.9, lon: 7.2, heading: 90, tilt: 60 },
] as const;
const HEIGHTS = [300, 2000, 15000] as const;

interface Seam {
  place: string;
  agl: number;
  tier: QualityTier;
  seams: number;
  vertices: number;
  capped: boolean;
  /** Largest difference between the two sides of a seam vertex in pixels, and the number of vertices above 1 pixel. */
  worstPx: number;
  over: number;
  /** The largest mismatch at a seam vertex as a share of the skirt depth of the finer chunk on that edge (a crack deeper than 1 is not covered). */
  worstSkirt: number;
  /** The same with the octaves limited by the level alone (no distance law): the control. */
  levelOnlyWorstPx: number;
  levelOnlyOver: number;
}

function seamsOf(tier: QualityTier, place: (typeof PLACES)[number], agl: number, maxChunks?: number, tilt: number = place.tilt): Seam {
  const q = QUALITY[tier];
  const cells = q.chunkCells;
  const lod = detailLod(cells, Math.min(q.chunkSplitK, q.chunkDeepK));
  const pose = poseOf(world, { lat: place.lat, lon: place.lon, heading: place.heading, tilt }, agl);
  const tree = makeTree(world, tier, maxChunks === undefined ? {} : { maxChunks });
  tree.update(quadCameraOf(pose));
  const cam: [number, number, number] = [pose.position[0], pose.position[1], pose.position[2]];
  const pixelRad = (2 * Math.tan((pose.fovDeg * DEG) / 2)) / 540;
  const g = makeChunkGeo();
  const out: Seam = { place: place.name, agl, tier, seams: 0, vertices: 0, capped: tree.capped, worstPx: 0, over: 0, worstSkirt: 0, levelOnlyWorstPx: 0, levelOnlyOver: 0 };
  const px = (lat: number, lon: number, h: number): number => {
    const d = latLonToVec(lat, lon);
    const r = 1 + (HEIGHT_EXAGGERATION * h) / R_M;
    return Math.hypot(d[0] * r - cam[0], d[1] * r - cam[1], d[2] * r - cam[2]) * pixelRad;
  };
  for (let i = 0; i < tree.count; i++) {
    const level = tree.level[i] as number;
    chunkGeo(level, tree.ix[i] as number, tree.iy[i] as number, g);
    for (let edge = 0; edge < 4; edge++) {
      const d = tree.coarser[4 * i + edge] as number;
      if (d === 0) continue;
      out.seams++;
      const step = 1 << d;
      for (let k = 0; k <= cells; k += step) {
        const t = k / cells;
        const gx = edge === 0 ? 0 : edge === 1 ? 1 : t;
        const gy = edge === 2 ? 0 : edge === 3 ? 1 : t;
        const lat = (g.latC + (0.5 - gy) * g.dLat) / DEG;
        const lon = (g.lonC + (gx - 0.5) * g.dLon) / DEG;
        if (Math.abs(lat) > 89.9) continue;
        const nFine = octavesForLevel(level, cells);
        const nCoarse = octavesForLevel(level - d, cells);
        const hF = sampler.heightSeenM(lat, lon, cam, HEIGHT_EXAGGERATION, lod, nFine);
        const hC = sampler.heightSeenM(lat, lon, cam, HEIGHT_EXAGGERATION, lod, nCoarse);
        const pxSize = px(lat, lon, hF);
        const diffPx = (HEIGHT_EXAGGERATION * Math.abs(hF - hC)) / R_M / (pxSize / 1);
        out.vertices++;
        out.worstPx = Math.max(out.worstPx, diffPx);
        if (diffPx > 1) out.over++;
        const skirtDepth = (chunkSizeRad(level) / cells) * CHUNK_SKIRT_CELLS * step; // Earth radii: the skirt of the finer chunk on this edge
        out.worstSkirt = Math.max(out.worstSkirt, (HEIGHT_EXAGGERATION * Math.abs(hF - hC)) / R_M / skirtDepth);
        // the control: the octaves of the level alone
        const lF = sampler.heightAt(lat, lon, nFine);
        const lC = sampler.heightAt(lat, lon, nCoarse);
        const cPx = (HEIGHT_EXAGGERATION * Math.abs(lF - lC)) / R_M / pxSize;
        out.levelOnlyWorstPx = Math.max(out.levelOnlyWorstPx, cPx);
        if (cPx > 1) out.levelOnlyOver++;
      }
    }
  }
  return out;
}

describe('LOD pops: the height of a vertex shared by two chunks of different levels', () => {
  it('is the same from both sides within one pixel (the octaves follow the distance, the level only caps them) on every seam where the chunk cap does not bind, at 300 m, 2 km and 15 km over the Alps, the Himalaya and Norway', () => {
    const rows: Seam[] = [];
    for (const tier of ['medium', 'test'] as const) for (const place of PLACES) for (const agl of HEIGHTS) rows.push(seamsOf(tier, place, agl));
    let uncappedSeams = 0;
    let controlOver = 0;
    for (const s of rows) {
      console.log(`[lod pop] ${s.tier} ${s.place} ${s.agl} m: ${s.seams} seams, ${s.vertices} shared vertices, ${s.capped ? 'capped' : 'uncapped'}, worst ${s.worstPx.toFixed(3)} px, ${s.over} over 1 px; level-only octaves: worst ${s.levelOnlyWorstPx.toFixed(2)} px, ${s.levelOnlyOver} over 1 px`);
      if (!s.capped) {
        uncappedSeams += s.seams;
        expect(s.over, `${s.tier} ${s.place} ${s.agl} m`).toBe(0);
        expect(s.worstPx).toBeLessThan(1);
      }
      controlOver += s.levelOnlyOver;
    }
    expect(uncappedSeams, 'seams on views where the cap does not bind').toBeGreaterThan(40);
    // the control: without the distance law (octaves of the level alone) the same seams pop by many pixels, so the check can fail
    expect(controlOver, 'vertices that would pop with level-only octaves').toBeGreaterThan(50);
  });

  it('under a binding cap (the test tier looking at the horizon at 85 degrees tilt, where the cap of 150 chunks binds in most views) a chunk can be coarser than its distance and the cap on its octaves binds: the mismatch at a seam is a crack that the skirt of the finer chunk covers', () => {
    const rows: Seam[] = [];
    for (const place of PLACES) for (const agl of HEIGHTS) rows.push(seamsOf('test', place, agl, undefined, 85));
    const worst = Math.max(...rows.map((r) => r.worstPx));
    const over = rows.reduce((n, r) => n + r.over, 0);
    const vertices = rows.reduce((n, r) => n + r.vertices, 0);
    const cappedViews = rows.filter((r) => r.capped).length;
    const worstSkirt = Math.max(...rows.map((r) => r.worstSkirt));
    console.log(`[lod pop] test tier at 85 degrees tilt: ${cappedViews} of ${rows.length} views capped, ${vertices} seam vertices, worst ${worst.toFixed(2)} px, ${over} over 1 px, worst mismatch ${(100 * worstSkirt).toFixed(0)} % of the skirt depth`);
    expect(cappedViews).toBeGreaterThanOrEqual(6);
    expect(vertices).toBeGreaterThan(1000);
    // what a binding cap leaves is a crack the skirt of the finer chunk covers (its depth is 1.25 cells of the finer chunk times 2^levels the neighbour is coarser)
    expect(worstSkirt).toBeLessThan(1);
  });
});

describe('the distance law', () => {
  it('a chunk the quadtree draws is never asked for more octaves than its level carries: at every vertex of every leaf of an uncapped view, octavesAtDistance <= octavesForLevel + 0.05', () => {
    let checked = 0;
    let capped = 0;
    for (const tier of ['medium'] as const) {
      const q = QUALITY[tier];
      const lod = detailLod(q.chunkCells, Math.min(q.chunkSplitK, q.chunkDeepK));
      for (const place of PLACES) {
        for (const agl of HEIGHTS) {
          const pose = poseOf(world, { lat: place.lat, lon: place.lon, heading: place.heading, tilt: place.tilt }, agl);
          const tree = makeTree(world, tier);
          tree.update(quadCameraOf(pose));
          if (tree.capped) {
            capped++;
            continue;
          }
          const g = makeChunkGeo();
          for (let i = 0; i < tree.count; i++) {
            const level = tree.level[i] as number;
            chunkGeo(level, tree.ix[i] as number, tree.iy[i] as number, g);
            for (let a = 0; a <= 4; a++) {
              for (let b = 0; b <= 4; b++) {
                const lat = (g.latC + (0.5 - a / 4) * g.dLat) / DEG;
                const lon = (g.lonC + (b / 4 - 0.5) * g.dLon) / DEG;
                const v = latLonToVec(lat, lon);
                const h = sampler.heightAt(lat, lon, 3);
                const r = 1 + (HEIGHT_EXAGGERATION * h) / R_M;
                const d = Math.hypot(v[0] * r - pose.position[0], v[1] * r - pose.position[1], v[2] * r - pose.position[2]);
                expect(octavesAtDistance(d, lod), `level ${level} chunk`).toBeLessThanOrEqual(octavesForLevel(level, q.chunkCells) + 0.05);
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(capped).toBeLessThan(9);
  });

  it('is monotone: the farther the vertex, the fewer octaves; one octave less per doubling of the distance', () => {
    const lod = detailLod(32, 2.2);
    let prev = Infinity;
    for (let d = 1e-6; d < 1; d *= 1.3) {
      const n = octavesAtDistance(d, lod);
      expect(n).toBeLessThan(prev);
      prev = n;
    }
    expect(octavesAtDistance(1e-4, lod) - octavesAtDistance(2e-4, lod)).toBeCloseTo(1, 9);
  });
});

// The pop of a chunk SWAP (M07b audit): when a node splits into four children (or four children merge back) every vertex of the new chunks is placed on the
// detailed surface, and the part of the picture the old chunk drew is now drawn by a mesh of twice the resolution. `detailLod.test.ts` holds the vertices the
// two chunks SHARE (a seam) to one pixel; this file measures the whole swap: how far, in pixels, the vertices of a leaf are from the surface its PARENT chunk
// would draw under them (the parent's piecewise linear surface through the parent's vertices, the diagonal of every cell from the north-west to the
// south-east corner as in `chunkMesh.ts`), for the leaves that are about to merge (their nearest vertex is within 35 % of the parent's split distance, the
// range in which the quadtree splits and merges them). That is exactly what moves when the swap happens. The control takes the octaves of the chunk's level
// alone (no distance law): the same measure is several times larger, so the test can fail.
import { beforeAll, describe, expect, it } from 'vitest';
import { DETAIL_OCTAVES_MAX, EARTH_RADIUS_KM, HEIGHT_EXAGGERATION } from '../../src/render/config';
import { HeightSampler, detailLod, octavesForLevel } from '../../src/render/detail';
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
const HEIGHTS = [300, 2000, 15000, 46000] as const;

/** Latitude and longitude (degrees) of grid vertex (i, j) of chunk (level, ix, iy). */
function vertexLatLon(level: number, ix: number, iy: number, cells: number, i: number, j: number): [number, number] {
  const size = Math.PI / 2 / 2 ** level;
  const lat = Math.PI / 2 - (iy + 0.5) * size + (0.5 - j / cells) * size;
  const lon = -Math.PI + (ix + 0.5) * size + (i / cells - 0.5) * size;
  return [lat / DEG, lon / DEG];
}

interface SwapStats {
  leaves: number;
  vertices: number;
  worstPx: number;
  over1: number;
  controlWorstPx: number;
  controlOver1: number;
}

function swapPop(tier: QualityTier, place: (typeof PLACES)[number], agl: number, bias = 0, maxLeaves = 10): SwapStats {
  const q = QUALITY[tier];
  const cells = q.chunkCells;
  const base = detailLod(cells, Math.min(q.chunkSplitK, q.chunkDeepK));
  const lod = { ...base, offset: base.offset + bias };
  const pose = poseOf(world, { lat: place.lat, lon: place.lon, heading: place.heading, tilt: place.tilt }, agl);
  const tree = makeTree(world, tier);
  tree.update(quadCameraOf(pose));
  const cam: [number, number, number] = [pose.position[0], pose.position[1], pose.position[2]];
  const pixelRad = (2 * Math.tan((pose.fovDeg * DEG) / 2)) / 540;
  const out: SwapStats = { leaves: 0, vertices: 0, worstPx: 0, over1: 0, controlWorstPx: 0, controlOver1: 0 };
  const pixels = (lat: number, lon: number, h: number, dh: number): number => {
    const d = latLonToVec(lat, lon);
    const r = 1 + (HEIGHT_EXAGGERATION * h) / R_M;
    return (HEIGHT_EXAGGERATION * dh) / R_M / (Math.hypot(d[0] * r - cam[0], d[1] * r - cam[1], d[2] * r - cam[2]) * pixelRad);
  };
  for (let n = 0; n < tree.count; n++) {
    const level = tree.level[n] as number;
    if (level < 2) continue;
    const ix = tree.ix[n] as number;
    const iy = tree.iy[n] as number;
    const px = ix >> 1;
    const py = iy >> 1;
    const cx = ix & 1;
    const cy = iy & 1;
    const parentSplit = tree.splitDistance(level - 1);
    // the leaves that are about to merge: the nearest vertex of the leaf is within 35 % of the parent's split distance (a leaf much nearer than that stays split)
    let nearest = Infinity;
    for (let j = 0; j <= cells; j += 4) {
      for (let i = 0; i <= cells; i += 4) {
        const [la, lo] = vertexLatLon(level, ix, iy, cells, i, j);
        if (Math.abs(la) > 89.9) continue;
        sampler.heightSeenM(la, lo, cam, HEIGHT_EXAGGERATION, lod, DETAIL_OCTAVES_MAX);
        nearest = Math.min(nearest, sampler.lastSeenDistance);
      }
    }
    if (!(nearest >= 0.9 * parentSplit && nearest <= 1.35 * parentSplit)) continue;
    if (out.leaves >= maxLeaves) break;
    out.leaves++;
    const nChild = octavesForLevel(level, cells);
    const nParent = octavesForLevel(level - 1, cells);
    // the parent's surface: its vertices (seen from the camera with its own octaves), then the piecewise linear surface through them
    const cache = new Map<number, number>();
    const ph = (pi: number, pj: number, control: boolean): number => {
      const key = (pj * (cells + 1) + pi) * 2 + (control ? 1 : 0);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const [la, lo] = vertexLatLon(level - 1, px, py, cells, pi, pj);
      const h = control ? sampler.heightAt(la, lo, nParent) : sampler.heightSeenM(la, lo, cam, HEIGHT_EXAGGERATION, lod, nParent);
      cache.set(key, h);
      return h;
    };
    for (let j = 0; j <= cells; j++) {
      for (let i = 0; i <= cells; i++) {
        const [la, lo] = vertexLatLon(level, ix, iy, cells, i, j);
        if (Math.abs(la) > 89.9) continue;
        const gi = (cx * cells + i) / 2;
        const gj = (cy * cells + j) / 2;
        const ci = Math.min(cells - 1, Math.floor(gi));
        const cj = Math.min(cells - 1, Math.floor(gj));
        const u = gi - ci;
        const v = gj - cj;
        const surface = (control: boolean): number => {
          const nw = ph(ci, cj, control);
          const se = ph(ci + 1, cj + 1, control);
          return v >= u ? nw + (ph(ci, cj + 1, control) - nw) * v + (se - ph(ci, cj + 1, control)) * u : nw + (ph(ci + 1, cj, control) - nw) * u + (se - ph(ci + 1, cj, control)) * v;
        };
        const own = sampler.heightSeenM(la, lo, cam, HEIGHT_EXAGGERATION, lod, nChild);
        const px1 = pixels(la, lo, own, Math.abs(own - surface(false)));
        const ownC = sampler.heightAt(la, lo, nChild);
        const px2 = pixels(la, lo, ownC, Math.abs(ownC - surface(true)));
        out.vertices++;
        out.worstPx = Math.max(out.worstPx, px1);
        if (px1 > 1) out.over1++;
        out.controlWorstPx = Math.max(out.controlWorstPx, px2);
        if (px2 > 1) out.controlOver1++;
      }
    }
  }
  return out;
}

describe('the pop of a chunk swap, in pixels (the leaves that are about to merge against their parent\'s surface)', () => {
  const rowsOf = (tier: QualityTier): SwapStats[] => {
    const rows: SwapStats[] = [];
    for (const place of PLACES) {
      for (const agl of HEIGHTS) {
        const r = swapPop(tier, place, agl);
        console.log(`[swap pop] ${tier} ${place.name} ${agl} m: ${r.leaves} leaves, ${r.vertices} vertices, worst ${r.worstPx.toFixed(2)} px, ${r.over1} over 1 px (${((100 * r.over1) / Math.max(r.vertices, 1)).toFixed(2)} %); level-only octaves: worst ${r.controlWorstPx.toFixed(2)} px, ${r.controlOver1} over 1 px`);
        rows.push(r);
      }
    }
    return rows;
  };
  const total = (rows: SwapStats[]): { vertices: number; over: number; worst: number; control: number; leaves: number } => ({
    vertices: rows.reduce((n, r) => n + r.vertices, 0),
    over: rows.reduce((n, r) => n + r.over1, 0),
    worst: Math.max(...rows.map((r) => r.worstPx)),
    control: rows.reduce((n, r) => n + r.controlOver1, 0),
    leaves: rows.reduce((n, r) => n + r.leaves, 0),
  });

  it.each(['medium', 'high'] as const)('%s tier: at most 3 % of the vertices of a leaf about to merge are more than a pixel from its parent\'s surface, the worst is under 12 px, and the distance law takes at least 40 % off the pop of the level-only octaves (the control)', (tier) => {
    const t = total(rowsOf(tier));
    console.log(`[swap pop] ${tier}: ${t.leaves} leaves, ${t.vertices} vertices, ${t.over} over 1 px (${((100 * t.over) / t.vertices).toFixed(2)} %), worst ${t.worst.toFixed(2)} px; level-only octaves: ${t.control} over 1 px`);
    expect(t.leaves, 'leaves about to merge in the sample').toBeGreaterThan(100);
    expect(t.vertices).toBeGreaterThan(100_000);
    expect(t.over / t.vertices).toBeLessThan(0.03);
    expect(t.worst).toBeLessThan(12);
    // the control: without the distance law the same swaps pop on at least 1.7 times as many vertices (2.7 at the medium tier, 2.2 at the high one), so the measure can fail
    expect(t.over).toBeLessThan(0.6 * t.control);
  }, 120_000);

  it('the measure sees the octaves: taking one more octave away from the distance law (bias -1) lowers the number of vertices over a pixel, so the pop is a property of the fine octaves and of the mesh, and bias 0 is the pinned default (D154)', () => {
    let over0 = 0;
    let over1 = 0;
    for (const place of PLACES) {
      for (const agl of [300, 2000, 15000]) {
        over0 += swapPop('medium', place, agl, 0, 6).over1;
        over1 += swapPop('medium', place, agl, -1, 6).over1;
      }
    }
    console.log(`[swap pop] medium: ${over0} vertices over 1 px with the tier's law, ${over1} with one octave fewer`);
    expect(over1).toBeLessThan(over0);
  }, 120_000);
});

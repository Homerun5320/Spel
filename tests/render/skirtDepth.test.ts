import { describe, expect, it } from 'vitest';
import { chunkGeo, chunkSizeRad, makeChunkGeo } from '../../src/render/chunkMath';
import { CHUNK_SKIRT_CELLS, HEIGHT_EXAGGERATION } from '../../src/render/config';
import { DEG } from '../../src/render/geo';
import { QUALITY } from '../../src/render/quality';
import { loadChunkWorld, makeTree, poseOf, quadCameraOf, rng } from '../helpers/chunkWorld';

describe('skirts are deep enough for the crack between two LOD levels', () => {
  it('on every LOD seam of many views over the mountains, the height difference between the finer chunk\'s edge and the straight edge of the coarser one stays within the skirt depth', async () => {
    const world = await loadChunkWorld();
    const g = makeChunkGeo();
    const r = rng(21);
    const places = [
      [28.2, 86.8], // Himalaya
      [46.5, 8], // Alps
      [-32.6, -70], // Andes
      [61.5, 6], // western Norway
      [36, 138], // Japan
      [-1, 37], // Kilimanjaro
    ] as const;
    let seams = 0;
    let worstRatio = 0;
    for (const tier of ['test', 'medium'] as const) {
      const cells = QUALITY[tier].chunkCells;
      for (let trial = 0; trial < 36; trial++) {
        const [lat, lon] = places[trial % places.length] as readonly [number, number];
        const alt = [2000, 10_000, 60_000, 300_000, 1_500_000][trial % 5] as number;
        const pose = poseOf(world, { lat: lat + 2 * r() - 1, lon: lon + 2 * r() - 1, heading: 360 * r(), tilt: 30 + 55 * r() }, alt);
        const tree = makeTree(world, tier);
        tree.update(quadCameraOf(pose));
        for (let i = 0; i < tree.count; i++) {
          const level = tree.level[i] as number;
          chunkGeo(level, tree.ix[i] as number, tree.iy[i] as number, g);
          for (let edge = 0; edge < 4; edge++) {
            const d = tree.coarser[4 * i + edge] as number;
            if (d === 0) continue;
            seams++;
            const step = 1 << d; // fine cells per coarse cell
            const at = (k: number): number => {
              const t = k / cells;
              // position along the edge: west / east edges run north to south (gy = t), north / south edges west to east (gx = t)
              const gx = edge === 0 ? 0 : edge === 1 ? 1 : t;
              const gy = edge === 2 ? 0 : edge === 3 ? 1 : t;
              const la = (g.latC + (0.5 - gy) * g.dLat) / DEG;
              const lo = (g.lonC + (gx - 0.5) * g.dLon) / DEG;
              return (HEIGHT_EXAGGERATION * world.field.heightM(la, lo)) / 6_371_000;
            };
            // fine vertices between two coarse vertices (the coarse grid is the fine grid at multiples of `step` along the shared edge)
            let worst = 0;
            for (let k0 = 0; k0 + step <= cells; k0 += step) {
              const a = at(k0);
              const b = at(k0 + step);
              for (let k = k0 + 1; k < k0 + step; k++) worst = Math.max(worst, Math.abs(at(k) - (a + ((b - a) * (k - k0)) / step)));
            }
            const depth = (chunkSizeRad(level) / cells) * CHUNK_SKIRT_CELLS * step; // the skirt of the finer chunk on that edge (its own cell times 2^d)
            worstRatio = Math.max(worstRatio, worst / depth);
            expect(worst, `${tier} leaf ${level}/${tree.ix[i]}/${tree.iy[i]} edge ${edge} (${d} levels coarser)`).toBeLessThanOrEqual(depth);
          }
        }
      }
    }
    console.log(`[skirt depth] ${seams} LOD seam edges over six mountain regions: worst mismatch is ${(100 * worstRatio).toFixed(1)} % of the skirt depth`);
    expect(seams).toBeGreaterThan(300);
  });
});

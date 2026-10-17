// The chunk density lever (M07b audit, for M24a's quality regulator): `ChunkQuadtree.setSplitScale` scales every split distance, nothing else.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadChunkWorld, makeTree, poseOf, quadCameraOf, type ChunkWorld } from '../helpers/chunkWorld';

let world: ChunkWorld;
beforeAll(async () => {
  world = await loadChunkWorld();
});

const keyOf = (t: ReturnType<typeof makeTree>): string[] => Array.from({ length: t.count }, (_, i) => `${t.level[i]}/${t.ix[i]}/${t.iy[i]}`).sort();

describe('ChunkQuadtree.setSplitScale', () => {
  it('scales the split distances linearly, gives more leaves above 1 and fewer below it, and 1 gives the tier\'s own leaves back exactly', () => {
    const tree = makeTree(world, 'high');
    const pose = poseOf(world, { lat: 46.5, lon: 8, heading: 0, tilt: 55 }, 15_000);
    tree.update(quadCameraOf(pose));
    const own = keyOf(tree);
    const d9 = tree.splitDistance(9);
    expect(tree.splitScale).toBe(1);
    const counts: Record<string, number> = {};
    for (const s of [0.6, 0.8, 1.25, 1.6]) {
      tree.setSplitScale(s);
      tree.reset();
      expect(tree.splitDistance(9)).toBeCloseTo(d9 * s, 12);
      tree.update(quadCameraOf(pose));
      counts[s] = tree.count;
    }
    expect(counts['0.6']).toBeLessThan(counts['0.8'] as number);
    expect(counts['0.8']).toBeLessThan(own.length);
    expect(own.length).toBeLessThan(counts['1.25'] as number);
    expect(counts['1.25']).toBeLessThan(counts['1.6'] as number);
    tree.setSplitScale(1);
    tree.reset();
    tree.update(quadCameraOf(pose));
    expect(keyOf(tree)).toEqual(own);
  });

  it('the cap of the tier does not move with the density: a large scale ends at the cap, never above it', () => {
    const tree = makeTree(world, 'test');
    const pose = poseOf(world, { lat: 28.2, lon: 86.8, heading: 0, tilt: 60 }, 2000);
    tree.setSplitScale(2);
    tree.update(quadCameraOf(pose));
    expect(tree.count).toBeLessThanOrEqual(150);
    expect(tree.capped).toBe(true);
  });
});

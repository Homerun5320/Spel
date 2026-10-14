import { describe, expect, it } from 'vitest';
import { buildChunkGrid } from '../../src/render/chunkMesh';
import { CHUNK_ABSOLUTE_MAX, QUALITY, QUALITY_TIERS, chunkTriangleBudget, chunkTriangles } from '../../src/render/quality';

describe('the shared chunk grid mesh', () => {
  it('32 cells: 33 x 33 grid vertices, skirt vertices on the 128 edge points, 2048 grid and 256 skirt triangles', () => {
    const g = buildChunkGrid(32);
    expect(g.gridVertices).toBe(33 * 33);
    expect(g.position.length / 3).toBe(33 * 33 + 128);
    expect(g.triangles).toBe(2 * 32 * 32 + 8 * 32);
    expect(g.skirtTriangles).toBe(8 * 32);
    expect(g.triangles).toBe(chunkTriangles({ chunkCells: 32 }));
  });

  it('16 cells (the test tier): 17 x 17 vertices, 640 triangles', () => {
    const g = buildChunkGrid(16);
    expect(g.gridVertices).toBe(17 * 17);
    expect(g.triangles).toBe(640);
    expect(g.triangles).toBe(chunkTriangles(QUALITY.test));
  });

  it('every index is a vertex and fits 16 bits; grid vertices carry (gx, gy, 0), skirt vertices (gx, gy, 1) at an edge point', () => {
    const g = buildChunkGrid(32);
    const n = g.position.length / 3;
    for (const i of g.index) expect(i).toBeLessThan(n);
    for (let v = 0; v < n; v++) {
      const [gx, gy, s] = [g.position[3 * v] as number, g.position[3 * v + 1] as number, g.position[3 * v + 2] as number];
      expect(gx).toBeGreaterThanOrEqual(0);
      expect(gx).toBeLessThanOrEqual(1);
      expect(gy).toBeGreaterThanOrEqual(0);
      expect(gy).toBeLessThanOrEqual(1);
      if (v < g.gridVertices) expect(s).toBe(0);
      else {
        expect(s).toBe(1);
        expect(gx === 0 || gx === 1 || gy === 0 || gy === 1).toBe(true);
      }
    }
  });

  it('grid triangles face up and skirt triangles face OUTWARD from the chunk (checked on the normals in grid space: x east, up, z south)', () => {
    const g = buildChunkGrid(8);
    const depth = 0.25;
    const P = (v: number): [number, number, number] => [g.position[3 * v] as number, -(g.position[3 * v + 2] as number) * depth, g.position[3 * v + 1] as number];
    const gridTris = g.triangles - g.skirtTriangles;
    for (let t = 0; t < g.triangles; t++) {
      const [a, b, c] = [g.index[3 * t] as number, g.index[3 * t + 1] as number, g.index[3 * t + 2] as number].map(P) as [[number, number, number], [number, number, number], [number, number, number]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [(u[1] as number) * (w[2] as number) - (u[2] as number) * (w[1] as number), (u[2] as number) * (w[0] as number) - (u[0] as number) * (w[2] as number), (u[0] as number) * (w[1] as number) - (u[1] as number) * (w[0] as number)] as [number, number, number];
      if (t < gridTris) {
        expect(n[1] as number, `grid triangle ${t}`).toBeGreaterThan(0);
        continue;
      }
      // a wall: all three vertices lie on one edge of the chunk
      const xs = [a[0], b[0], c[0]];
      const zs = [a[2], b[2], c[2]];
      let outward: [number, number, number];
      if (xs.every((x) => x === 0)) outward = [-1, 0, 0];
      else if (xs.every((x) => x === 1)) outward = [1, 0, 0];
      else if (zs.every((z) => z === 0)) outward = [0, 0, -1];
      else if (zs.every((z) => z === 1)) outward = [0, 0, 1];
      else throw new Error(`skirt triangle ${t} is not on one edge`);
      expect(n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2], `skirt triangle ${t}`).toBeGreaterThan(0);
    }
  });

  it('refuses cell counts it cannot index', () => {
    expect(() => buildChunkGrid(0)).toThrow();
    expect(() => buildChunkGrid(2.5)).toThrow();
    expect(() => buildChunkGrid(65)).toThrow();
  });
});

describe('chunk tiers and their hard triangle budget', () => {
  it('no tier allows more than 400 chunks; the test tier stays within 150k triangles, the high tier within 1.5M', () => {
    for (const t of QUALITY_TIERS) expect(QUALITY[t].chunkMax, t).toBeLessThanOrEqual(CHUNK_ABSOLUTE_MAX);
    expect(CHUNK_ABSOLUTE_MAX).toBe(400);
    expect(chunkTriangleBudget(QUALITY.test)).toBeLessThanOrEqual(150_000);
    expect(chunkTriangleBudget(QUALITY.high)).toBeLessThanOrEqual(1_500_000);
    expect(chunkTriangleBudget(QUALITY.high)).toBeGreaterThanOrEqual(100_000);
  });

  it('tiers grow: more chunks and a larger split distance from test / low to medium to high; the deep levels need less distance than the coarse ones', () => {
    expect(QUALITY.medium.chunkMax).toBeGreaterThan(QUALITY.low.chunkMax);
    expect(QUALITY.high.chunkMax).toBeGreaterThan(QUALITY.medium.chunkMax);
    expect(QUALITY.high.chunkSplitK).toBeGreaterThan(QUALITY.medium.chunkSplitK);
    for (const t of QUALITY_TIERS) expect(QUALITY[t].chunkDeepK, t).toBeLessThan(QUALITY[t].chunkSplitK);
  });

  it('the test tier chunk terrain plus the 9024-triangle atmosphere shell fits the 150k globe budget of docs/ARCHITECTURE.md', () => {
    expect(chunkTriangleBudget(QUALITY.test) + 9024).toBeLessThanOrEqual(150_000);
  });
});

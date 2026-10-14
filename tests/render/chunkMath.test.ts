import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkGeo, chunkHue, chunkKey, chunkSizeRad, levelCols, levelRows, makeChunkGeo, vertexOffsetExact, vertexRelExact, vertexRelFloat32, ROOT_COLS, ROOT_ROWS } from '../../src/render/chunkMath';
import { EARTH_RADIUS_KM } from '../../src/render/config';
import { eastAt, latLonToVec, northAt, DEG } from '../../src/render/geo';
import { ALTITUDE_VIEWS, loadChunkWorld, makeTree, poseOf, quadCameraOf, rng } from '../helpers/chunkWorld';

const R_M = EARTH_RADIUS_KM * 1000;
const CM = 0.01 / R_M; // one centimetre in Earth radii

describe('chunk keys, sizes and hues', () => {
  it('8 roots of 90 degrees; level L has 4 * 2^L columns and 2 * 2^L rows of 90 / 2^L degrees', () => {
    expect([ROOT_COLS, ROOT_ROWS, levelCols(0) * levelRows(0)]).toEqual([4, 2, 8]);
    expect(chunkSizeRad(0)).toBeCloseTo(Math.PI / 2, 12);
    expect(chunkSizeRad(3)).toBeCloseTo(Math.PI / 16, 12);
    expect([levelCols(3), levelRows(3)]).toEqual([32, 16]);
  });

  it('keys are unique over every node of the first six levels and exact (no float rounding)', () => {
    const seen = new Set<number>();
    for (let l = 0; l <= 5; l++) for (let y = 0; y < levelRows(l); y++) for (let x = 0; x < levelCols(l); x++) seen.add(chunkKey(l, x, y));
    expect(seen.size).toBe([0, 1, 2, 3, 4, 5].reduce((s, l) => s + levelCols(l) * levelRows(l), 0));
    expect(Number.isSafeInteger(chunkKey(17, levelCols(17) - 1, levelRows(17) - 1))).toBe(true);
  });

  it('the debug hue is deterministic, in [0, 1) and separates neighbouring chunks', () => {
    for (let i = 0; i < 200; i++) {
      const h = chunkHue(5, i, 7);
      expect(h).toBe(chunkHue(5, i, 7));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    let apart = 0;
    for (let i = 0; i < 100; i++) {
      const d = Math.abs(chunkHue(6, i, 3) - chunkHue(6, i + 1, 3));
      if (Math.min(d, 1 - d) > 0.05) apart++;
    }
    expect(apart).toBeGreaterThan(80);
    const hues = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) hues.add(Math.round(chunkHue(4, x, y) * 255));
    expect(hues.size).toBeGreaterThanOrEqual(20); // 24 chunks: at least 20 distinct 8-bit hues
  });
});

describe('chunk geometry', () => {
  it('the centre direction and the east / north frame equal the analytic frame of geo.ts', () => {
    const g = makeChunkGeo();
    for (const [l, x, y] of [[0, 0, 0], [0, 3, 1], [3, 17, 5], [9, 1234, 321], [17, 300000, 99999]] as const) {
      chunkGeo(l, x, y, g);
      const lat = g.latC / DEG;
      const lon = g.lonC / DEG;
      const c = latLonToVec(lat, lon);
      const e = eastAt(lon);
      const n = northAt(lat, lon);
      expect([g.cx, g.cy, g.cz]).toEqual(c.map((v) => expect.closeTo(v, 12)));
      expect([g.ex, g.ez]).toEqual([expect.closeTo(e[0], 12), expect.closeTo(e[2], 12)]);
      expect([g.nx, g.ny, g.nz]).toEqual(n.map((v) => expect.closeTo(v, 12)));
    }
  });

  it('the rows run from the north: row 0 is the northern half, column 0 starts at longitude -180', () => {
    const g = makeChunkGeo();
    chunkGeo(0, 0, 0, g);
    expect(g.latC / DEG).toBeCloseTo(45, 9);
    expect(g.lonC / DEG).toBeCloseTo(-135, 9);
    chunkGeo(0, 3, 1, g);
    expect(g.latC / DEG).toBeCloseTo(-45, 9);
    expect(g.lonC / DEG).toBeCloseTo(135, 9);
  });

  it('the vertex offset (direction of the vertex minus the centre direction) equals the difference of the two unit vectors', () => {
    const g = makeChunkGeo();
    chunkGeo(6, 100, 40, g);
    for (const [gx, gy] of [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1], [0.25, 0.75]] as const) {
      const off = vertexOffsetExact(g, gx, gy);
      const d = latLonToVec((g.latC + (0.5 - gy) * g.dLat) / DEG, (g.lonC + (gx - 0.5) * g.dLon) / DEG);
      expect(off[0]).toBeCloseTo(d[0] - g.cx, 12);
      expect(off[1]).toBeCloseTo(d[1] - g.cy, 12);
      expect(off[2]).toBeCloseTo(d[2] - g.cz, 12);
    }
  });
});

describe('precision: float32 chunk-relative vertex positions against the float64 reference', () => {
  it('property: for any chunk of any level and any vertex, the float32 offset from the chunk centre is within 1 cm of float64 (chunks up to 50 km across)', async () => {
    const world = await loadChunkWorld();
    fc.assert(
      fc.property(fc.integer({ min: 9, max: 17 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (level, a, b, gx, gy) => {
        const g = makeChunkGeo();
        chunkGeo(level, Math.floor(a * (levelCols(level) - 1)), Math.floor(b * (levelRows(level) - 1)), g);
        const h = world.field.radiusOf(world.field.heightM(g.latC / DEG, g.lonC / DEG)) - 1;
        // the chunk origin relative to a camera at the chunk (0): the chunk-relative position is the vertex minus the centre
        const exact = vertexRelExact(g, gx, gy, h, [g.cx, g.cy, g.cz]);
        const f32 = vertexRelFloat32(g, gx, gy, h, [0, 0, 0]);
        for (let i = 0; i < 3; i++) expect(Math.abs((f32[i] as number) - (exact[i] as number))).toBeLessThan(CM);
      }),
      { numRuns: 600 },
    );
  });

  it('every vertex of every chunk within 50 km of the camera, camera 300 m up: the float32 position relative to the CAMERA is within 1 cm of float64', async () => {
    const world = await loadChunkWorld();
    const r = rng(11);
    let checked = 0;
    let worst = 0;
    const g = makeChunkGeo();
    for (let trial = 0; trial < 12; trial++) {
      const view = { lat: -60 + 120 * r(), lon: -180 + 360 * r(), heading: 360 * r(), tilt: 90 * r() };
      const altAglM = [300, 300, 2000, 20000][trial % 4] as number;
      const pose = poseOf(world, view, altAglM);
      const tree = makeTree(world, 'high');
      tree.update(quadCameraOf(pose));
      for (let i = 0; i < tree.count; i++) {
        chunkGeo(tree.level[i] as number, tree.ix[i] as number, tree.iy[i] as number, g);
        const originRel: [number, number, number] = [Math.fround(g.cx - pose.position[0]), Math.fround(g.cy - pose.position[1]), Math.fround(g.cz - pose.position[2])];
        const near = Math.hypot(...originRel) * R_M < 50_000;
        if (!near) continue;
        for (const [gx, gy] of [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1], [0.3, 0.8], [0.9, 0.1]] as const) {
          const h = world.field.radiusOf(world.field.heightM((g.latC + (0.5 - gy) * g.dLat) / DEG, (g.lonC + (gx - 0.5) * g.dLon) / DEG)) - 1;
          const exact = vertexRelExact(g, gx, gy, h, pose.position);
          const f32 = vertexRelFloat32(g, gx, gy, h, originRel);
          const err = Math.hypot(f32[0] - exact[0], f32[1] - exact[1], f32[2] - exact[2]);
          worst = Math.max(worst, err * R_M);
          expect(err, `level ${g.level} vertex ${gx},${gy}`).toBeLessThan(CM);
          checked++;
        }
      }
    }
    console.log(`[precision] ${checked} vertices within 50 km of the camera, worst error ${(worst * 1000).toFixed(2)} mm`);
    expect(checked).toBeGreaterThan(200);
  });

  it('the old way (absolute float32 world coordinates) does NOT meet 1 cm at 300 m above the ground: the test can fail', async () => {
    const world = await loadChunkWorld();
    const g = makeChunkGeo();
    chunkGeo(17, 200000, 70000, g);
    const pose = poseOf(world, { lat: g.latC / DEG, lon: g.lonC / DEG, heading: 0, tilt: 0 }, 300);
    const gx = 0.37;
    const gy = 0.61;
    const h = 0;
    const exact = vertexRelExact(g, gx, gy, h, pose.position);
    const phi = g.latC + (0.5 - gy) * g.dLat;
    const lam = g.lonC + (gx - 0.5) * g.dLon;
    // absolute coordinates rounded to float32, minus the (float32) camera: what a naive vertex shader would form
    const abs = [Math.fround(Math.cos(phi) * Math.sin(lam)), Math.fround(Math.sin(phi)), Math.fround(Math.cos(phi) * Math.cos(lam))];
    const naive = abs.map((v, i) => Math.fround(v - Math.fround(pose.position[i] as number)));
    const err = Math.hypot(naive[0]! - exact[0], naive[1]! - exact[1], naive[2]! - exact[2]) * R_M;
    expect(err).toBeGreaterThan(0.01);
  });
});

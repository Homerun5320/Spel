// The production ChunkTerrain, not a copy of its wiring: the quadtree parameters it builds, the height bounds, the camera uniforms and the
// instance buffer the shader reads (the data feed that the string-contains tests of the GLSL cannot see).
import { beforeAll, describe, expect, it } from 'vitest';
import type { RenderPack, SimGrid, WorldMeta } from '../../src/data';
import type { InterleavedBufferAttribute } from 'three';
import { ChunkTerrain } from '../../src/render/chunkTerrain';
import { chunkGeo, chunkSizeRad, makeChunkGeo } from '../../src/render/chunkMath';
import { CHUNK_BUDGET_RESERVE, CHUNK_EVICTIONS_PER_FRAME, CHUNK_FRUSTUM_SLACK, CHUNK_HYSTERESIS, CHUNK_MAX_LEVEL, EARTH_RADIUS_KM, HEIGHT_EXAGGERATION, OWNER_GRID_H, OWNER_GRID_W } from '../../src/render/config';
import { POLE_HEIGHT_U } from '../../src/render/geo';
import { QUALITY, chunkTriangles, type QualitySettings } from '../../src/render/quality';
import { createTerrainMaterial, type TerrainMaterial } from '../../src/render/terrainMaterial';
import { createWorldTextures } from '../../src/render/textures';
import { ALTITUDE_VIEWS, loadChunkWorld, makeTree, poseOf, quadCameraOf, rng, type ChunkWorld } from '../helpers/chunkWorld';
import { worldLoader } from '../helpers/dataFiles';

let world: ChunkWorld;
let render: RenderPack;
let sim: SimGrid;
let meta: WorldMeta;
beforeAll(async () => {
  world = await loadChunkWorld();
  const w = worldLoader();
  [render, sim, meta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
});

function terrainOf(q: QualitySettings, exaggeration = HEIGHT_EXAGGERATION): { terrain: ChunkTerrain; tm: TerrainMaterial } {
  const tm = createTerrainMaterial(createWorldTextures(render, sim), render, sim, meta, undefined, undefined, 'chunks', q.chunkCells);
  const terrain = new ChunkTerrain({ material: tm.material, quality: q, codes: render.height8, width: render.width, height: render.height, maxM: meta.encoding.heightSqrt.maxM, exaggeration });
  return { terrain, tm };
}

describe('ChunkTerrain: the quadtree parameters it builds', () => {
  it('are the tier, the render constants and the raster: cap, levels, split distances, cells, texel width, hysteresis, frustum slack, budget rules', () => {
    for (const q of [QUALITY.test, QUALITY.low, QUALITY.medium, QUALITY.high]) {
      const p = terrainOf(q).terrain.tree.params;
      expect(p.maxChunks).toBe(q.chunkMax);
      expect(p.maxLevel).toBe(CHUNK_MAX_LEVEL);
      expect(p.splitK).toBe(q.chunkSplitK);
      expect(p.deepK).toBe(q.chunkDeepK);
      expect(p.cells).toBe(q.chunkCells);
      expect(p.texelRad).toBe((2 * Math.PI) / render.width);
      expect(p.hysteresis).toBe(CHUNK_HYSTERESIS);
      expect(p.frustumSlack).toBe(CHUNK_FRUSTUM_SLACK);
      expect(p.evictionsPerFrame).toBe(CHUNK_EVICTIONS_PER_FRAME);
      expect(p.reserve).toBe(CHUNK_BUDGET_RESERVE);
    }
  });

  /** The spec of a height range, written out independently: sqrt-coded codes squared, times the exaggeration and the tallest height, in Earth radii. */
  function expectedRange(u0: number, u1: number, v0: number, v1: number, exag: number): { lo: number; hi: number } {
    world.pyramid.range(u0, u1, v0, v1);
    let loC = world.pyramid.minCode;
    let hiC = world.pyramid.maxCode;
    if (v0 <= 0 || v1 >= 1) {
      world.pyramid.range(POLE_HEIGHT_U, POLE_HEIGHT_U, v0, v1);
      loC = Math.min(loC, world.pyramid.minCode);
      hiC = Math.max(hiC, world.pyramid.maxCode);
    }
    const k = (exag * world.maxM) / (EARTH_RADIUS_KM * 1000);
    return { lo: k * (loC / 255) ** 2, hi: k * (hiC / 255) ** 2 };
  }

  it('height bounds: the spec formula on 400 random rectangles (pole rows included), and they enclose every texel the bilinear taps can read', () => {
    const { terrain } = terrainOf(QUALITY.test);
    const range = terrain.tree.params.heightRange;
    const r = rng(77);
    const out = { lo: 0, hi: 0 };
    const k = (HEIGHT_EXAGGERATION * world.maxM) / (EARTH_RADIUS_KM * 1000);
    let poleRects = 0;
    for (let i = 0; i < 400; i++) {
      const size = 10 ** (-4.5 + 4.2 * r());
      const u0 = r() * (1 - size);
      let v0 = r() * (1 - size);
      let v1 = v0 + size;
      if (i % 5 === 0) {
        v0 = 0; // touches the north pole row
        v1 = size;
      } else if (i % 5 === 1) {
        v0 = 1 - size; // touches the south pole row
        v1 = 1;
      }
      if (v0 <= 0 || v1 >= 1) poleRects++;
      range(u0, u0 + size, v0, v1, out);
      const e = expectedRange(u0, u0 + size, v0, v1, HEIGHT_EXAGGERATION);
      expect(out.lo, `rect ${i} lo`).toBeCloseTo(e.lo, 14);
      expect(out.hi, `rect ${i} hi`).toBeCloseTo(e.hi, 14);
      // independent enclosure: the filtered (bilinear) height at points of the rectangle lies inside the range
      const W = render.width;
      const H = render.height;
      const code = (x: number, y: number): number => (render.height8[Math.min(H - 1, Math.max(0, y)) * W + ((x % W) + W) % W] as number) / 255;
      for (let s = 0; s < 12; s++) {
        const fu = u0 + size * (s % 4) / 3;
        const fv = v0 + (v1 - v0) * Math.floor(s / 4) / 2;
        const px = fu * W - 0.5;
        const py = fv * H - 0.5;
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        const tx = px - x0;
        const ty = py - y0;
        const c = code(x0, y0) * (1 - tx) * (1 - ty) + code(x0 + 1, y0) * tx * (1 - ty) + code(x0, y0 + 1) * (1 - tx) * ty + code(x0 + 1, y0 + 1) * tx * ty;
        // (the sqrt-coded value squared: the filter runs on the codes, the bound is on the codes too)
        expect(k * c * c, `rect ${i} sample ${s}`).toBeLessThanOrEqual(out.hi + 1e-9 * k);
        expect(k * c * c, `rect ${i} sample ${s}`).toBeGreaterThanOrEqual(out.lo - 1e-9 * k);
      }
    }
    expect(poleRects).toBeGreaterThan(100);
  });

  it('a rectangle on the pole row also covers the pole column (the production range is the larger one the helper once missed), and the range follows the exaggeration', () => {
    const { terrain } = terrainOf(QUALITY.test);
    const range = terrain.tree.params.heightRange;
    // somewhere over land at the north pole row where the rectangle's own column is much lower than the pole column or vice versa
    const a = { lo: 0, hi: 0 };
    let widened = 0;
    const k = (HEIGHT_EXAGGERATION * world.maxM) / (EARTH_RADIUS_KM * 1000);
    for (let ux = 0; ux < 0.98; ux += 0.01) {
      for (const [v0, v1] of [[0, 0.02], [0.98, 1]] as const) {
        range(ux, ux + 0.02, v0, v1, a);
        world.pyramid.range(ux, ux + 0.02, v0, v1);
        if (a.hi > k * (world.pyramid.maxCode / 255) ** 2 + 1e-15 || a.lo < k * (world.pyramid.minCode / 255) ** 2 - 1e-15) widened++;
      }
    }
    expect(widened, 'rectangles whose range the pole column widens').toBeGreaterThan(0);
    // exaggeration 6 halves every bound exactly (the tree reads it through setExaggeration)
    const b = { lo: 0, hi: 0 };
    range(0.3, 0.31, 0.4, 0.41, a);
    terrain.setExaggeration(HEIGHT_EXAGGERATION / 2);
    range(0.3, 0.31, 0.4, 0.41, b);
    expect(b.hi).toBeCloseTo(a.hi / 2, 15);
    expect(b.lo).toBeCloseTo(a.lo / 2, 15);
    expect(a.hi).toBeGreaterThan(0);
  });
});

describe('ChunkTerrain: the camera it gives the quadtree', () => {
  it('selects exactly the leaves a quadtree of the same parameters selects for the pose (field of view, aspect, basis and position are passed on right)', () => {
    for (const v of ALTITUDE_VIEWS) {
      const pose = poseOf(world, v.view, v.altAglM);
      const { terrain } = terrainOf(QUALITY.test);
      terrain.update(pose);
      const tree = makeTree(world, 'test');
      tree.update(quadCameraOf(pose));
      const mine = terrain.leaves().map((l) => `${l.level}/${l.ix}/${l.iy}`).sort().join(',');
      const ref: string[] = [];
      for (let i = 0; i < tree.count; i++) ref.push(`${tree.level[i]}/${tree.ix[i]}/${tree.iy[i]}`);
      expect(mine, v.name).toBe(ref.sort().join(','));
      // a narrower field of view sees fewer chunks than a wide one at the same place
      terrain.dispose();
    }
    const view = ALTITUDE_VIEWS[3]!;
    const pose = poseOf(world, view.view, view.altAglM);
    const wide = terrainOf(QUALITY.test).terrain;
    const narrow = terrainOf(QUALITY.test).terrain;
    wide.update({ ...pose, fovDeg: 90 });
    narrow.update({ ...pose, fovDeg: 20 });
    expect(narrow.leaves().length).toBeLessThan(wide.leaves().length);
  });
});

describe('ChunkTerrain: what the shader is fed', () => {
  it('the camera uniforms rebuild the float64 position (high part + low part), and the low part is the part float32 dropped', () => {
    const { terrain, tm } = terrainOf(QUALITY.test);
    for (const v of ALTITUDE_VIEWS) {
      const pose = poseOf(world, v.view, v.altAglM);
      terrain.update(pose);
      const hi = tm.material.uniforms.uCamHi!.value as { x: number; y: number; z: number };
      const lo = tm.material.uniforms.uCamLo!.value as { x: number; y: number; z: number };
      const p = pose.position;
      expect(hi.x).toBe(Math.fround(p[0]));
      expect(hi.y).toBe(Math.fround(p[1]));
      expect(hi.z).toBe(Math.fround(p[2]));
      expect(Math.abs(hi.x + lo.x - p[0]), v.name).toBeLessThan(1e-15);
      expect(Math.abs(hi.y + lo.y - p[1]), v.name).toBeLessThan(1e-15);
      expect(Math.abs(hi.z + lo.z - p[2]), v.name).toBeLessThan(1e-15);
    }
    // at 300 m the position has bits below float32: the low part is not zero (it carries the millimetres)
    terrain.update(poseOf(world, { lat: 43.4, lon: 7.4, heading: 0, tilt: 84 }, 300));
    const lo = tm.material.uniforms.uCamLo!.value as { x: number; y: number; z: number };
    expect(Math.abs(lo.x) + Math.abs(lo.y) + Math.abs(lo.z)).toBeGreaterThan(0);
  });

  it('every instance holds its chunk: centre as high + low part, level, cell size, extent, neighbour levels (finer = -1), territory cell, in front-to-back order', () => {
    for (const q of [QUALITY.test, QUALITY.medium]) {
      const { terrain } = terrainOf(q);
      const view = ALTITUDE_VIEWS[3]!; // 60 km: LOD seams on every side
      terrain.update(poseOf(world, view.view, view.altAglM));
      const leaves = terrain.leaves();
      const n = leaves.length;
      expect(n).toBeGreaterThan(20);
      const attr = (name: string): InterleavedBufferAttribute => terrain.mesh.geometry.getAttribute(name) as InterleavedBufferAttribute;
      const [origin, up, east, geoA, neigh, cell] = ['aOrigin', 'aUp', 'aEast', 'aGeo', 'aNeigh', 'aCell'].map(attr) as [InterleavedBufferAttribute, InterleavedBufferAttribute, InterleavedBufferAttribute, InterleavedBufferAttribute, InterleavedBufferAttribute, InterleavedBufferAttribute];
      expect((terrain.mesh.geometry as unknown as { instanceCount: number }).instanceCount).toBe(n);
      const g = makeChunkGeo();
      let finerEdges = 0;
      let coarserEdges = 0;
      for (let i = 0; i < n; i++) {
        const src = n - 1 - i; // drawn nearest first
        const leaf = leaves[src]!;
        chunkGeo(leaf.level, leaf.ix, leaf.iy, g);
        expect(origin.getW(i), 'level').toBe(leaf.level);
        expect(up.getX(i) + origin.getX(i)).toBeCloseTo(g.cx, 14);
        expect(up.getY(i) + origin.getY(i)).toBeCloseTo(g.cy, 14);
        expect(up.getZ(i) + origin.getZ(i)).toBeCloseTo(g.cz, 14);
        expect(up.getX(i)).toBe(Math.fround(g.cx));
        expect(origin.getX(i), 'low part is what float32 dropped').not.toBe(0);
        expect(up.getW(i), 'cell size').toBe(Math.fround(chunkSizeRad(leaf.level) / q.chunkCells));
        expect(east.getX(i)).toBe(Math.fround(g.ex));
        expect(east.getZ(i)).toBe(Math.fround(g.ez));
        expect(geoA.getX(i)).toBe(Math.fround(g.latC));
        expect(geoA.getY(i)).toBe(Math.fround(g.dLat));
        expect(geoA.getZ(i)).toBe(Math.fround(g.dLon));
        expect(geoA.getW(i)).toBe(Math.fround(g.lonC));
        for (let k = 0; k < 4; k++) {
          const want = terrain.tree.finer[4 * src + k] === 1 ? -1 : leaf.coarser[k]!;
          const got = [neigh.getX(i), neigh.getY(i), neigh.getZ(i), neigh.getW(i)][k]!;
          expect(got, `leaf ${leaf.level}/${leaf.ix}/${leaf.iy} edge ${k}`).toBe(want);
          if (want === -1) finerEdges++;
          if (want > 0) coarserEdges++;
        }
        // the territory cell: the whole cell index of the centre and the fraction inside it
        const cellX = (g.lonC / (2 * Math.PI) + 0.5) * OWNER_GRID_W;
        const cellY = (0.5 - g.latC / Math.PI) * OWNER_GRID_H;
        expect(cell.getX(i)).toBe(Math.floor(cellX));
        expect(cell.getY(i)).toBe(Math.floor(cellY));
        expect(cell.getZ(i)).toBeCloseTo(cellX - Math.floor(cellX), 6);
        expect(cell.getW(i)).toBeCloseTo(cellY - Math.floor(cellY), 6);
      }
      expect(finerEdges, `${q.tier}: finer neighbours were marked`).toBeGreaterThan(0);
      expect(coarserEdges, `${q.tier}: coarser neighbours were marked`).toBeGreaterThan(0);
      expect(terrain.allFinite()).toBe(true);
      terrain.dispose();
    }
  });

  it('the stats are the tree: chunk count, the distinct levels (all of them, not only level 0), triangles of the tier, one draw call, the cap flag', () => {
    const { terrain } = terrainOf(QUALITY.test);
    expect(terrain.getStats()).toMatchObject({ chunkCount: 0, drawCalls: 0, triangles: 0, lodLevels: 0 });
    const view = ALTITUDE_VIEWS[4]!;
    terrain.update(poseOf(world, view.view, view.altAglM));
    const leaves = terrain.leaves();
    const s = terrain.getStats();
    const levels = [...new Set(leaves.map((l) => l.level))].sort((a, b) => a - b);
    expect(levels.length).toBeGreaterThan(5);
    expect(s.levels).toEqual(levels);
    expect(s.lodLevels).toBe(levels.length);
    expect(s.chunkCount).toBe(leaves.length);
    expect(s.triangles).toBe(leaves.length * chunkTriangles(QUALITY.test));
    expect(s.drawCalls).toBe(1);
    expect(s.capped).toBe(terrain.tree.capped);
    expect(terrain.mesh.visible).toBe(true);
    terrain.dispose();
  });
});

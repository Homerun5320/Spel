import { beforeAll, describe, expect, it } from 'vitest';
import { HEIGHT_EXAGGERATION } from '../../src/render/config';
import { POLE_HEIGHT_U, heightLookupUv } from '../../src/render/geo';
import { buildGlobeGeometry } from '../../src/render/globeMesh';
import { HeightField } from '../../src/render/heightField';
import { QUALITY, meshTriangles } from '../../src/render/quality';
import { worldLoader } from '../helpers/dataFiles';

describe('globe mesh', () => {
  const cols = 32;
  const rows = 16;
  const g = buildGlobeGeometry(cols, rows);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const index = g.getIndex();

  it('has (cols+1)(rows+1) vertices and 2*cols*rows triangles', () => {
    expect(pos.count).toBe((cols + 1) * (rows + 1));
    expect(index?.count).toBe(cols * rows * 6);
    expect(meshTriangles(QUALITY.test)).toBe(2 * 256 * 128);
  });

  it('positions are unit vectors, row 0 is the north pole, column 0 is longitude -180', () => {
    for (let i = 0; i < pos.count; i++) expect(Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i))).toBeCloseTo(1, 6);
    expect(pos.getY(0)).toBeCloseTo(1, 6); // vertex 0: north pole row
    expect(pos.getY(pos.count - 1)).toBeCloseTo(-1, 6);
    // the first vertex of the equator row sits at lon -180: (sin(-180), 0, cos(-180)) = (0, 0, -1)
    const eq = (rows / 2) * (cols + 1);
    expect(pos.getZ(eq)).toBeCloseTo(-1, 6);
    // a quarter of the way east (lon -90): x = -1
    expect(pos.getX(eq + cols / 4)).toBeCloseTo(-1, 6);
  });

  it('uv addresses the rasters: u = column / cols from -180, v = row / rows from the north', () => {
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0]);
    expect([uv.getX(pos.count - 1), uv.getY(pos.count - 1)]).toEqual([1, 1]);
  });

  it('every non-degenerate triangle faces outward (counter-clockwise seen from outside)', () => {
    const idx = index?.array as Uint32Array;
    let checked = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t] as number, idx[t + 1] as number, idx[t + 2] as number];
      const ab = [pos.getX(b) - pos.getX(a), pos.getY(b) - pos.getY(a), pos.getZ(b) - pos.getZ(a)] as const;
      const ac = [pos.getX(c) - pos.getX(a), pos.getY(c) - pos.getY(a), pos.getZ(c) - pos.getZ(a)] as const;
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]] as const;
      if (Math.hypot(...n) < 1e-9) continue; // pole triangles collapse to a line
      expect(n[0] * pos.getX(a) + n[1] * pos.getY(a) + n[2] * pos.getZ(a)).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(cols * rows);
  });
});

// The pole rows collapse to one point, so their vertices must all read ONE height or the pole tears into several radii.
// The vertex shader reads the height texture at heightLookupUv(u, v); here the very same bytes are filtered on the CPU
// (HeightField is the CPU copy of the height texture) for every vertex of the real test-tier mesh.
describe('pole rows: one common displaced radius (no tear)', () => {
  const { meshCols, meshRows } = QUALITY.test;
  const grid = buildGlobeGeometry(meshCols, meshRows);
  const uv = grid.getAttribute('uv');
  const vertexIndex = (row: number, col: number): number => row * (meshCols + 1) + col;
  let field: HeightField;

  beforeAll(async () => {
    const w = worldLoader();
    const [render, meta] = await Promise.all([w.loadRender(), w.loadMeta()]);
    field = new HeightField({ height8: render.height8, width: render.width, height: render.height, maxM: meta.encoding.heightSqrt.maxM, exaggeration: HEIGHT_EXAGGERATION });
  });

  /** Displaced radius of a vertex, read at the uv the vertex shader reads (`lookup`) from the real height raster. */
  const radiusOf = (row: number, col: number, lookup: (u: number, v: number) => [number, number]): number => {
    const k = vertexIndex(row, col);
    const [u, v] = lookup(uv.getX(k), uv.getY(k));
    return field.surfaceRadius(90 - v * 180, u * 360 - 180);
  };
  const rowRadii = (row: number, lookup: (u: number, v: number) => [number, number]): number[] =>
    Array.from({ length: meshCols + 1 }, (_, col) => radiusOf(row, col, lookup));
  // The behaviour before the fix: every vertex reads at its OWN longitude (v is nudged a hair inside the pole row only so
  // that the CPU field's exact-pole rule, which is the fix, does not apply to the control).
  const raw = (u: number, v: number): [number, number] => [u, v <= 0 ? 1e-9 : v >= 1 ? 1 - 1e-9 : v];

  it('the pole rows are v = 0 and v = 1 exactly, and heightLookupUv only touches them', () => {
    for (let col = 0; col <= meshCols; col++) {
      expect(uv.getY(vertexIndex(0, col))).toBe(0);
      expect(uv.getY(vertexIndex(meshRows, col))).toBe(1);
    }
    expect(heightLookupUv(0.3, 0)).toEqual([POLE_HEIGHT_U, 0]);
    expect(heightLookupUv(0.9, 1)).toEqual([POLE_HEIGHT_U, 1]);
    expect(heightLookupUv(0.3, 0.5)).toEqual([0.3, 0.5]);
    expect(heightLookupUv(0, 1 / meshRows)).toEqual([0, 1 / meshRows]);
  });

  it('all vertices of the south pole row end up with the same displaced radius, and it is a real Antarctic height', () => {
    const r = rowRadii(meshRows, heightLookupUv);
    expect(new Set(r).size).toBe(1);
    expect(r[0]).toBeGreaterThan(1 + (HEIGHT_EXAGGERATION * 1000) / 6371000); // the plateau at the pole is above 1 km
    // control: read at their own u, the same vertices WOULD tear (the bake repeats the polar row, heights differ by metres to km)
    const torn = rowRadii(meshRows, raw);
    expect((Math.max(...torn) - Math.min(...torn)) * 6371000).toBeGreaterThan(10000); // more than 10 km of exaggerated radius
  });

  it('all vertices of the north pole row end up with the same displaced radius (open sea: exactly 1)', () => {
    const r = rowRadii(0, heightLookupUv);
    expect(new Set(r).size).toBe(1);
    expect(r[0]).toBe(1);
  });

  it('the exact pole of the CPU height field agrees with the pole rows whatever longitude it is asked for', () => {
    const south = radiusOf(meshRows, 0, heightLookupUv);
    for (const lon of [-180, -90, 0, 37.5, 180]) expect(field.surfaceRadius(-90, lon)).toBe(south);
    expect(field.surfaceRadius(90, 123)).toBe(radiusOf(0, 0, heightLookupUv));
  });

  it('rows next to the pole keep their own longitude (the terrain stays)', () => {
    const near = rowRadii(meshRows - 1, heightLookupUv);
    expect(new Set(near).size).toBeGreaterThan(10);
    expect(near).toEqual(rowRadii(meshRows - 1, raw));
  });
});

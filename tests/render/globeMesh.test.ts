import { describe, expect, it } from 'vitest';
import { buildGlobeGeometry } from '../../src/render/globeMesh';
import { QUALITY, meshTriangles } from '../../src/render/quality';

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

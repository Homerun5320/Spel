import { describe, expect, it } from 'vitest';
import { fillPolygon, geometryRings, paintPolygon, unwrapRing, type Ring } from '../../tools/bake/raster';

const W = 360; // 1 degree per pixel
const H = 180;

function mask(rings: Ring[]): Uint8Array {
  const m = new Uint8Array(W * H);
  paintPolygon(m, W, H, rings, 1);
  return m;
}
const count = (m: Uint8Array): number => m.reduce((a, b) => a + b, 0);
const at = (m: Uint8Array, lon: number, lat: number): number => m[Math.floor(90 - lat) * W + Math.floor(lon + 180)] as number;
const box = (lon0: number, lat0: number, lon1: number, lat1: number): Ring => [
  [lon0, lat0],
  [lon1, lat0],
  [lon1, lat1],
  [lon0, lat1],
  [lon0, lat0],
];

describe('scanline rasteriser', () => {
  it('fills an axis-aligned box exactly (pixel centres)', () => {
    const m = mask([box(10, 20, 30, 50)]);
    expect(count(m)).toBe(20 * 30);
    expect(at(m, 10.5, 20.5)).toBe(1);
    expect(at(m, 29.5, 49.5)).toBe(1);
    expect(at(m, 30.5, 30.5)).toBe(0);
    expect(at(m, 9.5, 30.5)).toBe(0);
  });

  it('honours holes with the even-odd rule, whatever the winding', () => {
    const outer = box(0, 0, 40, 40);
    const hole = box(10, 10, 30, 30);
    const holeReversed = [...hole].reverse();
    for (const h of [hole, holeReversed]) {
      const m = mask([outer, h]);
      expect(count(m)).toBe(40 * 40 - 20 * 20);
      expect(at(m, 20.5, 20.5)).toBe(0);
      expect(at(m, 5.5, 5.5)).toBe(1);
    }
  });

  it('fills an island inside a hole (even-odd nesting)', () => {
    const m = mask([box(0, 0, 40, 40), box(5, 5, 35, 35), box(15, 15, 25, 25)]);
    expect(count(m)).toBe(1600 - 900 + 100);
    expect(at(m, 20.5, 20.5)).toBe(1);
    expect(at(m, 10.5, 10.5)).toBe(0);
  });

  it('fills a triangle with area close to the analytic value', () => {
    const tri: Ring = [
      [0, 0],
      [60, 0],
      [0, 60],
      [0, 0],
    ];
    const n = count(mask([tri]));
    expect(Math.abs(n - 1800)).toBeLessThanOrEqual(60);
  });

  it('does not double count at shared vertices (half-open rows)', () => {
    // A diamond whose top and bottom vertices lie exactly on row centres.
    const d: Ring = [
      [0, 10.5],
      [10, 20.5],
      [20, 10.5],
      [10, 0.5],
      [0, 10.5],
    ];
    const m = mask([d]);
    // symmetric about the middle column
    for (let y = 0; y < H; y++) {
      let left = 0;
      let right = 0;
      for (let x = 0; x < W; x++) {
        if (m[y * W + x]) {
          if (x < 190) left++;
          else right++;
        }
      }
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    }
    expect(count(m)).toBeGreaterThan(80);
  });

  it('unwraps a ring that crosses the antimeridian and fills both sides', () => {
    // Fiji-like shape written with a jump of 340 degrees: 175 .. -175.
    const ring: Ring = [
      [175, -20],
      [-175, -20],
      [-175, -10],
      [175, -10],
      [175, -20],
    ];
    expect(unwrapRing(ring)).not.toBeNull();
    const m = mask([ring]);
    expect(count(m)).toBe(10 * 10); // 5 degrees on each side of the seam, 10 degrees of latitude
    expect(at(m, 178.5, -15.5)).toBe(1);
    expect(at(m, -178.5, -15.5)).toBe(1);
    expect(at(m, 0.5, -15.5)).toBe(0);
  });

  it('a ring closed along the pole (Antarctica style) is not treated as an antimeridian crossing', () => {
    const ring: Ring = [
      [-180, -70],
      [-90, -70],
      [0, -70],
      [90, -70],
      [180, -70],
      [180, -90],
      [-180, -90],
      [-180, -70],
    ];
    expect(unwrapRing(ring)).toBeNull();
    const m = mask([ring]);
    expect(count(m)).toBe(360 * 20);
  });

  it('a ring without a jump is left alone', () => {
    expect(unwrapRing(box(-10, -10, 10, 10))).toBeNull();
  });

  it('reports spans through the sink and flattens MultiPolygon geometries', () => {
    const geom = { type: 'MultiPolygon', coordinates: [[box(0, 0, 4, 4)], [box(10, 10, 12, 14)]] };
    const rings = geometryRings(geom);
    expect(rings.length).toBe(2);
    let spans = 0;
    fillPolygon(rings, W, H, () => spans++);
    expect(spans).toBe(4 + 4);
  });
});

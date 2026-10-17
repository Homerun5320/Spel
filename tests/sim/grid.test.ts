import fc from 'fast-check';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Grid, rowCosFromLut, DIR_E, DIR_N, DIR_S, DIR_W } from '../../src/sim/grid';
import { WEIGHT_ONE } from '../../src/sim/rules';
import { CLASS_PLAINS } from '../../src/sim/terrain';

const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8')) as { sim: { cosQ15: number[] }; counts: { classes: Record<string, number> } };

function plainGrid(w: number, h: number): Grid {
  return new Grid(w, h, new Uint8Array(w * h).fill(CLASS_PLAINS), rowCosFromLut(h));
}

describe('Grid: addressing and neighbours', () => {
  const g = plainGrid(5, 4);
  const out = new Int32Array(4);

  it('an interior cell has four neighbours in the order north, east, south, west', () => {
    const c = g.cellAt(2, 1);
    expect(g.neighbours(c, out)).toBe(4);
    expect(Array.from(out)).toEqual([g.cellAt(2, 0), g.cellAt(3, 1), g.cellAt(2, 2), g.cellAt(1, 1)]);
    expect([g.neighbour(c, DIR_N), g.neighbour(c, DIR_E), g.neighbour(c, DIR_S), g.neighbour(c, DIR_W)]).toEqual(Array.from(out));
  });

  it('x wraps around the world in both directions, y does not', () => {
    const left = g.cellAt(0, 2);
    const right = g.cellAt(4, 2);
    expect(g.neighbour(left, DIR_W)).toBe(right);
    expect(g.neighbour(right, DIR_E)).toBe(left);
    expect(g.neighbour(g.cellAt(3, 0), DIR_N)).toBe(-1);
    expect(g.neighbour(g.cellAt(3, 3), DIR_S)).toBe(-1);
    expect(g.neighbours(g.cellAt(0, 0), out)).toBe(3);
    expect(Array.from(out.subarray(0, 3))).toEqual([g.cellAt(1, 0), g.cellAt(0, 1), g.cellAt(4, 0)]);
    expect(g.cellAt(-1, 1)).toBe(g.cellAt(4, 1));
    expect(g.cellAt(5, 1)).toBe(g.cellAt(0, 1));
    expect(g.cellAt(-6, 1)).toBe(g.cellAt(4, 1));
  });

  it('neighbourhood is symmetric on random worlds, and neighbours() agrees with neighbour()', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 20 }), fc.integer({ min: 2, max: 12 }), fc.nat(), (w, h, k) => {
        const grid = plainGrid(w, h);
        const buf = new Int32Array(4);
        const cell = k % (w * h);
        const n = grid.neighbours(cell, buf);
        const direct: number[] = [];
        for (const d of [DIR_N, DIR_E, DIR_S, DIR_W]) {
          const x = grid.neighbour(cell, d);
          if (x >= 0) direct.push(x);
        }
        expect(Array.from(buf.subarray(0, n))).toEqual(direct);
        const back = new Int32Array(4);
        for (let i = 0; i < n; i++) {
          const m = grid.neighbours(buf[i] as number, back);
          expect(Array.from(back.subarray(0, m))).toContain(cell);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('distance2 takes the short way round the world', () => {
    expect(g.distance2(g.cellAt(0, 1), g.cellAt(4, 1))).toBe(1);
    expect(g.distance2(g.cellAt(0, 0), g.cellAt(2, 3))).toBe(4 + 9);
    expect(g.distance2(g.cellAt(1, 1), g.cellAt(1, 1))).toBe(0);
    const big = new Grid(1024, 512, new Uint8Array(1024 * 512), rowCosFromLut(512)); // all sea: the geometry does not care
    expect(big.distance2(big.cellAt(1023, 100), big.cellAt(2, 100))).toBe(9);
    expect(big.distance2(big.cellAt(0, 0), big.cellAt(512, 0))).toBe(512 * 512);
  });
});

describe('Grid: cos(lat) weights and cell sizes', () => {
  it('the integer-sine row table agrees with the committed cos table of the real world within 2 Q15 units', () => {
    const lut = rowCosFromLut(512);
    expect(meta.sim.cosQ15.length).toBe(512);
    let worst = 0;
    for (let y = 0; y < 512; y++) worst = Math.max(worst, Math.abs((lut[y] as number) - (meta.sim.cosQ15[y] as number)));
    console.log(`[grid] worst difference between the LUT cos rows and the committed table: ${worst} Q15 units`);
    expect(worst).toBeLessThanOrEqual(2);
  });

  it('the committed table is the weight: 1.0 at the equator, near 0 at the poles, symmetric, never rising away from the equator', () => {
    const rows = Uint16Array.from(meta.sim.cosQ15);
    const g = new Grid(1024, 512, new Uint8Array(1024 * 512), rows);
    expect(g.weight(g.cellAt(0, 255))).toBe(WEIGHT_ONE);
    expect(g.weight(g.cellAt(7, 0))).toBeLessThan(200);
    for (let y = 0; y < 256; y++) {
      expect(rows[y]).toBe(rows[511 - y]);
      if (y > 0) expect(rows[y] as number).toBeGreaterThanOrEqual(rows[y - 1] as number);
    }
  });

  it('cellKm: about 39 km east-west at the equator, about half at 60 degrees, almost nothing at the pole', () => {
    const g = new Grid(1024, 512, new Uint8Array(1024 * 512), Uint16Array.from(meta.sim.cosQ15));
    expect(g.cellKm(255)).toBeGreaterThan(39.0);
    expect(g.cellKm(255)).toBeLessThan(39.2);
    expect(g.cellHeightM()).toBeGreaterThan(39000);
    expect(g.cellHeightM()).toBeLessThan(39200);
    const row60 = 256 - Math.round((60 / 180) * 512); // latitude 60 N
    expect(g.cellKm(row60) / g.cellKm(255)).toBeGreaterThan(0.48);
    expect(g.cellKm(row60) / g.cellKm(255)).toBeLessThan(0.52);
    expect(g.cellKm(0)).toBeLessThan(0.2);
    expect(g.cellWidthM(255)).toBe(Math.floor(g.cellKm(255) * 1000));
  });

  it('refuses a world whose playable weights would overflow the 32-bit per-owner sums', () => {
    const cells = 2048 * 2048;
    expect(() => new Grid(2048, 2048, new Uint8Array(cells).fill(CLASS_PLAINS), new Uint16Array(2048).fill(WEIGHT_ONE))).toThrow(RangeError);
  });
});

describe('Grid: playable cells', () => {
  it('only Plains, Forest, Hills and Mountain are playable', () => {
    const terrain = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 255]);
    const g = new Grid(10, 1, terrain, new Uint16Array([WEIGHT_ONE]));
    expect(Array.from(g.playable)).toEqual([0, 0, 1, 1, 1, 1, 0, 0, 0, 0]);
    expect(g.playableCells).toBe(4);
    expect(g.totalWeight).toBe(4 * WEIGHT_ONE);
  });
});

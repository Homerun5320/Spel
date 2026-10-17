// Fix-5A3 (audit 4, finding 2.8): NationCentroids on hand-built grids: a nation in the eastern half of the map (the circular mean must not come out negative), the western half,
// a nation across the date line, the cell counts and anchorCell's order (centre cell, then the capital, then the centre cell again).
import { describe, expect, it } from 'vitest';
import { NationCentroids } from '../../src/app/nationCentroids';

const W = 64;
const H = 8;

function grid(fill: (owner: Uint16Array) => void, slots = 6): { nc: NationCentroids; owner: Uint16Array } {
  const owner = new Uint16Array(W * H);
  fill(owner);
  const nc = new NationCentroids(slots, W, H);
  nc.compute(owner);
  return { nc, owner };
}
const rect = (owner: Uint16Array, id: number, x0: number, x1: number, y0: number, y1: number): void => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) owner[y * W + x] = id;
};
/** Distance of two x positions on the wrapping axis. */
const wrapDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % W;
  return Math.min(d, W - d);
};

describe('NationCentroids', () => {
  it('puts a nation of the eastern half (x 40..44) at x 42.5, not at a negative number, and a western one (x 10..14) at 12.5', () => {
    const { nc } = grid((o) => {
      rect(o, 1, 40, 44, 2, 3);
      rect(o, 2, 10, 14, 5, 6);
    });
    expect(nc.cx[1]).toBeGreaterThan(0);
    expect(nc.cx[1]).toBeCloseTo(42.5, 1);
    expect(nc.cy[1]).toBeCloseTo(3, 3); // rows 2 and 3: mean 2.5, plus the half cell
    expect(nc.cx[2]).toBeCloseTo(12.5, 1);
    expect(nc.cy[2]).toBeCloseTo(6, 3);
    expect(Array.from(nc.count.subarray(0, 3))).toEqual([0, 10, 10]);
  });

  it('takes the mean round the date line for a nation on both sides of it', () => {
    const g = grid((o) => {
      rect(o, 3, 62, 63, 1, 1);
      rect(o, 3, 0, 1, 1, 1);
    });
    expect(wrapDist(g.nc.cx[3] as number, 0)).toBeLessThan(0.05); // centre of x 62..1 is the date line (x = 0 = 64), never the middle of the map
    expect(g.nc.cx[3]).toBeGreaterThanOrEqual(0);
    expect(g.nc.cx[3]).toBeLessThanOrEqual(W);
  });

  it('ignores unowned cells and ownerIds beyond the slots', () => {
    const { nc } = grid((o) => {
      rect(o, 9, 5, 6, 0, 0);
      rect(o, 1, 20, 20, 0, 0);
    });
    expect(nc.count[1]).toBe(1);
    expect(nc.count.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('anchors a label on the centre cell when the owner holds it, else on the capital, else on the centre cell; -1 without land', () => {
    const { nc, owner } = grid((o) => {
      rect(o, 1, 40, 44, 2, 3); // compact: the centre cell is its own
      rect(o, 2, 3, 6, 3, 3); // two blobs: x 3..6 and 56..59 (centre on the date line side, off the land)
      rect(o, 2, 56, 59, 3, 3);
    });
    const centre1 = 3 * W + 42; // y = floor(3.0) = 3 and x = floor(42.5) = 42
    expect(owner[centre1]).toBe(1);
    const capitalElsewhere = 2 * W + 40; // also owner 1's: the centre cell still wins
    expect(nc.anchorCell(1, owner, capitalElsewhere)).toBe(centre1);
    expect(nc.anchorCell(1, owner, -1)).toBe(centre1);
    // owner 2's centre lies between the blobs, on no land of its own
    const cx = Math.min(W - 1, Math.floor(nc.cx[2] as number));
    const centre2 = Math.min(H - 1, Math.floor(nc.cy[2] as number)) * W + cx;
    expect(owner[centre2]).not.toBe(2);
    const capital2 = 3 * W + 4;
    expect(nc.anchorCell(2, owner, capital2)).toBe(capital2); // the capital is the owner's
    expect(nc.anchorCell(2, owner, 3 * W + 30)).toBe(centre2); // a capital cell that is not the owner's: back to the centre
    expect(nc.anchorCell(2, owner, -1)).toBe(centre2);
    expect(nc.anchorCell(4, owner, 5)).toBe(-1);
  });
});

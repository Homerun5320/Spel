// M13c-1: the sea route (src/sim/shipRoute.ts): around an island, through a one-cell strait, over the date line, no route, the work limit, the waypoint cap, no corner cutting,
// and a stable tie-break. The maps are hand-made terrain arrays (0 = deep sea, 2 = plains).
import { describe, expect, it } from 'vitest';
import { SHIP_LAND_REACH_CELLS, SHIP_ROUTE_CAPACITY, SHIP_ROUTE_MAX_CELLS } from '../../src/sim/rules';
import { SHIP_ROUTE_BAD_TARGET, SHIP_ROUTE_NONE, SHIP_ROUTE_OK, ShipRoute, findShipRoute, hasWaterWithinReach, portWaterCell } from '../../src/sim/shipRoute';

const SEA = 0;
const LAND = 2;

/** A map with a land column at both edges (so that no route can use the wrap over the date line unless a test wants it: `wrap = true`). */
function map(w: number, h: number, fill: number = SEA, wrap = false): { w: number; h: number; t: Uint8Array; at: (x: number, y: number) => number; land: (x0: number, y0: number, x1: number, y1: number) => void } {
  const t = new Uint8Array(w * h).fill(fill);
  if (!wrap) for (let y = 0; y < h; y++) {
    t[y * w] = LAND;
    t[y * w + w - 1] = LAND;
  }
  return {
    w,
    h,
    t,
    at: (x, y) => y * w + x,
    land: (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t[y * w + x] = LAND;
    },
  };
}

function route(m: ReturnType<typeof map>, start: number, target: number): { why: number; r: ShipRoute; cells: number[] } {
  const r = new ShipRoute();
  const why = findShipRoute(m.w, m.h, m.t, start, target, r);
  return { why, r, cells: Array.from(r.cells.subarray(0, r.count)) };
}

describe('the sea route', () => {
  it('open sea: a straight line of two waypoints, from the start to the first cell within reach of the target', () => {
    const m = map(128, 32);
    m.land(40, 10, 40, 10); // the target is a land cell
    const { why, r, cells } = route(m, m.at(2, 10), m.at(40, 10));
    expect(why).toBe(SHIP_ROUTE_OK);
    expect(cells).toEqual([m.at(2, 10), m.at(40 - SHIP_LAND_REACH_CELLS, 10)]);
    expect(r.pathCells).toBe(40 - SHIP_LAND_REACH_CELLS - 2 + 1);
  });

  it('round an island: the route bends past its corner and every waypoint is sea', () => {
    const m = map(128, 32);
    m.land(20, 5, 24, 25); // a wall of an island across the straight line
    m.land(50, 14, 50, 14); // the target on the far shore
    const { why, cells, r } = route(m, m.at(5, 14), m.at(50, 14));
    expect(why).toBe(SHIP_ROUTE_OK);
    expect(r.pathCells).toBeGreaterThanOrEqual(44); // never shorter than the straight way (43 steps to x = 48)
    expect(cells.length).toBeGreaterThanOrEqual(3);
    for (const c of cells) expect(m.t[c]).toBe(SEA);
    // the route passes the island above its top (y < 5) or below its bottom (y > 25)
    expect(cells.some((c) => c % 128 >= 20 && c % 128 <= 24 && (Math.floor(c / 128) < 5 || Math.floor(c / 128) > 25))).toBe(true);
  });

  it('through a one-cell strait: the route goes through the gap of a wall that is otherwise unbroken', () => {
    const m = map(128, 32);
    m.land(30, 0, 30, 31);
    m.t[m.at(30, 17)] = SEA; // the strait
    m.land(60, 17, 60, 17);
    const { why, cells } = route(m, m.at(4, 4), m.at(60, 17));
    expect(why).toBe(SHIP_ROUTE_OK);
    // two consecutive waypoints lie on the two sides of the wall and the line between them crosses it in the gap (row 17)
    let crossed = false;
    for (let i = 0; i + 1 < cells.length; i++) {
      const ax = (cells[i] as number) % 128;
      const ay = Math.floor((cells[i] as number) / 128);
      const bx = (cells[i + 1] as number) % 128;
      const by = Math.floor((cells[i + 1] as number) / 128);
      if (ax < 30 && bx > 30) {
        crossed = true;
        expect(Math.round(ay + ((by - ay) * (30 - ax)) / (bx - ax))).toBe(17);
      }
    }
    expect(crossed).toBe(true);
  });

  it('a diagonal gap between two land corners is no way through (no corner cutting)', () => {
    const m = map(32, 32);
    for (let i = 0; i < 32; i++) m.t[m.at(i, i)] = LAND; // a diagonal wall: every sea cell on one side touches the other side only at a corner
    m.land(28, 3, 28, 3);
    m.land(0, 0, 31, 0); // and the top and bottom rows are land too (a row cannot be walked round)
    m.land(0, 31, 31, 31);
    // start below the diagonal, target above it
    const { why } = route(m, m.at(3, 20), m.at(28, 3));
    expect(why).toBe(SHIP_ROUTE_NONE);
  });

  it('over the date line: the short way round the edge of the map (x wraps)', () => {
    const m = map(64, 16, SEA, true);
    m.land(60, 8, 60, 8);
    const { why, r, cells } = route(m, m.at(2, 8), m.at(60, 8));
    expect(why).toBe(SHIP_ROUTE_OK);
    expect(r.pathCells).toBe(5); // x 2, 1, 0, 63, 62
    expect(cells).toEqual([m.at(2, 8), m.at(62, 8)]);
  });

  it('no route: a target walled in by land from the sea, an unreachable sea, and a target with no water within reach', () => {
    const m = map(64, 32);
    m.land(0, 15, 63, 15); // a land band across the whole map: the north sea and the south sea are separate
    m.land(40, 25, 40, 25);
    expect(route(m, m.at(10, 3), m.at(40, 25)).why).toBe(SHIP_ROUTE_NONE);
    expect(route(m, m.at(10, 20), m.at(40, 25)).why).toBe(SHIP_ROUTE_OK); // the same target from its own sea
    const inland = map(64, 32, LAND, true);
    inland.t[inland.at(5, 5)] = SEA;
    expect(route(inland, inland.at(5, 5), inland.at(50, 20)).why).toBe(SHIP_ROUTE_BAD_TARGET);
    expect(hasWaterWithinReach(64, 32, inland.t, inland.at(5, 5 + SHIP_LAND_REACH_CELLS))).toBe(true);
    expect(hasWaterWithinReach(64, 32, inland.t, inland.at(5, 5 + SHIP_LAND_REACH_CELLS + 1))).toBe(false);
  });

  it('the work limit: a sea that needs more than SHIP_ROUTE_MAX_CELLS expansions is refused, the same sea with a near gap is not', () => {
    const w = 512;
    const h = 256;
    const far = map(w, h);
    far.land(256, 0, 256, 254); // a wall with its only gap at the very bottom
    far.land(400, 10, 400, 10);
    const a = route(far, far.at(100, 10), far.at(400, 10));
    expect(a.why).toBe(SHIP_ROUTE_NONE);
    expect(a.r.expanded).toBeGreaterThan(SHIP_ROUTE_MAX_CELLS);
    const near = map(w, h);
    near.land(256, 0, 256, 254);
    near.t[near.at(256, 10)] = SEA; // a gap on the straight line
    near.land(400, 10, 400, 10);
    const b = route(near, near.at(100, 10), near.at(400, 10));
    expect(b.why).toBe(SHIP_ROUTE_OK);
    expect(b.r.expanded).toBeLessThan(SHIP_ROUTE_MAX_CELLS);
  });

  it('the waypoint cap: a channel that winds more than SHIP_ROUTE_CAPACITY times is refused, a short winding one is not', () => {
    const snake = (rows: number): { m: ReturnType<typeof map>; start: number; target: number } => {
      const m = map(40, rows * 2 + 4, LAND);
      let y = 2;
      for (let k = 0; k < rows; k++, y += 2) {
        for (let x = 4; x <= 34; x++) m.t[m.at(x, y)] = SEA; // a long row
        if (k < rows - 1) m.t[m.at(k % 2 === 0 ? 34 : 4, y + 1)] = SEA; // the one-cell step to the next row, alternating ends
      }
      return { m, start: m.at(4, 2), target: m.at(36, y - 2) };
    };
    const winding = snake(40); // about 80 corners
    const w = route(winding.m, winding.start, winding.target);
    expect(w.why).toBe(SHIP_ROUTE_NONE);
    expect(w.r.expanded).toBeLessThan(SHIP_ROUTE_MAX_CELLS); // it was the cap, not the work limit
    const gentle = snake(10); // about 20 corners
    const g = route(gentle.m, gentle.start, gentle.target);
    expect(g.why).toBe(SHIP_ROUTE_OK);
    expect(g.cells.length).toBeLessThanOrEqual(SHIP_ROUTE_CAPACITY);
    expect(g.cells.length).toBeGreaterThan(15);
  });

  it('ties go to the lower cell index and the result does not change between calls: a single land cell on the straight line is passed on the NORTH side', () => {
    const m = map(128, 24);
    m.land(24, 12, 24, 12);
    m.land(40, 12, 40, 12); // the target, with the single land cell exactly between start and target
    const a = route(m, m.at(8, 12), m.at(40, 12));
    const b = route(m, m.at(8, 12), m.at(40, 12));
    expect(a.cells).toEqual(b.cells);
    expect(a.why).toBe(SHIP_ROUTE_OK);
    // PINNED: the goal cells within reach are the 5 x 5 square round the target; the cheapest are (38, 11) and (38, 13) (the straight way to row 12 is blocked), equally dear: the lower cell index, the NORTH one, wins
    expect(a.cells.map((c) => [c % 128, Math.floor(c / 128)])).toEqual([[8, 12], [38, 11]]);
  });

  it('portWaterCell: the lowest-index sea neighbour; none for an inland cell; the east edge wraps', () => {
    const m = map(16, 8, LAND);
    m.t[m.at(5, 3)] = SEA; // east of (4,3)
    m.t[m.at(4, 4)] = SEA; // south of (4,3)
    expect(portWaterCell(16, 8, m.t, m.at(4, 3))).toBe(m.at(5, 3)); // east (index 53) comes before south (index 68)
    expect(portWaterCell(16, 8, m.t, m.at(10, 6))).toBe(-1);
    const e = map(16, 8, LAND);
    e.t[e.at(0, 2)] = SEA;
    expect(portWaterCell(16, 8, e.t, e.at(15, 2))).toBe(e.at(0, 2));
  });
});

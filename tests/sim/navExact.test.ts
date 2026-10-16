// Fix-3A2: planRoute against an EXACT search (Dijkstra with the same step costs) on small random grids and on the real nav grid, plus the
// behaviours of the route search and the landing-zone check that no other test locked: the corner-cutting ban, lambda 1 versus 3, the
// ceiling term, the cheap straight-distance OUT_OF_FUEL check and the second one on the planned route. Each "kills:" comment names the
// mutant (one changed line in src/sim/nav) that turns the test red; the table is in docs/DECISIONS.md (Fix-3A2).
import { beforeAll, describe, expect, it } from 'vitest';
import { rowCosFromLut } from '../../src/sim/grid';
import { ALT_MODE_HIGH, ALT_MODE_LOW, createLos, type AltMode } from '../../src/sim/los/cache';
import { createLosTerrain } from '../../src/sim/los/terrain';
import { createNav, type Nav } from '../../src/sim/nav/grid';
import { LZ_NO_ROUTE, LZ_OK, LZ_OUT_OF_FUEL, scoreLz } from '../../src/sim/nav/lz';
import { planRoute, type NavView } from '../../src/sim/nav/route';
import {
  AIR_CEILING_COST_PCT,
  AIR_CEILING_MARGIN_M,
  AIR_CLIMB_COST_PCT_PER_KM_M,
  AIR_EXPOSURE_LAMBDA,
  AIR_MODE_AGL_M,
  AIR_ROUTE_WEIGHT_PCT,
  HELI_FUEL_CELLS,
  NAV_BLOCK_CELLS,
  SERVICE_CEILING_M,
} from '../../src/sim/rules';
import { createEmptyState } from '../../src/sim/state';
import { STRUCT_POST } from '../../src/sim/structureRules';
import { CLASS_PEAK, CLASS_PLAINS } from '../../src/sim/terrain';
import { loadRealLos, type RealLos } from '../../tools/sim/losWorld';

const B = NAV_BLOCK_CELLS;
const BOUND = AIR_ROUTE_WEIGHT_PCT / 100;
const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

// ---- the oracle: the same step costs as planRoute, searched exhaustively ----

function exposedNav(nav: Nav, seat: number, n: number, mode: AltMode): number {
  const cell = nav.lowCell[n] as number;
  const owners: number[] = [];
  nav.los.sensorOwners(owners);
  for (const o of owners) {
    if (o === seat + 1) continue;
    if (nav.los.detected(o, cell, mode) || nav.los.inPostRadius(o, cell)) return 1;
  }
  return 0;
}

/** Cost of the step n -> m, or -1 when the step is not allowed (closed cell, corner cut, not a neighbour). */
function stepCost(nav: Nav, seat: number, mode: AltMode, lambda: number, n: number, m: number): number {
  const W = nav.width;
  const nx = n % W;
  const ny = (n - nx) / W;
  const mx = m % W;
  const my = (m - mx) / W;
  let dx = mx - nx;
  if (dx > 1) dx -= W;
  else if (dx < -1) dx += W;
  const dy = my - ny;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return -1;
  const blocked = nav.blocked[mode] as Uint8Array;
  if (blocked[m] === 1 || blocked[n] === 1) return -1;
  if (dx !== 0 && dy !== 0 && (blocked[ny * W + mx] === 1 || blocked[my * W + nx] === 1)) return -1;
  const wkm = ((nav.wKm[ny] as number) + (nav.wKm[my] as number)) * 0.5;
  const km = dy === 0 ? wkm : dx === 0 ? nav.hKm : Math.sqrt(wkm * wkm + nav.hKm * nav.hKm);
  const nearCeiling = SERVICE_CEILING_M - AIR_CEILING_MARGIN_M - (AIR_MODE_AGL_M[mode] as number);
  let factor = 1 + Math.abs((nav.meanM[m] as number) - (nav.meanM[n] as number)) * (AIR_CLIMB_COST_PCT_PER_KM_M / 100 / 1000);
  if ((nav.meanM[m] as number) > nearCeiling) factor += AIR_CEILING_COST_PCT / 100;
  if (lambda > 0) factor += lambda * exposedNav(nav, seat, m, mode);
  return km * factor;
}

/** Cost of a nav path, or -1 when it is not a legal path from a to b. */
function pathCost(nav: Nav, seat: number, mode: AltMode, lambda: number, cells: readonly number[], a: number, b: number): number {
  if (cells[0] !== a || cells[cells.length - 1] !== b) return -1;
  let sum = 0;
  for (let i = 1; i < cells.length; i++) {
    const c = stepCost(nav, seat, mode, lambda, cells[i - 1] as number, cells[i] as number);
    if (c < 0) return -1;
    sum += c;
  }
  return sum;
}

/** Plain Dijkstra with a binary heap. Infinity when b cannot be reached. */
function dijkstra(nav: Nav, seat: number, mode: AltMode, lambda: number, a: number, b: number): number {
  const W = nav.width;
  const H = nav.height;
  const dist = new Float64Array(W * H).fill(Infinity);
  const done = new Uint8Array(W * H);
  const heap: Array<[number, number]> = [[0, a]];
  dist[a] = 0;
  const push = (item: [number, number]): void => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] as [number, number])[0] <= item[0]) break;
      heap[i] = heap[p] as [number, number];
      i = p;
    }
    heap[i] = item;
  };
  const pop = (): [number, number] => {
    const top = heap[0] as [number, number];
    const last = heap.pop() as [number, number];
    if (heap.length > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && (heap[c + 1] as [number, number])[0] < (heap[c] as [number, number])[0]) c++;
        if ((heap[c] as [number, number])[0] >= last[0]) break;
        heap[i] = heap[c] as [number, number];
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  while (heap.length > 0) {
    const [d, n] = pop();
    if (done[n] === 1) continue;
    done[n] = 1;
    if (n === b) return d;
    const nx = n % W;
    const ny = (n - nx) / W;
    for (let k = 0; k < 8; k++) {
      const my = ny + (DY[k] as number);
      if (my < 0 || my >= H) continue;
      const m = my * W + ((nx + (DX[k] as number) + W) % W);
      const c = stepCost(nav, seat, mode, lambda, n, m);
      if (c < 0 || d + c >= (dist[m] as number)) continue;
      dist[m] = d + c;
      push([d + c, m]);
    }
  }
  return Infinity;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Fixture {
  nav: Nav;
  view: NavView;
}

/** A small world (128 x 64 sim cells = 32 x 16 nav cells) with per-nav-cell classes and heights from `cellOf(nx, ny)`. */
function build(cellOf: (nx: number, ny: number) => { cls: number; mean: number }, W = 128, H = 64, sites?: (f: Fixture) => void): Fixture {
  const cls = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const mean = new Int16Array(W * H).fill(1);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = cellOf(Math.floor(x / B), Math.floor(y / B));
      cls[y * W + x] = c.cls;
      mean[y * W + x] = c.mean;
    }
  const los = createLos(createLosTerrain(W, H, rowCosFromLut(H), mean, mean));
  const nav = createNav({ width: W, height: H, terrainClass: cls, meanElev: mean }, los);
  const state = createEmptyState(W, H, 1, 3);
  const f: Fixture = { nav, view: { tick: 1_000_000, structures: state.structures, terrainClass: cls, seats: 3 } };
  sites?.(f);
  return f;
}

const open = (mean = 1): { cls: number; mean: number } => ({ cls: CLASS_PLAINS, mean });
const wall = (): { cls: number; mean: number } => ({ cls: CLASS_PEAK, mean: 1 });
const nc = (f: Fixture, x: number, y: number): number => y * f.nav.width + x;
const center = (f: Fixture, n: number): number => f.nav.centerOf(n);

function check(f: Fixture, seat: number, mode: AltMode, lambda: number, a: number, b: number): { ratio: number; ok: boolean } {
  f.nav.los.sync(f.view);
  const opt = dijkstra(f.nav, seat, mode, lambda, a, b);
  const r = planRoute(f.nav, f.view, seat, center(f, a), center(f, b), mode, lambda);
  expect(r.ok, `reachability ${a} -> ${b}`).toBe(opt !== Infinity);
  if (!r.ok) return { ratio: 1, ok: false };
  const cost = pathCost(f.nav, seat, mode, lambda, r.navCells, a, b);
  expect(cost, `a legal path ${a} -> ${b} (no closed cell, no corner cut)`).toBeGreaterThanOrEqual(0);
  expect(cost).toBeGreaterThanOrEqual(opt - 1e-6);
  return { ratio: opt === 0 ? 1 : cost / opt, ok: true };
}

describe('planRoute against an exhaustive search (Dijkstra)', () => {
  it('random small worlds: every route is legal and costs at most AIR_ROUTE_WEIGHT_PCT / 100 times the optimum (both modes, lambda 0 and 3, sensors present)', () => {
    // kills: nav-r-corner (delete the corner-cut line: illegal paths), heuristic mutants that overestimate (ratio > 1.3), nav-r-lambda-scale
    const rand = rng(20260509);
    const nearCeiling = SERVICE_CEILING_M - AIR_CEILING_MARGIN_M - (AIR_MODE_AGL_M[0] as number);
    const heights = [1, 1, 1, 600, 2500, nearCeiling + 100, 6100];
    let worst = 1;
    let routes = 0;
    for (let w = 0; w < 24; w++) {
      const table = Array.from({ length: 32 * 16 }, () => {
        const r = rand();
        return r < 0.12 ? wall() : open(heights[Math.floor(rand() * heights.length)] as number);
      });
      const f = build(
        (nx, ny) => table[ny * 32 + nx] as { cls: number; mean: number },
        128,
        64,
        (fx) => {
          fx.nav.los.addSite(2, 20 * B * 128 + 40, 6);
          fx.view.structures.add(STRUCT_POST, 2, (7 * B) * 128 + 90, 0);
        },
      );
      for (let q = 0; q < 8; q++) {
        const a = Math.floor(rand() * f.nav.width * f.nav.height);
        const b = Math.floor(rand() * f.nav.width * f.nav.height);
        const mode: AltMode = q % 2 === 0 ? ALT_MODE_LOW : ALT_MODE_HIGH;
        if ((f.nav.blocked[mode] as Uint8Array)[a] === 1 || (f.nav.blocked[mode] as Uint8Array)[b] === 1 || a === b) continue;
        const lambda = q % 4 < 2 ? 0 : AIR_EXPOSURE_LAMBDA;
        const res = check(f, 0, mode, lambda, a, b);
        if (res.ok) {
          routes++;
          worst = Math.max(worst, res.ratio);
          expect(res.ratio, `world ${w} query ${q}`).toBeLessThanOrEqual(BOUND + 1e-9);
        }
      }
    }
    console.log(`[navExact] ${routes} random-world routes, worst cost ratio ${worst.toFixed(3)} (bound ${BOUND})`);
    expect(routes).toBeGreaterThan(60);
  });

  let real: RealLos;
  beforeAll(async () => {
    real = await loadRealLos();
  });

  it('the real 256 x 128 nav grid: 60 seeded pairs over all latitudes stay within the bound and are legal paths (Low, lambda 0)', () => {
    const los = createLos(real.terrain);
    const nav = createNav({ width: 1024, height: 512, terrainClass: real.terrainClass, meanElev: real.meanElev }, los);
    const state = createEmptyState(1024, 512, 1, 2);
    const f: Fixture = { nav, view: { tick: 0, structures: state.structures, terrainClass: real.terrainClass, seats: 2 } };
    const rand = rng(99);
    let worst = 1;
    let n = 0;
    for (let guard = 0; guard < 4000 && n < 60; guard++) {
      const ay = Math.floor(rand() * nav.height);
      const by = Math.min(nav.height - 1, Math.max(0, ay + Math.floor((rand() - 0.5) * 24)));
      const a = ay * nav.width + Math.floor(rand() * nav.width);
      const b = by * nav.width + ((a % nav.width) + Math.floor((rand() - 0.5) * 60) + nav.width) % nav.width;
      const label = nav.airLabel[0] as Int32Array;
      if (a === b || (label[a] as number) < 0 || label[a] !== label[b]) continue;
      const res = check(f, 0, ALT_MODE_LOW, 0, a, b);
      if (!res.ok) continue;
      n++;
      worst = Math.max(worst, res.ratio);
      expect(res.ratio).toBeLessThanOrEqual(BOUND + 1e-9);
    }
    console.log(`[navExact] real grid: ${n} routes, worst cost ratio ${worst.toFixed(3)}`);
    expect(n).toBe(60);
  });
});

describe('route behaviours locked by a fixture each', () => {
  it('no corner cutting: two open cells that touch only diagonally are not joined by one step', () => {
    // kills: nav-r-corner (delete the corner-cut check in planRoute)
    const f = build((nx, ny) => ((nx === 11 && ny === 8) || (nx === 10 && ny === 7) ? wall() : open()));
    const a = nc(f, 10, 8);
    const b = nc(f, 11, 7);
    const r = planRoute(f.nav, f.view, 0, center(f, a), center(f, b), ALT_MODE_LOW, 0);
    if (!r.ok) throw new Error('no route');
    expect(r.navCells.length).toBeGreaterThan(2);
    expect(pathCost(f.nav, 0, ALT_MODE_LOW, 0, r.navCells, a, b)).toBeGreaterThan(0);
  });

  // Two walls at nav columns 16 and 28 close the world into a band; the wall at 16 has a gap A on the goal row (a Post disc makes it
  // exposed) and a gap B at the pole row 0. lambda 1 flies through A, lambda 3 takes the longer way through B.
  const gapWorld = (): Fixture =>
    build(
      (nx, ny) => (nx === 28 || (nx === 16 && ny !== 8 && ny !== 0) ? wall() : open()),
      128,
      64,
      (fx) => void fx.view.structures.add(STRUCT_POST, 2, (8 * B + 2) * 128 + 16 * B + 2, 0),
    );

  it('the exposure weight is scaled by lambda: lambda 1 crosses the watched gap, lambda 3 detours through the free one, each within the bound of its own optimum', () => {
    // kills: nav-r-lambda-scale ('factor += lambda * exposedAt' -> 'factor += exposedAt')
    const f = gapWorld();
    f.nav.los.sync(f.view);
    const a = nc(f, 8, 8);
    const b = nc(f, 20, 8);
    const one = planRoute(f.nav, f.view, 0, center(f, a), center(f, b), ALT_MODE_LOW, 1);
    const three = planRoute(f.nav, f.view, 0, center(f, a), center(f, b), ALT_MODE_LOW, AIR_EXPOSURE_LAMBDA);
    if (!one.ok || !three.ok) throw new Error('no route');
    expect(one.exposedCells).toBeGreaterThan(0);
    expect(three.exposedCells).toBe(0);
    expect(three.navCells.length).toBeGreaterThan(one.navCells.length);
    for (const [lambda, r] of [[1, one], [AIR_EXPOSURE_LAMBDA, three]] as const) {
      const opt = dijkstra(f.nav, 0, ALT_MODE_LOW, lambda, a, b);
      expect(pathCost(f.nav, 0, ALT_MODE_LOW, lambda, r.navCells, a, b)).toBeLessThanOrEqual(opt * BOUND + 1e-9);
    }
  });

  it('the ceiling term: a plateau just under the service ceiling is flown around, not across', () => {
    // kills: nav-r-ceil (delete the ceilK line)
    const near = SERVICE_CEILING_M - AIR_CEILING_MARGIN_M - (AIR_MODE_AGL_M[0] as number) + 200;
    // a plateau 7 columns wide and 9 rows tall in the middle of a flat world; the goal lies behind it
    const f = build((nx, ny) => (nx >= 12 && nx <= 18 && ny >= 3 && ny <= 11 ? open(near) : open(near - 1500)));
    const a = nc(f, 8, 7);
    const b = nc(f, 24, 7);
    const r = planRoute(f.nav, f.view, 0, center(f, a), center(f, b), ALT_MODE_LOW, 0);
    if (!r.ok) throw new Error('no route');
    const onPlateau = r.navCells.filter((n) => {
      const x = n % f.nav.width;
      const y = (n - x) / f.nav.width;
      return x >= 12 && x <= 18 && y >= 3 && y <= 11;
    });
    expect(onPlateau.length).toBe(0);
    const opt = dijkstra(f.nav, 0, ALT_MODE_LOW, 0, a, b);
    expect(pathCost(f.nav, 0, ALT_MODE_LOW, 0, r.navCells, a, b)).toBeLessThanOrEqual(opt * BOUND + 1e-9);
  });
});

describe('scoreLz: the two OUT_OF_FUEL checks and their order against NO_ROUTE', () => {
  const W = 512;
  const H = 128;
  const world = (cellOf: (nx: number, ny: number) => { cls: number; mean: number }): Fixture => build(cellOf, W, H);
  const at = (x: number, y: number): number => y * W + x;
  const score = (f: Fixture, cell: number, from: number) => scoreLz(f.nav, f.view, 0, cell, from, ALT_MODE_LOW);

  it('a sealed cell farther than HELI_FUEL_CELLS in a straight line is OUT_OF_FUEL, not NO_ROUTE (the cheap check comes first)', () => {
    // kills: lz-cheap-fuel-removed (delete the cellDistance > HELI_FUEL_CELLS check)
    const sx = 400 / B;
    const sy = 64 / B;
    const f = world((nx, ny) => (Math.max(Math.abs(nx - sx), Math.abs(ny - sy)) === 1 ? wall() : open()));
    const r = score(f, at(400 + 2, 64 + 2), at(100, 64));
    expect(Math.hypot(400 - 100, 0)).toBeGreaterThan(HELI_FUEL_CELLS);
    expect(r.reason).toBe(LZ_OUT_OF_FUEL);
    // the same sealed cell well inside the range is NO_ROUTE
    expect(score(f, at(400 + 2, 64 + 2), at(300, 64)).reason).toBe(LZ_NO_ROUTE);
  });

  it('a cell inside the straight range whose planned route is longer than HELI_FUEL_CELLS is OUT_OF_FUEL; a clear route to the same range is OK', () => {
    // kills: lz-fuel-route-removed (delete the route.fuelCells > HELI_FUEL_CELLS check)
    // a long N-S wall between start and goal with its only gap far away: the straight distance is 150, the way round is far more
    const gapRow = 30;
    const f = world((nx, ny) => (nx === 62 && ny !== gapRow ? wall() : open()));
    const from = at(200, 8 * B);
    const goal = at(350, 8 * B);
    expect(Math.hypot(150, 0)).toBeLessThan(HELI_FUEL_CELLS);
    expect(score(f, goal, from).reason).toBe(LZ_OUT_OF_FUEL);
    const g = world(() => open());
    expect(score(g, goal, from).reason).toBe(LZ_OK);
  });
});

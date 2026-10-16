// M11b: air navigation (nav grid, planRoute, scoreLz) on SYNTHETIC worlds (small, hand-made) and on the REAL 1024x512 world (Node only).
import { beforeAll, describe, expect, it } from 'vitest';
import { rowCosFromLut } from '../../src/sim/grid';
import { ALT_MODE_HIGH, ALT_MODE_LOW, createLos } from '../../src/sim/los/cache';
import { createLosTerrain } from '../../src/sim/los/terrain';
import { createNav, type Nav } from '../../src/sim/nav/grid';
import { navFingerprint } from '../../src/sim/nav/fingerprint';
import {
  LZ_ENEMY_CITY_NEAR,
  LZ_NO_ROUTE,
  LZ_OK,
  LZ_OUT_OF_FUEL,
  LZ_PEAK,
  LZ_STEEP,
  LZ_TERRAIN_CLASS,
  LZ_TOO_HIGH,
  LZ_WATER,
  scoreLz,
} from '../../src/sim/nav/lz';
import { planRoute, type NavView } from '../../src/sim/nav/route';
import { AIR_EXPOSURE_LAMBDA, AIR_MODE_AGL_M, HELI_FUEL_CELLS, NAV_BLOCK_CELLS, SERVICE_CEILING_M } from '../../src/sim/rules';
import { createEmptyState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_POST } from '../../src/sim/structureRules';
import { CLASS_FOREST, CLASS_HILLS, CLASS_ICE, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS, CLASS_SHALLOWS } from '../../src/sim/terrain';
import { cellAtLatLon, loadRealLos, type RealLos } from '../../tools/sim/losWorld';

const W = 512;
const H = 128;
const B = NAV_BLOCK_CELLS;
const at = (x: number, y: number): number => y * W + x;

interface Fixture {
  nav: Nav;
  view: NavView & { structures: ReturnType<typeof createEmptyState>['structures'] };
  cls: Uint8Array;
  mean: Int16Array;
  los: ReturnType<typeof createLos>;
}

/** A flat land world (mean 1 m, Plains); `edit` may change classes and heights BEFORE the nav grid is built. */
function world(edit?: (cls: Uint8Array, mean: Int16Array) => void): Fixture {
  const cls = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const mean = new Int16Array(W * H).fill(1);
  edit?.(cls, mean);
  const los = createLos(createLosTerrain(W, H, rowCosFromLut(H), mean, mean));
  const nav = createNav({ width: W, height: H, terrainClass: cls, meanElev: mean }, los);
  const state = createEmptyState(W, H, 1, 3);
  return { nav, los, cls, mean, view: { tick: 1_000_000, structures: state.structures, terrainClass: cls, seats: 3 } };
}

/** Fills the nav cell (nx, ny) with a class and/or height. */
function paint(cls: Uint8Array, mean: Int16Array, nx: number, ny: number, c: number | null, h: number | null): void {
  for (let dy = 0; dy < B; dy++)
    for (let dx = 0; dx < B; dx++) {
      const i = at(nx * B + dx, ny * B + dy);
      if (c !== null) cls[i] = c;
      if (h !== null) mean[i] = h;
    }
}

describe('flight modes and the service ceiling (synthetic)', () => {
  it('the mode table is data: Low is slower than High and a 60-cell flight takes 20 to 30 s in both', () => {
    const f = world();
    const lo = planRoute(f.nav, f.view, 0, at(100, 64), at(160, 64), ALT_MODE_LOW);
    const hi = planRoute(f.nav, f.view, 0, at(100, 64), at(160, 64), ALT_MODE_HIGH);
    if (!lo.ok || !hi.ok) throw new Error('no route');
    expect(lo.fuelCells).toBe(60);
    expect(hi.fuelCells).toBe(60);
    expect(hi.etaTicks).toBe(200);
    expect(lo.etaTicks).toBe(286);
    expect(lo.etaTicks).toBeGreaterThan(hi.etaTicks);
    expect(lo.etaTicks).toBeLessThanOrEqual(300);
  });

  it('real mean height + real AGL above the ceiling closes a cell; any Peak sim cell closes it in both modes', () => {
    const f = world((cls, mean) => {
      paint(cls, mean, 10, 10, CLASS_HILLS, 3500); // High: 6500 > 6000 closed; Low: 3800 open
      paint(cls, mean, 12, 10, CLASS_HILLS, SERVICE_CEILING_M - (AIR_MODE_AGL_M[0] as number) + 1); // Low closed too
      paint(cls, mean, 14, 10, CLASS_HILLS, SERVICE_CEILING_M - (AIR_MODE_AGL_M[0] as number)); // Low: exactly at the ceiling is open
      paint(cls, mean, 16, 10, CLASS_HILLS, 3000); // High: exactly at the ceiling is open
      cls[at(16 * B + 1, 20 * B + 1)] = CLASS_PEAK; // a single Peak sim cell in an otherwise flat nav cell
      mean[at(16 * B + 1, 20 * B + 1)] = 1;
    });
    const n = f.nav;
    const ix = (nx: number, ny: number): number => ny * n.width + nx;
    expect([n.blocked[0]![ix(10, 10)], n.blocked[1]![ix(10, 10)]]).toEqual([0, 1]);
    expect([n.blocked[0]![ix(12, 10)], n.blocked[1]![ix(12, 10)]]).toEqual([1, 1]);
    expect([n.blocked[0]![ix(14, 10)], n.blocked[1]![ix(14, 10)]]).toEqual([0, 1]);
    expect([n.blocked[0]![ix(16, 10)], n.blocked[1]![ix(16, 10)]]).toEqual([0, 0]);
    expect([n.blocked[0]![ix(16, 20)], n.blocked[1]![ix(16, 20)]]).toEqual([1, 1]);
    expect(n.airLabel[1]![ix(10, 10)]).toBe(-1);
  });
});

describe('labels, corner cutting and the search (synthetic)', () => {
  it('a Peak wall across the whole map (two walls on the cylinder) gives NO_ROUTE from the labels alone: no A* runs', () => {
    const f = world((cls, mean) => {
      for (const nx of [30, 90]) for (let ny = 0; ny < H / B; ny++) paint(cls, mean, nx, ny, CLASS_PEAK, 1);
    });
    const runs = f.nav.astarRuns;
    for (const mode of [ALT_MODE_LOW, ALT_MODE_HIGH] as const) {
      const r = planRoute(f.nav, f.view, 0, at(60 * B / 2, 64), at(300, 64), mode);
      expect(r.ok).toBe(false);
    }
    expect(f.nav.astarRuns).toBe(runs);
    expect(f.nav.labelRejects).toBe(2);
    expect(f.nav.airReachable(at(130, 64), at(150, 64), ALT_MODE_LOW)).toBe(true);
    // the same world without the second wall is one component and runs A*
    const g = world((cls, mean) => {
      for (let ny = 0; ny < H / B; ny++) paint(cls, mean, 30, ny, CLASS_PEAK, 1);
    });
    expect(planRoute(g.nav, g.view, 0, at(60, 64), at(300, 64), ALT_MODE_LOW).ok).toBe(true);
    expect(g.nav.astarRuns).toBe(1);
  });

  it('no corner cutting: a closed diagonal ring of Peak cells seals its inside, for the labels and for the route', () => {
    const cx = 60;
    const cy = 16;
    const f = world((cls, mean) => {
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) paint(cls, mean, cx + dx, cy + dy, CLASS_PEAK, 1);
    });
    const inside = at(cx * B + 2, cy * B + 2);
    const outside = at(cx * B + 40, cy * B + 2);
    expect(f.nav.airReachable(inside, outside, ALT_MODE_LOW)).toBe(false);
    expect(planRoute(f.nav, f.view, 0, outside, inside, ALT_MODE_LOW).ok).toBe(false);
    expect(planRoute(f.nav, f.view, 0, at(100, 40), at(200, 90), ALT_MODE_LOW).ok).toBe(true);
  });

  it('waypoints: a straight flight has two, the route wraps over the date line, and a start in a closed cell is NO_ROUTE', () => {
    const f = world();
    const r = planRoute(f.nav, f.view, 0, at(100, 64), at(200, 64), ALT_MODE_LOW);
    if (!r.ok) throw new Error('no route');
    expect(r.waypoints).toEqual([at(100, 64), at(200, 64)]);
    const w = planRoute(f.nav, f.view, 0, at(10, 64), at(W - 10, 64), ALT_MODE_LOW);
    if (!w.ok) throw new Error('no route');
    expect(w.fuelCells).toBe(20);
    const peak = world((cls, mean) => paint(cls, mean, 5, 5, CLASS_PEAK, 1));
    expect(planRoute(peak.nav, peak.view, 0, at(5 * B + 1, 5 * B + 1), at(200, 64), ALT_MODE_LOW).ok).toBe(false);
  });
});

describe('exposure-weighted routes (synthetic ridge fixture)', () => {
  // A north-south ridge (3000 m) at x = 200..203; a SAM of seat 1 east of it. The straight flight crosses the ridge and then the SAM's coverage.
  const ridge = (): Fixture =>
    world((cls, mean) => {
      for (let y = 0; y < H; y++) for (let x = 200; x < 204; x++) mean[at(x, y)] = 3000;
    });
  const from = at(140, 66);
  const to = at(320, 66);

  it('the lambda 3 route has at most half the exposed cells of the lambda 0 route and is not absurdly longer', () => {
    const f = ridge();
    f.los.addSite(2, at(250, 66), 24);
    const straight = planRoute(f.nav, f.view, 0, from, to, ALT_MODE_LOW, 0);
    const smart = planRoute(f.nav, f.view, 0, from, to, ALT_MODE_LOW, AIR_EXPOSURE_LAMBDA);
    if (!straight.ok || !smart.ok) throw new Error('no route');
    console.log(`[nav] ridge fixture: straight ${straight.exposedCells} exposed / ${straight.fuelCells} cells, lambda 3: ${smart.exposedCells} exposed / ${smart.fuelCells} cells`);
    expect(straight.exposedCells).toBeGreaterThanOrEqual(8);
    expect(smart.exposedCells).toBeLessThanOrEqual(straight.exposedCells / 2);
    expect(smart.fuelCells).toBeLessThan(straight.fuelCells * 1.5);
    // High is exposed over the whole range (no mask), so the detour can only help by leaving the range
    const hi = planRoute(f.nav, f.view, 0, from, to, ALT_MODE_HIGH, 0);
    if (!hi.ok) throw new Error('no route');
    expect(hi.exposedCells).toBeGreaterThanOrEqual(straight.exposedCells);
  });

  it('a Defense Post disc on the route gives exposed cells in both modes, also for the straightest route', () => {
    const f = ridge();
    f.view.structures.add(STRUCT_POST, 2, at(230, 66), 0);
    for (const mode of [ALT_MODE_LOW, ALT_MODE_HIGH] as const) {
      const r = planRoute(f.nav, f.view, 0, from, to, mode, 0);
      if (!r.ok) throw new Error('no route');
      expect(r.exposedCells, `mode ${mode}`).toBeGreaterThan(0);
    }
    // the Post's own seat is not exposed to it
    const own = planRoute(f.nav, f.view, 1, from, to, ALT_MODE_LOW, 0);
    if (!own.ok) throw new Error('no route');
    expect(own.exposedCells).toBe(0);
  });
});

describe('scoreLz (synthetic): one fixture per reason code and the priority order', () => {
  const home = at(100, 64);
  const lz = at(160, 64);
  const score = (f: Fixture, cell: number, start = home) => scoreLz(f.nav, f.view, 0, cell, start, ALT_MODE_LOW);

  it('a valid landing zone scores above 0 and the result is OK', () => {
    const f = world();
    const r = score(f, lz);
    expect(r.reason).toBe(LZ_OK);
    expect(r.score).toBeGreaterThan(0);
    expect(r.fuelCells).toBe(60);
  });

  it('WATER, PEAK, TERRAIN_CLASS (Forest, Mountain, Ice), STEEP, TOO_HIGH', () => {
    const f = world((cls, mean) => {
      cls[lz] = CLASS_SHALLOWS;
      cls[lz + 4] = CLASS_PEAK;
      cls[lz + 8] = CLASS_FOREST;
      cls[lz + 12] = CLASS_MOUNTAIN;
      cls[lz + 16] = CLASS_ICE;
      mean[lz + 20 + 1] = 400; // a 400 m step next to the cell lz + 20
      for (let dy = -3; dy <= 3; dy++) for (let dx = 40; dx <= 46; dx++) {
        cls[lz + dy * W + dx] = CLASS_HILLS;
        mean[lz + dy * W + dx] = 3600;
      }
    });
    expect(score(f, lz).reason).toBe(LZ_WATER);
    expect(score(f, lz + 4).reason).toBe(LZ_PEAK);
    expect(score(f, lz + 8).reason).toBe(LZ_TERRAIN_CLASS);
    expect(score(f, lz + 12).reason).toBe(LZ_TERRAIN_CLASS);
    expect(score(f, lz + 16).reason).toBe(LZ_TERRAIN_CLASS);
    expect(score(f, lz + 20).reason).toBe(LZ_STEEP);
    expect(score(f, lz + 43).reason).toBe(LZ_TOO_HIGH);
    expect(score(f, lz + 4).score).toBe(0);
  });

  it('priority: a Shallows cell that is also steep, near an enemy city and out of fuel is WATER; a steep cell near a city is STEEP, not the city', () => {
    const f = world((cls, mean) => {
      cls[lz] = CLASS_SHALLOWS;
      mean[lz + 1] = 900;
    });
    f.view.structures.add(STRUCT_CITY, 2, lz + 1, 0);
    expect(score(f, lz, at(100 + 150, 64)).reason).toBe(LZ_WATER);
    const g = world((cls, mean) => {
      mean[lz + 1] = 900;
    });
    g.view.structures.add(STRUCT_CITY, 2, lz + 1, 0);
    expect(score(g, lz).reason).toBe(LZ_STEEP);
  });

  it('ENEMY_CITY_NEAR: a city 2 cells away rejects, 3 cells away is fine; an own city does not count', () => {
    const f = world();
    f.view.structures.add(STRUCT_CITY, 2, lz + 2, 0); // owner 2 = seat 1, an enemy of seat 0
    expect(score(f, lz).reason).toBe(LZ_ENEMY_CITY_NEAR);
    const g = world();
    g.view.structures.add(STRUCT_CITY, 2, lz + 3, 0);
    expect(score(g, lz).reason).toBe(LZ_OK);
    const h = world();
    h.view.structures.add(STRUCT_CITY, 1, lz + 1, 0); // owner 1 = seat 0 itself
    expect(score(h, lz).reason).toBe(LZ_OK);
  });

  it('OUT_OF_FUEL beyond HELI_FUEL_CELLS, NO_ROUTE for a sealed cell inside the range', () => {
    const f = world();
    expect(score(f, at(100 + HELI_FUEL_CELLS + 5, 64)).reason).toBe(LZ_OUT_OF_FUEL);
    expect(score(f, at(100 + HELI_FUEL_CELLS - 5, 64)).reason).toBe(LZ_OK);
    const cx = 60;
    const cy = 16;
    const g = world((cls, mean) => {
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) paint(cls, mean, cx + dx, cy + dy, CLASS_PEAK, 1);
    });
    expect(score(g, at(cx * B + 2, cy * B + 2), at(cx * B + 60, cy * B + 2)).reason).toBe(LZ_NO_ROUTE);
  });

  it('flatter and less exposed approaches score higher', () => {
    const flat = world();
    const bumpy = world((_c, mean) => {
      mean[lz + 1] = 150;
    });
    expect(score(bumpy, lz).reason).toBe(LZ_OK);
    expect(score(bumpy, lz).score).toBeLessThan(score(flat, lz).score);
    const watched = world();
    watched.view.structures.add(STRUCT_POST, 2, at(165, 64), 0); // the landing zone itself lies inside the disc
    expect(score(watched, lz).score).toBeLessThan(score(flat, lz).score);
  });
});

describe('the real world', () => {
  let real: RealLos;
  let nav: Nav;
  let view: NavView;
  beforeAll(async () => {
    real = await loadRealLos();
    nav = createNav({ width: 1024, height: 512, terrainClass: real.terrainClass, meanElev: real.meanElev }, createLos(real.terrain));
    const state = createEmptyState(1024, 512, 1, 2);
    view = { tick: 0, structures: state.structures, terrainClass: real.terrainClass, seats: 2 };
  });

  it('the nav grid is 256x128 with the labels in place', () => {
    expect([nav.width, nav.height]).toEqual([256, 128]);
    expect(nav.airLabel).toHaveLength(2);
  });

  it('Alps fixture: Low from 48.1N 11.6E to the Po plain 45.2N 9.5E is a route within the fuel; closed share of land nav cells in Low is under 5 %', () => {
    const r = planRoute(nav, view, 0, cellAtLatLon(48.1, 11.6), cellAtLatLon(45.2, 9.5), ALT_MODE_LOW);
    if (!r.ok) throw new Error('no route');
    expect(r.fuelCells).toBeLessThanOrEqual(HELI_FUEL_CELLS);
    expect(r.fuelCells).toBeGreaterThan(5);
    let land = 0;
    const closed = [0, 0];
    for (let i = 0; i < nav.width * nav.height; i++) {
      if ((nav.landCount[i] as number) * 2 < B * B) continue;
      land++;
      closed[0]! += nav.blocked[0]![i]!;
      closed[1]! += nav.blocked[1]![i]!;
    }
    console.log(`[nav] land nav cells ${land}; closed in Low ${closed[0]} (${((100 * closed[0]!) / land).toFixed(2)} %), closed in High ${closed[1]} (${((100 * closed[1]!) / land).toFixed(2)} %)`);
    expect(closed[0]! / land).toBeLessThan(0.05);
    expect(closed[1]!).toBeGreaterThan(closed[0]!);
  });

  it('a nav cell with real mean height > 3000 m that is not Peak (found in the Tibet box) is closed in High and open in Low; a Peak cell is closed in both', () => {
    let found = -1;
    for (let i = 0; i < nav.width * nav.height; i++) {
      const x = i % nav.width;
      const y = (i - x) / nav.width;
      const lat = 90 - ((y + 0.5) * 180) / nav.height;
      const lon = -180 + ((x + 0.5) * 360) / nav.width;
      if (lat >= 26 && lat <= 36 && lon >= 75 && lon <= 95 && (nav.meanM[i] as number) > 3000 && nav.hasPeak[i] === 0) {
        found = i;
        break;
      }
    }
    // The Tibet box has such a cell on the baked data (D-block M11b); if the data ever changes, fall back to the Andes / Rockies as the prompt says.
    expect(found).toBeGreaterThanOrEqual(0);
    expect(nav.blocked[1]![found]).toBe(1);
    expect(nav.blocked[0]![found]).toBe(0);
    const peak = nav.hasPeak.indexOf(1);
    expect(peak).toBeGreaterThanOrEqual(0);
    expect([nav.blocked[0]![peak], nav.blocked[1]![peak]]).toEqual([1, 1]);
    let n = 0;
    let p = 0;
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 1024; x++) {
        const lat = 90 - ((y + 0.5) * 180) / 512;
        const lon = -180 + ((x + 0.5) * 360) / 1024;
        if (lat < 26 || lat > 36 || lon < 75 || lon > 95) continue;
        const c = real.terrainClass[y * 1024 + x] as number;
        if (c > 1) {
          n++;
          if (c === CLASS_PEAK) p++;
        }
      }
    console.log(`[nav] Tibet box (lat 26..36, lon 75..95): ${n} land sim cells, ${p} Peak (${((100 * p) / n).toFixed(1)} %)`);
  });

  it('result hash of a fixed set of real routes (Node; the debug page recomputes it in Chromium)', () => {
    const q = (a: [number, number], b: [number, number], m: 0 | 1): [number, number, 0 | 1] => [cellAtLatLon(a[0], a[1]), cellAtLatLon(b[0], b[1]), m];
    const hash = navFingerprint(nav, view, 0, [
      q([48.1, 11.6], [45.2, 9.5], 0),
      q([27.7, 85.3], [28.6, 77.2], 0),
      q([27.7, 85.3], [28.6, 77.2], 1),
      q([39, -98], [41, -87], 0),
      q([-33, -70], [-34, -58], 0),
    ]);
    console.log(`[nav] fingerprint ${hash}`);
    expect(hash).toBe(PINNED_HASH);
  });
});

const PINNED_HASH = '93fc20be'; // Fix-3A2: was 4680ed7e before the admissible A* heuristic (docs/DECISIONS.md, Fix-3A2)

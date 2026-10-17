// M13c-2 leak test (tagged leak-test, serial project): a ship sails while 60 render calls (3 rounds x 20) are made at 320x180; the table changes every call (the instance
// buffers are rewritten), the geometry and texture counts of `renderer.info` do not move and the retained heap stays under 5 MB (median of 3). The layer's buffers are created once.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { heapDelta, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { BUILD_TICKS } from '../src/sim/rules';
import { findShipRoute, hasWaterWithinReach, portWaterCell, ShipRoute, SHIP_ROUTE_OK } from '../src/sim/shipRoute';
import { isCoastCell, STRUCT_PORT } from '../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_SHALLOWS, isPlayableClass } from '../src/sim/terrain';
import { worldLoader } from '../tests/helpers/dataFiles';

const MB = 1_000_000;
const WIDTH = 1024;
const HEIGHT = 512;
let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

const ev = <R>(page: Page, fn: string, ...args: unknown[]): Promise<R> => page.evaluate(([f, a]) => (window as any).__test[f as string](...(a as unknown[])), [fn, args] as const) as Promise<R>;

const isWater = (cls: number): boolean => cls === CLASS_DEEP_SEA || cls === CLASS_SHALLOWS;

/** A sea way to a free coast cell: the Port candidate nearest the capital (coast, plain or forest, own) and the landing cell with the shortest route from it. */
async function findScene(page: Page, capital: number, mine: number): Promise<{ port: number; target: number; routeCells: number }> {
  const sim = await worldLoader().loadSim();
  const cx = capital % WIDTH;
  const cy = (capital - cx) / WIDTH;
  const ports: number[] = [];
  for (let dy = -7; dy <= 7; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      const c = (cy + dy) * WIDTH + ((cx + dx + WIDTH) % WIDTH);
      const cls = sim.terrainClass[c] as number;
      if (cls === CLASS_HILLS || cls === CLASS_MOUNTAIN || cls === CLASS_PEAK || isWater(cls) || !isCoastCell(WIDTH, HEIGHT, sim.terrainClass, c)) continue;
      if (dx * dx + dy * dy > 4) ports.push(c);
    }
  }
  ports.sort((a, b) => Math.hypot((a % WIDTH) - cx, Math.floor(a / WIDTH) - cy) - Math.hypot((b % WIDTH) - cx, Math.floor(b / WIDTH) - cy));
  const owners: number[] = await page.evaluate((cs) => cs.map((c) => (window as any).__test.ownerOf(c)), ports);
  const port = ports.find((_, i) => owners[i] === mine && portWaterCell(WIDTH, HEIGHT, sim.terrainClass, ports[i] as number) >= 0) ?? -1;
  expect(port, 'a Port cell on the own coast').toBeGreaterThanOrEqual(0);
  const start = portWaterCell(WIDTH, HEIGHT, sim.terrainClass, port);
  const route = new ShipRoute();
  const found: Array<{ c: number; len: number }> = [];
  const px = port % WIDTH;
  const py = (port - px) / WIDTH;
  for (let dy = -40; dy <= 40; dy++) {
    for (let dx = -40; dx <= 40; dx++) {
      const yy = py + dy;
      if (yy < 0 || yy >= HEIGHT || dx * dx + dy * dy < 36) continue;
      const c = yy * WIDTH + ((px + dx + WIDTH) % WIDTH);
      if (!isPlayableClass(sim.terrainClass[c] as number) || !hasWaterWithinReach(WIDTH, HEIGHT, sim.terrainClass, c)) continue;
      if (findShipRoute(WIDTH, HEIGHT, sim.terrainClass, start, c, route) !== SHIP_ROUTE_OK || route.pathCells < 14) continue;
      found.push({ c, len: route.pathCells });
    }
  }
  found.sort((x, y) => x.len - y.len);
  const near = found.slice(0, 200);
  const who: number[] = await page.evaluate((cs) => cs.map((c) => (window as any).__test.ownerOf(c)), near.map((f) => f.c));
  const pick = near.find((_, i) => who[i] !== mine);
  expect(pick, 'a landing cell with a sea way that is not the own land').toBeDefined();
  const best = (pick as { c: number }).c;
  const bestLen = (pick as { len: number }).len;
  return { port, target: best, routeCells: bestLen };
}


describe('leak-test: the ship layer', () => {
  it('60 render calls with a ship sailing and the table rewritten every call retain less than 5 MB (median of 3); the geometry and texture counts are unchanged', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=0', { width: 960, height: 540 }, { isolated: true });
    try {
      await ev(page, 'setView', { lat: 41.9, lon: 12.5, distKm: 2600, heading: 0, tilt: 0 });
      const p0 = await ev<{ x: number; y: number }>(page, 'project', 41.9, 12.5);
      await page.mouse.click(p0.x, p0.y);
      await ev(page, 'advance', 0.1, 5);
      await ev(page, 'give', 0, { gold: 9000, troops: 5000 });
      await ev(page, 'advance', 0.1, 214);
      const capital = ((await ev<{ capitals: number[] }>(page, 'seatCells')).capitals[0]) as number;
      const own = await ev<number>(page, 'ownerOf', capital);
      const scene = await findScene(page, capital, own);
      await ev(page, 'submit', { kind: 'Build', seat: 0, type: STRUCT_PORT, cell: scene.port });
      await ev(page, 'advance', 0.1, (BUILD_TICKS[STRUCT_PORT] as number) + 8);
      await ev(page, 'submit', { kind: 'LaunchShip', seat: 0, port: 0, targetCell: scene.target, troops: 100 });
      await ev(page, 'advance', 0.1, 4);
      await ev(page, 'settle', 0, 1);
      const ships = await ev<Array<{ lat: number; lon: number }>>(page, 'ships');
      expect(ships).toHaveLength(1);
      await ev(page, 'resize', 320, 180);
      const ll = cellToLatLon(scene.port, WIDTH, HEIGHT);
      await ev(page, 'setView', { lat: ll.lat, lon: ll.lon, distKm: 600, heading: 0, tilt: 0 });
      await ev(page, 'settle', 0, 2);
      const frames = async (n: number): Promise<void> => {
        for (let i = 0; i < n; i++) {
          await ev(page, 'advance', 0.05, 1); // a tick: the ship moves, the table is new, the layer rewrites its buffers
          await ev(page, 'settle', 0, 1);
        }
      };
      // the landing (its beachhead and effects) happens in the warm-up, so that the measured frames are the ship's way home: moving rows, a new table every call
      await ev(page, 'advance', 0.05, 150);
      await frames(20); // warm-up outside the measurement
      expect(await ev<unknown[]>(page, 'ships'), 'a ship is on its way home during the measurement').toHaveLength(1);
      const before = await ev<{ geometries: number; textures: number; drawCalls: number }>(page, 'info');
      const delta = await heapDelta(page, async () => {
        for (let round = 0; round < 3; round++) await frames(20);
      });
      const after = await ev<{ geometries: number; textures: number }>(page, 'info');
      console.log(`[leak-test] ship layer heap delta: ${(delta / MB).toFixed(3)} MB, geometries ${before.geometries} -> ${after.geometries}, textures ${before.textures} -> ${after.textures}`);
      expect(after.geometries).toBe(before.geometries);
      expect(after.textures).toBe(before.textures);
      expect(delta).toBeLessThan(5 * MB);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 300_000);
});

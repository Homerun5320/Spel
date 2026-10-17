// Fix-6B [3.8]: a ship reads from the earth view (9000 km) as a patch of pixels, not a 3 x 1 speck: with the ship layer on and off the picture differs in at least
// MIN_GLOBE_PIXELS pixels (the old minimum size gave about 6). One ship of seat 0 from a Port near Rome. Screenshots: test-results/shots/fix6b-ship-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { latLonToCell } from '../src/render/transforms';
import { BUILD_TICKS } from '../src/sim/rules';
import { findShipRoute, hasWaterWithinReach, portWaterCell, ShipRoute, SHIP_ROUTE_OK } from '../src/sim/shipRoute';
import { isCoastCell, STRUCT_PORT } from '../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_SHALLOWS, isPlayableClass } from '../src/sim/terrain';
import { worldLoader } from '../tests/helpers/dataFiles';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const WIDTH = 1024;
const HEIGHT = 512;
const MIN_GLOBE_PIXELS = 100;

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

interface Drawn {
  id: number;
  owner: number;
  lat: number;
  lon: number;
}
const advance = (page: Page, dt: number, n: number): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.advance(d, k), [dt, n] as const);
const settle = (page: Page): Promise<void> => page.evaluate(() => (window as any).__test.settle(0, 1));

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
      if (findShipRoute(WIDTH, HEIGHT, sim.terrainClass, start, c, route) !== SHIP_ROUTE_OK || route.pathCells < 8) continue;
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

function diffCount(a: ReturnType<typeof decodePng>, b: ReturnType<typeof decodePng>, tol = 30): number {
  let n = 0;
  for (let i = 0; i < a.width * a.height * 4; i += 4) {
    const d = Math.abs((a.data[i] as number) - (b.data[i] as number)) + Math.abs((a.data[i + 1] as number) - (b.data[i + 1] as number)) + Math.abs((a.data[i + 2] as number) - (b.data[i + 2] as number));
    if (d > tol) n++;
  }
  return n;
}


describe('a ship from the earth view', () => {
  it('the ship layer changes at least MIN_GLOBE_PIXELS pixels at 9000 km (it used to be a 3 x 1 speck)', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=0');
    try {
      const c = latLonToCell(41.9, 12.5, WIDTH, HEIGHT).index;
      await page.evaluate((cell) => (window as any).__test.submit({ kind: 'Spawn', seat: 0, cell }), c);
      await advance(page, 0.1, 6);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 9000, troops: 5000 }));
      await advance(page, 0.1, 214);
      const cap = ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals[0] as number;
      const own = (await page.evaluate((x) => (window as any).__test.ownerOf(x), cap)) as number;
      const scene = await findScene(page, cap, own);
      await page.evaluate(([cell, ty]) => (window as any).__test.submit({ kind: 'Build', seat: 0, type: ty, cell }), [scene.port, STRUCT_PORT] as const);
      await advance(page, 0.1, (BUILD_TICKS[STRUCT_PORT] as number) + 8);
      await page.evaluate((target) => (window as any).__test.submit({ kind: 'LaunchShip', seat: 0, port: 0, targetCell: target, troops: 100 }), scene.target);
      await advance(page, 0.1, 30);
      await settle(page);
      await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' });
      const ships = (await page.evaluate(() => (window as any).__test.ships())) as Drawn[];
      expect(ships.length).toBe(1);
      const s = ships[0] as Drawn;
      await page.evaluate((v) => (window as any).__test.setView(v), { lat: s.lat, lon: s.lon, distKm: 9000, heading: 0, tilt: 0 });
      await settle(page);
      const on = await page.screenshot();
      fs.writeFileSync(path.join(SHOT_DIR, 'fix6b-ship-globe.png'), on);
      await page.evaluate(() => (window as any).__test.shipLayer(false));
      await settle(page);
      const off = await page.screenshot();
      await page.evaluate(() => (window as any).__test.shipLayer(true));
      const n = diffCount(decodePng(on), decodePng(off));
      console.log('ship pixels at the earth view:', n);
      expect(n).toBeGreaterThanOrEqual(MIN_GLOBE_PIXELS);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 150_000);
});

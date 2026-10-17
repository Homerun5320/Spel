// M13c-2 in headless Chromium (software WebGL2): the ships. The player builds a Port on the Rome coast, selects it, presses "Skicka fartyg", picks a coast on the map (the preview
// route and the landing marker), confirms, and watches the ship sail and land: one instanced draw call, a toast for the departure and the landing, a beachhead. The landing cell is
// FOUND in Node with the sim's own route search on the same terrain (the shortest sea way to a free coast), so the test does not depend on a map detail. A second seat (Marseille)
// sends a ship too, so the pictures show two owners. Screenshots go to test-results/shots/ships-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { SHIP_MODEL_MAX_TRIANGLES } from '../src/render/config';
import { cellToLatLon, latLonToCell } from '../src/render/transforms';
import { BUILD_TICKS, SHIP_LAUNCH_GOLD } from '../src/sim/rules';
import { findShipRoute, hasWaterWithinReach, portWaterCell, ShipRoute, SHIP_ROUTE_OK } from '../src/sim/shipRoute';
import { isCoastCell, STRUCT_PORT } from '../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_SHALLOWS, isPlayableClass } from '../src/sim/terrain';
import { formatGold } from '../src/ui/i18n';
import { worldLoader } from '../tests/helpers/dataFiles';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const WIDTH = 1024;
const HEIGHT = 512;

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
  state: number;
  cellX: number;
  cellY: number;
  lat: number;
  lon: number;
  radius: number;
  yaw: number;
  sunk: number;
}
interface Mode {
  active: boolean;
  port: number;
  hover: number;
  pinned: number;
  reason: number;
  routePoints: number;
  etaSeconds: number;
  markerState: number;
}
const T = (page: Page) => ({
  props: (): Promise<{ toasts: string[]; selection: { id: number; panelVisible: boolean } }> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ local: { spawned: boolean; troops: number }; structures: { byType: Record<number, number> } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (dt = 0, n = 1): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.settle(d, k), [dt, n] as const),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  ships: (): Promise<Drawn[]> => page.evaluate(() => (window as any).__test.ships()),
  mode: (): Promise<Mode> => page.evaluate(() => (window as any).__test.shipMode()),
  beach: (): Promise<{ rows: Array<{ seed: number; cells: number }> }> => page.evaluate(() => (window as any).__test.beach()),
  ownerOf: (c: number): Promise<number> => page.evaluate((x) => (window as any).__test.ownerOf(x), c),
  submit: (body: Record<string, unknown>): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
  capital: async (seat = 0): Promise<number> => ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals[seat] as number,
});

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

/** The camera `dKm` south of a place and `aglM` above the ground, looking north. */
async function closeUp(page: Page, lat: number, lon: number, dKm: number, aglM: number, pitch = 24): Promise<void> {
  await page.evaluate(([la, lo, d, agl, p]) => (window as any).__test.setGroundView({ lat: la - d / 111.2, lon: lo, heading: 0, pitchDeg: p, aglM: agl, time: 0.45 }), [lat, lon, dKm, aglM, pitch] as const);
}

describe('the ship mode and the ships at sea', () => {
  it('Port -> "Skicka fartyg" -> pick a coast (route, marker) -> confirm -> one draw call, a toast, the landing, a beachhead', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1');
    try {
      const t = T(page);
      await t.view({ lat: 41.9, lon: 12.5, distKm: 2600, heading: 0, tilt: 0 });
      const p0 = await t.project(41.9, 12.5);
      await page.mouse.click(p0.x, p0.y);
      await t.advance(0.1, 5);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 9000, troops: 5000 }));
      await t.advance(0.1, 4);
      expect((await t.state()).local.spawned).toBe(true);
      await t.advance(0.1, 210); // past the spawn phase
      const capital = await t.capital();
      const scene = await findScene(page, capital, await t.ownerOf(capital));
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_PORT, cell: scene.port });
      await t.advance(0.1, (BUILD_TICKS[STRUCT_PORT] as number) + 8);
      expect((await t.state()).structures.byType[STRUCT_PORT]).toBe(1);

      // select the Port: the button shows the fee, live
      const pl = cellToLatLon(scene.port, WIDTH, HEIGHT);
      await closeUp(page, pl.lat, pl.lon, 40, 30000, 40);
      await t.settle();
      const pp = await t.project(pl.lat, pl.lon);
      expect(pp.inView && pp.facing).toBe(true);
      await page.mouse.click(pp.x, pp.y);
      await t.settle();
      const btn = page.locator('[data-testid="sel-ship"]');
      await btn.waitFor({ state: 'visible', timeout: 5000 });
      expect(await btn.getAttribute('aria-disabled')).toBeNull();
      expect(await btn.textContent()).toContain(formatGold(SHIP_LAUNCH_GOLD));
      expect(await page.locator('[data-testid="sel-ship-fleet"]').getAttribute('data-n')).toBe('0');
      fs.writeFileSync(path.join(SHOT_DIR, 'ships-panel.png'), await page.screenshot());

      // the mode: a hover is yellow, a click pins a coast cell: green marker, the sim's route, the verdict; nothing is sent yet
      await btn.click();
      await t.settle();
      expect((await t.mode()).active).toBe(true);
      expect(await page.locator('[data-testid="ship-controls"]').isVisible()).toBe(true);
      expect(await page.locator('[data-testid="ship-confirm"]').getAttribute('aria-disabled')).toBe('true');
      const tl = cellToLatLon(scene.target, WIDTH, HEIGHT);
      const sepKm = Math.hypot((tl.lat - pl.lat) * 111.2, (tl.lon - pl.lon) * 111.2 * Math.cos((pl.lat * Math.PI) / 180));
      await t.view({ lat: (pl.lat + tl.lat) / 2, lon: (pl.lon + tl.lon) / 2, distKm: Math.max(500, sepKm * 3), heading: 0, tilt: 0 });
      await t.settle();
      const pt = await t.project(tl.lat, tl.lon);
      expect(pt.inView && pt.facing, 'the landing cell is on screen').toBe(true);
      await page.mouse.move(pt.x, pt.y);
      await t.settle(0.1, 1);
      const hovered = await t.mode();
      expect([hovered.hover, hovered.pinned, hovered.markerState]).toEqual([scene.target, -1, 0]);
      const before = await t.info();
      await page.mouse.click(pt.x, pt.y);
      await t.advance(0.05, 1);
      const pinned = await t.mode();
      expect([pinned.pinned, pinned.reason, pinned.markerState]).toEqual([scene.target, 0, 1]);
      expect(pinned.routePoints).toBeGreaterThanOrEqual(2);
      expect(pinned.etaSeconds).toBeGreaterThan(0);
      expect(await page.locator('[data-testid="ship-confirm"]').getAttribute('aria-disabled')).toBeNull();
      const withRoute = await t.info();
      expect(withRoute.drawCalls - before.drawCalls, 'the route line (twice) and the marker: the deploy layer, no new layer').toBeLessThanOrEqual(3);
      fs.writeFileSync(path.join(SHOT_DIR, 'ships-preview.png'), await page.screenshot());
      const hideHud = await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' });
      await t.view({ lat: (pl.lat + tl.lat) / 2, lon: (pl.lon + tl.lon) / 2, distKm: Math.max(150, sepKm * 1.4), heading: 0, tilt: 0 });
      await t.settle();
      fs.writeFileSync(path.join(SHOT_DIR, 'ships-preview-close.png'), await page.screenshot());
      await hideHud.evaluate((e) => (e as Element).remove());
      expect((await t.ships()).length).toBe(0);

      // confirm: the intent goes, the mode ends, the gold is paid, a ship stands in the water
      const goldBefore = Number(await page.locator('[data-testid="gold"]').getAttribute('data-value'));
      await page.locator('[data-testid="ship-confirm"]').click();
      await t.advance(0.1, 6);
      await t.settle();
      expect((await t.mode()).active).toBe(false);
      const ships = await t.ships();
      expect(ships).toHaveLength(1);
      const s = ships[0] as Drawn;
      expect([s.owner, s.state]).toEqual([1, 1]);
      expect(Math.abs(s.radius - 1)).toBeLessThan(1e-5); // on the sea surface
      expect((await t.props()).toasts).toContain('toast.ship.launched');
      expect(Number(await page.locator('[data-testid="gold"]').getAttribute('data-value'))).toBeLessThan(goldBefore - SHIP_LAUNCH_GOLD + 50);
      expect(await page.locator('[data-testid="sel-ship-fleet"]').getAttribute('data-n')).toBe('1');
      expect(await page.locator('[data-testid="sel-ship"]').getAttribute('aria-disabled')).toBe('true'); // the Port's ship is out

      // one draw call and the model's triangles; pixels differ near the ship only
      await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' });
      await closeUp(page, s.lat, s.lon, 2.6, 1500);
      await t.settle();
      const shotOn = decodePng(await page.screenshot());
      const on = await t.info();
      await page.evaluate(() => (window as any).__test.shipLayer(false));
      await t.settle();
      const shotOff = decodePng(await page.screenshot());
      const off = await t.info();
      await page.evaluate(() => (window as any).__test.shipLayer(true));
      expect(on.drawCalls - off.drawCalls).toBe(1);
      expect(on.triangles - off.triangles).toBeGreaterThan(20);
      expect(on.triangles - off.triangles).toBeLessThanOrEqual(SHIP_MODEL_MAX_TRIANGLES);
      expect(diffCount(shotOn, shotOff)).toBeGreaterThan(150);

      // the voyage: it sails, lands (toast, beachhead) and turns home
      await t.advance(0.1, Math.ceil((scene.routeCells / 0.125) * 1.05) + 40);
      await t.settle();
      const toasts = (await t.props()).toasts;
      expect(toasts.some((k) => k === 'toast.ship.landed' || k === 'toast.ship.landFailed' || k === 'toast.ship.landNone')).toBe(true);
      const beach = await t.beach();
      expect(beach.rows.length, 'the landing made a beachhead').toBeGreaterThanOrEqual(1);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 240_000);
});

describe('the ships in pictures', () => {
  it('two owners sail side by side; the ship reads at 3 km, at 20 km, over the sea at 700 km and from the earth view (pixels differ with the layer on and off)', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=0');
    try {
      const t = T(page);
      const spawnAt = async (seat: number, lat: number, lon: number): Promise<number> => {
        const c = latLonToCell(lat, lon, WIDTH, HEIGHT).index;
        await t.submit({ kind: 'Spawn', seat, cell: c });
        await t.advance(0.1, 6);
        await page.evaluate((s) => (window as any).__test.give(s, { gold: 9000, troops: 5000 }), seat);
        await t.advance(0.1, 4);
        return t.capital(seat);
      };
      const cap0 = await spawnAt(0, 41.9, 12.5);
      const cap1 = await spawnAt(1, 43.3, 5.4);
      await t.advance(0.1, 210);
      const own0 = await t.ownerOf(cap0);
      const own1 = await t.ownerOf(cap1);
      expect([own0, own1]).toEqual([1, 2]);
      const a = await findScene(page, cap0, own0);
      const b = await findScene(page, cap1, own1);
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_PORT, cell: a.port });
      await t.submit({ kind: 'Build', seat: 1, type: STRUCT_PORT, cell: b.port });
      await t.advance(0.1, (BUILD_TICKS[STRUCT_PORT] as number) + 8);
      await t.submit({ kind: 'LaunchShip', seat: 0, port: 0, targetCell: a.target, troops: 100 });
      await t.submit({ kind: 'LaunchShip', seat: 1, port: 1, targetCell: b.target, troops: 100 });
      await t.advance(0.1, 30);
      await t.settle();
      const ships = await t.ships();
      expect(ships.map((s) => s.owner).sort()).toEqual([1, 2]);
      const hide = await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' });
      const shoot = async (name: string): Promise<ReturnType<typeof decodePng>> => {
        await t.settle();
        const png = await page.screenshot();
        fs.writeFileSync(path.join(SHOT_DIR, `ships-${name}.png`), png);
        return decodePng(png);
      };
      const visible = async (name: string): Promise<number> => {
        const on = await shoot(name);
        await page.evaluate(() => (window as any).__test.shipLayer(false));
        await t.settle();
        const off = decodePng(await page.screenshot());
        await page.evaluate(() => (window as any).__test.shipLayer(true));
        return diffCount(on, off);
      };
      const s0 = ships.find((s) => s.owner === 1) as Drawn;
      const s1 = ships.find((s) => s.owner === 2) as Drawn;
      await closeUp(page, s0.lat, s0.lon, 2.6, 1500);
      expect(await visible('3km-day-a')).toBeGreaterThan(300);
      await closeUp(page, s1.lat, s1.lon, 2.6, 1500);
      expect(await visible('3km-day-b')).toBeGreaterThan(300);
      await closeUp(page, s0.lat, s0.lon, 18, 12000, 35);
      expect(await visible('20km-day')).toBeGreaterThan(40);
      await t.view({ lat: (s0.lat + s1.lat) / 2, lon: (s0.lon + s1.lon) / 2, distKm: 700, heading: 0, tilt: 0 });
      expect(await visible('700km-two-owners')).toBeGreaterThan(20);
      await t.view({ lat: (s0.lat + s1.lat) / 2, lon: (s0.lon + s1.lon) / 2, distKm: 9000, heading: 0, tilt: 0 });
      expect(await visible('globe')).toBeGreaterThan(6);
      await hide.evaluate((e) => (e as Element).remove());
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 300_000);
});

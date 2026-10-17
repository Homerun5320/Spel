// M13b in headless Chromium (software WebGL2): the deploy mode. Select the Factory, "Skicka helikopter", pick a landing zone and see the verdict, the route and
// the marker, send, watch the helicopter fly and land. The zones are FOUND in the page by the same preview the mode uses (a scan of cells round the capital),
// so the test does not depend on a map detail; the launch itself is the real intent through the real mode. Screenshots go to test-results/shots/deploy-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { BUILD_TICKS, HELI_BUILD_TICKS } from '../src/sim/rules';
import { STRUCT_FACTORY } from '../src/sim/structureRules';
import { HELI_PAD } from '../src/sim/heliTable';
import { LZ_WATER } from '../src/sim/nav/lz';

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
  state: number;
  cellX: number;
  cellY: number;
  parked: boolean;
}
interface Deploy {
  active: boolean;
  factory: number;
  hover: number;
  markerCell: number;
  markerState: number;
  routeVertices: number;
  visibleMeshes: number;
  status: 'idle' | 'pending' | 'ready';
  reason: number;
  etaSeconds: number;
  fuelCells: number;
  troops: number;
  queriesSent: number;
  queriesDropped: number;
}
const T = (page: Page) => ({
  props: (): Promise<{ toasts: string[]; selection: { id: number; panelVisible: boolean } }> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ local: { spawned: boolean; troops: number } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (dt = 0, n = 1): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.settle(d, k), [dt, n] as const),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  helis: (): Promise<Drawn[]> => page.evaluate(() => (window as any).__test.helis()),
  deploy: (): Promise<Deploy> => page.evaluate(() => (window as any).__test.deploy()),
  capital: async (): Promise<number> => ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals[0] as number,
  submit: (body: Record<string, unknown>): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
});

/** Moves the mouse over the cell and lets the throttled preview answer for it (the fx clock steps 0.3 s per settle: more than the 0.2 s interval). */
async function hoverUntilReady(page: Page, cell: number): Promise<Deploy> {
  const t = T(page);
  const at = cellToLatLon(cell, WIDTH, HEIGHT);
  const p = await t.project(at.lat, at.lon);
  expect(p.inView && p.facing, `cell ${cell} is on screen`).toBe(true);
  await page.mouse.move(p.x, p.y);
  let d = await t.deploy();
  for (let i = 0; i < 12 && !(d.status === 'ready' && d.hover === cell && d.markerCell === cell && d.markerState !== 0); i++) {
    await t.settle(0.3, 1);
    d = await t.deploy();
  }
  expect(d.hover).toBe(cell);
  expect(d.status).toBe('ready');
  return d;
}

describe('the deploy mode', () => {
  it('a refused zone shows a red marker and the reason and sends nothing; a valid one shows a green marker and a route; the launch takes the troops, flies and lands', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1');
    try {
      const t = T(page);
      // --- a nation with a Factory and a helicopter on its pad
      await t.view({ lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 });
      const p0 = await t.project(48.5, 11);
      await page.mouse.click(p0.x, p0.y);
      await t.advance(0.1, 5);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 90000, troops: 5000 }));
      await t.advance(0.1, 4);
      expect((await t.state()).local.spawned).toBe(true);
      await t.advance(0.1, 210); // past the spawn phase
      const capital = await t.capital();
      const at = cellToLatLon(capital, WIDTH, HEIGHT);
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_FACTORY, cell: capital });
      await t.advance(0.1, (BUILD_TICKS[STRUCT_FACTORY] as number) + 8);
      const pf = await t.project(at.lat, at.lon);
      await page.mouse.click(pf.x, pf.y); // select the Factory
      await t.settle();
      const factory = (await t.props()).selection.id;
      expect(factory).toBeGreaterThanOrEqual(0);
      // the button is dimmed with the reason while no helicopter stands on the pad
      const open = page.locator('[data-testid="deploy-open"]');
      expect(await open.getAttribute('aria-disabled')).toBe('true');
      await page.locator('[data-testid="sel-heli"]').click();
      await t.advance(0.1, HELI_BUILD_TICKS + 4);
      await t.settle();
      expect(await open.getAttribute('aria-disabled')).toBeNull();
      expect((await t.helis())[0]?.state).toBe(HELI_PAD);

      await t.view({ lat: at.lat - 4, lon: at.lon + 4, distKm: 3200, heading: 0, tilt: 0 });
      await t.settle();
      // --- find a valid zone, a water zone and a zone that is too far, with the page's own preview
      const cells = await page.evaluate(
        ([cap, w, fac]) => {
          const out: Array<{ cell: number; reason: number; waypoints: number; eta: number }> = [];
          const cx = cap % w;
          const cy = (cap - cx) / w;
          for (let dy = -40; dy <= 40; dy += 5) {
            for (let dx = -40; dx <= 40; dx += 5) {
              const x = cx + dx;
              const y = cy + dy;
              if (x < 0 || x >= w || y < 0 || y >= 512 || Math.hypot(dx, dy) < 18) continue;
              const cell = y * w + x;
              const r = (window as any).__test.previewNow(fac, cell, 300, 0);
              if (r !== null) out.push({ cell, reason: r.reason, waypoints: r.waypoints, eta: r.etaSeconds });
            }
          }
          return out;
        },
        [capital, WIDTH, factory] as const,
      );
      // only cells that are on screen and clear of the Factory panel (bottom left) can be hovered with the mouse
      const free = async (cell: number): Promise<boolean> => {
        const ll = cellToLatLon(cell, WIDTH, HEIGHT);
        const p = await t.project(ll.lat, ll.lon);
        return p.inView && p.facing && p.x > 420 && p.x < 900 && p.y > 80 && p.y < 380;
      };
      const cellDist = (a: number, b: number): number => Math.hypot((a % WIDTH) - (b % WIDTH), Math.floor(a / WIDTH) - Math.floor(b / WIDTH));
      const validAll = cells.filter((c) => c.reason === 0 && c.waypoints >= 2).sort((a, b) => Math.abs(cellDist(a.cell, capital) - 28) - Math.abs(cellDist(b.cell, capital) - 28));
      const valid: typeof validAll = [];
      for (const c of validAll) if (await free(c.cell)) valid.push(c);
      expect(valid.length, 'a valid zone in the free part of the screen').toBeGreaterThan(0);
      const lz = valid[0] as (typeof valid)[number];
      let water: (typeof cells)[number] | undefined;
      for (const c of cells.filter((x) => x.reason === LZ_WATER).sort((a, b) => cellDist(a.cell, lz.cell) - cellDist(b.cell, lz.cell))) {
        if (await free(c.cell)) {
          water = c;
          break;
        }
      }
      console.log(`[deploy] ${cells.length} cells scanned, ${validAll.length} valid, ${valid.length} hoverable, water: ${water?.cell ?? 'none'}`);
      expect(water, 'a water cell in the free part of the screen').toBeDefined();
      const lzAt = cellToLatLon(lz.cell, WIDTH, HEIGHT);
      const waterAt = cellToLatLon((water as { cell: number }).cell, WIDTH, HEIGHT);
      const midLat = at.lat;
      const midLon = at.lon;
      await t.settle();

      // --- the right click with the Factory selected opens the mode (the resolver rule); Escape closes it and nothing else opens
      const pm = await t.project(midLat, midLon);
      await page.mouse.click(pm.x, pm.y, { button: 'right' });
      await t.settle();
      expect((await t.deploy()).active).toBe(true);
      await page.keyboard.press('Escape');
      await t.settle();
      expect((await t.deploy()).active).toBe(false);
      expect(await page.locator('[data-testid="pause-menu"]').isVisible()).toBe(false);
      expect((await t.props()).selection.panelVisible).toBe(true); // the selection is still there: Escape popped one mode only

      // --- the button opens it; the hint and the controls show; the draw calls are 0 before a route
      await open.click();
      await t.settle();
      expect((await t.deploy()).active).toBe(true);
      expect(await page.locator('[data-testid="deploy-controls"]').isVisible()).toBe(true);
      const callsIdle = (await t.info()).drawCalls;

      // --- a water zone: a red marker, the reason in the panel, a toast on the click and NO intent
      const troopsBefore = (await t.state()).local.troops;
      const dw = await hoverUntilReady(page, (water as { cell: number }).cell);
      expect(dw.reason).toBe(LZ_WATER);
      expect(dw.markerState).toBe(2);
      expect(await page.locator('[data-testid="deploy-status"]').getAttribute('data-state')).toBe('invalid');
      fs.writeFileSync(path.join(SHOT_DIR, 'deploy-red.png'), await page.screenshot());
      const wp = await t.project(waterAt.lat, waterAt.lon);
      await page.mouse.click(wp.x, wp.y);
      await t.settle(0.1, 1);
      expect((await t.props()).toasts).toContain('toast.lz.water');
      await t.advance(0.1, 3);
      expect((await t.state()).local.troops).toBeGreaterThan(troopsBefore - 100); // nothing was taken (only the slow decay of a purse above the cap)
      expect((await t.helis())[0]?.state).toBe(HELI_PAD);
      expect((await t.deploy()).active).toBe(true); // a refused click stays in the mode

      // --- the sliders: 300 troops, Low
      await page.evaluate(() => {
        const s = document.querySelector('[data-testid="deploy-troops"]') as HTMLInputElement;
        s.value = '300';
        s.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.locator('[data-testid="deploy-low"]').click();
      await t.settle(0.3, 1);
      expect((await t.deploy()).troops).toBe(300);

      // --- a valid zone: a green marker, the route (2 draw calls) and the marker (1), the flight time and fuel
      const dv = await hoverUntilReady(page, lz.cell);
      expect(dv.reason).toBe(0);
      expect(dv.markerState).toBe(1);
      expect(dv.routeVertices).toBeGreaterThanOrEqual(2);
      expect(dv.visibleMeshes).toBe(3);
      expect(await page.locator('[data-testid="deploy-status"]').getAttribute('data-state')).toBe('valid');
      expect(Number(await page.locator('[data-testid="deploy-info"]').getAttribute('data-eta'))).toBe(dv.etaSeconds);
      expect(dv.etaSeconds).toBeGreaterThan(0);
      const on = (await t.info()).drawCalls;
      await page.evaluate(() => (window as any).__test.deployLayer(false));
      await t.settle();
      const off = (await t.info()).drawCalls;
      await page.evaluate(() => (window as any).__test.deployLayer(true));
      expect(on - off).toBe(3);
      expect(on - callsIdle).toBeLessThanOrEqual(4);
      await t.settle(); // the layer is back on: draw it before the picture is taken
      fs.writeFileSync(path.join(SHOT_DIR, 'deploy-green.png'), await page.screenshot());
      // the route from a tilted, closer camera over the terrain
      await t.view({ lat: (at.lat + lzAt.lat) / 2, lon: (at.lon + lzAt.lon) / 2, distKm: 1500, heading: 0, tilt: 50 });
      await t.settle();
      fs.writeFileSync(path.join(SHOT_DIR, 'deploy-route-tilted.png'), await page.screenshot());
      await t.view({ lat: at.lat - 4, lon: at.lon + 4, distKm: 3200, heading: 0, tilt: 0 });
      await t.settle();
      await hoverUntilReady(page, lz.cell);

      // --- the throttle in the page: a handful of questions, never one per frame
      const asked = await t.deploy();
      expect(asked.queriesSent).toBeLessThan(40);

      // --- the left click sends: 300 troops leave, the helicopter flies away from the pad and lands, the mode closes by itself
      const vp = await t.project(lzAt.lat, lzAt.lon);
      const before = (await t.state()).local.troops;
      const start = (await t.helis())[0] as Drawn;
      await page.mouse.click(vp.x, vp.y);
      await t.advance(0.1, 8); // the host applies an intent a few ticks after it is sent
      await t.settle();
      expect((await t.deploy()).active).toBe(false);
      expect((await t.props()).toasts).toContain('deploy.sent');
      const after = (await t.state()).local.troops;
      expect(before - after).toBeGreaterThan(250);
      expect(before - after).toBeLessThan(350);
      await t.advance(0.1, 100);
      await t.settle();
      const flying = (await t.helis())[0] as Drawn;
      expect(flying.state).not.toBe(HELI_PAD);
      expect(Math.hypot(flying.cellX - start.cellX, flying.cellY - start.cellY)).toBeGreaterThan(3);
      await t.settle();
      fs.writeFileSync(path.join(SHOT_DIR, 'deploy-flying.png'), await page.screenshot());
      // the list shows it with a Recall button while it flies
      expect(await page.locator('[data-testid="heli-row"]').count()).toBe(1);
      expect(await page.locator('[data-testid="heli-recall"]').isVisible()).toBe(true);
      // fly on until the mission news says it has landed (the toast key of HeliWatcher / MissionWatcher)
      let landed = false;
      for (let i = 0; i < 45 && !landed; i++) {
        await t.advance(0.02, 10); // a hover lasts 30 ticks: look at least every 10, the news is made from the table the frame sees
        await t.settle();
        landed = (await t.props()).toasts.includes('toast.heli.landed');
      }
      expect(landed).toBe(true);
      // M12a-3 (merged): the landing took the zone cell for the player; the mirror and the ownership texture agree
      const mine = await page.evaluate((c) => (window as any).__test.ownerOf(c), capital);
      expect(await page.evaluate((c) => (window as any).__test.ownerOf(c), lz.cell)).toBe(mine);
      await t.settle();
      expect(await page.evaluate((c) => (window as any).__test.readOwnership([c]), lz.cell)).toEqual([mine]);
      fs.writeFileSync(path.join(SHOT_DIR, 'deploy-landed.png'), await page.screenshot());
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 480_000);

  // The beachhead-ownership assertion that waited for M12a-3 is part of the flow above since the merge (docs/DECISIONS.md "Round 16 integration").
});

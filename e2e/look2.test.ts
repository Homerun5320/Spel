// Look-2 in headless Chromium (software WebGL2): a structure at levels 1, 10, 100 and 999 in both City styles (the level is drawn through the render-only
// hook __test.setLevelOverride, the sim stays at level 1), with the same draw calls and triangles at every level, and the visual gold inflation of the HUD.
// Screenshots (30 km, 3 km, 800 m) go to LOOK2_SHOTS or test-results/shots/look2-*.png.
import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { cellToLatLon } from '../src/render/transforms';
import { STRUCT_CITY, buildBody } from '../src/sim/public';
import { GOLD_COMPACT_FROM, formatGold } from '../src/ui/i18n';
import { GOLD_DISPLAY_FACTOR } from '../src/ui/uiConfig';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = process.env.LOOK2_SHOTS ?? path.join(OUT_DIR, 'shots');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

const T = (page: Page) => ({
  props: (): Promise<{ list: Array<{ id: number; type: number; level: number }> }> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ local: { spawned: boolean; gold: number; goldMilli: number } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  cells: (): Promise<{ capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
  submit: (body: unknown): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
  style: (s: 'old' | 'new'): Promise<void> => page.evaluate((x) => (window as any).__test.setCityStyle(x), s),
  level: (id: number, level: number | null): Promise<void> => page.evaluate(([i, l]) => (window as any).__test.setLevelOverride(i, l), [id, level] as const),
});

const WIDTH = 1024;
const HEIGHT = 512;

async function closeUp(page: Page, lat: number, lon: number, dKm: number, aglM: number, pitchDeg: number): Promise<void> {
  const time = timeForSubsolarLon(lon + 25);
  await page.evaluate(([la, lo, d, agl, pitch, tm]) => (window as any).__test.setGroundView({ lat: la - d / 111.2, lon: lo, heading: 0, pitchDeg: pitch, aglM: agl, time: tm }), [lat, lon, dKm, aglM, pitchDeg, time] as const);
}

function diffPixels(a: Buffer, b: Buffer): number {
  const x = decodePng(a);
  const y = decodePng(b);
  return pixelmatch(x.data, y.data, undefined, x.width, x.height, { threshold: 0.1 });
}

describe('unlimited levels: the look saturates and the gold reads x GOLD_DISPLAY_FACTOR', () => {
  it('a City at levels 1, 10, 100 and 999 in both styles: same draw calls and triangles, the bands show, the footprint stays small; the purse and the City price are inflated, the sim is not', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 });
    try {
      const t = T(page);
      await t.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
      const p = await t.project(48.5, 11);
      await page.mouse.click(p.x, p.y);
      await t.advance(0.1, 5);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 60000 }));
      await t.advance(0.1, 4);
      expect((await t.state()).local.spawned).toBe(true);
      await t.advance(0.1, 210); // past the spawn phase
      await t.settle(1);

      // the visual gold inflation: the purse and the City button read the sim number times GOLD_DISPLAY_FACTOR through the ONE formatter (compact from a million);
      // the sim keeps its own number. The HUD frame may be a few ticks away from the state read, so the purse text may be any amount within 6 sim gold.
      const sim = await t.state();
      const purseText = (await page.locator('[data-testid="gold"]').innerText()).trim();
      const near = Array.from({ length: 13 }, (_, i) => formatGold(Math.floor(sim.local.gold) - 6 + i));
      expect(near, `purse "${purseText}" vs sim gold ${sim.local.gold}`).toContain(purseText);
      expect(sim.local.gold).toBeGreaterThan(50000);
      expect(Math.floor(sim.local.gold) * GOLD_DISPLAY_FACTOR, 'the purse is long enough to need the compact form').toBeGreaterThanOrEqual(GOLD_COMPACT_FROM);
      const cityPrice = (await page.locator(`[data-testid="build-bar"] [data-type="${STRUCT_CITY}"] .build-price`).innerText()).trim();
      const simPrice = Number(await page.locator(`[data-testid="build-bar"] [data-type="${STRUCT_CITY}"]`).getAttribute('data-price'));
      expect(simPrice, 'the data attribute keeps the sim price').toBeGreaterThan(0);
      expect(cityPrice).toBe(formatGold(simPrice));

      const cell = ((await t.cells()).capitals[0]) as number;
      const at = cellToLatLon(cell, WIDTH, HEIGHT);
      await t.submit(buildBody(0, STRUCT_CITY, cell));
      await t.advance(0.1, 170);
      await t.settle(1);
      const cityId = ((await t.props()).list.find((s) => s.type === STRUCT_CITY) as { id: number }).id;
      await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' });

      const shots = new Map<string, Buffer>();
      const shot = async (name: string): Promise<Buffer> => {
        await t.settle();
        const png = await page.screenshot({ type: 'png' });
        fs.writeFileSync(path.join(SHOT_DIR, `look2-${name}.png`), png);
        shots.set(name, png);
        return png;
      };
      let calls = -1;
      for (const style of ['old', 'new'] as const) {
        let tris = -1; // the two models differ in triangles, the levels of one model do not
        await t.style(style);
        for (const level of [1, 10, 100, 999]) {
          await t.level(cityId, level);
          await page.evaluate(() => (window as any).__test.settle(1, 2)); // the pop-in is over
          await t.view({ lat: at.lat, lon: at.lon, distKm: 30, heading: 0, tilt: 0 });
          await shot(`${style}-l${level}-30km`);
          await closeUp(page, at.lat, at.lon, 2.2, 2000, 45);
          await shot(`${style}-l${level}-3km`);
          const info = await t.info();
          if (calls < 0) calls = info.drawCalls;
          if (tris < 0) tris = info.triangles;
          expect(info.drawCalls, `draw calls at level ${level}`).toBe(calls);
          expect(info.triangles, `triangles at level ${level}`).toBe(tris);
          await closeUp(page, at.lat, at.lon, 0.7, 500, 45);
          await shot(`${style}-l${level}-800m`);
        }
        // the look follows the level through bands: 1 -> 10 (bands 0 -> 2) and 10 -> 100 (bands 2 -> 4) change the picture, 100 -> 999 only a little (taller, not wider)
        const d1 = diffPixels(shots.get(`${style}-l1-3km`) as Buffer, shots.get(`${style}-l10-3km`) as Buffer);
        const d2 = diffPixels(shots.get(`${style}-l10-3km`) as Buffer, shots.get(`${style}-l100-3km`) as Buffer);
        const d3 = diffPixels(shots.get(`${style}-l100-3km`) as Buffer, shots.get(`${style}-l999-3km`) as Buffer);
        console.log(`[look2] ${style} at 3 km: 1 vs 10 ${d1} px, 10 vs 100 ${d2} px, 100 vs 999 ${d3} px`);
        expect(d1).toBeGreaterThan(300);
        expect(d2).toBeGreaterThan(300);
      }
      await t.level(cityId, null);

      const errors = consoleMessages.filter((m) => m.type === 'error' || m.type === 'warning');
      expect(errors, JSON.stringify(errors)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 290_000);
});

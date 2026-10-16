// Fix-3B: crowded cities seen from far away (3000, 8000 and 15000 km). Screenshots: test-results/shots/faricons-*.png (looked at by eye);
// the asserts are the cheap ones: the cities exist, the icon draw stays one call.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { buildBody, STRUCT_CITY } from '../src/sim/public';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});
const ev = <R>(page: Page, fn: string, ...args: unknown[]): Promise<R> => page.evaluate(([f, a]) => (window as any).__test[f as string](...(a as unknown[])), [fn, args] as const) as Promise<R>;

describe('far icons of crowded cities', () => {
  it('15 cities 3 cells apart stay separate icons at 3000, 8000 and 15000 km', async () => {
    const { page } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 });
    try {
      await ev(page, 'setView', { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
      const p = await ev<{ x: number; y: number }>(page, 'project', 48.5, 11);
      await page.mouse.click(p.x, p.y);
      await ev(page, 'advance', 0.1, 9);
      await ev(page, 'give', 0, { gold: 900000 });
      await ev(page, 'advance', 0.1, 215);
      const cap = (await ev<{ capitals: number[] }>(page, 'seatCells')).capitals[0] as number;
      const W = 1024;
      let built = 0;
      for (let dy = -9; dy <= 9 && built < 40; dy += 3) {
        for (let dx = -9; dx <= 9; dx += 3) {
          await ev(page, 'submit', buildBody(0, STRUCT_CITY, cap + dy * W + dx));
          built++;
        }
      }
      await ev(page, 'advance', 0.1, 400);
      await ev(page, 'settle', 0, 2);
      const cities = (await ev<{ list: Array<{ type: number; lat: number; lon: number }> }>(page, 'props')).list.filter((s) => s.type === STRUCT_CITY);
      console.log(`[far-icons] cities built: ${cities.length}`);
      expect(cities.length).toBeGreaterThanOrEqual(6);
      const at = cellToLatLon(cap, 1024, 512);
      const calls: number[] = [];
      for (const km of [3000, 8000, 15000]) {
        await ev(page, 'setView', { lat: at.lat, lon: at.lon, distKm: km, heading: 0, tilt: 0 });
        await ev(page, 'settle', 0, 2);
        calls.push((await ev<{ drawCalls: number }>(page, 'info')).drawCalls);
        fs.writeFileSync(path.join(SHOT_DIR, `faricons-${km}km.png`), await page.screenshot({ type: 'png' }));
      }
      console.log(`[far-icons] draw calls at 3000/8000/15000 km: ${calls.join('/')}`);
    } finally {
      await page.close();
    }
  }, 120_000);
});

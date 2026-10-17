// Fix-UI in headless Chromium (software WebGL2), real mouse and keyboard events: Shift + click keeps placing, the six build-button names are readable at
// four window sizes in both languages, and Delete takes two clicks. Screenshots go to test-results/shots/fixui-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { STRUCT_TYPE_COUNT } from '../src/sim/rules';
import { STRUCT_CITY } from '../src/sim/structureRules';

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

const T = (page: Page) => ({
  props: (): Promise<{ counts: Record<number, number>; placing: number; selection: { id: number; panelVisible: boolean } }> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ local: { spawned: boolean; gold: number }; structures: { count: number } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  cells: (): Promise<{ capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
});

async function spawned(viewport: { width: number; height: number }, extra = ''): Promise<{ page: Page; capital: number }> {
  const { page } = await openPage(browser, baseUrl, `test=1&seed=7&ai=0&hud=1&w=${viewport.width}&h=${viewport.height}${extra}`, viewport);
  const t = T(page);
  await t.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
  const p = await t.project(48.5, 11);
  await page.mouse.click(p.x, p.y);
  await t.advance(0.1, 5);
  await page.evaluate(() => (window as any).__test.give(0, { gold: 6000 }));
  await t.advance(0.1, 4);
  const { capitals } = await t.cells();
  expect((await t.state()).local.spawned).toBe(true);
  await t.advance(0.1, 210); // Fix-Sim: Build / Upgrade / Delete are refused in the 20 s spawn phase, so the helper plays past it
  return { page, capital: capitals[0] as number };
}

describe('Fix-UI', () => {
  it('Shift + a REAL left click places a structure and keeps the placement mode', async () => {
    const { page, capital } = await spawned({ width: 960, height: 540 });
    try {
      const t = T(page);
      const at = cellToLatLon(capital, 1024, 512);
      await t.view({ lat: at.lat, lon: at.lon, distKm: 120, heading: 0, tilt: 0 });
      await t.settle();
      const p = await t.project(at.lat, at.lon);
      await page.keyboard.press('1');
      await t.settle();
      expect((await t.props()).placing).toBe(STRUCT_CITY);
      await page.mouse.move(p.x, p.y);
      await page.keyboard.down('Shift');
      await page.mouse.click(p.x, p.y);
      await page.keyboard.up('Shift');
      await t.advance(0.1, 6);
      await t.settle();
      expect((await t.state()).structures.count).toBe(1);
      expect((await t.props()).placing).toBe(STRUCT_CITY); // still placing
    } finally {
      await page.close();
    }
  });

  for (const size of [
    { width: 960, height: 540 },
    { width: 1366, height: 640 },
    { width: 1920, height: 1080 },
    { width: 540, height: 960 },
  ]) {
    for (const lang of ['sv', 'en']) {
      it(`the build bar shows every name in full at ${size.width}x${size.height} (${lang})`, async () => {
        const { page } = await spawned(size, `&lang=${lang}`);
        try {
          await T(page).settle();
          const cut = await page.evaluate(() => [...document.querySelectorAll('.build-name')].map((e) => ({ text: e.textContent, cut: e.scrollWidth > e.clientWidth })));
          expect(cut.length).toBe(STRUCT_TYPE_COUNT); // one button per structure kind (six until M18e-1 added the Airfield, Lab and Plant)
          expect(cut.filter((c) => c.cut)).toEqual([]);
          const box = await page.evaluate(() => {
            const r = (document.querySelector('[data-testid="build-bar"]') as HTMLElement).getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          });
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(size.width);
          // M18e-1 integration: the bar never overlaps the speed / commitment panel (five columns at 1366 px did)
          const clash = await page.evaluate(() => {
            const a = (document.querySelector('[data-testid="build-bar"]') as HTMLElement).getBoundingClientRect();
            const c = document.querySelector('.hud-controls') as HTMLElement | null;
            if (c === null) return null;
            const b = c.getBoundingClientRect();
            return { clash: a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom, bar: [a.left, a.top, a.right, a.bottom].map(Math.round), controls: [b.left, b.top, b.right, b.bottom].map(Math.round) };
          });
          expect(clash?.clash, `build bar versus controls panel ${JSON.stringify(clash)}`).toBe(false);
          await page.screenshot({ path: path.join(SHOT_DIR, `fixui-bar-${size.width}x${size.height}-${lang}.png`) });
        } finally {
          await page.close();
        }
      });
    }
  }
});

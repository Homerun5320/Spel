// M13a-1 in headless Chromium (software WebGL2): the helicopter is visible. The Factory panel's build button orders one (the real intent), the helicopter
// stands on the Factory's plate when the build time is over (`__test.helis()`), the fleet gauge in the top bar follows, the rotor changes the pixels by its
// uniform alone, the layer costs exactly one draw call, and four close-ups (3 km and 800 m, day and night) are written to test-results/shots/helis-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { cellToLatLon } from '../src/render/transforms';
import { HELI_PRICE_GOLD, HELI_BUILD_TICKS, BUILD_TICKS } from '../src/sim/rules';
import { STRUCT_FACTORY } from '../src/sim/structureRules';
import { HELI_PAD } from '../src/sim/heliTable';
import { formatGold } from '../src/ui/i18n';

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

interface Drawn {
  id: number;
  owner: number;
  state: number;
  cellX: number;
  cellY: number;
  lat: number;
  lon: number;
  aglM: number;
  parked: boolean;
}
const WIDTH = 1024;
const HEIGHT = 512;
const T = (page: Page) => ({
  props: (): Promise<{ toasts: string[]; selection: { id: number; panelVisible: boolean } }> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ local: { spawned: boolean }; structures: { byType: number[] } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  helis: (): Promise<Drawn[]> => page.evaluate(() => (window as any).__test.helis()),
  capital: async (): Promise<number> => ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals[0] as number,
  submit: (body: Record<string, unknown>): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
});

/** A close view of a place: the camera `dKm` south of it, `aglM` above the ground, at the sun time `time`. */
async function closeUp(page: Page, lat: number, lon: number, dKm: number, aglM: number, time: number): Promise<void> {
  await page.evaluate(([la, lo, d, agl, ti]) => (window as any).__test.setGroundView({ lat: la - d / 111.2, lon: lo, heading: 0, pitchDeg: 24, aglM: agl, time: ti }), [lat, lon, dKm, aglM, time] as const);
}

function diffBox(a: ReturnType<typeof decodePng>, b: ReturnType<typeof decodePng>, tol = 30): { n: number; x0: number; x1: number; y0: number; y1: number } {
  let n = 0;
  let x0 = a.width;
  let x1 = -1;
  let y0 = a.height;
  let y1 = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.abs((a.data[i] as number) - (b.data[i] as number)) + Math.abs((a.data[i + 1] as number) - (b.data[i + 1] as number)) + Math.abs((a.data[i + 2] as number) - (b.data[i + 2] as number));
      if (d > tol) {
        n++;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return { n, x0, x1, y0, y1 };
}

describe('the helicopter is visible', () => {
  it('order one from the Factory panel, see it stand on the plate, the gauges follow, the rotor and the draw call, four close-ups', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1');
    try {
      const t = T(page);
      await t.view({ lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 });
      const p0 = await t.project(48.5, 11);
      await page.mouse.click(p0.x, p0.y);
      await t.advance(0.1, 5);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 90000 }));
      await t.advance(0.1, 4);
      expect((await t.state()).local.spawned).toBe(true);
      await t.advance(0.1, 210); // past the spawn phase
      const capital = await t.capital();
      const at = cellToLatLon(capital, WIDTH, HEIGHT);
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_FACTORY, cell: capital });
      await t.advance(0.1, (BUILD_TICKS[STRUCT_FACTORY] as number) + 8);
      expect((await t.state()).structures.byType[STRUCT_FACTORY]).toBe(1);
      expect(await t.helis()).toEqual([]);
      const day = timeForSubsolarLon(at.lon + 25);
      const night = timeForSubsolarLon(at.lon + 180);
      await closeUp(page, at.lat, at.lon, 2.6, 1500, day);
      await t.settle();
      // the fleet gauge of the top bar: 0 of at least 3 (2 + the Factory's level)
      const gauge = page.locator('[data-testid="fleet"]');
      expect(await gauge.textContent()).toMatch(/^0\/\d+$/);

      // select the Factory: the build block appears with the price, no queue, the fleet line
      const pf = await t.project(at.lat, at.lon);
      await page.mouse.click(pf.x, pf.y);
      await t.settle();
      expect((await t.props()).selection.panelVisible).toBe(true);
      const btn = page.locator('[data-testid="sel-heli"]');
      expect(await btn.textContent()).toContain(formatGold(HELI_PRICE_GOLD));
      expect(await btn.getAttribute('aria-disabled')).toBeNull();
      expect(await page.locator('[data-testid="sel-heli-fleet"]').getAttribute('data-n')).toBe('0');
      expect(await page.locator('[data-testid="sel-heli-queue"]').isVisible()).toBe(false);

      // order one: queue line, dimmed button with the reason in text, gold taken
      const goldBefore = Number(await page.locator('[data-testid="gold"]').getAttribute('data-value'));
      await btn.click();
      await t.advance(0.1, 3);
      await t.settle();
      expect(await btn.getAttribute('aria-disabled')).toBe('true');
      expect(await page.locator('[data-testid="sel-heli-queue"]').isVisible()).toBe(true);
      expect((await page.locator('[data-testid="sel-heli-why"]').textContent()) ?? '').not.toBe('');
      expect(await page.locator('[data-testid="sel-heli-fleet"]').getAttribute('data-n')).toBe('1');
      expect(await gauge.textContent()).toMatch(/^1\//);
      expect(Number(await page.locator('[data-testid="gold"]').getAttribute('data-value'))).toBeLessThan(goldBefore - HELI_PRICE_GOLD + 50);
      expect(await t.helis()).toEqual([]); // under production: not drawn

      // the build time runs out: the helicopter stands at the Factory, a toast says so
      await t.advance(0.1, HELI_BUILD_TICKS + 4);
      await t.settle();
      const list = await t.helis();
      expect(list).toHaveLength(1);
      const h = list[0] as Drawn;
      expect([h.state, h.parked, h.owner, h.aglM]).toEqual([HELI_PAD, true, 1, 0]);
      expect(Math.abs(h.cellX - (capital % WIDTH) - 0.5)).toBeLessThan(0.5);
      expect(Math.abs(h.cellY - Math.floor(capital / WIDTH) - 0.5)).toBeLessThan(0.5);
      expect((await t.props()).toasts).toContain('toast.heli.produced');
      expect(await btn.getAttribute('aria-disabled')).toBeNull();

      // the rotor alone: two renders with the same spin are identical, a quarter of the blade period later they differ near the helicopter only
      await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' });
      await page.keyboard.press('Escape');
      await closeUp(page, at.lat, at.lon, 0.6, 520, day);
      await page.evaluate(() => (window as any).__test.heliSpin(0));
      await t.settle();
      const a = decodePng(await page.screenshot());
      await t.settle();
      const a2 = decodePng(await page.screenshot());
      expect(diffBox(a, a2).n).toBe(0);
      await page.evaluate(() => (window as any).__test.heliSpin(Math.PI / 4));
      await t.settle();
      const b = decodePng(await page.screenshot());
      const d = diffBox(b, a);
      expect(d.n).toBeGreaterThan(40);
      expect((d.x1 - d.x0) * (d.y1 - d.y0)).toBeLessThan(0.25 * a.width * a.height);
      await page.evaluate(() => (window as any).__test.heliSpin(null));

      // one draw call: the scene with and without the layer
      await t.settle();
      const withLayer = (await t.info()).drawCalls;
      await page.evaluate(() => (window as any).__test.heliLayer(false));
      await t.settle();
      const without = (await t.info()).drawCalls;
      await page.evaluate(() => (window as any).__test.heliLayer(true));
      expect(withLayer - without).toBe(1);
      expect((await t.helis()).length).toBeLessThanOrEqual(64);

      // the four close-ups for the eye
      for (const [name, dKm, agl, time] of [
        ['3km-day', 2.6, 1500, day],
        ['800m-day', 0.6, 520, day],
        ['3km-night', 2.6, 1500, night],
        ['800m-night', 0.6, 520, night],
      ] as const) {
        await closeUp(page, at.lat, at.lon, dKm, agl, time);
        await t.settle();
        fs.writeFileSync(path.join(SHOT_DIR, `helis-${name}.png`), await page.screenshot());
      }
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 240_000);
});

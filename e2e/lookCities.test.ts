// Look-1 in headless Chromium (software WebGL2): the two City styles ('old' / 'new') and the City tiers by level, the close-range City size, and the
// fast "open city" flight. Screenshots go to test-results/shots/look-*.png; the goldens city-old.png and city-new.png are the top level (10, Sim-Growth) City at 3 km.
import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, compareGolden, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { cellToLatLon } from '../src/render/transforms';
import { STRUCT_CITY, buildBody, maxLevelOf, upgradeBody, upgradeTicksOf } from '../src/sim/public';

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
  props: (): Promise<{ cityStyle: string; list: Array<{ id: number; type: number; level: number }>; selection: { panelVisible: boolean } }> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ local: { spawned: boolean } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  cells: (): Promise<{ capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
  submit: (body: unknown): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
  style: (s: 'old' | 'new'): Promise<void> => page.evaluate((x) => (window as any).__test.setCityStyle(x), s),
  flying: (): Promise<boolean> => page.evaluate(() => (window as any).__test.flightActive()),
  agl: (): Promise<number> => page.evaluate(() => (window as any).__test.cameraAglM()),
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

describe('the City styles and tiers', () => {
  it('draws both styles in the same draw calls, differing in pixels; levels 1, 5 and 10 differ; the switch is live; goldens; the fast open-city flight', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 });
    try {
      const t = T(page);
      expect((await t.props()).cityStyle).toBe('old'); // the default: nothing changes by itself
      await t.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
      const p = await t.project(48.5, 11);
      await page.mouse.click(p.x, p.y);
      await t.advance(0.1, 5);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 60000 }));
      await t.advance(0.1, 4);
      expect((await t.state()).local.spawned).toBe(true);
      await t.advance(0.1, 210); // past the spawn phase
      const cell = ((await t.cells()).capitals[0]) as number;
      const at = cellToLatLon(cell, WIDTH, HEIGHT);
      await t.submit(buildBody(0, STRUCT_CITY, cell));
      await t.advance(0.1, 170);
      await t.settle(1);
      const cityId = ((await t.props()).list.find((s) => s.type === STRUCT_CITY) as { id: number }).id;
      const hideHud = await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' });
      const shot = async (name: string): Promise<Buffer> => {
        await t.settle();
        const png = await page.screenshot({ type: 'png' });
        fs.writeFileSync(path.join(SHOT_DIR, `look-${name}.png`), png);
        return png;
      };

      // the size policy at five distances (looked at by eye; the asserts below are the cheap ones)
      for (const [name, d, agl, pitch] of [['3000km', 0, 0, 0], ['300km', 0, 0, 0], ['30km', 0, 0, 0]] as const) {
        const km = name === '3000km' ? 3000 : name === '300km' ? 300 : 30;
        await t.view({ lat: at.lat, lon: at.lon, distKm: km, heading: 0, tilt: d + agl + pitch });
        await shot(`size-${name}`);
      }
      await closeUp(page, at.lat, at.lon, 2.2, 2000, 45);
      await shot('size-3km');
      await closeUp(page, at.lat, at.lon, 0.7, 500, 45);
      await shot('size-800m');

      // level 1, old and new, at 3 km
      await closeUp(page, at.lat, at.lon, 2.2, 2000, 45);
      const callsOld = (await t.info()).drawCalls;
      const oldL1 = await shot('old-l1');
      await t.style('new');
      expect((await t.props()).cityStyle).toBe('new');
      const newL1 = await shot('new-l1');
      expect((await t.info()).drawCalls, 'the switch adds no draw call').toBe(callsOld);
      const styleDiff = diffPixels(oldL1, newL1);
      console.log(`[look] old vs new at level 1: ${styleDiff} px differ`);
      expect(styleDiff).toBeGreaterThan(300);

      // levels 5 and 10 (Sim-Growth: the City climbs in ten small steps, five visual bands): both styles each time
      const top = maxLevelOf(STRUCT_CITY);
      let level = 1;
      const raiseTo = async (to: number): Promise<void> => {
        for (; level < to; ) {
          level++;
          await t.submit(upgradeBody(0, cityId));
          await t.advance(0.1, upgradeTicksOf(STRUCT_CITY, level) + 10);
        }
        await t.settle(1);
        expect((await t.props()).list.find((s) => s.id === cityId)?.level).toBe(to);
        await page.evaluate(() => (window as any).__test.settle(1, 2)); // the pop-in is over
      };
      await t.style('old');
      await raiseTo(5);
      const oldL5 = await shot('old-l5');
      await t.style('new');
      const newL5 = await shot('new-l5');
      await raiseTo(top);
      await t.style('old');
      const oldTop = await shot(`old-l${top}`);
      await t.style('new');
      const newTop = await shot(`new-l${top}`);
      const tierMidOld = diffPixels(oldL1, oldL5);
      const tierMidNew = diffPixels(newL1, newL5);
      const tierTopOld = diffPixels(oldL5, oldTop);
      const tierTopNew = diffPixels(newL5, newTop);
      console.log(`[look] level 1 vs 5: old ${tierMidOld} px, new ${tierMidNew} px; level 5 vs ${top}: old ${tierTopOld} px, new ${tierTopNew} px; old vs new at ${top}: ${diffPixels(oldTop, newTop)} px`);
      for (const n of [tierMidOld, tierMidNew, tierTopOld, tierTopNew]) expect(n).toBeGreaterThan(300);
      expect(diffPixels(oldTop, newTop)).toBeGreaterThan(300);
      for (const [png, name] of [[oldTop, 'city-old'], [newTop, 'city-new']] as const) {
        const g = compareGolden(png, name);
        console.log(`[golden] ${name}: ${g.status}, ${g.diffPixels} px differ`);
      }

      await hideHud.evaluate((n) => (n as Element).remove());
      // the fast open-city flight: from 3000 km the camera is at the City (1500 m up) within 2.5 s of fx time, the panel opens at once
      await closeUp(page, at.lat, at.lon, 2.2, 2000, 45);
      await t.settle(1);
      const q = await t.project(at.lat, at.lon);
      await page.mouse.click(q.x, q.y);
      await t.settle(1);
      await t.view({ lat: at.lat, lon: at.lon, distKm: 3000, heading: 0, tilt: 0 });
      await t.settle(1);
      expect((await t.props()).selection.panelVisible).toBe(true);
      await page.locator('[data-testid="sel-open-city"]').click();
      expect(await page.locator('[data-testid="city-view"]').isVisible(), 'the panel opens at once').toBe(true);
      await t.advance(0.3, 0);
      await t.settle(1);
      expect(await t.flying(), 'still flying after 0.3 s').toBe(true);
      await t.advance(2.5, 0);
      await t.settle(1);
      expect(await t.flying(), 'arrived within 2.8 s of fx time').toBe(false);
      expect(Math.abs((await t.agl()) - 1500)).toBeLessThan(150);
      const c = await t.project(at.lat, at.lon);
      expect(Math.hypot(c.x - 480, c.y - 270), 'the City is at the screen centre').toBeLessThan(60);
      await page.keyboard.press('Escape');
      await t.settle(1);
      expect(await page.locator('[data-testid="city-view"]').isVisible(), 'Escape closes the city view').toBe(false);

      const errors = consoleMessages.filter((m) => m.type === 'error' || m.type === 'warning');
      expect(errors, JSON.stringify(errors)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 280_000);
});

// Fix-3B: after "Öppna stad" on a level-9 City with five districts every district projects inside the window minus the city panel (960x540,
// 1366x768 and portrait 540x960), and Escape during the fast open-city flight stops the flight. Screenshots: test-results/shots/cityfit-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { buildBody, buildDistrictBody, upgradeBody, upgradeTicksOf, STRUCT_CITY } from '../src/sim/public';

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
/** Fix-Audit2 (mutation 13): the total draw-call cap is 100 (the M21 target) but the whole city scene measures far less; this ceiling is the measured value plus a small margin, so a regression from 13 to 99 fails. */
const DRAW_CALL_CEILING = 10; // measured 7 (terrain, shell, stars, City model, ring, icons, districts)
const tid = (id: string): string => `[data-testid="${id}"]`;

/** A level-9 City at the capital with all five district slots built; the camera high above, the City selected. Returns the City's place. */
async function cityOfLevel9(page: Page): Promise<{ lat: number; lon: number; id: number }> {
  await ev(page, 'setView', { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
  const p = await ev<{ x: number; y: number }>(page, 'project', 48.5, 11);
  await page.mouse.click(p.x, p.y);
  await ev(page, 'advance', 0.1, 9);
  await ev(page, 'give', 0, { gold: 900000 });
  await ev(page, 'advance', 0.1, 215);
  const cell = (await ev<{ capitals: number[] }>(page, 'seatCells')).capitals[0] as number;
  const at = cellToLatLon(cell, 1024, 512);
  await ev(page, 'submit', buildBody(0, STRUCT_CITY, cell));
  await ev(page, 'advance', 0.1, 170);
  await ev(page, 'settle', 0, 2);
  const id = ((await ev<{ list: Array<{ id: number; type: number }> }>(page, 'props')).list.find((s) => s.type === STRUCT_CITY) as { id: number }).id;
  for (let level = 2; level <= 9; level++) {
    await ev(page, 'submit', upgradeBody(0, id));
    await ev(page, 'advance', 0.1, upgradeTicksOf(STRUCT_CITY, level) + 10);
  }
  for (let slot = 0; slot < 5; slot++) await ev(page, 'submit', buildDistrictBody(0, id, slot, slot === 4 ? 2 : (slot % 4) + 1));
  await ev(page, 'advance', 0.1, 200);
  return { ...at, id };
}

async function openAndMeasure(page: Page, at: { lat: number; lon: number }, name: string): Promise<{ inside: number; total: number; rows: string[] }> {
  await ev(page, 'setView', { lat: at.lat, lon: at.lon, distKm: 400, heading: 0, tilt: 40 });
  await ev(page, 'settle', 0, 2);
  const p = await ev<{ x: number; y: number }>(page, 'project', at.lat, at.lon);
  await page.mouse.click(p.x, p.y);
  await ev(page, 'settle', 0, 2);
  await page.locator(tid('sel-open-city')).click();
  await ev(page, 'settle', 0.25, 12); // 3 fx seconds: the flight is at most 1.8
  expect(await ev<boolean>(page, 'flightActive')).toBe(false);
  await ev(page, 'render');
  fs.writeFileSync(path.join(SHOT_DIR, `cityfit-${name}.png`), await page.screenshot({ type: 'png' }));
  const calls = (await ev<{ drawCalls: number }>(page, 'info')).drawCalls;
  console.log(`[cityfit] ${name}: ${calls} draw calls`);
  expect(calls, 'draw calls of the city view (terrain, shell, stars, structures, ring, icons, districts)').toBeLessThanOrEqual(DRAW_CALL_CEILING);
  const vp = page.viewportSize() as { width: number; height: number };
  const panel = (await page.locator(tid('city-view')).boundingBox()) as { x: number; y: number; width: number; height: number };
  // the free part of the window: left of a side panel, above a bottom sheet
  const free = panel.x > vp.width / 3 ? { x0: 0, y0: 0, x1: panel.x, y1: vp.height } : { x0: 0, y0: 0, x1: vp.width, y1: panel.y };
  const list = (await ev<{ districts: { list: Array<{ lat: number; lon: number; slot: number }> } }>(page, 'props')).districts.list;
  let inside = 0;
  const rows: string[] = [];
  for (const d of list) {
    const q = await ev<{ x: number; y: number }>(page, 'project', d.lat, d.lon);
    const ok = q.x > free.x0 && q.x < free.x1 && q.y > free.y0 && q.y < free.y1;
    if (ok) inside++;
    rows.push(`slot ${d.slot}: (${Math.round(q.x)}, ${Math.round(q.y)}) ${ok ? 'in' : 'OUT'}`);
  }
  console.log(`[cityfit] ${name}: panel x ${Math.round(panel.x)} y ${Math.round(panel.y)}; free ${JSON.stringify(free)}; ${rows.join('; ')}`);
  return { inside, total: list.length, rows };
}

describe('open city shows the whole city', () => {
  for (const [w, h] of [
    [960, 540],
    [1366, 768],
    [540, 960],
  ] as const) {
    it(`all five districts of a level-9 City are in the free part of ${w}x${h}`, async () => {
      const { page } = await openPage(browser, baseUrl, `test=1&seed=7&ai=0&hud=1&w=${w}&h=${h}`, { width: w, height: h });
      try {
        const at = await cityOfLevel9(page);
        const r = await openAndMeasure(page, at, `${w}x${h}`);
        expect(r.total).toBe(5);
        expect(r.inside, r.rows.join('; ')).toBe(5);
      } finally {
        await page.close();
      }
    }, 120_000);
  }

  it('Escape during the open-city flight stops the flight', async () => {
    const { page } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 });
    try {
      const at = await cityOfLevel9(page);
      await ev(page, 'setView', { lat: at.lat, lon: at.lon, distKm: 400, heading: 0, tilt: 40 });
      await ev(page, 'settle', 0, 2);
      const p = await ev<{ x: number; y: number }>(page, 'project', at.lat, at.lon);
      await page.mouse.click(p.x, p.y);
      await ev(page, 'settle', 0, 2);
      await page.locator(tid('sel-open-city')).click();
      await ev(page, 'settle', 0.1, 4);
      expect(await ev<boolean>(page, 'flightActive')).toBe(true);
      await page.keyboard.press('Escape');
      await ev(page, 'settle', 0.1, 2);
      expect(await page.locator(tid('city-view')).isVisible()).toBe(false);
      expect(await ev<boolean>(page, 'flightActive')).toBe(false);
    } finally {
      await page.close();
    }
  }, 120_000);
});

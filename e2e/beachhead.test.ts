// Fix-4B in headless Chromium (software WebGL2): the beachhead of a helicopter landing is shown and explained. A real helicopter lands 10 troops on neutral ground far from the
// nation (fixed seed 7, ai=0, so nothing else attacks or grows it): the pulsing ring and the count-down chip appear, 45 seconds later the land goes back to neutral and the
// toast says why. Screenshot: test-results/shots/beachhead-ring.png (LOOK at it).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { launchHeliBody } from '../src/sim/intents';
import { BEACHHEAD_REVERT_TICKS, BUILD_TICKS, HELI_BUILD_TICKS } from '../src/sim/rules';
import { STRUCT_FACTORY } from '../src/sim/structureRules';

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

interface Beach {
  rows: Array<{ slot: number; seed: number; landTick: number; cells: number; seconds: number }>;
  ring: { count: number; cells: number[]; drawIndices: number };
}
const T = (page: Page) => ({
  props: (): Promise<{ toasts: string[]; selection: { id: number } }> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ local: { spawned: boolean } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (dt = 0, n = 1): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.settle(d, k), [dt, n] as const),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  beach: (): Promise<Beach> => page.evaluate(() => (window as any).__test.beach()),
  capital: async (): Promise<number> => ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals[0] as number,
  submit: (body: Record<string, unknown>): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
});

describe('the beachhead is shown and explained', () => {
  it('a landing makes a ring and a count-down chip; 45 seconds later the land is neutral again and a toast says why', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1');
    try {
      const t = T(page);
      await t.view({ lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 });
      const p0 = await t.project(48.5, 11);
      await page.mouse.click(p0.x, p0.y);
      await t.advance(0.1, 5);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 90000, troops: 5000 }));
      await t.advance(0.1, 4);
      expect((await t.state()).local.spawned).toBe(true);
      await t.advance(0.1, 210);
      const capital = await t.capital();
      const at = cellToLatLon(capital, WIDTH, HEIGHT);
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_FACTORY, cell: capital });
      await t.advance(0.1, (BUILD_TICKS[STRUCT_FACTORY] as number) + 8);
      const pf = await t.project(at.lat, at.lon);
      await page.mouse.click(pf.x, pf.y);
      await t.settle();
      const factory = (await t.props()).selection.id;
      expect(factory).toBeGreaterThanOrEqual(0);
      await page.locator('[data-testid="sel-heli"]').click();
      await t.advance(0.1, HELI_BUILD_TICKS + 4);
      // no beachhead yet: no ring, no chip
      expect((await t.beach()).ring.count).toBe(0);
      expect(await page.locator('[data-testid="beach-chip"]').isHidden()).toBe(true);

      // a landing zone the page's own preview accepts, 25 to 40 cells from the capital (so that the landing does not touch the nation)
      const lz = await page.evaluate(
        ([cap, w, fac]) => {
          const cx = cap % w;
          const cy = (cap - cx) / w;
          let best: { cell: number; d: number } | null = null;
          for (let dy = -40; dy <= 40; dy += 3) {
            for (let dx = -40; dx <= 40; dx += 3) {
              const d = Math.hypot(dx, dy);
              const x = cx + dx;
              const y = cy + dy;
              if (d < 25 || d > 40 || x < 0 || x >= w || y < 0 || y >= 512) continue;
              const cell = y * w + x;
              const r = (window as any).__test.previewNow(fac, cell, 10, 0);
              if (r !== null && r.reason === 0 && r.waypoints >= 2 && (best === null || d < best.d)) best = { cell, d };
            }
          }
          return best;
        },
        [capital, WIDTH, factory] as const,
      );
      expect(lz, 'a valid landing zone').not.toBeNull();
      const zone = (lz as { cell: number }).cell;
      await t.submit({ ...launchHeliBody(0, factory, zone, 10, 0) });
      let beach = await t.beach();
      for (let i = 0; i < 80 && beach.rows.length === 0; i++) {
        await t.advance(0.02, 10);
        beach = await t.beach();
      }
      expect(beach.rows.length, 'the landing made a beachhead row').toBe(1);
      const row = beach.rows[0] as Beach['rows'][number];
      expect(row.cells).toBeGreaterThanOrEqual(1);
      expect(row.cells).toBeLessThan(80); // the landing takes 1 to 9 cells, the rest of the load attacks on from them
      // the ring stands on the seed, and the chip counts the seconds down
      await t.settle(0.05, 1);
      beach = await t.beach();
      expect(beach.ring.count).toBe(1);
      expect(beach.ring.cells).toEqual([row.seed]);
      expect(beach.ring.drawIndices).toBeGreaterThan(0);
      const chip = page.locator('[data-testid="beach-chip"]');
      expect(await chip.isVisible()).toBe(true);
      const text1 = (await chip.textContent()) ?? '';
      expect(text1).toContain('Brohuvud');
      expect(text1).toContain(`${row.cells}/80`);
      const sec1 = Number(/(\d+) s kvar/.exec(text1)?.[1]);
      expect(sec1).toBeGreaterThan(0);
      expect(sec1).toBeLessThanOrEqual(45);
      await t.advance(0.02, 100); // 10 more sim seconds
      await t.settle(0.05, 1);
      const sec2 = Number(/(\d+) s kvar/.exec((await chip.textContent()) ?? '')?.[1]);
      expect(sec2).toBeLessThanOrEqual(sec1 - 9);
      // a picture to look at: the camera over the landing
      const zl = cellToLatLon(row.seed, WIDTH, HEIGHT);
      await t.view({ lat: zl.lat, lon: zl.lon, distKm: 420, heading: 0, tilt: 0.6 });
      await t.settle(0.05, 1);
      fs.writeFileSync(path.join(SHOT_DIR, 'beachhead-ring.png'), await page.screenshot());

      // 45 seconds after the landing the cluster is neutral again, the ring and the chip are gone, the toast says why
      let gone = false;
      for (let i = 0; i < 60 && !gone; i++) {
        await t.advance(0.02, 10);
        gone = (await t.beach()).rows.length === 0;
      }
      expect(gone).toBe(true);
      await t.settle(0.05, 1);
      expect((await t.props()).toasts).toContain('toast.beach.reverted');
      expect((await t.beach()).ring.count).toBe(0);
      expect(await chip.isHidden()).toBe(true);
      expect(await page.evaluate((c) => (window as any).__test.ownerOf(c), row.seed)).toBe(0);
      expect(BEACHHEAD_REVERT_TICKS).toBe(450);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 480_000);
});

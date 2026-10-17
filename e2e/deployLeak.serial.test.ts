// M13b leak test (tagged leak-test, serial project): the deploy mode with a live preview, the route and the marker on screen, 60 render calls (3 rounds x 20)
// at 320x180. The geometry counts of `renderer.info` do not move and the retained heap stays under 5 MB (median of 3). The layer's buffers are created once;
// this proves that a moving cursor (new routes every 0.2 s) and a render per call add nothing.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { heapDelta, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { BUILD_TICKS, HELI_BUILD_TICKS } from '../src/sim/rules';
import { STRUCT_FACTORY } from '../src/sim/structureRules';

const MB = 1_000_000;
const WIDTH = 1024;
const HEIGHT = 512;
let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

const ev = <R>(page: Page, fn: string, ...args: unknown[]): Promise<R> => page.evaluate(([f, a]) => (window as any).__test[f as string](...(a as unknown[])), [fn, args] as const) as Promise<R>;

describe('leak-test: the deploy layer', () => {
  it('60 render calls with the deploy mode on, a moving cursor, a route and a marker retain less than 5 MB (median of 3); the geometry count is unchanged', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 }, { isolated: true }); // set up at a size where the panel fits, measure at 320x180
    try {
      await ev(page, 'setView', { lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 });
      const p0 = await ev<{ x: number; y: number }>(page, 'project', 48.5, 11);
      await page.mouse.click(p0.x, p0.y);
      await ev(page, 'advance', 0.1, 5);
      await ev(page, 'give', 0, { gold: 90000, troops: 5000 });
      await ev(page, 'advance', 0.1, 214);
      const capital = ((await ev<{ capitals: number[] }>(page, 'seatCells')).capitals[0]) as number;
      await ev(page, 'submit', { kind: 'Build', seat: 0, type: STRUCT_FACTORY, cell: capital });
      await ev(page, 'advance', 0.1, (BUILD_TICKS[STRUCT_FACTORY] as number) + 8);
      const at = cellToLatLon(capital, WIDTH, HEIGHT);
      const pf = await ev<{ x: number; y: number }>(page, 'project', at.lat, at.lon);
      await page.mouse.click(pf.x, pf.y);
      await ev(page, 'settle', 0, 1);
      const factory = (await ev<{ selection: { id: number } }>(page, 'props')).selection.id;
      await ev(page, 'submit', { kind: 'ProduceHeli', seat: 0, factory });
      await ev(page, 'advance', 0.1, HELI_BUILD_TICKS + 4);
      await page.keyboard.press('l'); // the deploy mode by its key
      await ev(page, 'settle', 0, 1);
      await ev(page, 'resize', 320, 180); // the canvas and the camera at the leak-test size (the page stays 960x540, the mouse stays on the canvas)
      await ev(page, 'settle', 0, 2);
      expect((await ev<{ active: boolean }>(page, 'deploy')).active).toBe(true);
      // a valid zone near the capital found by the page's own preview
      const lz = await page.evaluate(
        ([cap, w, fac]) => {
          const cx = cap % w;
          const cy = (cap - cx) / w;
          for (let r = 20; r < 60; r += 4) {
            for (let a = 0; a < 16; a++) {
              const x = Math.round(cx + r * Math.cos((a * Math.PI) / 8));
              const y = Math.round(cy + r * Math.sin((a * Math.PI) / 8));
              if (x < 0 || x >= w || y < 0 || y >= 512) continue;
              const q = (window as any).__test.previewNow(fac, y * w + x, 1, 0);
              if (q !== null && q.reason === 0) return y * w + x;
            }
          }
          return -1;
        },
        [capital, WIDTH, factory] as const,
      );
      expect(lz).toBeGreaterThanOrEqual(0);
      const ll = cellToLatLon(lz, WIDTH, HEIGHT);
      await page.addStyleTag({ content: '.hud-root, .hud-root * { pointer-events: none !important; }' }); // the panel is big on a 320 px page: it must not catch the cursor
      await ev(page, 'setView', { lat: ll.lat, lon: ll.lon, distKm: 2000, heading: 0, tilt: 0 });
      await ev(page, 'settle', 0, 1);
      const frames = async (n: number, wiggle: number): Promise<void> => {
        for (let i = 0; i < n; i++) {
          const q = await ev<{ x: number; y: number }>(page, 'project', ll.lat, ll.lon);
          await page.mouse.move(q.x + ((i + wiggle) % 3), q.y + (i % 2)); // the cursor keeps moving: the preview asks again
          await ev(page, 'settle', 0.25, 1); // one draw per call, the fx clock steps past the preview's interval
        }
      };
      await frames(20, 0); // warm-up outside the measurement: shader compile and first-use allocations are not leaks
      const d0 = await ev<{ routeVertices: number; markerCell: number }>(page, 'deploy');
      expect(d0.markerCell).toBeGreaterThanOrEqual(0);
      const before = await ev<{ geometries: number; textures: number }>(page, 'info');
      const delta = await heapDelta(page, async () => {
        for (let round = 0; round < 3; round++) await frames(20, round);
      });
      const after = await ev<{ geometries: number; textures: number }>(page, 'info');
      console.log(`[leak-test] deploy layer heap delta: ${(delta / MB).toFixed(3)} MB, geometries ${before.geometries} -> ${after.geometries}, textures ${before.textures} -> ${after.textures}`);
      expect(after.geometries).toBe(before.geometries);
      expect(after.textures).toBe(before.textures);
      expect(delta).toBeLessThan(5 * MB);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 300_000);
});

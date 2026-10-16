// Fix-4B: the deploy mode and the Factory panel allocate (next to nothing) per frame. The JS heap is read after every frame (`performance.memory`, precise mode); the growth
// from one frame to the next is the memory the frame allocated (a frame in which the GC freed more than it allocated reads as a drop and is left out, and counted). The
// test measures three states of one match at 320x180 over FRAMES frames each: nothing selected (the baseline: the render itself), a Factory selected (the panel's helicopter list
// and signatures) and the deploy mode on with a resting cursor and a ready preview (the pick, the request key, the marker key); the extra of the two over the baseline is held
// to a small number. The numbers before and after the fix are in docs/DECISIONS.md (Fix-4B). Serial: it measures, and a second Chromium would disturb it.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { BUILD_TICKS, HELI_BUILD_TICKS } from '../src/sim/rules';
import { STRUCT_FACTORY } from '../src/sim/structureRules';

const WIDTH = 1024;
const HEIGHT = 512;
const FRAMES = 120;
/**
 * The extra bytes per frame the Factory panel and the deploy mode may allocate over the state before them. Measured (docs/DECISIONS.md Fix-4B): before the fix the deploy mode
 * allocated about +137 000 bytes a frame over a selected Factory (the pick, ray and hit objects); after it +/- 3 000, which is the noise of the reading (the render itself
 * allocates 20 000 to 40 000 bytes a frame, the baseline state a few thousand more or less than the others).
 */
const ALLOWED_EXTRA_BYTES_PER_FRAME = 12000;
let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

const ev = <R>(page: Page, fn: string, ...args: unknown[]): Promise<R> => page.evaluate(([f, a]) => (window as any).__test[f as string](...(a as unknown[])), [fn, args] as const) as Promise<R>;

interface Alloc {
  perFrame: number;
  drops: number;
}
/** Bytes allocated per frame over `frames` frames of the page (one draw each, the fx clock steps 0.05 s); the heap figure is V8's own (`Runtime.getHeapUsage`, exact, unlike `performance.memory`). */
async function allocatedPerFrame(page: Page, frames: number): Promise<Alloc> {
  const cdp = await page.context().newCDPSession(page);
  const used = async (): Promise<number> => ((await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }).usedSize;
  try {
    await ev(page, 'settle', 0.05, 1);
    let prev = await used();
    let sum = 0;
    let drops = 0;
    let counted = 0;
    for (let i = 0; i < frames; i++) {
      await ev(page, 'settle', 0.05, 1);
      const now = await used();
      if (now >= prev) {
        sum += now - prev;
        counted++;
      } else drops++;
      prev = now;
    }
    return { perFrame: counted === 0 ? 0 : Math.round(sum / counted), drops };
  } finally {
    await cdp.detach();
  }
}

describe('allocation per frame: the deploy mode and the Factory panel', () => {
  it('a selected Factory and the deploy mode with a resting cursor allocate almost nothing more than the render itself', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 }, { isolated: true });
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
      expect(factory).toBeGreaterThanOrEqual(0);
      await ev(page, 'submit', { kind: 'ProduceHeli', seat: 0, factory });
      await ev(page, 'advance', 0.1, HELI_BUILD_TICKS + 4);
      // a valid zone found by the page's own preview
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

      // --- baseline: the Factory deselected (Escape leaves the selection mode; nothing else is open)
      await page.keyboard.press('Escape');
      await ev(page, 'settle', 0, 1);
      expect((await ev<{ selection: { panelVisible: boolean } }>(page, 'props')).selection.panelVisible).toBe(false);
      await ev(page, 'resize', 320, 180);
      await page.addStyleTag({ content: '.hud-root, .hud-root * { pointer-events: none !important; }' });
      await ev(page, 'setView', { lat: ll.lat, lon: ll.lon, distKm: 2000, heading: 0, tilt: 0 });
      await ev(page, 'settle', 0, 2);
      await allocatedPerFrame(page, 20); // warm-up: shader compile, first-use allocations
      const base = await allocatedPerFrame(page, FRAMES);

      // --- the Factory selected again (a click on it: the camera looks at the capital for that)
      await ev(page, 'setView', { lat: at.lat, lon: at.lon, distKm: 900, heading: 0, tilt: 0 });
      await ev(page, 'settle', 0, 1);
      const pc = await ev<{ x: number; y: number }>(page, 'project', at.lat, at.lon);
      await page.mouse.click(pc.x, pc.y);
      await ev(page, 'settle', 0, 1);
      expect((await ev<{ selection: { id: number } }>(page, 'props')).selection.id).toBe(factory);
      await ev(page, 'setView', { lat: ll.lat, lon: ll.lon, distKm: 2000, heading: 0, tilt: 0 }); // the same view as the baseline: the render costs the same
      await ev(page, 'settle', 0, 2);
      await allocatedPerFrame(page, 20);
      const selected = await allocatedPerFrame(page, FRAMES);

      // --- the deploy mode with the cursor resting on a valid zone and the answer in
      await page.keyboard.press('l');
      await ev(page, 'setView', { lat: ll.lat, lon: ll.lon, distKm: 2000, heading: 0, tilt: 0 });
      await ev(page, 'settle', 0, 1);
      const q = await ev<{ x: number; y: number }>(page, 'project', ll.lat, ll.lon);
      await page.mouse.move(q.x, q.y);
      for (let i = 0; i < 12; i++) await ev(page, 'settle', 0.3, 1); // the preview answers and the cursor rests
      const d = await ev<{ active: boolean; markerCell: number; status: string }>(page, 'deploy');
      expect(d.active).toBe(true);
      expect(d.markerCell).toBeGreaterThanOrEqual(0);
      expect(d.status).toBe('ready');
      await allocatedPerFrame(page, 20);
      const deploy = await allocatedPerFrame(page, FRAMES);

      console.log(`[alloc] bytes per frame: baseline ${base.perFrame} (${base.drops} GC drops), Factory selected ${selected.perFrame} (${selected.drops}), deploy mode ${deploy.perFrame} (${deploy.drops})`);
      console.log(`[alloc] extra: selected over the baseline ${selected.perFrame - base.perFrame}, deploy over selected ${deploy.perFrame - selected.perFrame}`);
      expect(selected.perFrame - base.perFrame).toBeLessThan(ALLOWED_EXTRA_BYTES_PER_FRAME);
      expect(deploy.perFrame - selected.perFrame).toBeLessThan(ALLOWED_EXTRA_BYTES_PER_FRAME);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 400_000);
});

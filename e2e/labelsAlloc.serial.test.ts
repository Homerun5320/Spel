// M20a-2: the nation labels and the front arrows allocate (next to) nothing per frame. The JS heap is read after every frame (V8's own figure over CDP, exact: this measures ALLOCATION
// per frame, not retained memory; the method of e2e/deployAlloc.serial.test.ts). One match at 320x180 over FRAMES frames in two states: the layers switched off (the baseline: the
// render itself) and on with an attack running and a still camera (labels shown, one arrow); the extra of the second over the baseline is held to a small number. Serial: it measures.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';

const FRAMES = 60;
/** The extra bytes per frame the labels and the arrows may allocate over the baseline (the data refresh every half second makes some strings; a frame with a still camera makes none). */
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

/** Bytes allocated per frame over `frames` frames (one draw each, the fx clock steps 0.05 s); a frame in which the GC freed more than it allocated is left out. */
async function allocatedPerFrame(page: Page, frames: number): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  const used = async (): Promise<number> => ((await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }).usedSize;
  try {
    await ev(page, 'settle', 0.05, 1);
    let prev = await used();
    let sum = 0;
    let counted = 0;
    for (let i = 0; i < frames; i++) {
      await ev(page, 'settle', 0.05, 1);
      const now = await used();
      if (now >= prev) {
        sum += now - prev;
        counted++;
      }
      prev = now;
    }
    return counted === 0 ? 0 : Math.round(sum / counted);
  } finally {
    await cdp.detach();
  }
}

describe('allocation per frame: the nation labels and the front arrows', () => {
  it('a still camera over a nation with an attack running allocates almost nothing more than the render itself', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&labels=1&w=320&h=180', { width: 320, height: 180 }, { isolated: true });
    try {
      await ev(page, 'setView', { lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 });
      const p0 = await ev<{ x: number; y: number }>(page, 'project', 48.5, 11);
      await page.mouse.click(p0.x, p0.y);
      await ev(page, 'advance', 0.1, 270);
      await ev(page, 'give', 0, { gold: 90000, troops: 5000 });
      const capital = ((await ev<{ capitals: number[] }>(page, 'seatCells')).capitals[0]) as number;
      const at = cellToLatLon(capital, 1024, 512);
      await ev(page, 'setView', { lat: at.lat, lon: at.lon, distKm: 1300, heading: 0, tilt: 0 });
      await ev(page, 'submit', { kind: 'Attack', seat: 0, target: 0, pct: 90 });
      await ev(page, 'advance', 0.1, 12);
      await ev(page, 'labelsOn', false);
      const baseline = await allocatedPerFrame(page, FRAMES);
      await ev(page, 'labelsOn', true);
      await ev(page, 'render', 0);
      expect((await ev<{ shown: unknown[] }>(page, 'labels')).shown.length).toBeGreaterThanOrEqual(1);
      expect((await ev<{ count: number }>(page, 'fronts')).count).toBe(1);
      const withLayers = await allocatedPerFrame(page, FRAMES);
      console.log(`allocated per frame: baseline ${baseline} B, labels and arrows on ${withLayers} B, extra ${withLayers - baseline} B`);
      expect(withLayers - baseline).toBeLessThan(ALLOWED_EXTRA_BYTES_PER_FRAME);
    } finally {
      expect(consoleMessages).toEqual([]);
      await page.close();
    }
  });
});

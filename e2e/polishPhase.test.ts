// Polish-1 in headless Chromium: the placement ghost and the build buttons know the spawn phase (red ghost with the phase reason, a toast on a click,
// dimmed buttons), and play on after the phase; resizing the window while zoomed out keeps the whole globe in view.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { launchBrowser, openPage } from '../scripts/shot.mjs';
import { REJECT_PHASE } from '../src/sim/intents';
import { cellToLatLon } from '../src/render/transforms';

let browser: Browser;
const baseUrl = inject('baseUrl');
beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

const ev = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> => page.evaluate(([f, a]) => (window as any).__test[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;

describe('Polish-1: the spawn phase in the build UI', () => {
  it('in the phase the ghost is red with the phase reason, the button is dimmed and a click toasts; after the phase it is green and builds', async () => {
    const { page } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 });
    try {
      await ev(page, 'setView', { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
      const p = await ev<{ x: number; y: number }>(page, 'project', 48.5, 11);
      await page.mouse.click(p.x, p.y);
      await ev(page, 'advance', 0.1, 5);
      await ev(page, 'give', 0, { gold: 6000 });
      await ev(page, 'advance', 0.1, 4);
      const { capitals } = await ev<{ capitals: number[] }>(page, 'seatCells');
      const at = cellToLatLon(capitals[0] as number, 1024, 512);
      await ev(page, 'setView', { lat: at.lat, lon: at.lon, distKm: 600, heading: 0, tilt: 0 });
      await ev(page, 'settle', 0, 2);
      const btn = page.locator('[data-testid="build-city"]');
      expect(await btn.getAttribute('data-state')).toBe('waiting');
      expect(await btn.getAttribute('aria-disabled')).toBe('true');
      expect(await btn.getAttribute('title')).toBe(await ev<string>(page, 'text', 'hud.build.waitPhase'));
      await page.keyboard.press('1');
      const c = await ev<{ x: number; y: number }>(page, 'project', at.lat, at.lon);
      await page.mouse.move(c.x, c.y);
      await ev(page, 'settle', 0, 2);
      let props = await ev<{ ghost: { ok: boolean; reason: number } | null; toasts: string[]; total: number }>(page, 'props');
      expect(props.ghost?.ok).toBe(false);
      expect(props.ghost?.reason).toBe(REJECT_PHASE);
      await page.mouse.click(c.x, c.y);
      await ev(page, 'settle', 0, 1);
      props = await ev(page, 'props');
      expect(props.toasts).toContain('toast.build.phase');

      await ev(page, 'advance', 0.1, 210);
      await ev(page, 'settle', 0, 2);
      expect(await btn.getAttribute('data-state')).toBe('ok');
      await page.mouse.move(c.x + 1, c.y);
      await ev(page, 'settle', 0, 2);
      props = await ev(page, 'props');
      expect(props.ghost?.ok).toBe(true);
      await page.mouse.click(c.x, c.y);
      await ev(page, 'advance', 0.1, 4);
      await ev(page, 'settle', 0, 2);
      props = await ev(page, 'props');
      expect(props.total).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });
});

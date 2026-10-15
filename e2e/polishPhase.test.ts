// Polish-1 in headless Chromium: the placement ghost and the build buttons know the spawn phase (red ghost with the phase reason, a toast on a click,
// dimmed buttons), and play on after the phase; resizing the window while zoomed out keeps the whole globe in view.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
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

describe('Polish-1: the start card with the graphics tip', () => {
  const INTEL = 'ANGLE (Intel, Intel(R) UHD Graphics (0x0000A721) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  it('Play is fully inside the window without scrolling at 1366x640 and 1280x560, with the tip shown; More opens the rest', async () => {
    const dir = '/tmp/claude-0/-home-user-Spel/090222b8-c3ec-57d8-8029-4dc7d2316ca6/scratchpad/polish1/shots';
    fs.mkdirSync(dir, { recursive: true });
    void path;
    void OUT_DIR;
    for (const [w, h] of [[1366, 640], [1280, 560], [960, 540], [540, 960]] as const) {
      const { page } = await openPage(browser, baseUrl, `test=1&menu=1&gpu=${encodeURIComponent(INTEL)}`, { width: w, height: h }, { isolated: true });
      try {
        await page.waitForSelector('[data-testid="gpu-tip"]', { state: 'visible' });
        await page.evaluate(() => (window as any).__test.render());
        const r = await page.evaluate(() => {
          const b = (document.querySelector('.start-play') as HTMLElement).getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, h: window.innerHeight };
        });
        expect(r.top).toBeGreaterThanOrEqual(0);
        if (w > h) expect(r.bottom).toBeLessThanOrEqual(r.h);
        fs.writeFileSync(`${dir}/tip-${w}x${h}.png`, await page.screenshot({ type: 'png' }));
        expect(await page.locator('[data-testid="gpu-tip-extra"]').isVisible()).toBe(false);
        await page.click('[data-testid="gpu-tip-more"]');
        expect(await page.locator('[data-testid="gpu-tip-extra"]').isVisible()).toBe(true);
      } finally {
        await page.close();
      }
    }
  });
});

describe('Polish-1: resize while zoomed out', () => {
  it('a camera at the maximum distance follows the maximum when the window changes shape', async () => {
    const { page } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0', { width: 960, height: 540 });
    try {
      await ev(page, 'setView', { lat: 20, lon: 10, distKm: 1e9, tilt: 0 });
      await ev(page, 'settle', 0, 1);
      expect((await ev<{ distKm: number }>(page, 'view')).distKm).toBe(await ev<number>(page, 'maxDist'));
      const wide = await ev<number>(page, 'maxDist');
      await ev(page, 'resize', 300, 540);
      await ev(page, 'settle', 0, 2);
      const tall = await ev<number>(page, 'maxDist');
      expect(tall).not.toBe(wide);
      expect((await ev<{ distKm: number }>(page, 'view')).distKm).toBe(tall);
    } finally {
      await page.close();
    }
  });
});

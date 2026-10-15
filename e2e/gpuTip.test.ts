// AutoTier-1 in headless Chromium: the graphics tip of the start screen (shown for an integrated card string given by the test hook `?gpu=`, never for
// a capable one or without the hook), its closing (remembered through the prefs), that it lets clicks through, and the report's new fields. Pages are
// isolated (their own storage) because the closing is written to the prefs. Screenshots go to test-results/shots/gputip-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const INTEL = 'ANGLE (Intel, Intel(R) UHD Graphics (0x0000A721) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const NVIDIA = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const tid = (id: string): string => `[data-testid="${id}"]`;

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

const open = (query: string, viewport = { width: 960, height: 540 }) => openPage(browser, baseUrl, query, viewport, { isolated: true });

describe('the graphics tip', () => {
  it('shows for an integrated card with its readable name, in both languages and both window shapes, and the console stays clean', async () => {
    for (const [w, h] of [[960, 540], [540, 960]] as const) {
      const { page, consoleMessages } = await open(`test=1&menu=1&gpu=${encodeURIComponent(INTEL)}`, { width: w, height: h });
      try {
        await page.waitForSelector(tid('gpu-tip'), { state: 'visible' });
        const sv = (await page.locator(tid('gpu-tip')).textContent()) ?? '';
        expect(sv).toContain('Intel UHD Graphics');
        expect(sv).not.toMatch(/ANGLE|0x0000|Direct3D/);
        expect(sv).toContain('låg grafik');
        await page.evaluate(() => (window as any).__test.render());
        fs.writeFileSync(path.join(SHOT_DIR, `gputip-sv-${w}x${h}.png`), await page.screenshot({ type: 'png' }));
        await page.click(tid('start-language'));
        const en = (await page.locator(tid('gpu-tip')).textContent()) ?? '';
        expect(en).toContain('low graphics');
        expect(en).toContain('Intel UHD Graphics');
        await page.evaluate(() => (window as any).__test.render());
        fs.writeFileSync(path.join(SHOT_DIR, `gputip-en-${w}x${h}.png`), await page.screenshot({ type: 'png' }));
        expect(consoleMessages).toEqual([]);
      } finally {
        await page.close();
      }
    }
  });

  it('is absent for a capable card and without the hook', async () => {
    for (const q of [`test=1&menu=1&gpu=${encodeURIComponent(NVIDIA)}`, 'test=1&menu=1']) {
      const { page } = await open(q);
      try {
        expect(await page.locator(tid('start-screen')).count()).toBe(1);
        expect(await page.locator(tid('gpu-tip')).count()).toBe(0);
      } finally {
        await page.close();
      }
    }
  });

  it('lets clicks through (pointer-events none outside its Close button), closes, and stays closed after a reload', async () => {
    const { page } = await open(`test=1&menu=1&gpu=${encodeURIComponent(INTEL)}`);
    try {
      await page.waitForSelector(tid('gpu-tip'), { state: 'visible' });
      const probe = await page.evaluate(() => {
        const tip = document.querySelector('[data-testid="gpu-tip"]') as HTMLElement;
        const r = tip.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + 6, r.top + r.height / 2);
        const close = document.querySelector('[data-testid="gpu-tip-close"]') as HTMLElement;
        return { tipEvents: getComputedStyle(tip).pointerEvents, closeEvents: getComputedStyle(close).pointerEvents, hitIsTip: hit !== null && tip.contains(hit) };
      });
      expect(probe).toEqual({ tipEvents: 'none', closeEvents: 'auto', hitIsTip: false });
      await page.click(tid('gpu-tip-close'));
      expect(await page.locator(tid('gpu-tip')).count()).toBe(0);
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => (window as any).__test !== undefined);
      await page.waitForSelector(tid('start-screen'));
      expect(await page.locator(tid('gpu-tip')).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('the report and the F3 overlay name the class and the tier source (test mode: tier test, source test)', async () => {
    const { page } = await open(`test=1&perf=1&gpu=${encodeURIComponent(INTEL)}`);
    try {
      const text = (await page.locator('[data-perf] pre').textContent()) ?? '';
      expect(text).toContain('grafikkort: integrated  nivå test (källa: test)');
    } finally {
      await page.close();
    }
  });
});

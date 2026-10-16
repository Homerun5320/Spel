// Fix-3B layout: the setup header keeps "Ny match" on one line with every button inside the window, and the spectator bar never overlaps the
// leaderboard (960x540, 1366x640, portrait 540x960). Screenshots: test-results/shots/fixlayout-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';

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

const tid = (id: string): string => `[data-testid="${id}"]`;
const SIZES = [
  [960, 540],
  [1366, 640],
  [540, 960],
] as const;
type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('Fix-3B layout', () => {
  for (const [w, h] of SIZES) {
    it(`the setup header fits at ${w}x${h}`, async () => {
      const { page } = await openPage(browser, baseUrl, 'test=1&menu=1&hud=1&seed=7', { width: w, height: h });
      try {
        await page.click(tid('start-setup'));
        await page.waitForSelector(tid('setup-screen'), { timeout: 30_000 });
        await page.evaluate(() => (window as any).__test.render());
        fs.writeFileSync(path.join(SHOT_DIR, `fixlayout-setup-${w}x${h}.png`), await page.screenshot({ type: 'png' }));
        const panel = (await page.locator(tid('setup-panel')).boundingBox()) as Box;
        const title = (await page.locator(tid('setup-title')).boundingBox()) as Box;
        const back = (await page.locator(tid('setup-back')).boundingBox()) as Box;
        const lang = (await page.locator(tid('setup-language')).boundingBox()) as Box;
        const lineH = await page.locator(tid('setup-title')).evaluate((e) => parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.3);
        expect(title.height, 'the title is one line').toBeLessThan(lineH * 1.6);
        for (const [name, b] of [['back', back], ['language', lang]] as const) {
          expect(b.x + b.width, `${name} inside the panel`).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
          expect(b.x, `${name} inside the window`).toBeGreaterThanOrEqual(0);
        }
      } finally {
        await page.close();
      }
    }, 90_000);

    it(`the spectator bar does not overlap the leaderboard at ${w}x${h}`, async () => {
      const { page } = await openPage(browser, baseUrl, 'test=1&seed=7&hud=1', { width: w, height: h });
      try {
        await page.evaluate(() => (window as any).__test.settle(0.25, 2));
        await page.evaluate(() => (window as any).__test.forceEliminated(0));
        await page.evaluate(() => (window as any).__test.render());
        await page.click(tid('elim-spectate'));
        await page.evaluate(() => (window as any).__test.render());
        fs.writeFileSync(path.join(SHOT_DIR, `fixlayout-spectator-${w}x${h}.png`), await page.screenshot({ type: 'png' }));
        const bar = (await page.locator(tid('spectator-bar')).boundingBox()) as Box;
        const board = (await page.locator('.hud-board').boundingBox()) as Box;
        expect(overlap(bar, board), `bar ${JSON.stringify(bar)} board ${JSON.stringify(board)}`).toBe(false);
        expect(bar.x + bar.width).toBeLessThanOrEqual(w + 0.5);
      } finally {
        await page.close();
      }
    }, 90_000);
  }
});

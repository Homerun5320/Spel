import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, analyzeImage, assertShotOk, checkShot, launchBrowser, takeShot } from '../scripts/shot.mjs';

describe('smoke: headless WebGL2 screenshot of the lit globe', () => {
  let browser: Browser;
  beforeAll(async () => {
    const launched = await launchBrowser();
    browser = launched.browser;
    console.log(`[smoke] chromium ${launched.version} at ${launched.executablePath}`);
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('passes every assertion of the smoke shot', async () => {
    const shot = await takeShot(browser, inject('baseUrl'), { query: 'test=1' });
    fs.mkdirSync(path.join(OUT_DIR, 'shots'), { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'shots', 'smoke.png'), shot.png);
    const metrics = analyzeImage(shot.image);
    console.log(`[smoke] renderer: ${shot.info.renderer}`);
    console.log(
      `[smoke] first frame ${shot.info.firstFrameMs?.toFixed(0)} ms, load ${shot.timings.loadMs.toFixed(0)} ms, ` +
        `render ${shot.timings.renderMs.toFixed(0)} ms, screenshot ${shot.timings.screenshotMs.toFixed(0)} ms (logged, not asserted)`,
    );
    console.log(`[smoke] draw calls ${shot.info.drawCalls}, triangles ${shot.info.triangles}, textures ${shot.info.textures}`);
    console.log(`[smoke] metrics ${JSON.stringify(metrics)}`);
    expect(shot.info.webgl2).toBe(true);
    expect(shot.info.renderer.length).toBeGreaterThan(0);
    expect(shot.info.width).toBe(960);
    expect(shot.info.height).toBe(540);
    expect(shot.info.dpr).toBe(1);
    expect(shot.info.drawCalls).toBe(3); // M02 B: stars + globe + atmosphere shell (it was 1 while the globe was alone)
    expect(shot.info.triangles).toBeLessThanOrEqual(150_000);
    expect(shot.consoleMessages).toEqual([]);
    assertShotOk(shot);
    expect(checkShot(shot)).toEqual([]);
  });

  it('the overlay is hidden in test mode and F3 shows the renderer string', async () => {
    const { page } = await (await import('../scripts/shot.mjs')).openPage(browser, inject('baseUrl'), 'test=1');
    try {
      await page.evaluate(() => window.__test?.render());
      expect(await page.locator('pre').isHidden()).toBe(true);
      await page.keyboard.press('F3');
      expect(await page.locator('pre').isVisible()).toBe(true);
      expect(await page.locator('pre').innerText()).toMatch(/GL renderer: .+/);
      expect(await page.locator('pre').innerText()).toMatch(/draw calls: \d+/);
    } finally {
      await page.close();
    }
  });
});

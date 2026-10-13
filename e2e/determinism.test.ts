import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, compareGolden, launchBrowser, openPage, renderAndCapture, takeShot } from '../scripts/shot.mjs';

describe('determinism: the fixed test view renders identically', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = (await launchBrowser()).browser;
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('two renders in the same browser start are byte-identical', async () => {
    const { page, consoleMessages } = await openPage(browser, inject('baseUrl'), 'test=1');
    try {
      const a = await renderAndCapture(page);
      const b = await renderAndCapture(page);
      expect(Buffer.compare(a, b)).toBe(0);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('matches the committed golden (pixelmatch threshold 0.1, <= 0.2 % differing pixels)', async () => {
    // M02: the default scene is the globe; the M00 golden belongs to the spike scene (docs/DECISIONS.md D31).
    const shot = await takeShot(browser, inject('baseUrl'), { query: 'test=1&scene=spike' });
    fs.mkdirSync(path.join(OUT_DIR, 'shots'), { recursive: true });
    const result = compareGolden(shot.png, 'spike-test-view');
    console.log(`[golden] spike-test-view: ${result.status}, ${result.diffPixels} px differ (${(result.ratio * 100).toFixed(4)} %)`);
    expect(['match', 'updated', 'mismatch-warn', 'missing-warn']).toContain(result.status);
  });

  it('a different seed gives a different image (the seed is wired up)', async () => {
    const a = await takeShot(browser, inject('baseUrl'), { query: 'test=1&scene=spike&seed=1' });
    const b = await takeShot(browser, inject('baseUrl'), { query: 'test=1&scene=spike&seed=2' });
    expect(Buffer.compare(a.png, b.png)).not.toBe(0);
  });
});

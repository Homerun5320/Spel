// debug/viewshed.html (M11b) in headless Chromium: the page loads the real world, draws, has no console errors, a placed SAM changes the picture,
// and the route fingerprint computed by the browser equals the one pinned in Node (tests/sim/nav.test.ts).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, analyzeImage, compareGolden, decodePng, launchBrowser, newTestPage } from '../scripts/shot.mjs';
import type { ViewshedHooks } from '../src/app/debugViewshed';

const NODE_FINGERPRINT = '4680ed7e'; // keep in step with PINNED_HASH in tests/sim/nav.test.ts

describe('debug/viewshed.html', () => {
  let browser: Browser;
  const baseUrl = inject('baseUrl');
  beforeAll(async () => {
    ({ browser } = await launchBrowser());
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function open(): Promise<{ page: Page; messages: string[] }> {
    const page = await newTestPage(browser, { width: 1100, height: 760 });
    page.setDefaultTimeout(30_000);
    const messages: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    await page.goto(`${baseUrl}/debug/viewshed.html`, { waitUntil: 'load' });
    await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });
    return { page, messages };
  }
  const hashOf = async (page: Page): Promise<string> => crypto.createHash('sha256').update(await page.locator('#map').screenshot({ type: 'png' })).digest('hex');

  it('draws the Alps with coverage and routes, no console errors, a golden; a placed SAM changes the picture; High differs from Low; the fingerprint equals Node', async () => {
    const { page, messages } = await open();
    try {
      const png = await page.locator('#map').screenshot({ type: 'png' });
      fs.mkdirSync(path.join(OUT_DIR, 'shots'), { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, 'shots', 'debug-viewshed-alps.png'), png);
      const m = analyzeImage(decodePng(png));
      expect(m.distinctColors).toBeGreaterThanOrEqual(8);
      expect(m.lumaStd).toBeGreaterThan(15);
      const g = compareGolden(await page.screenshot({ type: 'png' }), 'debug-viewshed');
      console.log(`[viewshed] golden ${g.status} (${g.diffPixels} px)`);

      const before = await hashOf(page);
      const st = await page.evaluate(() => (window as unknown as { __viewshed: ViewshedHooks }).__viewshed.stats());
      expect(st.weighted[0]).toBeGreaterThan(0);
      // a SAM placed by a click on the canvas
      const box = await page.locator('#map').boundingBox();
      if (!box) throw new Error('no canvas box');
      await page.locator('button[data-tool="sam"]').click();
      await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3);
      expect(await page.evaluate(() => (window as unknown as { __viewshed: ViewshedHooks }).__viewshed.samCount())).toBe(2);
      const afterSam = await hashOf(page);
      expect(afterSam).not.toBe(before);
      await page.locator('button[data-mode="high"]').click();
      expect(await page.locator('body').getAttribute('data-mode')).toBe('high');
      expect(await hashOf(page)).not.toBe(afterSam);
      // the region buttons pan the viewport to the other mountains
      await page.locator('button[data-region="himalaya"]').click();
      expect(await page.locator('body').getAttribute('data-region')).toBe('himalaya');
      expect(await hashOf(page)).not.toBe(before);
      const fp = await page.evaluate(() => (window as unknown as { __viewshed: ViewshedHooks }).__viewshed.fingerprint());
      expect(fp).toBe(NODE_FINGERPRINT);
    } finally {
      await page.close();
    }
    expect(messages).toEqual([]);
  });
});

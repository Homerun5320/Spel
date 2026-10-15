// Allocation test of the route planner (leak-test, M11b): 200 planRoute queries run inside debug/viewshed.html must not grow the heap by 5 MB or more.
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { heapDelta, launchBrowser, newTestPage } from '../scripts/shot.mjs';
import type { ViewshedHooks } from '../src/app/debugViewshed';

const MB = 1024 * 1024;

describe('leak-test: planRoute in debug/viewshed.html', () => {
  let browser: Browser;
  const baseUrl = inject('baseUrl');
  beforeAll(async () => {
    ({ browser } = await launchBrowser());
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('200 planRoute queries retain less than 5 MB (heapDelta: gc before and after, median of 3)', async () => {
    const page = await newTestPage(browser, { width: 640, height: 400 }, { isolated: true });
    page.setDefaultTimeout(30_000);
    try {
      await page.goto(`${baseUrl}/debug/viewshed.html`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });
      await page.evaluate(() => (window as unknown as { __viewshed: ViewshedHooks }).__viewshed.runQueries(20)); // warm-up
      const delta = await heapDelta(page, async () => {
        const ok = await page.evaluate(() => (window as unknown as { __viewshed: ViewshedHooks }).__viewshed.runQueries(200));
        expect(ok).toBeGreaterThan(0);
      });
      console.log(`[leak-test] 200 planRoute queries: ${(delta / MB).toFixed(2)} MB retained`);
      expect(delta).toBeLessThan(5 * MB);
    } finally {
      await page.close();
    }
  });
});

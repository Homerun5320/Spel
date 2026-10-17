// Moved from e2e/debugData.test.ts (D144): the pack load time is compared with a CPU budget (budgetMs), so this test runs in the serial e2e
// project, alone in the browser, never next to another Chromium. The test itself is unchanged.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { launchBrowser, newTestPage } from '../scripts/shot.mjs';
import { budgetMs } from '../tests/perfguard';

const VIEWPORT = { width: 1100, height: 700 };

async function openData(browser: Browser, baseUrl: string, suffix: string): Promise<{ page: Page; messages: string[] }> {
  const page = await newTestPage(browser, VIEWPORT);
  page.setDefaultTimeout(20_000);
  const messages: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
  await page.goto(`${baseUrl}/debug/data.html${suffix}`, { waitUntil: 'load' });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 20_000 });
  return { page, messages };
}

describe('debug/data.html', () => {
  let browser: Browser;
  const baseUrl = inject('baseUrl');
  beforeAll(async () => {
    ({ browser } = await launchBrowser());
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('loads and parses the packs in Chromium: median of 5 loads within budgetMs(1500) (target 300 ms)', async () => {
    const { page } = await openData(browser, baseUrl, '#map-class');
    try {
      const times = await page.evaluate(() => (window as unknown as { __debugData: { measureLoad(n: number): Promise<number[]> } }).__debugData.measureLoad(5));
      const sorted = [...times].sort((a, b) => a - b);
      const median = sorted[2] as number;
      const first = Number(await page.locator('body').getAttribute('data-load-ms'));
      console.log(
        `[debug-data] Chromium load + parse (all packs, meta, fnv1a verified): first ${first.toFixed(0)} ms, 5 more loads ${times.map((t) => t.toFixed(0)).join(' ')} ms, ` +
          `median ${median.toFixed(0)} ms (target 300 ms, budget ${budgetMs(1500).toFixed(0)} ms)`,
      );
      expect(median).toBeLessThanOrEqual(budgetMs(1500));
    } finally {
      await page.close();
    }
  });
});

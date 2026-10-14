// Moved from e2e/terrain.test.ts (D144): the leak test measures a retained heap (heapDelta) and is tagged leak-test, so it runs in the serial
// e2e project, alone in the browser, never next to another Chromium. The test itself is unchanged.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { heapDelta, launchBrowser, openPage } from '../scripts/shot.mjs';

interface Hooks {
  render(dt?: number): void;
  setView(v: Record<string, number>): void;
}

const MB = 1_000_000;

let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

async function open(query: string, viewport: { width: number; height: number }): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport, { isolated: true });
  return { page, messages: consoleMessages };
}

describe('leak-test: chunk terrain', () => {
  it('60 render calls (3 rounds x 20) at 320x180 over a moving camera retain less than 5 MB (median of 3)', async () => {
    const { page, messages } = await open('test=1&ai=0&w=320&h=180', { width: 320, height: 180 }); // a leak test: a page of its own context (isolated)
    try {
      // One render per evaluate: ANGLE warns "running out of reserved queue serials" when dozens of instance-buffer uploads pile up in ONE
      // JavaScript task (a page presents a frame per task, so only a test that renders in a loop meets it; the selection changes every frame here).
      let step = 0;
      const frames = async (n: number): Promise<void> => {
        for (let i = 0; i < n; i++, step++) {
          await page.evaluate((k) => {
            const h = (window as any).__test as Hooks;
            h.setView({ lat: 43.4 + 0.01 * k, lon: 7.4, heading: 3 * k, tilt: 70, altAglM: 20_000 * (1 + 0.02 * (k % 20)) });
            h.render();
          }, step);
        }
      };
      await frames(20); // warm-up outside the measurement: shader compile and first-use allocations are not leaks
      const delta = await heapDelta(page, async () => {
        for (let round = 0; round < 3; round++) await frames(20);
      });
      console.log(`[leak-test] chunk terrain heap delta: ${(delta / MB).toFixed(3)} MB`);
      expect(delta).toBeLessThan(5 * MB);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

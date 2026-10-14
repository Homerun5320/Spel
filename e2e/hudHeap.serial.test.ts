// Moved from e2e/hud.test.ts (D144): this test measures a retained heap (heapDelta), so it runs in the serial e2e project, alone in the browser,
// never next to another Chromium. The test itself is unchanged.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { heapDelta, launchBrowser, openPage } from '../scripts/shot.mjs';

let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

async function open(query: string): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, { width: 960, height: 540 }, { isolated: true });
  return { page, messages: consoleMessages };
}

const advance = (page: Page, dt: number, ticks: number): Promise<void> => page.evaluate(([d, t]) => (window as any).__test.advance(d, t), [dt, ticks] as const);
const view = (page: Page, v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v);

const VIEW = { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 };
const START = { lat: 48.5, lon: 11 };

async function clickAt(page: Page, lat: number, lon: number): Promise<void> {
  const p = await page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const);
  expect(p.inView && p.facing, `(${lat}, ${lon}) is on screen`).toBe(true);
  await page.mouse.click(p.x, p.y);
}

describe('the HUD does no work when nothing changed', () => {
  it('500 refreshes of an unchanged state cause no DOM mutation; the cost per refresh is logged', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0'); // a heap measurement: a page of its own context (isolated)
    try {
      await view(page, VIEW);
      await clickAt(page, START.lat, START.lon);
      await advance(page, 0, 30);
      const r = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="match-hud"]') as HTMLElement;
        const records: string[] = [];
        const obs = new MutationObserver((list) => {
          for (const m of list) records.push(`${m.type}:${(m.target as HTMLElement).dataset?.testid ?? (m.target as HTMLElement).className}`);
        });
        obs.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
        const ms = (window as any).__test.hudRefresh(500);
        const pending = obs.takeRecords();
        obs.disconnect();
        return { ms, mutations: records.length + pending.length };
      });
      console.log(`[hud] 500 refreshes of an unchanged state: ${r.ms.toFixed(2)} ms (${(r.ms / 500).toFixed(4)} ms each), ${r.mutations} DOM mutations; logged, not asserted`);
      expect(r.mutations).toBe(0);
      // the retained heap of 3000 refreshes (gc before and after, median of 3; a string per refresh would be 100 KB or more)
      const retained = await heapDelta(page, () => page.evaluate(() => { (window as any).__test.hudRefresh(3000); }));
      console.log(`[hud] heap retained by 3000 refreshes (gc, median of 3): ${retained} bytes`);
      expect(retained).toBeLessThan(1_000_000);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

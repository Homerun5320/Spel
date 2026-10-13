import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { heapDelta, launchBrowser, openPage, readUsedHeap } from '../scripts/shot.mjs';

const MB = 1_000_000;

describe('heapDelta self-test', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = (await launchBrowser()).browser;
    page = await browser.newPage();
    await page.goto('about:blank');
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('usedJSHeapSize is precise (not quantised to multiples of 1 000 000)', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        (window as any).__junk = new Array(1000 + 137 * ((performance.now() | 0) % 7)).fill(Math.random());
      });
      samples.push(await readUsedHeap(page));
    }
    expect(samples.some((v) => v % 1_000_000 !== 0)).toBe(true);
    expect(new Set(samples.map((v) => v % 1_000_000)).size).toBeGreaterThan(1);
  });

  it('a retained 20 MB field gives a delta within +/-25 %', async () => {
    const delta = await heapDelta(page, async () => {
      await page.evaluate(() => {
        const w = window as any;
        const keep = new Array<number>(2_500_000); // pre-sized: holey double elements, exactly 8 bytes each
        for (let i = 0; i < keep.length; i++) keep[i] = Math.random();
        (w.__keep ??= []).push(keep);
      });
    });
    console.log(`[heapDelta] retained field: ${(delta / MB).toFixed(2)} MB`);
    expect(delta).toBeGreaterThan(20 * MB * 0.75);
    expect(delta).toBeLessThan(20 * MB * 1.25);
  });

  it('no allocation gives a delta below 1 MB', async () => {
    const delta = await heapDelta(page, async () => {
      await page.evaluate(() => 1 + 1);
    });
    console.log(`[heapDelta] no allocation: ${delta} bytes`);
    expect(Math.abs(delta)).toBeLessThan(1 * MB);
  });
});

describe('leak-test: spike render', () => {
  it('60 render calls (3 rounds x 20) at 320x180 retain less than 5 MB (median of 3)', async () => {
    const { browser } = await launchBrowser();
    try {
      const { page, consoleMessages } = await openPage(browser, inject('baseUrl'), 'test=1&w=320&h=180', { width: 320, height: 180 });
      // Warm-up outside the measurement: shader compile and first-use allocations are not leaks.
      await page.evaluate(() => {
        for (let i = 0; i < 20; i++) window.__test?.render();
      });
      const delta = await heapDelta(page, async () => {
        for (let round = 0; round < 3; round++) {
          await page.evaluate(() => {
            for (let i = 0; i < 20; i++) window.__test?.render();
          });
        }
      });
      console.log(`[leak-test] spike render heap delta: ${(delta / MB).toFixed(3)} MB`);
      expect(delta).toBeLessThan(5 * MB);
      expect(consoleMessages).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});

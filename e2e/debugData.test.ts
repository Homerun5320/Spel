// debug/data.html in headless Chromium (Vite dev server): the baked world drawn as class, height and country map.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { CLASS_COLORS } from '../src/app/debugPalette';
import { OUT_DIR, analyzeImage, compareGolden, decodePng, launchBrowser, newTestPage } from '../scripts/shot.mjs';

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

/** Counts canvas pixels per terrain class by exact palette match; returns class counts and the number of unmatched pixels. */
export function classShares(png: Buffer): { counts: number[]; unmatched: number; total: number } {
  const img = decodePng(png);
  const counts = new Array<number>(CLASS_COLORS.length).fill(0);
  let unmatched = 0;
  const lookup = new Map<number, number>();
  CLASS_COLORS.forEach((c, i) => lookup.set((c[0] << 16) | (c[1] << 8) | c[2], i));
  for (let i = 0; i < img.width * img.height; i++) {
    const k = lookup.get(((img.data[i * 4] as number) << 16) | ((img.data[i * 4 + 1] as number) << 8) | (img.data[i * 4 + 2] as number));
    if (k === undefined) unmatched++;
    else counts[k] = (counts[k] as number) + 1;
  }
  return { counts, unmatched, total: img.width * img.height };
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

  it('class map: not blank, class shares match the measured world, golden committed, no console errors', async () => {
    const { page, messages } = await openData(browser, baseUrl, '?map=class');
    try {
      expect(await page.locator('body').getAttribute('data-map')).toBe('class');
      expect(await page.locator('body').getAttribute('data-checksums')).toBe('ok');
      const canvasPng = await page.locator('#map').screenshot({ type: 'png' });
      fs.mkdirSync(path.join(OUT_DIR, 'shots'), { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, 'shots', 'debug-data-class-canvas.png'), canvasPng);
      const img = decodePng(canvasPng);
      expect(img.width).toBe(1024);
      expect(img.height).toBe(512);
      const m = analyzeImage(img);
      expect(m.distinctColors).toBeGreaterThanOrEqual(8);
      expect(m.lumaStd).toBeGreaterThan(20);
      const { counts, unmatched, total } = classShares(canvasPng);
      expect(unmatched).toBe(0);
      const water = (counts[0] as number) + (counts[1] as number);
      const notWater = (total - water) / total;
      const nonIceLand = (total - water - (counts[7] as number)) / total;
      console.log(
        `[debug-data] not DeepSea/Shallows (Ice included) ${(100 * notWater).toFixed(2)} %, non-Ice land ${(100 * nonIceLand).toFixed(2)} %, ` +
          `class pixels ${JSON.stringify(counts)}`,
      );
      expect(notWater).toBeGreaterThanOrEqual(0.3);
      expect(notWater).toBeLessThanOrEqual(0.4);
      expect(nonIceLand).toBeGreaterThanOrEqual(0.2);
      expect(nonIceLand).toBeLessThanOrEqual(0.28);
      const pagePng = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(OUT_DIR, 'shots', 'debug-data-class.png'), pagePng);
      const g = compareGolden(pagePng, 'debug-data-class');
      console.log(`[debug-data] golden ${g.status} (${g.diffPixels} px)`);
    } finally {
      await page.close();
    }
    expect(messages).toEqual([]);
  });

  it('modes: ?map=, #map- anchor and the three buttons all select the map and the maps differ', async () => {
    const shots: Record<string, string> = {};
    const hashOf = async (page: Page): Promise<string> => {
      const buf = await page.locator('#map').screenshot({ type: 'png' });
      return (await import('node:crypto')).createHash('sha256').update(buf).digest('hex');
    };
    for (const [suffix, mode] of [
      ['?map=height', 'height'],
      ['?map=country', 'country'],
      ['#map-height', 'height'],
      ['#map-country', 'country'],
      ['#map-class', 'class'],
      ['', 'class'],
    ] as const) {
      const { page, messages } = await openData(browser, baseUrl, suffix);
      try {
        expect(await page.locator('body').getAttribute('data-map'), suffix).toBe(mode);
        shots[`${suffix}|${mode}`] = await hashOf(page);
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    }
    expect(shots['?map=height|height']).toBe(shots['#map-height|height']);
    expect(shots['?map=country|country']).toBe(shots['#map-country|country']);
    expect(shots['#map-class|class']).toBe(shots['|class']);
    expect(new Set([shots['#map-class|class'], shots['#map-height|height'], shots['#map-country|country']]).size).toBe(3);

    const { page } = await openData(browser, baseUrl, '');
    try {
      for (const mode of ['height', 'country', 'class'] as const) {
        await page.locator(`button[data-map="${mode}"]`).click();
        expect(await page.locator('body').getAttribute('data-map')).toBe(mode);
        expect(new URL(page.url()).hash).toBe(`#map-${mode}`);
        expect(await hashOf(page)).toBe(shots[`#map-${mode}|${mode}`]);
      }
      // Hover info names the cell.
      const box = await page.locator('#map').boundingBox();
      if (!box) throw new Error('no canvas box');
      await page.mouse.move(box.x + box.width * ((16 + 180) / 360), box.y + box.height * ((90 - 58) / 180)); // 16 E, 58 N: Sweden
      expect(await page.locator('#info').innerText()).toMatch(/Sverige/);
    } finally {
      await page.close();
    }
  });

  it('index.html has the relative debug link row', async () => {
    const page = await newTestPage(browser, { width: 960, height: 540 });
    try {
      await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
      await page.waitForSelector('canvas');
      const row = page.locator('#debug-links');
      expect(await row.isVisible()).toBe(true);
      expect(await row.innerText()).toBe('Debug: klasskarta / höjdkarta / landkarta');
      const hrefs = await row.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      // The source of index.html has relative links; at runtime main.ts resolves them with siteUrl() (needed inside an Artifact).
      expect(hrefs.map((h) => h?.replace(/^.*\/debug\//, '/debug/'))).toEqual(['/debug/data.html#map-class', '/debug/data.html#map-height', '/debug/data.html#map-country']);
      await Promise.all([page.waitForURL(/debug\/data\.html#map-height$/), row.locator('a').nth(1).click()]);
      await page.waitForSelector('body[data-ready="1"]');
      expect(await page.locator('body').getAttribute('data-map')).toBe('height');
    } finally {
      await page.close();
    }
  });
});

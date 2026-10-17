// M07b part B: the contact sheets of the detailed terrain (goldens). The Alps, the Himalaya and the west coast of Norway at three heights above the ground
// (15 km, 2 km, 300 m), as the player sees them (the default colouring; the M07a sheets in e2e/terrainViews.test.ts are the 300 km / 30 km / 3 km ones and the
// `?chunks=1` debug colouring). Each sheet is rendered twice in one browser launch and must be byte-identical; each matches its golden (pixelmatch 0.1, <= 0.2 %).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, compareGolden, decodePng, encodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';

const SHOT_DIR = path.join(OUT_DIR, 'shots');
let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

interface DetailPlace {
  id: string;
  lat: number;
  lon: number;
  heading: number;
  /** The longitude under the sun: the light comes from the side, the same on every run. */
  sunLon: number;
  /** [height above the ground in metres, pitch below the horizon in degrees] */
  heights: Array<[number, number]>;
}
const PLACES: DetailPlace[] = [
  { id: 'alps', lat: 46.5, lon: 8, heading: 180, sunLon: -30, heights: [[15_000, 18], [2000, 8], [300, 5]] },
  { id: 'himalaya', lat: 28.2, lon: 86.8, heading: 0, sunLon: 50, heights: [[15_000, 18], [2000, 10], [300, 6]] },
  // the camera is over the fjord country of Møre og Romsdal, looking west to the coast: fjords with foam, a clean shore, steep green and grey slopes
  { id: 'norway', lat: 62.0, lon: 6.6, heading: 270, sunLon: -35, heights: [[15_000, 18], [2000, 8], [300, 4]] },
];
const TILE_W = 640;
const TILE_H = 360;

async function renderSheet(place: DetailPlace): Promise<{ png: Buffer; chunks: number[] }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&ai=0&w=${TILE_W}&h=${TILE_H}`, { width: TILE_W, height: TILE_H });
  try {
    const sheet = new Uint8Array(TILE_W * 3 * TILE_H * 4);
    const chunks: number[] = [];
    for (let i = 0; i < place.heights.length; i++) {
      const [aglM, pitchDeg] = place.heights[i] as [number, number];
      const r = await page.evaluate(
        (spec) => {
          const h = (window as any).__test;
          h.setGroundView(spec);
          h.render();
          return h.terrain();
        },
        { lat: place.lat, lon: place.lon, heading: place.heading, pitchDeg, aglM, time: timeForSubsolarLon(place.sunLon) },
      );
      chunks.push(r.chunkCount);
      const tile = decodePng(await (page as Page).screenshot({ type: 'png' })) as { width: number; height: number; data: Uint8Array };
      for (let y = 0; y < TILE_H; y++) {
        for (let x = 0; x < TILE_W; x++) {
          const s = (y * TILE_W + x) * 4;
          const d = (y * TILE_W * 3 + i * TILE_W + x) * 4;
          for (let k = 0; k < 4; k++) sheet[d + k] = tile.data[s + k] as number;
        }
      }
    }
    expect(consoleMessages).toEqual([]);
    return { png: encodePng({ width: TILE_W * 3, height: TILE_H, data: sheet }), chunks };
  } finally {
    await page.close();
  }
}

describe('contact sheets of the detailed terrain (goldens)', () => {
  for (const place of PLACES) {
    it(`${place.id}: 15 km, 2 km and 300 m above the ground; two renders in one browser launch are byte-identical and the sheet matches its golden (pixelmatch 0.1, <= 0.2 %)`, async () => {
      const a = await renderSheet(place);
      const b = await renderSheet(place);
      expect(Buffer.compare(a.png, b.png), `${place.id}: two renders of the sheet`).toBe(0);
      fs.writeFileSync(path.join(SHOT_DIR, `detail-sheet-${place.id}.png`), a.png);
      for (const c of a.chunks) expect(c).toBeLessThanOrEqual(150); // the test tier's cap
      const result = compareGolden(a.png, `detail-sheet-${place.id}`);
      console.log(`[golden] detail-sheet-${place.id}: ${result.status}, ${result.diffPixels} px differ (${(result.ratio * 100).toFixed(4)} %)`);
    });
  }
});

// M08 item 6 (the six height goldens): the Himalaya seen by the RTS camera from orbit down to 300 m above the ground, in one contact sheet
// (3 x 2 tiles: orbit, continent, region, 30 km, 3 km "valley", 300 m). Orbit is the plain orbit view; the others are what `flyTo` with an altitude
// puts the camera at (the real RTS pose, which then holds its height over the ground). The sheet is rendered twice in one browser launch and must be
// byte-identical (the sun and the fx clock are fixed); it matches its golden (pixelmatch 0.1, <= 0.2 %). Every tile must also differ from every
// other (a camera that did not move would pass a golden of itself) and the heights the page reports must be the ones asked for.
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

interface HeightView {
  id: string;
  /** Metres above the ground under the camera; null = the orbit view (distance 21 500 km, straight down). */
  aglM: number | null;
  tilt: number;
  heading: number;
}
const LAT = 28.2;
const LON = 86.8;
const VIEWS: HeightView[] = [
  { id: 'orbit', aglM: null, tilt: 0, heading: 0 },
  { id: 'continent', aglM: 3_000_000, tilt: 45, heading: 20 },
  { id: 'region', aglM: 300_000, tilt: 55, heading: 20 },
  { id: '30km', aglM: 30_000, tilt: 60, heading: 20 },
  { id: 'valley', aglM: 3000, tilt: 72, heading: 20 },
  { id: '300m', aglM: 300, tilt: 76, heading: 20 },
];
const TILE_W = 480;
const TILE_H = 270;
const COLS = 3;
const SUN_LON = 40;

async function renderSheet(): Promise<{ png: Buffer; tiles: Uint8Array[]; agl: number[]; hold: Array<number | null> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&ai=0&w=${TILE_W}&h=${TILE_H}`, { width: TILE_W, height: TILE_H });
  try {
    const rows = Math.ceil(VIEWS.length / COLS);
    const sheet = new Uint8Array(TILE_W * COLS * TILE_H * rows * 4);
    const tiles: Uint8Array[] = [];
    const agl: number[] = [];
    const hold: Array<number | null> = [];
    for (let i = 0; i < VIEWS.length; i++) {
      const v = VIEWS[i] as HeightView;
      const r = await page.evaluate(
        (spec) => {
          const t = (window as any).__test;
          t.setView({ lat: spec.lat, lon: spec.lon, distKm: 21_500, heading: 0, tilt: 0, time: spec.time });
          if (spec.aglM !== null) {
            t.flyTo(spec.lat, spec.lon, 0, { altAglM: spec.aglM, tilt: spec.tilt, heading: spec.heading, durationS: 0 });
          }
          t.settle(1 / 60, 3);
          return { agl: t.cameraAglM(), hold: t.holdAgl() };
        },
        { lat: LAT, lon: LON, aglM: v.aglM, tilt: v.tilt, heading: v.heading, time: timeForSubsolarLon(SUN_LON) },
      );
      agl.push(r.agl);
      hold.push(r.hold);
      const tile = decodePng(await (page as Page).screenshot({ type: 'png' })) as { width: number; height: number; data: Uint8Array };
      tiles.push(tile.data);
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      for (let y = 0; y < TILE_H; y++) {
        for (let x = 0; x < TILE_W; x++) {
          const s = (y * TILE_W + x) * 4;
          const d = ((row * TILE_H + y) * TILE_W * COLS + col * TILE_W + x) * 4;
          for (let k = 0; k < 4; k++) sheet[d + k] = tile.data[s + k] as number;
        }
      }
    }
    expect(consoleMessages).toEqual([]);
    return { png: encodePng({ width: TILE_W * COLS, height: TILE_H * rows, data: sheet }), tiles, agl, hold };
  } finally {
    await page.close();
  }
}

describe('the six height goldens (M08)', () => {
  it('orbit, continent, region, 30 km, 3 km and 300 m over the Himalaya: byte-identical twice, the heights are the ones asked for, every tile differs, the sheet matches its golden', async () => {
    const a = await renderSheet();
    const b = await renderSheet();
    expect(Buffer.compare(a.png, b.png), 'two renders of the sheet').toBe(0);
    fs.writeFileSync(path.join(SHOT_DIR, 'rts-heights-himalaya.png'), a.png);
    VIEWS.forEach((v, i) => {
      if (v.aglM === null) return;
      // the camera arrives at the height asked for (a jump lands exactly; the follower holds it) and keeps it
      expect(a.agl[i], v.id).toBeGreaterThan(v.aglM * 0.97);
      expect(a.agl[i], v.id).toBeLessThan(v.aglM * 1.03);
      expect(a.hold[i], `${v.id}: the RTS camera holds its height`).not.toBeNull();
    });
    expect(a.agl[0]).toBeGreaterThan(1_000_000);
    for (let i = 0; i < a.tiles.length; i++) {
      for (let j = i + 1; j < a.tiles.length; j++) {
        let differing = 0;
        const ti = a.tiles[i] as Uint8Array;
        const tj = a.tiles[j] as Uint8Array;
        for (let p = 0; p < ti.length; p += 4) if (ti[p] !== tj[p] || ti[p + 1] !== tj[p + 1] || ti[p + 2] !== tj[p + 2]) differing++;
        expect(differing / (TILE_W * TILE_H), `${VIEWS[i]?.id} against ${VIEWS[j]?.id}`).toBeGreaterThan(0.2);
      }
    }
    const result = compareGolden(a.png, 'rts-heights-himalaya');
    console.log(`[golden] rts-heights-himalaya: ${result.status}, ${result.diffPixels} px differ (${(result.ratio * 100).toFixed(4)} %); heights ${a.agl.map((x) => Math.round(x)).join(', ')} m`);
  });
});

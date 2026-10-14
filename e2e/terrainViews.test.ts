// M07a part B in headless Chromium (software WebGL2): the territory on the chunk terrain (readback equals the sim owner, both sides of a border
// are drawn in different colours, the border line is a smooth curve at 1.5 km), the two ground views (`?view=alps-valley`, `#view-himalaya-valley`)
// and the contact sheets of the Alps, the Himalaya and the west coast of Norway at three heights, with and without `?chunks=1` (goldens).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, compareGolden, decodePng, encodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { deltaE76Rgb } from '../src/render/color';
import { buildOwnerPalette } from '../src/render/ownerPalette';
import { CLASS_PLAINS } from '../src/sim/terrain';
import { CameraRig } from '../src/render/camera';
import { GROUND_VIEW_NAMES } from '../src/app/params';
import { GROUND_VIEWS } from '../src/render/views';
import { timeForSubsolarLon } from '../src/render/geo';
import { worldLoader } from '../tests/helpers/dataFiles';
import { distinctColours, magentaInRegion, terrainRegionMask, type RgbaImage } from '../tests/helpers/terrainRegion';

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

async function open(query: string, viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  return { page, messages: consoleMessages };
}

const advance = (page: Page, dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const);

async function clickAt(page: Page, lat: number, lon: number): Promise<void> {
  const p = await page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const);
  expect(p.inView && p.facing, `(${lat}, ${lon}) is on screen`).toBe(true);
  await page.mouse.click(p.x, p.y);
}

/** The M05 script: seed 7, spawn at 48.5 N 11 E, an attack on unowned land east of it at tick 255, 600 ticks. */
async function playScript(page: Page): Promise<void> {
  const view = { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 };
  await page.evaluate((v) => (window as any).__test.setView(v), view);
  await clickAt(page, 48.5, 11);
  await advance(page, 0.1, 255);
  await clickAt(page, 48.5, 17);
  await advance(page, 0.1, 345);
}

const cellOf = (lat: number, lon: number): number => Math.floor(((90 - lat) / 180) * 512) * 1024 + Math.floor(((lon + 180) / 360) * 1024);
const centreOf = (cell: number): { lat: number; lon: number } => ({ lat: 90 - ((Math.floor(cell / 1024) + 0.5) * 180) / 512, lon: ((cell % 1024) + 0.5) * (360 / 1024) - 180 });

describe('territory on the chunk terrain', () => {
  it('the ownership readback equals the sim owner on sampled cells, and the cells on both sides of a border are drawn in different colours', async () => {
    const sim = await worldLoader().loadSim();
    const { page, messages } = await open('test=1&seed=7');
    try {
      expect(await page.evaluate(() => (window as any).__test.state().terrainMode)).toBe('chunks');
      await playScript(page);
      // a horizontal border with three cells of land on each side that belong to two different owners (A west, B east), found in the mirror
      const owners: number[] = await page.evaluate(() => {
        const h = (window as any).__test;
        const o = new Array(1024 * 512);
        for (let i = 0; i < o.length; i++) o[i] = h.ownerOf(i);
        return o;
      });
      const land = (c: number): boolean => (sim.terrainClass[c] as number) >= CLASS_PLAINS;
      const same = (c0: number, n: number, id: number): boolean => {
        for (let k = 0; k < n; k++) if (owners[c0 + k] !== id || !land(c0 + k)) return false;
        return true;
      };
      let pair: { cell: number; a: number; b: number } | null = null;
      for (const strict of [true, false]) {
        for (let row = 40; row < 250 && !pair; row++) {
          for (let col = 520; col < 600 && !pair; col++) {
            const cell = row * 1024 + col; // the last cell of A; B starts at cell + 1
            const a = owners[cell] as number;
            const b = owners[cell + 1] as number;
            if (a === b || a === 0 || (strict && b === 0)) continue;
            if (same(cell - 2, 3, a) && same(cell + 1, 3, b) && (b !== 0 || land(cell + 1))) pair = { cell, a, b };
          }
        }
        if (pair) break;
      }
      expect(pair, 'a border with three land cells on both sides exists after 600 ticks of seed 7').not.toBeNull();
      if (!pair) return;
      console.log(`[ownership] border pair: cell ${pair.cell} owner ${pair.a} | cell ${pair.cell + 1} owner ${pair.b}`);
      // 1. readback equals the mirror: 200 scattered cells plus the six cells around the border
      const cells: number[] = [];
      let lcg = 4242;
      for (let i = 0; i < 200; i++) {
        lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
        cells.push(lcg % (1024 * 512));
      }
      for (let k = -2; k <= 3; k++) cells.push(pair.cell + k);
      const readback: number[] = await page.evaluate((c) => (window as any).__test.readOwnership(c), cells);
      expect(readback).toEqual(cells.map((c) => owners[c]));
      expect(readback.slice(-6)).toEqual([pair.a, pair.a, pair.a, pair.b, pair.b, pair.b]);
      expect(pair.a).not.toBe(pair.b);
      // the two owners have different colours in the palette (a border between them is visible by definition)
      const pal = buildOwnerPalette();
      const colourOf = (id: number): [number, number, number] => [pal[4 * (id & 255)] as number, pal[4 * (id & 255) + 1] as number, pal[4 * (id & 255) + 2] as number];
      expect(deltaE76Rgb(colourOf(pair.a), colourOf(pair.b))).toBeGreaterThan(10);
      // 2. drawn: at 100 km up the cells one and a half cells from the border on both sides have different pixel colours
      const here = centreOf(pair.cell);
      await page.evaluate((v) => (window as any).__test.setView(v), { lat: here.lat, lon: here.lon + 0.18, altAglM: 100_000, heading: 0, tilt: 0 });
      await page.evaluate(() => (window as any).__test.render());
      const png = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, 'territory-border-100km.png'), png);
      const img = decodePng(png) as RgbaImage;
      const pixel = async (cell: number): Promise<[number, number, number]> => {
        const c = centreOf(cell);
        const p = await page.evaluate(([a, o]) => (window as any).__test.project(a, o), [c.lat, c.lon] as const);
        expect(p.inView, `cell ${cell} is on screen`).toBe(true);
        const o = (Math.round(p.y) * img.width + Math.round(p.x)) * 4;
        return [img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number];
      };
      const pa = await pixel(pair.cell - 1);
      const pb = await pixel(pair.cell + 2);
      const dE = deltaE76Rgb(pa, pb);
      console.log(`[territory] pixel colours one and a half cells either side of the border: ${pa} | ${pb}, dE76 ${dE.toFixed(1)}`);
      expect(dE).toBeGreaterThan(8);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

type Rgb = [number, number, number];
const rgbDist = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Per row of the picture the x where the territory ends: the first pixel of the middle-row's right-hand colour to the right of the left-hand one (null when the row has no change). */
function borderColumns(img: RgbaImage, left: Rgb, right: Rgb): Array<number | null> {
  const out: Array<number | null> = [];
  const at = (x: number, y: number): Rgb => {
    const o = (y * img.width + x) * 4;
    return [img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number];
  };
  for (let y = 0; y < img.height; y++) {
    let found: number | null = null;
    for (let x = 8; x < img.width - 8; x++) {
      const c = at(x, y);
      if (rgbDist(c, right) < rgbDist(c, left) && rgbDist(c, right) < 24) {
        // the dark line itself is nearer to neither: a pixel that is the right-hand colour and whose left neighbour is not
        found = x;
        break;
      }
    }
    out.push(found);
  }
  return out;
}

/** The largest distance of a border point from the straight line fitted through the nine rows around it (pixels). */
function worstResidual(cols: Array<number | null>, window = 9): { worst: number; rows: number } {
  let worst = 0;
  let rows = 0;
  for (let y = 0; y + window <= cols.length; y += 1) {
    const xs = cols.slice(y, y + window);
    if (xs.some((v) => v === null)) continue;
    rows++;
    const n = window;
    const mx = (n - 1) / 2;
    const my = (xs as number[]).reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    xs.forEach((v, i) => {
      sxy += (i - mx) * ((v as number) - my);
      sxx += (i - mx) * (i - mx);
    });
    const slope = sxy / sxx;
    xs.forEach((v, i) => {
      worst = Math.max(worst, Math.abs((v as number) - (my + slope * (i - mx))));
    });
  }
  return { worst, rows };
}

describe('the territory border seen from close', () => {
  it('is a smooth curve 1.5 km above the ground: the border does not step by more than a pixel from a straight line over nine rows (a float32 cell position would stagger it)', async () => {
    const sim = await worldLoader().loadSim();
    const { page, messages } = await open('test=1&seed=7&ai=0');
    try {
      await playScript(page);
      const owners: number[] = await page.evaluate(() => {
        const h = (window as any).__test;
        const o = new Array(1024 * 512);
        for (let i = 0; i < o.length; i++) o[i] = h.ownerOf(i);
        return o;
      });
      // a straight stretch of the border: the last cell of the territory has unowned land on its east side in three rows in a row
      let cell = -1;
      for (let row = 50; row < 200 && cell < 0; row++) {
        for (let col = 530; col < 600 && cell < 0; col++) {
          const c = row * 1024 + col;
          const ok = [0, 1, 2].every((k) => owners[c + 1024 * k] !== 0 && owners[c + 1024 * k + 1] === 0 && (sim.terrainClass[c + 1024 * k + 1] as number) >= CLASS_PLAINS && owners[c + 1024 * k - 1] !== 0);
          if (ok) cell = c + 1024;
        }
      }
      expect(cell).toBeGreaterThan(0);
      const here = centreOf(cell);
      let centre = { lat: here.lat, lon: here.lon + 0.175 }; // the east edge of the cell
      let last: Buffer = Buffer.alloc(0);
      let refs: [Rgb, Rgb] = [[0, 0, 0], [0, 0, 0]];
      for (const alt of [40_000, 6000, 1500]) {
        await page.evaluate((v) => (window as any).__test.setView(v), { ...centre, altAglM: alt, heading: 0, tilt: 0 });
        await page.evaluate(() => (window as any).__test.render());
        last = await page.screenshot({ type: 'png' });
        const img = decodePng(last) as RgbaImage;
        const px = (x: number, y: number): Rgb => {
          const o = (y * img.width + x) * 4;
          return [img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number];
        };
        refs = [px(40, 270), px(img.width - 40, 270)];
        expect(rgbDist(refs[0], refs[1]), `${alt} m: the two sides are different colours`).toBeGreaterThan(30);
        const cols = borderColumns(img, refs[0], refs[1]);
        const xs = cols.filter((v) => v !== null) as number[];
        expect(xs.length, `${alt} m: the border crosses most rows`).toBeGreaterThan(400);
        // re-centre on the border for the next, lower stage
        const mid = cols[270] ?? xs[Math.floor(xs.length / 2)];
        const pk = await page.evaluate(([x, y]) => (window as any).__test.pick(x, y), [mid, 270] as const);
        expect(pk).not.toBeNull();
        centre = { lat: pk.lat, lon: pk.lon };
      }
      fs.writeFileSync(path.join(SHOT_DIR, 'territory-border-1500m.png'), last);
      const img = decodePng(last) as RgbaImage;
      const { worst, rows } = worstResidual(borderColumns(img, refs[0], refs[1]));
      console.log(`[territory] border at 1.5 km: ${rows} windows, worst distance from a straight line over nine rows ${worst.toFixed(2)} px`);
      expect(rows).toBeGreaterThan(300);
      expect(worst).toBeLessThan(1.0);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the two ground views (?view=alps-valley, #view-himalaya-valley)', () => {
  for (const name of GROUND_VIEW_NAMES) {
    it(`${name}: loads from the query and from the hash without console errors, about 2 km above the ground, at least three LOD levels, no cracks, the same picture both ways`, async () => {
      const shots: Buffer[] = [];
      for (const query of [`test=1&ai=0&view=${name}`, `test=1&ai=0#view-${name}`]) {
        const { page, messages } = await open(query);
        try {
          await page.evaluate(() => (window as any).__test.setClearColor(0xff00ff));
          await page.evaluate(() => (window as any).__test.render());
          const r = await page.evaluate(() => {
            const h = (window as any).__test;
            return { terrain: h.terrain(), agl: h.cameraAglM(), view: h.view(), info: h.info() };
          });
          const png = await page.screenshot({ type: 'png' });
          shots.push(png);
          fs.writeFileSync(path.join(SHOT_DIR, `view-${name}.png`), png);
          expect(messages, query).toEqual([]);
          expect(r.terrain.lodLevels, `${query}: LOD levels ${r.terrain.levels}`).toBeGreaterThanOrEqual(3);
          expect(r.terrain.chunkCount).toBeLessThanOrEqual(400);
          expect(r.terrain.finite).toBe(true);
          expect(Math.abs(r.agl - GROUND_VIEWS[name].aglM), `${query}: ${r.agl} m above the ground`).toBeLessThan(1);
          expect(r.view.tilt, 'tilted toward the horizon').toBeGreaterThan(72);
          // no hole in the terrain (magenta clear colour) and a real picture (not a flat wash)
          const rig = new CameraRig(960, 540);
          rig.setViewUnclamped(r.view);
          const mask = terrainRegionMask(rig.pose(), 960, 540, 4);
          const img = decodePng(png) as RgbaImage;
          expect(magentaInRegion(img, mask), `${query}: magenta pixels in the terrain region`).toBe(0);
          expect(distinctColours(img, mask), `${query}: distinct colours`).toBeGreaterThanOrEqual(200);
        } finally {
          await page.close();
        }
      }
      expect(Buffer.compare(shots[0] as Buffer, shots[1] as Buffer), 'query and hash give the same picture').toBe(0);
    });
  }

  it('both are Dev panel modes: F2 lists them and a click on one puts that view on screen (the hash of the address table)', async () => {
    const { page, messages } = await open('test=1&ai=0&devbtn=1');
    try {
      for (const name of GROUND_VIEW_NAMES) {
        await page.keyboard.press('F2');
        await page.locator(`[data-dev-mode="view-${name}"]`).waitFor({ state: 'visible' });
        await page.locator(`[data-dev-mode="view-${name}"]`).click();
        await page.waitForFunction((n) => location.hash.includes(`view-${n}`), name);
        await page.waitForFunction(() => Math.abs(((window as any).__test?.cameraAglM?.() ?? 0) - 2000) < 1);
        const view = await page.evaluate(() => (window as any).__test.view());
        expect(view.tilt, `${name} through the Dev panel`).toBeGreaterThan(72);
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// --- Contact sheets (goldens): the Alps, the Himalaya and the west coast of Norway at three heights, plain and with ?chunks=1 -------------------------
interface SheetPlace {
  id: string;
  lat: number;
  lon: number;
  heading: number;
  /** The longitude under the sun: the light comes from the side, the same on every run. */
  sunLon: number;
  /** [height above the ground in metres, pitch below the horizon in degrees] */
  heights: Array<[number, number]>;
}
const SHEET_PLACES: SheetPlace[] = [
  { id: 'alps', lat: 46.5, lon: 8, heading: 180, sunLon: -30, heights: [[300_000, 25], [30_000, 15], [3000, 8]] },
  { id: 'himalaya', lat: 28.2, lon: 86.8, heading: 0, sunLon: 50, heights: [[300_000, 25], [30_000, 15], [3000, 12]] },
  { id: 'norway', lat: 61.5, lon: 3.5, heading: 90, sunLon: -35, heights: [[300_000, 25], [30_000, 12], [3000, 4]] },
];
const TILE_W = 640;
const TILE_H = 360;

/** Renders the three heights of a place in a 640 x 360 page and joins them side by side (1920 x 360). */
async function renderSheet(place: SheetPlace, debug: boolean): Promise<{ png: Buffer; levels: number[]; chunks: number[] }> {
  const { page, messages } = await open(`test=1&ai=0&w=${TILE_W}&h=${TILE_H}${debug ? '&chunks=1' : ''}`, { width: TILE_W, height: TILE_H });
  try {
    const sheet = new Uint8Array(TILE_W * 3 * TILE_H * 4);
    const levels: number[] = [];
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
      levels.push(r.lodLevels);
      chunks.push(r.chunkCount);
      const tile = decodePng(await page.screenshot({ type: 'png' })) as RgbaImage;
      for (let y = 0; y < TILE_H; y++) {
        for (let x = 0; x < TILE_W; x++) {
          const s = (y * TILE_W + x) * 4;
          const d = (y * TILE_W * 3 + i * TILE_W + x) * 4;
          for (let k = 0; k < 4; k++) sheet[d + k] = tile.data[s + k] as number;
        }
      }
    }
    expect(messages).toEqual([]);
    return { png: encodePng({ width: TILE_W * 3, height: TILE_H, data: sheet }), levels, chunks };
  } finally {
    await page.close();
  }
}

describe('contact sheets of the chunk terrain (goldens)', () => {
  for (const place of SHEET_PLACES) {
    it(`${place.id}: three heights, plain and with ?chunks=1; two renders in one browser launch are byte-identical and each matches its golden (pixelmatch 0.1, <= 0.2 %)`, async () => {
      const plain = await renderSheet(place, false);
      const plain2 = await renderSheet(place, false);
      expect(Buffer.compare(plain.png, plain2.png), `${place.id}: two renders of the plain sheet`).toBe(0);
      const dbg = await renderSheet(place, true);
      const dbg2 = await renderSheet(place, true);
      expect(Buffer.compare(dbg.png, dbg2.png), `${place.id}: two renders of the ?chunks=1 sheet`).toBe(0);
      fs.writeFileSync(path.join(SHOT_DIR, `sheet-${place.id}.png`), plain.png);
      fs.writeFileSync(path.join(SHOT_DIR, `sheet-${place.id}-chunks.png`), dbg.png);
      expect(Buffer.compare(plain.png, dbg.png), 'the debug colouring changes the picture').not.toBe(0);
      // the lower bounds of a solid sphere cannot meet: several LOD levels at the two lower heights
      expect(plain.levels[1], `${place.id} 30 km: levels`).toBeGreaterThanOrEqual(3);
      expect(plain.levels[2], `${place.id} 3 km: levels`).toBeGreaterThanOrEqual(3);
      for (const c of [...plain.chunks, ...dbg.chunks]) expect(c).toBeLessThanOrEqual(150); // the test tier's cap
      for (const [png, name] of [[plain.png, `chunks-sheet-${place.id}`], [dbg.png, `chunks-sheet-${place.id}-debug`]] as const) {
        const result = compareGolden(png, name);
        console.log(`[golden] ${name}: ${result.status}, ${result.diffPixels} px differ (${(result.ratio * 100).toFixed(4)} %)`);
      }
    });
  }
});

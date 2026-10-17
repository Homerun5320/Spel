// M07b part B in headless Chromium (software WebGL2): the SHADING of the detailed terrain. Statistics over fixed views (snow, rock grey, forest green,
// the shore band), the territory over snow and rock (borders stay clearly visible, the terrain shows through the tint, the ownership readback equals the sim
// owner on snow and rock cells) and the smooth night lights at close range. The pixel classes are in `tests/helpers/pixelClass.ts`; a "terrain region" is the
// set of sampled pixels whose surface pick is land. Thresholds are FIXED (docs/DECISIONS.md D151): the ones of the milestone prompt are not lowered, the
// others were measured first and set with margin; the views and what the numbers were are in the same entry.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { deltaE76Rgb } from '../src/render/color';
import { timeForSubsolarLon } from '../src/render/geo';
import { CLASS_FOREST } from '../src/sim/terrain';
import { worldLoader } from '../tests/helpers/dataFiles';
import { classShares, isRockGrey, isSnow, lumaOf, pixelAt, satOf, type Rgb, type ScanPoint } from '../tests/helpers/pixelClass';
import type { RgbaImage } from '../tests/helpers/terrainRegion';

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

async function open(query = 'test=1&ai=0', viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  return { page, messages: consoleMessages };
}

/** A fixed view: the camera `altAglM` above the ground under it, looking at the focus `lat`, `lon` with `tilt` from straight down toward `heading`; the sun over `sunLon`. */
interface View {
  name: string;
  lat: number;
  lon: number;
  altAglM: number;
  tilt: number;
  heading: number;
  sunLon: number;
}
// The views of the milestone prompt. Its snow view (28.0 N 86.9 E, 15 km, tilt 55) leaves the heading open: looking NORTH (heading 0) the camera sits over the
// Nepalese foothills and sees 2 500 to 3 100 m of ground, below any snow line (measured: 0 % snow), so the view looks WEST (heading 270), over the high
// massif: picked heights 3 900 to 5 750 m. The Netherlands view takes the same tilt. See docs/DECISIONS.md D151.
const SNOW_VIEW: View = { name: 'snow', lat: 28.0, lon: 86.9, altAglM: 15_000, tilt: 55, heading: 270, sunLon: 55 };
const NL_VIEW: View = { name: 'nl', lat: 52.2, lon: 5.5, altAglM: 15_000, tilt: 55, heading: 0, sunLon: -25 };
const FOREST_VIEW: View = { name: 'forest', lat: 62, lon: 15, altAglM: 8000, tilt: 55, heading: 0, sunLon: -10 };
const STEEP_VIEW: View = { name: 'steep', lat: 46.5, lon: 8, altAglM: 15_000, tilt: 55, heading: 0, sunLon: -30 };
// The coast of west Norway seen from the sea: land, a shore and open water in one picture.
const SHORE_VIEW: View = { name: 'shore', lat: 62.3, lon: 5.6, altAglM: 20_000, tilt: 55, heading: 90, sunLon: -35 };

/** The ice sheet of Greenland (glacier class: stays white, no rock streaks) and two forests of the same height band at 62 N (central Sweden) and 50 N (Bohemia): the boreal tone. */
const GREENLAND_VIEW: View = { name: 'greenland', lat: 72, lon: -40, altAglM: 12_000, tilt: 55, heading: 0, sunLon: -45 };
const BOREAL_NORTH_VIEW: View = { name: 'boreal-north', lat: 62, lon: 15, altAglM: 8000, tilt: 55, heading: 0, sunLon: 10 };
const BOREAL_SOUTH_VIEW: View = { name: 'boreal-south', lat: 50, lon: 14, altAglM: 8000, tilt: 55, heading: 0, sunLon: 10 };
/**
 * Blue over red of the Forest class at 62 N over the same at 50 N. Both views are lit differently (the sun, the haze), so the ratio of the two is 1.58 WITHOUT the
 * boreal tone (the statement switched off in the shader) and 1.68 with it; the threshold sits between (the scene is deterministic: fixed seed, view and sun).
 */
const BOREAL_MARGIN = 1.63;

/** The Himalaya from the south at 1 500 km (tilt 50): the Tibetan plateau fills the upper half of the picture. In M07a it read as a flat white wash. */
const PLATEAU_VIEW: View = { name: 'plateau', lat: 29, lon: 85, altAglM: 0, tilt: 50, heading: 0, sunLon: 50 };

async function setView(page: Page, v: View, extra: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(
    (a) => {
      const t = (window as any).__test;
      t.setView({ lat: a.lat, lon: a.lon, ...(a.altAglM > 0 ? { altAglM: a.altAglM } : { distKm: 1500 }), tilt: a.tilt, heading: a.heading, time: a.time, ...a.extra });
      t.settle(0.05, 2);
      t.render();
    },
    { lat: v.lat, lon: v.lon, altAglM: v.altAglM, tilt: v.tilt, heading: v.heading, time: timeForSubsolarLon(v.sunLon), extra },
  );
}

/** Picks the surface under every `step`-th pixel (one evaluate call). */
async function scan(page: Page, step: number): Promise<ScanPoint[]> {
  const rows: Array<[number, number, number, number, number, number, number, number]> = await page.evaluate((s) => {
    const t = (window as any).__test;
    const out: Array<[number, number, number, number, number, number, number, number]> = [];
    for (let y = 0; y < 540; y += s) {
      for (let x = 0; x < 960; x += s) {
        const p = t.pick(x, y);
        out.push(p ? [x, y, p.elevationM > 0 ? 1 : 0, p.classId, p.cell.index, p.heightM, p.lat, p.lon] : [x, y, -1, 0, -1, 0, 0, 0]);
      }
    }
    return out;
  }, step);
  return rows.map(([x, y, l, classId, cell, heightM, lat, lon]) => ({ x, y, land: l === 1, classId, cell, heightM, lat, lon }));
}

async function shoot(page: Page, name: string): Promise<{ img: RgbaImage; png: Buffer }> {
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, `shading-${name}.png`), png);
  return { img: decodePng(png) as RgbaImage, png };
}

const pct = (x: number): string => `${(x * 100).toFixed(2)} %`;

describe('shading statistics over fixed views (terrain region = the land under sampled pixels)', () => {
  it('snow view: snow pixels (light, colourless) are at least 5 % of the terrain region and Himalayan ridges show rock grey next to them; the Netherlands view has at most 0.5 % snow', async () => {
    const { page, messages } = await open();
    try {
      await setView(page, SNOW_VIEW);
      const snowShot = await shoot(page, 'snow');
      const sn = classShares(snowShot.img, await scan(page, 6), CLASS_FOREST);
      console.log(`[shading] snow view: ${sn.samples} land samples, snow ${pct(sn.snow)}, rock grey ${pct(sn.rock)}`);
      await setView(page, NL_VIEW);
      const nlShot = await shoot(page, 'nl');
      const nl = classShares(nlShot.img, await scan(page, 6), CLASS_FOREST);
      console.log(`[shading] Netherlands view: ${nl.samples} land samples, snow ${pct(nl.snow)}, rock grey ${pct(nl.rock)}, forest class ${pct(nl.forestClass)}`);
      expect(sn.samples).toBeGreaterThan(5000);
      expect(nl.samples).toBeGreaterThan(5000);
      expect(sn.snow, 'snow view: snow share').toBeGreaterThanOrEqual(0.05);
      expect(nl.snow, 'Netherlands view: snow share').toBeLessThanOrEqual(0.005);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the Himalaya from 1 500 km is no flat white wash: snow is a small part of the plateau view (at most 15 % of the land pixels; M07a measured 26 %) and still there on the ridges (at least 2 %), the rest is rock', async () => {
    const { page, messages } = await open();
    try {
      await setView(page, PLATEAU_VIEW);
      const shot = await shoot(page, 'plateau');
      const pl = classShares(shot.img, await scan(page, 6), CLASS_FOREST);
      console.log(`[shading] plateau view (1 500 km): ${pl.samples} land samples, snow ${pct(pl.snow)}, rock grey ${pct(pl.rock)}`);
      expect(pl.samples).toBeGreaterThan(3000);
      expect(pl.snow, 'snow on the ridges').toBeGreaterThanOrEqual(0.02);
      expect(pl.snow, 'no white wash').toBeLessThanOrEqual(0.15);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('forest view (62 N 15 E, 8 km): at least 60 % of the land in view is the Forest class and at least 20 % of its pixels are forest green', async () => {
    const { page, messages } = await open();
    try {
      await setView(page, FOREST_VIEW);
      const shot = await shoot(page, 'forest');
      const f = classShares(shot.img, await scan(page, 6), CLASS_FOREST);
      console.log(`[shading] forest view: ${f.samples} land samples, Forest class ${pct(f.forestClass)}, forest green ${pct(f.forest)}, snow ${pct(f.snow)}`);
      expect(f.samples).toBeGreaterThan(5000);
      expect(f.forestClass, 'the Forest class share of the cells in view').toBeGreaterThanOrEqual(0.6);
      expect(f.forest, 'forest green pixels').toBeGreaterThanOrEqual(0.2);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a steep view (the Alps, 15 km) has a higher share of rock-grey pixels than a flat one (the Netherlands, 15 km, same tilt)', async () => {
    const { page, messages } = await open();
    try {
      await setView(page, STEEP_VIEW);
      const steepShot = await shoot(page, 'steep');
      const st = classShares(steepShot.img, await scan(page, 6), CLASS_FOREST);
      await setView(page, NL_VIEW);
      const flatShot = await shoot(page, 'flat');
      const fl = classShares(flatShot.img, await scan(page, 6), CLASS_FOREST);
      console.log(`[shading] rock grey: steep (Alps) ${pct(st.rock)}, flat (Netherlands) ${pct(fl.rock)}`);
      expect(st.rock).toBeGreaterThan(fl.rock);
      expect(st.rock, 'steep view: rock grey share').toBeGreaterThanOrEqual(0.3);
      expect(fl.rock, 'flat view: rock grey share').toBeLessThanOrEqual(0.05);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('an ice sheet stays white and a boreal forest is bluer than a southern one: over Greenland nearly all land pixels are snow-white with no rock grey, and the Forest class at 62 N is bluer (blue over red) than the same class at 50 N in the same height band', async () => {
    const { page, messages } = await open();
    try {
      await setView(page, GREENLAND_VIEW);
      const gShot = await shoot(page, 'greenland');
      const g = classShares(gShot.img, await scan(page, 12), CLASS_FOREST);
      console.log(`[shading] Greenland view: ${g.samples} land samples, snow ${pct(g.snow)}, rock grey ${pct(g.rock)}`);
      expect(g.samples).toBeGreaterThan(800);
      expect(g.snow, 'the ice sheet is white').toBeGreaterThanOrEqual(0.85);
      expect(g.rock, 'no rock streaks on the ice').toBeLessThanOrEqual(0.03);
      // the boreal tone: forest-class pixels of the same height band (150 to 600 m), blue over red averaged in display space
      const tone = async (v: View, name: string): Promise<{ ratio: number; n: number }> => {
        await setView(page, v);
        const shot = await shoot(page, name);
        let sum = 0;
        let n = 0;
        const sc = await scan(page, 12);
        for (const p of sc) {
          if (!p.land || p.classId !== CLASS_FOREST || p.heightM < 150 || p.heightM > 600) continue;
          const c = pixelAt(shot.img, p.x, p.y);
          if (lumaOf(c) < 0.08 || c[0] === 0) continue;
          sum += c[2] / c[0];
          n++;
        }
        return { ratio: n > 0 ? sum / n : 0, n };
      };
      const north = await tone(BOREAL_NORTH_VIEW, 'boreal-north');
      const south = await tone(BOREAL_SOUTH_VIEW, 'boreal-south');
      console.log(`[shading] forest tone, blue over red: 62 N ${north.ratio.toFixed(3)} (${north.n} pixels), 50 N ${south.ratio.toFixed(3)} (${south.n} pixels)`);
      expect(north.n).toBeGreaterThan(100);
      expect(south.n).toBeGreaterThan(100);
      expect(north.ratio / south.ratio, 'the boreal tone makes the northern forest bluer').toBeGreaterThan(BOREAL_MARGIN);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the shore band is lighter than the open sea by a margin of 0.1 in luminance: the sea pixels the shader draws foam on (land coverage 0.3 to 0.5 of the raster, the rule of the shader) beat the open water of their own row', async () => {
    const render = await worldLoader().loadRender();
    /** The land coverage of the shader: the bilinear share of land texels (code >= 1) among the four texels around a position. */
    const coverage = (lat: number, lon: number): number => {
      const tx = ((lon + 180) / 360) * render.width - 0.5;
      const ty = ((90 - lat) / 180) * render.height - 0.5;
      const x0 = Math.floor(tx);
      const y0 = Math.floor(ty);
      const fx = tx - x0;
      const fy = ty - y0;
      const land = (x: number, y: number): number => ((render.height8[Math.min(render.height - 1, Math.max(0, y)) * render.width + (((x % render.width) + render.width) % render.width)] as number) >= 1 ? 1 : 0);
      return land(x0, y0) * (1 - fx) * (1 - fy) + land(x0 + 1, y0) * fx * (1 - fy) + land(x0, y0 + 1) * (1 - fx) * fy + land(x0 + 1, y0 + 1) * fx * fy;
    };
    const { page, messages } = await open();
    try {
      await setView(page, SHORE_VIEW);
      const shot = await shoot(page, 'shore');
      const pts = await scan(page, 3);
      const band: number[] = [];
      const base: number[] = [];
      const rowOpen = new Map<number, Array<{ x: number; l: number }>>();
      const bandPts: Array<{ x: number; y: number; l: number }> = [];
      for (const p of pts) {
        if (p.cell < 0) continue;
        const c = coverage(p.lat, p.lon);
        const l = lumaOf(pixelAt(shot.img, p.x, p.y));
        if (c >= 0.35 && c < 0.5) bandPts.push({ x: p.x, y: p.y, l });
        else if (c === 0) rowOpen.set(p.y, [...(rowOpen.get(p.y) ?? []), { x: p.x, l }]);
      }
      for (const b of bandPts) {
        const near = (rowOpen.get(b.y) ?? []).filter((o) => Math.abs(o.x - b.x) <= 200 && Math.abs(o.x - b.x) >= 30);
        if (near.length < 3) continue;
        band.push(b.l);
        base.push(near.reduce((s, o) => s + o.l, 0) / near.length);
      }
      const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(a.length, 1);
      console.log(`[shading] shore band: ${band.length} sea pixels with foam (coverage 0.35 to 0.5), luminance ${mean(band).toFixed(3)} against ${mean(base).toFixed(3)} for the open water of their rows`);
      expect(band.length, 'foam pixels with open water in their row').toBeGreaterThan(100);
      expect(mean(band) - mean(base), 'the shore band is lighter than the open sea').toBeGreaterThanOrEqual(0.1);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// --- Territory over snow and rock ------------------------------------------------------------------------------------------------------------
const advance = (page: Page, dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const);

/** Paints a box of sim cells around a position, the seat alternating by column (so every cell edge is a border) unless `seatOf` says otherwise. */
async function paintBox(page: Page, lat: number, lon: number, cols: number, rows: number, seatOf: (c: number, r: number) => number): Promise<void> {
  const c0 = Math.floor(((lon + 180) / 360) * 1024);
  const r0 = Math.floor(((90 - lat) / 180) * 512);
  await page.evaluate(
    ([c, r, nc, nr, mode]) => {
      const t = (window as any).__test;
      for (let j = -nr; j <= nr; j++) for (let i = -nc; i <= nc; i++) t.submit({ kind: 'DebugPaint', seat: mode === 0 ? (c + i) & 1 : 0, cell: (r + j) * 1024 + c + i });
    },
    [c0, r0, cols, rows, seatOf(0, 0)] as const,
  );
  await advance(page, 0, 3);
}

const BORDER_SPOTS: Array<{ kind: 'snow' | 'rock'; lat: number; lon: number }> = [
  { kind: 'snow', lat: 28.0, lon: 86.9 },
  { kind: 'rock', lat: 28.6, lon: 85.8 },
];

describe('the territory over snow and rock', () => {
  for (const spot of BORDER_SPOTS) {
    it(`${spot.kind}: a border line stays clearly visible 60 km above the Himalaya (the darkest sharp dip of a row against the colours on both sides: dE76 >= 15, luminance dip >= 0.1)`, async () => {
      const { page, messages } = await open('test=1&seed=7&ai=0');
      try {
        const view: View = { name: `border-${spot.kind}`, lat: spot.lat, lon: spot.lon, altAglM: 60_000, tilt: 0, heading: 0, sunLon: 55 };
        await setView(page, view);
        const U = (await shoot(page, `border-${spot.kind}-bare`)).img;
        await paintBox(page, spot.lat, spot.lon, 4, 3, () => 0);
        await setView(page, view);
        const P = (await shoot(page, `border-${spot.kind}`)).img;
        const luma = (x: number, y: number): number => lumaOf(pixelAt(P, x, y));
        const meanAt = (x: number, y: number, from: number, to: number): Rgb => {
          const acc = [0, 0, 0];
          for (let dx = from; dx <= to; dx++) pixelAt(P, x + dx, y).forEach((v, k) => (acc[k] = (acc[k] as number) + v / (to - from + 1)));
          return acc as unknown as Rgb;
        };
        const dEs: number[] = [];
        let underKind = 0;
        for (let y = 0; y < 540; y += 3) {
          let best = -1;
          let bx = -1;
          for (let x = 8; x < 952; x++) {
            const d = Math.min(luma(x - 5, y), luma(x + 5, y)) - luma(x, y);
            if (d > best) {
              best = d;
              bx = x;
            }
          }
          if (best < 0.1) continue;
          const u = pixelAt(U, bx, y);
          const here = spot.kind === 'snow' ? isSnow(u) : isRockGrey(u);
          if (!here) continue; // this dip is not over the terrain kind of this test (or it is a shadow edge of another kind)
          underKind++;
          const line = pixelAt(P, bx, y);
          dEs.push(Math.min(deltaE76Rgb(line, meanAt(bx, y, -16, -12)), deltaE76Rgb(line, meanAt(bx, y, 12, 16))));
        }
        dEs.sort((a, b) => a - b);
        console.log(`[border] ${spot.kind}: ${underKind} rows with a sharp dip over ${spot.kind} (unpainted pixel), dE76 min ${dEs[0]?.toFixed(1)}, median ${dEs[Math.floor(dEs.length / 2)]?.toFixed(1)}`);
        expect(underKind, `rows where the border line crosses ${spot.kind}`).toBeGreaterThanOrEqual(20);
        expect(dEs[0], 'the weakest border row').toBeGreaterThanOrEqual(15);
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }

  it('the terrain shows through the tint: inside a territory 15 km above the Himalaya the luminance spread of the land (p90 - p10) keeps at least 60 % of what the bare terrain has', async () => {
    const { page, messages } = await open('test=1&seed=7&ai=0');
    try {
      await setView(page, SNOW_VIEW);
      const bare = (await shoot(page, 'tint-bare')).img;
      await paintBox(page, SNOW_VIEW.lat, SNOW_VIEW.lon, 3, 3, () => 1); // one owner over the whole view
      await setView(page, SNOW_VIEW);
      const owned = (await shoot(page, 'tint-owned')).img;
      const spread = (img: RgbaImage): number => {
        const ls: number[] = [];
        for (let y = 0; y < 540; y += 3) for (let x = 0; x < 960; x += 3) ls.push(lumaOf(pixelAt(img, x, y)));
        ls.sort((a, b) => a - b);
        return (ls[Math.floor(ls.length * 0.9)] as number) - (ls[Math.floor(ls.length * 0.1)] as number);
      };
      const sb = spread(bare);
      const so = spread(owned);
      console.log(`[tint] luminance spread (p90 - p10): bare ${sb.toFixed(3)}, inside a territory ${so.toFixed(3)} (${((so / sb) * 100).toFixed(0)} %)`);
      expect(sb).toBeGreaterThan(0.1);
      expect(so / sb).toBeGreaterThanOrEqual(0.6);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the ownership readback equals the sim owner on cells under snow pixels and under rock-grey pixels (five views over the Himalaya; the cells are read back from the GPU texture)', async () => {
    const { page, messages } = await open('test=1&seed=7&ai=0');
    try {
      const snowCells = new Set<number>();
      const rockCells = new Set<number>();
      const spots: Array<[number, number, number, number, number]> = [
        [SNOW_VIEW.lat, SNOW_VIEW.lon, 15_000, 55, 270],
        [28.0, 86.9, 60_000, 0, 0],
        [28.3, 86.4, 60_000, 0, 0],
        [28.6, 85.8, 60_000, 0, 0],
        [27.8, 87.4, 100_000, 0, 0],
      ];
      for (const [lat, lon, altAglM, tilt, heading] of spots) {
        const v: View = { name: 'readback', lat, lon, altAglM, tilt, heading, sunLon: 55 };
        await setView(page, v);
        const img = (await shoot(page, 'readback')).img;
        for (const p of await scan(page, 12)) {
          if (!p.land) continue;
          const c = pixelAt(img, p.x, p.y);
          if (isSnow(c)) snowCells.add(p.cell);
          else if (isRockGrey(c)) rockCells.add(p.cell);
        }
      }
      console.log(`[readback] distinct cells under snow pixels ${snowCells.size}, under rock-grey pixels ${rockCells.size}`);
      expect(snowCells.size, 'cells under snow').toBeGreaterThanOrEqual(5);
      expect(rockCells.size, 'cells under rock').toBeGreaterThanOrEqual(10);
      const cells = [...new Set([...snowCells, ...rockCells])]; // a cell can be under snow in one view and under rock in another
      const expected = new Map<number, number>();
      await page.evaluate((cs) => {
        const t = (window as any).__test;
        cs.forEach((cell: number, i: number) => t.submit({ kind: 'DebugPaint', seat: i % 2, cell }));
      }, cells);
      cells.forEach((c, i) => expected.set(c, (i % 2) + 1));
      await advance(page, 0, 3);
      const read: number[] = await page.evaluate((c) => (window as any).__test.readOwnership(c), cells);
      const sim: number[] = await page.evaluate((c) => c.map((i: number) => (window as any).__test.ownerOf(i)), cells);
      expect(sim, 'the mirror holds what was painted').toEqual(cells.map((c) => expected.get(c)));
      expect(read, 'the GPU texture equals the sim owner').toEqual(sim);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// --- Night lights at close range ------------------------------------------------------------------------------------------------------------
describe('the night lights seen from close (M07b part B)', () => {
  it('20 km above Paris at night there is no hard checkerboard: the largest step of luminance between two neighbouring pixels stays small (M02 drew random 4.9 km squares with hard edges), and the lights are still there', async () => {
    const { page, messages } = await open();
    try {
      await page.evaluate(
        (t) => {
          const h = (window as any).__test;
          h.setGroundView({ lat: 48.0, lon: 2.3, heading: 0, pitchDeg: 40, aglM: 20_000, time: t });
          h.settle(0.05, 2);
          h.render();
        },
        timeForSubsolarLon(-177),
      );
      const { img } = await shoot(page, 'night-paris-20k');
      let steps = 0;
      let maxStep = 0;
      let n = 0;
      let sum = 0;
      for (let y = 40; y < 540; y++) {
        for (let x = 0; x < 959; x++) {
          const l0 = lumaOf(pixelAt(img, x, y));
          const l1 = lumaOf(pixelAt(img, x + 1, y));
          const d = Math.abs(l1 - l0);
          maxStep = Math.max(maxStep, d);
          if (d >= 0.05) steps++;
          sum += l0;
          n++;
        }
      }
      console.log(`[night] 20 km over Paris: largest luminance step ${maxStep.toFixed(3)}, steps >= 0.05: ${steps}, mean luminance ${(sum / n).toFixed(3)}`);
      expect(sum / n, 'the city lights are there (a dark night would be about 0.02)').toBeGreaterThan(0.1);
      expect(maxStep, 'no hard edges between neighbouring pixels').toBeLessThan(0.05);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// keep the imports used by the later describes of this file
void [deltaE76Rgb, isRockGrey, isSnow, satOf, {} as Rgb];

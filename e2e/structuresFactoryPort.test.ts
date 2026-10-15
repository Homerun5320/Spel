// M10-2 in headless Chromium (software WebGL2): the Factory and the Port. Keys 2 and 3 start the placement mode through the same hook as key 1; the
// ghost is green or red by the sim's validateBuild (a Port only on the coast); a click on a red ghost shows the toast of the reason. Instances stand on
// groundHeightAt; a Port's pier points to the water; draw calls stay inside the structure budget; one close-up sheet (golden) shows a City, a Factory
// and a Port apart. Screenshots go to test-results/shots/structures-fp-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, compareGolden, decodePng, encodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { REJECT_BUILD_NO_COAST, REJECT_NONE } from '../src/sim/intents';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, buildPriceGold, isCoastCell } from '../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_SHALLOWS } from '../src/sim/terrain';
import { worldLoader } from '../tests/helpers/dataFiles';
import { cellToLatLon } from '../src/render/transforms';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

interface Props {
  counts: Record<number, number>;
  list: Array<{ id: number; type: number; cell: number; lat: number; lon: number; heightM: number; yaw: number }>;
  placing: number;
  ghost: { type: number; cell: number; ok: boolean; reason: number } | null;
  toasts: string[];
}
const T = (page: Page) => ({
  props: (): Promise<Props> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ tick: number; local: { spawned: boolean }; structures: { count: number; byType: number[] } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  capital: async (): Promise<number> => ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals[0] as number,
  ground: (la: number, lo: number): Promise<number> => page.evaluate(([a, o]) => (window as any).__test.groundHeightAt(a, o), [la, lo] as const),
});

const WIDTH = 1024;
const HEIGHT = 512;
const llOf = (cell: number): { lat: number; lon: number } => cellToLatLon(cell, WIDTH, HEIGHT);
const isWater = (cls: number): boolean => cls === CLASS_DEEP_SEA || cls === CLASS_SHALLOWS;

/** Opens the standard test match (seed 7, no AI), spawns where the click lands and gives the player gold. */
async function spawned(lat: number, lon: number, query = 'test=1&seed=7&ai=0&hud=1', viewport?: { width: number; height: number }): Promise<{ page: Page; messages: Array<{ type: string; text: string }>; capital: number }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  const t = T(page);
  await t.view({ lat, lon, distKm: 2600, heading: 0, tilt: 0 });
  const p = await t.project(lat, lon);
  await page.mouse.click(p.x, p.y);
  await t.advance(0.1, 5);
  await page.evaluate(() => (window as any).__test.give(0, { gold: 9000 }));
  await t.advance(0.1, 4);
  expect((await t.state()).local.spawned).toBe(true);
  return { page, messages: consoleMessages, capital: await t.capital() };
}

async function closeUp(page: Page, lat: number, lon: number, dKm = 2.6, aglM = 1100, pitchDeg = 24): Promise<void> {
  await page.evaluate(([la, lo, d, agl, pitch, time]) => (window as any).__test.setGroundView({ lat: la - d / 111.2, lon: lo, heading: 0, pitchDeg: pitch, aglM: agl, time }), [lat, lon, dKm, aglM, pitchDeg, timeForSubsolarLon(lon + 25)] as const);
}

async function hover(page: Page, cell: number): Promise<void> {
  const t = T(page);
  const at = llOf(cell);
  await closeUp(page, at.lat, at.lon);
  await t.settle();
  const p = await t.project(at.lat, at.lon);
  expect(p.inView && p.facing).toBe(true);
  await page.mouse.move(p.x, p.y);
  await t.settle();
}

describe('the Factory and the Port', () => {
  it('key 2 + click builds a Factory and its price goes up; key 3 inland is red with the Port reason and a toast', async () => {
    const { page, messages, capital } = await spawned(48.5, 11);
    try {
      const t = T(page);
      const fBtn = page.locator('[data-testid="build-factory"]');
      const pBtn = page.locator('[data-testid="build-port"]');
      expect(await fBtn.getAttribute('data-price')).toBe(String(buildPriceGold(STRUCT_FACTORY, 0)));
      expect(await pBtn.getAttribute('data-price')).toBe(String(buildPriceGold(STRUCT_PORT, 0)));
      expect(buildPriceGold(STRUCT_FACTORY, 0)).toBe(500);
      expect(buildPriceGold(STRUCT_PORT, 0)).toBe(400);
      // key 2 starts the Factory placement; the capital cell is own and free
      await page.keyboard.press('2');
      expect((await t.props()).placing).toBe(STRUCT_FACTORY);
      await hover(page, capital);
      const g = (await t.props()).ghost;
      expect([g?.type, g?.cell, g?.ok, g?.reason]).toEqual([STRUCT_FACTORY, capital, true, REJECT_NONE]);
      const at = llOf(capital);
      const p = await t.project(at.lat, at.lon);
      await page.mouse.click(p.x, p.y);
      expect((await t.props()).placing).toBe(0);
      await t.advance(0.1, 4);
      const s = await t.state();
      expect(s.structures.byType[STRUCT_FACTORY]).toBe(1);
      expect(await fBtn.getAttribute('data-price')).toBe(String(buildPriceGold(STRUCT_FACTORY, 1)));
      expect(buildPriceGold(STRUCT_FACTORY, 1)).toBeGreaterThan(500);
      await t.settle();
      const props = await t.props();
      expect(props.counts[STRUCT_FACTORY]).toBe(1);
      for (const it of props.list) {
        const h = await t.ground(it.lat, it.lon);
        expect(Math.abs(it.heightM - 12 * h)).toBeLessThan(1);
      }
      // key 3 on an own INLAND cell next to the capital: red, the Port reason, a click shows the toast and builds nothing
      await page.keyboard.press('3');
      expect((await t.props()).placing).toBe(STRUCT_PORT);
      await hover(page, capital + 1);
      const red = (await t.props()).ghost;
      expect([red?.type, red?.cell, red?.ok, red?.reason]).toEqual([STRUCT_PORT, capital + 1, false, REJECT_BUILD_NO_COAST]);
      const at1 = llOf(capital + 1);
      const p1 = await t.project(at1.lat, at1.lon);
      await page.mouse.click(p1.x, p1.y);
      await t.settle();
      expect((await t.props()).toasts).toContain('toast.build.noCoast');
      expect(await page.locator('[data-testid="toast"][data-key="toast.build.noCoast"]').count()).toBe(1);
      expect((await t.props()).placing).toBe(STRUCT_PORT);
      await t.advance(0.1, 4);
      expect((await t.state()).structures.byType[STRUCT_PORT] ?? 0).toBe(0);
      await page.keyboard.press('Escape');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('six build buttons fit a tall narrow window (540x960): the bar wraps instead of leaving the screen', async () => {
    const { page, messages } = await spawned(48.5, 11, 'test=1&seed=7&ai=0&hud=1&w=540&h=960', { width: 540, height: 960 });
    try {
      await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="build-bar"]') as HTMLElement;
        const btns = Array.from(bar.querySelectorAll('button'));
        for (let i = btns.length; i < 6; i++) bar.appendChild((btns[i % btns.length] as HTMLElement).cloneNode(true)); // stand-ins for keys 4 to 6
      });
      const box = await page.locator('[data-testid="build-bar"]').boundingBox();
      expect(box).not.toBeNull();
      if (box === null) return;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(540);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(960);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(540);
      await page.screenshot({ path: path.join(SHOT_DIR, 'structures-fp-bar-540x960.png') });
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a Port on an own coast cell is green and builds, its pier points to the water, a City, a Factory and a Port read apart (golden)', async () => {
    const sim = await worldLoader().loadSim();
    const { page, messages, capital } = await spawned(41.9, 12.5, 'test=1&seed=7&ai=0&hud=0');
    try {
      const t = T(page);
      // the nearest land coast cell of the start disc (a Port refuses hills and up, so plain or forest only is checked by the ghost below)
      const capLl = llOf(capital);
      await closeUp(page, capLl.lat, capLl.lon);
      await t.settle();
      const base = await t.info();
      const cx = capital % WIDTH;
      const cy = (capital - cx) / WIDTH;
      const cands: Array<{ c: number; d: number }> = [];
      for (let dy = -7; dy <= 7; dy++) {
        for (let dx = -7; dx <= 7; dx++) {
          const c = (cy + dy) * WIDTH + ((cx + dx + WIDTH) % WIDTH);
          const cls = sim.terrainClass[c] as number;
          if (cls === CLASS_HILLS || cls === CLASS_MOUNTAIN || cls === CLASS_PEAK || isWater(cls) || !isCoastCell(WIDTH, HEIGHT, sim.terrainClass, c)) continue;
          if (dx * dx + dy * dy > 4) cands.push({ c, d: dx * dx + dy * dy });
        }
      }
      cands.sort((x, y) => x.d - y.d);
      const mine: number = await page.evaluate((c) => (window as any).__test.ownerOf(c), capital);
      const owners: number[] = await page.evaluate((cs) => cs.map((c) => (window as any).__test.ownerOf(c)), cands.map((x) => x.c));
      const coast = cands.find((_, i) => owners[i] === mine)?.c ?? -1;
      expect(coast, 'a coast cell near the Rome start').toBeGreaterThanOrEqual(0);
      await page.keyboard.press('3');
      await hover(page, coast);
      const g = (await t.props()).ghost;
      expect([g?.type, g?.cell, g?.ok, g?.reason]).toEqual([STRUCT_PORT, coast, true, REJECT_NONE]);
      const cl = llOf(coast);
      const pc = await t.project(cl.lat, cl.lon);
      await page.mouse.click(pc.x, pc.y);
      await t.advance(0.1, 4);
      expect((await t.state()).structures.byType[STRUCT_PORT]).toBe(1);
      // a City on the capital and a Factory beside it (the spacing rule is per type)
      const fc: number[] = [];
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (dx * dx + dy * dy >= 9 && dx * dx + dy * dy <= 36) fc.push((cy + dy) * WIDTH + cx + dx);
      fc.sort((a, b) => Math.hypot((a % WIDTH) - cx, Math.floor(a / WIDTH) - cy) - Math.hypot((b % WIDTH) - cx, Math.floor(b / WIDTH) - cy));
      const fOwners: number[] = await page.evaluate((cs) => cs.map((c) => (window as any).__test.ownerOf(c)), fc);
      const okClass = (c: number): boolean => ![CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_DEEP_SEA, CLASS_SHALLOWS].includes(sim.terrainClass[c] as number);
      const factoryCell = fc.find((c, i) => fOwners[i] === mine && okClass(c) && c !== coast) ?? -1;
      expect(factoryCell, 'an own plain cell for the Factory').toBeGreaterThanOrEqual(0);
      await page.evaluate(([c, f]) => {
        (window as any).__test.submit({ kind: 'Build', seat: 0, type: 1, cell: c });
        (window as any).__test.submit({ kind: 'Build', seat: 0, type: 2, cell: f });
      }, [capital, factoryCell] as const);
      await t.advance(0.1, 6);
      await t.advance(0.1, 250); // past every build time (the Factory takes 200 ticks)
      await t.advance(1, 0);
      await t.settle();
      const st = await t.state();
      expect([st.structures.byType[STRUCT_CITY], st.structures.byType[STRUCT_FACTORY], st.structures.byType[STRUCT_PORT]]).toEqual([1, 1, 1]);
      const props = await t.props();
      const port = props.list.find((s) => s.type === STRUCT_PORT);
      expect(port).toBeDefined();
      if (port === undefined) return;
      // the pier points to the water: a point 2.5 cells along the yaw is sea (ground height <= 0)
      const stepDeg = 2.5 * (360 / WIDTH);
      const ahead = await t.ground(port.lat + Math.sin(port.yaw) * stepDeg, port.lon + (Math.cos(port.yaw) * stepDeg) / Math.cos((port.lat * Math.PI) / 180));
      expect(ahead, 'ground ahead of the pier').toBeLessThanOrEqual(0);
      for (const it of props.list) expect(Math.abs(it.heightM - 12 * (await t.ground(it.lat, it.lon)))).toBeLessThan(1);
      // draw calls: one per type, the whole structure layer inside the budget of ten
      await closeUp(page, capLl.lat, capLl.lon);
      await t.settle();
      const withAll = await t.info();
      const without = base;
      expect(withAll.drawCalls - without.drawCalls).toBeLessThanOrEqual(10);
      expect(withAll.drawCalls - without.drawCalls).toBeGreaterThanOrEqual(3);
      // three close-ups with the same camera relation (one structure per picture, the middle third of each), side by side
      const shots: Array<{ width: number; height: number; data: Uint8Array | Uint8ClampedArray | Buffer }> = [];
      for (const [name, cell] of [['city', capital], ['factory', factoryCell], ['port', coast]] as const) {
        const l = llOf(cell);
        await closeUp(page, l.lat, l.lon, 4.6, 2000, 28);
        await t.settle();
        const png = await page.screenshot({ type: 'png' });
        fs.writeFileSync(path.join(SHOT_DIR, `structures-fp-${name}.png`), png);
        shots.push(decodePng(png));
      }
      const w = 320;
      const h = (shots[0] as { height: number }).height;
      const sheet: { width: number; height: number; data: Buffer } = { width: w * 3, height: h, data: Buffer.alloc(w * 3 * h * 4) };
      shots.forEach((s, k) => {
        const x0 = Math.floor((s.width - w) / 2);
        for (let y = 0; y < h; y++) Buffer.from(s.data.buffer, s.data.byteOffset + (y * s.width + x0) * 4, w * 4).copy(sheet.data, (y * w * 3 + k * w) * 4);
      });
      const sheetPng = encodePng(sheet);
      fs.writeFileSync(path.join(SHOT_DIR, 'structures-fp-sheet.png'), sheetPng);
      const r = compareGolden(sheetPng, 'structures-factory-port');
      console.log(`[golden] structures-factory-port: ${r.status}, ${r.diffPixels} px differ`);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

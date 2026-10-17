// M10 slice 1 in headless Chromium (software WebGL2): the City on the terrain. Real keyboard and mouse events on the page: key 1 starts the placement
// mode, the ghost is green or red by the sim's validateBuild, a click on a green ghost sends the Build intent, a click on a red one shows a toast with the
// reason's text key, Escape leaves the mode. Also the instance heights against groundHeightAt, the draw-call budget and the close-up golden.
// Screenshots go to test-results/shots/structures-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, compareGolden, decodePng, analyzeImage, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { CITY_LIGHT_COUNT } from '../src/render/structureModels';
import { REJECT_BUILD_PEAK, REJECT_BUILD_SPACING, REJECT_NONE } from '../src/sim/intents';
import { STRUCT_CITY } from '../src/sim/structureRules';
import { CLASS_PEAK } from '../src/sim/terrain';
import { worldLoader } from '../tests/helpers/dataFiles';
import { cellToLatLon } from '../src/render/transforms';
import { formatGold } from '../src/ui/i18n';

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
  total: number;
  dropped: number;
  cityTriangles: number;
  list: Array<{ id: number; type: number; owner: number; cell: number; level: number; lat: number; lon: number; radius: number; heightM: number }>;
  placing: number;
  ghost: { type: number; cell: number; ok: boolean; reason: number } | null;
  toasts: string[];
  buildBar: { visible: boolean; cityPrice: number };
}
interface State {
  tick: number;
  rejects: number;
  local: { spawned: boolean; gold: number };
  structures: { count: number; byType: number[] };
  seats: Array<{ cells: number }>;
}

const T = (page: Page) => ({
  props: (): Promise<Props> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<State> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  cells: (): Promise<{ cells: number[]; capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
});

/** Opens the standard test match (seed 7, no AI), spawns at central Europe and gives the player gold. Returns the capital cell. */
async function spawned(query = 'test=1&seed=7&ai=0&hud=1', gold = 5000): Promise<{ page: Page; messages: Array<{ type: string; text: string }>; capital: number }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query);
  const t = T(page);
  await t.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
  const p = await t.project(48.5, 11);
  await page.mouse.click(p.x, p.y);
  await t.advance(0.1, 5);
  if (gold > 0) await page.evaluate((g) => (window as any).__test.give(0, { gold: g }), gold);
  await t.advance(0.1, 4);
  const { capitals } = await t.cells();
  expect((await t.state()).local.spawned).toBe(true);
  await t.advance(0.1, 210); // Fix-Sim: Build / Upgrade / Delete are refused in the 20 s spawn phase, so the helper plays past it
  return { page, messages: consoleMessages, capital: capitals[0] as number };
}

const WIDTH = 1024;
const HEIGHT = 512;
const llOf = (cell: number): { lat: number; lon: number } => cellToLatLon(cell, WIDTH, HEIGHT);

/** A camera a few km south of a place and 1.8 km over the ground, looking north and down at it (the orbit rig's focus would sit under the 12x ground). */
async function closeUp(page: Page, lat: number, lon: number, dKm = 2.6, aglM = 1100, pitchDeg = 24): Promise<void> {
  await page.evaluate(([la, lo, d, agl, pitch, time]) => (window as any).__test.setGroundView({ lat: la - d / 111.2, lon: lo, heading: 0, pitchDeg: pitch, aglM: agl, time }), [lat, lon, dKm, aglM, pitchDeg, timeForSubsolarLon(lon + 25)] as const);
}

describe('the City on the terrain', () => {
  it('key 1, a click on own land builds a City: the price goes 400 -> 600, the structure count +1, the instance stands on the ground, Esc leaves the mode', async () => {
    const { page, messages, capital } = await spawned();
    try {
      const t = T(page);
      const s0 = await t.state();
      expect(s0.structures.count).toBe(0);
      const cityBtn = page.locator('[data-testid="build-city"]');
      expect(await cityBtn.getAttribute('data-price')).toBe('400');
      const paused: number[] = [];
      await page.exposeFunction('markPause', () => paused.push(1));
      await page.evaluate(() => (window as any).__test.onPause(() => (window as any).markPause()));

      const at = llOf(capital);
      await closeUp(page, at.lat, at.lon);
      await t.settle();
      // key 1 starts the placement mode, a mouse move over own land (the capital disc) puts a green ghost there
      await page.keyboard.press('1');
      expect((await t.props()).placing).toBe(STRUCT_CITY);
      const target = llOf(capital + 3 * 0); // the capital cell itself: own, free
      const p = await t.project(target.lat, target.lon);
      expect(p.inView && p.facing).toBe(true);
      await page.mouse.move(p.x, p.y);
      await t.settle();
      const g = (await t.props()).ghost;
      expect(g).not.toBeNull();
      expect([g?.cell, g?.ok, g?.reason]).toEqual([capital, true, REJECT_NONE]);
      await page.screenshot({ path: path.join(SHOT_DIR, 'structures-ghost-green.png') });
      // a click on the green ghost sends Build; the mode is left (no shift)
      await page.mouse.click(p.x, p.y);
      expect((await t.props()).placing).toBe(0);
      await t.advance(0.1, 4); // the intent runs at T + 2
      const s1 = await t.state();
      expect(s1.structures.count).toBe(1);
      expect(s1.structures.byType[STRUCT_CITY]).toBe(1);
      expect(await cityBtn.getAttribute('data-price')).toBe('600');
      await t.settle();
      const props = await t.props();
      expect(props.counts[STRUCT_CITY]).toBe(s1.structures.byType[STRUCT_CITY]);
      expect(props.list.length).toBe(1);
      // the instance stands on the ground: its base height equals the exaggeration times groundHeightAt within 1 m
      const exag = 12;
      for (const it of props.list) {
        const h: number = await page.evaluate(([la, lo]) => (window as any).__test.groundHeightAt(la, lo), [it.lat, it.lon] as const);
        expect(Math.abs(it.heightM - exag * h)).toBeLessThan(1);
      }
      // past the build time (15 s = 150 ticks) there is still exactly one City and the sim kept it
      await t.advance(0.1, 160);
      const s2 = await t.state();
      expect(s2.structures.count).toBe(1);
      expect(s2.tick).toBeGreaterThan(s1.tick + 150);
      // Escape in the placement mode leaves the mode without the pause handler; with an empty stack it calls it
      await page.keyboard.press('1');
      expect((await t.props()).placing).toBe(STRUCT_CITY);
      await page.keyboard.press('Escape');
      expect((await t.props()).placing).toBe(0);
      expect(paused.length).toBe(0);
      await page.keyboard.press('Escape');
      expect(paused.length).toBe(1);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the ghost is red with the right reason on a Peak cell and next to a City; a click on a red ghost shows a toast with the reason key', async () => {
    const world = worldLoader();
    const sim = await world.loadSim();
    // a Peak cell in the Alps close to the start (the nearest one to central Europe)
    let peak = -1;
    let best = Infinity;
    for (let c = 0; c < sim.terrainClass.length; c++) {
      if (sim.terrainClass[c] !== CLASS_PEAK) continue;
      const l = llOf(c);
      const d = (l.lat - 46.5) ** 2 + (l.lon - 10) ** 2;
      if (d < best) {
        best = d;
        peak = c;
      }
    }
    expect(peak).toBeGreaterThanOrEqual(0);
    const { page, messages, capital } = await spawned();
    try {
      const t = T(page);
      await page.keyboard.press('1');
      // Peak: the ground under the cursor is the peak cell (the ray hits the displaced surface, the projection is of the same surface)
      const pk = llOf(peak);
      await t.view({ lat: pk.lat, lon: pk.lon, distKm: 12, heading: 0, tilt: 0, altAglM: 9000, time: timeForSubsolarLon(pk.lon + 25) });
      await t.settle();
      const pp = await t.project(pk.lat, pk.lon);
      expect(pp.inView && pp.facing).toBe(true);
      await page.mouse.move(pp.x, pp.y);
      await t.settle();
      const red = (await t.props()).ghost;
      expect([red?.cell, red?.ok, red?.reason]).toEqual([peak, false, REJECT_BUILD_PEAK]);
      await page.screenshot({ path: path.join(SHOT_DIR, 'structures-ghost-red.png') });
      // clicking it: no intent, a toast with the key of the reason
      const before = (await t.state()).rejects;
      await page.mouse.click(pp.x, pp.y);
      await t.settle();
      expect((await t.props()).toasts).toContain('toast.build.peak');
      expect(await page.locator('[data-testid="toast"][data-key="toast.build.peak"]').count()).toBe(1);
      expect((await t.props()).placing).toBe(STRUCT_CITY); // a refused click keeps the mode
      await t.advance(0, 4);
      expect((await t.state()).structures.count).toBe(0);
      expect((await t.state()).rejects).toBe(before);
      // the sim's own spacing rule, seen by the ghost: build one City, then hover a cell 2 cells away (Sim-Growth: Cities keep 3 cells apart, SPACING_CELLS_BY_TYPE)
      await page.keyboard.press('Escape');
      await page.evaluate(([c]) => (window as any).__test.submit({ kind: 'Build', seat: 0, type: 1, cell: c }), [capital] as const);
      await t.advance(0.1, 4);
      const near = llOf(capital + 2);
      await closeUp(page, near.lat, near.lon);
      await t.settle();
      await page.keyboard.press('1');
      const pn = await t.project(near.lat, near.lon);
      await page.mouse.move(pn.x, pn.y);
      await t.settle();
      const spacing = (await t.props()).ghost;
      expect([spacing?.cell, spacing?.ok, spacing?.reason]).toEqual([capital + 2, false, REJECT_BUILD_SPACING]);
      await page.keyboard.press('Escape');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('an unaffordable City: the button is dimmed and its tooltip says why (the price is the escalated one)', async () => {
    const { page, messages, capital } = await spawned('test=1&seed=7&ai=0&hud=1', 0);
    try {
      const t = T(page);
      const btn = page.locator('[data-testid="build-city"]');
      expect(await btn.getAttribute('data-state')).toBe('ok'); // the start purse (501) pays the first City (400)
      await page.evaluate(([c]) => (window as any).__test.submit({ kind: 'Build', seat: 0, type: 1, cell: c }), [capital] as const);
      await t.advance(0.1, 4);
      const s = await t.state();
      expect(s.local.gold).toBeLessThan(600);
      expect(await btn.getAttribute('data-price')).toBe('600');
      expect(await btn.getAttribute('data-state')).toBe('poor');
      const tip = await btn.getAttribute('title');
      expect(tip).toBe(await page.evaluate((p) => (window as any).__test.text('hud.build.tooPoor', { price: p }), formatGold(600)));
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('adds at most 2 draw calls, reads clearly in a close-up (screenshot and golden) and the layer matches the snapshot', async () => {
    const { page, messages, capital } = await spawned('test=1&seed=7&ai=0&hud=0');
    try {
      const t = T(page);
      const at = llOf(capital);
      await closeUp(page, at.lat, at.lon);
      await t.settle();
      const base = await t.info();
      // the same far view before and after: the City is a visible mark from high up (the scale policy)
      const farView = { lat: at.lat, lon: at.lon, distKm: 1500, heading: 0, tilt: 30, time: timeForSubsolarLon(at.lon + 25) };
      await t.view(farView);
      await t.settle();
      const farBefore = decodePng(await page.screenshot({ type: 'png' }));
      await closeUp(page, at.lat, at.lon);
      await t.settle();
      await page.evaluate(([c]) => (window as any).__test.submit({ kind: 'Build', seat: 0, type: 1, cell: c }), [capital] as const);
      await t.advance(0.1, 4);
      await t.settle(3);
      await t.advance(0.1, 160); // past the build time of 150 ticks: the finished look
      await t.advance(1, 0); // and past the pop-in tween (0.45 s on the fx clock)
      await t.settle();
      const withCity = await t.info();
      const props = await t.props();
      expect(props.counts[STRUCT_CITY]).toBe(1);
      expect(props.cityTriangles).toBeGreaterThan(50);
      expect(props.cityTriangles).toBeLessThanOrEqual(300);
      expect(withCity.drawCalls - base.drawCalls).toBeGreaterThanOrEqual(1);
      expect(withCity.drawCalls - base.drawCalls).toBeLessThanOrEqual(2);
      // M10-4: the City's three bulbs (8 triangles each) ride in its instance buffers and its far icon is one quad (2 triangles)
      expect(withCity.triangles - base.triangles).toBe(props.cityTriangles + CITY_LIGHT_COUNT * 8 + 2);
      const png = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, 'structures-city-closeup.png'), png);
      await t.view(farView);
      await t.settle();
      const farPng = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, 'structures-city-far.png'), farPng);
      const farAfter = decodePng(farPng);
      const mark = await t.project(at.lat, at.lon);
      let changed = 0;
      for (let y = Math.max(0, Math.round(mark.y) - 30); y < Math.min(farAfter.height, Math.round(mark.y) + 30); y++) {
        for (let x = Math.max(0, Math.round(mark.x) - 30); x < Math.min(farAfter.width, Math.round(mark.x) + 30); x++) {
          const i = (y * farAfter.width + x) * 4;
          const d = Math.abs((farAfter.data[i] as number) - (farBefore.data[i] as number)) + Math.abs((farAfter.data[i + 1] as number) - (farBefore.data[i + 1] as number)) + Math.abs((farAfter.data[i + 2] as number) - (farBefore.data[i + 2] as number));
          if (d > 60) changed++;
        }
      }
      expect(changed, 'pixels the City changes around its place at 1500 km').toBeGreaterThan(100);
      expect(analyzeImage(decodePng(png)).lumaStd).toBeGreaterThan(15); // not a flat picture
      const r = compareGolden(png, 'structures-city');
      console.log(`[golden] structures-city: ${r.status}, ${r.diffPixels} px differ`);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// M10-3 in headless Chromium (software WebGL2): the Silo (key 4), the SAM site (key 5) and the Defense Post (key 6) on the terrain. Real keyboard and mouse
// events: key 6 + a click builds a Post and the escalated price goes up; key 5 on a Mountain cell builds a SAM site; key 4 without a Factory gives a red ghost
// and the Silo-needs-Factory toast; heights against groundHeightAt; the draw-call budget; the SAM dish turns with the fx clock; a close-up of the three.
// Screenshots go to test-results/shots/structures-military-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, analyzeImage, compareGolden, decodePng, encodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { REJECT_BUILD_NO_FACTORY, REJECT_NONE } from '../src/sim/intents';
import { STRUCT_FACTORY, STRUCT_POST, STRUCT_SAM, STRUCT_SILO } from '../src/sim/structureRules';
import { CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS } from '../src/sim/terrain';
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
  total: number;
  dropped: number;
  list: Array<{ id: number; type: number; owner: number; cell: number; level: number; lat: number; lon: number; radius: number; heightM: number }>;
  placing: number;
  ghost: { type: number; cell: number; ok: boolean; reason: number } | null;
  toasts: string[];
}
interface State {
  tick: number;
  rejects: number;
  local: { spawned: boolean; gold: number };
  structures: { count: number; byType: number[] };
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
  submit: (body: Record<string, unknown>): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
  price: async (testid: string): Promise<string | null> => page.locator(`[data-testid="${testid}"]`).getAttribute('data-price'),
});

async function spawned(query = 'test=1&seed=7&ai=0&hud=1', gold = 6000, viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Array<{ type: string; text: string }>; capital: number }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  const t = T(page);
  await t.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
  const p = await t.project(48.5, 11);
  await page.mouse.click(p.x, p.y);
  await t.advance(0.1, 5);
  if (gold > 0) await page.evaluate((g) => (window as any).__test.give(0, { gold: g }), gold);
  await t.advance(0.1, 4);
  const { capitals } = await t.cells();
  expect((await t.state()).local.spawned).toBe(true);
  return { page, messages: consoleMessages, capital: capitals[0] as number };
}

const WIDTH = 1024;
const HEIGHT = 512;
const llOf = (cell: number): { lat: number; lon: number } => cellToLatLon(cell, WIDTH, HEIGHT);

async function closeUp(page: Page, lat: number, lon: number, dKm = 2.2, aglM = 900, pitchDeg = 24, extraSeconds = 0): Promise<void> {
  await page.evaluate(([la, lo, d, agl, pitch, time]) => (window as any).__test.setGroundView({ lat: la - d / 111.2, lon: lo, heading: 0, pitchDeg: pitch, aglM: agl, time }), [lat, lon, dKm, aglM, pitchDeg, timeForSubsolarLon(lon + 25) + extraSeconds] as const);
}

/** A hover over a cell: the camera is put close to it, the mouse over it, and the ghost is read back. */
async function hover(page: Page, cell: number): Promise<Props['ghost']> {
  const t = T(page);
  const at = llOf(cell);
  await closeUp(page, at.lat, at.lon);
  await t.settle();
  const p = await t.project(at.lat, at.lon);
  expect(p.inView && p.facing).toBe(true);
  await page.mouse.move(p.x, p.y);
  await t.settle();
  return (await t.props()).ghost;
}

async function click(page: Page, cell: number): Promise<void> {
  const at = llOf(cell);
  const p = await T(page).project(at.lat, at.lon);
  await page.mouse.click(p.x, p.y);
}

/** Owned cells near the capital that suit every military type (Plains or Hills: not Forest for the Silo, no Peak), at least 4 cells from the capital, nearest first. */
async function plainCellsNear(page: Page, capital: number, count: number, terrain: Uint8Array): Promise<number[]> {
  const cx = capital % WIDTH;
  const cy = (capital - cx) / WIDTH;
  const cand: Array<{ c: number; d: number }> = [];
  for (let dy = -12; dy <= 12; dy++) {
    for (let dx = -12; dx <= 12; dx++) {
      const d = Math.hypot(dx, dy);
      if (d < 4) continue;
      const c = (cy + dy) * WIDTH + ((cx + dx + WIDTH) % WIDTH);
      if (terrain[c] === CLASS_PLAINS || terrain[c] === CLASS_HILLS) cand.push({ c, d });
    }
  }
  cand.sort((p, q) => p.d - q.d);
  const out: number[] = [];
  for (const k of cand) {
    if ((await page.evaluate((x) => (window as any).__test.ownerOf(x), k.c)) !== 1) continue;
    out.push(k.c);
    if (out.length === count) break;
  }
  return out;
}

const heightsMatch = async (page: Page, props: Props): Promise<void> => {
  for (const it of props.list) {
    const h: number = await page.evaluate(([la, lo]) => (window as any).__test.groundHeightAt(la, lo), [it.lat, it.lon] as const);
    expect(Math.abs(it.heightM - 12 * h), `type ${it.type} at cell ${it.cell}`).toBeLessThan(1);
  }
};

describe('Silo, SAM site and Defense Post on the terrain', () => {
  it('key 6 + a click builds a Defense Post: the price goes 250 -> 375, the count +1, the instance stands on the ground', async () => {
    const { page, messages, capital } = await spawned();
    try {
      const t = T(page);
      expect(await t.price('build-post')).toBe('250');
      expect(await t.price('build-sam')).toBe('600');
      expect(await t.price('build-silo')).toBe('1000');
      await page.keyboard.press('6');
      expect((await t.props()).placing).toBe(STRUCT_POST);
      const g = await hover(page, capital);
      expect([g?.type, g?.cell, g?.ok, g?.reason]).toEqual([STRUCT_POST, capital, true, REJECT_NONE]);
      await click(page, capital);
      expect((await t.props()).placing).toBe(0);
      await t.advance(0.1, 4);
      const s = await t.state();
      expect(s.structures.byType[STRUCT_POST]).toBe(1);
      expect(await t.price('build-post')).toBe('375');
      await t.settle();
      const props = await t.props();
      expect(props.counts[STRUCT_POST]).toBe(1);
      await heightsMatch(page, props);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a Silo without a Factory: red ghost and the Silo-needs-Factory toast, the button is locked; SAM on a Mountain cell builds; three types in one view, dish and golden', async () => {
    const sim = await worldLoader().loadSim();
    const terrain = sim.terrainClass as unknown as Uint8Array;
    // a Mountain cell on a ridge: the Mountain cell nearest to the Alps that has a Peak within two cells
    let ridge = -1;
    let best = Infinity;
    for (let c = 0; c < terrain.length; c++) {
      if (terrain[c] !== CLASS_MOUNTAIN) continue;
      const x = c % WIDTH;
      const y = (c - x) / WIDTH;
      let peak = false;
      for (let dy = -2; dy <= 2 && !peak; dy++) for (let dx = -2; dx <= 2; dx++) if (terrain[(y + dy) * WIDTH + ((x + dx + WIDTH) % WIDTH)] === CLASS_PEAK) peak = true;
      if (!peak) continue;
      const l = llOf(c);
      const d = (l.lat - 46.6) ** 2 + (l.lon - 10.2) ** 2;
      if (d < best) {
        best = d;
        ridge = c;
      }
    }
    expect(ridge).toBeGreaterThanOrEqual(0);
    const { page, messages, capital } = await spawned('test=1&seed=7&ai=0&hud=1', 7000);
    try {
      const t = T(page);
      // the ridge becomes the player's land (the debug intent), so that the terrain rules and not the ownership rule speak
      await t.submit({ kind: 'DebugPaint', seat: 0, cell: ridge });
      await t.advance(0.1, 4);
      expect(await page.evaluate((c) => (window as any).__test.ownerOf(c), ridge)).toBe(1);
      expect(await page.locator('[data-testid="build-silo"]').getAttribute('data-state')).toBe('locked');
      expect(await page.locator('[data-testid="build-silo"]').getAttribute('title')).toBe(await page.evaluate(() => (window as any).__test.text('hud.build.needFactory', { name: (window as any).__test.text('hud.build.silo') })));
      // key 4 without a Factory: the ghost is red with the right reason, a click shows the toast and sends nothing
      await page.keyboard.press('4');
      expect((await t.props()).placing).toBe(STRUCT_SILO);
      const red = await hover(page, ridge);
      expect([red?.type, red?.ok, red?.reason]).toEqual([STRUCT_SILO, false, REJECT_BUILD_NO_FACTORY]);
      const rejects = (await t.state()).rejects;
      await click(page, ridge);
      await t.settle();
      expect((await t.props()).toasts).toContain('toast.build.noFactory');
      expect(await page.locator('[data-testid="toast"][data-key="toast.build.noFactory"]').count()).toBe(1);
      await t.advance(0, 4);
      expect((await t.state()).structures.count).toBe(0);
      expect((await t.state()).rejects).toBe(rejects);
      await page.keyboard.press('Escape');
      expect((await t.props()).placing).toBe(0);
      // key 5 on the Mountain cell: green (SAM is allowed on a mountain), a click builds it
      await page.keyboard.press('5');
      const green = await hover(page, ridge);
      expect([green?.type, green?.ok, green?.reason]).toEqual([STRUCT_SAM, true, REJECT_NONE]);
      await page.screenshot({ path: path.join(SHOT_DIR, 'structures-military-ghost-sam.png') });
      await click(page, ridge);
      await t.advance(0.1, 4);
      expect((await t.state()).structures.byType[STRUCT_SAM]).toBe(1);
      expect(await t.price('build-sam')).toBe('900');
      // a Factory first (it has no model in this slice, the sim keeps it), then the Silo and a Post on plain land near the capital
      const [siloCell, postCell] = await plainCellsNear(page, capital, 2, terrain);
      expect(siloCell !== undefined && postCell !== undefined).toBe(true);
      // the draw-call baseline: this very view with only the SAM site built (its mesh draws wherever the camera is: frustum culling is off for the layer)
      await closeUp(page, llOf(siloCell as number).lat, llOf(siloCell as number).lon);
      await t.settle();
      const none = await t.info();
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_FACTORY, cell: capital });
      await t.advance(0.1, 4);
      await t.advance(0.1, 210); // the Factory is finished (200 ticks)
      expect(await page.locator('[data-testid="build-silo"]').getAttribute('data-state')).toBe('ok');
      await page.keyboard.press('4');
      const siloGhost = await hover(page, siloCell as number);
      expect([siloGhost?.type, siloGhost?.ok, siloGhost?.reason]).toEqual([STRUCT_SILO, true, REJECT_NONE]);
      await click(page, siloCell as number);
      await page.keyboard.press('6');
      await hover(page, postCell as number);
      await click(page, postCell as number);
      await t.advance(0.1, 4);
      const s = await t.state();
      expect([s.structures.byType[STRUCT_SILO], s.structures.byType[STRUCT_SAM], s.structures.byType[STRUCT_POST]]).toEqual([1, 1, 1]);
      await t.advance(0.1, 270); // past the longest build time (250 ticks)
      await t.advance(1, 0); // and past the pop-in tween
      await t.settle();
      const props = await t.props();
      expect([props.counts[STRUCT_SILO], props.counts[STRUCT_SAM], props.counts[STRUCT_POST]]).toEqual([1, 1, 1]);
      expect(props.dropped).toBe(0);
      await heightsMatch(page, props);

      // draw calls: the Silo and the Post add one each next to the SAM site's, and the whole structure layer stays inside the 10 of the budget
      await closeUp(page, llOf(siloCell as number).lat, llOf(siloCell as number).lon);
      await t.settle();
      const withAll = await t.info();
      expect(withAll.drawCalls - none.drawCalls).toBeGreaterThanOrEqual(1);
      expect(withAll.triangles - none.triangles).toBeGreaterThan(100);
      expect(withAll.drawCalls - none.drawCalls).toBeLessThanOrEqual(10);

      // the close-ups: Silo, SAM, Post side by side (centre crops of three frames)
      const panels: Array<{ name: string; cell: number }> = [
        { name: 'silo', cell: siloCell as number },
        { name: 'sam', cell: ridge },
        { name: 'post', cell: postCell as number },
      ];
      const crops: Array<ReturnType<typeof decodePng>> = [];
      const marks: Array<{ x: number; y: number }> = [];
      await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' }); // the pictures show the models, not the HUD
      for (const pn of panels) {
        const at = llOf(pn.cell);
        await closeUp(page, at.lat, at.lon, 3.0, 1200, 24);
        await t.settle();
        const mark = await t.project(at.lat, at.lon);
        marks.push(mark);
        const png = await page.screenshot({ type: 'png' });
        fs.writeFileSync(path.join(SHOT_DIR, `structures-military-${pn.name}.png`), png);
        crops.push(decodePng(png));
      }
      const cw = 480;
      const ch = 380;
      const sheet = { width: cw * 3, height: ch, data: Buffer.alloc(cw * 3 * ch * 4) };
      crops.forEach((img, k) => {
        // the panel is centred on the structure's base (a little above it: the models are taller than wide), clamped to the frame
        const m = marks[k] as { x: number; y: number };
        const x0 = Math.max(0, Math.min(img.width - cw, Math.round(m.x - cw / 2)));
        const y0 = Math.max(0, Math.min(img.height - ch, Math.round(m.y - ch * 0.72)));
        for (let y = 0; y < ch; y++) sheet.data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + cw) * 4), (y * cw * 3 + k * cw) * 4);
      });
      const sheetPng = encodePng(sheet);
      fs.writeFileSync(path.join(SHOT_DIR, 'structures-military.png'), sheetPng);
      expect(analyzeImage(decodePng(sheetPng)).lumaStd).toBeGreaterThan(15);
      const r = compareGolden(sheetPng, 'structures-military');
      console.log(`[golden] structures-military: ${r.status}, ${r.diffPixels} px differ`);

      // the SAM dish turns with the fx clock; the Post (a control with the same lighting change) does not
      const dishDiff = async (cell: number): Promise<number> => {
        const at = llOf(cell);
        await closeUp(page, at.lat, at.lon, 3.6, 1500, 24);
        await t.settle();
        const a = decodePng(await page.screenshot({ type: 'png' }));
        await closeUp(page, at.lat, at.lon, 3.6, 1500, 24, 1800); // one whole sun day (SUN_DAY_SECONDS) later: the same light, another fx time
        await t.settle();
        const b = decodePng(await page.screenshot({ type: 'png' }));
        let n = 0;
        for (let y = Math.round(a.height / 2) - 150; y < Math.round(a.height / 2) + 150; y++) {
          for (let x = Math.round(a.width / 2) - 150; x < Math.round(a.width / 2) + 150; x++) {
            const i = (y * a.width + x) * 4;
            const d = Math.abs((a.data[i] as number) - (b.data[i] as number)) + Math.abs((a.data[i + 1] as number) - (b.data[i + 1] as number)) + Math.abs((a.data[i + 2] as number) - (b.data[i + 2] as number));
            if (d > 40) n++;
          }
        }
        return n;
      };
      const sam = await dishDiff(ridge);
      const post = await dishDiff(postCell as number);
      console.log(`[dish] changed pixels one sun day apart: SAM ${sam}, Post ${post}`);
      expect(sam).toBeGreaterThan(150);
      expect(sam).toBeGreaterThan(post * 3 + 100);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  for (const [name, w, h] of [['landscape', 960, 540], ['portrait', 540, 960]] as const) {
    it(`the build bar with the three buttons fits the ${name} window (${w} x ${h}) without leaving it or covering the hint`, async () => {
      const { page, messages } = await spawned(`test=1&seed=7&ai=0&hud=1&w=${w}&h=${h}`, 0, { width: w, height: h });
      try {
        const t = T(page);
        await page.keyboard.press('5');
        await t.settle();
        const boxes = await page.evaluate(() => {
          const r = (e: Element | null) => (e === null ? null : e.getBoundingClientRect().toJSON());
          return { bar: r(document.querySelector('[data-testid="build-bar"]')), hint: r(document.querySelector('[data-testid="build-hint"]')), btns: Array.from(document.querySelectorAll('.build-btn')).map((b) => r(b)) };
        });
        await page.screenshot({ path: path.join(SHOT_DIR, `structures-military-bar-${name}.png`) });
        expect(boxes.bar).not.toBeNull();
        for (const b of boxes.btns as Array<{ left: number; right: number; top: number; bottom: number }>) {
          expect(b.left).toBeGreaterThanOrEqual(0);
          expect(b.right).toBeLessThanOrEqual(w);
          expect(b.bottom).toBeLessThanOrEqual(h);
        }
        const bar = boxes.bar as { top: number };
        const hint = boxes.hint as { bottom: number; width: number } | null;
        if (hint !== null && hint.width > 0) expect(hint.bottom).toBeLessThanOrEqual(bar.top + 1);
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }
});

// Districts-2b in headless Chromium (software WebGL2): the district layer on a City. A City is built through the intent API, taken to level 3 (four
// slots) and given one district of each kind; the layer draws them as ONE instanced draw call, standing on the ground, with the owner colour; it is
// empty (and costs no draw call) without districts and beyond the cut distance; a close-up is compared with the golden districts-layer.png.
// Screenshots go to test-results/shots/districts-layer-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, analyzeImage, compareGolden, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { cellToLatLon } from '../src/render/transforms';
import { DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_WALLS, STRUCT_CITY, buildBody, buildDistrictBody, upgradeBody } from '../src/sim/public';

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

interface DrawnDistrict {
  structure: number;
  slot: number;
  kind: number;
  level: number;
  cityLevel: number;
  lat: number;
  lon: number;
  heightM: number;
}
interface Props {
  list: Array<{ id: number; type: number; level: number; cell: number }>;
  districts: { counts: number[]; total: number; triangles: number; dropped: number; drawn: boolean; list: DrawnDistrict[] };
}

const T = (page: Page) => ({
  props: (): Promise<Props> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ tick: number; rejects: number; local: { spawned: boolean } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  cells: (): Promise<{ cells: number[]; capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
  submit: (body: unknown): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
  groundAt: (lat: number, lon: number): Promise<number> => page.evaluate(([a, o]) => (window as any).__test.groundHeightAt(a, o), [lat, lon] as const),
});

const WIDTH = 1024;
const HEIGHT = 512;

async function closeUp(page: Page, lat: number, lon: number, dKm: number, aglM: number, pitchDeg: number, night = false): Promise<void> {
  const time = timeForSubsolarLon(night ? lon + 180 : lon + 25);
  await page.evaluate(([la, lo, d, agl, pitch, tm]) => (window as any).__test.setGroundView({ lat: la - d / 111.2, lon: lo, heading: 0, pitchDeg: pitch, aglM: agl, time: tm }), [lat, lon, dKm, aglM, pitchDeg, time] as const);
}

/** A page with a spawned local seat, a finished City of level 3 on the capital and (when `districts`) one district of each kind, all finished. */
async function cityPage(districts: boolean): Promise<{ page: Page; messages: Array<{ type: string; text: string }>; cityId: number; cell: number }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 });
  const t = T(page);
  await t.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
  const p = await t.project(48.5, 11);
  await page.mouse.click(p.x, p.y);
  await t.advance(0.1, 5);
  await page.evaluate(() => (window as any).__test.give(0, { gold: 60000 }));
  await t.advance(0.1, 4);
  expect((await t.state()).local.spawned).toBe(true);
  await t.advance(0.1, 210); // past the spawn phase
  const { capitals } = await t.cells();
  const cell = capitals[0] as number;
  await t.submit(buildBody(0, STRUCT_CITY, cell));
  await t.advance(0.1, 170);
  await t.settle(1);
  let props = await t.props();
  const city = props.list.find((s) => s.type === STRUCT_CITY);
  expect(city, 'the City is built').toBeDefined();
  const cityId = (city as { id: number }).id;
  for (let lvl = 2; lvl <= 3; lvl++) {
    await t.submit(upgradeBody(0, cityId));
    await t.advance(0.1, 260);
  }
  await t.settle(1);
  props = await t.props();
  expect(props.list.find((s) => s.id === cityId)?.level).toBe(3);
  if (districts) {
    const kinds = [DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_WALLS];
    for (let s = 0; s < 4; s++) await t.submit(buildDistrictBody(0, cityId, s, kinds[s] as number));
    await t.advance(0.1, 140);
  }
  return { page, messages: consoleMessages, cityId, cell };
}

describe('the district layer', () => {
  it('is empty and costs no draw call without districts', async () => {
    const { page, cell } = await cityPage(false);
    try {
      const t = T(page);
      const at = cellToLatLon(cell, WIDTH, HEIGHT);
      await closeUp(page, at.lat, at.lon, 2.2, 900, 24);
      await t.settle();
      const props = await t.props();
      expect(props.districts.total).toBe(0);
      expect(props.districts.drawn).toBe(false);
      const none = await t.info();
      expect(none.drawCalls).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 240_000);

  it('draws four districts in ONE draw call, on the ground, in the owner colour; golden close-up; night; cut', async () => {
    const empty = await cityPage(false);
    let withoutCalls: number;
    let cell: number;
    try {
      const at = cellToLatLon(empty.cell, WIDTH, HEIGHT);
      await closeUp(empty.page, at.lat, at.lon, 2.2, 900, 24);
      await T(empty.page).settle();
      withoutCalls = (await T(empty.page).info()).drawCalls;
      cell = empty.cell;
    } finally {
      await empty.page.close();
    }
    const { page, messages, cityId } = await cityPage(true);
    try {
      const t = T(page);
      const at = cellToLatLon(cell, WIDTH, HEIGHT);
      await closeUp(page, at.lat, at.lon, 2.2, 900, 24);
      await t.settle();
      const props = await t.props();
      expect(props.districts.total).toBe(4);
      expect(props.districts.counts.slice(1)).toEqual([1, 1, 1, 1]);
      expect(props.districts.dropped).toBe(0);
      expect(props.districts.drawn).toBe(true);
      expect(props.districts.list.every((d) => d.structure === cityId && d.cityLevel === 3)).toBe(true);
      // heights: every instance stands within 1 m of the ground under its slot (the exaggeration of the test tier is 12)
      for (const d of props.districts.list) {
        const h = await t.groundAt(d.lat, d.lon);
        expect(Math.abs(d.heightM - 12 * h), `kind ${d.kind} slot ${d.slot}`).toBeLessThan(1);
      }
      // the draw call: exactly one more than the same frame without districts
      const withD = await t.info();
      expect(withD.drawCalls - withoutCalls).toBe(1);
      expect(props.districts.triangles).toBeLessThanOrEqual(9000);

      await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' });
      const shot = async (name: string): Promise<Buffer> => {
        await t.settle();
        const png = await page.screenshot({ type: 'png' });
        fs.writeFileSync(path.join(SHOT_DIR, `districts-layer-${name}.png`), png);
        return png;
      };
      await closeUp(page, at.lat, at.lon, 4.6, 7600, 56);
      await page.evaluate(() => (window as any).__test.settle(1, 2)); // the pop-in of the new districts (0.45 s of fx time) is over
      const day = await shot('day');
      expect(analyzeImage(decodePng(day)).lumaStd).toBeGreaterThan(15);
      const r = compareGolden(day, 'districts-layer');
      console.log(`[golden] districts-layer: ${r.status}, ${r.diffPixels} px differ`);

      // night view: still readable (the picture is not black: the owner glow and rim lift the models)
      await closeUp(page, at.lat, at.lon, 4.6, 7600, 56, true);
      const night = decodePng(await shot('night'));
      expect(analyzeImage(night).lumaStd).toBeGreaterThan(6);

      // beyond the cut distance nothing is drawn: a view from 3000 km
      await t.view({ lat: at.lat, lon: at.lon, distKm: 3000, heading: 0, tilt: 0 });
      await t.settle();
      const far = await t.props();
      expect(far.districts.total).toBe(4); // still in the buffers ...
      expect(far.districts.drawn).toBe(false); // ... but not in the draw
      expect((await t.info()).drawCalls).toBe(withoutCalls);
      expect(messages.filter((m) => m.type === 'error')).toEqual([]);
    } finally {
      await page.close();
    }
  }, 480_000);
});

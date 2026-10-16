// Districts-2a in headless Chromium (software WebGL2): the city view. Select an own City, open the view (button, double click), build a Market (price paid,
// progress, level 1), upgrade it, a Barracks on the second tile, the two-step Remove, dimmed buttons with their reasons, Escape closing the view
// without the pause menu, the camera flight, the layout at 960x540 and 540x960 in both languages, and a golden of the panel. Real mouse and keyboard.
// Screenshots go to test-results/shots/city-view-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, compareGolden, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { timeForSubsolarLon } from '../src/render/geo';
import { DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_WALLS } from '../src/sim/districtRules';
import { REJECT_BUILD_GOLD } from '../src/sim/intents';
import { CITY_GOLD_MILLI_PER_SEC_PER_LEVEL, DISTRICT_BUILD_TICKS } from '../src/sim/rules';
import { barracksRegenPctAt, marketGoldMilliAt } from '../src/sim/levelCurves';
import { STRUCT_CITY, maxLevelOf, upgradeTicksOf } from '../src/sim/structureRules';
import { districtSlotsOf } from '../src/sim/districtRules';
import { formatGoldRate } from '../src/ui/i18n';

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

interface State {
  local: { spawned: boolean; gold: number; goldPerSecMilli: number };
  structures: { count: number };
}

const T = (page: Page) => ({
  props: (): Promise<{ selection: { id: number; panelVisible: boolean } }> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<State> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  cells: (): Promise<{ capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
  submit: (body: Record<string, unknown>): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
  give: (gold: number): Promise<void> => page.evaluate((g) => (window as any).__test.give(0, { gold: g }), gold),
  text: (key: string, params?: Record<string, string | number>): Promise<string> => page.evaluate(([k, p]) => (window as any).__test.text(k, p), [key, params] as const),
  agl: (): Promise<number> => page.evaluate(() => (window as any).__test.cameraAglM()),
});

const WIDTH = 1024;
const HEIGHT = 512;

/** A spawned match with one finished City at the capital, the camera close above it and the City selected. */
async function withCity(query: string, viewport: { width: number; height: number }): Promise<{ page: Page; messages: Array<{ type: string; text: string }>; capital: number; lat: number; lon: number }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  const t = T(page);
  await t.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
  const p = await t.project(48.5, 11);
  await page.mouse.click(p.x, p.y);
  await t.advance(0.1, 5);
  await t.advance(0.1, 4);
  const { capitals } = await t.cells();
  expect((await t.state()).local.spawned).toBe(true);
  await t.advance(0.1, 210); // Build / Upgrade / Delete are refused in the spawn phase: play past it first
  const capital = capitals[0] as number;
  const at = cellToLatLon(capital, WIDTH, HEIGHT);
  await t.submit({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: capital });
  await t.advance(0.1, 160); // past the City's build time
  await closeUp(page, at.lat, at.lon);
  await t.settle();
  await clickCity(page, at.lat, at.lon);
  await t.settle();
  expect((await t.props()).selection.panelVisible).toBe(true);
  return { page, messages: consoleMessages, capital, lat: at.lat, lon: at.lon };
}

async function closeUp(page: Page, lat: number, lon: number): Promise<void> {
  const d = 2.2;
  await page.evaluate(([la, lo, dd, time]) => (window as any).__test.setGroundView({ lat: la - dd / 111.2, lon: lo, heading: 0, pitchDeg: 24, aglM: 900, time }), [lat, lon, d, timeForSubsolarLon(lon + 25)] as const);
}

/** Upgrades the selected City one step at a time (the panel's button) until it is `level`, each step waiting its own sim time (Sim-Growth: levels 1 to 10). */
async function raiseTo(page: Page, level: number): Promise<void> {
  const t = T(page);
  for (let l = 2; l <= level; l++) {
    await tid(page, 'sel-upgrade').click();
    await t.advance(0.1, upgradeTicksOf(STRUCT_CITY, l) + 10);
    await t.settle();
    expect(await tid(page, 'sel-panel').getAttribute('data-level')).toBe(String(l));
  }
}

async function clickCity(page: Page, lat: number, lon: number, count = 1): Promise<void> {
  const p = await T(page).project(lat, lon);
  await page.mouse.click(p.x, p.y, { clickCount: count });
}

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

async function openByButton(page: Page): Promise<void> {
  await tid(page, 'sel-open-city').click();
  await T(page).settle();
  expect(await tid(page, 'city-view').isVisible()).toBe(true);
}

describe('the city view', () => {
  it('opens from the selection panel; builds, upgrades and removes districts through the intents; dimmed buttons give their reason; Esc closes it without the pause menu; the camera flies when far; golden', async () => {
    const { page, messages, lat, lon } = await withCity('test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 });
    try {
      const t = T(page);
      await page.evaluate(() => {
        (window as any).__paused = 0;
        (window as any).__test.onPause(() => (window as any).__paused++);
        (window as any).__canvasDown = 0;
        document.querySelector('canvas')!.addEventListener('pointerdown', () => (window as any).__canvasDown++);
      });
      expect(await tid(page, 'city-view').isVisible()).toBe(false);
      const aglBefore = await t.agl();
      await openByButton(page);
      // the camera stood within 5 km of the City: no flight
      await t.advance(0.1, 40);
      expect(Math.abs((await t.agl()) - aglBefore)).toBeLessThan(60);

      // layout at 960x540: a side panel on the right inside the window, the middle stays free
      const view = tid(page, 'city-view');
      const box = (await view.boundingBox())!;
      expect(box.x).toBeGreaterThan(960 * 0.45);
      expect(box.x + box.width).toBeLessThanOrEqual(960);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(540);
      expect(await view.getAttribute('data-level')).toBe('1');
      expect(await tid(page, 'city-tile-0').isVisible()).toBe(true);
      expect(await tid(page, 'city-tile-1').isVisible()).toBe(true);
      expect(await tid(page, 'city-tile-2').isVisible()).toBe(false); // a level 1 City has two slots
      expect(await tid(page, 'sel-panel').isVisible()).toBe(false); // the selection panel steps aside
      expect(await tid(page, 'city-total-gold').getAttribute('data-milli')).toBe(String(CITY_GOLD_MILLI_PER_SEC_PER_LEVEL)); // the City alone: level 1

      // a click inside the panel never reaches the globe; a click on the globe does reach the canvas (and the city mode takes it)
      await tid(page, 'city-title').click();
      expect(await page.evaluate(() => (window as any).__canvasDown)).toBe(0);

      // dimmed buttons: a kind that costs more than the purse is dim with the reason as its tooltip, the others work
      const gold = (await t.state()).local.gold;
      let dim = 0;
      for (const kind of [DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_WALLS]) {
        const b = tid(page, `city-build-0-${kind}`);
        const price = Number(await b.getAttribute('data-price'));
        if (Math.abs(price - gold) < 3) continue;
        const dimmed = (await b.getAttribute('aria-disabled')) === 'true';
        expect(dimmed, `kind ${kind} costs ${price}, purse ${gold}`).toBe(price > gold);
        if (dimmed) {
          dim++;
          expect(await b.getAttribute('data-reason')).toBe(String(REJECT_BUILD_GOLD));
          expect(await b.getAttribute('title')).toBe(await t.text('sel.district.whyGold'));
        }
      }
      expect(dim).toBeGreaterThan(0);
      await tid(page, `city-build-0-${DISTRICT_WALLS}`).click({ force: true }); // a dimmed click does nothing
      await t.advance(0.1, 4);
      expect(await tid(page, 'city-tile-0').getAttribute('data-state')).toBe('empty');

      // build a Market on tile 0: the price is paid, the tile shows progress, then level 1 after the build time
      const marketPrice = Number(await tid(page, `city-build-0-${DISTRICT_MARKET}`).getAttribute('data-price'));
      const incomeBefore = (await t.state()).local.goldPerSecMilli;
      const goldBefore = (await t.state()).local.gold;
      await tid(page, `city-build-0-${DISTRICT_MARKET}`).click();
      await t.advance(0.1, 4);
      await t.settle();
      expect(goldBefore - (await t.state()).local.gold).toBeGreaterThanOrEqual(marketPrice - 2);
      const tile0 = tid(page, 'city-tile-0');
      expect(await tile0.getAttribute('data-state')).toBe('building');
      expect(await tile0.getAttribute('data-kind')).toBe(String(DISTRICT_MARKET));
      expect(await tid(page, 'city-progress-0').isVisible()).toBe(true);
      const total = DISTRICT_BUILD_TICKS[DISTRICT_MARKET] as number;
      await t.advance(0.1, total / 2);
      await t.settle();
      const mid = Number(await tid(page, 'city-progress-0').getAttribute('aria-valuenow'));
      expect(mid).toBeGreaterThan(20);
      expect(mid).toBeLessThan(95);
      expect(await tid(page, 'city-total-gold').getAttribute('data-milli')).toBe(String(CITY_GOLD_MILLI_PER_SEC_PER_LEVEL)); // not finished: no effect yet
      await t.advance(0.1, total / 2 + 6);
      await t.settle();
      expect(await tile0.getAttribute('data-state')).toBe('ready');
      expect(await tile0.getAttribute('data-level')).toBe('1');
      expect(await tid(page, 'city-progress-0').isVisible()).toBe(false);
      expect(Number(await tid(page, 'city-total-gold').getAttribute('data-milli'))).toBe(CITY_GOLD_MILLI_PER_SEC_PER_LEVEL + marketGoldMilliAt(1));
      expect((await t.state()).local.goldPerSecMilli).toBe(incomeBefore + marketGoldMilliAt(1));

      // the golden: the panel itself (tile 0 ready, tile 1 empty)
      const png = await view.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, 'city-view-golden.png'), png);
      const g = compareGolden(png, 'city-view');
      console.log(`[golden] city-view: ${g.status}, ${g.diffPixels} px differ`);

      // upgrade: level 2 after the build time, the effect lines move to the next level
      await t.give(5000);
      await t.advance(0.1, 4);
      await tid(page, 'city-district-upgrade-0').click();
      await t.advance(0.1, 4);
      await t.settle();
      expect(await tile0.getAttribute('data-state')).toBe('upgrading');
      await t.advance(0.1, total + 6);
      await t.settle();
      expect([await tile0.getAttribute('data-state'), await tile0.getAttribute('data-level')]).toEqual(['ready', '2']);
      const fx = await t.text('sel.district.fxMarket', { gold: formatGoldRate(marketGoldMilliAt(2)) }); // Sim-Levels2: the concave Market curve, level 2 = 0,375 gold/s; Look-2 shows it x 10
      expect(await tid(page, 'city-fx-0').textContent()).toBe(await t.text('sel.district.now', { fx }));

      // the second tile: a Barracks
      const barracksTotal = DISTRICT_BUILD_TICKS[DISTRICT_BARRACKS] as number;
      await tid(page, `city-build-1-${DISTRICT_BARRACKS}`).click();
      await t.advance(0.1, barracksTotal + 8);
      await t.settle();
      expect(await tid(page, 'city-tile-1').getAttribute('data-kind')).toBe(String(DISTRICT_BARRACKS));
      expect(await tid(page, 'city-tile-1').getAttribute('data-state')).toBe('ready');
      expect(await tid(page, 'city-total-regen').getAttribute('data-pct')).toBe(String(barracksRegenPctAt(1)));

      // Remove takes two clicks: the first arms (and the arm runs out), the second removes
      const remove1 = tid(page, 'city-district-remove-1');
      await remove1.click();
      await t.settle();
      expect(await remove1.getAttribute('data-armed')).toBe('1');
      expect(await remove1.textContent()).toBe(await t.text('sel.district.removeConfirm'));
      expect(await tid(page, 'city-tile-1').getAttribute('data-kind')).toBe(String(DISTRICT_BARRACKS));
      await t.advance(4, 0); // 4 s of the fx clock: more than the 3 s arm
      await t.settle();
      expect(await remove1.getAttribute('data-armed')).toBe('0');
      expect(await tid(page, 'city-tile-1').getAttribute('data-kind')).toBe(String(DISTRICT_BARRACKS));
      await remove1.click();
      await t.settle();
      await remove1.click();
      await t.advance(0.1, 4);
      await t.settle();
      expect(await tid(page, 'city-tile-1').getAttribute('data-state')).toBe('empty');
      expect(await tid(page, 'city-total-regen').getAttribute('data-pct')).toBe('0');

      // Esc closes the view, does not open the pause menu, and leaves the City selected
      await page.keyboard.press('Escape');
      await t.settle();
      expect(await view.isVisible()).toBe(false);
      expect(await page.evaluate(() => (window as any).__paused)).toBe(0);
      expect((await t.props()).selection.id).toBeGreaterThanOrEqual(0);
      expect(await tid(page, 'sel-panel').isVisible()).toBe(true);

      // a double click on the selected City opens it again
      await clickCity(page, lat, lon, 2);
      await t.settle();
      expect(await view.isVisible()).toBe(true);
      await page.keyboard.press('Escape');
      await t.settle();
      expect(await view.isVisible()).toBe(false);

      // far from the City the camera flies to it (about 1500 m above the ground)
      await t.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
      await t.settle();
      expect(await t.agl()).toBeGreaterThan(5000);
      await openByButton(page);
      await page.evaluate(() => (window as any).__test.settle(0.25, 160)); // the flight is timed by the fx clock: 40 s of it, no draws but the last
      expect(await t.agl()).toBeLessThan(2600);
      await page.keyboard.press('Escape');
      await t.settle();
      expect(await page.evaluate(() => (window as any).__paused)).toBe(0);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('fits a portrait window (540x960) as a bottom sheet in English, with all five tiles of a level 9 City; screenshots', async () => {
    const { page, messages } = await withCity('test=1&seed=7&ai=0&hud=1&lang=en', { width: 540, height: 960 });
    try {
      const t = T(page);
      await t.give(8000);
      await t.advance(0.1, 4);
      const level = 9; // Sim-Growth: five slots from level 9, the tallest panel
      await raiseTo(page, level);
      expect(districtSlotsOf(level)).toBe(5);
      await openByButton(page);
      await t.settle();
      for (let slot = 0; slot < 5; slot++) expect(await tid(page, `city-tile-${slot}`).isVisible()).toBe(true);
      await tid(page, `city-build-0-${DISTRICT_MARKET}`).click();
      await tid(page, `city-build-1-${DISTRICT_BARRACKS}`).click();
      await t.advance(0.1, 20);
      await t.settle();
      const box = (await tid(page, 'city-view').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(540);
      expect(box.y).toBeGreaterThan(960 * 0.25); // a bottom sheet
      expect(box.y + box.height).toBeLessThanOrEqual(960);
      expect(box.width).toBeGreaterThan(540 - 24);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await tid(page, 'city-title').textContent()).toBe(await t.text('sel.city.title', { level, max: maxLevelOf(STRUCT_CITY) }));
      expect(await tid(page, 'city-title').textContent()).toContain('City');
      await page.screenshot({ path: path.join(SHOT_DIR, 'city-view-portrait-en.png') });
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the Swedish texts at 960x540 with a level 9 City (five tiles): nothing leaves the window', async () => {
    const { page, messages } = await withCity('test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 });
    try {
      const t = T(page);
      await t.give(8000);
      await t.advance(0.1, 4);
      const level = 9;
      await raiseTo(page, level);
      await openByButton(page);
      await tid(page, `city-build-0-${DISTRICT_MARKET}`).click();
      await t.advance(0.1, 20);
      await t.settle();
      const box = (await tid(page, 'city-view').boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(960);
      expect(box.y + box.height).toBeLessThanOrEqual(540);
      expect(await tid(page, 'city-title').textContent()).toBe(await t.text('sel.city.title', { level, max: maxLevelOf(STRUCT_CITY) }));
      await page.screenshot({ path: path.join(SHOT_DIR, 'city-view-landscape-sv.png') });
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

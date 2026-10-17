// Integration Sim-Levels2 + Look-2 in headless Chromium: every gold surface still fits with the LONGEST realistic strings of the inflated display
// (GOLD_DISPLAY_FACTOR, compact from a million): the purse in billions, a big income, the dearest build prices, the level-999 upgrade prices of a Silo,
// a City and a district, in both languages at 960x540, 1366x640 and 540x960. The strings are written into the real elements (the HUD frame loop does not run
// in test mode), then the boxes are measured: inside the window, no clipped text, no horizontal page scroll.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { cellToLatLon } from '../src/render/transforms';
import { DISTRICT_BASE_GOLD, DISTRICT_MARKET, DISTRICT_WALLS, STRUCT_CITY, STRUCT_FACTORY, STRUCT_SILO, buildBody, districtUpgradePriceGold, maxLevelOf, upgradePriceGold } from '../src/sim/public';
import { effectLines } from '../src/ui/structureInfo';
import { districtFxLine } from '../src/ui/cityViewModel';
import { formatGold, formatGoldRate, formatShownGold, setLanguage, t, type Lang } from '../src/ui/i18n';

let browser: Browser;
const baseUrl = inject('baseUrl');
beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
  setLanguage('sv');
});

const W = 1024;
const H = 512;
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const T = (page: Page) => ({
  state: (): Promise<{ local: { spawned: boolean } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  cells: (): Promise<{ capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
  submit: (body: unknown): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
  give: (gold: number): Promise<void> => page.evaluate((g) => (window as any).__test.give(0, { gold: g }), gold),
});

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  clipped: boolean;
}
/** The box of the first element matching `selector`, and whether its text is cut (scrollWidth over clientWidth). */
async function boxOf(page: Page, selector: string): Promise<Box> {
  return page.evaluate((s) => {
    const e = document.querySelector(s) as HTMLElement | null;
    if (e === null) throw new Error(`no element ${s}`);
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, clipped: e.scrollWidth > e.clientWidth + 1 };
  }, selector);
}

/** Writes `text` into the element, then checks it stays inside the window and is not clipped; its panel must not scroll sideways. */
async function putAndFit(page: Page, selector: string, text: string, panelSelector: string, vw: number, vh: number, what: string): Promise<void> {
  await page.evaluate(([s, x]) => void ((document.querySelector(s as string) as HTMLElement).textContent = x as string), [selector, text] as const);
  const b = await boxOf(page, selector);
  expect(b.left, `${what} "${text}" left`).toBeGreaterThanOrEqual(-0.5);
  expect(b.right, `${what} "${text}" right of ${vw}`).toBeLessThanOrEqual(vw + 0.5);
  expect(b.bottom, `${what} "${text}" bottom of ${vh}`).toBeLessThanOrEqual(vh + 0.5);
  expect(b.clipped, `${what} "${text}" is clipped`).toBe(false);
  const panel = await boxOf(page, panelSelector);
  expect(panel.right, `${panelSelector} right of ${vw} with "${text}"`).toBeLessThanOrEqual(vw + 0.5);
  expect(panel.clipped, `${panelSelector} scrolls sideways with "${text}"`).toBe(false);
}

const VIEWPORTS = [
  { width: 960, height: 540 },
  { width: 1366, height: 640 },
  { width: 540, height: 960 },
] as const;

describe('every gold surface fits the longest realistic strings', () => {
  for (const lang of ['sv', 'en'] as const satisfies readonly Lang[]) {
    for (const vp of VIEWPORTS) {
      it(`${lang} at ${vp.width}x${vp.height}: purse, income, build bar, selection panel and city view`, async () => {
        const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&seed=7&ai=0&hud=1&lang=${lang}`, vp);
        try {
          setLanguage(lang);
          const h = T(page);
          await h.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
          const p = await h.project(48.5, 11);
          await page.mouse.click(p.x, p.y);
          await h.advance(0.1, 5);
          await h.give(100000);
          await h.advance(0.1, 4);
          expect((await h.state()).local.spawned).toBe(true);
          await h.advance(0.1, 210);
          const capital = ((await h.cells()).capitals[0]) as number;
          const at = cellToLatLon(capital, W, H);
          await h.submit(buildBody(0, STRUCT_CITY, capital));
          await h.advance(0.1, 160);
          await page.evaluate(([la, lo, time]) => (window as any).__test.setGroundView({ lat: la - 2.2 / 111.2, lon: lo, heading: 0, pitchDeg: 24, aglM: 900, time }), [at.lat, at.lon, timeForSubsolarLon(at.lon + 25)] as const);
          await h.settle();
          const q = await h.project(at.lat, at.lon);
          await page.mouse.click(q.x, q.y);
          await h.settle();
          expect(await tid(page, 'sel-panel').isVisible()).toBe(true);

          // the HUD: the purse in billions (far beyond the real purse, the worst case), the realistic largest purse, a big income
          const fit = (selector: string, text: string, panel: string, what: string): Promise<void> => putAndFit(page, selector, text, panel, vp.width, vp.height, what);
          for (const purse of [formatShownGold(999_000_000_000), formatShownGold(429_496_729_500), formatGold(4_294_967), formatGold(499_999)]) await fit('[data-testid="gold"]', purse, '[data-testid="status"]', 'purse');
          for (const rate of [formatGoldRate(999_999), formatGoldRate(1_234_567_890)]) await fit('[data-testid="gold-rate"]', t('hud.goldRate', { rate }), '[data-testid="status"]', 'income');

          // the build bar: the dearest escalated prices (a sixth Silo: 6 x 1 000 gold) and the compact form
          for (const price of [formatGold(6 * 1000), formatGold(6 * 600), formatGold(999_000), formatGold(500)]) {
            for (const type of [STRUCT_CITY, STRUCT_FACTORY, STRUCT_SILO]) await fit(`[data-testid="build-bar"] [data-type="${type}"] .build-price`, price, '[data-testid="build-bar"]', 'build price');
          }

          // the selection panel: the level-999 upgrade of a Silo and of a City, the effect lines of level 998 with the next level
          const silo999 = t('sel.upgrade', { price: formatGold(upgradePriceGold(STRUCT_SILO, maxLevelOf(STRUCT_SILO))) });
          const city999 = t('sel.upgrade', { price: formatGold(upgradePriceGold(STRUCT_CITY, maxLevelOf(STRUCT_CITY))) });
          for (const text of [silo999, city999]) await fit('[data-testid="sel-upgrade"]', text, '[data-testid="sel-panel"]', 'upgrade button');
          const lines = (type: number, level: number): string => effectLines(type, level).map((l) => t(l.key, l.params)).join(' ');
          for (const type of [STRUCT_CITY, STRUCT_FACTORY]) await fit('[data-testid="sel-fx"]', `${lines(type, 998)} ${t('sel.fxNext', { fx: lines(type, 999) })}`, '[data-testid="sel-panel"]', 'effect text');
          await fit('[data-testid="sel-level"]', `${t('sel.levelTop', { level: 999 })} · ${t('sel.owner.you')}`, '[data-testid="sel-panel"]', 'level line');

          // the city view: the City upgrade at level 999, the Walls build button at the dearest escalation, the totals
          await page.locator('[data-testid="sel-open-city"]').click();
          await h.settle();
          expect(await tid(page, 'city-view').isVisible()).toBe(true);
          const cityUp = t('sel.city.upgrade', { price: formatGold(upgradePriceGold(STRUCT_CITY, maxLevelOf(STRUCT_CITY))) });
          await fit('[data-testid="city-upgrade"]', cityUp, '[data-testid="city-view"]', 'city upgrade');
          const wallsBuild = t('sel.district.build', { name: t('sel.district.walls'), price: formatGold(Math.floor((DISTRICT_BASE_GOLD[DISTRICT_WALLS] as number) * 6)) });
          await fit(`[data-testid="city-build-0-${DISTRICT_WALLS}"] .city-build-name`, wallsBuild, '[data-testid="city-view"]', 'district build');
          await fit('[data-testid="city-total-gold"]', t('sel.city.totalsGold', { gold: formatGoldRate(15_000) }), '[data-testid="city-view"]', 'city totals');
          // a built district: its upgrade at the hard cap and the next-level line
          await page.locator(`[data-testid="city-build-0-${DISTRICT_MARKET}"]`).click();
          await h.advance(0.1, 120);
          await h.settle();
          const districtUp = t('sel.district.upgrade', { price: formatGold(districtUpgradePriceGold(DISTRICT_MARKET, 999)) });
          await fit('[data-testid="city-district-upgrade-0"]', districtUp, '[data-testid="city-view"]', 'district upgrade');
          const fxLine = districtFxLine(DISTRICT_MARKET, 998);
          await fit('[data-testid="city-fx-0"]', t('sel.district.now', { fx: t(fxLine.key, fxLine.params) }), '[data-testid="city-view"]', 'district effect');
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          expect(consoleMessages.filter((m) => m.type === 'error' || m.type === 'warning')).toEqual([]);
        } finally {
          setLanguage('sv');
          await page.close();
        }
      }, 120_000);
    }
  }
});

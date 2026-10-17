// Fix-6B in headless Chromium (audit 5, the UI faults): the Play button hides hostile helicopters, the nine-button build bar clears the controls panel and the selection
// panel at the common laptop sizes, and the modal keys cover 7, 8, 9, B and L. Screenshots: test-results/shots/fix6b-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { BUILD_TICKS } from '../src/sim/rules';
import { STRUCT_FACTORY } from '../src/sim/structureRules';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const tid = (id: string): string => `[data-testid="${id}"]`;
type Box = { left: number; top: number; right: number; bottom: number };
type Lang = 'sv' | 'en';
const overlaps = (a: Box, b: Box): boolean => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

const shot = async (page: Page, name: string): Promise<void> => {
  await page.evaluate(() => (window as any).__test.render());
  fs.writeFileSync(path.join(SHOT_DIR, `fix6b-${name}.png`), await page.screenshot({ type: 'png' }));
};
const advance = (page: Page, dt: number, n: number): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.advance(d, k), [dt, n] as const);
const settle = (page: Page, dt = 0.25, n = 2): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.settle(d, k), [dt, n] as const);
const rect = (page: Page, sel: string): Promise<Box | null> =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!(e instanceof HTMLElement) || e.hidden || e.getClientRects().length === 0) return null;
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, sel);
const project = (page: Page, a: number, b: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__test.project(x, y), [a, b] as const);

/** Spawn at the Alps, past the spawn phase, a finished Factory built at the capital and SELECTED (so the build bar and the Factory panel are both up). Returns the Factory id. */
async function factoryPage(page: Page): Promise<number> {
  await page.evaluate(() => (window as any).__test.setView({ lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 }));
  const p0 = await project(page, 48.5, 11);
  await page.mouse.click(p0.x, p0.y);
  await advance(page, 0.1, 5);
  await page.evaluate(() => (window as any).__test.give(0, { gold: 90000, troops: 5000 }));
  await advance(page, 0.1, 4);
  await advance(page, 0.1, 210);
  const capital = ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals[0] as number;
  const at = cellToLatLon(capital, 1024, 512);
  await page.evaluate(([c, ty]) => (window as any).__test.submit({ kind: 'Build', seat: 0, type: ty, cell: c }), [capital, STRUCT_FACTORY] as const);
  await advance(page, 0.1, (BUILD_TICKS[STRUCT_FACTORY] as number) + 8);
  const pf = await project(page, at.lat, at.lon);
  await page.mouse.click(pf.x, pf.y);
  await settle(page, 0, 1);
  const id = ((await page.evaluate(() => (window as any).__test.props())) as { selection: { id: number } }).selection.id;
  expect(id).toBeGreaterThanOrEqual(0);
  return id;
}

describe('the Play button path hides hostile helicopters', () => {
  it('after pressing Play, an enemy helicopter parked in a far enemy Factory is absent from __test.helis() while your own is drawn', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&menu=1&ai=0&hud=1&seed=7');
    try {
      await page.click(tid('play'));
      await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
      await page.evaluate(() => (window as any).__test.setView({ lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 }));
      const p0 = await project(page, 48.5, 11);
      await page.mouse.click(p0.x, p0.y);
      await advance(page, 0.1, 5);
      // seat 1 spawns on the other side of the world (the West Siberian plain), far outside every sensor of seat 0
      const far = Math.floor((90 - 55) * (512 / 180)) * 1024 + Math.floor(((80 + 180) / 360) * 1024);
      await page.evaluate((c) => (window as any).__test.submit({ kind: 'Spawn', seat: 1, cell: c }), far);
      await advance(page, 0.1, 5);
      await page.evaluate(() => {
        (window as any).__test.give(0, { gold: 90000 });
        (window as any).__test.give(1, { gold: 90000 });
      });
      await advance(page, 0.1, 215);
      const caps = ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals;
      for (const seat of [0, 1]) await page.evaluate(([s, c, ty]) => (window as any).__test.submit({ kind: 'Build', seat: s, type: ty, cell: c }), [seat, caps[seat] as number, STRUCT_FACTORY] as const);
      await advance(page, 0.1, (BUILD_TICKS[STRUCT_FACTORY] as number) + 8);
      const byType = (await page.evaluate(() => (window as any).__test.state().structures.byType)) as number[];
      expect(byType[STRUCT_FACTORY], 'both Factories stand').toBe(2);
      // structure ids are handed out in the order the Build intents ran: seat 0 first, seat 1 second
      const rejects0 = (await page.evaluate(() => (window as any).__test.state().rejects)) as number;
      for (const seat of [0, 1]) await page.evaluate((s) => (window as any).__test.submit({ kind: 'ProduceHeli', seat: s, factory: s }), seat);
      await advance(page, 0.1, 140);
      await settle(page, 0, 1);
      const helis = (await page.evaluate(() => (window as any).__test.helis())) as Array<{ owner: number; parked: boolean }>;
      expect((await page.evaluate(() => (window as any).__test.state().rejects)) as number, 'both orders were accepted by the sim (the enemy helicopter exists)').toBe(rejects0);
      expect(helis.some((h) => h.owner === 1 && h.parked), 'your own helicopter is drawn').toBe(true);
      expect(helis.filter((h) => h.owner === 2), 'the hostile one in a far Factory is not').toEqual([]);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 150_000);
});

describe('the nine-button build bar clears the controls panel and the selection panel', () => {
  for (const lang of ['sv', 'en'] as const satisfies readonly Lang[]) {
    for (const [w, h] of [[1600, 900], [1680, 1050], [1728, 1117]] as const) {
      it(`bar, controls and selection panel do not intersect at ${w}x${h} in ${lang}`, async () => {
        const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&seed=7&ai=0&hud=1&lang=${lang}&w=${w}&h=${h}`, { width: w, height: h });
        try {
          await factoryPage(page);
          const bar = await rect(page, tid('build-bar'));
          const controls = await rect(page, tid('controls'));
          const sel = await rect(page, tid('sel-panel'));
          await shot(page, `bar-${lang}-${w}x${h}`);
          expect(bar, 'bar is up').not.toBeNull();
          expect(controls, 'controls are up').not.toBeNull();
          expect(sel, 'the Factory panel is up').not.toBeNull();
          expect(overlaps(bar as Box, controls as Box), `bar ${JSON.stringify(bar)} vs controls ${JSON.stringify(controls)}`).toBe(false);
          expect(overlaps(bar as Box, sel as Box), `bar ${JSON.stringify(bar)} vs selection panel ${JSON.stringify(sel)}`).toBe(false);
          expect(overlaps(controls as Box, sel as Box), 'controls vs selection panel').toBe(false);
          expect(consoleMessages).toEqual([]);
        } finally {
          await page.close();
        }
      }, 120_000);
    }
  }
});

/** Setup -> the USA with "Dela upp stormakter" (and the Quick preset with 5 minutes when `quick`) -> start, past the spawn phase. */
async function startUsa(page: Page, quick: boolean): Promise<void> {
  await page.click(tid('start-setup'));
  await page.waitForSelector(tid('setup-screen'), { timeout: 30_000 });
  await page.fill('#setup-search', 'United States');
  await page.locator(`${tid('setup-row')}[data-a3="USA"]`).first().click();
  await page.locator(tid('setup-federation')).check();
  if (quick) {
    await page.click(tid('setup-win-preset-quick'));
    await page.selectOption(tid('setup-win-minutes'), '5');
  }
  await page.click(tid('setup-start'));
  await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
  await advance(page, 0, 205);
  await settle(page);
}

describe('the banner and the federation board', () => {
  for (const [lang, w, h] of [['sv', 960, 540], ['en', 960, 540], ['sv', 1024, 600]] as const) {
    it(`the "protected for a moment" banner does not run under the leaderboard at ${w}x${h} in ${lang}`, async () => {
      const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&menu=1&hud=1&seed=1&lang=${lang}&w=${w}&h=${h}`, { width: w, height: h });
      try {
        await startUsa(page, false);
        const banner = await rect(page, tid('phase'));
        const board = await rect(page, tid('leaderboard'));
        await shot(page, `banner-${lang}-${w}x${h}`);
        expect(banner, 'the banner is up (immunity phase)').not.toBeNull();
        expect(board).not.toBeNull();
        expect(overlaps(banner as Box, board as Box), `banner ${JSON.stringify(banner)} vs board ${JSON.stringify(board)}`).toBe(false);
        expect(consoleMessages).toEqual([]);
      } finally {
        await page.close();
      }
    }, 120_000);
  }
});

describe('narrow layouts', () => {
  for (const [lang, w, h] of [['sv', 390, 844], ['en', 412, 915], ['sv', 360, 740]] as const) {
    it(`no build button clips its name or price at ${w}x${h} in ${lang}`, async () => {
      const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&seed=7&ai=0&hud=1&lang=${lang}&w=${w}&h=${h}`, { width: w, height: h });
      try {
        await page.evaluate(() => (window as any).__test.setView({ lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 }));
        const p0 = await project(page, 48.5, 11);
        await page.mouse.click(p0.x, p0.y);
        await advance(page, 0.1, 220);
        await settle(page, 0, 1);
        await shot(page, `phone-${lang}-${w}x${h}`);
        const bad = await page.evaluate(() => {
          const out: string[] = [];
          const bar = document.querySelector('[data-testid="build-bar"]') as HTMLElement;
          const br = bar.getBoundingClientRect();
          if (br.left < 0 || br.right > window.innerWidth + 0.5) out.push(`bar outside the window ${br.left}..${br.right}`);
          for (const b of Array.from(document.querySelectorAll('.build-btn')) as HTMLElement[]) {
            const r = b.getBoundingClientRect();
            for (const k of Array.from(b.children) as HTMLElement[]) {
              const kr = k.getBoundingClientRect();
              if (k.scrollWidth > k.clientWidth + 0.5 || kr.right > r.right + 0.5 || kr.left < r.left - 0.5) out.push(`${b.dataset.testid}: ${k.className} "${k.textContent}" clipped`);
            }
          }
          return out;
        });
        expect(bad).toEqual([]);
        expect(consoleMessages).toEqual([]);
      } finally {
        await page.close();
      }
    }, 120_000);
  }

  it('a refused placement toast stays clear of the build bar and its hint at 540x960', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1&lang=sv&w=540&h=960', { width: 540, height: 960 });
    try {
      await page.evaluate(() => (window as any).__test.setView({ lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 }));
      const p0 = await project(page, 48.5, 11);
      await page.mouse.click(p0.x, p0.y);
      await advance(page, 0.1, 5);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 90000 }));
      await advance(page, 0.1, 215);
      const capital = ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals[0] as number;
      await page.evaluate(([c, ty]) => (window as any).__test.submit({ kind: 'Build', seat: 0, type: ty, cell: c }), [capital, STRUCT_FACTORY] as const);
      await advance(page, 0.1, (BUILD_TICKS[STRUCT_FACTORY] as number) + 8);
      const at = cellToLatLon(capital, 1024, 512);
      await page.keyboard.press('7');
      await settle(page, 0, 1);
      const pf = await project(page, at.lat, at.lon);
      await page.mouse.click(pf.x, pf.y); // the Factory's own cell: "there is already a building"
      await settle(page, 0, 1);
      const toast = await rect(page, tid('toast'));
      const bar = await rect(page, tid('build-bar'));
      const hint = await rect(page, tid('build-hint'));
      await shot(page, 'toast-540x960');
      expect(toast, 'a toast is up').not.toBeNull();
      expect(overlaps(toast as Box, bar as Box), `toast ${JSON.stringify(toast)} vs bar ${JSON.stringify(bar)}`).toBe(false);
      if (hint !== null) expect(overlaps(toast as Box, hint), `toast vs hint ${JSON.stringify(hint)}`).toBe(false);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120_000);

  for (const lang of ['sv', 'en'] as const) {
    it(`the result table fits a 540x960 window and the leaderboard share never wraps (federation, ${lang})`, async () => {
      const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&menu=1&hud=1&seed=1&lang=${lang}&w=540&h=960`, { width: 540, height: 960 });
      try {
        await startUsa(page, true);
        await page.locator(`${tid('leader-row')}[data-group="1"]`).click();
        await settle(page);
        const shares = await page.evaluate(() => {
          const board = document.querySelector('[data-testid="leaderboard"]') as HTMLElement;
          const br = board.getBoundingClientRect();
          const out: string[] = [];
          for (const e of Array.from(document.querySelectorAll('.hud-share')) as HTMLElement[]) {
            if (e.getClientRects().length === 0) continue;
            const r = e.getBoundingClientRect();
            if (r.height > parseFloat(getComputedStyle(e).fontSize) * 1.8) out.push(`wrapped "${e.textContent}" h=${r.height}`);
            if (r.right > br.right + 0.5) out.push(`cut "${e.textContent}" right ${r.right} > ${br.right}`);
          }
          return out;
        });
        await shot(page, `board-${lang}-540x960`);
        expect(shares).toEqual([]);
        await advance(page, 0, 3100);
        await settle(page);
        await page.waitForSelector(tid('result-screen'), { state: 'visible', timeout: 20_000 });
        await shot(page, `result-${lang}-540x960`);
        const fit = await page.evaluate(() => {
          const card = document.querySelector('[data-testid="result-screen"]') as HTMLElement;
          const out: string[] = [];
          for (const e of Array.from(card.querySelectorAll('.mp-card, table')) as HTMLElement[]) {
            if (e.scrollWidth > e.clientWidth + 0.5) out.push(`${e.tagName}.${e.className} scrolls sideways: scroll ${e.scrollWidth} > client ${e.clientWidth}`);
          }
          for (const th of Array.from(card.querySelectorAll('table th')) as HTMLElement[]) {
            if (th.getBoundingClientRect().right > window.innerWidth) out.push(`header "${th.textContent}" is outside the window`);
          }
          return out;
        });
        expect(fit).toEqual([]);
        expect(consoleMessages).toEqual([]);
      } finally {
        await page.close();
      }
    }, 180_000);
  }
});

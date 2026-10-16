// M18d-2 in headless Chromium: the research panel (key T, the top-bar button "Teknik", Escape), research from start to finish (status, running line, toast, next step),
// cancel with confirmation and no refund, the discounted upgrade price shown == taken, three window sizes in both languages without overlap, no DOM writes at rest.
// Screenshots go to test-results/shots/research-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { timeForSubsolarLon } from '../src/render/geo';
import { MILLI_GOLD_PER_GOLD, TECH_PRICE_GOLD, TECH_TICKS, TICK_HZ } from '../src/sim/public';
import { STRUCT_CITY, upgradePriceGold } from '../src/sim/structureRules';
import { setLanguage, type Lang } from '../src/ui/i18n';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = process.env.RESEARCH_SHOTS ?? path.join(OUT_DIR, 'shots');
beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  setLanguage('sv');
});

type Msg = Array<{ type: string; text: string }>;
const T = (page: Page) => ({
  state: (): Promise<any> => page.evaluate(() => (window as any).__test.state()),
  props: (): Promise<any> => page.evaluate(() => (window as any).__test.props()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (dt = 0, n = 1): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.settle(d, k), [dt, n] as const),
  render: (): Promise<void> => page.evaluate(() => (window as any).__test.render()),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  give: (gold: number): Promise<void> => page.evaluate((g) => (window as any).__test.give(0, { gold: g }), gold),
  submit: (b: unknown): Promise<void> => page.evaluate((x) => (window as any).__test.submit(x), b),
  cells: (): Promise<{ capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
});

const START = { lat: 48.5, lon: 11 };
const VIEW = { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 };
const tid = (id: string): string => `[data-testid="${id}"]`;
const cellSel = (tech: number, id: string): string => `${tid('tech-cell')}[data-tech="${tech}"] ${tid(id)}`;
type Box = { left: number; top: number; right: number; bottom: number };
const overlaps = (a: Box, b: Box): boolean => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

async function playing(query: string, viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Msg }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  const tt = T(page);
  await tt.view(VIEW);
  const p = await tt.project(START.lat, START.lon);
  await page.mouse.click(p.x, p.y);
  await tt.advance(0.1, 5);
  expect((await tt.state()).local.spawned).toBe(true);
  const s = await tt.state();
  await tt.advance(0.1, 260 - s.tick);
  expect((await tt.state()).phase).toBe('play');
  return { page, messages: consoleMessages };
}

const shot = async (page: Page, name: string): Promise<void> => {
  await T(page).render();
  fs.writeFileSync(path.join(SHOT_DIR, `research-${name}.png`), await page.screenshot({ type: 'png' }));
};
const rect = (page: Page, sel: string): Promise<(Box & { w: number; h: number }) | null> =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!(e instanceof HTMLElement) || e.hidden || e.getClientRects().length === 0) return null;
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
  }, sel);
const statusOf = (page: Page, tech: number): Promise<string | undefined> => page.evaluate((n) => (document.querySelector(`[data-testid="tech-cell"][data-tech="${n}"]`) as HTMLElement | null)?.dataset.status, tech);
const toastKeys = (page: Page): Promise<string[]> => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="toast"][data-key]')).map((e) => (e as HTMLElement).dataset.key as string));
async function advanceCollecting(page: Page, slices: number, ticksPerSlice: number): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < slices; i++) {
    await T(page).advance(0.1, ticksPerSlice);
    for (const k of await toastKeys(page)) seen.add(k);
  }
  return seen;
}
const click = async (page: Page, sel: string): Promise<void> => {
  await page.locator(sel).dispatchEvent('click');
  await T(page).advance(0.05, 0);
};
const key = async (page: Page, k: string): Promise<void> => {
  await page.keyboard.press(k);
  await T(page).advance(0.05, 0);
};

describe('the research flow', () => {
  it('T opens the panel with 16 cells, a research runs (status, top-bar line, bar), finishes with a toast and unlocks the next step, a cancel needs two clicks and gives no gold back, Esc and T close, nothing is written at rest', async () => {
    const { page, messages } = await playing('test=1&seed=7&hud=1&ai=0');
    try {
      const tt = T(page);
      expect(await rect(page, tid('tech-panel'))).toBeNull();
      await key(page, 't');
      expect(await rect(page, tid('tech-panel'))).not.toBeNull();
      expect(await page.locator(tid('tech-cell')).count()).toBe(16);
      await tt.give(100000);
      await tt.advance(0.1, 3);
      expect(await statusOf(page, 0)).toBe('available');
      expect(await statusOf(page, 1)).toBe('locked');
      expect(await page.locator(cellSel(0, 'tech-research')).getAttribute('data-enabled')).toBe('1');
      expect(await page.locator(cellSel(1, 'tech-research')).isVisible(), 'a locked cell has no research button').toBe(false);
      await shot(page, 'open-960x540-sv');

      // start the first tech: the price leaves the purse, the cell turns active, the top bar names it
      const g0 = (await tt.state()).local.goldMilli as number;
      await click(page, cellSel(0, 'tech-research'));
      await tt.advance(0.1, 4);
      expect(await statusOf(page, 0)).toBe('active');
      expect(g0 - (await tt.state()).local.goldMilli, 'the price was taken').toBeGreaterThan((TECH_PRICE_GOLD[0] as number) * MILLI_GOLD_PER_GOLD * 0.9);
      expect(await page.locator(cellSel(0, 'tech-cancel')).isVisible()).toBe(true);
      expect(await page.locator(cellSel(0, 'tech-research')).isVisible()).toBe(false);
      expect(await statusOf(page, 4), 'another first step cannot start while one runs').toBe('blocked');
      expect(await page.locator(cellSel(4, 'tech-research')).getAttribute('data-enabled')).toBe('0');
      const running = await page.locator(tid('tech-running')).textContent();
      expect(await rect(page, tid('tech-running'))).not.toBeNull();
      expect(running).toMatch(/\d:\d\d/);

      // no DOM writes at rest with the panel open and a research running, the clock stopped
      await tt.settle(0.1, 1);
      const writes = await page.evaluate(async () => {
        let n = 0;
        const mo = new MutationObserver((rs) => (n += rs.length));
        for (const sel of ['[data-testid="match-hud"]', '[data-testid="tech-panel"]']) mo.observe(document.querySelector(sel) as Element, { subtree: true, childList: true, attributes: true, characterData: true });
        for (let i = 0; i < 10; i++) (window as any).__test.settle(0.1, 1);
        await new Promise((r) => setTimeout(r, 50));
        mo.disconnect();
        return n;
      });
      expect(writes, 'mutations of the HUD and the open panel during 1 s without ticks').toBe(0);

      // let it finish: Done, the toast, the next step available, the top-bar line gone
      const seen = await advanceCollecting(page, 7, Math.ceil((TECH_TICKS[0] as number) / 6));
      expect(await statusOf(page, 0)).toBe('done');
      expect(seen.has('toast.tech.done'), 'the toast when a research is complete').toBe(true);
      expect(await statusOf(page, 1)).toBe('available');
      expect(await rect(page, tid('tech-running'))).toBeNull();
      await shot(page, 'done-960x540-sv');

      // cancel: the first click only arms, the second one cancels, and the gold does not come back
      await click(page, cellSel(1, 'tech-research'));
      await tt.advance(0.1, 4);
      expect(await statusOf(page, 1)).toBe('active');
      const g1 = (await tt.state()).local.goldMilli as number;
      await click(page, cellSel(1, 'tech-cancel'));
      expect(await page.locator(cellSel(1, 'tech-cancel')).getAttribute('data-armed')).toBe('1');
      expect(await statusOf(page, 1), 'one click does not cancel').toBe('active');
      expect(await rect(page, tid('tech-note'))).not.toBeNull();
      await click(page, cellSel(1, 'tech-cancel'));
      await tt.advance(0.1, 4);
      expect(await statusOf(page, 1)).toBe('available');
      expect((await tt.state()).local.goldMilli - g1, 'no refund (income of a few ticks only)').toBeLessThan((TECH_PRICE_GOLD[1] as number) * MILLI_GOLD_PER_GOLD * 0.5);

      // Esc closes the panel and does not open the pause menu; T opens and closes; the button opens
      await key(page, 'Escape');
      expect(await rect(page, tid('tech-panel'))).toBeNull();
      expect(await page.locator(tid('pause-menu')).isVisible()).toBe(false);
      await key(page, 't');
      expect(await rect(page, tid('tech-panel'))).not.toBeNull();
      await key(page, 't');
      expect(await rect(page, tid('tech-panel'))).toBeNull();
      await click(page, tid('tech-button'));
      expect(await rect(page, tid('tech-panel'))).not.toBeNull();
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 180_000);
});

describe('the discounted upgrade price', () => {
  it('the City panel shows the base price before, the discounted one after Canal Works, and the Upgrade takes the shown price', async () => {
    const { page, messages } = await playing('test=1&seed=7&hud=1&ai=0');
    try {
      const tt = T(page);
      const capital = (await tt.cells()).capitals[0] as number;
      const at = cellToLatLon(capital, 1024, 512);
      await tt.give(500000);
      await tt.submit({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: capital });
      await tt.advance(0.1, 160);
      const select = async (): Promise<void> => {
        await page.evaluate(([la, lo, time]) => (window as any).__test.setGroundView({ lat: (la as number) - 2.2 / 111.2, lon: lo, heading: 0, pitchDeg: 24, aglM: 900, time }), [at.lat, at.lon, timeForSubsolarLon(at.lon + 25)] as const);
        await tt.settle();
        const p = await tt.project(at.lat, at.lon);
        await page.mouse.click(p.x, p.y);
        await tt.settle();
        expect((await tt.props()).selection.panelVisible).toBe(true);
      };
      await select();
      const base = upgradePriceGold(STRUCT_CITY, 2);
      expect(Number(await page.locator(tid('sel-upgrade')).getAttribute('data-price')), 'no research: the base price').toBe(base);
      // Trade Routes (600 ticks), then Canal Works (900 ticks, upgrade price -5 %)
      await tt.submit({ kind: 'Research', seat: 0, tech: 0 });
      await tt.advance(0.1, (TECH_TICKS[0] as number) + 5);
      await tt.submit({ kind: 'Research', seat: 0, tech: 1 });
      await tt.advance(0.1, (TECH_TICKS[1] as number) + 5);
      await tt.settle();
      const shown = Number(await page.locator(tid('sel-upgrade')).getAttribute('data-price'));
      expect(shown, 'five percent cheaper').toBeCloseTo(Math.floor((base * MILLI_GOLD_PER_GOLD * 95) / 100) / MILLI_GOLD_PER_GOLD, 6);
      expect(shown).toBeLessThan(base);
      const before = (await tt.state()).local;
      await page.locator(tid('sel-upgrade')).click();
      await tt.advance(0.1, 3);
      const after = (await tt.state()).local;
      const debit = before.goldMilli - after.goldMilli + (after.goldPerSecMilli * 3) / TICK_HZ; // the income of the three ticks put back
      expect(Math.abs(debit - shown * MILLI_GOLD_PER_GOLD), 'debited == shown').toBeLessThan(Math.abs(debit - base * MILLI_GOLD_PER_GOLD));
      expect(Math.abs(debit - shown * MILLI_GOLD_PER_GOLD)).toBeLessThan(base * MILLI_GOLD_PER_GOLD * 0.01);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 180_000);
});

describe('layout', () => {
  for (const lang of ['sv', 'en'] as const satisfies readonly Lang[]) {
    for (const vp of [
      { width: 960, height: 540 },
      { width: 1366, height: 640 },
      { width: 540, height: 960 },
    ] as const) {
      it(`the panel and the top bar do not overlap at ${vp.width}x${vp.height} in ${lang}`, async () => {
        const { page, messages } = await playing(`test=1&seed=7&hud=1&ai=0&win=1&devbtn=1&w=${vp.width}&h=${vp.height}&lang=${lang}`, vp);
        try {
          const tt = T(page);
          await tt.give(100000);
          await tt.submit({ kind: 'Research', seat: 0, tech: 0 });
          await tt.advance(0.1, 5);
          // the top bar: the research line, the Tech and the Diplomacy button sit inside the status panel and do not overlap each other
          const status = await rect(page, tid('status'));
          const run = await rect(page, tid('tech-running'));
          const tb = await rect(page, tid('tech-button'));
          const db = await rect(page, tid('diplo-button'));
          expect(run).not.toBeNull();
          expect(tb).not.toBeNull();
          expect(db).not.toBeNull();
          for (const b of [run!, tb!, db!]) {
            expect(b.right).toBeLessThanOrEqual(status!.right + 0.5);
            expect(b.bottom).toBeLessThanOrEqual(status!.bottom + 0.5);
          }
          expect(overlaps(run!, tb!), 'running line over the Tech button').toBe(false);
          expect(overlaps(tb!, db!), 'Tech button over Diplomacy').toBe(false);
          expect(tb!.h, 'the touch target keeps its height (the ::after box is not measured here, the visible row is the 1.4em one)').toBeGreaterThan(10);
          await key(page, 't');
          const card = await rect(page, '.tech-card');
          expect(card).not.toBeNull();
          expect(card!.left).toBeGreaterThanOrEqual(-0.5);
          expect(card!.right).toBeLessThanOrEqual(vp.width + 0.5);
          expect(card!.bottom).toBeLessThanOrEqual(vp.height + 0.5);
          // the 16 cells: none over another, each inside the card's width, no text wider than its cell
          const cells = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[data-testid="tech-cell"]')).map((e) => {
              const r = e.getBoundingClientRect();
              return { tech: Number((e as HTMLElement).dataset.tech), left: r.left, top: r.top, right: r.right, bottom: r.bottom, over: e.scrollWidth > e.clientWidth + 1 };
            }),
          );
          expect(cells.length).toBe(16);
          for (const c of cells) {
            expect(c.over, `cell ${c.tech} text overflows sideways`).toBe(false);
            expect(c.left).toBeGreaterThanOrEqual(card!.left - 0.5);
            expect(c.right).toBeLessThanOrEqual(card!.right + 0.5);
          }
          for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) expect(overlaps(cells[i]!, cells[j]!), `cells ${i} and ${j} overlap`).toBe(false);
          // the buttons of the cards are at least a finger tall on a touch/narrow window
          if (vp.width <= 600) {
            const bh = await rect(page, cellSel(0, 'tech-cancel'));
            expect(bh).not.toBeNull();
            expect(bh!.h).toBeGreaterThanOrEqual(43.5);
          }
          await shot(page, `${vp.width}x${vp.height}-${lang}`);
          expect(messages).toEqual([]);
        } finally {
          await page.close();
        }
      }, 150_000);
    }
  }
});

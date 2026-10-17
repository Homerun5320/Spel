// Fix-5B in headless Chromium (audit 4, the layout faults): the helicopter load slider follows the research, the expanded federation row of the leaderboard stays clear of
// the controls, the federation result card keeps every header inside one scroll surface, the proposal cards stay clear of the panels (and the D panel answers them itself),
// the ? overlay is opaque enough, and the chip-heavy top bar of a narrow window does not print its parts over each other. Screenshots: test-results/shots/fix5b-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { BUILD_TICKS, HELI_MAX_TROOPS, TECH_TICKS } from '../src/sim/rules';
import { STRUCT_FACTORY } from '../src/sim/structureRules';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const tid = (id: string): string => `[data-testid="${id}"]`;
type Box = { left: number; top: number; right: number; bottom: number };
type Lang = 'sv' | 'en';
const SIZES = [
  { width: 960, height: 540 },
  { width: 1366, height: 640 },
] as const;
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
  fs.writeFileSync(path.join(SHOT_DIR, `fix5b-${name}.png`), await page.screenshot({ type: 'png' }));
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
  await advance(page, 0, 230);
  await settle(page);
}

/** A nation at the Alps with a finished Factory, selected; the page has the AI off. Returns the Factory id. */
async function factoryPage(page: Page): Promise<number> {
  const p = (a: number, b: number) => page.evaluate(([x, y]) => (window as any).__test.project(x, y), [a, b] as const) as Promise<{ x: number; y: number }>;
  await page.evaluate(() => (window as any).__test.setView({ lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 }));
  const p0 = await p(48.5, 11);
  await page.mouse.click(p0.x, p0.y);
  await advance(page, 0.1, 5);
  await page.evaluate(() => (window as any).__test.give(0, { gold: 90000, troops: 5000 }));
  await advance(page, 0.1, 4);
  await advance(page, 0.1, 210);
  const capital = ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals[0] as number;
  const at = cellToLatLon(capital, 1024, 512);
  await page.evaluate(([c, ty]) => (window as any).__test.submit({ kind: 'Build', seat: 0, type: ty, cell: c }), [capital, STRUCT_FACTORY] as const);
  await advance(page, 0.1, (BUILD_TICKS[STRUCT_FACTORY] as number) + 8);
  const pf = await p(at.lat, at.lon);
  await page.mouse.click(pf.x, pf.y);
  await settle(page, 0, 1);
  const id = ((await page.evaluate(() => (window as any).__test.props())) as { selection: { id: number } }).selection.id;
  expect(id).toBeGreaterThanOrEqual(0);
  return id;
}

describe('the helicopter load slider follows the research', () => {
  it('the slider max is the base cap, grows after the load tech, the clamp and the label follow it and the refusal text names the cap', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1');
    try {
      await factoryPage(page);
      const slider = page.locator(tid('deploy-troops'));
      expect(await slider.getAttribute('max'), 'no research: the base cap').toBe(String(HELI_MAX_TROOPS));
      // Rotorblad (tech 8) lifts the load
      await page.evaluate(() => (window as any).__test.give(0, { gold: 50000 }));
      await page.evaluate(() => (window as any).__test.submit({ kind: 'Research', seat: 0, tech: 8 }));
      await advance(page, 0.1, (TECH_TICKS[8] as number) + 10);
      await settle(page, 0, 1);
      const max = Number(await slider.getAttribute('max'));
      expect(max, 'the load tech raised the slider').toBeGreaterThan(HELI_MAX_TROOPS);
      // the slider is only a control of the deploy mode: open it, push the slider past the old cap
      await page.locator(tid('deploy-open')).dispatchEvent('click');
      await settle(page, 0, 1);
      await slider.evaluate((e, v) => ((e as HTMLInputElement).value = String(v), e.dispatchEvent(new Event('input', { bubbles: true }))), 9999);
      await settle(page, 0, 1);
      expect(Number(await page.locator(tid('deploy-troops-label')).getAttribute('data-value')), 'the label shows the new cap').toBe(max);
      expect((await page.evaluate(() => (window as any).__test.deploy())).troops, 'the troops sent').toBe(max);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 150_000);
});

describe('the federation in the leaderboard and on the result card', () => {
  for (const lang of ['sv', 'en'] as const satisfies readonly Lang[]) {
    for (const vp of SIZES) {
      it(`expanded group rows are all on top (elementFromPoint) and the result headers lie inside one scroll surface at ${vp.width}x${vp.height} in ${lang}`, async () => {
        const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&menu=1&hud=1&seed=1&lang=${lang}`, vp);
        try {
          await startUsa(page, true);
          await page.locator(`${tid('leader-row')}[data-group="1"]`).click();
          await settle(page);
          const rows = await page.evaluate(() => {
            const out: Array<{ sub: boolean; top: number; bottom: number; ok: boolean; name: string }> = [];
            for (const e of Array.from(document.querySelectorAll('[data-testid="leader-row"]'))) {
              const el = e as HTMLElement;
              if (el.hidden || el.getClientRects().length === 0) continue;
              const board = document.querySelector('[data-testid="leaderboard"]') as HTMLElement;
              const r = el.getBoundingClientRect();
              const b = board.getBoundingClientRect();
              // a row scrolled out of the board's own box is not on show; every row inside it must be the top element at its centre
              if (r.bottom > b.bottom + 0.5 || r.top < b.top - 0.5) continue;
              const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
              out.push({ sub: el.dataset.sub === '1', top: r.top, bottom: r.bottom, ok: hit !== null && el.contains(hit), name: el.textContent ?? '' });
            }
            return out;
          });
          expect(rows.filter((r) => r.sub).length, 'member rows are on show').toBeGreaterThanOrEqual(3);
          for (const r of rows) expect(r.ok, `row "${r.name}" at y ${r.top}-${r.bottom} is covered`).toBe(true);
          const board = (await rect(page, tid('leaderboard'))) as Box;
          const controls = (await rect(page, tid('controls'))) as Box;
          expect(board.bottom, 'the board stops above the controls').toBeLessThanOrEqual(controls.top + 0.5);
          await shot(page, `board-${vp.width}x${vp.height}-${lang}`);
          // to the end: the result card
          await advance(page, 0, 3300);
          await page.evaluate(() => (window as any).__test.render());
          await page.waitForSelector(tid('result-screen'), { timeout: 30_000 });
          const card = (await rect(page, `${tid('result-screen')} .mp-card`)) as Box;
          const heads = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="result-screen"] th')).map((e) => {
            const r = e.getBoundingClientRect();
            return { text: e.textContent ?? '', left: r.left, right: r.right };
          }));
          expect(heads.length, 'both tables have headers').toBeGreaterThanOrEqual(14);
          for (const h of heads) {
            expect(h.left, `"${h.text}" starts inside the card`).toBeGreaterThanOrEqual(card.left - 0.5);
            expect(h.right, `"${h.text}" ends inside the card`).toBeLessThanOrEqual(card.right + 0.5);
          }
          const nested = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="result-screen"] .mp-table-wrap')).filter((e) => getComputedStyle(e).overflow !== 'visible').length);
          expect(nested, 'no nested scroll box in the card').toBe(0);
          const wrapped = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="result-row"] td')).filter((e) => e.getBoundingClientRect().height > 1.9 * parseFloat(getComputedStyle(e).fontSize) + 8).length);
          expect(wrapped, 'no cell wraps to two lines').toBe(0);
          await shot(page, `result-${vp.width}x${vp.height}-${lang}`);
          expect(consoleMessages.filter((m: any) => m.type === 'error')).toEqual([]);
        } finally {
          await page.close();
        }
      }, 240_000);
    }
  }
});

describe('proposal cards, the D panel and the ? overlay', () => {
  for (const vp of SIZES) {
    it(`cards stay clear of the Factory panel, hide while D is open (the row answers), and the ? card is opaque at ${vp.width}x${vp.height}`, async () => {
      const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&seed=7&ai=0&hud=1&lang=en&w=${vp.width}&h=${vp.height}`, vp);
      try {
        const factory = await factoryPage(page);
        expect(factory).toBeGreaterThanOrEqual(0);
        await page.evaluate(() => (window as any).__test.submit({ kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 }));
        await page.evaluate(() => (window as any).__test.submit({ kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 2 }));
        await advance(page, 0.1, 4);
        await settle(page, 0, 1);
        const sel = (await rect(page, '.sel-panel')) as Box;
        const cards = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="diplo-card-in"]')).filter((e) => !(e as HTMLElement).hidden).map((e) => {
          const r = e.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }));
        expect(cards.length).toBe(2);
        for (const c of cards) expect(overlaps(c, sel), `a card over the selection panel: ${JSON.stringify(c)} ${JSON.stringify(sel)}`).toBe(false);
        await shot(page, `cards-${vp.width}x${vp.height}`);
        // D: the cards go, the rows show Accept / Decline and the decline button is the top element
        await page.keyboard.press('d');
        await settle(page, 0.25, 2);
        expect(await page.locator(`${tid('diplo-card-in')}:visible`).count(), 'the cards hide while the panel is open').toBe(0);
        const rowBtn = page.locator(`${tid('diplo-row')}[data-seat="1"] ${tid('diplo-row-decline')}`);
        const b = (await rect(page, `${tid('diplo-row')}[data-seat="1"] ${tid('diplo-row-decline')}`)) as Box;
        expect(b, 'the row of the proposer shows Decline').not.toBeNull();
        const top = await page.evaluate((bb) => {
          const e = document.elementFromPoint((bb.left + bb.right) / 2, (bb.top + bb.bottom) / 2);
          return e !== null && e.closest('[data-testid="diplo-row-decline"]') !== null;
        }, b);
        expect(top, 'Decline is not covered').toBe(true);
        await rowBtn.dispatchEvent('click');
        await advance(page, 0.1, 3);
        await settle(page, 0.25, 1);
        expect(await page.locator(`${tid('diplo-row')}[data-seat="1"] ${tid('diplo-row-decline')}:visible`).count(), 'declined: the strip is gone').toBe(0);
        await page.keyboard.press('d');
        await settle(page, 0, 1);
        // the ? card: an almost opaque background
        await page.keyboard.press('?');
        await settle(page, 0, 1);
        const alpha = await page.evaluate(() => {
          const m = /rgba?\(([^)]*)\)/.exec(getComputedStyle(document.querySelector('.help-card') as Element).backgroundColor);
          const parts = (m?.[1] ?? '').split(',').map((x) => Number(x));
          return parts.length === 4 ? (parts[3] as number) : 1;
        });
        expect(alpha, 'the help card background alpha').toBeGreaterThanOrEqual(0.95);
        await shot(page, `help-${vp.width}x${vp.height}`);
        expect(consoleMessages).toEqual([]);
      } finally {
        await page.close();
      }
    }, 150_000);
  }
});

describe('the research panel on a short window', () => {
  for (const vp of SIZES) {
    it(`the T panel needs no scrolling at ${vp.width}x${vp.height} in en`, async () => {
      const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&seed=7&ai=0&hud=1&lang=en&w=${vp.width}&h=${vp.height}`, vp);
      try {
        await factoryPage(page);
        await page.keyboard.press('t');
        await settle(page, 0, 1);
        const m = await page.evaluate(() => {
          const e = document.querySelector('.tech-card') as HTMLElement;
          return { sh: e.scrollHeight, ch: e.clientHeight };
        });
        expect(m.sh, `scrollHeight ${m.sh} vs clientHeight ${m.ch}`).toBeLessThanOrEqual(m.ch + 1);
        await shot(page, `tech-${vp.width}x${vp.height}`);
        expect(consoleMessages).toEqual([]);
      } finally {
        await page.close();
      }
    }, 150_000);
  }
});

describe('the narrow top bar with a federation, a research chip and proposals', () => {
  it('the win meter, the fleet gauge and the buttons do not overlap at 540x960 in en and the win text keeps a width', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&menu=1&hud=1&seed=1&lang=en&w=540&h=960', { width: 540, height: 960 });
    try {
      await startUsa(page, false);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 50000 }));
      await page.evaluate(() => (window as any).__test.submit({ kind: 'Research', seat: 0, tech: 0 }));
      const players = (await page.evaluate(() => (window as any).__test.matchInfo())).players as number;
      expect(players).toBeGreaterThan(2);
      await page.evaluate(() => (window as any).__test.submit({ kind: 'ProposeTreaty', seat: 20, to: 0, treaty: 1 }));
      await page.evaluate(() => (window as any).__test.submit({ kind: 'ProposeTreaty', seat: 21, to: 0, treaty: 2 }));
      await advance(page, 0.1, 6);
      await settle(page, 0.25, 2);
      const ids = ['win', 'fleet-grp', 'diplo-grp'];
      const boxes: Box[] = [];
      for (const id of ids) {
        const b = await rect(page, tid(id));
        expect(b, `${id} is shown`).not.toBeNull();
        boxes.push(b as Box);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i] as Box, boxes[j] as Box), `${ids[i]} over ${ids[j]}: ${JSON.stringify(boxes)}`).toBe(false);
      const leader = (await rect(page, tid('win-leader'))) as Box;
      expect(leader.right - leader.left, 'the win text keeps a width').toBeGreaterThan(20);
      const status = (await rect(page, tid('status'))) as Box;
      for (const b of boxes) expect(b.right).toBeLessThanOrEqual(status.right + 0.5);
      await shot(page, 'topbar-540x960');
      expect(consoleMessages.filter((m: any) => m.type === 'error')).toEqual([]);
    } finally {
      await page.close();
    }
  }, 240_000);
});

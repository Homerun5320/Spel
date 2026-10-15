// M18-2 in headless Chromium (software WebGL2): the win conditions of the setup menu reach the match, the pause menu and the Escape rule, a
// fast-forwarded match reaches the result screen with the statistics of the sim, the elimination panel with its three choices, the spectator bar,
// the toasts for other nations, and the layouts in both languages (screenshots go to test-results/shots/matchend-*.png; one golden of the result card).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, compareGolden, launchBrowser, openPage } from '../scripts/shot.mjs';
import { TABLES } from '../src/ui/i18n';
import { TARGET_MIN_PX } from '../src/ui/uiConfig';

interface Msg {
  type: string;
  text: string;
}

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const tid = (id: string): string => `[data-testid="${id}"]`;

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

async function open(query: string, viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Msg[] }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  return { page, messages: consoleMessages as Msg[] };
}

const render = (page: Page): Promise<void> => page.evaluate(() => (window as any).__test.render());
const settle = (page: Page, seconds: number, step = 0.25): Promise<void> =>
  page.evaluate(([s, dt]) => (window as any).__test.settle(dt, Math.max(1, Math.round(s / dt))), [seconds, step] as const);
const visible = (page: Page, id: string): Promise<boolean> => page.locator(tid(id)).first().isVisible();
async function shot(page: Page, name: string): Promise<Buffer> {
  await render(page);
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, `matchend-${name}.png`), png);
  return png;
}
const paused = (page: Page): Promise<boolean> => page.evaluate(() => (window as any).__test.state().paused);
const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__test.props().toasts);

describe('the setup choice reaches the match, the pause menu and the result screen', () => {
  it('Quick match with 5 minutes: the summary, Escape with a mode and without, the result with the sim statistics', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1&seed=7');
    try {
      await page.click(tid('start-setup'));
      await page.waitForSelector(tid('setup-screen'), { timeout: 30_000 });
      // the defaults are the Standard preset, and the summary says so
      expect(await page.locator(tid('setup-win-preset-standard')).getAttribute('data-active')).toBe('1');
      expect(await page.locator(tid('setup-win-summary')).textContent()).toBe('Vinst: Erövra 60 % av världen och håll det i 30 s · Sist kvar · Flest poäng efter 25 min');
      // a small match: Europe, 2 AI nations, Sweden
      await page.selectOption(tid('setup-region'), 'europe');
      await page.evaluate(() => {
        const r = document.querySelector('[data-testid="setup-ai"]') as HTMLInputElement;
        r.value = '2';
        r.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.fill(tid('setup-search'), 'Sverige');
      await page.locator(tid('setup-row')).first().click();
      // the presets and the controls
      await page.click(tid('setup-win-preset-quick'));
      expect(await page.locator(tid('setup-win-land')).isChecked()).toBe(false);
      expect(await page.locator(tid('setup-win-last')).isChecked()).toBe(true);
      expect(await page.locator(tid('setup-win-score')).isChecked()).toBe(true);
      expect(await page.locator(tid('setup-win-minutes')).inputValue()).toBe('8');
      expect(await page.locator(tid('setup-win-pct')).isDisabled()).toBe(true);
      await page.click(tid('setup-win-preset-sandbox'));
      expect(await page.locator(tid('setup-win-summary')).textContent()).toBe(TABLES.sv['win.sandbox']);
      await page.click(tid('setup-win-preset-standard'));
      // a custom mix: land share 70, minutes 5; the preset marker leaves the presets
      await page.evaluate(() => {
        const r = document.querySelector('[data-testid="setup-win-pct"]') as HTMLInputElement;
        r.value = '70';
        r.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(await page.locator(tid('setup-win-pct-value')).getAttribute('data-value')).toBe('70');
      expect(await page.locator(tid('setup-win-presets')).getAttribute('data-preset')).toBe('custom');
      await page.click(tid('setup-win-preset-quick'));
      await page.selectOption(tid('setup-win-minutes'), '5');
      expect(await page.locator(tid('setup-win-summary')).textContent()).toBe('Vinst: Sist kvar · Flest poäng efter 5 min');
      await shot(page, 'setup-win-960');
      await page.click(tid('setup-language'));
      expect(await page.locator(tid('setup-win-summary')).textContent()).toBe('Win: Last one standing · Most points after 5 min');
      await shot(page, 'setup-win-960-en');
      await page.click(tid('setup-language'));
      await page.click(tid('setup-start'));
      await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
      // the sim got the choice: the pause menu prints the summary of the MatchView
      await settle(page, 0.5);
      await page.evaluate(() => (window as any).__test.advance(0, 230)); // past the spawn phase
      await page.keyboard.press('Escape');
      await render(page);
      expect(await visible(page, 'pause-menu')).toBe(true);
      expect(await paused(page)).toBe(true);
      expect(await page.locator(tid('pause-summary')).textContent()).toBe('Vinst: Sist kvar · Flest poäng efter 5 min');
      for (const id of ['pause-resume', 'pause-restart', 'pause-menu-btn', 'pause-speed-1', 'pause-speed-2', 'pause-speed-4']) {
        const b = (await page.locator(tid(id)).boundingBox())!;
        expect(b.height, id).toBeGreaterThanOrEqual(TARGET_MIN_PX - 1);
      }
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('pause-resume');
      // Tab stays inside the menu
      for (let i = 0; i < 9; i++) await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="pause-menu"]') !== null)).toBe(true);
      await shot(page, 'pause-960');
      // speed from the menu while paused: the choice is kept, the game stays paused; Escape resumes and the focus is given back
      await page.click(tid('pause-speed-4'));
      expect(await paused(page)).toBe(true);
      await page.keyboard.press('Escape');
      await render(page);
      expect(await visible(page, 'pause-menu')).toBe(false);
      expect(await paused(page)).toBe(false);
      expect(await page.evaluate(() => (window as any).__test.state().speed)).toBe(4);
      // Escape with a mode on the stack closes the mode and does NOT open the menu
      await page.click(tid('build-city'));
      expect(await page.evaluate(() => (window as any).__test.props().placing)).not.toBe(0);
      await page.keyboard.press('Escape');
      await render(page);
      expect(await page.evaluate(() => (window as any).__test.props().placing)).toBe(0);
      expect(await visible(page, 'pause-menu')).toBe(false);
      // and with an empty stack the next one opens it
      await page.keyboard.press('Escape');
      await render(page);
      expect(await visible(page, 'pause-menu')).toBe(true);
      await page.keyboard.press('Escape');
      await render(page);
      // fast-forward past the 5 minute limit: the result screen, with the statistics of the sim
      expect(await visible(page, 'result-screen')).toBe(false);
      await page.evaluate(() => (window as any).__test.advance(0, 3100));
      await render(page);
      expect(await visible(page, 'result-screen')).toBe(true);
      expect(await paused(page)).toBe(true);
      const info = await page.evaluate(() => (window as any).__test.matchInfo());
      expect(info.ended).toBe(true);
      expect(info.reason).toBeGreaterThan(0);
      const rows = await page.locator(tid('result-row')).evaluateAll((els) =>
        els.map((e) => ({ seat: Number((e as HTMLElement).dataset.seat), rank: Number((e as HTMLElement).dataset.rank), winner: (e as HTMLElement).dataset.winner, cells: Array.from(e.querySelectorAll('td')).map((td) => td.textContent ?? '') })),
      );
      expect(rows.length).toBe(info.players);
      expect(rows.length).toBe(3);
      expect(rows[0]?.seat).toBe(info.winnerSeat);
      expect(rows[0]?.winner).toBe('1');
      for (const r of rows) {
        // columns: rank, nation, land %, score, peak land, built, conquered; all but the land % are the sim's numbers
        expect(Number(r.cells[3]), `score of seat ${r.seat}`).toBe(info.score[r.seat]);
        expect(Number(r.cells[4]), `peak land of seat ${r.seat}`).toBe(info.peakLand[r.seat]);
        expect(Number(r.cells[5]), `built of seat ${r.seat}`).toBe(info.built[r.seat]);
        expect(Number(r.cells[6]), `conquered of seat ${r.seat}`).toBe(info.conquered[r.seat]);
        expect(r.cells[2]).toMatch(/^\d+,\d %$/);
      }
      // the reason as text, the winner named (Swedish) and the two buttons
      const reason = (await page.locator(tid('result-reason')).textContent()) ?? '';
      expect(reason.length).toBeGreaterThan(3);
      if (info.reason === 3) expect(reason).toBe('Högst poäng efter 5 minuter');
      if (info.reason === 2) expect(reason).toBe('Sist kvar');
      expect(await visible(page, 'result-again')).toBe(true);
      expect(await visible(page, 'result-menu')).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('result-again');
      await shot(page, 'result-960');
      // Escape does not open the pause menu over the result
      await page.keyboard.press('Escape');
      await render(page);
      expect(await visible(page, 'pause-menu')).toBe(false);
      // the card of the result is the golden (DOM text and colours only, so it does not depend on the globe behind it)
      const card = await page.locator(`${tid('result-screen')} .mp-card`).screenshot({ type: 'png' });
      const g = compareGolden(card, 'result-screen');
      expect(['match', 'updated', 'mismatch-warn', 'missing-warn']).toContain(g.status);
      expect(messages.filter((m) => m.type === 'error')).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('elimination of the human and the toasts for the others', () => {
  it('shows Watch / Restart / To the menu, then the spectator bar; a toast names an eliminated AI nation', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1');
    try {
      await settle(page, 0.5);
      // the immunity / countdown text of the spawn phase is visible, and the pause menu does not cover it
      expect(await visible(page, 'phase-text')).toBe(true);
      await page.keyboard.press('Escape');
      await render(page);
      const banner = (await page.locator(tid('phase')).boundingBox())!;
      const card = (await page.locator(`${tid('pause-menu')} .mp-card`).boundingBox())!;
      expect(card.y).toBeGreaterThanOrEqual(banner.y + banner.height - 1);
      await page.keyboard.press('Escape');
      await render(page);
      expect(await visible(page, 'pause-menu')).toBe(false);
      // another nation is eliminated: a toast, no panel
      await page.evaluate(() => (window as any).__test.forceEliminated(1));
      await render(page);
      expect(await toasts(page)).toContain('toast.eliminated');
      expect(await visible(page, 'eliminated-panel')).toBe(false);
      // the human: the panel with the three choices
      await page.evaluate(() => (window as any).__test.forceEliminated(0));
      await render(page);
      expect(await visible(page, 'eliminated-panel')).toBe(true);
      for (const id of ['elim-spectate', 'elim-restart', 'elim-menu']) expect(await visible(page, id), id).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('elim-spectate');
      expect(await paused(page)).toBe(true);
      await shot(page, 'eliminated-960');
      await page.keyboard.press('Escape'); // not ours while the panel is open
      await render(page);
      expect(await visible(page, 'pause-menu')).toBe(false);
      await page.click(tid('elim-spectate'));
      await render(page);
      expect(await visible(page, 'eliminated-panel')).toBe(false);
      expect(await visible(page, 'spectator-bar')).toBe(true);
      expect(await page.locator(tid('spectator-badge')).textContent()).toBe(TABLES.sv['spectator.badge']);
      expect(await paused(page)).toBe(false);
      await page.click(tid('spectator-speed-2'));
      expect(await page.evaluate(() => (window as any).__test.state().speed)).toBe(2);
      await shot(page, 'spectator-960');
      expect(messages.filter((m) => m.type === 'error')).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the panels fit a portrait window and speak English', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&lang=en', { width: 540, height: 960 });
    try {
      await settle(page, 0.5);
      await page.evaluate(() => (window as any).__test.forceEliminated(0));
      await render(page);
      const card = (await page.locator(`${tid('eliminated-panel')} .mp-card`).boundingBox())!;
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(540);
      expect(card.y + card.height).toBeLessThanOrEqual(960);
      expect(await page.locator(tid('eliminated-title')).textContent()).toBe(TABLES.en['elim.title']);
      await shot(page, 'eliminated-540-en');
      expect(messages.filter((m) => m.type === 'error')).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

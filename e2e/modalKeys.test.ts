// Fix-3B: while a modal is open (pause menu, elimination panel, result screen) the match keys and the reserved keys 1 to 6 are dead; only Escape
// goes through. Each case presses Space, the speed keys and digits and checks that paused, speed, placing and the tick counter are unchanged.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { launchBrowser, openPage } from '../scripts/shot.mjs';

let browser: Browser;
const baseUrl = inject('baseUrl');
beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

const tid = (id: string): string => `[data-testid="${id}"]`;
const render = (page: Page): Promise<void> => page.evaluate(() => (window as any).__test.render());
const probe = (page: Page): Promise<{ paused: boolean; speed: number; tick: number; placing: number }> =>
  page.evaluate(() => {
    const t = (window as any).__test;
    const s = t.state();
    return { paused: s.paused, speed: s.speed, tick: s.tick, placing: t.props().placing };
  });

async function pressDead(page: Page, label: string): Promise<void> {
  // a focused dialog button keeps its own Space/Enter (that is the menu's key, not a match key): take the focus away so the page-level keys are what is tested
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const before = await probe(page);
  for (const key of [' ', '.', ',', '+', '-', '[', ']', '1', '2', '6']) await page.keyboard.press(key);
  await page.evaluate(() => (window as any).__test.run(2, 10));
  expect(await probe(page), label).toEqual(before);
}

describe('modal key blocking', () => {
  it('pause menu and elimination panel ignore Space, speed keys and 1 to 6; Escape still works', async () => {
    const { page } = await openPage(browser, baseUrl, 'test=1&seed=7&hud=1&ai=0', { width: 960, height: 540 });
    try {
      await page.evaluate(() => (window as any).__test.advance(0, 230)); // past the spawn phase
      // control: without a modal Space toggles the pause, so the keys do reach the handler
      const free = await probe(page);
      await page.keyboard.press(' ');
      expect((await probe(page)).paused).toBe(!free.paused);
      await page.keyboard.press(' ');
      expect((await probe(page)).paused).toBe(free.paused);
      // pause menu
      await page.keyboard.press('Escape');
      await render(page);
      expect(await page.locator(tid('pause-menu')).isVisible()).toBe(true);
      await pressDead(page, 'pause menu');
      await page.keyboard.press('Escape');
      await render(page);
      expect(await page.locator(tid('pause-menu')).isVisible()).toBe(false);
      // elimination panel
      await page.evaluate(() => (window as any).__test.forceEliminated(0));
      await render(page);
      expect(await page.locator(tid('eliminated-panel')).isVisible()).toBe(true);
      await pressDead(page, 'elimination panel');
    } finally {
      await page.close();
    }
  });

  it('the result screen ignores the keys', async () => {
    const { page } = await openPage(browser, baseUrl, 'test=1&menu=1&hud=1&seed=7', { width: 960, height: 540 });
    try {
      await page.click(tid('start-setup'));
      await page.waitForSelector(tid('setup-screen'), { timeout: 30_000 });
      await page.selectOption(tid('setup-region'), 'europe');
      await page.fill(tid('setup-search'), 'Sverige');
      await page.locator(tid('setup-row')).first().click();
      await page.click(tid('setup-win-preset-quick'));
      await page.selectOption(tid('setup-win-minutes'), '5');
      await page.click(tid('setup-start'));
      await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
      await page.evaluate(() => (window as any).__test.advance(0, 230));
      await page.evaluate(() => (window as any).__test.advance(0, 3100));
      await render(page);
      expect(await page.locator(tid('result-screen')).isVisible()).toBe(true);
      await pressDead(page, 'result screen');
    } finally {
      await page.close();
    }
  });

  it('Fix-6B: with the research panel, the diplomacy panel or the ? card open the keys 7, 8, 9, L and B start nothing behind it; closed again, 9 places', async () => {
    const { page } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 });
    try {
      const p = (lat: number, lon: number) => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const) as Promise<{ x: number; y: number }>;
      await page.evaluate(() => (window as any).__test.setView({ lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 }));
      const p0 = await p(48.5, 11);
      await page.mouse.click(p0.x, p0.y);
      await page.evaluate(() => (window as any).__test.advance(0.1, 260));
      const placing = async (): Promise<number> => (await page.evaluate(() => (window as any).__test.props().placing)) as number;
      // control: free, 9 arms the placement and 9 again ends it
      await page.keyboard.press('9');
      expect(await placing(), 'free map: 9 places').toBe(9);
      await page.keyboard.press('9');
      expect(await placing()).toBe(0);
      for (const [open, close, label] of [['t', 't', 'research panel'], ['d', 'd', 'diplomacy panel'], ['?', '?', 'help card']] as const) {
        await page.keyboard.press(open);
        await render(page);
        for (const k of ['7', '8', '9', 'b', 'l']) await page.keyboard.press(k);
        expect(await placing(), `${label}: no placement behind it`).toBe(0);
        await page.keyboard.press(close);
        await render(page);
      }
      await page.keyboard.press('9');
      expect(await placing(), 'after the panels are closed 9 places again').toBe(9);
    } finally {
      await page.close();
    }
  });

  it('__test.give refuses a gift above DEBUG_GIVE_MAX with a visible reason and accepts the maximum', async () => {
    const { page } = await openPage(browser, baseUrl, 'test=1&seed=7&hud=1&ai=0', { width: 960, height: 540 });
    try {
      const over = await page.evaluate(() => {
        try {
          (window as any).__test.give(0, { gold: 2_000_000 });
          return 'accepted';
        } catch (e) {
          return String(e);
        }
      });
      expect(over).toContain('DEBUG_GIVE_MAX');
      const ok = await page.evaluate(() => {
        try {
          (window as any).__test.give(0, { gold: 1_000_000 });
          return 'accepted';
        } catch (e) {
          return String(e);
        }
      });
      expect(ok).toBe('accepted');
    } finally {
      await page.close();
    }
  });
});

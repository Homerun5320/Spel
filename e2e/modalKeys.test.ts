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
});

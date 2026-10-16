// M18b-3 in headless Chromium: a federation is ONE leaderboard row (summed share, living members, its flag) that expands into its members, the win meter
// follows the group, and a fast-forwarded match ends on the time limit with the result screen showing the winning group. Screenshots: test-results/shots/fedwin-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';

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

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as any).__test.render());
  fs.writeFileSync(path.join(SHOT_DIR, `fedwin-${name}.png`), await page.screenshot({ type: 'png' }));
}

/** Setup -> the USA with "Dela upp stormakter" (and the Quick preset with 5 minutes when `quick`) -> start. */
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
  await page.evaluate(() => (window as any).__test.advance(0, 230)); // past the spawn phase
  await page.evaluate(() => (window as any).__test.settle(0.25, 2));
}

describe('a federation in the leaderboard and the win meter', () => {
  it('one expandable row with the summed share, a flag and the living members; the win meter measures the group', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&menu=1&hud=1&seed=1', { width: 960, height: 540 });
    try {
      await startUsa(page, false);
      const group = page.locator(`${tid('leader-row')}[data-group="1"]`);
      expect(await group.count()).toBe(1);
      const members = Number(await group.getAttribute('data-members'));
      expect(members).toBeGreaterThanOrEqual(8);
      expect(await group.getAttribute('data-flag')).toBe('1');
      expect(await group.locator('.hud-name').textContent()).toMatch(/USA|United States of America/);
      expect(await group.locator('.hud-name').textContent()).toContain(`${members}/`);
      expect(await page.locator(`${tid('leader-row')}[data-sub="1"]:visible`).count()).toBe(0);
      const share = Number(await group.getAttribute('data-share'));
      // click: the members follow as indented rows whose shares add up to the group's
      await group.click();
      await page.evaluate(() => (window as any).__test.settle(0.25, 2));
      const subs = await page.locator(`${tid('leader-row')}[data-sub="1"]`).evaluateAll((els) => els.filter((e) => !(e as HTMLElement).hidden).map((e) => Number((e as HTMLElement).dataset.share)));
      expect(subs.length).toBe(members);
      expect(Math.abs(subs.reduce((a, b) => a + b, 0) - share)).toBeLessThanOrEqual(members);
      expect(await page.locator(`${tid('leader-row')}[data-group="1"]`).getAttribute('data-expanded')).toBe('1');
      await shot(page, 'board-expanded');
      await page.locator(`${tid('leader-row')}[data-group="1"]`).click();
      await page.evaluate(() => (window as any).__test.settle(0.25, 2));
      expect(await page.locator(`${tid('leader-row')}[data-sub="1"]:visible`).count()).toBe(0);
      // the win meter: the leader is the federation (9 or more sub-nations against single nations), named by the federation, with the summed percent
      const meter = page.locator(tid('win-leader'));
      expect(await meter.textContent()).toMatch(/USA|United States of America/);
      const pct = (await group.locator('.hud-share').textContent()) ?? '';
      expect(await meter.textContent()).toContain(pct.trim());
      await shot(page, 'meter');
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the result of a federation match', () => {
  it('the time limit ends the match; the result screen has a group table with the winning group first and its members under it', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&menu=1&hud=1&seed=1', { width: 960, height: 540 });
    try {
      await startUsa(page, true);
      await page.evaluate(() => (window as any).__test.advance(0, 3300));
      await page.evaluate(() => (window as any).__test.render());
      await page.waitForSelector(tid('result-screen'), { timeout: 30_000 });
      const info = await page.evaluate(() => (window as any).__test.matchInfo());
      expect(info.ended).toBe(true);
      const groups = await page.locator(tid('result-group')).evaluateAll((els) =>
        els.map((e) => ({ fed: (e as HTMLElement).dataset.fed, winner: (e as HTMLElement).dataset.winner, members: ((e as HTMLElement).dataset.members ?? '').split(',').map(Number), rank: (e as HTMLElement).dataset.rank })),
      );
      expect(groups.length).toBeGreaterThan(1);
      expect(groups[0]?.winner).toBe('1');
      expect(groups[0]?.members).toContain(info.winnerSeat);
      expect(groups.filter((g) => g.winner === '1').length).toBe(1);
      const fedGroup = groups.find((g) => g.fed !== '-1');
      expect(fedGroup).toBeTruthy();
      expect(await page.locator(tid('result-group-member')).count()).toBe(fedGroup?.members.length ?? 0);
      // a federation that wins gets the shared headline
      if (fedGroup?.winner === '1') {
        const title = (await page.locator(tid('result-title')).textContent()) ?? '';
        expect(title).toMatch(/Seger tillsammans|vann tillsammans/);
      }
      // the flat per-nation table is still there, one row per player
      expect(await page.locator(tid('result-row')).count()).toBe(info.players);
      await shot(page, 'result');
      expect(consoleMessages.filter((m: any) => m.type === 'error')).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// M18b-2 in headless Chromium: the setup option "Dela upp stormakter" is off by default; with it on, choosing the USA starts a match whose leaderboard shows several
// allied sub-nations (the alliance badge), the diplomacy panel cannot break the alliance, and the option explains itself in the setup. Screenshots: test-results/shots/fed-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { REJECT_DIPLO_FEDERATION } from '../src/sim/intents';
import { TABLES } from '../src/ui/i18n';

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

const tid = (id: string): string => `[data-testid="${id}"]`;

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as any).__test.render());
  fs.writeFileSync(path.join(SHOT_DIR, `fed-${name}.png`), await page.screenshot({ type: 'png' }));
}

describe('Dela upp stormakter', () => {
  it('off by default; on, the USA becomes allied sub-nations that show the alliance badge and cannot break it', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&menu=1&hud=1&seed=1', { width: 960, height: 540 });
    try {
      await page.click(tid('start-setup'));
      await page.waitForSelector(tid('setup-screen'), { timeout: 30_000 });
      expect(await page.locator(tid('setup-federation')).isChecked()).toBe(false);
      expect(await page.locator(tid('setup-federation-info')).isHidden()).toBe(true);
      await page.fill('#setup-search', 'United States');
      await page.locator(`${tid('setup-row')}[data-a3="USA"]`).first().click();
      await page.locator(tid('setup-federation')).check();
      const info = (await page.locator(tid('setup-federation-info')).textContent()) ?? '';
      expect(Number(await page.locator(tid('setup-federation-info')).getAttribute('data-members'))).toBeGreaterThanOrEqual(9);
      expect(info).toContain('United States of America');
      expect(info).toContain('24');
      await shot(page, 'setup');
      await page.click(tid('setup-start'));
      await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
      await page.evaluate(() => (window as any).__test.advance(0, 30));
      await page.evaluate(() => (window as any).__test.settle(0.25, 2));
      const rows = await page.locator(tid('leader-row')).evaluateAll((els) =>
        els.filter((e) => !(e as HTMLElement).hidden).map((e) => ({ name: e.querySelector('.hud-name')?.textContent ?? '', ally: (e.querySelector('[data-testid="rel-alliance"]')?.textContent ?? '').length > 0 })),
      );
      const allied = rows.filter((r) => r.ally);
      expect(allied.length, JSON.stringify(rows)).toBeGreaterThanOrEqual(3);
      for (const r of allied) expect(r.name).toContain('(United States of America)');
      await shot(page, 'leaderboard');
      // the diplomacy panel: the alliance is there and the break button is the sim's verdict
      await page.keyboard.press('d');
      await page.waitForSelector(tid('diplo-panel'));
      const bound = await page.locator(`${tid('diplo-row')}[data-relation="alliance"]`).count();
      expect(bound).toBeGreaterThanOrEqual(3);
      const brk = page.locator(`${tid('diplo-row')}[data-relation="alliance"] ${tid('diplo-break')}`).first();
      expect(await brk.getAttribute('aria-disabled')).toBe('true');
      expect(await brk.getAttribute('data-reason')).toBe(String(REJECT_DIPLO_FEDERATION));
      expect(await brk.getAttribute('title')).toBe(TABLES.sv['reject.diplo.federation']);
      await shot(page, 'diplo');
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

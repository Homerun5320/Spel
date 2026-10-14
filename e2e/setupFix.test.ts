// M06fix in headless Chromium: the small fixes of the play audit. Escape in the setup goes back (first press leaves the text field), Enter in the
// search box does not choose a disabled country, the cell count has a singular, the refusal sentences start with a capital letter, a custom
// nation cannot take the name of a real country, and the chosen language is remembered over a reload. Screenshots: test-results/shots/setupfix-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { countryEligibility } from '../src/app/eligibility';
import type { PreparedWorld } from '../src/app/matchWorld';
import { TABLES } from '../src/ui/i18n';
import { loadPreparedWorld } from '../tools/sim/realWorld';

interface Msg {
  type: string;
  text: string;
}

let browser: Browser;
let world: PreparedWorld;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  world = await loadPreparedWorld();
});
afterAll(async () => {
  await browser?.close();
});

async function open(query: string): Promise<{ page: Page; messages: Msg[] }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, { width: 960, height: 540 });
  return { page, messages: consoleMessages as Msg[] };
}

const tid = (id: string): string => `[data-testid="${id}"]`;
const text = (page: Page, id: string): Promise<string> => page.locator(tid(id)).first().textContent().then((x) => x ?? '');
const focusedId = (page: Page): Promise<string | null> => page.evaluate(() => document.activeElement?.id ?? null);

async function openSetup(page: Page): Promise<void> {
  await page.click(tid('start-setup'));
  await page.waitForSelector(tid('setup-screen'), { timeout: 30_000 });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as any).__test.render());
  fs.writeFileSync(path.join(SHOT_DIR, `setupfix-${name}.png`), await page.screenshot({ type: 'png' }));
}

/** A country that cannot be chosen because it is tiny, found by its data: exactly one cell. */
const oneCell = (): { a3: string; nameEn: string; nameSv: string } => {
  const c = world.countries.find((x) => x.cells === 1 && !countryEligibility(world.analyse('world'), x).ok);
  if (!c) throw new Error('no one-cell country in the data');
  return c;
};

describe('Escape in the setup', () => {
  it('the first press leaves the search box (the text stays, the setup stays), the second goes back to the main menu', async () => {
    const { page, messages } = await open('test=1&menu=1');
    try {
      await openSetup(page);
      await page.focus('#setup-search');
      await page.fill('#setup-search', 'swe');
      expect(await focusedId(page)).toBe('setup-search');
      await page.keyboard.press('Escape');
      expect(await focusedId(page)).not.toBe('setup-search');
      expect(await page.inputValue('#setup-search')).toBe('swe'); // a search field would clear itself on Escape; ours does not
      expect(await page.locator(tid('setup-screen')).count()).toBe(1);
      await page.keyboard.press('Escape');
      await page.waitForSelector(tid('start-screen'));
      expect(await page.locator(tid('setup-screen')).count()).toBe(0);
      expect(await page.locator(tid('start-setup')).isVisible()).toBe(true);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('with no text field focused one Escape goes back; the setup can be opened again and Escape works again', async () => {
    const { page, messages } = await open('test=1&menu=1');
    try {
      await openSetup(page);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Escape');
      await page.waitForSelector(tid('start-screen'));
      expect(await page.locator(tid('setup-screen')).count()).toBe(0);
      await openSetup(page);
      await page.keyboard.press('Escape');
      await page.waitForSelector(tid('start-screen'));
      expect(await page.locator(tid('setup-screen')).count()).toBe(0);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('an Escape that closes the Dev panel does not also leave the setup', async () => {
    const { page, messages } = await open('test=1&menu=1&devbtn=1');
    try {
      await openSetup(page);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('F2');
      await page.waitForSelector('[data-dev-panel]:not([hidden])');
      await page.keyboard.press('Escape');
      expect(await page.locator('[data-dev-panel]').evaluate((e) => (e as HTMLElement).hidden)).toBe(true);
      expect(await page.locator(tid('setup-screen')).count()).toBe(1);
      await page.keyboard.press('Escape');
      await page.waitForSelector(tid('start-screen'));
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('Escape in the seed field of the options leaves the field first too', async () => {
    const { page, messages } = await open('test=1&menu=1');
    try {
      await openSetup(page);
      await page.focus('#setup-seed');
      await page.keyboard.press('Escape');
      expect(await page.locator(tid('setup-screen')).count()).toBe(1);
      expect(await focusedId(page)).not.toBe('setup-seed');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('Enter in the search box', () => {
  it('on a disabled first row chooses nothing; on a country that can be played it chooses it', async () => {
    const tiny = oneCell();
    const { page, messages } = await open('test=1&menu=1');
    try {
      await openSetup(page);
      await page.fill('#setup-search', tiny.nameEn);
      const first = page.locator(tid('setup-row')).first();
      expect(await first.getAttribute('data-a3')).toBe(tiny.a3);
      expect(await first.getAttribute('data-ok')).toBe('0');
      await page.press('#setup-search', 'Enter');
      expect(await first.getAttribute('data-selected')).toBe('0');
      expect(await page.locator(`${tid('setup-row')}[data-selected="1"]`).count()).toBe(0);
      expect(await page.locator(tid('setup-status')).getAttribute('data-key')).toBe('setup.need.country');
      expect(await page.locator(tid('setup-start')).isDisabled()).toBe(true);
      // a country that can be played: Enter chooses it
      await page.fill('#setup-search', 'Sweden');
      await page.press('#setup-search', 'Enter');
      expect(await page.locator(`${tid('setup-row')}[data-selected="1"]`).getAttribute('data-a3')).toBe('SWE');
      expect(await page.locator(tid('setup-start')).isDisabled()).toBe(false);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the cell count and the refusal sentences', () => {
  it('a country of one cell says "1 cell", never "1 celler"; the reason starts with a capital letter, in Swedish and in English', async () => {
    const tiny = oneCell();
    const { page, messages } = await open('test=1&menu=1');
    try {
      await openSetup(page);
      await page.fill('#setup-search', tiny.nameEn);
      const row = page.locator(tid('setup-row')).first();
      const meta = row.locator('.setup-row-meta');
      expect(await meta.textContent()).toBe('1 cell');
      const why = (await row.locator(tid('setup-row-why')).textContent()) ?? '';
      expect(why).toMatch(/^[A-ZÅÄÖ]/);
      await shot(page, 'one-cell-sv');
      await page.click(tid('setup-language'));
      expect(await meta.textContent()).toBe('1 cell');
      expect((await row.locator(tid('setup-row-why')).textContent()) ?? '').toMatch(/^[A-Z]/);
      await shot(page, 'one-cell-en');
      // a bigger country says cells (plural) in both languages
      await page.fill('#setup-search', 'Sweden');
      expect(await page.locator(tid('setup-row')).first().locator('.setup-row-meta').textContent()).toMatch(/^[\d ,]+ cells$/);
      await page.click(tid('setup-language'));
      await page.fill('#setup-search', 'Sverige');
      expect(await page.locator(tid('setup-row')).first().locator('.setup-row-meta').textContent()).toMatch(/^[\d  ]+ celler$/);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('every reason shown on a disabled row of the whole list starts with a capital letter (both languages), the land mass sentence has its subject', async () => {
    const { page, messages } = await open('test=1&menu=1');
    try {
      await openSetup(page);
      const whys = async (): Promise<string[]> => page.locator(tid('setup-row-why')).allTextContents();
      for (const lang of ['sv', 'en'] as const) {
        const list = await whys();
        expect(list.length).toBeGreaterThan(50);
        for (const w of list) expect(w, `${lang}: ${w}`).toMatch(/^[A-ZÅÄÖ]/);
        const landmass = list.filter((w) => w.includes(lang === 'sv' ? 'Landmassan' : 'land mass'));
        expect(landmass.length).toBeGreaterThan(0);
        if (lang === 'sv') await page.click(tid('setup-language'));
      }
      expect(TABLES.en['setup.reason.smallLandmass']).toMatch(/^The land mass is too small/);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('a custom nation and the names of real countries', () => {
  it('the name of a real country (English or Swedish, any case) is refused with a reason in the status and Start stays off', async () => {
    const { page, messages } = await open('test=1&menu=1');
    try {
      await openSetup(page);
      await page.click(tid('setup-tab-custom'));
      for (const [name, lang] of [['Sweden', 'sv'], ['sverige', 'sv']] as const) {
        await page.fill('#setup-name', name);
        expect(await page.locator(tid('setup-status')).getAttribute('data-key'), name).toBe('setup.error.nameTaken');
        expect(await text(page, 'setup-status'), name).toBe(TABLES[lang]['setup.error.nameTaken'].replace('{name}', name));
        expect(await page.locator(tid('setup-start')).isDisabled()).toBe(true);
      }
      await shot(page, 'name-taken-sv');
      await page.click(tid('setup-language'));
      await page.fill('#setup-name', 'Sweden');
      expect(await text(page, 'setup-status')).toBe(TABLES.en['setup.error.nameTaken'].replace('{name}', 'Sweden'));
      await shot(page, 'name-taken-en');
      // an own name is not the reason any more
      await page.fill('#setup-name', 'Zorland');
      expect(await page.locator(tid('setup-status')).getAttribute('data-key')).toBe('setup.need.cell');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the language is remembered (the live page, no test mode)', () => {
  async function live(hash: string): Promise<{ page: Page; messages: string[] }> {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const messages: string[] = [];
    page.on('console', (m) => {
      // The Vite dev client logs "Failed to fetch" when a document is left in the middle of its own ping; that is the dev server, not the game.
      if ((m.type() === 'error' || m.type() === 'warning') && !m.location().url.includes('/@vite/client')) messages.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    await page.goto(`${baseUrl}/?quality=low${hash}`, { waitUntil: 'load' });
    await ready(page);
    return { page, messages };
  }

  /** The start screen is up and the world for the setup is prepared (its button is enabled): leaving earlier would abort a fetch and log an error. */
  async function ready(page: Page): Promise<void> {
    await page.waitForSelector(tid('start-screen'), { timeout: 60_000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid="start-setup"]') as HTMLButtonElement | null;
      return b !== null && !b.disabled;
    }, null, { timeout: 60_000 });
  }

  it('Swedish at first; English after the language button and after a reload; the address language still wins and is not stored', async () => {
    const { page, messages } = await live('');
    try {
      expect(await text(page, 'play')).toBe(TABLES.sv['start.play']);
      await page.click(tid('start-language'));
      expect(await text(page, 'play')).toBe(TABLES.en['start.play']);
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      expect(await text(page, 'play')).toBe(TABLES.en['start.play']);
      // the address wins over the stored English, without changing what is stored
      await page.goto(`${baseUrl}/?quality=low#lang-sv`, { waitUntil: 'load' });
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      expect(await text(page, 'play')).toBe(TABLES.sv['start.play']);
      await page.goto(`${baseUrl}/?quality=low`, { waitUntil: 'load' });
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      expect(await text(page, 'play')).toBe(TABLES.en['start.play']); // still the stored one
      // and back to Swedish by the button, remembered again
      await page.click(tid('start-language'));
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      expect(await text(page, 'play')).toBe(TABLES.sv['start.play']);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('with localStorage blocked the page still works, and the language lasts for the page (the memory fallback)', async () => {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const messages: string[] = [];
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    try {
      await page.goto(`${baseUrl}/?quality=low`, { waitUntil: 'load' });
      await page.waitForSelector(tid('start-screen'), { timeout: 60_000 });
      await page.click(tid('start-language'));
      expect(await text(page, 'play')).toBe(TABLES.en['start.play']);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

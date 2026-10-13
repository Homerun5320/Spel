// M02 item 10 in headless Chromium: the Dev panel (F2 and the corner button, also in a 390x844 phone viewport), the perf
// overlay through `?perf=1` and `#perf`, the hash restart without a page reload, and showReport with a refused clipboard.
import fs from 'node:fs';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { HANG_GUARD_MS, guard, launchBrowser } from '../scripts/shot.mjs';

let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

interface Opened {
  page: Page;
  messages: Array<{ type: string; text: string }>;
}

async function open(path: string, opts: { viewport?: { width: number; height: number }; init?: () => void; waitTest?: boolean } = {}): Promise<Opened> {
  const page = await browser.newPage({ viewport: opts.viewport ?? { width: 960, height: 540 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(HANG_GUARD_MS);
  const messages: Array<{ type: string; text: string }> = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') messages.push({ type: m.type(), text: m.text() });
  });
  page.on('pageerror', (e) => messages.push({ type: 'error', text: `pageerror: ${e.message}` }));
  if (opts.init) await page.addInitScript(opts.init);
  await guard(page.goto(`${baseUrl}/${path}`, { waitUntil: 'load' }), 'goto');
  if (opts.waitTest !== false) await guard(page.waitForFunction(() => (window as any).__test !== undefined), 'wait for __test');
  return { page, messages };
}

describe('Dev panel', () => {
  it('F2 opens and closes the panel, which lists the registered modes and the relative data page link', async () => {
    const { page, messages } = await open('?test=1');
    try {
      const panel = page.locator('[data-dev-panel]');
      expect(await panel.isVisible()).toBe(false);
      await page.keyboard.press('F2');
      expect(await panel.isVisible()).toBe(true);
      for (const id of ['perf', 'test', 'scene-spike', 'quality-high', 'seed-7', 'debug-data', 'clear']) {
        expect(await page.locator(`[data-dev-mode="${id}"]`).count(), id).toBe(1);
      }
      const href = await page.locator('[data-dev-mode="debug-data"]').getAttribute('href');
      expect(href).toBe(`${baseUrl}/debug/data.html`); // written through siteUrl, resolved from the relative ./debug/data.html
      const res = await page.request.get(href as string);
      expect(res.status()).toBe(200);
      await page.keyboard.press('F2');
      expect(await panel.isVisible()).toBe(false);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the perf mode of the panel turns the overlay on and off (it writes the hash and reloads, never the query)', async () => {
    const { page, messages } = await open('?test=1');
    try {
      expect(await page.locator('[data-perf]').count()).toBe(0);
      await page.keyboard.press('F2');
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.locator('[data-dev-mode="perf"]').click()]);
      await page.waitForFunction(() => (window as any).__test !== undefined);
      const url1 = new URL(page.url());
      expect(url1.hash).toBe('#perf');
      expect(url1.search).toBe('?test=1'); // the query was not touched
      await page.locator('[data-perf]').waitFor({ state: 'visible' });
      expect(await page.locator('[data-perf]').innerText()).toMatch(/Renderer: .+[\s\S]*fps:[\s\S]*anrop \d+ {2}trianglar \d+ {2}geometrier \d+ {2}texturer \d+[\s\S]*texturminne [\d.]+ MB/);
      expect(await page.locator('[data-perf-copy]').innerText()).toBe('Kopiera rapport');
      // the mode is marked active in the panel; choosing it again switches it off with perf-0
      await page.keyboard.press('F2');
      expect(await page.locator('[data-dev-mode="perf"]').getAttribute('data-active')).toBe('1');
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.locator('[data-dev-mode="perf"]').click()]);
      await page.waitForFunction(() => (window as any).__test !== undefined);
      expect(new URL(page.url()).hash).toBe('#perf-0');
      expect(await page.locator('[data-perf]').count()).toBe(0);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('#perf gives the same mode as ?perf=1 (same overlay text)', async () => {
    const a = await open('?test=1&perf=1');
    const b = await open('?test=1#perf');
    try {
      const texts: string[] = [];
      for (const { page } of [a, b]) {
        await page.evaluate(() => (window as any).__test.render());
        await page.locator('[data-perf]').waitFor({ state: 'visible' });
        texts.push(await page.locator('[data-perf] pre').innerText());
      }
      expect(texts[0]).toBe(texts[1]);
      // and the perf overlay is absent in both without the flag
      const c = await open('?test=1');
      expect(await c.page.locator('[data-perf]').count()).toBe(0);
      await c.page.close();
      expect(a.messages).toEqual([]);
      expect(b.messages).toEqual([]);
    } finally {
      await a.page.close();
      await b.page.close();
    }
  });

  it('a changed hash restarts the mode WITHOUT a page reload (the page object lives on, the scene is rebuilt)', async () => {
    const { page, messages } = await open('?test=1');
    try {
      await page.evaluate(() => {
        (window as any).__marker = 42;
        (window as any).__oldHooks = (window as any).__test;
        location.hash = 'perf';
      });
      await page.locator('[data-perf]').waitFor({ state: 'visible' });
      await page.waitForFunction(() => (window as any).__test !== (window as any).__oldHooks && (window as any).__test !== undefined);
      expect(await page.evaluate(() => (window as any).__marker)).toBe(42); // no reload: the page's own variable survived
      await page.evaluate(() => (window as any).__test.render());
      expect((await page.evaluate(() => (window as any).__test.info())).drawCalls).toBe(3);

      // to the M00 spike scene and back to the globe, still the same page
      await page.evaluate(() => {
        location.hash = 'scene-spike';
      });
      await page.waitForFunction(() => {
        const t = (window as any).__test;
        if (!t) return false;
        t.render();
        return t.info().triangles === 9024; // the spike sphere
      });
      await page.evaluate(() => {
        location.hash = 'scene-globe';
      });
      await page.waitForFunction(() => (window as any).__test?.setView !== undefined);
      await page.evaluate(() => (window as any).__test.render());
      expect((await page.evaluate(() => (window as any).__test.info())).tier).toBe('test');
      expect(await page.evaluate(() => (window as any).__marker)).toBe(42);
      expect(await page.locator('canvas').count()).toBe(1); // the old canvases were removed
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the corner button is visible and tappable in a 390x844 phone viewport, hidden in test mode unless asked for', async () => {
    const { page, messages } = await open('?quality=low', { viewport: { width: 390, height: 844 }, waitTest: false });
    try {
      const btn = page.locator('[data-dev-button]');
      await btn.waitFor({ state: 'visible' });
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      const b = box as { x: number; y: number; width: number; height: number };
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
      expect(b.y + b.height).toBeLessThanOrEqual(844);
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44); // a thumb-sized target
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2).catch(async () => btn.click());
      const panel = page.locator('[data-dev-panel]');
      await panel.waitFor({ state: 'visible' });
      const pb = (await panel.boundingBox()) as { x: number; y: number; width: number; height: number };
      expect(pb.x).toBeGreaterThanOrEqual(0);
      expect(pb.x + pb.width).toBeLessThanOrEqual(390);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
    const t = await open('?test=1');
    const t2 = await open('?test=1#devbtn');
    try {
      expect(await t.page.locator('[data-dev-button]').isVisible()).toBe(false);
      expect(await t2.page.locator('[data-dev-button]').isVisible()).toBe(true);
    } finally {
      await t.page.close();
      await t2.page.close();
    }
  });
});

describe('showReport (Kopiera rapport)', () => {
  it('with a refused clipboard shows the JSON in a selectable textarea and a working Download link', async () => {
    const { page, messages } = await open('?test=1&perf=1', {
      init: () => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('NotAllowedError')) } });
      },
    });
    try {
      await page.evaluate(() => (window as any).__test.render());
      await page.locator('[data-perf-copy]').click();
      const dialog = page.locator('[data-report]');
      await dialog.waitFor({ state: 'visible' });
      const area = dialog.locator('textarea');
      const text = await area.inputValue();
      const json = JSON.parse(text) as Record<string, any>;
      expect(json.schemaVersion).toBe(1);
      expect(json.kind).toBe('perf');
      expect(json.renderer.length).toBeGreaterThan(0);
      expect(json.renderInfo.calls).toBe(3);
      expect(json.textureMB).toBeGreaterThan(10);
      expect(json.fps).toHaveProperty('mean');
      expect(json.fps).toHaveProperty('p95');
      await page.locator('[data-report-status]').filter({ hasText: 'Urklipp nekades' }).waitFor();
      // selectable: Markera allt selects the whole text
      await dialog.getByRole('button', { name: 'Markera allt' }).click();
      expect(await page.evaluate(() => (document.querySelector('[data-report] textarea') as HTMLTextAreaElement).selectionEnd - (document.querySelector('[data-report] textarea') as HTMLTextAreaElement).selectionStart)).toBe(text.length);
      // the Download link is a blob URL with the same bytes, and clicking it produces a download
      const link = dialog.locator('[data-report-download]');
      const href = (await link.getAttribute('href')) as string;
      expect(href.startsWith('blob:')).toBe(true);
      expect(await link.getAttribute('download')).toBe('perf-rapport.json');
      expect(await page.evaluate(async (h) => await (await fetch(h)).text(), href)).toBe(text);
      const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
      const file = await download.path();
      expect(fs.readFileSync(file as string, 'utf8')).toBe(text);
      await dialog.getByRole('button', { name: 'Stäng' }).click();
      expect(await dialog.count()).toBe(0);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('tries the clipboard first, synchronously inside the click handler (user activation active), with the same text', async () => {
    const { page, messages } = await open('?test=1&perf=1', {
      init: () => {
        (window as any).__clip = null;
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: (t: string) => {
              (window as any).__clip = { text: t, active: navigator.userActivation.isActive };
              return Promise.resolve();
            },
          },
        });
      },
    });
    try {
      await page.evaluate(() => (window as any).__test.render());
      await page.locator('[data-perf-copy]').click();
      await page.locator('[data-report-status]').filter({ hasText: 'Kopierat till urklipp' }).waitFor();
      const clip = await page.evaluate(() => (window as any).__clip);
      expect(clip.active).toBe(true);
      expect(clip.text).toBe(await page.locator('[data-report] textarea').inputValue());
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

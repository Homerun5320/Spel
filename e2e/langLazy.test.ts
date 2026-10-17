// Bundle-diet-2: the live (non test) page fetches ONLY the active language table; the other one is fetched when the player switches, a switch back
// is immediate, the choice is remembered (so the next load fetches just that one table) and a failed table fetch is told to the player in the
// language that IS loaded. Real Chromium against the production build served from a plain static server.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchBrowser, waitVisible, fastClick } from '../scripts/shot.mjs';
import { buildDistTo, makeTmp } from '../tests/helpers/buildDist';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

describe('language tables load on demand (live page)', () => {
  let browser: Browser;
  let server: http.Server;
  let base = '';
  let dist = '';
  const requests: string[] = [];

  beforeAll(async () => {
    dist = await buildDistTo(makeTmp('spel-e2e-lang'));
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(dist, `.${rel}`);
      requests.push(rel);
      if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(file));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ({ browser } = await launchBrowser());
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    if (dist) fs.rmSync(dist, { recursive: true, force: true });
  });

  const tableRequests = (): string[] => requests.filter((r) => /\/assets\/i18n\.(sv|en)-/.test(r)).map((r) => (r.includes('i18n.sv-') ? 'sv' : 'en'));

  async function open(): Promise<{ page: Page; messages: string[] }> {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const messages: string[] = [];
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    return { page, messages };
  }

  it('fetches Swedish only at first, English on the switch, nothing on the switch back; the choice is remembered', async () => {
    requests.length = 0;
    const { page, messages } = await open();
    try {
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await waitVisible(page, '[data-testid="start-title"]', 60_000);
      expect(await page.locator('[data-testid="start-title"]').textContent()).toBe('Erövra jorden');
      expect(tableRequests()).toEqual(['sv']);

      await fastClick(page, '[data-testid="start-language"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="start-title"]')?.textContent === 'Conquer the Earth', undefined, { timeout: 20_000 });
      expect(tableRequests()).toEqual(['sv', 'en']);

      await fastClick(page, '[data-testid="start-language"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="start-title"]')?.textContent === 'Erövra jorden', undefined, { timeout: 20_000 });
      expect(tableRequests()).toEqual(['sv', 'en']); // loaded once, kept

      await fastClick(page, '[data-testid="start-language"]'); // English again, then reload: only English is fetched
      await page.waitForFunction(() => document.querySelector('[data-testid="start-title"]')?.textContent === 'Conquer the Earth', undefined, { timeout: 20_000 });
      requests.length = 0;
      await page.reload({ waitUntil: 'load' });
      await waitVisible(page, '[data-testid="start-title"]', 60_000);
      expect(await page.locator('[data-testid="start-title"]').textContent()).toBe('Conquer the Earth');
      expect(tableRequests()).toEqual(['en']);

      // The setup screen switches too (back to Swedish: the table is fetched now).
      await fastClick(page, '[data-testid="start-setup"]');
      await waitVisible(page, '[data-testid="setup-screen"]', 60_000);
      expect(await page.locator('[data-testid="setup-title"]').textContent()).toBe('New match');
      await fastClick(page, '[data-testid="setup-language"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="setup-title"]')?.textContent === 'Ny match', undefined, { timeout: 20_000 });
      expect(tableRequests()).toEqual(['en', 'sv']);
    } finally {
      await page.close();
    }
    expect(messages).toEqual([]);
  });

  it('a table that fails to load is reported in the loaded language, the language stays and the button is usable', async () => {
    const { page, messages } = await open();
    try {
      await page.route(/i18n\.en-/, (route) => route.abort());
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await waitVisible(page, '[data-testid="start-title"]', 60_000);
      await fastClick(page, '[data-testid="start-language"]');
      await waitVisible(page, '[role="alert"][data-lang-error="en"]', 20_000);
      expect(await page.locator('[role="alert"]').textContent()).toContain('Språkfilen kunde inte laddas');
      expect(await page.locator('[data-testid="start-title"]').textContent()).toBe('Erövra jorden');
      expect(await page.locator('[data-testid="start-language"]').isEnabled()).toBe(true);
      // (A browser keeps a failed module fetch in its module map, so the text says "reload the page" instead of offering a retry.)
    } finally {
      await page.close();
    }
    expect(messages).toEqual([]);
  });

  it('while the other table loads the button is disabled and busy, then free again with the new text', async () => {
    const { page, messages } = await open();
    try {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      await page.route(/i18n\.en-/, async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await waitVisible(page, '[data-testid="start-title"]', 60_000);
      await page.locator('[data-testid="start-language"]').click();
      const button = page.locator('[data-testid="start-language"]');
      expect(await button.isDisabled()).toBe(true);
      expect(await button.getAttribute('aria-busy')).toBe('true');
      expect(await page.locator('[data-testid="start-title"]').textContent()).toBe('Erövra jorden'); // not switched before the table is there
      release();
      await page.waitForFunction(() => document.querySelector('[data-testid="start-title"]')?.textContent === 'Conquer the Earth', undefined, { timeout: 20_000 });
      expect(await button.isEnabled()).toBe(true);
      expect(await button.getAttribute('aria-busy')).toBeNull();
    } finally {
      await page.close();
    }
    expect(messages).toEqual([]);
  });

  it('a start language that fails to load falls back to the other one with a notice', async () => {
    const { page, messages } = await open();
    try {
      await page.route(/i18n\.sv-/, (route) => route.abort());
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await waitVisible(page, '[data-testid="start-title"]', 60_000);
      expect(await page.locator('[data-testid="start-title"]').textContent()).toBe('Conquer the Earth');
      await waitVisible(page, '[role="alert"][data-lang-error="sv"]', 20_000);
      expect(await page.locator('[role="alert"]').textContent()).toContain('could not be loaded');
    } finally {
      await page.close();
    }
    expect(messages).toEqual([]);
  });
});

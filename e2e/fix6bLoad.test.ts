// Fix-6B (audit 5, [3.4] and [3.7]): a failed fetch of the sim host chunk is TOLD to the player on Play and on the setup screen's Start (it used to bounce the button
// back in silence), and the language error notice sits inside the start card under the title, one at a time. Real Chromium against the production build.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fastClick, launchBrowser, waitVisible } from '../scripts/shot.mjs';
import { buildDistTo, makeTmp } from '../tests/helpers/buildDist';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.gz': 'application/gzip', '.bin': 'application/octet-stream' };

describe('load failures are visible (production build)', () => {
  let browser: Browser;
  let server: http.Server;
  let base = '';
  let dist = '';

  beforeAll(async () => {
    dist = await buildDistTo(makeTmp('spel-e2e-fix6b'));
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(dist, `.${rel}`);
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
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    if (dist) fs.rmSync(dist, { recursive: true, force: true });
  });

  async function open(): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    return ctx.newPage();
  }

  it('Play with the host chunk blocked: an alert in the start card, the button usable again', async () => {
    const page = await open();
    try {
      await page.route(/mainThreadHost-/, (route) => route.abort());
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await waitVisible(page, '[data-testid="play"]', 60_000);
      await fastClick(page, '[data-testid="play"]');
      await waitVisible(page, '[role="alert"][data-match-load-error="1"]', 30_000);
      expect(await page.locator('[role="alert"]').textContent()).toContain('ladda om sidan');
      expect(await page.locator('.start-card [data-match-load-error="1"]').count(), 'the notice is inside the start card').toBe(1);
      const play = page.locator('[data-testid="play"]');
      expect(await play.isEnabled()).toBe(true);
      expect(await play.textContent()).toBe('Spela');
    } finally {
      await page.context().close();
    }
  }, 120_000);

  it('the setup screen\'s Start with the host chunk blocked shows the load error in its message line', async () => {
    const page = await open();
    try {
      await page.route(/mainThreadHost-/, (route) => route.abort());
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await waitVisible(page, '[data-testid="start-setup"]', 60_000);
      await fastClick(page, '[data-testid="start-setup"]');
      await waitVisible(page, '[data-testid="setup-screen"]', 90_000);
      await page.fill('[data-testid="setup-search"]', 'Sverige');
      await page.locator('[data-testid="setup-row"]').first().click();
      await fastClick(page, '[data-testid="setup-start"]');
      await page.waitForSelector('[data-testid="setup-message"][data-key="app.matchLoadError"]', { timeout: 60_000 });
      expect(await page.locator('[data-testid="setup-message"]').textContent()).toContain('ladda om sidan');
    } finally {
      await page.context().close();
    }
  }, 180_000);

  it('a failed language table: one alert however often the button is pressed, and it does not cover the title', async () => {
    const page = await open();
    try {
      await page.route(/i18n\.en-/, (route) => route.abort());
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await waitVisible(page, '[data-testid="start-title"]', 60_000);
      await fastClick(page, '[data-testid="start-language"]');
      await waitVisible(page, '[role="alert"][data-lang-error="en"]', 20_000);
      await page.evaluate(() => (document.querySelector('[data-testid="start-language"]') as HTMLButtonElement).click());
      await page.waitForTimeout(300);
      expect(await page.locator('[role="alert"]').count()).toBe(1);
      const title = (await page.locator('[data-testid="start-title"]').boundingBox()) as { y: number; height: number };
      const alert = (await page.locator('[role="alert"]').boundingBox()) as { y: number; height: number };
      expect(alert.y, 'the notice starts below the title').toBeGreaterThanOrEqual(title.y + title.height - 0.5);
    } finally {
      await page.context().close();
    }
  }, 120_000);
});

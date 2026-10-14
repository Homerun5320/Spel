// The Artifact build, served the way an Artifact serves it: from a sub-folder (/x/y/), index.html wrapped in a
// minimal skeleton, 404 for every extension the Artifact does not serve. Real Chromium, software WebGL.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALLOWED_EXT, pack } from '../scripts/artifact-pack.mjs';
import { analyzeImage, checkShot, decodePng, launchBrowser, takeShot, waitFrames, fastClick, waitVisible } from '../scripts/shot.mjs';
import { REPO, buildDistTo, makeTmp } from '../tests/helpers/buildDist';
import { readGolden } from '../tests/helpers/simGolden';

const PREFIX = '/x/y/';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

interface Served {
  url: string;
  notFound: string[];
  requests: string[];
  close(): Promise<void>;
}

function serveArtifact(dir: string): Promise<Served> {
  const notFound: string[] = [];
  const requests: string[] = [];
  // The real skeleton carries the tab icon in its head (the Artifact tool's `icon`); without one Chromium asks
  // for /favicon.ico, which has nothing to do with our files. So the skeleton declares an empty icon.
  const skeleton = (fragment: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body>${fragment}</body></html>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const respond = (status: number, type: string, body: Buffer | string): void => {
      requests.push(`${status} ${url.pathname}`);
      if (status === 404) notFound.push(url.pathname);
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (!url.pathname.startsWith(PREFIX)) return respond(404, 'text/plain', 'not found');
    const rel = decodeURIComponent(url.pathname.slice(PREFIX.length));
    if (rel === '' || rel === 'index.html') {
      const fragment = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      return respond(200, MIME['.html'] as string, skeleton(fragment));
    }
    const ext = path.extname(rel).toLowerCase();
    const file = path.resolve(dir, rel);
    if (!ALLOWED_EXT.has(ext) || !file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return respond(404, 'text/plain', 'not found');
    }
    return respond(200, MIME[ext] ?? 'application/octet-stream', fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}${PREFIX.slice(0, -1)}`,
        notFound,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe('artifact build served from /x/y/', () => {
  let browser: Browser;
  let served: Served;
  let outDir = '';
  let servedB64: Served;
  let outB64 = '';
  const tmps: string[] = [];

  beforeAll(async () => {
    const dist = await buildDistTo(makeTmp('spel-e2e-dist'));
    tmps.push(dist);
    outDir = makeTmp('spel-e2e-artifact');
    tmps.push(outDir);
    const result = pack([`--dist=${dist}`, `--out=${outDir}`, '--probe'], { cwd: REPO, log: () => {} });
    expect(result.errors).toEqual([]);
    // Files the Artifact would reject, planted to prove the server answers 404 for them.
    fs.writeFileSync(path.join(outDir, 'planted.bin'), 'x');
    fs.writeFileSync(path.join(outDir, 'planted.gz'), 'x');
    fs.writeFileSync(path.join(outDir, 'planted.zip'), 'x');
    served = await serveArtifact(outDir);
    // The same build packed with the base64 text container (M01: the real packs must load through both containers).
    outB64 = makeTmp('spel-e2e-artifact-b64');
    tmps.push(outB64);
    const b64 = pack([`--dist=${dist}`, `--out=${outB64}`, '--container=b64'], { cwd: REPO, log: () => {} });
    expect(b64.errors).toEqual([]);
    servedB64 = await serveArtifact(outB64);
    ({ browser } = await launchBrowser());
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await served?.close();
    await servedB64?.close();
    for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });
  });

  it('serves like an Artifact: 404 for .bin/.gz/.zip and unknown extensions, 200 for the page', async () => {
    const get = async (p: string): Promise<number> => (await fetch(`${served.url}${p}`)).status;
    expect(await get('/')).toBe(200);
    expect(await get('/probe.html')).toBe(200);
    expect(await get('/planted.bin')).toBe(404);
    expect(await get('/planted.gz')).toBe(404);
    expect(await get('/planted.zip')).toBe(404);
    expect(await get('/assets/nope.js')).toBe(404);
    expect(await get('/data.glb')).toBe(404);
    expect(await get('/LICENSE')).toBe(404);
    expect((await fetch(`${served.url.replace('/x/y', '')}/index.html`)).status).toBe(404); // not under /x/y/
    served.notFound.length = 0;
  });

  it('draws the globe (smoke pixel rules), zero console errors, no 404', async () => {
    served.notFound.length = 0;
    const shot = await takeShot(browser, served.url, { query: 'test=1' });
    console.log(`[artifact] renderer ${shot.info.renderer}; first frame ${shot.info.firstFrameMs?.toFixed(0)} ms`);
    console.log(`[artifact] metrics ${JSON.stringify(analyzeImage(shot.image))}`);
    expect(shot.info.webgl2).toBe(true);
    expect(shot.consoleMessages).toEqual([]);
    expect(checkShot(shot)).toEqual([]);
    expect(served.notFound).toEqual([]);
  });

  it('runs the animated (non test) page from the sub-folder and follows the probe link', async () => {
    served.notFound.length = 0;
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const messages: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${served.url}/`, { waitUntil: 'load' });
      await page.waitForSelector('canvas');
      await waitFrames(page, 3); // a few animation frames have drawn
      const image = decodePng(await page.screenshot({ type: 'png' }));
      const m = analyzeImage(image);
      expect(m.distinctColors).toBeGreaterThanOrEqual(50);
      expect(m.lumaStd).toBeGreaterThanOrEqual(20);
      const link = page.locator('#probe-link');
      expect(await link.isVisible()).toBe(true);
      expect(await link.getAttribute('href')).toBe(`${served.url}/probe.html`);
      await Promise.all([page.waitForURL(/\/x\/y\/probe\.html$/), link.click()]);
      await page.waitForSelector('table');
      expect(await page.locator('a[href="./index.html"]').count()).toBe(1);
    } finally {
      await page.close();
    }
    expect(messages).toEqual([]);
    expect(served.notFound).toEqual([]);
  });

  it('M06: the setup screen works from the sub-folder with no address parameter at all (overrides.json is fetched, the list fills, Start builds a match), for both containers', async () => {
    for (const srv of [served, servedB64]) {
      srv.notFound.length = 0;
      srv.requests.length = 0;
      const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
      const messages: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
      });
      page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
      try {
        await page.goto(`${srv.url}/`, { waitUntil: 'load' });
        await waitVisible(page, '[data-testid="start-setup"]', 60_000);
        await fastClick(page, '[data-testid="start-setup"]');
        await waitVisible(page, '[data-testid="setup-screen"]', 60_000);
        expect(await page.locator('[data-testid="setup-row"]').count()).toBeGreaterThan(200);
        expect(srv.requests.some((r) => r === '200 /x/y/data/overrides.json')).toBe(true);
        await page.fill('#setup-search', 'sverige');
        await fastClick(page, '[data-testid="setup-row"]');
        await fastClick(page, '[data-testid="setup-start"]');
        await waitVisible(page, '[data-testid="match-hud"]', 60_000);
        expect(await page.locator('[data-testid="nation-name"]').textContent()).toBe('Sverige');
        await waitFrames(page, 3); // the first frames of the new match have run: any late console error is in `messages`
      } finally {
        await page.close();
      }
      expect(messages).toEqual([]);
      expect(srv.notFound).toEqual([]);
    }
  });

  it('probe page: containers, worker, WebGL2, hash and search all work from the sub-folder', async () => {
    served.notFound.length = 0;
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const messages: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${served.url}/probe.html?a=1#perf`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-probe-done="1"]', { timeout: 30_000 });
      const status = async (key: string): Promise<string> => (await page.locator(`tr[data-probe="${key}"] td[data-status]`).getAttribute('data-status')) ?? '';
      const detail = async (key: string): Promise<string> => (await page.locator(`tr[data-probe="${key}"] td`).nth(2).innerText());
      for (const key of ['png', 'wasm', 'b64', 'worker', 'gl', 'hash', 'search']) {
        expect(await status(key), `${key}: ${await detail(key)}`).toBe('ok');
      }
      expect(await detail('hash')).toBe('"#perf"');
      expect(await detail('search')).toBe('"?a=1"');
      expect(await detail('root')).toContain(`${served.url}/`);
      expect(await status('clipboard')).toBe('ej testat');
      console.log(`[artifact] probe table:\n${await page.locator('textarea').inputValue()}`);
    } finally {
      await page.close();
    }
    expect(messages).toEqual([]);
    expect(served.notFound).toEqual([]);
  });

  // ---- M01: the real data packs through the Artifact containers --------------------------------------------------------

  const loadDebugPage = async (base: Served, suffix: string): Promise<{ loadMs: number; messages: string[]; status: string }> => {
    base.notFound.length = 0;
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
    const messages: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${base.url}/debug/data.html${suffix}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });
      expect(await page.locator('body').getAttribute('data-checksums')).toBe('ok');
      const m = await page.locator('canvas#map').screenshot({ type: 'png' });
      const metrics = analyzeImage(decodePng(m));
      expect(metrics.distinctColors).toBeGreaterThanOrEqual(8);
      expect(metrics.lumaStd).toBeGreaterThanOrEqual(20);
      return {
        loadMs: Number(await page.locator('body').getAttribute('data-load-ms')),
        messages,
        status: await page.locator('#status').innerText(),
      };
    } finally {
      await page.close();
    }
  };

  it('real packs, png container: debug/data.html loads and verifies the checksums, no 404', async () => {
    const r = await loadDebugPage(served, '#map-class');
    console.log(`[artifact] png container: ${r.status}; load ${r.loadMs.toFixed(0)} ms`);
    expect(r.messages).toEqual([]);
    expect(served.notFound).toEqual([]);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'data', 'manifest.json'), 'utf8')) as Record<string, { file: string; enc: string }>;
    expect(manifest).toEqual({ render: { file: 'render.bin.png', enc: 'raw' }, sim: { file: 'sim.bin.png', enc: 'raw' } });
  });

  it('real packs, b64 container: debug/data.html loads and verifies the checksums, no 404', async () => {
    const r = await loadDebugPage(servedB64, '#map-height');
    console.log(`[artifact] b64 container: ${r.status}; load ${r.loadMs.toFixed(0)} ms`);
    expect(r.messages).toEqual([]);
    expect(servedB64.notFound).toEqual([]);
    const manifest = JSON.parse(fs.readFileSync(path.join(outB64, 'data', 'manifest.json'), 'utf8')) as Record<string, { file: string; enc: string }>;
    expect(manifest).toEqual({ render: { file: 'render.bin.b64.txt', enc: 'b64' }, sim: { file: 'sim.bin.b64.txt', enc: 'b64' } });
  });

  it('M03: debug/sim.html runs from the sub-folder like an Artifact (relative script address) and reaches the committed golden hashes, no 404', async () => {
    served.notFound.length = 0;
    const page = await browser.newPage({ viewport: { width: 800, height: 400 }, deviceScaleFactor: 1 });
    const messages: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${served.url}/debug/sim.html`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });
      const hooks = await page.evaluate(() => (window as unknown as { __debugSim: { hashes: Record<string, string>; hostHashes: Record<string, string>; canary: { hash: string } } }).__debugSim);
      const golden = readGolden();
      expect(hooks.hashes).toEqual(golden.hashes);
      expect(hooks.hostHashes).toEqual(golden.hashes);
      expect(hooks.canary.hash).toBe(golden.canary.hash);
      expect(messages).toEqual([]);
      expect(served.notFound).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('real packs: every file in files.json is under 15 MB and the sum under 64 MB (both containers)', () => {
    for (const dir of [outDir, outB64]) {
      const batches = JSON.parse(fs.readFileSync(path.join(dir, 'files.json'), 'utf8')) as Array<Record<string, string | null>>;
      let sum = fs.statSync(path.join(dir, 'index.html')).size;
      let largest = 0;
      let count = 1;
      for (const batch of batches) {
        for (const [published, source] of Object.entries(batch)) {
          if (source === null) continue;
          const size = fs.statSync(path.join(dir, published)).size;
          expect(size, published).toBeLessThan(15 * 1024 * 1024);
          largest = Math.max(largest, size);
          sum += size;
          count++;
        }
      }
      console.log(`[artifact] ${path.basename(dir)}: ${count} files, ${(sum / 1_000_000).toFixed(2)} MB, largest ${(largest / 1_000_000).toFixed(2)} MB, ${batches.length} batch(es)`);
      expect(sum).toBeLessThan(64 * 1024 * 1024);
    }
  });
});

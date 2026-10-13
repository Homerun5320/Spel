// Headless WebGL2 screenshot harness (Playwright + the full Chromium binary with SwiftShader).
//
// Used by: `npm run shots` (CLI at the bottom), the e2e tests (via import) and CI.
// Rules (docs/DECISIONS.md): no wall-clock assertions except the 20 s hang guard; times are logged only.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..');
export const GOLDEN_DIR = path.join(REPO_ROOT, 'e2e', 'goldens');
export const OUT_DIR = path.join(REPO_ROOT, 'test-results');

/** The only hard time limit: a hang guard. Everything else is logged, never asserted. */
export const HANG_GUARD_MS = 20_000;

/**
 * Chromium switches as an explicit ARRAY. `--enable-precise-memory-info` is a Chrome switch and MUST be its
 * own argument (inside --js-flags it is ignored, usedJSHeapSize is quantised and heapDelta returns 0).
 * No `--no-sandbox` here: Playwright adds it itself when chromiumSandbox is false (the default).
 */
export const CHROMIUM_ARGS = [
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--use-angle=swiftshader',
  '--force-color-profile=srgb',
  '--js-flags=--expose-gc',
  '--enable-precise-memory-info',
];

/**
 * Console warnings that are known harmless and may be ignored. Exact full-text match, this one place only,
 * each entry justified in docs/DECISIONS.md. Empty unless DECISIONS.md says otherwise.
 */
export const ALLOWED_CONSOLE_WARNINGS = [];

/** Pixel-statistics thresholds for a smoke shot (documented in docs/DECISIONS.md). */
export const THRESHOLDS = {
  minDistinctColors: 50,
  /** Luma standard deviation over all pixels (0..255 scale). A flat canvas has 0. */
  minLumaStd: 20,
  /** |luma(centre pixel) - luma(top-left corner pixel)|. */
  minCentreCornerLuma: 40,
  /** mean luma(left half) / mean luma(right half), over pixels with luma > lumaFloor. */
  minLeftRightRatio: 1.15,
  lumaFloor: 2,
  /** A pixel belongs to the globe silhouette if any channel differs from the corner pixel by more than this. */
  silhouetteDelta: 4,
  minCoverage: 0.2,
  maxCoverage: 0.6,
};

export function resolveChromiumPath(env = process.env) {
  if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH;
  const cloud = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (fs.existsSync(cloud)) return cloud;
  return chromium.executablePath();
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Rejects if `promise` does not settle within `ms` (the hang guard). */
export function guard(promise, label, ms = HANG_GUARD_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`hang guard: "${label}" did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------------------------
// Image analysis (pure, unit-tested with synthetic images)
// ---------------------------------------------------------------------------------------------

export function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

export function encodePng(image) {
  const png = new PNG({ width: image.width, height: image.height });
  Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength).copy(png.data);
  return PNG.sync.write(png);
}

/** Rec. 709 luma on sRGB-coded 0..255 values. */
export function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function analyzeImage(image, thresholds = THRESHOLDS) {
  const { width, height, data } = image;
  const n = width * height;
  const colors = new Set();
  let sum = 0;
  let sumSq = 0;
  let leftSum = 0;
  let leftCount = 0;
  let rightSum = 0;
  let rightCount = 0;
  const cr = data[0];
  const cg = data[1];
  const cb = data[2];
  let silhouette = 0;
  const half = width / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      colors.add((r << 16) | (g << 8) | b);
      const l = luma(r, g, b);
      sum += l;
      sumSq += l * l;
      if (l > thresholds.lumaFloor) {
        if (x < half) {
          leftSum += l;
          leftCount++;
        } else {
          rightSum += l;
          rightCount++;
        }
      }
      if (
        Math.abs(r - cr) > thresholds.silhouetteDelta ||
        Math.abs(g - cg) > thresholds.silhouetteDelta ||
        Math.abs(b - cb) > thresholds.silhouetteDelta
      ) {
        silhouette++;
      }
    }
  }
  const mean = sum / n;
  const lumaStd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const ci = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  const centreLuma = luma(data[ci], data[ci + 1], data[ci + 2]);
  const cornerLuma = luma(cr, cg, cb);
  const leftMean = leftCount > 0 ? leftSum / leftCount : 0;
  const rightMean = rightCount > 0 ? rightSum / rightCount : 0;
  return {
    width,
    height,
    distinctColors: colors.size,
    lumaStd,
    centreLuma,
    cornerLuma,
    centreCornerDiff: Math.abs(centreLuma - cornerLuma),
    leftMeanLuma: leftMean,
    rightMeanLuma: rightMean,
    // With no lit pixels on the right, the ratio is only meaningful if the left has some.
    leftRightRatio: rightMean > 0 ? leftMean / rightMean : leftMean > 0 ? Infinity : 0,
    coverage: silhouette / n,
  };
}

/** Returns a list of human-readable failures (empty = the image passes). */
export function checkImageStats(m, t = THRESHOLDS) {
  const fails = [];
  if (!(m.distinctColors >= t.minDistinctColors)) {
    fails.push(`distinct colours ${m.distinctColors} < ${t.minDistinctColors}`);
  }
  if (!(m.lumaStd >= t.minLumaStd)) fails.push(`luma std ${m.lumaStd.toFixed(2)} < ${t.minLumaStd}`);
  if (!(m.centreCornerDiff >= t.minCentreCornerLuma)) {
    fails.push(`centre-vs-corner luma diff ${m.centreCornerDiff.toFixed(1)} < ${t.minCentreCornerLuma}`);
  }
  if (!(m.leftRightRatio >= t.minLeftRightRatio)) {
    fails.push(`left/right mean luma ratio ${m.leftRightRatio.toFixed(3)} < ${t.minLeftRightRatio}`);
  }
  if (!(m.coverage >= t.minCoverage && m.coverage <= t.maxCoverage)) {
    fails.push(`silhouette coverage ${(m.coverage * 100).toFixed(1)}% outside ${t.minCoverage * 100}-${t.maxCoverage * 100}%`);
  }
  return fails;
}

/** Console messages (type error/warning plus uncaught page errors) that are not on the exact allow-list. */
export function disallowedConsole(messages, allowed = ALLOWED_CONSOLE_WARNINGS) {
  return messages.filter((m) => !(m.type === 'warning' && allowed.includes(m.text)));
}

/** Full smoke assertion set for a shot result from takeShot(). Returns failures (empty = pass). */
export function checkShot(shot, thresholds = THRESHOLDS) {
  const fails = [];
  if (!shot.info.webgl2) fails.push('no WebGL2 context');
  if (!shot.info.renderer) fails.push('empty GL renderer string');
  for (const m of disallowedConsole(shot.consoleMessages)) fails.push(`console ${m.type}: ${m.text}`);
  fails.push(...checkImageStats(analyzeImage(shot.image, thresholds), thresholds));
  return fails;
}

/** Throws with every failure if the shot does not pass. */
export function assertShotOk(shot, thresholds = THRESHOLDS) {
  const fails = checkShot(shot, thresholds);
  if (fails.length > 0) throw new Error(`smoke shot failed:\n  - ${fails.join('\n  - ')}`);
}

// ---------------------------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------------------------

export async function launchBrowser(options = {}) {
  const executablePath = options.executablePath ?? resolveChromiumPath();
  const browser = await guard(
    chromium.launch({ executablePath, headless: true, args: [...CHROMIUM_ARGS] }),
    'chromium.launch',
  );
  return { browser, executablePath, version: browser.version() };
}

/** Opens `${baseUrl}/?${query}` in a fresh page, collecting console errors/warnings and page errors. */
export async function openPage(browser, baseUrl, query, viewport = { width: 960, height: 540 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(HANG_GUARD_MS);
  const consoleMessages = [];
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') consoleMessages.push({ type, text: msg.text() });
  });
  page.on('pageerror', (err) => consoleMessages.push({ type: 'error', text: `pageerror: ${err.message}` }));
  const t0 = performance.now();
  await guard(page.goto(`${baseUrl}/?${query}`, { waitUntil: 'load' }), 'page.goto');
  await guard(page.waitForFunction(() => window.__test !== undefined), 'wait for window.__test');
  return { page, consoleMessages, loadMs: performance.now() - t0 };
}

/** Renders once via window.__test.render() and captures a real page screenshot. */
export async function takeShot(browser, baseUrl, opts = {}) {
  const query = opts.query ?? 'test=1';
  const viewport = opts.viewport ?? { width: 960, height: 540 };
  const { page, consoleMessages, loadMs } = await openPage(browser, baseUrl, query, viewport);
  try {
    const t1 = performance.now();
    await guard(page.evaluate(() => window.__test.render()), 'window.__test.render()');
    const renderMs = performance.now() - t1;
    const t2 = performance.now();
    const png = await guard(page.screenshot({ type: 'png' }), 'page.screenshot');
    const screenshotMs = performance.now() - t2;
    const info = await guard(page.evaluate(() => window.__test.info()), 'window.__test.info()');
    // Console errors can arrive slightly after the evaluate; one tick is enough for the queued events.
    await new Promise((r) => setTimeout(r, 50));
    return { png, image: decodePng(png), info, consoleMessages, timings: { loadMs, renderMs, screenshotMs } };
  } finally {
    await page.close();
  }
}

/** Renders again on an already-open page and returns the PNG bytes (for byte-identity checks). */
export async function renderAndCapture(page) {
  await guard(page.evaluate(() => window.__test.render()), 'window.__test.render()');
  return guard(page.screenshot({ type: 'png' }), 'page.screenshot');
}

// ---------------------------------------------------------------------------------------------
// Goldens
// ---------------------------------------------------------------------------------------------

export const GOLDEN_MISSING_TEXT = 'kör UPDATE_GOLDENS=1 och committa e2e/goldens/*.png';

/**
 * Compares a PNG with e2e/goldens/<name>.png using pixelmatch (threshold 0.1) and a maximum fraction of
 * differing pixels (GOLDEN_MAX_DIFF, default 0.002 = 0.2 %).
 * UPDATE_GOLDENS=1 writes the golden. GOLDEN_COMPARE=warn logs mismatches and writes actual/diff without failing.
 */
export function compareGolden(actualPng, name, options = {}) {
  const env = options.env ?? process.env;
  const goldenDir = options.goldenDir ?? GOLDEN_DIR;
  const outDir = options.outDir ?? path.join(OUT_DIR, 'golden');
  const maxDiff = Number(env.GOLDEN_MAX_DIFF ?? '0.002');
  const warnOnly = env.GOLDEN_COMPARE === 'warn';
  const goldenPath = path.join(goldenDir, `${name}.png`);

  if (env.UPDATE_GOLDENS === '1') {
    fs.mkdirSync(goldenDir, { recursive: true });
    fs.writeFileSync(goldenPath, actualPng);
    console.log(`[golden] updated ${path.relative(REPO_ROOT, goldenPath)}`);
    return { status: 'updated', diffPixels: 0, ratio: 0 };
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${name}.actual.png`), actualPng);
  if (!fs.existsSync(goldenPath)) {
    const msg = `golden ${name}.png is missing: ${GOLDEN_MISSING_TEXT}`;
    if (warnOnly) {
      console.warn(`[golden] WARN ${msg}`);
      return { status: 'missing-warn', diffPixels: 0, ratio: 1 };
    }
    throw new Error(msg);
  }
  const golden = PNG.sync.read(fs.readFileSync(goldenPath));
  const actual = PNG.sync.read(actualPng);
  let ratio;
  let diffPixels;
  if (golden.width !== actual.width || golden.height !== actual.height) {
    ratio = 1;
    diffPixels = actual.width * actual.height;
  } else {
    const diff = new PNG({ width: actual.width, height: actual.height });
    diffPixels = pixelmatch(golden.data, actual.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
    ratio = diffPixels / (actual.width * actual.height);
    fs.writeFileSync(path.join(outDir, `${name}.diff.png`), PNG.sync.write(diff));
  }
  if (ratio <= maxDiff) return { status: 'match', diffPixels, ratio };
  const msg =
    `golden ${name}.png differs: ${diffPixels} px (${(ratio * 100).toFixed(3)} %) > ${(maxDiff * 100).toFixed(3)} % ` +
    `(see ${path.relative(REPO_ROOT, outDir)}/${name}.actual.png and .diff.png)`;
  if (warnOnly) {
    console.warn(`[golden] WARN ${msg}`);
    return { status: 'mismatch-warn', diffPixels, ratio };
  }
  throw new Error(msg);
}

// ---------------------------------------------------------------------------------------------
// Heap measurement
// ---------------------------------------------------------------------------------------------

async function collectGarbage(page) {
  await page.evaluate(() => {
    if (typeof window.gc !== 'function') throw new Error('window.gc missing: launch with --js-flags=--expose-gc');
    window.gc();
    window.gc();
  });
}

export function readUsedHeap(page) {
  return page.evaluate(() => performance.memory.usedJSHeapSize);
}

/**
 * Bytes of JS heap retained by `fn`: gc() before and after, median of 3 runs.
 * `fn` runs in Node and typically calls page.evaluate(...). Needs --enable-precise-memory-info (own switch).
 */
export async function heapDelta(page, fn) {
  const deltas = [];
  for (let i = 0; i < 3; i++) {
    await collectGarbage(page);
    const before = await readUsedHeap(page);
    await fn();
    await collectGarbage(page);
    const after = await readUsedHeap(page);
    deltas.push(after - before);
  }
  return median(deltas);
}

// ---------------------------------------------------------------------------------------------
// Vite
// ---------------------------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Starts a Vite dev server programmatically on a free port. */
export async function startViteServer() {
  const { createServer } = await import('vite');
  const port = await freePort();
  const server = await createServer({
    root: REPO_ROOT,
    logLevel: 'warn',
    clearScreen: false,
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  });
  await server.listen();
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

// ---------------------------------------------------------------------------------------------
// CLI: `npm run shots` takes the smoke shot, prints the metrics and exits non-zero on failure.
// ---------------------------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const outDir = path.join(OUT_DIR, 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  const query = argv[0] ?? 'test=1';
  const name = argv[1] ?? 'smoke';
  const vite = await startViteServer();
  const { browser, executablePath, version } = await launchBrowser();
  console.log(`[shot] chromium ${version} (${executablePath})`);
  try {
    const shot = await takeShot(browser, vite.url, { query });
    fs.writeFileSync(path.join(outDir, `${name}.png`), shot.png);
    const metrics = analyzeImage(shot.image);
    console.log(`[shot] renderer: ${shot.info.renderer}`);
    console.log(`[shot] ${shot.info.glVersion}, webgl2=${shot.info.webgl2}`);
    console.log(
      `[shot] first frame ${shot.info.firstFrameMs?.toFixed(0)} ms, load ${shot.timings.loadMs.toFixed(0)} ms, ` +
        `render ${shot.timings.renderMs.toFixed(0)} ms, screenshot ${shot.timings.screenshotMs.toFixed(0)} ms`,
    );
    console.log(`[shot] draw calls ${shot.info.drawCalls}, triangles ${shot.info.triangles}, textures ${shot.info.textures}`);
    console.log(`[shot] metrics ${JSON.stringify(metrics)}`);
    const fails = checkShot(shot);
    if (fails.length > 0) {
      console.error(`[shot] FAILED:\n  - ${fails.join('\n  - ')}`);
      process.exitCode = 1;
    } else {
      console.log(`[shot] OK -> ${path.relative(REPO_ROOT, path.join(outDir, `${name}.png`))}`);
    }
  } finally {
    await browser.close();
    await vite.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

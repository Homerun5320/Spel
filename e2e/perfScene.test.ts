// M08 item 5 in headless Chromium (software WebGL2): the performance scene. The shortened script (`?scene=perf` in test mode) runs to its end with
// a real draw in every frame, writes no console message, and its report validates against the schema with finite numbers. maxChunks >= 12 and
// maxTriangles >= 20 000 prove that the flight came down to the ground (the orbit view draws fewer). "Kopiera rapport" shows the same report as
// JSON that validates. The numbers are logged, never compared with wall time (the page runs on a software renderer).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { ZOOM_MIN_AGL_M } from '../src/render/config';
import { PERF_PHASE_NAMES } from '../src/app/perfScene';
import { PERF_REPORT_SCHEMA, validateJson } from '../src/ui/perfSchema';
import type { PerfReport } from '../src/ui/perfOverlay';

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

async function open(query: string): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, { width: 640, height: 360 });
  return { page, messages: consoleMessages };
}

/** Every number in a parsed JSON value is finite (JSON.stringify turns NaN and Infinity into null, which the schema would reject too). */
function allFinite(x: unknown): boolean {
  if (typeof x === 'number') return Number.isFinite(x);
  if (Array.isArray(x)) return x.every(allFinite);
  if (typeof x === 'object' && x !== null) return Object.values(x).every(allFinite);
  return true;
}

describe('the performance scene in test mode', () => {
  it('runs the shortened script to its end without a console message; the report validates, every number is finite, the flight came down (maxChunks >= 12, maxTriangles >= 20 000); "Kopiera rapport" shows the same report as JSON that validates', async () => {
    const { page, messages } = await open('test=1&ai=0&scene=perf&w=320&h=180');
    try {
      const t0 = Date.now();
      const report: PerfReport = await page.evaluate(() => {
        const t = (window as any).__test;
        t.runPerfScene({ dt: 0.34 });
        return JSON.parse(JSON.stringify(t.perfReport()));
      });
      const wallS = (Date.now() - t0) / 1000;
      expect(validateJson(PERF_REPORT_SCHEMA, report)).toEqual([]);
      expect(allFinite(report)).toBe(true);
      const s = report.scene;
      expect(s).toBeDefined();
      if (!s) return;
      console.log(
        `[perf-scene] test tier, 320x180, ${s.frames} frames in ${wallS.toFixed(1)} s wall: mean ${s.frameMs.mean} ms, p95 ${s.frameMs.p95} ms, max ${s.frameMs.max} ms; ` +
          `maxTriangles ${s.maxTriangles}, maxDrawCalls ${s.maxDrawCalls}, maxChunks ${s.maxChunks}, lowest ${s.minAglM} m; ` +
          s.phases.map((p) => `${p.name} ${p.frames} fr ${p.meanMs} ms ${p.maxTriangles} tri ${p.maxChunks} ch end ${p.endAglM} m`).join(' | '),
      );
      expect(s.completed).toBe(true);
      expect(s.quick).toBe(true);
      expect(s.phases.map((p) => p.name)).toEqual([...PERF_PHASE_NAMES]);
      for (const p of s.phases) expect(p.frames, p.name).toBeGreaterThan(0);
      expect(s.maxChunks).toBeGreaterThanOrEqual(12);
      expect(s.maxTriangles).toBeGreaterThanOrEqual(20_000);
      expect(s.maxDrawCalls).toBeGreaterThanOrEqual(1);
      // the camera never went under the clearance and the 300 m phase is at the floor
      expect(s.minAglM).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1);
      expect(s.phases[3]?.endAglM).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 1);
      expect(s.phases[3]?.endAglM).toBeLessThan(ZOOM_MIN_AGL_M + 60);
      // the orbit phase drew less than the 300 m phase
      expect(s.phases[3]?.maxTriangles).toBeGreaterThan(s.phases[0]?.maxTriangles ?? Infinity);
      // the extra fields of the user's feedback
      expect(s.canvas).toMatchObject({ cssWidth: 320, cssHeight: 180, pixelWidth: 320, pixelHeight: 180, dpr: 1 });
      expect(s.refresh.measured).toBe(false); // no rAF loop in test mode, so no probe
      expect(s.cappedHint.verdict).toBe('unknown');
      expect(s.cadence.counts.reduce((a: number, b: number) => a + b, 0)).toBe(s.frames);
      expect(report.renderer.length).toBeGreaterThan(0);
      expect(report.tier).toBe('test');
      expect(report.mode.scene).toBe('perf');

      // The overlay is on by itself in the performance scene; its button opens the report through showReport.
      await page.locator('[data-perf]').waitFor({ state: 'visible' });
      expect(await page.locator('[data-perf-copy]').innerText()).toBe('Kopiera rapport');
      const text = await page.locator('[data-perf] pre').innerText();
      expect(text).toContain('Prestandascen: KLAR');
      expect(text).toMatch(/scen: klar, \d+ ramar/);
      expect(text).toMatch(/max trianglar \d+ {2}anrop \d+ {2}chunks \d+/);
      await page.locator('[data-perf-copy]').click();
      const area = page.locator('[data-report] textarea');
      await area.waitFor({ state: 'visible' });
      const json = JSON.parse(await area.inputValue()) as PerfReport;
      expect(validateJson(PERF_REPORT_SCHEMA, json)).toEqual([]);
      expect(allFinite(json)).toBe(true);
      expect(json.scene?.completed).toBe(true);
      expect(json.scene?.canvas.pixelWidth).toBe(320);
      expect(json.scene?.frames).toBe(s.frames);
      expect(json.schemaVersion).toBe(1);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the LIVE page (no test mode) starts the script: it measures the display refresh with nothing drawn, then flies phase 1; a report copied mid-run validates and says completed false', async () => {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    const messages: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') messages.push(m.text());
    });
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${baseUrl}/#scene-perf`, { waitUntil: 'load' });
      const pre = page.locator('[data-perf] pre');
      await pre.waitFor({ state: 'visible', timeout: 60_000 });
      await page.waitForFunction(() => /fas 1 av 5 \(orbit\), [1-9]\d* ramar/.test(document.querySelector('[data-perf] pre')?.textContent ?? ''), undefined, { timeout: 90_000 });
      const text = await pre.innerText();
      expect(text).toContain('Rör inte musen');
      // The page runs at about one frame a second here and rewrites the overlay each frame, so Playwright's "stable" check of a click would wait for ever: the click is dispatched.
      await page.locator('[data-perf-copy]').dispatchEvent('click');
      const area = page.locator('[data-report] textarea');
      await area.waitFor({ state: 'visible' });
      const json = JSON.parse(await area.inputValue()) as PerfReport;
      expect(validateJson(PERF_REPORT_SCHEMA, json)).toEqual([]);
      expect(allFinite(json)).toBe(true);
      const s = json.scene;
      expect(s?.completed).toBe(false);
      expect(s?.quick).toBe(false);
      expect(s?.refresh.measured).toBe(true);
      expect(s?.refresh.samples).toBe(60);
      expect(s?.refresh.hz).toBeGreaterThan(10);
      expect(s?.canvas.cssWidth).toBe(320);
      expect(s?.canvas.devicePixelRatio).toBeGreaterThan(0);
      console.log(`[perf-scene] live page, 320x180: refresh ${s?.refresh.hz} Hz (${s?.refresh.medianIntervalMs} ms from ${s?.refresh.samples} probe frames), ${s?.frames} scene frames so far, verdict ${s?.cappedHint.verdict}, mode ${JSON.stringify(json.mode)}`);
      expect(json.mode.scene).toBe('perf');
      expect(json.mode.test).toBe('0');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the Dev panel lists "Prestandascen" and it writes #scene-perf', async () => {
    const { page, messages } = await open('test=1&ai=0&devbtn=1');
    try {
      await page.keyboard.press('F2');
      const entry = page.locator('[data-dev-mode="scene-perf"]');
      await entry.waitFor({ state: 'visible' });
      expect(await entry.innerText()).toContain('Prestandascen');
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), entry.click()]);
      expect(new URL(page.url()).hash).toBe('#scene-perf');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

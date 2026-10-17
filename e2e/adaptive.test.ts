// AutoTier-2 (D160) in headless Chromium: with the regulator on and a synthetic slow GPU (the test hook feeds frame times of a + b * scale^2 ms) the scale
// converges and holds; the DRAWING BUFFER follows the scale while the CSS size, the projection and the picking do not; off (`adapt=0` or no parameter in
// test mode) changes nothing; the report carries the `adaptive` field. Screenshots of the same view at 1.0, 0.72 and 0.5 go to
// test-results/shots/adaptive-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { PERF_REPORT_SCHEMA, validateJson } from '../src/ui/perfSchema';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const W = 640;
const H = 360;
const VIEW = { lat: 47, lon: 8, distKm: 2500, tilt: 35, heading: 20 };

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

const open = (query: string) => openPage(browser, baseUrl, `test=1&w=${W}&h=${H}&${query}`, { width: W, height: H });

describe('adaptive resolution on the page', () => {
  it('converges to a stable scale, the buffer follows it, the CSS size, projection and picking do not', async () => {
    const { page, consoleMessages } = await open('adapt=1');
    try {
      const out = await page.evaluate(
        ([view]) => {
          const t = (window as any).__test;
          t.setView(view);
          t.settle(0.1, 2);
          const probe = t.project(view.lat, view.lon);
          const before = { info: t.adaptive.info(), pick: t.pick(probe.x, probe.y), probe, css: document.querySelector('canvas')!.style.width };
          const a = t.adaptive.simulate(8, 60, 3000); // 8 + 60 s^2: the best scale of the ladder is 0.6
          t.settle(0.1, 2);
          const mid = { info: t.adaptive.info(), pick: t.pick(probe.x, probe.y), probe: t.project(view.lat, view.lon), css: document.querySelector('canvas')!.style.width };
          const b = t.adaptive.simulate(8, 60, 3000);
          return { before, a, mid, b, report: t.perfReport() };
        },
        [VIEW] as const,
      );
      expect(out.before.info.scale).toBe(1);
      expect(out.before.info.bufferWidth).toBe(W);
      expect(out.before.pick?.cell).toBeDefined();
      // converged
      expect(out.a.scale).toBe(0.6);
      expect(out.a.steps).toBeGreaterThanOrEqual(3);
      // and stable: three thousand more frames of the same load change nothing
      expect(out.b.steps).toBe(out.a.steps);
      expect(out.b.scale).toBe(0.6);
      // the drawing buffer follows the scale, the CSS size does not
      expect(out.mid.info.bufferWidth).toBe(Math.round(W * 0.6));
      expect(out.mid.info.bufferHeight).toBe(Math.round(H * 0.6));
      expect(out.mid.info.cssWidth).toBe(W);
      expect(out.mid.info.cssHeight).toBe(H);
      expect(out.mid.css).toBe(out.before.css);
      // projection and picking: the same cell under the same pixel before and after
      expect(out.mid.probe).toEqual(out.before.probe);
      expect(out.mid.pick?.cell).toEqual(out.before.pick?.cell);
      expect(out.mid.pick?.lat).toBeCloseTo(out.before.pick?.lat ?? 0, 9);
      // the report
      expect(validateJson(PERF_REPORT_SCHEMA, out.report)).toEqual([]);
      expect(out.report.adaptive).toMatchObject({ enabled: true, scale: 0.6 });
      expect(out.report.adaptive.scaleMin).toBe(0.6);
      expect(out.report.adaptive.scaleMean).toBeLessThan(1);
      expect(out.report.adaptive.steps).toBe(out.a.steps);
      expect(out.report.schemaVersion).toBe(1);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the same view at scale 1.0, 0.72 and 0.5 (screenshots to look at); a lighter load brings the scale back to 1', async () => {
    const { page, consoleMessages } = await open('adapt=1');
    try {
      const shot = async (name: string): Promise<void> => {
        await page.evaluate(() => (window as any).__test.settle(0.1, 2));
        fs.writeFileSync(path.join(SHOT_DIR, `adaptive-${name}.png`), await page.screenshot({ type: 'png' }));
      };
      await page.evaluate((v) => (window as any).__test.setView(v), VIEW);
      await shot('scale-1.00');
      const s72 = await page.evaluate(() => (window as any).__test.adaptive.simulate(5, 40, 2500)); // 5 + 40 s^2 < 30 at 0.72, over at 0.85
      expect(s72.scale).toBe(0.72);
      await shot('scale-0.72');
      const s50 = await page.evaluate(() => (window as any).__test.adaptive.simulate(8, 80, 3000)); // fits at 0.5 only
      expect(s50.scale).toBe(0.5);
      expect(s50.density).toBe(1);
      await shot('scale-0.50');
      const back = await page.evaluate(() => (window as any).__test.adaptive.simulate(4, 8, 8000));
      expect(back.scale).toBe(1);
      expect(back.bufferWidth).toBe(W);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a hopeless load takes the chunk density one step down after the smallest scale', async () => {
    const { page } = await open('adapt=1');
    try {
      const r = await page.evaluate(() => {
        const t = (window as any).__test;
        const before = t.chunkDensity();
        const info = t.adaptive.simulate(100, 0, 4000);
        return { before, info, after: t.chunkDensity() };
      });
      expect(r.before).toBe(1);
      expect(r.info.scale).toBe(0.5);
      expect(r.info.density).toBeLessThan(1);
      expect(r.after).toBe(r.info.density);
    } finally {
      await page.close();
    }
  });

  it('off changes nothing: no parameter and adapt=0 give the same picture and an untouched buffer', async () => {
    const pngs: Buffer[] = [];
    for (const q of ['', 'adapt=0']) {
      const { page } = await open(q);
      try {
        const r = await page.evaluate((v) => {
          const t = (window as any).__test;
          t.setView(v);
          const info = t.adaptive.simulate(8, 60, 3000);
          t.settle(0.1, 2);
          return { info, report: t.perfReport() };
        }, VIEW);
        expect(r.info.enabled).toBe(false);
        expect(r.info.scale).toBe(1);
        expect(r.info.steps).toBe(0);
        expect(r.info.bufferWidth).toBe(W);
        expect(r.report.adaptive).toMatchObject({ enabled: false, scale: 1, steps: 0 });
        pngs.push(await page.screenshot({ type: 'png' }));
      } finally {
        await page.close();
      }
    }
    expect(pngs[0]?.equals(pngs[1] as Buffer)).toBe(true);
  });
});

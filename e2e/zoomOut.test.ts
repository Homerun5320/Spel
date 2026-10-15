// CamFix (D158) in headless Chromium (software WebGL2): zoomed out as far as the camera goes, the whole globe is in the picture, centred, with room to spare, in a window of
// every shape (16:9, 21:9, 4:3, 9:16), whatever tilt and heading the camera came with, and also after real wheel events from a tilted view. The numbers of the maths are in
// tests/render/fit.test.ts and tests/render/fitCamera.test.ts; this file proves that the PAGE shows what the rig computes: the lit pixels of the real screenshot are counted and
// their bounding box is measured (the atmosphere's glow is part of it, so the margin asked of the picture is a little smaller than the disc's).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { CAMERA_FOV_DEG, FIT_FILL_SAFE } from '../src/render/config';
import { discFill, maxDistKm } from '../src/render/fit';

const SHOT_DIR = path.join(OUT_DIR, 'shots');
const baseUrl = inject('baseUrl');
let browser: Browser;

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

/** The windows: name, width, height. */
const WINDOWS: ReadonlyArray<readonly [string, number, number]> = [
  ['16x9', 960, 540],
  ['21x9', 1260, 540],
  ['4x3', 800, 600],
  ['9x16', 540, 960],
];

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  lit: number;
}

/**
 * The bounding box of the lit pixels of a screenshot (the globe and its glow; the stars are single dots, so a column or a row only counts when it has `MIN_RUN` lit pixels).
 * A pixel is lit when its brightest channel is above `LIT`.
 */
function litBox(png: Buffer): Box {
  const { width, height, data } = decodePng(png);
  const LIT = 14;
  const MIN_RUN = 8;
  const cols = new Uint32Array(width);
  const rows = new Uint32Array(height);
  let lit = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.max(data[i] as number, data[i + 1] as number, data[i + 2] as number) > LIT) {
        cols[x] = (cols[x] as number) + 1;
        rows[y] = (rows[y] as number) + 1;
        lit++;
      }
    }
  }
  let minX = 0;
  while (minX < width && (cols[minX] as number) < MIN_RUN) minX++;
  let maxX = width - 1;
  while (maxX > 0 && (cols[maxX] as number) < MIN_RUN) maxX--;
  let minY = 0;
  while (minY < height && (rows[minY] as number) < MIN_RUN) minY++;
  let maxY = height - 1;
  while (maxY > 0 && (rows[maxY] as number) < MIN_RUN) maxY--;
  return { minX, maxX, minY, maxY, width, height, lit };
}

/** Margins of the box as shares of the half-extent: left, right, top, bottom. */
function margins(b: Box): { left: number; right: number; top: number; bottom: number; min: number; dx: number; dy: number } {
  const hw = b.width / 2;
  const hh = b.height / 2;
  const left = b.minX / hw;
  const right = (b.width - 1 - b.maxX) / hw;
  const top = b.minY / hh;
  const bottom = (b.height - 1 - b.maxY) / hh;
  return { left, right, top, bottom, min: Math.min(left, right, top, bottom), dx: Math.abs((b.minX + b.maxX) / 2 - hw) / hw, dy: Math.abs((b.minY + b.maxY) / 2 - hh) / hh };
}

async function openWindow(width: number, height: number): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&ai=0&w=${width}&h=${height}`, { width, height });
  return { page, messages: consoleMessages };
}

async function shoot(page: Page, name: string): Promise<Buffer> {
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, `zoomout-${name}.png`), png);
  return png;
}

describe('zoomed out as far as it goes (the screenshot of the real page)', () => {
  for (const [name, width, height] of WINDOWS) {
    it(`${name} (${width}x${height}): tilts 0, 40 and 72 with headings 0, 200 and 90 at the maximum distance show the whole globe, centred, with room to spare`, async () => {
      const { page, messages } = await openWindow(width, height);
      try {
        const aspect = width / height;
        const narrowHalfPx = Math.min(width, height) / 2;
        for (const [tilt, heading] of [
          [0, 0],
          [40, 200],
          [72, 90],
        ] as const) {
          const v = await page.evaluate(
            (a) => {
              const t = (window as any).__test;
              t.setView({ lat: 20, lon: 10, distKm: 1e6, tilt: a.tilt, heading: a.heading });
              t.settle(1 / 60, 3);
              return { view: t.view(), shown: t.shownTilt(), max: t.maxDist() };
            },
            { tilt, heading },
          );
          const where = `${name} tilt ${tilt} heading ${heading}`;
          expect(v.view.distKm, where).toBeCloseTo(maxDistKm(aspect), 6);
          expect(v.max, where).toBeCloseTo(maxDistKm(aspect), 6);
          expect(v.shown, where).toBe(0);
          expect(v.view.tilt, where).toBe(tilt); // the user's tilt is kept
          const png = await shoot(page, `${name}-tilt${tilt}`);
          const b = litBox(png);
          expect(b.width, where).toBe(width);
          expect(b.height, where).toBe(height);
          const m = margins(b);
          // the disc has 5 % free; its glow reaches a little further than the disc: 3 % of the picture is what the lit pixels must leave
          expect(m.min, `${where}: free margins ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(0.03);
          expect(m.dx, where).toBeLessThan(0.03);
          expect(m.dy, where).toBeLessThan(0.03);
          // and it is as big as the maths says (the glow adds a little): the box is within 10 % of the disc of the maths in the narrow direction
          const expectedHalf = discFill(maxDistKm(aspect), aspect) * narrowHalfPx;
          const measuredHalf = (width < height ? b.maxX - b.minX : b.maxY - b.minY) / 2;
          expect(measuredHalf / expectedHalf, where).toBeGreaterThan(0.95);
          expect(measuredHalf / expectedHalf, where).toBeLessThan(1.12);
          expect(m.min).toBeGreaterThanOrEqual(1 - FIT_FILL_SAFE - 0.06); // 8 % free minus the glow, the same statement
        }
      } finally {
        await page.close();
      }
      expect(messages.filter((x) => x.type === 'error')).toEqual([]);
    });
  }

  it('the picture the user complained about is gone: the same view at 42 000 km and tilt 72 is clamped to the maximum of its window (16:9), no longer cut off at the bottom', async () => {
    const { page } = await openWindow(960, 540);
    try {
      await page.evaluate(() => {
        const t = (window as any).__test;
        t.setView({ lat: 20, lon: 10, distKm: 42_000, tilt: 72, heading: 0 });
        t.settle(1 / 60, 3);
      });
      const b = litBox(await shoot(page, '16x9-old-42000-tilt72'));
      const m = margins(b);
      expect(m.bottom).toBeGreaterThanOrEqual(0.03); // the old picture had the globe cut at the bottom edge (margin -0.3)
      expect(m.dy).toBeLessThan(0.03);
    } finally {
      await page.close();
    }
  });
});

describe('real wheel events from a tilted view (the page wiring: the stack, the zoom, the eased tilt)', () => {
  for (const [name, width, height] of WINDOWS.filter((w) => w[0] === '16x9' || w[0] === '9x16')) {
    it(`${name}: 8 big notches out from 3000 km and tilt 60 with the cursor in the middle: the whole globe, centred, the heading within a degree, the tilt kept; and 8 back give the tilt back`, async () => {
      const { page, messages } = await openWindow(width, height);
      try {
        await page.evaluate(() => {
          const t = (window as any).__test;
          t.setView({ lat: 46, lon: 10, distKm: 3000, tilt: 60, heading: 0 });
          t.settle(1 / 60, 10);
        });
        await page.mouse.move(width / 2, height / 2);
        for (let i = 0; i < 8; i++) {
          await page.mouse.wheel(0, 300);
          await page.evaluate(() => (window as any).__test.settle(1 / 60, 30));
        }
        await page.evaluate(() => (window as any).__test.settle(1 / 60, 120));
        const out = await page.evaluate(() => {
          const t = (window as any).__test;
          return { view: t.view(), shown: t.shownTilt(), max: t.maxDist() };
        });
        expect(out.view.distKm).toBeCloseTo(out.max, 6);
        expect(out.shown).toBe(0);
        expect(Math.abs(out.view.heading)).toBeLessThanOrEqual(1);
        expect(out.view.tilt).toBeCloseTo(60, 6);
        const b = litBox(await shoot(page, `${name}-wheel-out`));
        const m = margins(b);
        expect(m.min, JSON.stringify(m)).toBeGreaterThanOrEqual(0.03);
        expect(m.dx).toBeLessThan(0.03);
        expect(m.dy).toBeLessThan(0.03);
        for (let i = 0; i < 8; i++) {
          await page.mouse.wheel(0, -300);
          await page.evaluate(() => (window as any).__test.settle(1 / 60, 30));
        }
        await page.evaluate(() => (window as any).__test.settle(1 / 60, 120));
        const back = await page.evaluate(() => {
          const t = (window as any).__test;
          return { view: t.view(), shown: t.shownTilt() };
        });
        expect(back.view.distKm).toBeLessThan(5000);
        expect(Math.abs(back.shown - 60)).toBeLessThan(1);
        expect(Math.abs(back.view.tilt - 60)).toBeLessThan(1);
        expect(CAMERA_FOV_DEG).toBe(30);
      } finally {
        await page.close();
      }
      expect(messages.filter((x) => x.type === 'error')).toEqual([]);
    });
  }
});

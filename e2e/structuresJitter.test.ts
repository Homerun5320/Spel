// Fix-UI: the rule "Rules for layers on the terrain" of docs/ARCHITECTURE.md for the structure layer: a camera shift of 1e-7 degrees (about 1 cm) at a few
// hundred metres above a structure changes under 0.2 % of the pixels (the layer's float32 hi/lo placement must not swim), and the same view twice is
// byte-identical; a 1e-3 degree control shift changes far more, so the test can fail. Also: a FINISHED structure has no single-pixel holes (the construction
// stipple must not touch it). Real software WebGL2, HUD hidden. Screenshots go to test-results/shots/structures-jitter-*.png.
import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { cellToLatLon } from '../src/render/transforms';
import { STRUCT_CITY } from '../src/sim/structureRules';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const W = 960;
const H = 540;

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

type Png = ReturnType<typeof decodePng>;

async function cityPage(): Promise<{ page: Page; messages: Array<{ type: string; text: string }>; lat: number; lon: number }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: W, height: H });
  const call = <T>(fn: string, ...args: unknown[]): Promise<T> => page.evaluate(([f, a]) => (window as any).__test[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;
  await call('setView', { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
  const p = await call<{ x: number; y: number }>('project', 48.5, 11);
  await page.mouse.click(p.x, p.y);
  await call('advance', 0.1, 5);
  await call('give', 0, { gold: 6000 });
  await call('advance', 0.1, 4);
  await call('advance', 0.1, 210); // Fix-Sim: Build is refused in the 20 s spawn phase, so play past it
  const { capitals } = await call<{ capitals: number[] }>('seatCells');
  const at = cellToLatLon(capitals[0] as number, 1024, 512);
  await call('submit', { kind: 'Build', seat: 0, type: STRUCT_CITY, cell: capitals[0] });
  await call('advance', 0.1, 160); // past the City's build time (150)
  await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' });
  return { page, messages: consoleMessages, lat: at.lat, lon: at.lon };
}

async function shoot(page: Page, lat: number, lon: number, dLat = 0, aglM = 320, dKm = 0.7): Promise<{ png: Buffer; img: Png }> {
  await page.evaluate(
    ([la, lo, agl, d, time]) => {
      const t = (window as any).__test;
      t.setGroundView({ lat: la - d / 111.2, lon: lo, heading: 0, pitchDeg: 24, aglM: agl, time });
      t.settle(0, 2);
    },
    [lat + dLat, lon, aglM, dKm, timeForSubsolarLon(lon + 25)] as const,
  );
  const png = await page.screenshot({ type: 'png' });
  return { png, img: decodePng(png) };
}

const diffOf = (a: Png, b: Png): number => pixelmatch(a.data as Uint8Array, b.data as Uint8Array, undefined, W, H, { threshold: 0.1 });

describe('the structure layer on the terrain', () => {
  it('jitter: a camera shift of 1e-7 degrees changes under 0.2 % of the pixels with a City on screen; the same view twice is identical; a 1e-3 shift changes far more', async () => {
    const { page, messages, lat, lon } = await cityPage();
    try {
      const a = await shoot(page, lat, lon);
      const jit = await shoot(page, lat, lon, 1e-7);
      const same = await shoot(page, lat, lon);
      const far = await shoot(page, lat, lon, 1e-3);
      fs.writeFileSync(path.join(SHOT_DIR, 'structures-jitter-city.png'), a.png);
      expect(Buffer.compare(a.png, same.png)).toBe(0);
      const small = diffOf(a.img, jit.img);
      const big = diffOf(a.img, far.img);
      console.log(`[jitter] City on screen, 1e-7 degrees: ${small} of ${W * H} pixels (${((100 * small) / (W * H)).toFixed(4)} %), control 1e-3 degrees: ${big} (${((100 * big) / (W * H)).toFixed(2)} %)`);
      expect(small / (W * H)).toBeLessThan(0.002);
      expect(big / (W * H)).toBeGreaterThan(0.01);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a finished City has no isolated single-pixel holes (the construction stipple must leave finished models alone)', async () => {
    const { page, lat, lon } = await cityPage();
    try {
      const s = await shoot(page, lat, lon, 0, 220, 0.45);
      fs.writeFileSync(path.join(SHOT_DIR, 'structures-finished-closeup.png'), s.png);
      const d = s.img.data as Uint8Array;
      const at = (x: number, y: number, c: number): number => d[(y * W + x) * 4 + c] as number;
      const dist = (x0: number, y0: number, x1: number, y1: number): number => Math.abs(at(x0, y0, 0) - at(x1, y1, 0)) + Math.abs(at(x0, y0, 1) - at(x1, y1, 1)) + Math.abs(at(x0, y0, 2) - at(x1, y1, 2));
      // a pixel that differs strongly from all four neighbours while those four agree with each other
      let isolated = 0;
      for (let y = 100; y < H - 100; y++) {
        for (let x = 200; x < W - 200; x++) {
          const n = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ] as const;
          let calm = true;
          let strong = true;
          for (const [nx, ny] of n) {
            if (dist(nx, ny, n[0][0], n[0][1]) > 60) calm = false;
            if (dist(x, y, nx, ny) < 150) strong = false;
          }
          if (calm && strong) isolated++;
        }
      }
      console.log(`[speckle] isolated pixels around a finished City: ${isolated}`);
      expect(isolated).toBeLessThan(5);
    } finally {
      await page.close();
    }
  });
});

// M08 part A in headless Chromium (software WebGL2): the RTS camera and the ground queries on the real page. The unit tests
// (tests/render/transforms.test.ts, rtsCamera.test.ts, flyToGround.test.ts, tests/app/input.test.ts) hold the numbers; this file proves that the
// page wires them: `groundHeightAt` is the GLSL height within 1 % of the relief, the mouse (real events) grips the ground and zooms to 300 m, a
// bookmark flight arrives, the Dev panel has the bookmarks, F and Escape are bound as the contract says, and nothing writes a console message.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { DETAIL_RELIEF_FLOOR_M, ZOOM_MIN_AGL_M } from '../src/render/config';
import { HeightSampler, octavesForLevel } from '../src/render/detail';
import { BOOKMARKS } from '../src/render/views';
import { rng } from '../tests/helpers/chunkWorld';
import { worldLoader } from '../tests/helpers/dataFiles';

const SHOT_DIR = path.join(OUT_DIR, 'shots');
let browser: Browser;
let sampler: HeightSampler;
let codes: Uint8Array;
let width = 0;
let height = 0;
let maxM = 0;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const w = worldLoader();
  const [render, meta] = await Promise.all([w.loadRender(), w.loadMeta()]);
  codes = render.height8;
  width = render.width;
  height = render.height;
  maxM = meta.encoding.heightSqrt.maxM;
  sampler = new HeightSampler({ codes, width, height, maxM });
});
afterAll(async () => {
  await browser?.close();
});

async function open(query = 'test=1&ai=0', viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  return { page, messages: consoleMessages };
}

/** The local relief at a position, written independently of the sampler (as in e2e/detail.test.ts). */
function localRelief(lat: number, lon: number): number {
  const tx = ((lon + 180) / 360) * width - 0.5;
  const ty = ((90 - lat) / 180) * height - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const dec = (c: number): number => maxM * (c / 255) ** 2;
  const at = (x: number, y: number): number => codes[Math.min(height - 1, Math.max(0, y)) * width + (((x % width) + width) % width)] as number;
  let relief = 0;
  for (let b = 0; b < 2; b++) {
    for (let a = 0; a < 2; a++) {
      let lo = 255;
      let hi = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const c = at(x0 + a + i, y0 + b + j);
          lo = Math.min(lo, c);
          hi = Math.max(hi, c);
        }
      }
      relief += Math.max(DETAIL_RELIEF_FLOOR_M, dec(hi) - dec(lo)) * ((a === 0 ? 1 - fx : fx) * (b === 0 ? 1 - fy : fy));
    }
  }
  return relief;
}

describe('groundHeightAt on the page', () => {
  it('is the very `heightAt` (same numbers to the bit) and matches the height the chunk vertex shader draws within 1 % of the local relief (the M07b readback probe), 600 points over the Himalaya, the Alps and a coast', async () => {
    const { page, messages } = await open();
    try {
      const r = rng(808);
      const regions: Array<[number, number, number, number]> = [
        [27, 30, 84, 90],
        [45, 47.5, 6, 13],
        [59.5, 63, 3.5, 7.5],
      ];
      const pts: Array<[number, number, number]> = [];
      for (let i = 0; i < 600; i++) {
        const g = regions[i % regions.length] as [number, number, number, number];
        pts.push([Math.fround(g[0] + (g[1] - g[0]) * r()), Math.fround(g[2] + (g[3] - g[2]) * r()), octavesForLevel(17)]);
      }
      const gpu: number[] = await page.evaluate((it) => (window as any).__test.probeHeight(it), pts);
      const ground: number[] = await page.evaluate((it) => it.map((p: number[]) => (window as any).__test.groundHeightAt(p[0], p[1], p[2])), pts);
      const same: number[] = await page.evaluate((it) => it.map((p: number[]) => (window as any).__test.heightAt(p[0], p[1], p[2])), pts);
      expect(ground).toEqual(same);
      let worst = 0;
      let land = 0;
      pts.forEach((p, i) => {
        // Node and Chromium are two builds of V8 with their own sin and cos: the same function to a few units in the 13th digit
        expect(Math.abs((ground[i] as number) - sampler.heightAt(p[0], p[1], p[2])), `${p[0]}, ${p[1]} against the Node sampler`).toBeLessThan(1e-6);
        const share = Math.abs((ground[i] as number) - (gpu[i] as number)) / localRelief(p[0], p[1]);
        worst = Math.max(worst, share);
        if ((gpu[i] as number) > 0) land++;
      });
      console.log(`[rts] groundHeightAt against the GLSL height, 600 points (${land} land): at most ${(100 * worst).toFixed(4)} % of the local relief`);
      expect(land).toBeGreaterThan(300);
      expect(worst).toBeLessThan(0.01);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('pickGround is the surface pick: its radius equals pickSurface within a nanometre of an Earth radius, and its seen height is that radius minus one in render metres', async () => {
    const { page, messages } = await open();
    try {
      await page.evaluate(() => {
        const t = (window as any).__test;
        t.setView({ lat: 28.2, lon: 86.8, heading: 0, tilt: 60, altAglM: 20_000 });
        t.render();
      });
      for (const [x, y] of [
        [480, 270],
        [200, 400],
        [760, 160],
        [480, 500],
      ] as const) {
        const g = await page.evaluate(([px, py]) => (window as any).__test.pickGround(px, py), [x, y] as const);
        const s = await page.evaluate(([px, py]) => (window as any).__test.pickSurface(px, py), [x, y] as const);
        expect(g, `${x}, ${y}`).not.toBeNull();
        expect(g.radius).toBeCloseTo(s.radius, 12);
        expect(g.lat).toBeCloseTo(s.lat, 9);
        expect(g.seenHeightM).toBeCloseTo(((g.radius - 1) * 6_371_000) / 12, 6);
        expect(g.seenHeightM).toBeGreaterThan(1000); // the Himalaya
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the mouse on the RTS camera', () => {
  it('wheel all the way in stops 300 m above the ground over the open sea and over the Himalaya (real wheel events), and out again reaches the limit', async () => {
    for (const [lat, lon, what] of [
      [0, -150, 'open sea'],
      [28.2, 86.8, 'the Himalaya'],
    ] as const) {
      const { page, messages } = await open();
      try {
        await page.evaluate(([la, lo]) => (window as any).__test.setView({ lat: la, lon: lo, distKm: 4000, heading: 0, tilt: 30 }), [lat, lon] as const);
        await page.mouse.move(520, 280);
        for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -1500);
        await page.evaluate(() => (window as any).__test.settle(0.5, 60));
        const agl = await page.evaluate(() => (window as any).__test.cameraAglM());
        const tilt = await page.evaluate(() => (window as any).__test.view().tilt);
        console.log(`[rts] ${what}: wheel all the way in rests ${agl.toFixed(1)} m above the ground, tilt ${tilt.toFixed(1)} (at the sea-level focus)`);
        expect(agl, what).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.5);
        expect(agl, what).toBeLessThan(2 * ZOOM_MIN_AGL_M);
        expect(await page.evaluate(() => (window as any).__test.cameraMix())).toBe(1);
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    }
  });

  it('a left drag in an RTS view keeps the ground point under the cursor (real mouse events): the pick under the cursor after the drag is the pick under it before', async () => {
    const { page, messages } = await open();
    try {
      await page.evaluate(() => {
        const t = (window as any).__test;
        t.setView({ lat: 46.5, lon: 8, heading: 20, tilt: 55, altAglM: 20_000 });
        t.render();
      });
      const before = await page.evaluate(() => (window as any).__test.pickGround(500, 330));
      await page.mouse.move(500, 330);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(500 + i * 15, 330 - i * 10);
        await page.evaluate(() => (window as any).__test.advance(1 / 60));
      }
      await page.evaluate(() => (window as any).__test.advance(0.3)); // a pause before the release: no fling
      await page.mouse.up();
      // (no frame between the release and the pick: from the next frame on the camera eases back to the height it had, which moves the view)
      const after = await page.evaluate(() => (window as any).__test.pickGround(680, 210));
      expect(after).not.toBeNull();
      // 1 px is about 15 m here (0.00014 degrees): the same ground point within two pixels
      expect(Math.abs(after.lat - before.lat)).toBeLessThan(3e-4);
      expect(Math.abs(after.lon - before.lon)).toBeLessThan(3e-4);
      const v = await page.evaluate(() => (window as any).__test.view());
      expect(Math.abs(v.lat - 46.5) + Math.abs(v.lon - 8)).toBeGreaterThan(0.01); // it did move
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a right click without a drag changes nothing in the camera and leaves no message (the context command is a no-op until M20a)', async () => {
    const { page, messages } = await open();
    try {
      await page.evaluate(() => {
        const t = (window as any).__test;
        t.setView({ lat: 46.5, lon: 8, heading: 20, tilt: 55, altAglM: 20_000 });
        t.render();
      });
      const a = await page.evaluate(() => (window as any).__test.view());
      await page.mouse.move(480, 300);
      await page.mouse.down({ button: 'right' });
      await page.mouse.up({ button: 'right' });
      await page.evaluate(() => (window as any).__test.settle(1 / 60, 3));
      expect(await page.evaluate(() => (window as any).__test.view())).toEqual(a);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('bookmarks, F and Escape', () => {
  it('a bookmark flight on the fx clock arrives at its height over the ground, never lower than 300 m on the way (checked at ten times), and is cancelled by a grab', async () => {
    const { page, messages } = await open();
    try {
      for (const name of ['himalaya', 'alps', 'andes'] as const) {
        await page.evaluate(() => (window as any).__test.setView({ lat: 10, lon: 20, distKm: 21500, heading: 0, tilt: 0 }));
        expect(await page.evaluate((n) => (window as any).__test.bookmark(n), name)).toBe(true);
        expect(await page.evaluate(() => (window as any).__test.flightActive())).toBe(true);
        let worst = Infinity;
        for (let i = 0; i < 10; i++) {
          await page.evaluate(() => (window as any).__test.settle(1 / 30, 50)); // 50 frames of 1/30 s, one draw
          if (await page.evaluate(() => (window as any).__test.flightActive())) worst = Math.min(worst, await page.evaluate(() => (window as any).__test.cameraAglM()));
        }
        for (let i = 0; i < 30 && (await page.evaluate(() => (window as any).__test.flightActive())); i++) await page.evaluate(() => (window as any).__test.settle(1 / 30, 30));
        expect(await page.evaluate(() => (window as any).__test.flightActive()), `${name} arrived`).toBe(false);
        const agl = await page.evaluate(() => (window as any).__test.cameraAglM());
        expect(agl).toBeCloseTo(BOOKMARKS[name].altAglM, 0);
        expect(worst).toBeGreaterThanOrEqual(ZOOM_MIN_AGL_M - 0.5);
        expect(await page.evaluate(() => (window as any).__test.holdAgl())).toBeCloseTo(BOOKMARKS[name].altAglM, 0);
      }
      // a grab ends a flight where it is
      await page.evaluate(() => {
        const t = (window as any).__test;
        t.setView({ lat: 10, lon: 20, distKm: 21500, heading: 0, tilt: 0 });
        t.bookmark('himalaya');
        t.settle(1 / 30, 60);
      });
      await page.mouse.move(480, 270);
      await page.mouse.down();
      await page.mouse.up();
      expect(await page.evaluate(() => (window as any).__test.flightActive())).toBe(false);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the capital bookmark and F need a spawned capital; after the spawn F flies to it (and Escape, with nothing on the stack, is the no-op pause handler)', async () => {
    const { page, messages } = await open();
    try {
      expect(await page.evaluate(() => (window as any).__test.bookmark('capital'))).toBe(false); // not spawned yet
      await page.keyboard.press('f');
      expect(await page.evaluate(() => (window as any).__test.flightActive())).toBe(false);
      // spawn in Sweden
      await page.evaluate(() => {
        const t = (window as any).__test;
        t.setView({ lat: 62, lon: 15, distKm: 1500, heading: 0, tilt: 0 });
        t.render();
      });
      const p = await page.evaluate(() => (window as any).__test.pick(480, 270));
      await page.evaluate((cell) => (window as any).__test.submit({ kind: 'Spawn', seat: 0, cell }), p.cell.index);
      await page.evaluate(() => (window as any).__test.advance(0.5, 5));
      expect((await page.evaluate(() => (window as any).__test.state())).local.spawned).toBe(true);
      await page.evaluate(() => (window as any).__test.setView({ lat: 0, lon: 0, distKm: 20000, heading: 0, tilt: 0 }));
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => (window as any).__test.flightActive())).toBe(false);
      await page.keyboard.press('f');
      expect(await page.evaluate(() => (window as any).__test.flightActive())).toBe(true);
      for (let i = 0; i < 30 && (await page.evaluate(() => (window as any).__test.flightActive())); i++) await page.evaluate(() => (window as any).__test.settle(1 / 30, 30));
      expect(await page.evaluate(() => (window as any).__test.flightActive())).toBe(false);
      const agl = await page.evaluate(() => (window as any).__test.cameraAglM());
      expect(agl).toBeCloseTo(450_000, -2);
      const c = await page.evaluate(() => (window as any).__test.pickGround(480, 270));
      expect(Math.abs(c.lat - 62)).toBeLessThan(6); // the capital (197 cells around the spawn) is what the middle of the screen shows
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the Dev panel lists the four bookmarks; a click flies there and closes the panel', async () => {
    const { page, messages } = await open('test=1&ai=0&devbtn=1');
    try {
      await page.keyboard.press('F2');
      for (const id of ['alps', 'himalaya', 'andes', 'capital']) expect(await page.locator(`[data-dev-mode="bookmark-${id}"]`).count(), id).toBe(1);
      await page.locator('[data-dev-mode="bookmark-himalaya"]').click();
      expect(await page.evaluate(() => (window as any).__test.flightActive())).toBe(true);
      expect(await page.locator('[data-dev-panel="1"]').isHidden()).toBe(true);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

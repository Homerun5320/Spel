// M02 Checkpoint A: the stylised Earth in headless Chromium (software WebGL2): test-tier budgets, data textures,
// the six canonical views (no goldens yet), picking, the camera by mouse, the tooltip and the fx clock.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, analyzeImage, decodePng, launchBrowser, luma, openPage } from '../scripts/shot.mjs';
import { DIST_MAX_KM, DIST_MIN_KM, TILT_MAX_DEG } from '../src/render/config';
import { latLonToCell } from '../src/render/geo';
import { CANONICAL_VIEWS } from '../src/render/views';
import { worldLoader } from '../tests/helpers/dataFiles';

type Hooks = {
  render(dt?: number): void;
  info(): Record<string, any>;
  setView(v: Record<string, number>): void;
  project(lat: number, lon: number): { x: number; y: number; inView: boolean; facing: boolean };
  advance(dt: number): void;
  pick(x: number, y: number): { lat: number; lon: number; cell: { x: number; y: number; index: number }; classId: number; countryId: number; elevationM: number } | null;
  readTexels(name: string, points: Array<[number, number]>): number[];
  setExaggeration(x: number): void;
  view(): { lat: number; lon: number; distKm: number; heading: number; tilt: number };
  tooltip(x: number, y: number): string | null;
};

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

async function openGlobe(query = 'test=1', viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  return { page, messages: consoleMessages };
}

async function frame(page: Page, view: Record<string, number>, name?: string): Promise<Buffer> {
  await page.evaluate((v) => {
    (window as any).__test.setView(v);
    (window as any).__test.render();
  }, view);
  const png = await page.screenshot({ type: 'png' });
  if (name) fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), png);
  return png;
}

const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

describe('globe scene: test tier budget', () => {
  it('renders in the test tier with <= 150k triangles and <= 30 draw calls, WebGL2, zero console errors', async () => {
    const { page, messages } = await openGlobe('test=1&quality=high');
    try {
      await page.evaluate(() => (window as any).__test.render());
      const info = await page.evaluate(() => (window as any).__test.info());
      console.log(
        `[globe] renderer ${info.renderer}; tier ${info.tier} ${info.meshCols}x${info.meshRows}; first frame ${Number(info.firstFrameMs).toFixed(0)} ms (logged, not asserted); ` +
          `calls ${info.drawCalls} triangles ${info.triangles} textures ${info.textures} texture MB ${info.textureMB.toFixed(1)}`,
      );
      expect(info.webgl2).toBe(true);
      expect(info.tier).toBe('test'); // ?test=1 forces the test tier whatever ?quality= says
      expect([info.meshCols, info.meshRows]).toEqual([256, 128]);
      expect(info.triangles).toBeLessThanOrEqual(150_000);
      // Since checkpoint B the scene is 3 draw calls: stars (points, no triangles), the globe mesh and the 96x48 atmosphere shell.
      expect(info.triangles).toBe(2 * 256 * 128 + 9024); // 9024 = the 96x48 sphere of the shell
      expect(info.drawCalls).toBe(3);
      expect(info.drawCalls).toBeLessThanOrEqual(30);
      expect([info.width, info.height, info.dpr]).toEqual([960, 540, 1]);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('globe scene: data textures', () => {
  it('texel readback (render-to-target pass) equals the source bytes of every texture', async () => {
    const world = worldLoader();
    const [render, sim] = await Promise.all([world.loadRender(), world.loadSim()]);
    const sources: Record<string, { data: Uint8Array; w: number; h: number }> = {
      height: { data: render.height8, w: 4096, h: 2048 },
      bathy: { data: render.bathy8, w: 2048, h: 1024 },
      country: { data: render.country8, w: 4096, h: 2048 },
      terrainClass: { data: sim.terrainClass, w: 1024, h: 512 },
    };
    const { page, messages } = await openGlobe();
    try {
      for (const [name, s] of Object.entries(sources)) {
        // corners, edges, the antimeridian columns and 300 deterministic scattered texels
        const pts: Array<[number, number]> = [[0, 0], [s.w - 1, 0], [0, s.h - 1], [s.w - 1, s.h - 1], [s.w >> 1, s.h >> 1], [0, s.h >> 1], [s.w - 1, s.h >> 1]];
        let seed = 12345;
        for (let i = 0; i < 300; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const x = seed % s.w;
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          pts.push([x, seed % s.h]);
        }
        const got = await page.evaluate(([n, p]) => (window as any).__test.readTexels(n as string, p as Array<[number, number]>), [name, pts] as const);
        const want = pts.map(([x, y]) => s.data[y * s.w + x] as number);
        expect(got.length).toBe(want.length);
        expect(got, name).toEqual(want);
        // not a trivial test: the sample holds more than one value
        expect(new Set(want).size, name).toBeGreaterThan(2);
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('globe scene: the six canonical views (contact sheet, goldens come in the last step)', () => {
  it('are not blank, pairwise different, Himalaya relief adds luminance variance over a flat control', async () => {
    const { page, messages } = await openGlobe();
    try {
      const images: Record<string, ReturnType<typeof decodePng>> = {};
      const hashes: Record<string, string> = {};
      for (const v of CANONICAL_VIEWS) {
        const { id, time, ...view } = v;
        const png = await frame(page, { ...view, time }, `view-${id}`);
        const img = decodePng(png);
        const m = analyzeImage(img);
        console.log(`[views] ${id}: colours ${m.distinctColors}, luma std ${m.lumaStd.toFixed(1)}`);
        expect(m.distinctColors, id).toBeGreaterThanOrEqual(200);
        expect(m.lumaStd, id).toBeGreaterThanOrEqual(5);
        images[id] = img;
        hashes[id] = sha(png);
      }
      expect(new Set(Object.values(hashes)).size).toBe(CANONICAL_VIEWS.length);
      // pairwise different by more than a few pixels: mean absolute luma difference
      const ids = CANONICAL_VIEWS.map((v) => v.id);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = images[ids[i] as string] as ReturnType<typeof decodePng>;
          const b = images[ids[j] as string] as ReturnType<typeof decodePng>;
          let d = 0;
          for (let k = 0; k < a.data.length; k += 4) d += Math.abs(luma(a.data[k] as number, a.data[k + 1] as number, a.data[k + 2] as number) - luma(b.data[k] as number, b.data[k + 1] as number, b.data[k + 2] as number));
          expect(d / (a.width * a.height), `${ids[i]} vs ${ids[j]}`).toBeGreaterThan(2);
        }
      }

      // Relief control: the same Himalaya view with the exaggeration set to 0 (flat sphere, same colours and sun).
      const himalaya = CANONICAL_VIEWS.find((v) => v.id === 'himalaya');
      const { id: _id, time, ...view } = himalaya as (typeof CANONICAL_VIEWS)[number];
      const renderWith = async (exag: number): Promise<ReturnType<typeof decodePng>> => {
        await page.evaluate(([e]) => (window as any).__test.setExaggeration(e as number), [exag] as const);
        return decodePng(await frame(page, { ...view, time }));
      };
      const relief = await renderWith(12);
      const flat = await renderWith(0);
      const flatAgain = await renderWith(0);
      fs.writeFileSync(path.join(SHOT_DIR, 'view-himalaya-flat.png'), await page.screenshot({ type: 'png' }));
      const regionVariance = (a: typeof relief, b: typeof relief): number => {
        let s = 0;
        let s2 = 0;
        let n = 0;
        for (let y = 100; y < 440; y++) {
          for (let x = 100; x < 860; x++) {
            const i = (y * a.width + x) * 4;
            const d = luma(a.data[i] as number, a.data[i + 1] as number, a.data[i + 2] as number) - luma(b.data[i] as number, b.data[i + 1] as number, b.data[i + 2] as number);
            s += d;
            s2 += d * d;
            n++;
          }
        }
        return s2 / n - (s / n) * (s / n);
      };
      const reliefVar = regionVariance(relief, flat);
      const controlVar = regionVariance(flat, flatAgain);
      console.log(`[views] Himalaya luma variance of (relief - flat control) ${reliefVar.toFixed(1)}; flat control against itself ${controlVar.toFixed(1)}`);
      expect(controlVar).toBe(0);
      expect(reliefVar).toBeGreaterThan(300);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('globe scene: picking', () => {
  it('a camera centred on 59.3N 18.1E shows Sweden in the middle; a pick at Everest gives the right cell within 1 cell', async () => {
    const meta = await worldLoader().loadMeta();
    const swe = meta.countries.find((c) => c.a3 === 'SWE');
    const { page, messages } = await openGlobe();
    try {
      await frame(page, { lat: 59.3, lon: 18.1, distKm: 2500, heading: 0, tilt: 0 }, 'pick-sweden');
      const mid = await page.evaluate(() => (window as any).__test.pick(480, 270));
      expect(mid).not.toBeNull();
      expect(mid?.countryId).toBe(swe?.id);
      expect(await page.evaluate(() => (window as any).__test.tooltip(480, 270))).toMatch(/^Sverige · /);
      const sc = latLonToCell(59.3, 18.1);
      expect(Math.abs((mid?.cell.x as number) - sc.x)).toBeLessThanOrEqual(1);
      expect(Math.abs((mid?.cell.y as number) - sc.y)).toBeLessThanOrEqual(1);

      const want = latLonToCell(27.99, 86.93);
      expect(want).toMatchObject({ x: 759, y: 176 });
      for (const v of [
        { lat: 24, lon: 88, distKm: 1500, heading: 0, tilt: 50 },
        { lat: 31, lon: 80, distKm: 900, heading: 120, tilt: 60 },
      ]) {
        await frame(page, v);
        const p = await page.evaluate(() => (window as any).__test.project(27.99, 86.93));
        expect(p.inView && p.facing).toBe(true);
        const hit = await page.evaluate(([x, y]) => (window as any).__test.pick(x as number, y as number), [p.x, p.y] as const);
        expect(hit, JSON.stringify(v)).not.toBeNull();
        expect(Math.abs((hit?.cell.x as number) - want.x)).toBeLessThanOrEqual(1);
        expect(Math.abs((hit?.cell.y as number) - want.y)).toBeLessThanOrEqual(1);
        expect(hit?.elevationM).toBeGreaterThan(5000);
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the pixel of a projected city shows land or sea as the data says (project matches what is drawn)', async () => {
    const { page } = await openGlobe();
    try {
      // Stockholm is land, the Atlantic point is sea; the tooltip comes from the pick under the projected pixel.
      await frame(page, { lat: 45, lon: 10, distKm: 7000, heading: 0, tilt: 0 });
      const land = await page.evaluate(() => {
        const p = (window as any).__test.project(59.33, 18.07);
        return (window as any).__test.tooltip(p.x, p.y);
      });
      const sea = await page.evaluate(() => {
        const p = (window as any).__test.project(40, -20);
        return (window as any).__test.tooltip(p.x, p.y);
      });
      expect(land).toMatch(/^Sverige/);
      expect(sea).toMatch(/^Hav/);
    } finally {
      await page.close();
    }
  });
});

describe('globe scene: camera by mouse', () => {
  it('wheel zoom is anchored at the cursor and the zoom limits hold', async () => {
    const { page, messages } = await openGlobe();
    try {
      await frame(page, { lat: 59.3, lon: 18.1, distKm: 6000, heading: 0, tilt: 0 });
      const cx = 700;
      const cy = 300;
      const before = await page.evaluate(([x, y]) => (window as any).__test.pick(x as number, y as number), [cx, cy] as const);
      expect(before).not.toBeNull();
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -700);
      await page.evaluate(() => {
        for (let i = 0; i < 30; i++) (window as any).__test.render(0.1);
      });
      const after = await page.evaluate(([x, y]) => (window as any).__test.pick(x as number, y as number), [cx, cy] as const);
      const view = await page.evaluate(() => (window as any).__test.view());
      expect(view.distKm).toBeLessThan(6000);
      expect(after).not.toBeNull();
      expect(Math.abs((after?.lat as number) - (before?.lat as number))).toBeLessThan(0.15);
      expect(Math.abs((after?.lon as number) - (before?.lon as number))).toBeLessThan(0.3);

      // limits
      for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -3000);
      await page.evaluate(() => {
        for (let i = 0; i < 40; i++) (window as any).__test.render(0.5);
      });
      expect((await page.evaluate(() => (window as any).__test.view())).distKm).toBe(DIST_MIN_KM);
      for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 3000);
      await page.evaluate(() => {
        for (let i = 0; i < 80; i++) (window as any).__test.render(0.5);
      });
      expect((await page.evaluate(() => (window as any).__test.view())).distKm).toBe(DIST_MAX_KM);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('dragging grabs the globe; right-drag turns the heading and clamps the tilt', async () => {
    const { page, messages } = await openGlobe();
    try {
      await frame(page, { lat: 20, lon: 0, distKm: 9000, heading: 0, tilt: 0 });
      const grabbed = await page.evaluate(() => (window as any).__test.pick(480, 270));
      await page.mouse.move(480, 270);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(480 + i * 15, 270 - i * 3);
      await page.waitForTimeout(150); // a pause before the release: no fling
      await page.mouse.up();
      await page.evaluate(() => (window as any).__test.render());
      const under = await page.evaluate(() => (window as any).__test.pick(600, 246));
      expect(under).not.toBeNull();
      expect(Math.abs((under?.lat as number) - (grabbed?.lat as number))).toBeLessThan(2.5);
      expect(Math.abs((under?.lon as number) - (grabbed?.lon as number))).toBeLessThan(2.5);

      await page.mouse.move(480, 270);
      await page.mouse.down({ button: 'right' });
      for (let i = 1; i <= 10; i++) await page.mouse.move(480 + i * 20, 270 + i * 40);
      await page.mouse.up({ button: 'right' });
      const v = await page.evaluate(() => (window as any).__test.view());
      expect(v.heading).not.toBe(0);
      expect(v.tilt).toBe(TILT_MAX_DEG);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('is stable at both poles for every heading and tilt (rendered, not blank, no console errors)', async () => {
    const { page, messages } = await openGlobe();
    try {
      for (const lat of [90, -90]) {
        for (const [heading, tilt] of [[0, 0], [90, 40], [180, 72], [-135, 20]] as const) {
          const png = await frame(page, { lat, lon: 0, distKm: 3000, heading, tilt });
          const m = analyzeImage(decodePng(png));
          expect(m.distinctColors, `${lat} ${heading} ${tilt}`).toBeGreaterThan(50);
          const v = await page.evaluate(() => (window as any).__test.view());
          expect(Object.values(v).every((x) => Number.isFinite(x))).toBe(true);
        }
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('hovering shows the tooltip with country, class and height; moving off the globe hides it', async () => {
    const { page, messages } = await openGlobe();
    try {
      await frame(page, { lat: 59.3, lon: 18.1, distKm: 2500, heading: 0, tilt: 0 });
      await page.mouse.move(480, 270);
      await page.mouse.move(481, 271);
      const tip = page.getByText(/^Sverige · /);
      await tip.waitFor({ state: 'visible' });
      expect(await tip.innerText()).toMatch(/^Sverige · (Skog|Slätt|Kullar) · -?[\d ]+ m$/);
      await page.mouse.move(5, 5);
      await page.mouse.move(6, 6);
      expect(await tip.isVisible()).toBe(false);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('globe scene: the fx clock', () => {
  it('is frozen in test mode: no rAF loop, no drift; only render(dt), advance(dt) and setView({time}) step it', async () => {
    const { page, messages } = await openGlobe();
    try {
      await page.evaluate(() => (window as any).__test.render());
      const a = await page.screenshot({ type: 'png' });
      const f0 = await page.evaluate(() => (window as any).__test.info().frames);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => (window as any).__test.info().frames)).toBe(f0); // nothing rendered by itself
      await page.evaluate(() => (window as any).__test.render());
      const b = await page.screenshot({ type: 'png' });
      expect(Buffer.compare(a, b)).toBe(0); // two renders, identical bytes

      const fx0 = await page.evaluate(() => (window as any).__test.info().fx);
      await page.evaluate(() => (window as any).__test.advance(120));
      expect(await page.evaluate(() => (window as any).__test.info().fx)).toBe(fx0 + 120);
      // advance steps ONLY the clock: the picture changes at the next render, because the sun follows the clock
      const c = await page.screenshot({ type: 'png' });
      expect(Buffer.compare(a, c)).toBe(0);
      await page.evaluate(() => (window as any).__test.render());
      const d = await page.screenshot({ type: 'png' });
      expect(Buffer.compare(a, d)).not.toBe(0);

      await page.evaluate(() => (window as any).__test.setView({ time: 33 }));
      expect(await page.evaluate(() => (window as any).__test.info().fx)).toBe(33);
      await page.evaluate(() => (window as any).__test.render(2));
      expect(await page.evaluate(() => (window as any).__test.info().fx)).toBe(35);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('globe scene: the M00 spike scene is kept', () => {
  it('?scene=spike still works (M00 scene kept)', async () => {
    const { page, messages } = await openGlobe('test=1&scene=spike');
    try {
      await page.evaluate(() => (window as any).__test.render());
      const info = await page.evaluate(() => (window as any).__test.info());
      expect(info.drawCalls).toBe(1);
      expect(info.triangles).toBe(9024);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

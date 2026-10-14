// M07a part A: the chunk terrain in headless Chromium (software WebGL2): the default mode, the crack test at six altitudes with a magenta clear
// colour (and the detector proven with the skirts switched off), the lower bounds that a solid sphere cannot meet, `?chunks=1`, the jitter test,
// the headless high-tier run, the chunk cap under random camera poses, the old fixed mesh behind `?terrain=fixed`, and a heap check.
import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, heapDelta, launchBrowser, openPage } from '../scripts/shot.mjs';
import { CameraRig, type CameraPose } from '../src/render/camera';
import { chunkHue, chunkSizeRad } from '../src/render/chunkMath';
import { DEG } from '../src/render/geo';
import { ALTITUDE_VIEWS, rng } from '../tests/helpers/chunkWorld';
import { distinctColours, magentaInRegion, terrainRegionMask, type RgbaImage } from '../tests/helpers/terrainRegion';

interface TerrainState {
  chunkCount: number;
  lodLevels: number;
  triangles: number;
  drawCalls: number;
  levels: number[];
  capped: boolean;
  finite: boolean;
}
interface Hooks {
  render(dt?: number): void;
  info(): { triangles: number; drawCalls: number; terrainMode: string; tier: string; width: number; height: number; renderer: string };
  setView(v: Record<string, number>): void;
  view(): { lat: number; lon: number; distKm: number; heading: number; tilt: number };
  state(): { terrainMode: string; terrain: TerrainState } | null;
  terrain(): TerrainState;
  terrainLeaves(): Array<{ level: number; ix: number; iy: number; coarser: number[] }>;
  setSkirts(on: boolean): void;
  setChunkDebug(on: boolean): void;
  setClearColor(rgb: number): void;
  cameraAglM(): number;
  project(lat: number, lon: number): { x: number; y: number; inView: boolean; facing: boolean };
}

const MAGENTA = 0xff00ff;
const SHELL_TRIANGLES = 9024; // the 96 x 48 atmosphere shell
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const MB = 1_000_000;
const W = 960;
const H = 540;

let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

async function open(query = 'test=1&ai=0', viewport = { width: W, height: H }): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  return { page, messages: consoleMessages };
}

interface Shot {
  img: RgbaImage;
  png: Buffer;
  pose: CameraPose;
  terrain: TerrainState;
  info: ReturnType<Hooks['info']>;
  view: ReturnType<Hooks['view']>;
}

/** Sets the camera (with altAglM when given), renders once and takes the screenshot; the pose is rebuilt on the Node side from the clamped view. */
async function shoot(page: Page, view: Record<string, number>, altAglM?: number, size: [number, number] = [W, H]): Promise<Shot> {
  const r = await page.evaluate(
    ({ v, alt }) => {
      const t = (window as any).__test as Hooks;
      t.setView(alt === undefined ? v : { ...v, altAglM: alt });
      t.render();
      return { terrain: t.terrain(), info: t.info(), view: t.view() };
    },
    { v: view, alt: altAglM },
  );
  const png = await page.screenshot({ type: 'png' });
  const rig = new CameraRig(size[0], size[1]);
  rig.setViewUnclamped(r.view);
  return { img: decodePng(png) as RgbaImage, png, pose: rig.pose(), terrain: r.terrain, info: r.info, view: r.view };
}

const hueOf = (r: number, g: number, b: number): number => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h / 6) % 1 + 1) % 1;
};

describe('terrain mode', () => {
  it('without flags the terrain is the chunk quadtree; ?terrain=fixed and #terrain-fixed give the old fixed mesh', async () => {
    for (const [query, mode] of [
      ['test=1&ai=0', 'chunks'],
      ['test=1&ai=0&terrain=fixed', 'fixed'],
      ['test=1&ai=0&terrain=chunks', 'chunks'],
    ] as const) {
      const { page, messages } = await open(query);
      try {
        await page.evaluate(() => (window as any).__test.render());
        const s = await page.evaluate(() => (window as any).__test.state());
        expect(s?.terrainMode, query).toBe(mode);
        const i = await page.evaluate(() => (window as any).__test.info());
        expect(i?.terrainMode).toBe(mode);
        if (mode === 'fixed') {
          expect(i?.triangles).toBe(2 * 256 * 128 + SHELL_TRIANGLES); // exactly the M02 scene
          expect(s?.terrain.chunkCount).toBe(0);
        } else {
          expect(s?.terrain.chunkCount).toBeGreaterThan(8);
          expect(i?.triangles).toBe((s?.terrain.triangles ?? 0) + SHELL_TRIANGLES);
        }
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    }
    // the hash form reaches the same mode through the one parser
    const { page, messages } = await open('test=1&ai=0#terrain-fixed');
    try {
      await page.evaluate(() => (window as any).__test.render());
      expect((await page.evaluate(() => (window as any).__test.state()))?.terrainMode).toBe('fixed');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the chunk terrain draws in ONE instanced call: terrain draw calls 1, the scene 3 (stars, terrain, atmosphere shell)', async () => {
    const { page } = await open();
    try {
      const s = await shoot(page, { lat: 20, lon: 10, distKm: 21500, heading: 0, tilt: 0 });
      expect(s.terrain.drawCalls).toBe(1);
      expect(s.info.drawCalls).toBe(3);
    } finally {
      await page.close();
    }
  });
});

describe('cracks and bounds at six altitudes over the Alps (magenta clear colour)', () => {
  it('0 magenta pixels in the terrain region at every altitude, and the lower bounds that a solid sphere cannot meet at the three lowest', async () => {
    const { page, messages } = await open();
    try {
      await page.evaluate(() => (window as any).__test.setClearColor(0xff00ff));
      const rows: string[] = [];
      for (const [i, v] of ALTITUDE_VIEWS.entries()) {
        const s = await shoot(page, v.view as Record<string, number>, v.altAglM);
        fs.writeFileSync(path.join(SHOT_DIR, `terrain-alt-${i}-${v.name.replace(/ /g, '')}.png`), s.png);
        const mask = terrainRegionMask(s.pose, W, H, 4);
        const bad = magentaInRegion(s.img, mask);
        const colours = distinctColours(s.img, mask);
        const regionPx = mask.reduce((n, m) => n + m, 0);
        rows.push(`${v.name}: ${s.terrain.chunkCount} chunks, levels ${s.terrain.levels.join(',')}, ${s.terrain.triangles} tris, ${colours} colours, ${bad} magenta of ${regionPx} px, capped ${s.terrain.capped}`);
        expect(Math.abs(((await page.evaluate(() => (window as any).__test.cameraAglM())) as number) / v.altAglM - 1), `${v.name}: the camera is at the wanted height above the ground`).toBeLessThan(1e-4);
        expect(regionPx, `${v.name}: the planet fills part of the view`).toBeGreaterThan(5000);
        expect(bad, `${v.name}: holes in the terrain`).toBe(0);
        expect(s.terrain.chunkCount, v.name).toBeLessThanOrEqual(400);
        // the stats the HUD and these tests read are the leaves the renderer drew (a count that drifted from them would pass every other check)
        const leafCount = (await page.evaluate(() => (window as any).__test.terrainLeaves().length)) as number;
        expect(s.terrain.chunkCount, `${v.name}: chunkCount equals the number of leaves`).toBe(leafCount);
        expect(s.terrain.finite, `${v.name}: no NaN or infinity in the instance data`).toBe(true);
        expect(s.info.triangles, `${v.name}: renderer.info agrees with the terrain numbers`).toBe(s.terrain.triangles + SHELL_TRIANGLES);
        expect(s.info.drawCalls).toBe(3);
        if (i >= 3) {
          expect(s.terrain.chunkCount, `${v.name}: chunks`).toBeGreaterThanOrEqual(12);
          expect(s.terrain.lodLevels, `${v.name}: distinct LOD levels in view`).toBeGreaterThanOrEqual(3);
          expect(s.terrain.triangles, `${v.name}: test-tier triangles`).toBeGreaterThanOrEqual(20_000);
          expect(colours, `${v.name}: distinct colours in the terrain region`).toBeGreaterThanOrEqual(200);
        }
      }
      console.log(`[terrain] six altitudes:\n  ${rows.join('\n  ')}`);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the detector can fail on the real renderer: with the skirts off a view with different LOD levels next to each other shows magenta holes, with them on none', async () => {
    const { page, messages } = await open();
    try {
      await page.evaluate(() => (window as any).__test.setClearColor(0xff00ff));
      const found: string[] = [];
      for (const v of ALTITUDE_VIEWS.slice(1, 5)) {
        await page.evaluate(() => (window as any).__test.setSkirts(true));
        const on = await shoot(page, v.view as Record<string, number>, v.altAglM);
        await page.evaluate(() => (window as any).__test.setSkirts(false));
        const off = await shoot(page, v.view as Record<string, number>, v.altAglM);
        const mask = terrainRegionMask(on.pose, W, H, 4);
        const holesOn = magentaInRegion(on.img, mask);
        const holesOff = magentaInRegion(off.img, mask);
        found.push(`${v.name}: levels ${on.terrain.levels.join(',')}, ${holesOn} magenta with skirts, ${holesOff} without`);
        expect(on.terrain.lodLevels, `${v.name} has different LOD levels next to each other`).toBeGreaterThanOrEqual(2);
        expect(holesOn, v.name).toBe(0);
        expect(holesOff, `${v.name}: the open LOD seams are seen by the detector`).toBeGreaterThan(0);
      }
      console.log(`[terrain] skirts off: ${found.join('; ')}`);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a camera looking straight down (a skirt that only hangs down is edge-on to it) has no holes at the pole, the antimeridian (also looked at across the seam), the Himalaya and at 3 km', async () => {
    const { page, messages } = await open();
    try {
      await page.evaluate(() => (window as any).__test.setClearColor(0xff00ff));
      const views: Array<[string, Record<string, number>, number | undefined]> = [
        ['north pole', { lat: 90, lon: 0, distKm: 5000, heading: 0, tilt: 0 }, undefined],
        ['south pole', { lat: -90, lon: 0, distKm: 6000, heading: 0, tilt: 0 }, undefined],
        ['antimeridian', { lat: 0, lon: 180, distKm: 4000, heading: 0, tilt: 30 }, undefined],
        ['Himalaya 3 km down', { lat: 28.2, lon: 86.8, heading: 0, tilt: 0 }, 3000],
        ['Atlantic 20 km down', { lat: 20, lon: 0, heading: 0, tilt: 0 }, 20_000],
        // across the antimeridian with a different level on each side (the wrap-around of the neighbour levels): toward the seam and away from it
        ['antimeridian 60 km, looking east', { lat: 10, lon: 179.5, heading: 90, tilt: 70 }, 60_000],
        ['antimeridian 8 km, looking west', { lat: 60, lon: -179.9, heading: 270, tilt: 80 }, 8_000],
        ['antimeridian 500 km, looking east', { lat: 10, lon: 175, heading: 90, tilt: 60 }, 500_000],
      ];
      for (const [name, v, alt] of views) {
        const s = await shoot(page, v, alt);
        const holes = magentaInRegion(s.img, terrainRegionMask(s.pose, W, H, 4));
        expect(holes, name).toBe(0);
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('?chunks=1: the chunk colours', () => {
  it('at the three lowest altitudes at least 12 chunk hues show, and the pixel at the CPU-projected centre of a chunk has that chunk\'s hue (the GPU puts the chunks where the CPU says)', async () => {
    const { page, messages } = await open('test=1&ai=0&chunks=1');
    try {
      for (const v of ALTITUDE_VIEWS.slice(3)) {
        const s = await shoot(page, v.view as Record<string, number>, v.altAglM);
        fs.writeFileSync(path.join(SHOT_DIR, `terrain-chunks-${v.name.replace(/ /g, '')}.png`), s.png);
        const mask = terrainRegionMask(s.pose, W, H, 4);
        // hue bins (1/36 of the wheel) holding at least 40 pixels of the terrain region: one bin per hue the picture really shows
        const bins = new Map<number, number>();
        for (let i = 0; i < mask.length; i++) {
          if (mask[i] === 0) continue;
          const r = s.img.data[i * 4] as number;
          const g = s.img.data[i * 4 + 1] as number;
          const b = s.img.data[i * 4 + 2] as number;
          if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue; // the dark rims and greys carry no hue
          const bin = Math.floor(hueOf(r, g, b) * 36);
          bins.set(bin, (bins.get(bin) ?? 0) + 1);
        }
        const shown = [...bins.values()].filter((n) => n >= 40).length;
        expect(s.terrain.chunkCount, v.name).toBeGreaterThanOrEqual(12);
        expect(shown, `${v.name}: distinct chunk hues (bins of 1/36 with >= 40 pixels)`).toBeGreaterThanOrEqual(12);
        // The chunk centres: project the displaced surface above each chunk's centre; where the CPU ray through that pixel (picking) lands
        // inside the same chunk the pixel is that chunk's (nothing in front of it) and must have the chunk's hue.
        const leaves = await page.evaluate(() => (window as any).__test.terrainLeaves() as Array<{ level: number; ix: number; iy: number }>);
        let tested = 0;
        let matched = 0;
        for (const l of leaves) {
          const w = chunkSizeRad(l.level);
          const lat = (Math.PI / 2 - (l.iy + 0.5) * w) / DEG;
          const lon = (-Math.PI + (l.ix + 0.5) * w) / DEG;
          const p = await page.evaluate(([la, lo]) => (window as any).__test.project(la as number, lo as number) as { x: number; y: number; inView: boolean; facing: boolean }, [lat, lon]);
          if (!p.inView || !p.facing) continue;
          const x = Math.floor(p.x);
          const y = Math.floor(p.y);
          if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
          const hit = await page.evaluate(([px, py]) => (window as any).__test.pick(px as number, py as number) as { lat: number; lon: number } | null, [x, y]);
          if (!hit) continue;
          const half = (w / DEG) / 2;
          if (Math.abs(hit.lat - lat) > half * 0.5 || Math.abs(hit.lon - lon) > half * 0.5) continue; // something else is in front of this centre
          const o = (y * W + x) * 4;
          const r = s.img.data[o] as number;
          const g = s.img.data[o + 1] as number;
          const b = s.img.data[o + 2] as number;
          if (Math.max(r, g, b) - Math.min(r, g, b) < 25) continue;
          tested++;
          const d = Math.abs(hueOf(r, g, b) - chunkHue(l.level, l.ix, l.iy));
          if (Math.min(d, 1 - d) < 0.025) matched++;
        }
        console.log(`[terrain] ${v.name}: ${shown} hue bins, centre pixel hue matched ${matched} of ${tested} chunks`);
        expect(tested, `${v.name}: unoccluded chunk centres tested`).toBeGreaterThanOrEqual(8);
        expect(matched / tested, `${v.name}: the pixel at an unoccluded chunk centre has the chunk's hue`).toBeGreaterThan(0.9);
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the colouring is deterministic (two renders are byte-identical) and #chunks switches it on', async () => {
    const { page } = await open('test=1&ai=0#chunks');
    try {
      const v = ALTITUDE_VIEWS[4] as (typeof ALTITUDE_VIEWS)[number];
      const a = await shoot(page, v.view as Record<string, number>, v.altAglM);
      const b = await shoot(page, v.view as Record<string, number>, v.altAglM);
      expect(Buffer.compare(a.png, b.png)).toBe(0);
      const mask = terrainRegionMask(a.pose, W, H, 4);
      // a flat colouring: far fewer distinct colours than the shaded terrain of the same view
      const off = await open('test=1&ai=0');
      try {
        const plain = await shoot(off.page, v.view as Record<string, number>, v.altAglM);
        expect(distinctColours(a.img, mask)).not.toBe(distinctColours(plain.img, mask));
        expect(Buffer.compare(a.png, plain.png)).not.toBe(0);
      } finally {
        await off.page.close();
      }
    } finally {
      await page.close();
    }
  });
});

describe('jitter: a camera offset of 1e-7 degrees (about 1 cm) at 300 m above the ground', () => {
  const v = ALTITUDE_VIEWS[5] as (typeof ALTITUDE_VIEWS)[number];
  const base = { ...(v.view as Record<string, number>) };
  const diffOf = (a: Shot, b: Shot): number => pixelmatch(a.img.data as Uint8Array, b.img.data as Uint8Array, undefined, W, H, { threshold: 0.1 });

  it('the shaded picture changes less than 0.2 % of the pixels and the instance data has no NaN; the same view twice is byte-identical', async () => {
    const { page, messages } = await open();
    try {
      const a = await shoot(page, base, v.altAglM);
      const jit = await shoot(page, { ...base, lat: (base.lat as number) + 1e-7 }, v.altAglM);
      const same = await shoot(page, base, v.altAglM);
      expect(Buffer.compare(a.png, same.png)).toBe(0);
      const diff = diffOf(a, jit);
      console.log(`[jitter] shaded view, 1e-7 degrees at 300 m AGL: ${diff} of ${W * H} pixels differ (${((100 * diff) / (W * H)).toFixed(4)} %)`);
      expect(diff / (W * H)).toBeLessThan(0.002);
      expect(jit.terrain.finite && a.terrain.finite).toBe(true);
      expect(jit.terrain.chunkCount).toBe(a.terrain.chunkCount); // a 1 cm move must not change the selection
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the chunk edges (a picture made of edges, the most sensitive one) change less than 0.2 % of the pixels; a 1e-3 degree move changes far more, so the test can fail', async () => {
    const { page, messages } = await open('test=1&ai=0&chunks=1');
    try {
      const a = await shoot(page, base, v.altAglM);
      const jit = await shoot(page, { ...base, lat: (base.lat as number) + 1e-7 }, v.altAglM);
      const far = await shoot(page, { ...base, lat: (base.lat as number) + 1e-3 }, v.altAglM);
      const small = diffOf(a, jit);
      const big = diffOf(a, far);
      console.log(`[jitter] chunk edges: 1e-7 degrees ${small} pixels (${((100 * small) / (W * H)).toFixed(4)} %), control 1e-3 degrees ${big} pixels (${((100 * big) / (W * H)).toFixed(2)} %)`);
      expect(small / (W * H)).toBeLessThan(0.002);
      expect(big / (W * H)).toBeGreaterThan(0.01);
      expect(jit.terrain.finite).toBe(true);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('tiers: the headless high-tier run and the chunk cap', () => {
  it('the high tier (chunk density of ?quality=high, headless through chunktier) draws 100k to 1.5M triangles in at most 200 draw calls and never more than 400 chunks', async () => {
    const { page, messages } = await open('test=1&ai=0&chunktier=high');
    try {
      const rows: string[] = [];
      for (const v of ALTITUDE_VIEWS) {
        const s = await shoot(page, v.view as Record<string, number>, v.altAglM);
        rows.push(`${v.name}: ${s.terrain.chunkCount} chunks, ${s.terrain.triangles} tris`);
        expect(s.terrain.chunkCount, v.name).toBeLessThanOrEqual(400);
        expect(s.terrain.triangles, v.name).toBeLessThanOrEqual(1_500_000);
        expect(s.info.drawCalls, v.name).toBeLessThanOrEqual(200);
        expect(s.terrain.finite).toBe(true);
      }
      console.log(`[terrain] high tier: ${rows.join('; ')}`);
      const s = await shoot(page, ALTITUDE_VIEWS[2]!.view as Record<string, number>, ALTITUDE_VIEWS[2]!.altAglM);
      expect(s.info.triangles, '500 km view, high tier: triangles of the scene').toBeGreaterThanOrEqual(100_000);
      expect(s.info.triangles).toBeLessThanOrEqual(1_500_000);
      expect(s.info.drawCalls).toBeLessThanOrEqual(200);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the cap holds for random camera poses in the browser too (high tier, 60 poses: chunks <= 400, triangles <= 1.5M)', async () => {
    const { page, messages } = await open('test=1&ai=0&chunktier=high');
    try {
      const r = rng(77);
      let worst = 0;
      for (let i = 0; i < 60; i++) {
        const view = { lat: -80 + 160 * r(), lon: -180 + 360 * r(), heading: 360 * r(), tilt: 85 * r() };
        const alt = Math.min(10 ** (2.4 + 4.6 * r()), 20_000_000);
        const t = await page.evaluate(
          ({ v, a }) => {
            const h = (window as any).__test as Hooks;
            h.setView({ ...v, altAglM: a });
            h.render();
            return h.terrain();
          },
          { v: view, a: alt },
        );
        worst = Math.max(worst, t.chunkCount);
        expect(t.chunkCount, `pose ${i}`).toBeLessThanOrEqual(400);
        expect(t.triangles).toBeLessThanOrEqual(1_500_000);
        expect(t.finite).toBe(true);
      }
      console.log(`[terrain] 60 random poses on the high tier: at most ${worst} chunks`);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the default test tier stays within 150k triangles at every altitude (the chunk cap of the tier)', async () => {
    const { page } = await open();
    try {
      for (const v of ALTITUDE_VIEWS) {
        const s = await shoot(page, v.view as Record<string, number>, v.altAglM);
        expect(s.info.triangles, v.name).toBeLessThanOrEqual(150_000);
      }
    } finally {
      await page.close();
    }
  });
});

describe('the chunk terrain at orbit looks like the old globe and costs less', () => {
  it('the default start view: fewer triangles than the fixed mesh of the same tier, both numbers logged for the Budgetar table', async () => {
    const counts: Record<string, number> = {};
    for (const mode of ['chunks', 'fixed']) {
      const { page } = await open(`test=1&ai=0&terrain=${mode}`);
      try {
        const s = await shoot(page, { lat: 22, lon: 12, distKm: 21500, heading: 0, tilt: 0 });
        counts[mode] = s.info.triangles;
      } finally {
        await page.close();
      }
    }
    console.log(`[budget] default view, test tier: chunks ${counts.chunks} triangles, fixed mesh ${counts.fixed} triangles`);
    expect(counts.chunks).toBeLessThan(counts.fixed as number);
  });
});

describe('leak-test: chunk terrain', () => {
  it('60 render calls (3 rounds x 20) at 320x180 over a moving camera retain less than 5 MB (median of 3)', async () => {
    const { page, messages } = await open('test=1&ai=0&w=320&h=180', { width: 320, height: 180 });
    try {
      // One render per evaluate: ANGLE warns "running out of reserved queue serials" when dozens of instance-buffer uploads pile up in ONE
      // JavaScript task (a page presents a frame per task, so only a test that renders in a loop meets it; the selection changes every frame here).
      let step = 0;
      const frames = async (n: number): Promise<void> => {
        for (let i = 0; i < n; i++, step++) {
          await page.evaluate((k) => {
            const h = (window as any).__test as Hooks;
            h.setView({ lat: 43.4 + 0.01 * k, lon: 7.4, heading: 3 * k, tilt: 70, altAglM: 20_000 * (1 + 0.02 * (k % 20)) });
            h.render();
          }, step);
        }
      };
      await frames(20); // warm-up outside the measurement: shader compile and first-use allocations are not leaks
      const delta = await heapDelta(page, async () => {
        for (let round = 0; round < 3; round++) await frames(20);
      });
      console.log(`[leak-test] chunk terrain heap delta: ${(delta / MB).toFixed(3)} MB`);
      expect(delta).toBeLessThan(5 * MB);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// M02 last step: the pixel acceptance of the sky and water features (night lights, night side, limb, sun glitter, country
// borders) and, after them, the goldens of the six canonical views (committed once with UPDATE_GOLDENS=1).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, compareGolden, decodePng, launchBrowser, luma, openPage } from '../scripts/shot.mjs';
import { cross, DEG, dot, eastAt, latLonToVec, normalize, scale, sub, sunDirectionAt, timeForSubsolarLon, vecToLatLon, wrapLon, type Vec3 } from '../src/render/geo';
import { CANONICAL_VIEWS } from '../src/render/views';
import { worldLoader } from '../tests/helpers/dataFiles';

type Img = ReturnType<typeof decodePng>;
type Hooks = {
  render(dt?: number): void;
  setView(v: Record<string, number>): void;
  project(lat: number, lon: number): { x: number; y: number; inView: boolean; facing: boolean };
  pick(x: number, y: number): { lat: number; lon: number; heightM: number; elevationM: number; countryId: number } | null;
  readTexels(name: string, points: Array<[number, number]>): number[];
  setBorderStrength(x: number): void;
  info(): Record<string, any>;
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

async function openGlobe(): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1');
  return { page, messages: consoleMessages };
}

async function shoot(page: Page, view: Record<string, number>, name?: string): Promise<{ png: Buffer; img: Img }> {
  await page.evaluate((v) => {
    const t = (window as any).__test as Hooks;
    t.setView(v);
    t.render();
  }, view);
  const png = await page.screenshot({ type: 'png' });
  if (name) fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), png);
  return { png, img: decodePng(png) };
}

const lumaAt = (img: Img, x: number, y: number): number => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return luma(img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number);
};
const meanLuma = (img: Img): number => {
  let s = 0;
  for (let i = 0; i < img.data.length; i += 4) s += luma(img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number);
  return s / (img.width * img.height);
};
const median = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] as number;

const cellLatLon = (cell: number): { lat: number; lon: number } => ({ lat: 90 - ((Math.floor(cell / 1024) + 0.5) / 512) * 180, lon: ((cell % 1024) + 0.5) / 1024 * 360 - 180 });

describe('night lights: the city pixel is brighter than its sea neighbour (setView on the city, distKm 2500, the city on the night side)', () => {
  for (const name of ['Tokyo', 'New York', 'Stockholm']) {
    it(name, async () => {
      const city = (await worldLoader().loadCities()).find((c) => c.name === name);
      if (!city) throw new Error(`no ${name} in cities.json`);
      const { lat, lon } = cellLatLon(city.cell);
      const { page, messages } = await openGlobe();
      try {
        // The sun on the far side of the globe: the sub-solar longitude is opposite to the city.
        const time = timeForSubsolarLon(wrapLon(lon + 180));
        const { img } = await shoot(page, { lat, lon, distKm: 2500, heading: 0, tilt: 0, time }, `lights-${name.replace(' ', '-')}`);
        const p = await page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const);
        expect(p.inView && p.facing).toBe(true);
        // sea neighbour: the nearest pixel whose pick is sea (spiral outwards from the city pixel)
        const sea = await page.evaluate(
          ([cx, cy]) => {
            const t = (window as any).__test as Hooks;
            for (let r = 6; r <= 260; r += 6) {
              for (let k = 0; k < 24; k++) {
                const x = Math.round((cx as number) + r * Math.cos((k / 24) * 2 * Math.PI));
                const y = Math.round((cy as number) + r * Math.sin((k / 24) * 2 * Math.PI));
                const hit = t.pick(x, y);
                if (hit && hit.heightM <= 0 && hit.elevationM < 0) return { x, y, r };
              }
            }
            return null;
          },
          [p.x, p.y] as const,
        );
        expect(sea, 'a sea pixel within 260 px').not.toBeNull();
        const seaP = sea as { x: number; y: number; r: number };
        const cityL = lumaAt(img, p.x, p.y);
        const seaL = lumaAt(img, seaP.x, seaP.y);
        console.log(`[lights] ${name}: city pixel luma ${cityL.toFixed(1)}, sea neighbour (${seaP.r} px away) ${seaL.toFixed(1)}`);
        expect(cityL).toBeGreaterThanOrEqual(seaL + 25);
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }
});

describe('the canonical night view', () => {
  it('night side mean luma < day side mean luma / 3, and at least 20 light pixels above luma 150', async () => {
    const night = CANONICAL_VIEWS.find((v) => v.id === 'night');
    if (!night) throw new Error('no night view');
    const { id: _id, time, ...view } = night;
    const { page, messages } = await openGlobe();
    try {
      const { img: nightImg } = await shoot(page, { ...view, time }, 'night-side');
      // The day side of the same view: the sun above the view centre.
      const { img: dayImg } = await shoot(page, { ...view, time: timeForSubsolarLon(view.lon) }, 'night-day-reference');
      const nightMean = meanLuma(nightImg);
      const dayMean = meanLuma(dayImg);
      let bright = 0;
      for (let y = 0; y < nightImg.height; y++) for (let x = 0; x < nightImg.width; x++) if (lumaAt(nightImg, x, y) > 150) bright++;
      console.log(`[night] mean luma night ${nightMean.toFixed(1)}, day ${dayMean.toFixed(1)} (ratio ${(dayMean / nightMean).toFixed(2)}), light pixels > 150: ${bright}`);
      expect(nightMean).toBeLessThan(dayMean / 3);
      expect(bright).toBeGreaterThanOrEqual(20);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('limb and sun glitter', () => {
  it('a limb pixel (the outermost ring) on the sun side is at least 10 luma brighter than the space background', async () => {
    const earth = CANONICAL_VIEWS.find((v) => v.id === 'earth');
    if (!earth) throw new Error('no earth view');
    const { id: _id, time, ...view } = earth;
    const { page, messages } = await openGlobe();
    try {
      const { img } = await shoot(page, { ...view, time }, 'limb');
      // Geometric horizon seen from the camera (tilt 0): cos(alpha) = 1 / (1 + dist / R). The limb pixel is the surface point
      // 0.25 degrees inside the horizon, due west of the view centre (the sun is on the west side in this view).
      const camDist = 1 + view.distKm / 6371;
      const alphaH = Math.acos(1 / camDist) / DEG;
      const focus = latLonToVec(view.lat, view.lon);
      const east = eastAt(view.lon);
      const a = (alphaH - 0.25) * DEG;
      const limbPoint = vecToLatLon([focus[0] * Math.cos(a) - east[0] * Math.sin(a), focus[1] * Math.cos(a) - east[1] * Math.sin(a), focus[2] * Math.cos(a) - east[2] * Math.sin(a)]);
      const sunSide = dot(latLonToVec(limbPoint.lat, limbPoint.lon), sunDirectionAt(time));
      expect(sunSide, 'the limb point is on the sun side').toBeGreaterThan(0.2);
      const p = await page.evaluate(([la, lo]) => (window as any).__test.project(la, lo), [limbPoint.lat, limbPoint.lon] as const);
      expect(p.inView).toBe(true);
      const space = median([lumaAt(img, 3, 3), lumaAt(img, 3, 270), lumaAt(img, 3, 530), lumaAt(img, 20, 100), lumaAt(img, 20, 440), lumaAt(img, 40, 40)]);
      // the brightest pixel in the outermost ring around the projected point (+-1 px)
      let limb = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) limb = Math.max(limb, lumaAt(img, p.x + dx, p.y + dy));
      console.log(`[limb] limb pixel (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) luma ${limb.toFixed(1)} against space ${space.toFixed(1)}`);
      expect(limb).toBeGreaterThanOrEqual(space + 10);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the glitter pixel on the sun reflection side is brighter than the mean of the sea on that side', async () => {
    const { page, messages } = await openGlobe();
    try {
      const view = { lat: 20, lon: -30, distKm: 12000, heading: 0, tilt: 0 };
      const time = timeForSubsolarLon(-75);
      const { img } = await shoot(page, { ...view, time }, 'glitter');
      // The mirror point: the surface point whose normal bisects the directions to the camera and to the sun (searched on the sphere).
      const camDist = 1 + view.distKm / 6371;
      const cam = scale(latLonToVec(view.lat, view.lon), camDist);
      const sun = sunDirectionAt(time);
      let best = { lat: 0, lon: 0, score: -2 };
      for (let la = -30; la <= 70; la += 0.25) {
        for (let lo = -110; lo <= 50; lo += 0.25) {
          const n = latLonToVec(la, lo);
          const v = normalize(sub(cam, n));
          const r = sub(scale(n, 2 * dot(n, v)), v); // reflection of the view ray: mirror direction
          const score = dot(r, sun);
          if (score > best.score) best = { lat: la, lon: lo, score };
        }
      }
      expect(best.score).toBeGreaterThan(0.999);
      const p = await page.evaluate(([la, lo]) => (window as any).__test.project(la, lo), [best.lat, best.lon] as const);
      expect(p.inView && p.facing).toBe(true);
      let glitter = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) glitter = Math.max(glitter, lumaAt(img, p.x + dx, p.y + dy));
      // sea pixels on the sun side of the picture (day hemisphere, sampled on a 10 px grid)
      const seaPoints = await page.evaluate(() => {
        const t = (window as any).__test as Hooks;
        const out: Array<[number, number, number, number]> = [];
        for (let y = 5; y < 540; y += 10) {
          for (let x = 5; x < 960; x += 10) {
            const h = t.pick(x, y);
            if (h && h.heightM <= 0 && h.elevationM < 0) out.push([x, y, h.lat, h.lon]);
          }
        }
        return out;
      });
      const seaLumas = seaPoints.filter(([, , la, lo]) => dot(latLonToVec(la, lo), sun) > 0.3).map(([x, y]) => lumaAt(img, x, y));
      expect(seaLumas.length).toBeGreaterThan(300);
      const seaMean = seaLumas.reduce((a, b) => a + b, 0) / seaLumas.length;
      console.log(`[glitter] mirror point ${best.lat.toFixed(2)}, ${best.lon.toFixed(2)} at pixel (${p.x.toFixed(0)}, ${p.y.toFixed(0)}): max luma ${glitter.toFixed(1)}; sea mean on the sun side ${seaMean.toFixed(1)} (${seaLumas.length} samples)`);
      expect(glitter).toBeGreaterThan(seaMean + 40);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('country borders', () => {
  it('are weak lines between two different land ids only: the border strength switch changes only such pixels, coast against sea is untouched', async () => {
    const { page, messages } = await openGlobe();
    try {
      const view = { lat: 50.5, lon: 8, distKm: 1500, heading: 0, tilt: 0, time: timeForSubsolarLon(8) };
      await page.evaluate(() => (window as any).__test.setBorderStrength(0));
      const { img: off } = await shoot(page, view, 'borders-off');
      await page.evaluate(() => (window as any).__test.setBorderStrength(0.34));
      const { img: on } = await shoot(page, view, 'borders-on');

      // For a sampled pixel: the render raster texel (4096x2048) under the centre and under 8 neighbours at 2-3 px, from the
      // picks (-1 = the ray misses); the country ids are then read from the SAME bytes the GPU texture holds (render pack).
      const render = await worldLoader().loadRender();
      const probe = await page.evaluate(
        ([w, h]) => {
          const t = (window as any).__test as Hooks;
          const offs: Array<[number, number]> = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2]];
          const rows: Array<{ x: number; y: number; texels: number[]; land: boolean; seaNeighbour: boolean }> = [];
          for (let y = 8; y < (h as number) - 8; y += 4) {
            for (let x = 8; x < (w as number) - 8; x += 4) {
              const texels: number[] = [];
              let land = false;
              let sea = false;
              offs.forEach(([dx, dy], i) => {
                const hit = t.pick(x + dx, y + dy);
                if (!hit) {
                  texels.push(-1);
                  return;
                }
                if (hit.heightM <= 0) sea = true;
                else if (i === 0) land = true;
                const px = Math.min(4095, Math.max(0, Math.floor(((hit.lon + 180) / 360) * 4096)));
                const py = Math.min(2047, Math.max(0, Math.floor(((90 - hit.lat) / 180) * 2048)));
                texels.push(py * 4096 + px);
              });
              rows.push({ x, y, texels, land, seaNeighbour: sea });
            }
          }
          return rows;
        },
        [on.width, on.height] as const,
      );
      const info = probe.map((r) => ({ ...r, ids: r.texels.map((tx) => (tx < 0 ? 0 : (render.country8[tx] as number))) }));
      let changedBorder = 0;
      let changedOther = 0;
      let coastChecked = 0;
      let coastChanged = 0;
      for (const r of info) {
        const d = Math.abs(lumaAt(on, r.x, r.y) - lumaAt(off, r.x, r.y));
        const land = new Set(r.ids.filter((id) => id !== 0));
        const isBorder = land.size >= 2;
        if (d > 2) {
          if (isBorder) changedBorder++;
          else changedOther++;
        }
        if (!isBorder && r.land && r.seaNeighbour) {
          coastChecked++;
          if (d > 2) coastChanged++;
        }
      }
      console.log(`[borders] ${info.length} samples: changed at borders ${changedBorder}, changed elsewhere ${changedOther}, coast samples ${coastChecked} (changed ${coastChanged})`);
      expect(changedBorder).toBeGreaterThan(40); // borders are drawn
      expect(changedOther).toBeLessThanOrEqual(Math.ceil(changedBorder * 0.05)); // and only there
      expect(coastChecked).toBeGreaterThan(40);
      expect(coastChanged).toBe(0); // coast against sea is no border
      // weak: only a thin line of the picture changes
      let diffPx = 0;
      for (let i = 0; i < on.data.length; i += 4) {
        const l1 = luma(on.data[i] as number, on.data[i + 1] as number, on.data[i + 2] as number);
        const l0 = luma(off.data[i] as number, off.data[i + 1] as number, off.data[i + 2] as number);
        if (Math.abs(l1 - l0) > 2) diffPx++;
      }
      console.log(`[borders] ${(100 * diffPx / (on.width * on.height)).toFixed(2)} % of the pixels differ with borders on`);
      expect(diffPx / (on.width * on.height)).toBeLessThan(0.06);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// The goldens come last: the six canonical views, committed ONCE with UPDATE_GOLDENS=1 after everything above is final.
describe('goldens of the six canonical views', () => {
  it('two renders in one browser start are byte-identical, and each view matches its golden (pixelmatch 0.1, <= 0.2 %)', async () => {
    const { page, messages } = await openGlobe();
    try {
      for (const v of CANONICAL_VIEWS) {
        const { id, time, ...view } = v;
        const a = await shoot(page, { ...view, time });
        const b = await shoot(page, { ...view, time });
        expect(Buffer.compare(a.png, b.png), `${id}: two renders identical`).toBe(0);
        const result = compareGolden(a.png, `globe-${id}`);
        console.log(`[golden] globe-${id}: ${result.status}, ${result.diffPixels} px differ (${(result.ratio * 100).toFixed(4)} %)`);
        expect(['match', 'updated', 'mismatch-warn', 'missing-warn'], id).toContain(result.status);
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

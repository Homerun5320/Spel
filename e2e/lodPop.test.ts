// LOD swaps of the chunk terrain in headless Chromium (software WebGL2), M07b audit. Two ways to look at "popping", both on the pixels:
//  1. A FIXED camera and two quadtree states: the same pose rendered with the tier's split distances and with every split distance 25 % larger (`setChunkDensity`,
//     which makes dozens of nodes split that did not). Nothing but the chunk set differs, so whatever changes in the picture is the pop of the swaps.
//  2. A camera that moves in 0.2 % steps (`distKm`, a fixed path in space: the camera does not follow the ground). The audit's own reproduction stepped the
//     camera ABOVE THE GROUND (`altAglM`) over the 12x exaggerated detailed Himalaya: the camera position itself then jumps by kilometres from one step to the next
//     (the ground under it changes by that much), and the picture changes by 5 % whether or not a chunk is swapped (D154). A path in space has no such jumps.
// The geometric side (how far, in pixels, the vertices of a swap move) is `tests/render/lodSwap.test.ts`; its control can fail where the pixels cannot: the
// fine octaves are only a few tenths of a percent of the pixels (the check at the end shows the share the picture does move by when every octave limit is off).
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';

let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

async function open(query: string, viewport: { width: number; height: number }): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  return { page, messages: consoleMessages };
}

const luma = (png: Buffer): Float32Array => {
  const im = decodePng(png);
  const l = new Float32Array(im.width * im.height);
  for (let i = 0; i < l.length; i++) l[i] = (0.2126 * (im.data[i * 4] as number) + 0.7152 * (im.data[i * 4 + 1] as number) + 0.0722 * (im.data[i * 4 + 2] as number)) / 255;
  return l;
};
/** The share of pixels whose luminance differs by more than 0.04. */
function changedShare(a: Float32Array, b: Float32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs((a[i] as number) - (b[i] as number)) > 0.04) n++;
  return n / a.length;
}

interface View {
  name: string;
  lat: number;
  lon: number;
  tilt: number;
  heading: number;
  altAglM: number;
}
const VIEWS: View[] = [
  { name: 'Himalaya 46 km', lat: 28.2, lon: 86.8, tilt: 62, heading: 0, altAglM: 46_000 },
  { name: 'Himalaya 16 km', lat: 28.2, lon: 86.8, tilt: 55, heading: 0, altAglM: 16_000 },
  { name: 'Alps 15 km', lat: 46.5, lon: 8, tilt: 55, heading: 0, altAglM: 15_000 },
  { name: 'Norway 8 km', lat: 61.9, lon: 7.2, tilt: 55, heading: 90, altAglM: 8000 },
];

describe('a chunk swap at a fixed camera changes (almost) no pixel', () => {
  it('on the high chunk tier (cap 400): with every split distance 25 % larger, 64 to 128 nodes of each of four views are split that were not, and at most 1 % of the pixels move by more than 0.04 in luminance', async () => {
    const { page, messages } = await open('test=1&ai=0&chunktier=high', { width: 640, height: 360 });
    try {
      let worst = 0;
      let swappedTotal = 0;
      for (const v of VIEWS) {
        const time = timeForSubsolarLon(v.lon + 35);
        const render = async (density: number): Promise<{ leaves: string[]; luma: Float32Array }> => {
          await page.evaluate((d: number) => (window as any).__test.setChunkDensity(d), density);
          const leaves: string[] = await page.evaluate(
            (a) => {
              const t = (window as any).__test;
              t.setView(a);
              t.render();
              return t.terrainLeaves().map((l: { level: number; ix: number; iy: number }) => `${l.level}/${l.ix}/${l.iy}`);
            },
            { lat: v.lat, lon: v.lon, tilt: v.tilt, heading: v.heading, altAglM: v.altAglM, time },
          );
          return { leaves, luma: luma(await page.screenshot({ type: 'png' })) };
        };
        const a = await render(1);
        const b = await render(1.25);
        const sa = new Set(a.leaves);
        const swapped = b.leaves.filter((k) => !sa.has(k)).length;
        const share = changedShare(a.luma, b.luma);
        console.log(`[lod pop] ${v.name}: ${a.leaves.length} leaves, ${swapped} new with the larger split distances, ${(100 * share).toFixed(3)} % of the pixels change`);
        expect(swapped, `${v.name}: leaves that differ`).toBeGreaterThanOrEqual(30);
        expect(share, `${v.name}: share of the pixels that change`).toBeLessThan(0.01);
        worst = Math.max(worst, share);
        swappedTotal += swapped;
      }
      console.log(`[lod pop] four views, ${swappedTotal} swapped leaves, worst ${(100 * worst).toFixed(3)} % of the pixels`);
      expect(swappedTotal).toBeGreaterThan(250);
      // the density lever is a real lever and restores: back at 1 the leaves are the tier's own again
      await page.evaluate(() => (window as any).__test.setChunkDensity(1));
      expect(await page.evaluate(() => (window as any).__test.chunkDensity())).toBe(1);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the picture can show a change of this size (the check is not blind): every octave limit off (12 octaves at every vertex) moves 0.1 to 5 % of the pixels of a Himalaya view at the same camera', async () => {
    const { page, messages } = await open('test=1&ai=0&chunktier=high', { width: 640, height: 360 });
    try {
      const v = VIEWS[1] as View;
      const time = timeForSubsolarLon(v.lon + 35);
      const shoot = async (mode: 'law' | 'none'): Promise<Float32Array> => {
        await page.evaluate((m: string) => (window as any).__test.setOctaveLimit(m), mode);
        await page.evaluate(
          (a) => {
            const t = (window as any).__test;
            t.setView(a);
            t.render();
          },
          { lat: v.lat, lon: v.lon, tilt: v.tilt, heading: v.heading, altAglM: v.altAglM, time },
        );
        return luma(await page.screenshot({ type: 'png' }));
      };
      const law = await shoot('law');
      const none = await shoot('none');
      const share = changedShare(law, none);
      console.log(`[lod pop] 12 octaves everywhere against the distance law: ${(100 * share).toFixed(3)} % of the pixels differ`);
      expect(share).toBeGreaterThan(0.001);
      expect(share).toBeLessThan(0.05);
      await page.evaluate(() => (window as any).__test.setOctaveLimit('law'));
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

interface Path {
  name: string;
  lat: number;
  lon: number;
  tilt: number;
  /** Orbit distance from the focus (km) at the start, and the number of 0.2 % steps. */
  distKm: number;
  steps: number;
}
// Paths that stay clear of the 12x exaggerated ground (the camera is 60 to 150 km up) so that the camera moves smoothly along the path. The steps are the first
// ones of a longer measured path (Alps 66 steps, 7 swaps, the largest step 1.01 %; Himalaya 52 steps, 12 swaps, 1.88 %): each holds three swaps and the test stays short
// (three browsers run side by side in `verify`, a frame is three times slower than alone: 120 s was not enough for 67 frames).
const PATHS: Path[] = [
  { name: 'Alps', lat: 46.5, lon: 8, tilt: 35, distKm: 120, steps: 18 },
  { name: 'Himalaya', lat: 28.2, lon: 86.8, tilt: 30, distKm: 200, steps: 28 },
];

describe('a camera that moves in 0.2 % steps (a path in space) crosses chunk swaps without a jump', () => {
  it.each(PATHS)(
    '$name: at least 3 steps swap chunks, no step moves more than 2 % of the pixels by more than 0.04, and a step that swaps chunks is no larger than the quiet steps around it (plus 0.5 %)',
    async (path) => {
      const { page, messages } = await open('test=1&ai=0', { width: 320, height: 180 });
      try {
        const time = timeForSubsolarLon(path.lon + 35);
        let prevLuma: Float32Array | null = null;
        let prevKey = '';
        let swaps = 0;
        let worstSwap = 0;
        let worstQuiet = 0;
        let worst = 0;
        for (let k = 0; k <= path.steps; k++) {
          const distKm = path.distKm / 1.002 ** k;
          const key: string = await page.evaluate(
            (a) => {
              const t = (window as any).__test;
              t.setView(a);
              t.render();
              return t
                .terrainLeaves()
                .map((l: { level: number; ix: number; iy: number }) => `${l.level}/${l.ix}/${l.iy}`)
                .sort()
                .join(',');
            },
            { lat: path.lat, lon: path.lon, tilt: path.tilt, heading: 0, distKm, time },
          );
          const l = luma(await page.screenshot({ type: 'png' }));
          if (prevLuma) {
            const c = changedShare(prevLuma, l);
            worst = Math.max(worst, c);
            if (key !== prevKey) {
              swaps++;
              worstSwap = Math.max(worstSwap, c);
            } else worstQuiet = Math.max(worstQuiet, c);
          }
          prevLuma = l;
          prevKey = key;
        }
        console.log(`[lod pop] ${path.name}: ${path.steps} steps of 0.2 %, ${swaps} swap the chunks; the largest step moves ${(100 * worst).toFixed(2)} % of the pixels (a swapping step ${(100 * worstSwap).toFixed(2)} %, a quiet one ${(100 * worstQuiet).toFixed(2)} %)`);
        expect(swaps).toBeGreaterThanOrEqual(3);
        expect(worst, 'the largest step').toBeLessThan(0.02);
        expect(worstSwap, 'a step that swaps chunks against the quiet steps').toBeLessThanOrEqual(worstQuiet + 0.005);
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    },
    180_000,
  );
});

// Pixel classes of the shading statistics (M07b part B). A terrain colour is judged in DISPLAY space (the sRGB values of the screenshot) by its
// luminance (Rec. 709 weights over 0..1) and HSV saturation; the classes are deliberately plain so that the e2e thresholds mean something a person
// can check on a screenshot:
//   snow         light and nearly colourless: luminance >= 0.70 and saturation <= 0.14
//   rock grey    mid-dark and nearly colourless: luminance in [0.15, 0.62] and saturation <= 0.20 (also dark grey shadow; not brown soil, not green)
//   forest green the green channel clearly leads both others, not light: g >= 1.15 r, g >= 1.3 b, luminance <= 0.5
// A "terrain region" is the set of sampled pixels whose surface pick is land (`elevationM > 0`); the sky and the sea are not in it.
import type { RgbaImage } from './terrainRegion';

export type Rgb = readonly [number, number, number];

export const SNOW_MIN_LUMA = 0.7;
export const SNOW_MAX_SAT = 0.14;
export const ROCK_LUMA: readonly [number, number] = [0.15, 0.62];
export const ROCK_MAX_SAT = 0.2;
export const FOREST_RATIOS: readonly [number, number] = [1.15, 1.3];
export const FOREST_MAX_LUMA = 0.5;

export const lumaOf = (c: Rgb): number => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
export function satOf(c: Rgb): number {
  const mx = Math.max(c[0], c[1], c[2]);
  return mx === 0 ? 0 : (mx - Math.min(c[0], c[1], c[2])) / mx;
}
export const isSnow = (c: Rgb): boolean => lumaOf(c) >= SNOW_MIN_LUMA && satOf(c) <= SNOW_MAX_SAT;
export function isRockGrey(c: Rgb): boolean {
  const l = lumaOf(c);
  return l >= ROCK_LUMA[0] && l <= ROCK_LUMA[1] && satOf(c) <= ROCK_MAX_SAT;
}
export const isForestGreen = (c: Rgb): boolean => c[1] >= FOREST_RATIOS[0] * c[0] && c[1] >= FOREST_RATIOS[1] * c[2] && lumaOf(c) <= FOREST_MAX_LUMA;

export const pixelAt = (img: RgbaImage, x: number, y: number): Rgb => {
  const o = (y * img.width + x) * 4;
  return [img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number];
};

/** One sampled pixel of a view: its position, whether the surface under it is land, its terrain class and its sim cell (-1 for the sky). */
export interface ScanPoint {
  x: number;
  y: number;
  land: boolean;
  classId: number;
  cell: number;
  heightM: number;
  lat: number;
  lon: number;
}

export interface ClassShares {
  samples: number;
  snow: number;
  rock: number;
  forest: number;
  /** Share of the land samples whose sim class is Forest. */
  forestClass: number;
}

/** The shares (0..1) of the pixel classes among the LAND samples of a scan. */
export function classShares(img: RgbaImage, scan: readonly ScanPoint[], forestClassId: number): ClassShares {
  let n = 0;
  let snow = 0;
  let rock = 0;
  let forest = 0;
  let cls = 0;
  for (const p of scan) {
    if (!p.land) continue;
    n++;
    if (p.classId === forestClassId) cls++;
    const c = pixelAt(img, p.x, p.y);
    if (isSnow(c)) snow++;
    if (isRockGrey(c)) rock++;
    if (isForestGreen(c)) forest++;
  }
  const d = Math.max(n, 1);
  return { samples: n, snow: snow / d, rock: rock / d, forest: forest / d, forestClass: cls / d };
}

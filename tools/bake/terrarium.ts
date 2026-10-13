// Terrarium z4 tiles to height grids.
//   1. Decode 256 tiles into one 4096 x 4096 Web Mercator grid (metres, Float32).
//   2. Clamp to [-DEPTH_MAX, LAND_MAX], remove isolated spikes with a 3 x 3 median filter.
//   3. Resample to the equirectangular render grid (4096 x 2048) with area weighting (mean and max per pixel).
//      Columns line up 1:1 (both span 360 degrees in 4096 samples); rows are weighted by latitude overlap.
//      Latitudes beyond the Mercator limit (about +-85.05) are filled synthetically.
import { PNG } from 'pngjs';
import { DEPTH_MAX_M, LAND_MAX_M, RENDER_HEIGHT, RENDER_WIDTH } from '../../src/data/format';
import { SPIKE_MEDIAN_DEVIATION_M } from './classify';
import { TERRARIUM_TILES } from './fetch';

export const MERC_SIZE = TERRARIUM_TILES * 256; // 4096
/** Latitude limit of Web Mercator in degrees. */
export const MERC_MAX_LAT = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;

/** Terrarium pixel to metres. */
export function terrariumHeight(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function decodeTiles(tiles: ReadonlyArray<Uint8Array>): Float32Array {
  const n = TERRARIUM_TILES;
  if (tiles.length !== n * n) throw new Error(`expected ${n * n} tiles, got ${tiles.length}`);
  const out = new Float32Array(MERC_SIZE * MERC_SIZE);
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const png = PNG.sync.read(Buffer.from(tiles[ty * n + tx] as Uint8Array));
      if (png.width !== 256 || png.height !== 256) throw new Error(`tile ${tx}/${ty} is ${png.width}x${png.height}, expected 256x256`);
      for (let py = 0; py < 256; py++) {
        const row = (ty * 256 + py) * MERC_SIZE + tx * 256;
        for (let px = 0; px < 256; px++) {
          const i = (py * 256 + px) * 4;
          out[row + px] = terrariumHeight(png.data[i] as number, png.data[i + 1] as number, png.data[i + 2] as number);
        }
      }
    }
  }
  return out;
}

/** Number of pixels clamped at the top (land) and bottom (depth). */
export interface ClampStats {
  clampedHigh: number;
  clampedLow: number;
  maxBefore: number;
  spikesReplaced: number;
  maxAfter: number;
}

/** Median of 9 values. */
function median9(a: Float32Array): number {
  // Insertion sort of nine entries; deterministic and fast enough for 16.7 M pixels.
  for (let i = 1; i < 9; i++) {
    const v = a[i] as number;
    let j = i - 1;
    while (j >= 0 && (a[j] as number) > v) {
      a[j + 1] = a[j] as number;
      j--;
    }
    a[j + 1] = v;
  }
  return a[4] as number;
}

/**
 * Clamps heights to [-DEPTH_MAX_M, LAND_MAX_M] and replaces a pixel with the median of its 3 x 3 neighbourhood when it
 * differs from that median by more than SPIKE_MEDIAN_DEVIATION_M. Longitude wraps, latitude is clamped at the edges.
 * Real peaks survive because z4 smoothing keeps them within a couple of hundred metres of their surroundings'
 * median; the two 11 500 m error pixels near 72.4 N 78.8 W do not.
 */
export function cleanHeights(h: Float32Array, size: number = MERC_SIZE): ClampStats {
  const stats: ClampStats = { clampedHigh: 0, clampedLow: 0, maxBefore: -Infinity, spikesReplaced: 0, maxAfter: -Infinity };
  for (let i = 0; i < h.length; i++) {
    const v = h[i] as number;
    if (v > stats.maxBefore) stats.maxBefore = v;
    if (v > LAND_MAX_M) {
      h[i] = LAND_MAX_M;
      stats.clampedHigh++;
    } else if (v < -DEPTH_MAX_M) {
      h[i] = -DEPTH_MAX_M;
      stats.clampedLow++;
    }
  }
  const src = Float32Array.from(h); // medians read the unfiltered values
  const win = new Float32Array(9);
  for (let y = 0; y < size; y++) {
    const ym = y === 0 ? 0 : y - 1;
    const yp = y === size - 1 ? y : y + 1;
    for (let x = 0; x < size; x++) {
      const xm = x === 0 ? size - 1 : x - 1;
      const xp = x === size - 1 ? 0 : x + 1;
      const c = src[y * size + x] as number;
      win[0] = src[ym * size + xm] as number;
      win[1] = src[ym * size + x] as number;
      win[2] = src[ym * size + xp] as number;
      win[3] = src[y * size + xm] as number;
      win[4] = c;
      win[5] = src[y * size + xp] as number;
      win[6] = src[yp * size + xm] as number;
      win[7] = src[yp * size + x] as number;
      win[8] = src[yp * size + xp] as number;
      const med = median9(win);
      if (Math.abs(c - med) > SPIKE_MEDIAN_DEVIATION_M) {
        h[y * size + x] = med;
        stats.spikesReplaced++;
      }
    }
  }
  for (let i = 0; i < h.length; i++) if ((h[i] as number) > stats.maxAfter) stats.maxAfter = h[i] as number;
  return stats;
}

/** Latitude (degrees) of the top edge of Mercator row r (r = 0 .. MERC_SIZE). */
function mercatorRowEdgeLat(r: number): number {
  const y = Math.PI * (1 - (2 * r) / MERC_SIZE);
  return (Math.atan(Math.sinh(y)) * 180) / Math.PI;
}

export interface RenderHeights {
  /** Area-weighted mean height per render pixel (metres), RENDER_WIDTH x RENDER_HEIGHT. */
  mean: Float32Array;
  /** Maximum source sample touching the pixel (metres). */
  max: Float32Array;
  /** Rows (from the north and from the south) that were filled synthetically. */
  syntheticRowsNorth: number;
  syntheticRowsSouth: number;
}

/** Resamples the Mercator grid to the render grid and fills the polar caps. */
export function resampleToRender(merc: Float32Array): RenderHeights {
  const W = RENDER_WIDTH;
  const H = RENDER_HEIGHT;
  const mean = new Float32Array(W * H);
  const max = new Float32Array(W * H);
  const dLat = 180 / H;
  const edges = new Float64Array(MERC_SIZE + 1);
  for (let r = 0; r <= MERC_SIZE; r++) edges[r] = mercatorRowEdgeLat(r);

  let firstReal = -1;
  let lastReal = -1;
  let r0 = 0;
  for (let j = 0; j < H; j++) {
    const top = 90 - j * dLat;
    const bot = 90 - (j + 1) * dLat;
    const lo = Math.max(bot, -MERC_MAX_LAT);
    const hi = Math.min(top, MERC_MAX_LAT);
    if (hi <= lo) continue; // entirely beyond the Mercator limit: polar fill below
    while (r0 < MERC_SIZE - 1 && (edges[r0 + 1] as number) >= hi) r0++;
    if (firstReal < 0) firstReal = j;
    lastReal = j;
    // Mercator rows r0.. with edges[r] (top) > lo overlap [lo, hi].
    let r = r0;
    const weights: number[] = [];
    const rows: number[] = [];
    let wsum = 0;
    while (r < MERC_SIZE && (edges[r] as number) > lo) {
      const rTop = Math.min(edges[r] as number, hi);
      const rBot = Math.max(edges[r + 1] as number, lo);
      const w = rTop - rBot;
      if (w > 0) {
        rows.push(r);
        weights.push(w);
        wsum += w;
      }
      r++;
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      let m = -Infinity;
      for (let k = 0; k < rows.length; k++) {
        const v = merc[(rows[k] as number) * MERC_SIZE + x] as number;
        s += v * (weights[k] as number);
        if (v > m) m = v;
      }
      mean[j * W + x] = s / wsum;
      max[j * W + x] = m;
    }
  }
  if (firstReal < 0) throw new Error('no render rows inside the Mercator range');

  // Polar fill: each polar row copies the nearest real row, smoothed along longitude with a box of +-POLAR_SMOOTH columns,
  // so the cap is a plausible plateau/ocean instead of the tile seam pattern. Deterministic and clearly synthetic.
  const smooth = (row: number): Float32Array => {
    const out = new Float32Array(W);
    const R = 32;
    let acc = 0;
    for (let k = -R; k <= R; k++) acc += mean[row * W + ((k + W) % W)] as number;
    for (let x = 0; x < W; x++) {
      out[x] = acc / (2 * R + 1);
      acc += (mean[row * W + ((x + R + 1) % W)] as number) - (mean[row * W + ((x - R + W) % W)] as number);
    }
    return out;
  };
  const north = smooth(firstReal);
  for (let j = 0; j < firstReal; j++) {
    mean.set(north, j * W);
    max.set(north, j * W);
  }
  const south = smooth(lastReal);
  for (let j = lastReal + 1; j < H; j++) {
    mean.set(south, j * W);
    max.set(south, j * W);
  }
  return { mean, max, syntheticRowsNorth: firstReal, syntheticRowsSouth: H - 1 - lastReal };
}

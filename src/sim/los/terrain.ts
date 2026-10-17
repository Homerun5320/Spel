// The height field of the LOS maths (M11a): per cell the ground and the effective occluder height in GAME metres (real height times
// GAMEPLAY_HEIGHT_EXAG), and the metres per cell of every row. Derived, read-only data built from the baked mean and max elevation;
// never serialised, never hashed. Pure integer arithmetic: the same in Node and Chromium.
import { EARTH_EQUATOR_M, EARTH_POLE_TO_POLE_M, GAMEPLAY_HEIGHT_EXAG, OCCLUDER_MAX_WEIGHT_PCT, WEIGHT_ONE } from '../rules';

export interface LosTerrain {
  readonly width: number;
  readonly height: number;
  /** Ground height in game metres per cell (sea level 0 for the sea). */
  readonly groundGm: Int32Array;
  /** Effective occluder height in game metres per cell: EXAG * (mean + weight * (max - mean)). */
  readonly occGm: Int32Array;
  /** East-west metres of a cell, per row (the Grid.cellWidthM rule). */
  readonly cellWidthM: Int32Array;
  /** North-south metres of a cell. */
  readonly cellHeightM: number;
}

export function createLosTerrain(width: number, height: number, rowCos: ArrayLike<number>, meanElev: ArrayLike<number>, maxElev: ArrayLike<number>, exag = GAMEPLAY_HEIGHT_EXAG, weightPct = OCCLUDER_MAX_WEIGHT_PCT): LosTerrain {
  const cells = width * height;
  const groundGm = new Int32Array(cells);
  const occGm = new Int32Array(cells);
  for (let c = 0; c < cells; c++) {
    const mean = meanElev[c] as number;
    if (mean <= 0) continue; // sea: no ground, no occluder
    const max = Math.max(mean, maxElev[c] as number);
    groundGm[c] = exag * mean;
    occGm[c] = exag * (mean + Math.floor((weightPct * (max - mean)) / 100));
  }
  const cellWidthM = new Int32Array(height);
  for (let y = 0; y < height; y++) cellWidthM[y] = Math.floor((EARTH_EQUATOR_M * (rowCos[y] as number)) / (width * WEIGHT_ONE));
  return { width, height, groundGm, occGm, cellWidthM, cellHeightM: Math.floor(EARTH_POLE_TO_POLE_M / height) };
}

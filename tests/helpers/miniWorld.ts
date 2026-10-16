// A small invented world with four countries, for the setup tests that need a hand-made situation: one narrow strip shared by two
// countries (so that the second country's disc comes out short once the first has spawned) and two roomy blocks.
import type { WorldData } from '../../src/app/matchWorld';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';

export const MINI_W = 200;
export const MINI_H = 100;

export const MINI_CAPITALS = {
  alpha: 32 * MINI_W + 30,
  beta: 32 * MINI_W + 48,
  gamma: 78 * MINI_W + 125,
  delta: 75 * MINI_W + 180,
} as const;

export function miniWorld(): WorldData {
  const n = MINI_W * MINI_H;
  const terrain = new Uint8Array(n).fill(CLASS_DEEP_SEA);
  const country = new Uint8Array(n);
  const put = (x0: number, x1: number, y0: number, y1: number, id: number): void => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        terrain[y * MINI_W + x] = CLASS_PLAINS;
        country[y * MINI_W + x] = id;
      }
    }
  };
  put(10, 39, 30, 35, 1); // Alpha: the west half of the strip (30 x 6 = 180 cells)
  put(40, 70, 30, 35, 2); // Beta: the east half (31 x 6 = 186 cells), the same land mass
  put(100, 150, 60, 95, 3); // Gamma: a roomy block
  put(165, 195, 60, 90, 4); // Delta: another
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta'];
  const caps = [MINI_CAPITALS.alpha, MINI_CAPITALS.beta, MINI_CAPITALS.gamma, MINI_CAPITALS.delta];
  const countries = names.map((name, i) => {
    let cells = 0;
    for (let k = 0; k < n; k++) if (country[k] === i + 1) cells++;
    return {
      id: i + 1,
      a3: name.slice(0, 3).toUpperCase(),
      name_en: name,
      name_sv: `${name}land`,
      name_long: name,
      continent: 'Testland',
      population: 1000,
      cells,
      weightedAreaKm2: 1,
      capitalCell: caps[i] as number,
      capitalSource: 'city' as const,
      capitalName: `${name} City`,
      playable: true,
    };
  });
  return {
    sim: { width: MINI_W, height: MINI_H, terrainClass: terrain, meanElev: new Int16Array(n), maxElev: new Int16Array(n), cosQ15: new Array<number>(MINI_H).fill(32768) },
    country,
    coast: new Uint8Array(n),
    meta: { countries },
    overrides: { merged: [], unplayable: [], minPlayableCells: 8, neutralNames: {} },
  };
}

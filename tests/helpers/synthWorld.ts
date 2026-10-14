// A hand-made world built from rectangles, for the setup tests that need an exact situation (a land mass of exactly K cells, two
// capitals exactly 17 cells apart, a merged territory, a Peak cell). Every country is given its capital cell and its terrain class.
import type { WorldData } from '../../src/app/matchWorld';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';

export interface SynthRect {
  readonly id: number;
  /** Inclusive x range (a range with x1 < x0 is not allowed; build two rects to wrap the seam). */
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly cls?: number;
}

export interface SynthCountry {
  readonly id: number;
  readonly a3: string;
  /** Capital cell as [x, y]. */
  readonly capital: readonly [number, number];
  readonly nameEn?: string;
  readonly nameSv?: string;
  readonly playable?: boolean;
  readonly continent?: string;
}

export interface SynthSpec {
  readonly width: number;
  readonly height: number;
  readonly rects: readonly SynthRect[];
  /** Single cells (after the rects): [x, y, id, class]. */
  readonly cells?: readonly (readonly [number, number, number, number])[];
  readonly countries: readonly SynthCountry[];
  readonly overrides?: Partial<WorldData['overrides']>;
}

export function synthWorld(spec: SynthSpec): WorldData {
  const { width, height } = spec;
  const n = width * height;
  const terrain = new Uint8Array(n).fill(CLASS_DEEP_SEA);
  const country = new Uint8Array(n);
  for (const r of spec.rects) {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        terrain[y * width + x] = r.cls ?? CLASS_PLAINS;
        country[y * width + x] = r.id;
      }
    }
  }
  for (const [x, y, id, cls] of spec.cells ?? []) {
    terrain[y * width + x] = cls;
    country[y * width + x] = id;
  }
  const countries = spec.countries.map((c) => {
    let cells = 0;
    for (let k = 0; k < n; k++) if (country[k] === c.id) cells++;
    return {
      id: c.id,
      a3: c.a3,
      name_en: c.nameEn ?? c.a3,
      name_sv: c.nameSv ?? `${c.a3}-sv`,
      name_long: c.a3,
      continent: c.continent ?? 'Testland',
      population: 1000,
      cells,
      weightedAreaKm2: 1,
      capitalCell: c.capital[1] * width + c.capital[0],
      capitalSource: 'city' as const,
      capitalName: `${c.a3} City`,
      playable: c.playable ?? true,
    };
  });
  return {
    sim: { width, height, terrainClass: terrain, meanElev: new Int16Array(n), cosQ15: new Array<number>(height).fill(32768) },
    country,
    coast: new Uint8Array(n),
    meta: { countries },
    overrides: { merged: [], unplayable: [], minPlayableCells: 8, neutralNames: {}, ...spec.overrides },
  };
}

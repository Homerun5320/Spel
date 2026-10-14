// The playable regions of a match (M06, item 4): the whole world or a Skirmish cut-out, each a union of latitude / longitude
// rectangles. THIS FILE IS THE DOCUMENTATION of the cut-outs; docs/DECISIONS.md D115 points here.
//
//  - A rectangle is in TENTHS of a degree (integers, so no float decides which cell is inside): south and north latitude, west and
//    east longitude (west < east, no rectangle crosses the antimeridian).
//  - A cell is inside when the CENTRE of the cell is inside a rectangle. Row 0 is north; the cell (x, y) of a W x H grid has the
//    latitude (H - 2y - 1) * 90 / H and the longitude (2x + 1 - W) * 180 / W degrees.
//  - The match world is the mask INTERSECTED WITH THE LAND: `maskTerrain` (src/sim/setup.ts) turns every playable cell outside the
//    mask into an unplayable one, so the sim's own playable grid keeps every Spawn and Attack inside it. Nothing south of 60 S is in
//    any rectangle (Antarctica is excluded), and the world region has no mask at all (Antarctica is Ice, hence unplayable, anyway).
//  - A country that straddles a border of a rectangle is cut: its cells outside simply cannot be owned. A country is selectable in a
//    region only if its capital cell is inside and its connected land mass INSIDE the mask has K cells (src/app/eligibility.ts).
//  - The edges are a game choice, not a political statement: they are straight lines through the stylised map.
//
//   europe             34.0 N to 72.0 N, 25.0 W to 45.0 E     (Iceland and Ireland to the Urals' western edge and the Black Sea coast)
//   eastAsia           10.0 N to 55.0 N, 95.0 E to 150.0 E    (China east of Nepal, Mongolia, Korea, Japan, Taiwan, mainland South-East Asia)
//   americas           56.0 S to 73.0 N, 170.0 W to 34.0 W    (Alaska to Tierra del Fuego, including Greenland's coast)
//   africaMiddleEast   35.0 S to 40.0 N, 20.0 W to 65.0 E     (Africa, the Arabian peninsula, the Levant, Iran's west)
export type RegionId = 'world' | 'europe' | 'eastAsia' | 'americas' | 'africaMiddleEast';

/** A latitude / longitude rectangle in tenths of a degree. */
export interface GeoRect {
  readonly south10: number;
  readonly north10: number;
  readonly west10: number;
  readonly east10: number;
}

export interface RegionDef {
  readonly id: RegionId;
  /** The rectangles, or null for the whole world (no mask). */
  readonly rects: readonly GeoRect[] | null;
}

export const REGIONS: readonly RegionDef[] = Object.freeze([
  { id: 'world', rects: null },
  { id: 'europe', rects: [{ south10: 340, north10: 720, west10: -250, east10: 450 }] },
  { id: 'eastAsia', rects: [{ south10: 100, north10: 550, west10: 950, east10: 1500 }] },
  { id: 'americas', rects: [{ south10: -560, north10: 730, west10: -1700, east10: -340 }] },
  { id: 'africaMiddleEast', rects: [{ south10: -350, north10: 400, west10: -200, east10: 650 }] },
]);

export const REGION_IDS: readonly RegionId[] = REGIONS.map((r) => r.id);

export function isRegionId(x: unknown): x is RegionId {
  return typeof x === 'string' && (REGION_IDS as readonly string[]).includes(x);
}

/** Is the centre of the cell (x, y) of a width x height grid inside the rectangle? Integer arithmetic only. */
export function cellInRect(x: number, y: number, width: number, height: number, r: GeoRect): boolean {
  const lat = (height - 2 * y - 1) * 900; // tenths of a degree times height
  const lon = (2 * x + 1 - width) * 1800; // tenths of a degree times width
  return lat >= r.south10 * height && lat <= r.north10 * height && lon >= r.west10 * width && lon <= r.east10 * width;
}

/** 1 for a cell inside the region, else 0 (every cell of the grid, sea included: the match world intersects it with the land). null for the whole world. */
export function regionMask(id: RegionId, width: number, height: number): Uint8Array | null {
  const def = REGIONS.find((r) => r.id === id);
  if (def === undefined || def.rects === null) return null;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const r of def.rects) {
        if (cellInRect(x, y, width, height, r)) {
          mask[y * width + x] = 1;
          break;
        }
      }
    }
  }
  return mask;
}

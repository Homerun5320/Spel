// The ship model (M13c-2): ONE merged procedural low-poly geometry (no asset file, no three), built in a unit disc (x forward = the bow, y up, z to the left, y = 0 the
// keel / waterline). Every vertex has a colour and a PART code in `tints`: 0 = neutral, 1 = owner colour (the deck and the hatch covers, so the owner reads from above).
// The wake is a flat white wedge behind the stern in the same geometry: it costs no draw call. A transport is a plain hull, a deckhouse with a bridge and two hatches.
import { MeshBuilder, type ModelData, type Rgb } from './structureModels';

export const SHIP_PART_NEUTRAL = 0;
export const SHIP_PART_OWNER = 1;

const HULL: Rgb = [0.34, 0.37, 0.42];
const DECK: Rgb = [0.72, 0.74, 0.76];
const HOUSE: Rgb = [0.86, 0.87, 0.88];
const GLASS: Rgb = [0.3, 0.45, 0.58];
const HATCH: Rgb = [0.25, 0.27, 0.3];
const WAKE: Rgb = [0.78, 0.88, 0.94];

/** The bow tip and the far end of the wake in model units (x forward). */
export const SHIP_BOW_X = 1.12;
export const SHIP_WAKE_X = -2.2;

type Section = readonly [number, number, number];

/** The ship: a four-point lofted hull, bow cone and stern plate, deckhouse with bridge, two hatches and the wake wedge. */
export function buildShip(): ModelData {
  const m = new MeshBuilder();
  // sections: x, half width, deck height
  const secs: readonly Section[] = [
    [-1.0, 0.2, 0.2],
    [-0.55, 0.26, 0.2],
    [0.35, 0.26, 0.2],
    [0.8, 0.15, 0.2],
  ];
  const ring = (s: Section, k: number): Rgb => {
    const [x, w, y] = s;
    // deck left, deck right, keel right, keel left
    switch (k % 4) {
      case 0:
        return [x, y, w];
      case 1:
        return [x, y, -w];
      case 2:
        return [x, 0, -w * 0.6];
      default:
        return [x, 0, w * 0.6];
    }
  };
  for (let i = 0; i + 1 < secs.length; i++) {
    const a = secs[i] as Section;
    const b = secs[i + 1] as Section;
    for (let k = 0; k < 4; k++) {
      const deck = k === 0;
      m.quad(ring(a, k), ring(a, k + 1), ring(b, k + 1), ring(b, k), deck ? DECK : HULL, deck ? SHIP_PART_OWNER : SHIP_PART_NEUTRAL);
    }
  }
  // the bow cone and the stern plate
  const tip: Rgb = [SHIP_BOW_X, 0.17, 0];
  const last = secs[secs.length - 1] as Section;
  for (let k = 0; k < 4; k++) m.tri(ring(last, k), ring(last, k + 1), tip, k === 0 ? DECK : HULL, k === 0 ? SHIP_PART_OWNER : SHIP_PART_NEUTRAL);
  const first = secs[0] as Section;
  m.quad(ring(first, 0), ring(first, 1), ring(first, 2), ring(first, 3), HULL, SHIP_PART_NEUTRAL);
  // deckhouse and bridge, two hatch covers
  m.box(-0.62, 0, 0.3, 0.32, 0.2, 0.42, 0, HOUSE, HOUSE, SHIP_PART_NEUTRAL);
  m.box(-0.62, 0, 0.18, 0.22, 0.42, 0.56, 0, GLASS, HOUSE, SHIP_PART_NEUTRAL);
  m.box(-0.05, 0, 0.36, 0.3, 0.2, 0.27, 0, HATCH, DECK, SHIP_PART_OWNER);
  m.box(0.4, 0, 0.3, 0.26, 0.2, 0.27, 0, HATCH, DECK, SHIP_PART_OWNER);
  // the wake: a wedge widening behind the stern and two streaks along the hull sides
  const wy = 0.03;
  m.quad([-1.0, wy, 0.1], [-1.0, wy, -0.1], [SHIP_WAKE_X, wy, -0.42], [SHIP_WAKE_X, wy, 0.42], WAKE, SHIP_PART_NEUTRAL);
  m.quad([-0.2, wy, 0.3], [-1.0, wy, 0.24], [-1.9, wy, 0.62], [-1.5, wy, 0.66], WAKE, SHIP_PART_NEUTRAL);
  m.quad([-0.2, wy, -0.3], [-1.0, wy, -0.24], [-1.9, wy, -0.62], [-1.5, wy, -0.66], WAKE, SHIP_PART_NEUTRAL);
  return m.done();
}

let cached: ModelData | null = null;
/** The model, built once. */
export function shipModel(): ModelData {
  cached ??= buildShip();
  return cached;
}

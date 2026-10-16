// The district models (Districts-2b): four tiny procedural low-poly models (at most 60 triangles each, no asset, no three) and the pure placement
// functions of the district layer. Unit radius: a model fits in a disc of radius 1 (x = outward from the City, z = along the ring, y up, y = 0 the
// floor of the slab; the foundation reaches below it so that a slope never leaves it floating). Tint 1 = the owner's colour.
import { DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_WALLS, districtSlotsOf } from '../sim/public';
import { DISTRICT_FADE_PX_HI, DISTRICT_FADE_PX_LO, DISTRICT_MODEL_UNIT, DISTRICT_RING_R, DISTRICT_SLOT_ANGLES } from './config';
import { districtLevelScale, levelScale } from './cityTiers';
import { MeshBuilder, type ModelData, type Rgb } from './structureModels';

export const DISTRICT_MODEL_MAX_TRIANGLES = 60;

const PLASTER: Rgb = [0.93, 0.86, 0.7];
const PLASTER_DARK: Rgb = [0.78, 0.68, 0.55];
const SLATE: Rgb = [0.34, 0.3, 0.3];
const STONE: Rgb = [0.74, 0.7, 0.62];
const STONE_DARK: Rgb = [0.5, 0.47, 0.43];
const WOOD: Rgb = [0.5, 0.36, 0.22];
const CLOTH: Rgb = [0.96, 0.95, 0.9];
const CRATE: Rgb = [0.66, 0.5, 0.28];
const OLIVE: Rgb = [0.38, 0.45, 0.3];
const OLIVE_DARK: Rgb = [0.27, 0.32, 0.22];
const SLAB: Rgb = [0.55, 0.52, 0.48];

/** Housing: four small blocks of different heights on a slab; two roofs in the owner's colour. 50 triangles. */
function buildHousing(): ModelData {
  const m = new MeshBuilder();
  m.box(0, 0, 1.8, 1.8, -0.4, 0.05, 0, SLAB, PLASTER_DARK, 0);
  const blocks: Array<[number, number, number, number, number, number]> = [
    [-0.42, -0.4, 0.62, 0.5, 0.5, 1],
    [0.42, -0.36, 0.55, 0.55, 0.78, 0],
    [-0.4, 0.42, 0.55, 0.5, 0.36, 0],
    [0.4, 0.42, 0.6, 0.5, 0.58, 1],
  ];
  blocks.forEach(([x, z, w, d, h, tint], i) => m.box(x, z, w, d, 0.05, 0.05 + h, i * 0.12, PLASTER, tint === 1 ? CLOTH : SLATE, tint));
  return m.done();
}

/** Market: a stall with a striped awning (owner colour and white), a counter, two posts and a crate. 58 triangles. */
function buildMarket(): ModelData {
  const m = new MeshBuilder();
  m.box(0, 0, 1.8, 1.8, -0.4, 0.05, 0, SLAB, STONE, 0);
  m.box(0, 0.2, 1.2, 0.4, 0.05, 0.34, 0, WOOD, CRATE, 0);
  m.box(-0.1, -0.5, 0.4, 0.35, 0.05, 0.3, 0.3, CRATE, WOOD, 0);
  m.beam([-0.7, 0.05, -0.3], [-0.7, 0.85, -0.3], 0.05, WOOD, 0);
  m.beam([0.7, 0.05, -0.3], [0.7, 0.85, -0.3], 0.05, WOOD, 0);
  // the awning: four stripes sloping from the back posts down over the counter
  for (let i = 0; i < 4; i++) {
    const x0 = -0.8 + i * 0.4;
    const x1 = x0 + 0.4;
    m.quad([x0, 0.9, -0.32], [x1, 0.9, -0.32], [x1, 0.62, 0.7], [x0, 0.62, 0.7], CLOTH, i % 2 === 0 ? 1 : 0);
  }
  return m.done();
}

/** Barracks: a hut with a gabled roof in the owner's colour, a tent and a tall flag pole with a big owner flag. 44 triangles. */
function buildBarracks(): ModelData {
  const m = new MeshBuilder();
  m.box(0, 0, 1.8, 1.8, -0.4, 0.05, 0, SLAB, OLIVE_DARK, 0);
  m.box(-0.15, -0.1, 1.1, 0.7, 0.05, 0.42, 0, OLIVE, OLIVE_DARK, 0);
  m.gable(-0.15, -0.1, 1.1, 0.7, 0.42, 0.66, 0, CLOTH, 1, OLIVE);
  m.pyramid(-0.4, 0.62, 0.55, 0.05, 0.5, OLIVE_DARK, 0);
  m.beam([0.62, 0.05, 0.5], [0.62, 1.35, 0.5], 0.035, STONE_DARK, 0);
  m.quad([0.62, 1.35, 0.5], [0.62 + 0.55, 1.28, 0.5], [0.62 + 0.55, 0.98, 0.5], [0.62, 1.0, 0.5], CLOTH, 1);
  return m.done();
}

/** Walls: an arc of four wall segments round a stout tower with an owner-coloured roof. 56 triangles. */
function buildWalls(): ModelData {
  const m = new MeshBuilder();
  const r = 0.72;
  for (const a of [-0.95, -0.5, 0.5, 0.95]) {
    m.box(Math.cos(a) * r, Math.sin(a) * r, 0.5, 0.2, -0.4, 0.5, a + Math.PI / 2, STONE, STONE_DARK, 0);
  }
  m.taperedPrism(4, r + 0.02, 0, 0.3, 0.26, -0.4, 1.0, STONE, STONE_DARK, 0, 0, Math.PI / 4);
  m.taperedPrism(4, r + 0.02, 0, 0.34, 0, 1.0, 1.45, CLOTH, CLOTH, 1, 1, Math.PI / 4);
  return m.done();
}

export interface DistrictModels {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly tints: Float32Array;
  /** The district kind (1..4) of every vertex: the vertex shader collapses the vertices of the kinds an instance is not. */
  readonly kinds: Float32Array;
  /** Triangles per kind (index = kind, 0 unused). */
  readonly trianglesByKind: readonly number[];
  /** Triangles in the merged geometry (the cost of one instance in `renderer.info`: the other kinds' triangles are collapsed, not skipped). */
  readonly triangles: number;
}

export const DISTRICT_BUILDERS: Readonly<Record<number, () => ModelData>> = {
  [DISTRICT_HOUSING]: buildHousing,
  [DISTRICT_MARKET]: buildMarket,
  [DISTRICT_BARRACKS]: buildBarracks,
  [DISTRICT_WALLS]: buildWalls,
};

/** The four models merged into one geometry (one draw call draws every kind). */
export function buildDistrictModels(): DistrictModels {
  const parts = [DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_WALLS].map((k) => ({ k, d: (DISTRICT_BUILDERS[k] as () => ModelData)() }));
  const tri = [0, 0, 0, 0, 0];
  let total = 0;
  for (const p of parts) {
    tri[p.k] = p.d.triangles;
    total += p.d.triangles;
  }
  const positions = new Float32Array(total * 9);
  const colors = new Float32Array(total * 9);
  const tints = new Float32Array(total * 3);
  const kinds = new Float32Array(total * 3);
  let v = 0;
  for (const p of parts) {
    positions.set(p.d.positions, v * 3);
    colors.set(p.d.colors, v * 3);
    tints.set(p.d.tints, v);
    kinds.fill(p.k, v, v + p.d.triangles * 3);
    v += p.d.triangles * 3;
  }
  return { positions, colors, tints, kinds, trianglesByKind: tri, triangles: total };
}

/** A slot's place in the City's model space (before the City's turn): x east, z north in City model units (the City's radius is 1), and the angle the model faces (+x outward). */
export function districtSlotModelOffset(slot: number): { x: number; z: number; angle: number } {
  const a = DISTRICT_SLOT_ANGLES[slot] ?? 0;
  return { x: Math.cos(a) * DISTRICT_RING_R, z: Math.sin(a) * DISTRICT_RING_R, angle: a };
}

/**
 * Where slot `slot` of a City of `cityLevel` stands, in metres east and north of the City's centre, for the City's turn `yaw` (the same rotation the
 * vertex shader applies) and `cityRadiusM` metres per model unit at level 1. Pure; `slot` beyond the City's slots gives null.
 */
export function districtSlotOffsetM(cityLevel: number, slot: number, yaw: number, cityRadiusM: number): { east: number; north: number } | null {
  if (slot < 0 || slot >= districtSlotsOf(cityLevel)) return null;
  const o = districtSlotModelOffset(slot);
  const s = cityRadiusM * levelScale(cityLevel);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return { east: (o.x * cy - o.z * sy) * s, north: (o.x * sy + o.z * cy) * s };
}

/** The radius of a district in metres (level `level`, City of `cityLevel`). */
export function districtRadiusM(cityLevel: number, level: number, cityRadiusM: number): number {
  return DISTRICT_MODEL_UNIT * cityRadiusM * levelScale(cityLevel) * districtLevelScale(level);
}

/** Projected radius in pixels of a district `radiusM` metres wide at camera distance `distM`. */
export function districtRadiusPx(radiusM: number, distM: number, viewH: number, tanHalfFov: number): number {
  return (radiusM / distM) * (viewH / 2 / tanHalfFov);
}

/** The shader's fade (1 = full, 0 = gone) as a function of the projected radius in pixels: smoothstep between DISTRICT_FADE_PX_LO and _HI. */
export function districtFade(px: number): number {
  const t = Math.min(1, Math.max(0, (px - DISTRICT_FADE_PX_LO) / (DISTRICT_FADE_PX_HI - DISTRICT_FADE_PX_LO)));
  return t * t * (3 - 2 * t);
}

/** The camera distance (metres) beyond which a district of `radiusM` is gone (its projected radius is below DISTRICT_FADE_PX_LO): the layer draws nothing past it. */
export function districtCutDistanceM(radiusM: number, viewH: number, tanHalfFov: number): number {
  return (radiusM * (viewH / 2 / tanHalfFov)) / DISTRICT_FADE_PX_LO;
}

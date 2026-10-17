// The structure models (M10): procedural low-poly geometry, no asset file, no three. One registry keyed by the sim's structure type number:
// a type is drawn when it has an entry here, and the layer (src/render/structures.ts) makes one instanced mesh per entry. Slice 1 registers
// the City only; Factory, Port, Silo, SAM and Post add an entry each and need no change anywhere else.
//
// MODEL SPACE. Unit radius: the model fits in a disc of radius 1 around the origin (x east, z north, y up, y = 0 is the ground, the foundation
// reaches below it so that the base never floats over a slope). `radiusM` is what one unit is in metres at true size; the layer multiplies
// by it, by the level scale and by the scale policy. Every vertex has a colour and a TINT: tint 1 takes the owner's colour, 0 keeps the
// model's own. Normals are not stored: the fragment shader takes the flat normal from screen derivatives (the stylised look of the terrain).
import type { CityStyle } from './cityTiers';
import { STRUCT_AIRFIELD, STRUCT_CITY, STRUCT_FACTORY, STRUCT_LAB, STRUCT_PLANT, STRUCT_PORT, STRUCT_POST, STRUCT_SAM, STRUCT_SILO } from '../sim/public';

export interface ModelData {
  /** x, y, z per vertex, three vertices per triangle (non-indexed). */
  readonly positions: Float32Array;
  /** r, g, b (sRGB 0 to 1) per vertex. */
  readonly colors: Float32Array;
  /** 0 = own colour, 1 = owner colour, per vertex. */
  readonly tints: Float32Array;
  /** Look-1: the first City band (0..4, see cityTiers.ts) in which each vertex is drawn; absent = every vertex always (0). */
  readonly bands?: Float32Array;
  readonly triangles: number;
}

export interface StructureModel {
  readonly name: string;
  /** Metres that one model unit is at true size and level 1. */
  readonly radiusM: number;
  /** True when the model has a front (a pier) that should point to the sea: the layer turns it to the water instead of a pseudo-random yaw. Its front is model +x. */
  readonly seaward?: boolean;
  build(style?: CityStyle): ModelData;
  /**
   * M18e-2: the type whose mesh holds this model. The models with the same `shared` value are concatenated in ONE geometry (in ascending type order) and every vertex
   * carries the model's kind (1, 2, ...); an instance carries the kind it shows and the vertex shader collapses the other models, so the types cost ONE draw call together.
   * Absent = the type has a mesh of its own.
   */
  readonly shared?: number;
}

export type Rgb = readonly [number, number, number];

/** Accumulates triangles. Winding is counter-clockwise seen from outside; the layer draws double-sided anyway, so a flipped face only shades differently. */
export class MeshBuilder {
  private readonly p: number[] = [];
  private readonly c: number[] = [];
  private readonly t: number[] = [];
  private readonly b: number[] = [];
  /** Look-1: the band (0..4) of the triangles added from now on (parts of a higher band appear only on a City of a higher level). */
  band = 0;

  tri(a: Rgb, b: Rgb, c: Rgb, color: Rgb, tint: number): void {
    for (const v of [a, b, c]) {
      this.p.push(v[0], v[1], v[2]);
      this.c.push(color[0], color[1], color[2]);
      this.t.push(tint);
      this.b.push(this.band);
    }
  }

  quad(a: Rgb, b: Rgb, c: Rgb, d: Rgb, color: Rgb, tint: number): void {
    this.tri(a, b, c, color, tint);
    this.tri(a, c, d, color, tint);
  }

  /** A box (no bottom) of footprint w x d, from y0 to y1, turned by `yaw` radians around its centre (cx, cz). Walls take `wall`, the flat top `top`. */
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, yaw: number, wall: Rgb, top: Rgb, topTint: number): void {
    const co = Math.cos(yaw);
    const si = Math.sin(yaw);
    const at = (x: number, z: number, y: number): Rgb => [cx + x * co - z * si, y, cz + x * si + z * co];
    const hw = w / 2;
    const hd = d / 2;
    const corners: Array<[number, number]> = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i] as [number, number];
      const [bx, bz] = corners[(i + 1) % 4] as [number, number];
      this.quad(at(ax, az, y0), at(bx, bz, y0), at(bx, bz, y1), at(ax, az, y1), wall, 0);
    }
    this.quad(at(-hw, -hd, y1), at(-hw, hd, y1), at(hw, hd, y1), at(hw, -hd, y1), top, topTint);
  }

  /** A gabled roof over a footprint (ridge along the local x axis): two slopes and two gable triangles. */
  gable(cx: number, cz: number, w: number, d: number, y0: number, y1: number, yaw: number, roof: Rgb, roofTint: number, gableColor: Rgb): void {
    const co = Math.cos(yaw);
    const si = Math.sin(yaw);
    const at = (x: number, z: number, y: number): Rgb => [cx + x * co - z * si, y, cz + x * si + z * co];
    const hw = w / 2;
    const hd = d / 2;
    this.quad(at(-hw, -hd, y0), at(hw, -hd, y0), at(hw, 0, y1), at(-hw, 0, y1), roof, roofTint);
    this.quad(at(hw, hd, y0), at(-hw, hd, y0), at(-hw, 0, y1), at(hw, 0, y1), roof, roofTint);
    this.tri(at(-hw, hd, y0), at(-hw, -hd, y0), at(-hw, 0, y1), gableColor, 0);
    this.tri(at(hw, -hd, y0), at(hw, hd, y0), at(hw, 0, y1), gableColor, 0);
  }

  /** A four-sided pyramid (a spire). */
  pyramid(cx: number, cz: number, w: number, y0: number, y1: number, color: Rgb, tint: number): void {
    const h = w / 2;
    const apex: Rgb = [cx, y1, cz];
    const k: Rgb[] = [
      [cx - h, y0, cz - h],
      [cx + h, y0, cz - h],
      [cx + h, y0, cz + h],
      [cx - h, y0, cz + h],
    ];
    for (let i = 0; i < 4; i++) this.tri(k[i] as Rgb, k[(i + 1) % 4] as Rgb, apex, color, tint);
  }

  /** An n-sided prism (a chimney, a tank) at (cx, cz): wall from y0 to y1, top face at y1. */
  column(n: number, cx: number, cz: number, r: number, y0: number, y1: number, wall: Rgb, top: Rgb, topTint: number): void {
    const ring = (y: number, k: number): Rgb => [cx + Math.cos((k / n) * Math.PI * 2) * r, y, cz + Math.sin((k / n) * Math.PI * 2) * r];
    for (let k = 0; k < n; k++) {
      this.quad(ring(y0, k), ring(y0, k + 1), ring(y1, k + 1), ring(y1, k), wall, 0);
      this.tri([cx, y1, cz], ring(y1, k + 1), ring(y1, k), top, topTint);
    }
  }

  /** A regular n-gon plate: top face at y1, wall down to y0, around the origin with radius r. */
  plate(n: number, r: number, y0: number, y1: number, top: Rgb, topTint: number, side: Rgb): void {
    const ring = (y: number, k: number): Rgb => [Math.cos(((k + 0.5) / n) * Math.PI * 2) * r, y, Math.sin(((k + 0.5) / n) * Math.PI * 2) * r];
    const centre: Rgb = [0, y1, 0];
    for (let k = 0; k < n; k++) {
      this.tri(centre, ring(y1, k + 1), ring(y1, k), top, topTint);
      this.quad(ring(y1, k), ring(y1, k + 1), ring(y0, k + 1), ring(y0, k), side, 0);
    }
  }

  /** A flat n-gon at height y (top face only) around the origin, turned by half a step like `plate`. */
  disc(n: number, r: number, y: number, color: Rgb, tint: number): void {
    const ring = (k: number): Rgb => [Math.cos(((k + 0.5) / n) * Math.PI * 2) * r, y, Math.sin(((k + 0.5) / n) * Math.PI * 2) * r];
    for (let k = 0; k < n; k++) this.tri([0, y, 0], ring(k + 1), ring(k), color, tint);
  }

  /** A tapered n-sided prism (a frustum) around (cx, cz): radius r0 at y0, r1 at y1, side walls plus a top cap (tint `topTint`); no bottom. */
  taperedPrism(n: number, cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, side: Rgb, top: Rgb, topTint: number, sideTint = 0, turn = 0): void {
    const ring = (k: number, r: number, y: number): Rgb => [cx + Math.cos(((k + 0.5) / n) * Math.PI * 2 + turn) * r, y, cz + Math.sin(((k + 0.5) / n) * Math.PI * 2 + turn) * r];
    const c: Rgb = [cx, y1, cz];
    for (let k = 0; k < n; k++) {
      this.quad(ring(k, r0, y0), ring(k + 1, r0, y0), ring(k + 1, r1, y1), ring(k, r1, y1), side, sideTint);
      if (r1 > 0) this.tri(c, ring(k + 1, r1, y1), ring(k, r1, y1), top, topTint);
    }
  }

  /** An n-sided tube (walls only, no caps) around (cx, cz): radius r0 at y0, r1 at y1. A stack of them makes a curved body (a cooling tower) without hidden caps. */
  tube(n: number, cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, color: Rgb, tint: number): void {
    const ring = (k: number, r: number, y: number): Rgb => [cx + Math.cos(((k + 0.5) / n) * Math.PI * 2) * r, y, cz + Math.sin(((k + 0.5) / n) * Math.PI * 2) * r];
    for (let k = 0; k < n; k++) this.quad(ring(k, r0, y0), ring(k + 1, r0, y0), ring(k + 1, r1, y1), ring(k, r1, y1), color, tint);
  }

  /** A square-sectioned beam from point a to point b with half-width h (open ends capped). Used for tubes and rails at an angle. */
  beam(a: Rgb, b: Rgb, h: number, color: Rgb, tint: number, cap: Rgb = color): void {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0] as number, d[1] as number, d[2] as number);
    const f = [(d[0] as number) / len, (d[1] as number) / len, (d[2] as number) / len];
    // a side vector perpendicular to the axis (the axis is never vertical in the models that use it, or the cross product falls back to x)
    let sx = f[2] as number;
    const sy = 0;
    let sz = -(f[0] as number);
    const sl = Math.hypot(sx, sz);
    if (sl < 1e-6) {
      sx = 1;
      sz = 0;
    } else {
      sx /= sl;
      sz /= sl;
    }
    // u = f x s
    const ux = (f[1] as number) * sz - (f[2] as number) * sy;
    const uy = (f[2] as number) * sx - (f[0] as number) * sz;
    const uz = (f[0] as number) * sy - (f[1] as number) * sx;
    const corner = (p: Rgb, i: number): Rgb => {
      const a1 = i === 0 || i === 3 ? -1 : 1;
      const b1 = i < 2 ? -1 : 1;
      return [p[0] + (sx * a1 + ux * b1) * h, p[1] + (sy * a1 + uy * b1) * h, p[2] + (sz * a1 + uz * b1) * h];
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(corner(a, i), corner(a, j), corner(b, j), corner(b, i), color, tint);
    }
    this.quad(corner(b, 0), corner(b, 1), corner(b, 2), corner(b, 3), cap, tint);
  }

  done(): ModelData {
    return { positions: Float32Array.from(this.p), colors: Float32Array.from(this.c), tints: Float32Array.from(this.t), bands: Float32Array.from(this.b), triangles: this.p.length / 9 };
  }
}

const WALL_A: Rgb = [0.86, 0.82, 0.74];
const WALL_B: Rgb = [0.78, 0.74, 0.68];
const WALL_C: Rgb = [0.9, 0.88, 0.84];
const FLAT_ROOF: Rgb = [0.5, 0.5, 0.52];
const SLATE: Rgb = [0.34, 0.3, 0.3];
const PLATE_SIDE: Rgb = [0.3, 0.28, 0.26];
const PLATE_TOP: Rgb = [0.92, 0.92, 0.92];
const PLATE_RIM: Rgb = [0.93, 0.9, 0.82];

/**
 * The City: a town cluster of about 20 blocks on an owner-coloured octagonal plate. A tall tower with a spire in the middle (the silhouette
 * from far away), five mid-rise blocks around it and seven low gabled houses on the outer ring; the plate shows the owner from above.
 */
function buildCity(): ModelData {
  const m = new MeshBuilder();
  // a pale stone rim (it reads against any territory colour from far away) round an owner-coloured disc
  m.plate(8, 1.0, -0.22, 0.04, PLATE_RIM, 0, PLATE_SIDE);
  m.disc(8, 0.8, 0.055, PLATE_TOP, 1);
  // Look-1 bands: 0 hamlet (3 houses), 1 village (7 houses), 2 town (tower and two blocks), 3 city (three more blocks), 4 metropolis (two high-rises)
  m.band = 2;
  m.box(0, 0, 0.26, 0.26, 0.04, 0.7, 0.3, WALL_C, FLAT_ROOF, 0);
  m.pyramid(0, 0, 0.26, 0.7, 1.0, PLATE_TOP, 1);
  // five mid-rise blocks on a ring of radius 0.42
  const mid: Array<[number, number, number]> = [
    [0.1, 0.36, 0.34],
    [0.8, 0.38, 0.28],
    [1.5, 0.4, 0.38],
    [2.2, 0.36, 0.3],
    [2.9, 0.4, 0.34],
  ];
  mid.forEach(([ang, w, h], i) => {
    m.band = i < 2 ? 2 : 3;
    const a = ang * 2.0;
    m.box(Math.cos(a) * 0.42, Math.sin(a) * 0.42, w * 0.5, w * 0.42, 0.04, 0.04 + h, a + 0.4, i % 2 === 0 ? WALL_A : WALL_B, FLAT_ROOF, 0);
  });
  // seven gabled houses on the outer ring of radius 0.76
  for (let i = 0; i < 7; i++) {
    m.band = i < 3 ? 0 : 1;
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const h = 0.12 + (i % 3) * 0.04;
    const x = Math.cos(a) * 0.76;
    const z = Math.sin(a) * 0.76;
    m.box(x, z, 0.26, 0.18, 0.04, 0.04 + h, a, i % 2 === 0 ? WALL_B : WALL_A, SLATE, 0);
    m.gable(x, z, 0.26, 0.18, 0.04 + h, 0.04 + h + 0.08, a, SLATE, i % 3 === 0 ? 1 : 0, WALL_A);
  }
  // the metropolis band: two high-rises beside the central tower
  m.band = 4;
  m.box(0.2, 0.2, 0.17, 0.17, 0.04, 0.58, 0.6, WALL_B, FLAT_ROOF, 0);
  m.box(-0.22, -0.15, 0.16, 0.16, 0.04, 0.5, 0.2, WALL_A, FLAT_ROOF, 0);
  return m.done();
}

const GLASS_A: Rgb = [0.5, 0.7, 0.82];
const GLASS_B: Rgb = [0.4, 0.58, 0.72];
const STEEL: Rgb = [0.64, 0.68, 0.72];
const CAP_LIGHT: Rgb = [0.93, 0.95, 0.97];

/**
 * Look-1, the 'Modern' City: the same plate and the same footprint rules as the old one, but boxy glass and steel towers of different heights
 * with flat roofs under a lighter cap; the tallest tower's cap takes the owner's colour. Bands as in `buildCity` (low blocks, more low blocks,
 * two mid towers, two tall towers, the central high-rise and one more). About 222 triangles; with the night lights under 260.
 */
function buildCityModern(): ModelData {
  const m = new MeshBuilder();
  m.plate(8, 1.0, -0.22, 0.04, PLATE_RIM, 0, PLATE_SIDE);
  m.disc(8, 0.8, 0.055, PLATE_TOP, 1);
  const tower = (band: number, ang: number, r: number, w: number, d: number, h: number, wall: Rgb, capTint = 0): void => {
    m.band = band;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    m.box(x, z, w, d, 0.04, 0.04 + h, ang, wall, STEEL, 0);
    if (h > 0.3) m.box(x, z, w + 0.03, d + 0.03, 0.04 + h, 0.07 + h, ang, CAP_LIGHT, CAP_LIGHT, capTint);
  };
  for (const a of [0.5, 2.6, 4.7]) tower(0, a, 0.62, 0.3, 0.22, 0.14, STEEL);
  for (const a of [1.5, 3.6, 5.5, 0.0]) tower(1, a, 0.7, 0.28, 0.2, 0.2, GLASS_B);
  tower(2, 1.0, 0.4, 0.3, 0.26, 0.38, GLASS_A);
  tower(2, 4.0, 0.4, 0.3, 0.26, 0.34, GLASS_B);
  tower(3, 2.5, 0.3, 0.26, 0.26, 0.66, GLASS_A);
  tower(3, 5.3, 0.3, 0.26, 0.24, 0.6, GLASS_B);
  tower(4, 0, 0, 0.3, 0.3, 1.0, GLASS_A, 1);
  tower(4, 0.3, 0.5, 0.24, 0.24, 0.8, GLASS_B);
  return m.done();
}

const BRICK: Rgb = [0.55, 0.28, 0.22];
const HALL: Rgb = [0.62, 0.64, 0.68];
const TANK: Rgb = [0.74, 0.76, 0.78];
const CRANE: Rgb = [0.95, 0.72, 0.12];
const DECK: Rgb = [0.5, 0.38, 0.26];
const CONTAINER_A: Rgb = [0.3, 0.45, 0.62];
const CONTAINER_B: Rgb = [0.72, 0.38, 0.24];

/**
 * The Factory: a long industrial hall with an owner-coloured roof, two brick chimneys (the tall one is the silhouette from far away, with an
 * owner-coloured cap), a storage tank and a low annex, on the same pale rim and owner-coloured disc as the City.
 */
function buildFactory(): ModelData {
  const m = new MeshBuilder();
  m.plate(8, 1.0, -0.22, 0.04, PLATE_RIM, 0, PLATE_SIDE);
  m.disc(8, 0.8, 0.055, PLATE_TOP, 1);
  // the hall (long along x) and its gabled roof in the owner's colour
  m.box(-0.12, 0.08, 0.86, 0.5, 0.04, 0.34, 0, HALL, FLAT_ROOF, 0);
  m.gable(-0.12, 0.08, 0.86, 0.5, 0.34, 0.5, 0, FLAT_ROOF, 1, HALL);
  // chimneys behind the hall: tall + short
  m.column(6, 0.46, -0.36, 0.09, 0.04, 0.98, BRICK, SLATE, 0);
  m.column(6, 0.46, -0.36, 0.115, 0.82, 0.98, WALL_A, PLATE_TOP, 1);
  m.column(6, 0.24, -0.42, 0.065, 0.04, 0.66, BRICK, SLATE, 0);
  // a storage tank and a low annex in front
  m.column(8, -0.55, -0.5, 0.15, 0.04, 0.3, TANK, TANK, 0);
  m.box(0.5, 0.42, 0.4, 0.28, 0.04, 0.22, 0.2, WALL_B, FLAT_ROOF, 0);
  return m.done();
}

/**
 * The Port: a pier (model +x, the layer turns it to the sea) with a yellow gantry crane at its end, a warehouse and a stack of containers
 * on the land side, on the owner-coloured disc. The pier is the only thing that reaches the rim, over the water.
 */
function buildPort(): ModelData {
  const m = new MeshBuilder();
  m.plate(8, 1.0, -0.22, 0.04, PLATE_RIM, 0, PLATE_SIDE);
  m.disc(8, 0.8, 0.055, PLATE_TOP, 1);
  // the pier: a long low deck from the land to over the water
  m.box(0.6, 0, 0.7, 0.22, -0.16, 0.075, 0, DECK, DECK, 0);
  // the gantry crane: a tower, a long jib over the water and a counterweight
  m.box(0.55, 0, 0.12, 0.12, 0.075, 0.6, 0, CRANE, CRANE, 0);
  m.box(0.68, 0, 0.6, 0.07, 0.6, 0.67, 0, CRANE, CRANE, 0);
  m.box(0.4, 0, 0.1, 0.12, 0.6, 0.72, 0, FLAT_ROOF, FLAT_ROOF, 0);
  // a warehouse and three containers (owner-coloured lids) on the land side
  m.box(-0.45, 0.35, 0.5, 0.34, 0.04, 0.22, 0.2, WALL_A, SLATE, 0);
  m.gable(-0.45, 0.35, 0.5, 0.34, 0.22, 0.32, 0.2, SLATE, 0, WALL_B);
  m.box(-0.3, -0.38, 0.3, 0.14, 0.04, 0.16, 0.1, CONTAINER_A, PLATE_TOP, 1);
  m.box(-0.02, -0.4, 0.3, 0.14, 0.04, 0.16, 0.1, CONTAINER_B, PLATE_TOP, 1);
  m.box(-0.16, -0.38, 0.3, 0.14, 0.16, 0.28, 0.1, CONTAINER_A, PLATE_TOP, 1);
  return m.done();
}

// --- M10-3: Silo, SAM site, Defense Post ---------------------------------------------------------------------------------------------
// Each sits on the same kind of owner-coloured plate as the City (so the owner reads from above), with a silhouette of its own: the Silo is LOW
// with a missile standing on a pad, the SAM site is a launcher rack with a big turning dish, the Post is the only TALL SLIM tower inside a wall ring.
const CONCRETE: Rgb = [0.62, 0.62, 0.6];
const CONCRETE_DARK: Rgb = [0.4, 0.4, 0.42];
const HATCH: Rgb = [0.22, 0.23, 0.26];
const PAD: Rgb = [0.3, 0.3, 0.32];
const MISSILE: Rgb = [0.93, 0.93, 0.9];
const OLIVE: Rgb = [0.36, 0.42, 0.3];
const STONE: Rgb = [0.74, 0.7, 0.62];
const STONE_DARK: Rgb = [0.55, 0.52, 0.47];
const SPIN = 2; // aTint offset: the part turns round the model's y axis (the SAM dish)

/** The Silo: a squat round bunker with a split hatch opening in a V, and a launch pad with a missile standing on it. */
function buildSilo(): ModelData {
  const m = new MeshBuilder();
  m.plate(8, 1.0, -0.22, 0.04, PLATE_RIM, 0, PLATE_SIDE);
  m.disc(8, 0.8, 0.055, PLATE_TOP, 1);
  // the bunker: a wide low frustum with a flat roof, west of the centre
  m.taperedPrism(10, -0.28, 0, 0.5, 0.4, 0.05, 0.3, CONCRETE, CONCRETE_DARK, 0);
  // the hatch: a dark slot in the roof with two door leaves swung up in a V
  m.box(-0.28, 0, 0.5, 0.3, 0.3, 0.31, 0, HATCH, HATCH, 0);
  m.quad([-0.53, 0.31, -0.15], [-0.03, 0.31, -0.15], [-0.03, 0.46, -0.3], [-0.53, 0.46, -0.3], CONCRETE_DARK, 0);
  m.quad([-0.03, 0.31, 0.15], [-0.53, 0.31, 0.15], [-0.53, 0.46, 0.3], [-0.03, 0.46, 0.3], CONCRETE_DARK, 0);
  // the pad: a dark slab east of the bunker with an owner-coloured stripe, and the missile standing on it
  m.box(0.52, 0, 0.5, 0.56, 0.05, 0.1, 0, PAD, PAD, 0);
  m.box(0.52, 0.2, 0.5, 0.06, 0.1, 0.105, 0, PAD, PLATE_TOP, 1);
  m.box(0.52, -0.2, 0.5, 0.06, 0.1, 0.105, 0, PAD, PLATE_TOP, 1);
  m.taperedPrism(6, 0.52, 0, 0.1, 0.1, 0.1, 0.72, MISSILE, MISSILE, 0);
  m.taperedPrism(6, 0.52, 0, 0.1, 0, 0.72, 0.98, PLATE_TOP, PLATE_TOP, 1, 1); // the nose cone takes the owner colour
  m.beam([0.52, 0.1, 0.1], [0.52, 0.28, 0.24], 0.02, MISSILE, 0); // two small fins
  m.beam([0.52, 0.1, -0.1], [0.52, 0.28, -0.24], 0.02, MISSILE, 0);
  return m.done();
}

/** The SAM site: a hexagonal pedestal with a rack of two angled launch tubes, and a tall mast with a big dish that turns (aTint >= 2). */
function buildSam(): ModelData {
  const m = new MeshBuilder();
  m.plate(8, 1.0, -0.22, 0.04, PLATE_RIM, 0, PLATE_SIDE);
  m.disc(8, 0.8, 0.055, PLATE_TOP, 1);
  m.taperedPrism(6, 0, 0, 0.3, 0.22, 0.05, 0.22, CONCRETE, CONCRETE_DARK, 0);
  // the launcher rack: two tubes pointing up and to the west, a frame between them
  m.beam([-0.12, 0.16, -0.26], [-0.62, 0.5, -0.26], 0.07, OLIVE, 0, HATCH);
  m.beam([-0.12, 0.16, 0.26], [-0.62, 0.5, 0.26], 0.07, OLIVE, 0, HATCH);
  m.beam([-0.4, 0.34, -0.26], [-0.4, 0.34, 0.26], 0.035, CONCRETE_DARK, 0);
  // the turning part: a mast and a dish on an arm to the east. The dish is a cone opening towards +x with a rim.
  m.taperedPrism(5, 0, 0, 0.05, 0.05, 0.22, 0.84, CONCRETE, CONCRETE, SPIN);
  m.beam([0, 0.82, 0], [0.12, 0.9, 0], 0.025, HATCH, SPIN);
  const apex: Rgb = [0.12, 0.9, 0];
  const rim = (k: number, x: number, r: number): Rgb => [x, 0.96 + Math.cos(((k + 0.5) / 7) * Math.PI * 2) * r, Math.sin(((k + 0.5) / 7) * Math.PI * 2) * r];
  for (let k = 0; k < 7; k++) {
    m.tri(apex, rim(k, 0.46, 0.3), rim(k + 1, 0.46, 0.3), MISSILE, SPIN + 1); // the dish face: a shallow bowl in the owner colour
    m.quad(rim(k, 0.46, 0.3), rim(k, 0.4, 0.26), rim(k + 1, 0.4, 0.26), rim(k + 1, 0.46, 0.3), CONCRETE_DARK, SPIN);
  }
  m.beam([0.12, 0.9, 0], [0.42, 0.96, 0], 0.025, HATCH, SPIN); // the feed horn
  return m.done();
}

/** The Defense Post: a slim tower with a crenellated top and an owner-coloured flag, inside a low octagonal wall ring with corner posts. */
function buildPost(): ModelData {
  const m = new MeshBuilder();
  m.plate(8, 1.0, -0.22, 0.04, PLATE_RIM, 0, PLATE_SIDE);
  m.disc(8, 0.78, 0.055, PLATE_TOP, 1);
  // the wall ring: eight short wall segments round a circle of radius 0.78
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    m.box(Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0.5, 0.07, 0.04, 0.17, a + Math.PI / 2, STONE, STONE_DARK, 0);
  }
  // the tower: a tall slim frustum, a wider crenellated platform and a flag
  m.taperedPrism(4, 0, 0, 0.3, 0.2, 0.04, 0.82, STONE, STONE_DARK, 0, 0, Math.PI / 4);
  m.box(0, 0, 0.5, 0.5, 0.82, 0.9, 0.0, STONE_DARK, STONE_DARK, 0);
  for (const [x, z] of [[-0.21, -0.21], [0.21, -0.21], [0.21, 0.21], [-0.21, 0.21]] as Array<[number, number]>) m.box(x, z, 0.12, 0.12, 0.9, 1.0, 0, STONE, STONE, 0);
  m.beam([0, 0.9, 0], [0, 1.28, 0], 0.012, HATCH, 0);
  m.quad([0, 1.28, 0], [0.34, 1.23, 0], [0.34, 1.12, 0], [0, 1.15, 0], PLATE_TOP, 1);
  return m.done();
}

// --- M18e-2: Airfield, Lab and Plant ---------------------------------------------------------------------------------------------------
// Three models in ONE shared mesh (see `shared` above). Each sits on the usual pale rim and owner-coloured disc, with a silhouette of its own: the Airfield is
// FLAT (a runway across the plate with a control tower and a hangar: from above it reads like a landing pad), the Lab is a low building with a glass dome and
// a tall antenna (research), the Plant is a cooling tower with a steam puff beside a tall banded chimney (the power station).
const LIGHT_BULB: Rgb = [1, 0.88, 0.55];
const ASPHALT: Rgb = [0.2, 0.21, 0.23];
const MARK: Rgb = [0.95, 0.95, 0.92];
const GLASS_DOME: Rgb = [0.55, 0.78, 0.86];
const RED_BAND: Rgb = [0.78, 0.2, 0.18];
const COOLING: Rgb = [0.8, 0.79, 0.76];
const STEAM: Rgb = [0.96, 0.97, 0.98];
/** Tint code of the always-lit-at-night bulb (light number 1: lit on the night side from level 1, see the vertex shader). */
const NIGHT_BULB_TINT = 4;

/** A small flattened octahedron of 8 triangles (a night lamp, `tint` 4 = lit at night, or a puff of steam with tint 0). */
function bulb(m: MeshBuilder, cx: number, y: number, cz: number, r: number, h: number, color: Rgb, tint: number): void {
  const top: Rgb = [cx, y + h, cz];
  const bot: Rgb = [cx, y - h, cz];
  const ring: Rgb[] = [[cx + r, y, cz], [cx, y, cz + r], [cx - r, y, cz], [cx, y, cz - r]];
  for (let i = 0; i < 4; i++) {
    m.tri(ring[i] as Rgb, ring[(i + 1) % 4] as Rgb, top, color, tint);
    m.tri(ring[(i + 1) % 4] as Rgb, ring[i] as Rgb, bot, color, tint);
  }
}

function plateAndDisc(m: MeshBuilder): void {
  m.plate(8, 1.0, -0.22, 0.04, PLATE_RIM, 0, PLATE_SIDE);
  m.disc(8, 0.8, 0.055, PLATE_TOP, 1);
}

/** The Airfield: a runway with dashes and owner-coloured thresholds across the plate, a control tower with a glass cab, a hangar with an owner-coloured roof and a parked plane. */
function buildAirfield(): ModelData {
  const m = new MeshBuilder();
  plateAndDisc(m);
  m.box(0, 0.02, 1.56, 0.3, 0.04, 0.075, 0, ASPHALT, ASPHALT, 0); // the runway along x
  m.box(-0.3, -0.27, 0.16, 0.34, 0.04, 0.07, 0, ASPHALT, ASPHALT, 0); // the taxiway to the hangar
  for (let i = 0; i < 5; i++) {
    const x = -0.56 + i * 0.28;
    m.quad([x - 0.07, 0.085, -0.01], [x + 0.07, 0.085, -0.01], [x + 0.07, 0.085, 0.05], [x - 0.07, 0.085, 0.05], MARK, 0); // centre dashes
  }
  for (const s of [-1, 1]) m.quad([s * 0.7, 0.085, -0.12], [s * 0.76, 0.085, -0.12], [s * 0.76, 0.085, 0.16], [s * 0.7, 0.085, 0.16], MARK, 1); // thresholds in the owner colour
  // the tower: a slim shaft, a glass cab with an owner-coloured cap and a short mast
  m.box(0.3, 0.42, 0.13, 0.13, 0.04, 0.46, 0, WALL_C, WALL_C, 0);
  m.box(0.3, 0.42, 0.26, 0.26, 0.46, 0.57, 0, GLASS_B, CONCRETE_DARK, 0);
  m.box(0.3, 0.42, 0.3, 0.3, 0.57, 0.6, 0, WALL_C, PLATE_TOP, 1);
  m.beam([0.3, 0.6, 0.42], [0.3, 0.84, 0.42], 0.012, HATCH, 0);
  // the hangar: a hall with a dark door and a gabled roof in the owner's colour
  m.box(-0.32, -0.55, 0.62, 0.34, 0.04, 0.2, 0, HALL, FLAT_ROOF, 0);
  m.gable(-0.32, -0.55, 0.62, 0.34, 0.2, 0.3, 0, FLAT_ROOF, 1, HALL);
  m.quad([-0.52, 0.04, -0.375], [-0.12, 0.04, -0.375], [-0.12, 0.17, -0.375], [-0.52, 0.17, -0.375], HATCH, 0);
  // a parked plane on the apron: fuselage, wings, tail
  m.box(0.4, -0.5, 0.36, 0.07, 0.08, 0.15, 0.35, MARK, MARK, 0);
  m.box(0.4, -0.5, 0.09, 0.4, 0.1, 0.12, 0.35, MARK, MARK, 0);
  m.box(0.25, -0.44, 0.07, 0.16, 0.14, 0.22, 0.35, MARK, PLATE_TOP, 1);
  return m.done();
}

/** The Lab: a low white building with an owner-coloured roof stripe, a wing, a glass dome on a drum (cap in the owner colour) and a tall antenna with cross-bars and a night beacon. */
function buildLab(): ModelData {
  const m = new MeshBuilder();
  plateAndDisc(m);
  m.box(-0.18, 0.08, 0.85, 0.5, 0.04, 0.26, 0, WALL_C, FLAT_ROOF, 0);
  m.box(-0.18, 0.08, 0.86, 0.12, 0.26, 0.285, 0, WALL_C, PLATE_TOP, 1);
  m.box(0.42, -0.32, 0.4, 0.36, 0.04, 0.2, 0, WALL_A, FLAT_ROOF, 0);
  m.box(-0.18, 0.37, 0.3, 0.04, 0.04, 0.16, 0, HATCH, HATCH, 0); // an entrance
  // the dome: a drum and three stacked rings of a ten-sided hemisphere
  const dx = -0.4;
  const dz = 0.05;
  m.tube(10, dx, dz, 0.27, 0.27, 0.285, 0.34, WALL_C, 0);
  m.tube(10, dx, dz, 0.27, 0.22, 0.34, 0.45, GLASS_DOME, 0);
  m.tube(10, dx, dz, 0.22, 0.13, 0.45, 0.54, GLASS_DOME, 0);
  m.taperedPrism(10, dx, dz, 0.13, 0, 0.54, 0.6, GLASS_DOME, PLATE_TOP, 1, 1);
  // the antenna on the roof: a slim mast, two cross-bars, a lamp on top
  m.taperedPrism(4, 0.15, 0.2, 0.035, 0.012, 0.285, 1.0, CONCRETE, CONCRETE, 0, 0, Math.PI / 4);
  m.box(0.15, 0.2, 0.26, 0.02, 0.74, 0.76, 0, CONCRETE_DARK, CONCRETE_DARK, 0);
  m.box(0.15, 0.2, 0.16, 0.02, 0.86, 0.88, 0, CONCRETE_DARK, CONCRETE_DARK, 0);
  bulb(m, 0.15, 1.04, 0.2, 0.07, 0.08, LIGHT_BULB, NIGHT_BULB_TINT);
  bulb(m, -0.18, 0.2, 0.4, 0.07, 0.07, LIGHT_BULB, NIGHT_BULB_TINT); // the entrance lamp
  bulb(m, 0.42, 0.26, -0.32, 0.07, 0.07, LIGHT_BULB, NIGHT_BULB_TINT); // the wing lamp
  return m.done();
}

/** The Plant: a ten-sided cooling tower (hourglass profile, owner-coloured rim, a puff of steam above it), a tall chimney in red and white bands with an owner-coloured band, and a boiler hall. */
function buildPlant(): ModelData {
  const m = new MeshBuilder();
  plateAndDisc(m);
  const cx = -0.3;
  const cz = -0.15;
  m.tube(10, cx, cz, 0.36, 0.28, 0.04, 0.3, COOLING, 0);
  m.tube(10, cx, cz, 0.28, 0.25, 0.3, 0.52, COOLING, 0);
  m.tube(10, cx, cz, 0.25, 0.29, 0.52, 0.72, COOLING, 0);
  m.tube(10, cx, cz, 0.29, 0.3, 0.72, 0.77, PLATE_TOP, 1); // the owner-coloured rim
  m.disc(10, 0.26, 0.7, CONCRETE_DARK, 0); // the dark inside seen from above
  bulb(m, cx, 0.88, cz, 0.24, 0.1, STEAM, 0);
  // the chimney: four bands, the top one in the owner colour, a lamp on the top
  const hx = 0.45;
  const hz = 0.2;
  m.tube(6, hx, hz, 0.085, 0.075, 0.04, 0.45, WALL_B, 0);
  m.tube(6, hx, hz, 0.075, 0.07, 0.45, 0.68, RED_BAND, 0);
  m.tube(6, hx, hz, 0.07, 0.065, 0.68, 0.9, WALL_C, 0);
  m.tube(6, hx, hz, 0.065, 0.06, 0.9, 1.12, PLATE_TOP, 1);
  m.disc(6, 0.06, 1.12, CONCRETE_DARK, 0);
  bulb(m, hx, 1.18, hz, 0.07, 0.07, LIGHT_BULB, NIGHT_BULB_TINT);
  // the boiler hall and a turbine annex
  m.box(0.1, -0.52, 0.7, 0.34, 0.04, 0.3, 0, HALL, PLATE_TOP, 1);
  m.box(-0.45, 0.5, 0.4, 0.25, 0.04, 0.16, 0.1, WALL_A, FLAT_ROOF, 0);
  bulb(m, 0.0, 0.17, -0.37, 0.07, 0.07, LIGHT_BULB, NIGHT_BULB_TINT);
  bulb(m, 0.3, 0.17, -0.37, 0.07, 0.07, LIGHT_BULB, NIGHT_BULB_TINT);
  return m.done();
}

/** The registry: structure type number -> model. A type without an entry is not drawn (yet). */
export const STRUCTURE_MODELS: Readonly<Record<number, StructureModel>> = {
  [STRUCT_CITY]: { name: 'city', radiusM: 700, build: (style: CityStyle = 'old') => (style === 'new' ? buildCityModern() : buildCity()) },
  // M10-2
  [STRUCT_FACTORY]: { name: 'factory', radiusM: 700, build: buildFactory },
  [STRUCT_PORT]: { name: 'port', radiusM: 700, seaward: true, build: buildPort },
  // M10-3
  [STRUCT_SILO]: { name: 'silo', radiusM: 560, build: buildSilo },
  [STRUCT_SAM]: { name: 'sam', radiusM: 520, build: buildSam },
  [STRUCT_POST]: { name: 'post', radiusM: 450, build: buildPost },
  // M18e-2: three real models in ONE shared mesh (one draw call together; `shared` names the type that owns the mesh)
  [STRUCT_AIRFIELD]: { name: 'airfield', radiusM: 780, shared: STRUCT_AIRFIELD, build: buildAirfield },
  [STRUCT_LAB]: { name: 'lab', radiusM: 560, shared: STRUCT_AIRFIELD, build: buildLab },
  [STRUCT_PLANT]: { name: 'plant', radiusM: 640, shared: STRUCT_AIRFIELD, build: buildPlant },
};

/** The types whose models share the mesh `owner` (ascending; the kind of a type is its 1-based position here). Empty for a type with a mesh of its own. */
export function sharedGroup(owner: number): number[] {
  return modelledTypes().filter((t) => STRUCTURE_MODELS[t]?.shared === owner);
}

/** The model kind an instance of `type` carries: 1.. in a shared mesh, 0 in a mesh of one model (the vertex shader draws only the vertices of that kind). */
export function kindOf(type: number): number {
  const owner = STRUCTURE_MODELS[type]?.shared;
  return owner === undefined ? 0 : sharedGroup(owner).indexOf(type) + 1;
}

/** The far-icon shape index of a type (the icon fragment shader draws a shape of its own for each type 1..9). */
export function iconShapeOf(type: number): number {
  return type;
}

/** The type numbers that have a model, ascending. */
export function modelledTypes(): number[] {
  return Object.keys(STRUCTURE_MODELS)
    .map(Number)
    .sort((a, b) => a - b);
}

/** The tint code of city light `n` (1..3): 4 x n. The vertex shader lights it on the night side when the city's level reaches n (shaders/structures.ts). */
export const CITY_LIGHT_COUNT = 3;

/**
 * The City's night lights (M10-4): up to CITY_LIGHT_COUNT small bulbs above the blocks, appended to the City's buffers by the layer (they are not
 * part of the City model, so its triangle budget and golden stay as they were). Each bulb is a flattened octahedron of 8 triangles; its vertices carry
 * the tint code 4 x its number. In daylight the shader scales them to nothing.
 */
export function cityLights(): ModelData {
  const m = new MeshBuilder();
  for (let n = 1; n <= CITY_LIGHT_COUNT; n++) {
    const a = ((n - 1) / CITY_LIGHT_COUNT) * Math.PI * 2 + 0.5;
    const cx = Math.cos(a) * 0.52;
    const cz = Math.sin(a) * 0.52;
    const r = 0.08;
    const y = 0.5;
    const top: Rgb = [cx, y + r, cz];
    const bot: Rgb = [cx, y - r, cz];
    const ring: Rgb[] = [
      [cx + r, y, cz],
      [cx, y, cz + r],
      [cx - r, y, cz],
      [cx, y, cz - r],
    ];
    for (let i = 0; i < 4; i++) {
      m.tri(ring[i] as Rgb, ring[(i + 1) % 4] as Rgb, top, LIGHT_BULB, 4 * n);
      m.tri(ring[(i + 1) % 4] as Rgb, ring[i] as Rgb, bot, LIGHT_BULB, 4 * n);
    }
  }
  return m.done();
}

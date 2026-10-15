// The structure models (M10): procedural low-poly geometry, no asset file, no three. One registry keyed by the sim's structure type number:
// a type is drawn when it has an entry here, and the layer (src/render/structures.ts) makes one instanced mesh per entry. Slice 1 registers
// the City only; Factory, Port, Silo, SAM and Post add an entry each and need no change anywhere else.
//
// MODEL SPACE. Unit radius: the model fits in a disc of radius 1 around the origin (x east, z north, y up, y = 0 is the ground, the foundation
// reaches below it so that the base never floats over a slope). `radiusM` is what one unit is in metres at true size; the layer multiplies
// by it, by the level scale and by the scale policy. Every vertex has a colour and a TINT: tint 1 takes the owner's colour, 0 keeps the
// model's own. Normals are not stored: the fragment shader takes the flat normal from screen derivatives (the stylised look of the terrain).
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST, STRUCT_SAM, STRUCT_SILO } from '../sim/public';

export interface ModelData {
  /** x, y, z per vertex, three vertices per triangle (non-indexed). */
  readonly positions: Float32Array;
  /** r, g, b (sRGB 0 to 1) per vertex. */
  readonly colors: Float32Array;
  /** 0 = own colour, 1 = owner colour, per vertex. */
  readonly tints: Float32Array;
  readonly triangles: number;
}

export interface StructureModel {
  readonly name: string;
  /** Metres that one model unit is at true size and level 1. */
  readonly radiusM: number;
  /** True when the model has a front (a pier) that should point to the sea: the layer turns it to the water instead of a pseudo-random yaw. Its front is model +x. */
  readonly seaward?: boolean;
  build(): ModelData;
}

type Rgb = readonly [number, number, number];

/** Accumulates triangles. Winding is counter-clockwise seen from outside; the layer draws double-sided anyway, so a flipped face only shades differently. */
class MeshBuilder {
  private readonly p: number[] = [];
  private readonly c: number[] = [];
  private readonly t: number[] = [];

  tri(a: Rgb, b: Rgb, c: Rgb, color: Rgb, tint: number): void {
    for (const v of [a, b, c]) {
      this.p.push(v[0], v[1], v[2]);
      this.c.push(color[0], color[1], color[2]);
      this.t.push(tint);
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
  prism(n: number, cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, side: Rgb, top: Rgb, topTint: number, sideTint = 0, turn = 0): void {
    const ring = (k: number, r: number, y: number): Rgb => [cx + Math.cos(((k + 0.5) / n) * Math.PI * 2 + turn) * r, y, cz + Math.sin(((k + 0.5) / n) * Math.PI * 2 + turn) * r];
    const c: Rgb = [cx, y1, cz];
    for (let k = 0; k < n; k++) {
      this.quad(ring(k, r0, y0), ring(k + 1, r0, y0), ring(k + 1, r1, y1), ring(k, r1, y1), side, sideTint);
      if (r1 > 0) this.tri(c, ring(k + 1, r1, y1), ring(k, r1, y1), top, topTint);
    }
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
    return { positions: Float32Array.from(this.p), colors: Float32Array.from(this.c), tints: Float32Array.from(this.t), triangles: this.p.length / 9 };
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
  // the tower and its spire (the spire takes the owner's colour: it reads from every side)
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
    const a = ang * 2.0;
    m.box(Math.cos(a) * 0.42, Math.sin(a) * 0.42, w * 0.5, w * 0.42, 0.04, 0.04 + h, a + 0.4, i % 2 === 0 ? WALL_A : WALL_B, FLAT_ROOF, 0);
  });
  // seven gabled houses on the outer ring of radius 0.76
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const h = 0.12 + (i % 3) * 0.04;
    const x = Math.cos(a) * 0.76;
    const z = Math.sin(a) * 0.76;
    m.box(x, z, 0.26, 0.18, 0.04, 0.04 + h, a, i % 2 === 0 ? WALL_B : WALL_A, SLATE, 0);
    m.gable(x, z, 0.26, 0.18, 0.04 + h, 0.04 + h + 0.08, a, SLATE, i % 3 === 0 ? 1 : 0, WALL_A);
  }
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
  m.prism(10, -0.28, 0, 0.5, 0.4, 0.05, 0.3, CONCRETE, CONCRETE_DARK, 0);
  // the hatch: a dark slot in the roof with two door leaves swung up in a V
  m.box(-0.28, 0, 0.5, 0.3, 0.3, 0.31, 0, HATCH, HATCH, 0);
  m.quad([-0.53, 0.31, -0.15], [-0.03, 0.31, -0.15], [-0.03, 0.46, -0.3], [-0.53, 0.46, -0.3], CONCRETE_DARK, 0);
  m.quad([-0.03, 0.31, 0.15], [-0.53, 0.31, 0.15], [-0.53, 0.46, 0.3], [-0.03, 0.46, 0.3], CONCRETE_DARK, 0);
  // the pad: a dark slab east of the bunker with an owner-coloured stripe, and the missile standing on it
  m.box(0.52, 0, 0.5, 0.56, 0.05, 0.1, 0, PAD, PAD, 0);
  m.box(0.52, 0.2, 0.5, 0.06, 0.1, 0.105, 0, PAD, PLATE_TOP, 1);
  m.box(0.52, -0.2, 0.5, 0.06, 0.1, 0.105, 0, PAD, PLATE_TOP, 1);
  m.prism(6, 0.52, 0, 0.1, 0.1, 0.1, 0.72, MISSILE, MISSILE, 0);
  m.prism(6, 0.52, 0, 0.1, 0, 0.72, 0.98, PLATE_TOP, PLATE_TOP, 1, 1); // the nose cone takes the owner colour
  m.beam([0.52, 0.1, 0.1], [0.52, 0.28, 0.24], 0.02, MISSILE, 0); // two small fins
  m.beam([0.52, 0.1, -0.1], [0.52, 0.28, -0.24], 0.02, MISSILE, 0);
  return m.done();
}

/** The SAM site: a hexagonal pedestal with a rack of two angled launch tubes, and a tall mast with a big dish that turns (aTint >= 2). */
function buildSam(): ModelData {
  const m = new MeshBuilder();
  m.plate(8, 1.0, -0.22, 0.04, PLATE_RIM, 0, PLATE_SIDE);
  m.disc(8, 0.8, 0.055, PLATE_TOP, 1);
  m.prism(6, 0, 0, 0.3, 0.22, 0.05, 0.22, CONCRETE, CONCRETE_DARK, 0);
  // the launcher rack: two tubes pointing up and to the west, a frame between them
  m.beam([-0.12, 0.16, -0.26], [-0.62, 0.5, -0.26], 0.07, OLIVE, 0, HATCH);
  m.beam([-0.12, 0.16, 0.26], [-0.62, 0.5, 0.26], 0.07, OLIVE, 0, HATCH);
  m.beam([-0.4, 0.34, -0.26], [-0.4, 0.34, 0.26], 0.035, CONCRETE_DARK, 0);
  // the turning part: a mast and a dish on an arm to the east. The dish is a cone opening towards +x with a rim.
  m.prism(5, 0, 0, 0.05, 0.05, 0.22, 0.84, CONCRETE, CONCRETE, SPIN);
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
  m.prism(4, 0, 0, 0.3, 0.2, 0.04, 0.82, STONE, STONE_DARK, 0, 0, Math.PI / 4);
  m.box(0, 0, 0.5, 0.5, 0.82, 0.9, 0.0, STONE_DARK, STONE_DARK, 0);
  for (const [x, z] of [[-0.21, -0.21], [0.21, -0.21], [0.21, 0.21], [-0.21, 0.21]] as Array<[number, number]>) m.box(x, z, 0.12, 0.12, 0.9, 1.0, 0, STONE, STONE, 0);
  m.beam([0, 0.9, 0], [0, 1.28, 0], 0.012, HATCH, 0);
  m.quad([0, 1.28, 0], [0.34, 1.23, 0], [0.34, 1.12, 0], [0, 1.15, 0], PLATE_TOP, 1);
  return m.done();
}

/** The registry: structure type number -> model. A type without an entry is not drawn (yet). */
export const STRUCTURE_MODELS: Readonly<Record<number, StructureModel>> = {
  [STRUCT_CITY]: { name: 'city', radiusM: 700, build: buildCity },
  // M10-2
  [STRUCT_FACTORY]: { name: 'factory', radiusM: 700, build: buildFactory },
  [STRUCT_PORT]: { name: 'port', radiusM: 700, seaward: true, build: buildPort },
  // M10-3
  [STRUCT_SILO]: { name: 'silo', radiusM: 560, build: buildSilo },
  [STRUCT_SAM]: { name: 'sam', radiusM: 520, build: buildSam },
  [STRUCT_POST]: { name: 'post', radiusM: 450, build: buildPost },
};

/** The type numbers that have a model, ascending. */
export function modelledTypes(): number[] {
  return Object.keys(STRUCTURE_MODELS)
    .map(Number)
    .sort((a, b) => a - b);
}

/** The tint code of city light `n` (1..3): 4 x n. The vertex shader lights it on the night side when the city's level reaches n (shaders/structures.ts). */
export const CITY_LIGHT_COUNT = 3;
const LIGHT_BULB: Rgb = [1, 0.88, 0.55];

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

// The structure models (M10): procedural low-poly geometry, no asset file, no three. One registry keyed by the sim's structure type number:
// a type is drawn when it has an entry here, and the layer (src/render/structures.ts) makes one instanced mesh per entry. Slice 1 registers
// the City only; Factory, Port, Silo, SAM and Post add an entry each and need no change anywhere else.
//
// MODEL SPACE. Unit radius: the model fits in a disc of radius 1 around the origin (x east, z north, y up, y = 0 is the ground, the foundation
// reaches below it so that the base never floats over a slope). `radiusM` is what one unit is in metres at true size; the layer multiplies
// by it, by the level scale and by the scale policy. Every vertex has a colour and a TINT: tint 1 takes the owner's colour, 0 keeps the
// model's own. Normals are not stored: the fragment shader takes the flat normal from screen derivatives (the stylised look of the terrain).
import { STRUCT_CITY } from '../sim/public';

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

/** The registry: structure type number -> model. A type without an entry is not drawn (yet). */
export const STRUCTURE_MODELS: Readonly<Record<number, StructureModel>> = {
  [STRUCT_CITY]: { name: 'city', radiusM: 700, build: buildCity },
};

/** The type numbers that have a model, ascending. */
export function modelledTypes(): number[] {
  return Object.keys(STRUCTURE_MODELS)
    .map(Number)
    .sort((a, b) => a - b);
}

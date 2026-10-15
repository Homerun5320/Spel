// CPU copy of the render height raster (the very bytes that are uploaded as the height texture) and everything that
// must agree with the vertex shader: the displaced surface radius at a position, and ray picking against it.
import { LAND_MAX_M, RENDER_HEIGHT, RENDER_WIDTH } from '../data/format';
import { EARTH_RADIUS_KM } from './config';
import { HeightSampler, detailBoundShare, type DetailLod } from './detail';
import { DEG, POLE_HEIGHT_U, add, dot, length, normalize, scale, vecToLatLon, type Vec3 } from './geo';

export interface HeightFieldOptions {
  /** u8 sqrt-coded land heights, row 0 = north, 0 = sea. */
  height8: Uint8Array;
  width?: number;
  height?: number;
  /** Largest decoded height (meta.json encoding.heightSqrt.maxM). */
  maxM?: number;
  exaggeration: number;
  /**
   * M07b: the displaced SURFACE includes the terrain detail of `src/render/detail.ts` (the very surface the chunk vertex shader draws:
   * sea 0, land above it, ridged octaves scaled by the local relief). `lod` is the distance law of the chunk material (picking sees the
   * octaves the camera sees at that distance). Without it the surface is the filtered raster, as in M07a. `heightM` (the data height
   * of the tooltip) is the filtered raster in both cases.
   */
  detail?: { lod: DetailLod; seed?: number; /** false: the coast rule of the chunk shader but no octaves (`?detail=0`). */ octaves?: boolean };
}

export interface RayHit {
  /** Hit point in world units (Earth radii). */
  point: Vec3;
  /** Distance along the ray. */
  t: number;
  lat: number;
  lon: number;
  /** Terrain height at the hit in metres (0 at sea). */
  heightM: number;
}

/** The steepest the exaggerated detailed surface gets (rise per unit of ground distance), for the marching step of picking. */
const PICK_SLOPE = 8;
/** Smallest marching step of the detailed pick (Earth radii, about 13 cm) and the most steps before it gives up. */
const PICK_MIN_STEP = 2e-8;
const PICK_MAX_STEPS = 6000;

export class HeightField {
  readonly width: number;
  readonly height: number;
  readonly maxM: number;
  exaggeration: number;
  private readonly height8: Uint8Array;
  /** The detail sampler of the displaced surface (null = the filtered raster alone). */
  readonly sampler: HeightSampler | null;
  private readonly lod: DetailLod | null;
  private readonly octaves: boolean;

  constructor(o: HeightFieldOptions) {
    this.height8 = o.height8;
    this.width = o.width ?? RENDER_WIDTH;
    this.height = o.height ?? RENDER_HEIGHT;
    this.maxM = o.maxM ?? LAND_MAX_M;
    this.exaggeration = o.exaggeration;
    this.sampler = o.detail ? new HeightSampler({ codes: o.height8, width: this.width, height: this.height, maxM: this.maxM }, o.detail.seed === undefined ? {} : { seed: o.detail.seed }) : null;
    this.lod = o.detail ? o.detail.lod : null;
    this.octaves = o.detail?.octaves !== false;
  }

  /** Raw code at a pixel (longitude wraps, latitude clamps). */
  code(px: number, py: number): number {
    const x = ((px % this.width) + this.width) % this.width;
    const y = py < 0 ? 0 : py >= this.height ? this.height - 1 : py;
    return this.height8[y * this.width + x] as number;
  }

  /** Terrain height in metres at a position: the texture is filtered LINEARLY on the code (as the vertex shader does), then decoded. */
  heightM(latDeg: number, lonDeg: number): number {
    const v = (90 - latDeg) / 180;
    // The pole rows of the globe grid read one common longitude (see heightLookupUv), so the exact pole has one height.
    const u = v <= 0 || v >= 1 ? POLE_HEIGHT_U : (lonDeg + 180) / 360;
    const tx = u * this.width - 0.5;
    const ty = v * this.height - 0.5;
    const x0 = Math.floor(tx);
    const y0 = Math.floor(ty);
    const fx = tx - x0;
    const fy = ty - y0;
    const c =
      this.code(x0, y0) * (1 - fx) * (1 - fy) +
      this.code(x0 + 1, y0) * fx * (1 - fy) +
      this.code(x0, y0 + 1) * (1 - fx) * fy +
      this.code(x0 + 1, y0 + 1) * fx * fy;
    const f = c / 255;
    return this.maxM * f * f;
  }

  /** Radius (in Earth radii) of the displaced surface for a given height in metres. */
  radiusOf(heightM: number): number {
    return 1 + (this.exaggeration * heightM) / (EARTH_RADIUS_KM * 1000);
  }

  /**
   * Render height in metres (before the exaggeration) of the displaced SURFACE at a position: with detail the finest level of it (all
   * octaves; `heightAt` of `src/render/detail.ts`), else the filtered raster.
   */
  surfaceHeightM(latDeg: number, lonDeg: number): number {
    return this.sampler ? this.sampler.heightAt(latDeg, lonDeg, this.octaves ? undefined : 0) : this.heightM(latDeg, lonDeg);
  }

  /** Radius of the displaced surface at a position. */
  surfaceRadius(latDeg: number, lonDeg: number): number {
    return this.radiusOf(this.surfaceHeightM(latDeg, lonDeg));
  }

  /** Radius of the displaced surface as a camera at `cam` (Earth radii) sees it drawn: the octaves follow the distance (picking uses it). */
  seenRadius(latDeg: number, lonDeg: number, cam: Vec3): number {
    const s = this.sampler;
    if (!s || !this.lod) return this.radiusOf(this.heightM(latDeg, lonDeg));
    return this.radiusOf(this.octaves ? s.heightSeenM(latDeg, lonDeg, cam, this.exaggeration, this.lod) : s.heightAt(latDeg, lonDeg, 0));
  }

  /** The point of the displaced surface above a position. */
  surfacePoint(latDeg: number, lonDeg: number): Vec3 {
    const lat = latDeg * DEG;
    const lon = lonDeg * DEG;
    const r = this.surfaceRadius(latDeg, lonDeg);
    return [r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.cos(lon)];
  }

  /** Largest radius the surface can reach (the detail adds at most its bound share of the tallest relief). */
  get maxRadius(): number {
    return this.radiusOf(this.sampler ? this.maxM * (1 + detailBoundShare()) : this.maxM);
  }

  /**
   * Ray against the displaced surface: intersect the shell of the highest possible radius, march inside it in fixed
   * steps until the ray dips below the surface, then bisect. Returns null when the ray misses the globe.
   */
  pick(origin: Vec3, dir: Vec3, stepLength = 0.0003): RayHit | null {
    const d = normalize(dir);
    const rMax = this.maxRadius;
    // Entry and exit of the outer shell.
    const b = dot(origin, d);
    const c = dot(origin, origin) - rMax * rMax;
    const disc = b * b - c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t0 = -b - sq;
    const t1 = -b + sq;
    if (t1 < 0) return null;
    if (t0 < 0) t0 = 0;
    const at = (t: number): Vec3 => add(origin, scale(d, t));
    const below = (p: Vec3): boolean => {
      const { lat, lon } = vecToLatLon(p);
      return length(p) <= this.seenRadius(lat, lon, origin);
    };
    let prev = t0;
    if (below(at(t0))) return this.hitAt(origin, d, t0);
    const bisect = (lo0: number, hi0: number): RayHit => {
      let lo = lo0;
      let hi = hi0;
      for (let k = 0; k < 24; k++) {
        const mid = 0.5 * (lo + hi);
        if (below(at(mid))) hi = mid;
        else lo = mid;
      }
      return this.hitAt(origin, d, hi);
    };
    if (this.sampler) {
      // The detailed surface has ridges narrower than a fixed step: march by a safe share of the clearance above the ground (the
      // surface rises at most PICK_SLOPE per unit of ground distance), never more than the fixed step and never less than a hair.
      let t = t0;
      for (let i = 0; i < PICK_MAX_STEPS; i++) {
        const p = at(t);
        const { lat, lon } = vecToLatLon(p);
        const clear = length(p) - this.seenRadius(lat, lon, origin);
        if (clear <= 0) return bisect(prev, t);
        prev = t;
        if (t >= t1) return null;
        t = Math.min(t1, t + Math.min(stepLength, Math.max(clear / (1 + PICK_SLOPE), PICK_MIN_STEP)));
      }
      // (a ray that grazes the ground for thousands of tiny steps: finish with the fixed step)
      for (; t < t1; t = Math.min(t1, t + stepLength)) {
        if (below(at(t))) return bisect(prev, t);
        prev = t;
        if (t >= t1) break;
      }
      return below(at(t1)) ? bisect(prev, t1) : null;
    }
    const maxSteps = Math.ceil((t1 - t0) / stepLength) + 2;
    for (let i = 1; i <= maxSteps; i++) {
      const t = Math.min(t1, t0 + i * stepLength);
      if (below(at(t))) return bisect(prev, t);
      prev = t;
      if (t >= t1) break;
    }
    return null;
  }

  private hitAt(origin: Vec3, d: Vec3, t: number): RayHit {
    const point = add(origin, scale(d, t));
    const { lat, lon } = vecToLatLon(point);
    return { point, t, lat, lon, heightM: this.heightM(lat, lon) };
  }
}

/** Nearest intersection of a ray with the unit sphere (smallest t >= 0), or null. */
export function raySphere(origin: Vec3, dir: Vec3, radius = 1): number | null {
  const b = dot(origin, dir);
  const c = dot(origin, origin) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = -b - sq;
  if (t0 >= 0) return t0;
  const t1 = -b + sq;
  return t1 >= 0 ? t1 : null;
}

/** The point of the unit sphere closest to a ray (used to grab the globe when the cursor is outside the disc). */
export function nearestSpherePoint(origin: Vec3, dir: Vec3): Vec3 {
  const t = Math.max(0, -dot(origin, dir));
  return normalize(add(origin, scale(dir, t)));
}

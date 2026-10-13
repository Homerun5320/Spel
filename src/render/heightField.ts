// CPU copy of the render height raster (the very bytes that are uploaded as the height texture) and everything that
// must agree with the vertex shader: the displaced surface radius at a position, and ray picking against it.
import { LAND_MAX_M, RENDER_HEIGHT, RENDER_WIDTH } from '../data/format';
import { EARTH_RADIUS_KM } from './config';
import { DEG, POLE_HEIGHT_U, add, dot, length, normalize, scale, vecToLatLon, type Vec3 } from './geo';

export interface HeightFieldOptions {
  /** u8 sqrt-coded land heights, row 0 = north, 0 = sea. */
  height8: Uint8Array;
  width?: number;
  height?: number;
  /** Largest decoded height (meta.json encoding.heightSqrt.maxM). */
  maxM?: number;
  exaggeration: number;
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

export class HeightField {
  readonly width: number;
  readonly height: number;
  readonly maxM: number;
  exaggeration: number;
  private readonly height8: Uint8Array;

  constructor(o: HeightFieldOptions) {
    this.height8 = o.height8;
    this.width = o.width ?? RENDER_WIDTH;
    this.height = o.height ?? RENDER_HEIGHT;
    this.maxM = o.maxM ?? LAND_MAX_M;
    this.exaggeration = o.exaggeration;
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

  /** Radius of the displaced surface at a position. */
  surfaceRadius(latDeg: number, lonDeg: number): number {
    return this.radiusOf(this.heightM(latDeg, lonDeg));
  }

  /** The point of the displaced surface above a position. */
  surfacePoint(latDeg: number, lonDeg: number): Vec3 {
    const lat = latDeg * DEG;
    const lon = lonDeg * DEG;
    const r = this.surfaceRadius(latDeg, lonDeg);
    return [r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.cos(lon)];
  }

  /** Largest radius the surface can reach. */
  get maxRadius(): number {
    return this.radiusOf(this.maxM);
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
      return length(p) <= this.surfaceRadius(lat, lon);
    };
    let prev = t0;
    if (below(at(t0))) return this.hitAt(origin, d, t0);
    const maxSteps = Math.ceil((t1 - t0) / stepLength) + 2;
    for (let i = 1; i <= maxSteps; i++) {
      const t = Math.min(t1, t0 + i * stepLength);
      if (below(at(t))) {
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 24; k++) {
          const mid = 0.5 * (lo + hi);
          if (below(at(mid))) hi = mid;
          else lo = mid;
        }
        return this.hitAt(origin, d, hi);
      }
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

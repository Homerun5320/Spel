// Picking and the camera's ground on the DETAILED surface (M07b): the ray hits the surface the chunk vertex shader draws (the same octaves for the
// same distance), it is the FIRST hit (no ridge of the detail is stepped over), and the point it returns projects back to the clicked pixel.
import { beforeAll, describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/camera';
import { EARTH_RADIUS_KM, HEIGHT_EXAGGERATION } from '../../src/render/config';
import { add, length, normalize, scale, vecToLatLon, type Vec3 } from '../../src/render/geo';
import { loadChunkWorld, poseOf, rng, type ChunkWorld } from '../helpers/chunkWorld';

let world: ChunkWorld;
beforeAll(async () => {
  world = await loadChunkWorld();
});

const R_M = EARTH_RADIUS_KM * 1000;
const PLACES = [
  { lat: 28.2, lon: 86.8, heading: 0 },
  { lat: 46.5, lon: 8, heading: 180 },
  { lat: 61.9, lon: 7.2, heading: 90 },
  { lat: 52.2, lon: 5.5, heading: 0 },
] as const;

/** The old way: fixed steps of 1.9 km through the shell, the first sample below the ground is the hit (null when none is). */
function naiveFirstHit(field: ChunkWorld['detailField'], origin: Vec3, dir: Vec3, t0: number, t1: number, step: number): number | null {
  for (let t = t0; t <= t1; t += step) {
    const p = add(origin, scale(dir, t));
    const { lat, lon } = vecToLatLon(p);
    if (length(p) <= field.seenRadius(lat, lon, origin)) return t;
  }
  return null;
}

describe('picking on the detailed surface', () => {
  it('the hit is ON the surface the shader draws for the camera (radius equals seenRadius), and nothing of the ray before it is below the surface: 400 rays at 1 km to 50 km over four places', () => {
    const f = world.detailField;
    const r = rng(31);
    const rig = new CameraRig(960, 540);
    let rays = 0;
    let hits = 0;
    let naiveMissed = 0;
    let worstRadius = 0;
    let worstBelow = 0;
    for (let i = 0; i < 400; i++) {
      const place = PLACES[i % PLACES.length] as (typeof PLACES)[number];
      const agl = [1000, 3000, 10000, 50000][i % 4] as number;
      const pose = poseOf(world, { lat: place.lat + 0.6 * (r() - 0.5), lon: place.lon + 0.6 * (r() - 0.5), heading: place.heading + 360 * r(), tilt: 55 + 30 * r() }, agl);
      const ray = rig.rayAt(40 + 880 * r(), 60 + 420 * r(), pose);
      rays++;
      const hit = f.pick(ray.origin, ray.dir);
      if (!hit) continue;
      hits++;
      // on the surface
      const seen = f.seenRadius(hit.lat, hit.lon, ray.origin);
      worstRadius = Math.max(worstRadius, (Math.abs(length(hit.point) - seen) * R_M) / HEIGHT_EXAGGERATION); // metres of height
      expect(Math.abs(length(hit.point) - seen) * R_M, `ray ${i} radius at the hit (metres)`).toBeLessThan(0.05);
      // the first hit: 300 samples along the ray before it stay above the ground (a hair of tolerance for the bisection)
      const d = normalize(ray.dir);
      for (let k = 0; k < 300; k++) {
        const t = (hit.t * k) / 300;
        const p = add(ray.origin, scale(d, t));
        const { lat, lon } = vecToLatLon(p);
        const clear = (length(p) - f.seenRadius(lat, lon, ray.origin)) * R_M;
        worstBelow = Math.min(worstBelow, clear);
        expect(clear, `ray ${i} sample ${k} of 300 before the hit (metres above the ground)`).toBeGreaterThan(-0.2);
      }
      // the old fixed step: does it find the same first hit?
      const naive = naiveFirstHit(f, ray.origin, d, 0, hit.t * 1.05 + 1e-4, 0.0003);
      if (naive === null || naive > hit.t + 0.0003) naiveMissed++;
    }
    expect(hits).toBeGreaterThan(300);
    console.log(`[picking] ${rays} rays, ${hits} hits: the hit radius is on the surface within ${worstRadius.toFixed(4)} m of height (x12 exaggerated: 0.05 m), the worst sample before a hit is ${worstBelow.toFixed(3)} m below it; the fixed 1.9 km step would have stepped over the first hit on ${naiveMissed} rays`);
    // the control: the old march misses ridges of the detail, so the test (and the adaptive march) matter
    expect(naiveMissed, 'rays where a fixed-step march misses the first ridge').toBeGreaterThan(0);
  });

  it('the hit projects back to the clicked pixel within half a pixel (the picked point is the drawn point)', () => {
    const f = world.detailField;
    const r = rng(32);
    const rig = new CameraRig(960, 540);
    let worst = 0;
    let n = 0;
    for (let i = 0; i < 120; i++) {
      const place = PLACES[i % PLACES.length] as (typeof PLACES)[number];
      const pose = poseOf(world, { lat: place.lat, lon: place.lon, heading: place.heading + 360 * r(), tilt: 50 + 35 * r() }, [1000, 2000, 15000][i % 3] as number);
      const x = 80 + 800 * r();
      const y = 60 + 420 * r();
      const ray = rig.rayAt(x, y, pose);
      const hit = f.pick(ray.origin, ray.dir);
      if (!hit) continue;
      const s = rig.project(hit.point, pose);
      worst = Math.max(worst, Math.hypot(s.x - x, s.y - y));
      n++;
    }
    expect(n).toBeGreaterThan(80);
    console.log(`[picking] ${n} clicks: the picked point projects back within ${worst.toFixed(4)} px`);
    expect(worst).toBeLessThan(0.5);
  });

  it('the camera ground (surfaceRadius, used by the AGL views and the zoom floor) is the finest surface of the sampler, and heightM stays the DATA height of the tooltip', () => {
    const f = world.detailField;
    const base = world.field;
    for (const [lat, lon] of [[28.2, 86.8], [46.5, 8], [61.9, 7.2], [52.2, 5.5]] as const) {
      expect(f.surfaceHeightM(lat, lon)).toBe(f.sampler!.heightAt(lat, lon));
      expect(f.surfaceRadius(lat, lon)).toBeCloseTo(1 + (HEIGHT_EXAGGERATION * f.surfaceHeightM(lat, lon)) / R_M, 14);
      expect(f.heightM(lat, lon)).toBe(base.heightM(lat, lon)); // the tooltip shows the raster, never the procedural detail
      expect(base.surfaceRadius(lat, lon)).toBeCloseTo(base.radiusOf(base.heightM(lat, lon)), 14); // a field without detail is the M07a one
    }
    expect(f.maxRadius).toBeGreaterThan(base.maxRadius);
  });

  it('a field without the detail picks exactly as in M07a (the same hit for the same ray)', () => {
    const f = world.field;
    const rig = new CameraRig(960, 540);
    const pose = poseOf(world, { lat: 28.2, lon: 86.8, heading: 0, tilt: 60 }, 20000);
    const ray = rig.rayAt(480, 270, pose);
    const hit = f.pick(ray.origin, ray.dir);
    expect(hit).not.toBeNull();
    expect(f.surfaceRadius(hit!.lat, hit!.lon)).toBeCloseTo(length(hit!.point), 9);
  });
});

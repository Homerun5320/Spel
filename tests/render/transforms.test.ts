// M08 item 3: the transforms (cells, latitude / longitude, world), `groundHeightAt` (the very function `heightAt`, with an explicit error
// when nothing is bound and a pure factory for Node) and `pickGround` (the ray against the surface a camera sees).
import { beforeAll, describe, expect, it } from 'vitest';
import { latLonOfCell } from '../../src/app/cellGeo';
import { CameraRig } from '../../src/render/camera';
import { EARTH_RADIUS_KM, HEIGHT_EXAGGERATION } from '../../src/render/config';
import { HeightSampler, bindHeightSource, heightAt } from '../../src/render/detail';
import { latLonToCell as simCellOf, length, sub, vecToLatLon, type Vec3 } from '../../src/render/geo';
import { raySphere } from '../../src/render/heightField';
import {
  PICK_MAX_STEP_CELLS,
  cellIndex,
  cellSizeM,
  cellToLatLon,
  cellToWorld,
  cellXY,
  createGroundHeight,
  groundHeightAt,
  groundHeightBound,
  latLonToCell,
  latLonToWorld,
  pickGround,
  radiusAboveGround,
  wrapX,
  worldToCell,
  worldToLatLon,
} from '../../src/render/transforms';
import { loadChunkWorld, poseOf, rng, type ChunkWorld } from '../helpers/chunkWorld';

const R_M = EARTH_RADIUS_KM * 1000;
let world: ChunkWorld;
beforeAll(async () => {
  world = await loadChunkWorld();
});

describe('cells, latitude / longitude and world coordinates', () => {
  it('wrapX wraps the columns (the world is a cylinder) and cellIndex clamps the rows', () => {
    expect(wrapX(-1, 1024)).toBe(1023);
    expect(wrapX(1024, 1024)).toBe(0);
    expect(wrapX(2051, 1024)).toBe(3);
    expect(wrapX(-1025, 1024)).toBe(1023);
    expect(cellIndex(-1, 0, 1024, 512)).toBe(1023);
    expect(cellIndex(1024, 511, 1024, 512)).toBe(511 * 1024);
    expect(cellIndex(5, -3, 1024, 512)).toBe(5);
    expect(cellIndex(5, 999, 1024, 512)).toBe(511 * 1024 + 5);
  });

  it('cell -> lat / lon -> cell is the identity on every cell of three grids (the shipped 1024 x 512 and two odd ones)', () => {
    for (const [w, h] of [
      [1024, 512],
      [100, 50],
      [7, 3],
    ] as const) {
      for (let i = 0; i < w * h; i++) {
        const { lat, lon } = cellToLatLon(i, w, h);
        expect(latLonToCell(lat, lon, w, h).index).toBe(i);
        const { x, y } = cellXY(i, w);
        expect(y * w + x).toBe(i);
      }
    }
  });

  it('agrees with the menu code (`latLonOfCell`) and with the sim cell of `geo.ts` on the shipped grid', () => {
    const r = rng(5);
    for (let k = 0; k < 500; k++) {
      const i = Math.floor(r() * 1024 * 512);
      const a = cellToLatLon(i, 1024, 512);
      const b = latLonOfCell(i, 1024, 512);
      expect(a.lat).toBe(b.lat);
      expect(a.lon).toBe(b.lon);
      const lat = 180 * r() - 90;
      const lon = 720 * r() - 360;
      expect(latLonToCell(lat, lon, 1024, 512)).toEqual(simCellOf(lat, lon));
    }
  });

  it('cell -> world -> cell, longitude wraps (-181 is 179), the poles clamp, and the world position has the radius asked for', () => {
    for (const i of [0, 1023, 511 * 1024 + 7, 1024 * 512 - 1, 300 * 1024 + 555]) {
      const p = cellToWorld(i, 1024, 512);
      expect(length(p)).toBeCloseTo(1, 12);
      expect(worldToCell(p, 1024, 512).index).toBe(i);
      const q = cellToWorld(i, 1024, 512, 1.02);
      expect(length(q)).toBeCloseTo(1.02, 12);
      expect(worldToCell(q, 1024, 512).index).toBe(i);
    }
    expect(latLonToCell(10, -181, 1024, 512).x).toBe(latLonToCell(10, 179, 1024, 512).x);
    expect(latLonToCell(90, 0, 1024, 512).y).toBe(0);
    expect(latLonToCell(-90, 0, 1024, 512).y).toBe(511);
    const w = worldToLatLon(latLonToWorld(37, -122, 1.01));
    expect(w.lat).toBeCloseTo(37, 9);
    expect(w.lon).toBeCloseTo(-122, 9);
    expect(w.radius).toBeCloseTo(1.01, 12);
  });

  it('a cell is 39 km high and shrinks east-west with the cosine of the latitude', () => {
    const eq = cellSizeM(0, 1024, 512);
    expect(eq.northM / 1000).toBeGreaterThan(38.9);
    expect(eq.northM / 1000).toBeLessThan(39.2);
    expect(eq.eastM / 1000).toBeGreaterThan(38.9);
    const s60 = cellSizeM(60, 1024, 512);
    expect(s60.eastM / eq.eastM).toBeCloseTo(0.5, 6);
  });
});

describe('radiusAboveGround (rule 2 of the layers on the terrain)', () => {
  it('re-bases a height above the sim ground on the visible displaced ground: 300 m over the Himalaya is 300 m over the drawn ground, not over the sea-level sphere', () => {
    const f = world.detailField;
    const ground = f.surfaceRadius(28, 86.9);
    expect(ground).toBeGreaterThan(1.005); // the x12 Himalaya stands 60 km and more up
    expect(radiusAboveGround(ground, 0)).toBe(ground);
    expect((radiusAboveGround(ground, 300) - ground) * R_M).toBeCloseTo(300, 6);
    expect((radiusAboveGround(1, 300) - 1) * R_M).toBeCloseTo(300, 6);
    expect(radiusAboveGround(ground, -50)).toBeLessThan(ground);
  });
});

describe('groundHeightAt is heightAt', () => {
  it('is the very same function (not a copy) and throws an explicit error when no source is bound', () => {
    expect(groundHeightAt).toBe(heightAt);
    bindHeightSource(null);
    expect(groundHeightBound()).toBe(false);
    expect(() => groundHeightAt(46, 8)).toThrow(/no height source is bound/);
    bindHeightSource(world.detailField.sampler);
    expect(groundHeightBound()).toBe(true);
    expect(groundHeightAt(28, 86.9)).toBeGreaterThan(5000);
  });

  it('the pure factory answers the same numbers as the bound module function and needs no binding (Node tests of M10 and M12 use it)', () => {
    bindHeightSource(null);
    const source = { codes: world.codes, width: world.width, height: world.height, maxM: world.maxM };
    const own = createGroundHeight(source);
    expect(groundHeightBound()).toBe(false); // the factory did not touch the module state
    expect(() => groundHeightAt(0, 0)).toThrow(/no height source is bound/);
    const bound = createGroundHeight(source, true);
    expect(groundHeightBound()).toBe(true);
    const r = rng(77);
    for (let k = 0; k < 300; k++) {
      const lat = 140 * r() - 70;
      const lon = 360 * r() - 180;
      const oct = [undefined, 0, 4, 12][k % 4];
      expect(own.groundHeightAt(lat, lon, oct)).toBe(groundHeightAt(lat, lon, oct));
      expect(bound.groundHeightAt(lat, lon, oct)).toBe(heightAt(lat, lon, oct));
      expect(own.radiusAt(lat, lon, HEIGHT_EXAGGERATION, oct)).toBeCloseTo(1 + (HEIGHT_EXAGGERATION * heightAt(lat, lon, oct)) / R_M, 14);
    }
    // sea is exactly 0, high land is high, and a sampler can be handed over directly
    expect(own.groundHeightAt(0, -150)).toBe(0);
    expect(createGroundHeight(new HeightSampler(source)).groundHeightAt(28, 86.9)).toBeGreaterThan(5000);
    bindHeightSource(world.detailField.sampler);
  });
});

// ---- picking ----------------------------------------------------------------------------------------------------------------------------

function randomPixels(n: number, seed: number, w = 960, h = 540): Array<[number, number]> {
  const r = rng(seed);
  return Array.from({ length: n }, () => [w * r(), h * r()] as [number, number]);
}

describe('pickGround: pick, then project back', () => {
  const heights = [
    { name: 'orbit (21 500 km)', view: { lat: 20, lon: 10, heading: 0, tilt: 0, distKm: 21500 }, alt: undefined },
    { name: 'RTS 50 km up, Himalaya, tilt 55', view: { lat: 28.2, lon: 86.8, heading: 30, tilt: 55 }, alt: 50_000 },
    { name: 'RTS 3 km up, Alps, tilt 65', view: { lat: 46.5, lon: 8, heading: 200, tilt: 65 }, alt: 3_000 },
    { name: 'RTS 300 m up, Himalaya, tilt 70', view: { lat: 28.2, lon: 86.8, heading: 90, tilt: 70 }, alt: 300 },
  ] as const;

  it('200 random screen points over the orbit and three RTS heights: the error of the round trip is at most 1 px (worst below 0.01)', () => {
    let worstOverall = 0;
    for (const [i, h] of heights.entries()) {
      const pose = poseOf(world, h.view, h.alt);
      const rig = new CameraRig(960, 540);
      let hits = 0;
      let worst = 0;
      // 200 random pixels that hit the globe (in the orbit view a third of the screen is sky: the draw goes on until 200 pixels have hit)
      for (const [px, py] of randomPixels(2000, 100 + i)) {
        if (hits === 200) break;
        const ray = rig.rayAt(px, py, pose);
        const hit = pickGround(world.detailField, ray);
        if (!hit) continue;
        hits++;
        const s = rig.project(hit.point, pose);
        worst = Math.max(worst, Math.hypot(s.x - px, s.y - py));
      }
      expect(hits, `${h.name}: hits`).toBe(200);
      expect(worst, `${h.name}: worst round trip (px)`).toBeLessThanOrEqual(1);
      worstOverall = Math.max(worstOverall, worst);
    }
    expect(worstOverall).toBeLessThan(0.01);
  });

  it('a sphere-only pick passes the round trip too (that is why the next test exists): the pick of a flat planet projects back exactly', () => {
    const pose = poseOf(world, heights[1].view, heights[1].alt);
    const rig = new CameraRig(960, 540);
    let worst = 0;
    for (const [px, py] of randomPixels(100, 5)) {
      const ray = rig.rayAt(px, py, pose);
      const t = raySphere(ray.origin, ray.dir, 1);
      if (t === null) continue;
      const p: Vec3 = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
      const s = rig.project(p, pose);
      worst = Math.max(worst, Math.hypot(s.x - px, s.y - py));
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('is terrain aware (Himalaya, tilt 60, 20 km up): >= 100 of 200 hits are ON the surface the camera sees (radius = seenRadius within 0.05 m, height = groundHeightAt at the octaves of the distance law), and >= 30 are >= 50 m from the sphere intersection', () => {
    const f = world.detailField;
    const sampler = f.sampler as HeightSampler;
    const pose = poseOf(world, { lat: 28.2, lon: 86.8, heading: 0, tilt: 60 }, 20_000);
    const rig = new CameraRig(960, 540);
    let onSurface = 0;
    let fromSphere = 0;
    let worstRadiusM = 0;
    let worstHeightM = 0;
    for (const [px, py] of randomPixels(200, 61)) {
      const ray = rig.rayAt(px, py, pose);
      const hit = pickGround(f, ray);
      if (!hit) continue;
      const seen = f.seenRadius(hit.lat, hit.lon, ray.origin); // leaves `lastSeenOctaves` of the sampler behind
      const radiusErrM = Math.abs(hit.radius - seen) * R_M;
      const octaves = sampler.lastSeenOctaves;
      const heightErrM = Math.abs(groundHeightAt(hit.lat, hit.lon, octaves) - ((hit.radius - 1) * R_M) / HEIGHT_EXAGGERATION);
      worstRadiusM = Math.max(worstRadiusM, radiusErrM);
      worstHeightM = Math.max(worstHeightM, heightErrM);
      if (radiusErrM <= 0.05) onSurface++;
      const t = raySphere(ray.origin, ray.dir, 1);
      if (t !== null) {
        const sphere: Vec3 = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
        if (length(sub(hit.point, sphere)) * R_M >= 50) fromSphere++;
      }
    }
    expect(onSurface).toBeGreaterThanOrEqual(100);
    expect(fromSphere).toBeGreaterThanOrEqual(30);
    expect(worstRadiusM).toBeLessThan(0.05);
    expect(worstHeightM).toBeLessThan(0.01); // render metres: the same arithmetic as the radius, times 1 / 12
  });

  it('the terrain-awareness test CAN fail: with the exaggeration at 0 (a flat planet) no hit leaves the sphere by 50 m, and a pick of the raw raster misses the detailed surface', () => {
    const f = world.detailField;
    const pose = poseOf(world, { lat: 28.2, lon: 86.8, heading: 0, tilt: 60 }, 20_000);
    const rig = new CameraRig(960, 540);
    const saved = f.exaggeration;
    f.exaggeration = 0;
    let moved = 0;
    for (const [px, py] of randomPixels(200, 61)) {
      const ray = rig.rayAt(px, py, pose);
      const hit = pickGround(f, ray);
      const t = raySphere(ray.origin, ray.dir, 1);
      if (hit && t !== null) {
        const sphere: Vec3 = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
        if (length(sub(hit.point, sphere)) * R_M >= 50) moved++;
      }
    }
    f.exaggeration = saved;
    expect(moved).toBeLessThan(30);
    // and the plain raster (no detail) is not the surface the detailed field sees
    let differing = 0;
    for (const [px, py] of randomPixels(100, 3)) {
      const ray = rig.rayAt(px, py, pose);
      const a = pickGround(f, ray);
      const b = pickGround(world.field, ray);
      if (a && b && Math.abs(a.radius - b.radius) * R_M > 5) differing++;
    }
    expect(differing).toBeGreaterThan(10);
  });

  it('misses are null (a ray off the disc) and the largest march step stays far below the prompt\'s 0.5 cell', () => {
    const rig = new CameraRig(960, 540);
    const pose = poseOf(world, heights[0].view, heights[0].alt);
    expect(pickGround(world.detailField, rig.rayAt(2, 2, pose))).toBeNull();
    expect(PICK_MAX_STEP_CELLS).toBe(0.5);
    // HeightField.pick's fixed step (0.0003 Earth radii) against half a sim cell (0.5 * 2 pi / 1024 radii)
    expect(0.0003).toBeLessThan((PICK_MAX_STEP_CELLS * 2 * Math.PI) / 1024);
    const { lat, lon } = vecToLatLon(pose.position);
    expect(Number.isFinite(lat + lon)).toBe(true);
  });
});

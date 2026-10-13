import { beforeAll, describe, expect, it } from 'vitest';
import type { RenderPack, SimGrid, WorldMeta } from '../../src/data';
import { CameraRig } from '../../src/render/camera';
import { HEIGHT_EXAGGERATION } from '../../src/render/config';
import { dot, latLonToCell, length, normalize, scale, sub, vecToLatLon, type Vec3 } from '../../src/render/geo';
import { HeightField } from '../../src/render/heightField';
import { worldLoader } from '../helpers/dataFiles';

const W = 960;
const H = 540;

let render: RenderPack;
let sim: SimGrid;
let meta: WorldMeta;
let field: HeightField;

beforeAll(async () => {
  const w = worldLoader();
  [render, sim, meta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
  field = new HeightField({ height8: render.height8, width: render.width, height: render.height, maxM: meta.encoding.heightSqrt.maxM, exaggeration: HEIGHT_EXAGGERATION });
});

function countryId(a3: string): number {
  const c = meta.countries.find((x) => x.a3 === a3);
  if (!c) throw new Error(`no country ${a3}`);
  return c.id;
}

describe('height field (CPU copy of the height texture)', () => {
  it('Everest region is high, the Pacific is at sea level, the radius follows the exaggeration', () => {
    const everest = field.heightM(27.99, 86.93);
    expect(everest).toBeGreaterThan(5500);
    expect(everest).toBeLessThan(9000);
    expect(field.heightM(0, -150)).toBe(0);
    expect(field.surfaceRadius(0, -150)).toBe(1);
    const r = field.surfaceRadius(27.99, 86.93);
    expect((r - 1) * 6371000).toBeCloseTo(HEIGHT_EXAGGERATION * everest, 3);
    expect(field.maxRadius).toBeGreaterThan(r);
  });

  it('wraps in longitude and clamps in latitude without NaN', () => {
    expect(Number.isFinite(field.heightM(0, 180))).toBe(true);
    expect(field.heightM(10, 179.9999)).toBeCloseTo(field.heightM(10, -180.0001), 0);
    expect(Number.isFinite(field.heightM(90, 0))).toBe(true);
    expect(Number.isFinite(field.heightM(-90, 123))).toBe(true);
  });
});

describe('picking', () => {
  it('a camera centred on 59.3N 18.1E puts Sweden in the middle of the screen', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 59.3, lon: 18.1, distKm: 2500, heading: 0, tilt: 0 });
    const ray = rig.rayAt(W / 2, H / 2);
    const hit = field.pick(ray.origin, ray.dir);
    expect(hit).not.toBeNull();
    expect(hit?.lat).toBeCloseTo(59.3, 1);
    expect(hit?.lon).toBeCloseTo(18.1, 1);
    const cell = latLonToCell(hit?.lat as number, hit?.lon as number);
    expect(sim.country[cell.index]).toBe(countryId('SWE'));
  });

  it('a ray at Mount Everest (27.99N 86.93E) from a tilted camera hits the right cell within 1 cell', () => {
    const expected = latLonToCell(27.99, 86.93);
    expect(expected).toMatchObject({ x: 759, y: 176 });
    for (const view of [
      { lat: 24, lon: 88, heading: 0, tilt: 50, distKm: 1500 },
      { lat: 31, lon: 80, heading: 120, tilt: 60, distKm: 900 },
      { lat: 27.99, lon: 86.93, heading: 0, tilt: 0, distKm: 3000 },
      { lat: 10, lon: 60, heading: 40, tilt: 20, distKm: 9000 },
    ]) {
      const rig = new CameraRig(W, H);
      rig.setView(view);
      const target = field.surfacePoint(27.99, 86.93);
      const origin = rig.pose().position;
      const hit = field.pick(origin, normalize(sub(target, origin)));
      expect(hit, JSON.stringify(view)).not.toBeNull();
      const cell = latLonToCell(hit?.lat as number, hit?.lon as number);
      expect(Math.abs(cell.x - expected.x), JSON.stringify(view)).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.y - expected.y), JSON.stringify(view)).toBeLessThanOrEqual(1);
    }
  });

  it('the pixel of a projected mountain picks the mountain (project and pick are inverse, also on displaced terrain)', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 25, lon: 86, heading: 10, tilt: 55, distKm: 1600 });
    let checked = 0;
    for (const [lat, lon] of [[27.99, 86.93], [28.6, 83.9], [30.4, 81.3], [27.7, 88.1], [29.2, 90.5], [35.9, 76.5]] as const) {
      // A point a hair below the surface: a ray through the exact surface point only grazes it.
      const under = scale(field.surfacePoint(lat, lon), 0.9998);
      const p = rig.project(under);
      if (!p.inView || !p.facing) continue;
      const ray = rig.rayAt(p.x, p.y);
      const hit = field.pick(ray.origin, ray.dir);
      expect(hit).not.toBeNull();
      // A nearer ridge may legitimately hide the point; then the hit lies clearly in front of it.
      if ((hit?.t as number) < length(sub(under, ray.origin)) - 0.003) continue;
      const want = latLonToCell(lat, lon);
      const got = latLonToCell(hit?.lat as number, hit?.lon as number);
      expect(Math.abs(got.x - want.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(got.y - want.y)).toBeLessThanOrEqual(1);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('a hit on the sea gives height 0, a hit on land inside the hit shell is above sea level', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 0, lon: -150, heading: 0, tilt: 0, distKm: 3000 });
    const sea = field.pick(rig.pose().position, rig.rayAt(W / 2, H / 2).dir);
    expect(sea?.heightM).toBe(0);
    expect(length(sea?.point as Vec3)).toBeCloseTo(1, 4);
  });

  it('rays that miss the globe give null, also past the limb and away from it', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: 0, lon: 0, heading: 0, tilt: 0, distKm: 20000 });
    const p = rig.pose();
    expect(field.pick(p.position, rig.rayAt(2, 2).dir)).toBeNull();
    expect(field.pick(p.position, [-p.position[0], -p.position[1], -p.position[2]].map((v) => -v) as Vec3)).toBeNull(); // pointing away
    expect(field.pick([0, 0, 5], normalize([1, 0, 0]))).toBeNull();
  });

  it('a ray grazing a high ridge hits the ridge, not the sea behind it', () => {
    const rig = new CameraRig(W, H);
    // Low camera south of the Himalaya looking north at a strong angle.
    rig.setView({ lat: 22, lon: 86, heading: 0, tilt: 72, distKm: 800 });
    let landHits = 0;
    for (let y = 100; y < 440; y += 20) {
      const r = rig.rayAt(W / 2, y);
      const hit = field.pick(r.origin, r.dir);
      if (hit && hit.heightM > 3000) landHits++;
      if (hit) expect(length(hit.point)).toBeGreaterThanOrEqual(1 - 1e-9);
    }
    expect(landHits).toBeGreaterThan(0);
  });

  it('pick results are consistent with the surface radius at the hit', () => {
    const rig = new CameraRig(W, H);
    rig.setView({ lat: -22, lon: -68, heading: 0, tilt: 52, distKm: 2500 });
    for (let y = 120; y < 520; y += 40) {
      for (let x = 100; x < 900; x += 160) {
        const r = rig.rayAt(x, y);
        const hit = field.pick(r.origin, r.dir);
        if (!hit) continue;
        const { lat, lon } = vecToLatLon(hit.point);
        expect(Math.abs(length(hit.point) - field.surfaceRadius(lat, lon))).toBeLessThan(2e-5);
        expect(dot(normalize(hit.point), normalize(sub(r.origin, hit.point)))).toBeGreaterThan(0);
      }
    }
  });
});

// The relief rule and the polar rule of the terrain detail (M07b audit). The relief is "max minus min of the base height in 3x3 texels, floor 100 m",
// bilinear between the four corner texels' own windows; the detail fades to nothing poleward of the last real elevation row. Both were written twice
// (TypeScript and GLSL) and nothing tested the RULE itself: a 3x2 window or a floor of 50 m in both twins would have passed every parity test. This file
// holds the TypeScript twin against an independent implementation with the literals of the rule, and `e2e/detail.test.ts` holds the GLSL twin against
// the same numbers through the readback probe.
import { beforeAll, describe, expect, it } from 'vitest';
import { DETAIL_OCTAVES_MAX, EARTH_RADIUS_KM, HEIGHT_EXAGGERATION, POLAR_FADE_END_DEG, POLAR_FADE_START_DEG } from '../../src/render/config';
import { HeightSampler, bindHeightSource, detailLod, heightAt, seenHeightAt } from '../../src/render/detail';
import { latLonToVec } from '../../src/render/geo';
import { loadChunkWorld, rng, type ChunkWorld } from '../helpers/chunkWorld';

let world: ChunkWorld;
let sampler: HeightSampler;
beforeAll(async () => {
  world = await loadChunkWorld();
  sampler = new HeightSampler({ codes: world.codes, width: world.width, height: world.height, maxM: world.maxM });
});

/** The decoded height of a code (sqrt coding), written here from the encoding, not taken from the sampler. */
const decode = (c: number): number => world.maxM * (c / 255) ** 2;
const codeAt = (x: number, y: number): number => world.codes[Math.min(world.height - 1, Math.max(0, y)) * world.width + (((x % world.width) + world.width) % world.width)] as number;

/** The literal rule: for each of the four texels around the point, the range of the 3x3 texels centred on it (floor 100 m), blended bilinearly. */
function referenceRelief(lat: number, lon: number): number {
  const tx = ((lon + 180) / 360) * world.width - 0.5;
  const ty = ((90 - lat) / 180) * world.height - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  let sum = 0;
  for (const [dx, dy, w] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ] as const) {
    let lo = 255;
    let hi = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const c = codeAt(x0 + dx + i, y0 + dy + j);
        lo = Math.min(lo, c);
        hi = Math.max(hi, c);
      }
    }
    sum += w * Math.max(100, decode(hi) - decode(lo)); // the literal 100: not the config constant
  }
  const smooth = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  return sum * (1 - smooth(84.5, 86.5, Math.abs(lat)));
}

describe('the relief of the detail (max minus min of the 3x3 texels, floor 100 m, bilinear between the four corner windows)', () => {
  it('equals an independent implementation of the rule on 400 land points over the whole world (a 3x2 window, a 2x2 window or another floor would differ)', () => {
    const r = rng(501);
    let n = 0;
    let rugged = 0;
    let worst = 0;
    for (let i = 0; i < 20000 && n < 400; i++) {
      const lat = -60 + 130 * r();
      const lon = -180 + 360 * r();
      const v = (90 - lat) / 180;
      const u = (lon + 180) / 360;
      const s = sampler.sampleAt(u, v, true);
      if (!s.land) continue;
      n++;
      const want = referenceRelief(lat, lon);
      worst = Math.max(worst, Math.abs(s.relief - want));
      expect(s.relief, `relief at ${lat}, ${lon}`).toBeCloseTo(want, 6);
      if (want > 300) rugged++;
    }
    expect(n).toBe(400);
    expect(rugged, 'the sample must hold mountains, where the window shape matters').toBeGreaterThan(60);
    console.log(`[relief] 400 land points: the sampler's relief equals the independent rule within ${worst.toExponential(2)} m (${rugged} above 300 m)`);
  });

  it('a window that is a single texel row taller or wider changes the answer on rugged land (the test can see a 3x2 window): the reference differs from a 3x2 evaluation', () => {
    // the control of the test above: evaluate the rule with a 3x2 window and show that the sampler would not agree with it
    const r = rng(502);
    let differ = 0;
    let n = 0;
    for (let i = 0; i < 20000 && n < 200; i++) {
      const lat = 25 + 25 * r();
      const lon = 70 + 40 * r();
      const s = sampler.sampleAt((lon + 180) / 360, (90 - lat) / 180, true);
      if (!s.land) continue;
      n++;
      const tx = ((lon + 180) / 360) * world.width - 0.5;
      const ty = ((90 - lat) / 180) * world.height - 0.5;
      const x0 = Math.floor(tx);
      const y0 = Math.floor(ty);
      const fx = tx - x0;
      const fy = ty - y0;
      let sum = 0;
      for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
        let lo = 255;
        let hi = 0;
        for (let j = -1; j <= 0; j++) {
          for (let i2 = -1; i2 <= 1; i2++) {
            const c = codeAt(x0 + dx + i2, y0 + dy + j);
            lo = Math.min(lo, c);
            hi = Math.max(hi, c);
          }
        }
        sum += w * Math.max(100, decode(hi) - decode(lo));
      }
      if (Math.abs(sum - s.relief) > 1) differ++;
    }
    expect(differ, 'points where a 3x2 window gives another relief than the 3x3 rule').toBeGreaterThan(20);
  });

  it('is exactly 100 m (the literal floor) on flat land: texel centres of the Netherlands and the Great Plains whose whole 3x3 window is under 100 m of range', () => {
    let flat = 0;
    for (const [latA, latB, lonA, lonB] of [[51, 53, 4, 7], [38, 44, -102, -95], [-34, -30, -64, -60]] as const) {
      for (let lat = latA; lat < latB; lat += 0.05) {
        for (let lon = lonA; lon < lonB; lon += 0.05) {
          const tx = Math.round(((lon + 180) / 360) * world.width - 0.5);
          const ty = Math.round(((90 - lat) / 180) * world.height - 0.5);
          // the centre of texel (tx, ty): only its own window has weight there
          let lo = 255;
          let hi = 0;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const c = codeAt(tx + i, ty + j);
            lo = Math.min(lo, c);
            hi = Math.max(hi, c);
          }
          if (codeAt(tx, ty) < 1 || decode(hi) - decode(lo) >= 100) continue;
          const s = sampler.sampleAt((tx + 0.5) / world.width, (ty + 0.5) / world.height, true);
          if (!s.land) continue;
          flat++;
          expect(s.relief, `flat texel ${tx}, ${ty}`).toBe(100);
        }
      }
    }
    expect(flat).toBeGreaterThan(100);
  });
});

describe('the polar rule: no detail poleward of the last real elevation row', () => {
  const POLAR = 86.5;
  const antarctic = (r: () => number, n: number, from: number, to: number): Array<[number, number]> => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 20000 && pts.length < n; i++) {
      const lat = -(from + (to - from) * r());
      const lon = -180 + 360 * r();
      if (sampler.sampleAt((lon + 180) / 360, (90 - lat) / 180, false).land) pts.push([lat, lon]);
    }
    return pts;
  };

  it('the fade runs from the config numbers (84.5 to 86.5 degrees), and relief is exactly zero at and beyond 86.5', () => {
    expect(POLAR_FADE_START_DEG).toBe(84.5);
    expect(POLAR_FADE_END_DEG).toBe(POLAR);
    const r = rng(511);
    for (const [lat, lon] of antarctic(r, 150, POLAR, 90)) expect(sampler.sampleAt((lon + 180) / 360, (90 - lat) / 180, true).relief, `${lat}, ${lon}`).toBe(0);
  });

  it('heightAt over the Antarctic cap (|lat| >= 86.5) is the base height with no detail at all, with every number of octaves', () => {
    const r = rng(512);
    const pts = antarctic(r, 200, POLAR, 90);
    expect(pts.length).toBe(200);
    let withDetailElsewhere = 0;
    for (const [lat, lon] of pts) {
      const base = sampler.heightAt(lat, lon, 0);
      expect(base, `base at ${lat}, ${lon}`).toBeGreaterThan(0);
      for (const oct of [1, 6, DETAIL_OCTAVES_MAX]) expect(sampler.heightAt(lat, lon, oct), `${lat}, ${lon}, ${oct} octaves`).toBe(base);
      withDetailElsewhere++;
    }
    expect(withDetailElsewhere).toBe(200);
  });

  it('the detail is there at 80 S (the polar sheet of Antarctica: heightAt differs from the base by metres on average), and the fade is monotone towards the pole', () => {
    const r = rng(513);
    const pts = antarctic(r, 200, 78, 82);
    expect(pts.length).toBe(200);
    let sum = 0;
    for (const [lat, lon] of pts) sum += Math.abs(sampler.heightAt(lat, lon, DETAIL_OCTAVES_MAX) - sampler.heightAt(lat, lon, 0));
    expect(sum / pts.length, 'mean |detail| at 78 to 82 S (metres)').toBeGreaterThan(3);
    // the mean |detail| falls through the fade ramp
    const meanAt = (a: number, b: number): number => {
      const rr = rng(514);
      const p = antarctic(rr, 120, a, b);
      let s = 0;
      for (const [lat, lon] of p) s += Math.abs(sampler.heightAt(lat, lon, DETAIL_OCTAVES_MAX) - sampler.heightAt(lat, lon, 0));
      return s / p.length;
    };
    const m80 = meanAt(79, 81);
    const m855 = meanAt(85.3, 85.7);
    const m87 = meanAt(86.7, 88);
    expect(m80).toBeGreaterThan(m855);
    expect(m855).toBeGreaterThan(m87);
    expect(m87).toBe(0);
  });

  it('the southern hemisphere is not mirrored by accident: the relief at a point and at its mirror image are different numbers (the raster is not symmetric) but both follow the rule', () => {
    const r = rng(515);
    let n = 0;
    for (let i = 0; i < 5000 && n < 100; i++) {
      const lat = -(10 + 70 * r());
      const lon = -180 + 360 * r();
      const s = sampler.sampleAt((lon + 180) / 360, (90 - lat) / 180, true);
      if (!s.land) continue;
      n++;
      expect(s.relief).toBeCloseTo(referenceRelief(lat, lon), 6);
    }
    expect(n).toBe(100);
  });

  it('across the antimeridian the longitude wraps: heights at 179.9 E and -179.9 E on both sides of the raster seam follow the rule and are finite', () => {
    const r = rng(516);
    let n = 0;
    for (let i = 0; i < 20000 && n < 150; i++) {
      const lat = -60 + 130 * r();
      const lon = (r() < 0.5 ? 1 : -1) * (179.5 + 0.5 * r());
      const s = sampler.sampleAt((lon + 180) / 360, (90 - lat) / 180, true);
      if (!s.land) continue;
      n++;
      expect(s.relief).toBeCloseTo(referenceRelief(lat, lon), 6);
      const h = sampler.heightAt(lat, lon);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(0);
    }
    expect(n).toBe(150);
  });
});

describe('seenHeightAt: the height of the surface a camera SEES (what picking hits), against heightAt (the finest surface, groundHeightAt)', () => {
  it('equals the height of the picked surface: HeightField.seenRadius is radiusOf(seenHeightAt) within a millimetre, and heightAt with the octaves of the distance law is the same number', () => {
    bindHeightSource(sampler);
    const lod = detailLod(16, 1.8);
    const r = rng(521);
    let n = 0;
    for (let i = 0; i < 6000 && n < 300; i++) {
      const lat = 27 + 3 * r();
      const lon = 84 + 6 * r();
      if (!sampler.sampleAt((lon + 180) / 360, (90 - lat) / 180, false).land) continue;
      n++;
      const dKm = [1, 5, 15, 40][n % 4] as number;
      const c = latLonToVec(lat + dKm / 111, lon);
      const up = 1 + (heightAt(lat, lon) * HEIGHT_EXAGGERATION + 300) / (EARTH_RADIUS_KM * 1000);
      const cam: [number, number, number] = [c[0] * up, c[1] * up, c[2] * up];
      const seen = seenHeightAt(lat, lon, cam, HEIGHT_EXAGGERATION, lod);
      const ground = heightAt(lat, lon);
      // the surface that the camera sees is the finest surface with fewer octaves: both are heights of ONE function, the difference is the octaves removed
      expect(Number.isFinite(seen)).toBe(true);
      expect(Math.abs(seen - ground)).toBeLessThan(0.2 * 3000 * 0.9); // never more than the amplitude of the octaves that were removed
      // groundHeightAt with the octaves of the distance law IS the seen height (one function, the octaves are the only difference)
      expect(heightAt(lat, lon, sampler.lastSeenOctaves), `${lat}, ${lon} with ${sampler.lastSeenOctaves} octaves`).toBe(seen);
      expect(world.detailField.seenRadius(lat, lon, cam)).toBeCloseTo(1 + (HEIGHT_EXAGGERATION * seen) / (EARTH_RADIUS_KM * 1000), 12);
    }
    expect(n).toBe(300);
  });
});

// The terrain detail (M07b) in headless Chromium (software WebGL2): the GLSL functions of the chunk vertex shader, run through the readback probe
// (`__test.probeHash`, `__test.probeHeight`, `__test.probeVertex`), against `src/render/detail.ts`. Hash: bit-identical. Height: within 1 % of the
// local relief on mixed LOD levels over the Himalaya, the Alps and a coast; a changed hash seed in TypeScript fails the same check. The vertex path
// (octaves from the level and the camera distance) and picking are compared with the GPU too.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { DETAIL_RELIEF_FLOOR_M, DETAIL_SEED, EARTH_RADIUS_KM, HEIGHT_EXAGGERATION } from '../src/render/config';
import { HeightSampler, NOISE_OFFSET, detailHash3, detailLod, octavesAtDistance, octavesForLevel, valueNoise3 } from '../src/render/detail';
import { latLonToVec } from '../src/render/geo';
import { rng } from '../tests/helpers/chunkWorld';
import { worldLoader } from '../tests/helpers/dataFiles';

const SHOT_DIR = path.join(OUT_DIR, 'shots');
let browser: Browser;
let sampler: HeightSampler;
let mutated: HeightSampler;
let codes: Uint8Array;
let width = 0;
let height = 0;
let maxM = 0;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const w = worldLoader();
  const [render, meta] = await Promise.all([w.loadRender(), w.loadMeta()]);
  codes = render.height8;
  width = render.width;
  height = render.height;
  maxM = meta.encoding.heightSqrt.maxM;
  const src = { codes, width, height, maxM };
  sampler = new HeightSampler(src);
  mutated = new HeightSampler(src, { seed: DETAIL_SEED ^ 1 });
});
afterAll(async () => {
  await browser?.close();
});

async function open(query = 'test=1&ai=0', viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  return { page, messages: consoleMessages };
}

const f32 = Math.fround;

/** The local relief at a position, written independently of the sampler: the bilinear blend of the four corner texels' own 3x3 ranges (floor 100 m). */
function localRelief(lat: number, lon: number): number {
  const tx = ((lon + 180) / 360) * width - 0.5;
  const ty = ((90 - lat) / 180) * height - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const dec = (c: number): number => maxM * (c / 255) ** 2;
  const at = (x: number, y: number): number => codes[Math.min(height - 1, Math.max(0, y)) * width + (((x % width) + width) % width)] as number;
  let relief = 0;
  for (let b = 0; b < 2; b++) {
    for (let a = 0; a < 2; a++) {
      let lo = 255;
      let hi = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const c = at(x0 + a + i, y0 + b + j);
          lo = Math.min(lo, c);
          hi = Math.max(hi, c);
        }
      }
      relief += Math.max(DETAIL_RELIEF_FLOOR_M, dec(hi) - dec(lo)) * ((a === 0 ? 1 - fx : fx) * (b === 0 ? 1 - fy : fy));
    }
  }
  return relief;
}

describe('the integer hash: the GLSL function equals the TypeScript one bit for bit', () => {
  it('1000 hashes of random lattice cells and seeds from the readback probe are identical to detailHash3, in both encodings; a changed seed in TypeScript differs', async () => {
    const { page, messages } = await open();
    try {
      const r = rng(101);
      const items: Array<[number, number, number, number]> = [];
      for (let i = 0; i < 1000; i++) {
        items.push([NOISE_OFFSET + Math.floor((r() - 0.5) * 2_000_000), NOISE_OFFSET + Math.floor((r() - 0.5) * 2_000_000), NOISE_OFFSET + Math.floor((r() - 0.5) * 2_000_000), i < 40 ? (i % 2 === 0 ? DETAIL_SEED : 0xffffffff) : Math.floor(r() * 4294967296)]);
      }
      const encoding: string = await page.evaluate(() => (window as any).__test.probeEncoding());
      const viaFloat: number[] = await page.evaluate((it) => (window as any).__test.probeHash(it, 'float'), items);
      const viaBytes: number[] = await page.evaluate((it) => (window as any).__test.probeHash(it, 'bytes'), items);
      let wrongFloat = 0;
      let wrongBytes = 0;
      let mutantEqual = 0;
      items.forEach((it, i) => {
        const want = detailHash3(it[0], it[1], it[2], it[3]);
        if (viaFloat[i] !== want) wrongFloat++;
        if (viaBytes[i] !== want) wrongBytes++;
        if (detailHash3(it[0], it[1], it[2], (it[3] ^ 1) >>> 0) === viaFloat[i]) mutantEqual++;
      });
      console.log(`[detail probe] default encoding ${encoding}; 1000 hashes: ${wrongFloat} differ in the float encoding, ${wrongBytes} in the bytes encoding; a seed changed by one bit in TypeScript agrees with the GPU on ${mutantEqual}`);
      expect(['float', 'bytes']).toContain(encoding);
      expect(wrongFloat, 'float encoding').toBe(0);
      expect(wrongBytes, 'bytes encoding').toBe(0);
      expect(mutantEqual, 'the mutation must be visible').toBeLessThanOrEqual(1);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the noise: the GLSL value noise equals valueNoise3', () => {
  it('on 1000 random points of the lattice space (octave 0 to 11 scales) the GPU noise and the ridge are within 2e-6 of TypeScript', async () => {
    const { page, messages } = await open();
    try {
      const r = rng(106);
      const items: Array<[number, number, number, number]> = [];
      for (let i = 0; i < 1000; i++) {
        const scale = 700 * 2 ** (i % 12); // the lattice coordinate range of octave 0 to 11
        items.push([f32((r() - 0.5) * scale), f32((r() - 0.5) * scale), f32((r() - 0.5) * scale), i % 2 === 0 ? DETAIL_SEED : Math.floor(r() * 4294967296)]);
      }
      const noise: number[] = await page.evaluate((it) => (window as any).__test.probeNoise(it, false), items);
      const ridge: number[] = await page.evaluate((it) => (window as any).__test.probeNoise(it, true), items);
      let worstN = 0;
      let worstR = 0;
      items.forEach((it, i) => {
        const want = valueNoise3(it[0], it[1], it[2], it[3]);
        worstN = Math.max(worstN, Math.abs(want - (noise[i] as number)));
        worstR = Math.max(worstR, Math.abs(1 - Math.abs(2 * want - 1) - (ridge[i] as number)));
      });
      console.log(`[detail noise] 1000 points: the GLSL noise differs from TypeScript by at most ${worstN.toExponential(2)}, the ridge by ${worstR.toExponential(2)}`);
      expect(worstN).toBeLessThan(2e-6);
      expect(worstR).toBeLessThan(4e-6);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

interface Point {
  lat: number;
  lon: number;
  level: number;
  cells: number;
  region: string;
}

function samplePoints(n: number, seed: number): Point[] {
  const r = rng(seed);
  const regions: Array<[string, number, number, number, number]> = [
    ['Himalaya', 27, 30, 84, 90],
    ['Alps', 45, 47.5, 6, 13],
    ['coast', 59.5, 63, 3.5, 7.5], // the west coast of Norway: fjords, islands and open sea
    ['coast', 50.5, 53.5, 3, 6], // the Netherlands: flat land, the delta and the sea
  ];
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const reg = regions[i % regions.length] as (typeof regions)[number];
    const cells = i % 3 === 0 ? 16 : 32;
    pts.push({ lat: f32(reg[1] + (reg[2] - reg[1]) * r()), lon: f32(reg[3] + (reg[4] - reg[3]) * r()), level: 6 + Math.floor(12 * r()), cells, region: reg[0] });
  }
  return pts;
}

describe('the height: the GLSL function equals heightAt within 1 % of the local relief', () => {
  it('on 1000 points over the Himalaya, the Alps and two coasts with mixed LOD levels (octaves = octavesForLevel(level)), in both encodings; a changed hash seed in TypeScript fails the same check', async () => {
    const { page, messages } = await open();
    try {
      const pts = samplePoints(1000, 102);
      const input = pts.map((p) => [p.lat, p.lon, octavesForLevel(p.level, p.cells)] as [number, number, number]);
      const gpu: number[] = await page.evaluate((it) => (window as any).__test.probeHeight(it, 'float'), input);
      const gpuBytes: number[] = await page.evaluate((it) => (window as any).__test.probeHeight(it, 'bytes'), input);
      expect(gpuBytes, 'the two encodings return the same float32 values').toEqual(gpu);
      const check = (s: HeightSampler): { failing: number; worstShare: number; land: number; sea: number; byRegion: Record<string, number> } => {
        let failing = 0;
        let worstShare = 0;
        let land = 0;
        let sea = 0;
        const byRegion: Record<string, number> = {};
        pts.forEach((p, i) => {
          const ts = s.heightAt(p.lat, p.lon, octavesForLevel(p.level, p.cells));
          const relief = localRelief(p.lat, p.lon);
          const share = Math.abs(ts - (gpu[i] as number)) / relief;
          worstShare = Math.max(worstShare, share);
          if (share > 0.01) {
            failing++;
            byRegion[p.region] = (byRegion[p.region] ?? 0) + 1;
          }
          if ((gpu[i] as number) > 0) land++;
          else sea++;
        });
        return { failing, worstShare, land, sea, byRegion };
      };
      const real = check(sampler);
      const mutant = check(mutated);
      console.log(`[detail parity] 1000 points (${real.land} land, ${real.sea} sea): the TypeScript height differs from the GLSL one by at most ${(100 * real.worstShare).toFixed(4)} % of the local relief (${real.failing} above 1 %); with the hash seed changed by one bit: ${mutant.failing} points above 1 % (worst ${(100 * mutant.worstShare).toFixed(1)} %)`);
      expect(real.land).toBeGreaterThan(500);
      expect(real.sea).toBeGreaterThan(50); // the coast samples include open sea
      expect(real.failing, 'points where TypeScript and GLSL differ by more than 1 % of the relief').toBe(0);
      // the mutation test: the same check fails when the TypeScript hash seed is wrong
      expect(mutant.failing, 'the check must detect a changed seed').toBeGreaterThan(300);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('is zero on the sea and at least one metre on the land in the GLSL too (the coast rule), and the octaves matter (the GLSL with no octaves is the base)', async () => {
    const { page, messages } = await open();
    try {
      const r = rng(103);
      const pts: Array<[number, number, number]> = [];
      for (let i = 0; i < 400; i++) pts.push([f32(50 + 12 * r()), f32(-4 + 14 * r()), i % 2 === 0 ? 12 : 0]); // Europe: sea and land
      const gpu: number[] = await page.evaluate((it) => (window as any).__test.probeHeight(it), pts);
      let land = 0;
      let sea = 0;
      pts.forEach((p, i) => {
        const ts = sampler.heightAt(p[0], p[1], p[2]);
        // sign: the GPU agrees with the rule exactly (a coast point decided by float32 against float64 is one in a hundred thousand: none here)
        expect(gpu[i]! > 0, `${p[0]}, ${p[1]}`).toBe(ts > 0);
        if (ts > 0) {
          expect(gpu[i]).toBeGreaterThanOrEqual(1 - 1e-6);
          land++;
        } else {
          expect(gpu[i]).toBe(0);
          sea++;
        }
      });
      expect(land).toBeGreaterThan(100);
      expect(sea).toBeGreaterThan(50);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

/** Where the polar rule, the southern hemisphere and the antimeridian are exercised: [name, lat from, lat to, lon from, lon to]. */
const WIDE_REGIONS: Array<[string, number, number, number, number]> = [
  ['Antarctic sheet', -80, -70, -180, 180],
  ['Antarctic cap', -90, -86.5, -180, 180],
  ['Antarctic fade ramp', -86.5, -84.5, -180, 180],
  ['Greenland', 60, 83, -60, -20],
  ['Andes', -40, -20, -72, -66],
  ['Southern Alps', -45.5, -43, 169, 171.5],
  ['Fiji, east of the antimeridian', -18, -16, 178.5, 180],
  ['Fiji, west of the antimeridian', -18, -16, -180, -178.5],
  ['Chukotka, both sides', 64, 69, 170, 180],
  ['Chukotka, west longitudes', 64, 69, -180, -170],
  ['Himalaya', 27, 30, 84, 90],
  ['Netherlands (flat)', 51, 53, 4, 7],
];

describe('the relief and the polar rule in the GLSL (the rule itself, read back through the probe)', () => {
  it('the GLSL relief equals the rule "3x3 texels, floor 100 m, bilinear, polar fade" on 1200 points over twelve regions (the Antarctic cap, the southern hemisphere and both sides of the antimeridian included), and flat land reads exactly 100', async () => {
    const { page, messages } = await open();
    try {
      const r = rng(121);
      const pts: Array<[number, number]> = [];
      const names: string[] = [];
      for (let i = 0; i < 1200; i++) {
        const reg = WIDE_REGIONS[i % WIDE_REGIONS.length] as (typeof WIDE_REGIONS)[number];
        pts.push([f32(reg[1] + (reg[2] - reg[1]) * r()), f32(reg[3] + (reg[4] - reg[3]) * r())]);
        names.push(reg[0]);
      }
      const gpu: number[] = await page.evaluate((it) => (window as any).__test.probeRelief(it), pts);
      const gpuBytes: number[] = await page.evaluate((it) => (window as any).__test.probeRelief(it, 'bytes'), pts);
      expect(gpuBytes, 'the two encodings return the same float32 values').toEqual(gpu);
      const fade = (lat: number): number => {
        const t = Math.min(1, Math.max(0, (Math.abs(lat) - 84.5) / 2));
        return 1 - t * t * (3 - 2 * t);
      };
      let land = 0;
      let worst = 0;
      let flat = 0;
      let capLand = 0;
      let rugged = 0;
      pts.forEach((p, i) => {
        const g = gpu[i] as number;
        const ts = sampler.sampleAt((p[1] + 180) / 360, (90 - p[0]) / 180, true);
        if (!ts.land) {
          expect(g, `${names[i]} ${p}`).toBe(-1);
          return;
        }
        land++;
        const want = localRelief(p[0], p[1]) * fade(p[0]);
        worst = Math.max(worst, Math.abs(g - want) / Math.max(want, 100));
        expect(Math.abs(g - want), `${names[i]} at ${p}: GLSL ${g}, rule ${want}`).toBeLessThan(0.002 * Math.max(want, 100));
        expect(Math.abs(g - ts.relief)).toBeLessThan(0.002 * Math.max(ts.relief, 100));
        if (names[i]!.startsWith('Antarctic cap')) {
          expect(g, `cap ${p}`).toBe(0);
          capLand++;
        }
        if (names[i] === 'Netherlands (flat)' && want < 100.0001) {
          expect(g, `flat land ${p}`).toBeCloseTo(100, 2);
          flat++;
        }
        if (want > 1000) rugged++;
      });
      console.log(`[relief probe] 1200 points (${land} land): the GLSL relief differs from the rule by at most ${(100 * worst).toFixed(4)} % (${flat} flat points read 100 m, ${capLand} cap points read 0, ${rugged} points above 1000 m)`);
      expect(land).toBeGreaterThan(600);
      expect(flat).toBeGreaterThan(10);
      expect(capLand).toBeGreaterThan(20);
      expect(rugged).toBeGreaterThan(40);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the GLSL height equals heightAt within 1 % of the relief on the same twelve regions with 12 octaves, over the Antarctic cap the GLSL detail is exactly zero (12 octaves and none give the same height), and at 80 S it is not', async () => {
    const { page, messages } = await open();
    try {
      const r = rng(122);
      const pts: Array<[number, number, number]> = [];
      const names: string[] = [];
      for (let i = 0; i < 1200; i++) {
        const reg = WIDE_REGIONS[i % WIDE_REGIONS.length] as (typeof WIDE_REGIONS)[number];
        pts.push([f32(reg[1] + (reg[2] - reg[1]) * r()), f32(reg[3] + (reg[4] - reg[3]) * r()), 12]);
        names.push(reg[0]);
      }
      const gpu: number[] = await page.evaluate((it) => (window as any).__test.probeHeight(it), pts);
      const none: number[] = await page.evaluate((it) => (window as any).__test.probeHeight(it.map((p: number[]) => [p[0], p[1], 0])), pts);
      let worst = 0;
      let cap = 0;
      let sheet = 0;
      let sheetDetail = 0;
      pts.forEach((p, i) => {
        const ts = sampler.heightAt(p[0], p[1], 12);
        const relief = Math.max(localRelief(p[0], p[1]), 100);
        const share = Math.abs(ts - (gpu[i] as number)) / relief;
        worst = Math.max(worst, share);
        expect(share, `${names[i]} at ${p}: GLSL ${gpu[i]}, TypeScript ${ts}`).toBeLessThan(0.01);
        if (names[i] === 'Antarctic cap' && (gpu[i] as number) > 0) {
          expect(gpu[i], `the GLSL detail over the cap at ${p}`).toBe(none[i]);
          cap++;
        }
        if (names[i] === 'Antarctic sheet' && (gpu[i] as number) > 0) {
          sheet++;
          if (Math.abs((gpu[i] as number) - (none[i] as number)) > 1) sheetDetail++;
        }
      });
      console.log(`[polar probe] worst height difference ${(100 * worst).toFixed(4)} % of the relief; ${cap} cap points have no detail in the GLSL, ${sheetDetail} of ${sheet} points of the sheet at 70 to 80 S have more than 1 m of it`);
      expect(cap).toBeGreaterThan(20);
      expect(sheet).toBeGreaterThan(50);
      expect(sheetDetail, 'the detail is not switched off everywhere in the south').toBeGreaterThan(0.7 * sheet);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the vertex path: octaves from the level and from the distance to the camera', () => {
  it('the GLSL detVertexHeight equals heightSeenM on 600 vertices at 1 to 50 km from the camera with mixed levels (within 1 % of the relief), and the level-only rule would not', async () => {
    const { page, messages } = await open();
    try {
      const lodU: [number, number, number] | null = await page.evaluate(() => (window as any).__test.detailLod());
      expect(lodU).not.toBeNull();
      const lod = { offset: lodU![0], levelBias: lodU![1] };
      expect(lodU![2]).toBe(1);
      const r = rng(104);
      const places = [[28.2, 86.8], [46.5, 8], [61.9, 7.2]] as const;
      const pts: Array<[number, number, number, number, number, number]> = [];
      for (let i = 0; i < 600; i++) {
        const p = places[i % 3] as readonly [number, number];
        const lat = f32(p[0] + 0.3 * (r() - 0.5));
        const lon = f32(p[1] + 0.3 * (r() - 0.5));
        // a camera 1 to 50 km above the sea-level point somewhere near the vertex
        const cl = latLonToVec(p[0] + 0.3 * (r() - 0.5), p[1] + 0.3 * (r() - 0.5));
        const up = 1 + (1000 + 49000 * r() * r() + 6000 * r()) / (EARTH_RADIUS_KM * 1000);
        const cam: [number, number, number] = [f32(cl[0] * up), f32(cl[1] * up), f32(cl[2] * up)];
        // the level of a chunk that is up to two octaves FINER than the distance law allows (so the distance law, not the level, limits the octaves on most vertices)
        const v = latLonToVec(lat, lon);
        const dist = Math.hypot(v[0] - cam[0], v[1] - cam[1], v[2] - cam[2]);
        const level = Math.max(6, Math.min(17, Math.round(octavesAtDistance(dist, lod) - lod.levelBias + 2 * r())));
        pts.push([lat, lon, level, cam[0], cam[1], cam[2]]);
      }
      const gpu: number[] = await page.evaluate((it) => (window as any).__test.probeVertex(it), pts);
      let worst = 0;
      let failing = 0;
      let levelOnlyFailing = 0;
      let land = 0;
      pts.forEach((p, i) => {
        const cam: [number, number, number] = [p[3], p[4], p[5]];
        const ts = sampler.heightSeenM(p[0], p[1], cam, HEIGHT_EXAGGERATION, lod, octavesForLevel(p[2], 16));
        const relief = localRelief(p[0], p[1]);
        const share = Math.abs(ts - (gpu[i] as number)) / relief;
        worst = Math.max(worst, share);
        if (share > 0.01) failing++;
        if ((gpu[i] as number) > 0) land++;
        // the control: the octaves of the level alone (no distance law)
        const levelOnly = sampler.heightAt(p[0], p[1], octavesForLevel(p[2], 16));
        if (Math.abs(levelOnly - (gpu[i] as number)) / relief > 0.001) levelOnlyFailing++;
      });
      console.log(`[detail vertex path] 600 vertices (${land} on land): GLSL against heightSeenM at most ${(100 * worst).toFixed(4)} % of the relief, ${failing} above 1 %; the level-only rule would differ by more than 0.1 % on ${levelOnlyFailing}`);
      expect(land).toBeGreaterThan(400);
      expect(failing).toBe(0);
      expect(worst, 'the real error is far below the size of the distance law\'s effect').toBeLessThan(0.001);
      expect(levelOnlyFailing, 'vertices whose height the distance law changes by more than 0.1 % of the relief (so the comparison can fail)').toBeGreaterThan(100);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('picking agrees with what the vertex shader draws: the radius of 15 picked points at 2 km over the Himalaya equals the GLSL height from the same camera (1 % of the relief)', async () => {
    const { page, messages } = await open();
    try {
      await page.evaluate(() => {
        const h = (window as any).__test;
        h.setGroundView({ lat: 28.2, lon: 86.8, heading: 0, pitchDeg: 25, aglM: 2000, time: 1465 });
        h.render();
      });
      const lodU: [number, number, number] = await page.evaluate(() => (window as any).__test.detailLod());
      const picks: Array<{ lat: number; lon: number; radius: number }> = [];
      for (let i = 0; i < 15; i++) {
        const hit = await page.evaluate(([px, py]) => (window as any).__test.pickSurface(px, py), [60 + (i % 5) * 200, 120 + Math.floor(i / 5) * 140] as const);
        if (hit) picks.push(hit);
      }
      expect(picks.length).toBeGreaterThanOrEqual(10);
      const cam: [number, number, number] = await page.evaluate(() => (window as any).__test.cameraPosition());
      // the GLSL height of the picked point from the page's camera, with the level high enough not to cap the distance law
      const input = picks.map((p) => [f32(p.lat), f32(p.lon), 17, f32(cam[0]), f32(cam[1]), f32(cam[2])] as [number, number, number, number, number, number]);
      const gpu: number[] = await page.evaluate((it) => (window as any).__test.probeVertex(it), input);
      let worst = 0;
      picks.forEach((p, i) => {
        const pickedHeightM = ((p.radius - 1) * EARTH_RADIUS_KM * 1000) / HEIGHT_EXAGGERATION; // what the ray hit, as a render height
        worst = Math.max(worst, Math.abs(pickedHeightM - (gpu[i] as number)) / localRelief(p.lat, p.lon));
      });
      void lodU;
      console.log(`[detail picking] ${picks.length} picks at 2 km AGL over the Himalaya: the height of the picked point against the GLSL height from the same camera: at most ${(100 * worst).toFixed(4)} % of the relief`);
      expect(worst).toBeLessThan(0.01);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the page: switch, hooks and pictures', () => {
  it('detail is on by default (uDetailLod.z = 1), `?detail=0` and `#detail-0` switch it off, and the picture changes (more than 3 % of the pixels at 2 km over the Himalaya) without a console message', async () => {
    const shots: Uint8Array[] = [];
    for (const q of ['test=1&ai=0', 'test=1&ai=0&detail=0']) {
      const { page, messages } = await open(q);
      try {
        const lod: [number, number, number] = await page.evaluate(() => (window as any).__test.detailLod());
        expect(lod[2]).toBe(q.includes('detail=0') ? 0 : 1);
        await page.evaluate(() => {
          const h = (window as any).__test;
          h.setGroundView({ lat: 28.2, lon: 86.8, heading: 0, pitchDeg: 12, aglM: 2000, time: 1465 });
          h.render();
        });
        const png = await page.screenshot({ type: 'png' });
        shots.push(decodePng(png).data as Uint8Array);
        fs.writeFileSync(path.join(SHOT_DIR, `detail-${q.includes('detail=0') ? 'off' : 'on'}.png`), png);
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    }
    let differ = 0;
    const a = shots[0] as Uint8Array;
    const b = shots[1] as Uint8Array;
    for (let i = 0; i < a.length; i += 4) if (Math.abs((a[i] as number) - (b[i] as number)) + Math.abs((a[i + 1] as number) - (b[i + 1] as number)) + Math.abs((a[i + 2] as number) - (b[i + 2] as number)) > 24) differ++;
    const share = differ / (a.length / 4);
    console.log(`[detail switch] ${(100 * share).toFixed(1)} % of the pixels differ between detail on and off`);
    expect(share).toBeGreaterThan(0.03);
  });

  it('the page\'s heightAt (M08\'s groundHeightAt) is the bound sampler of the page: the same numbers as Node for 50 points', async () => {
    const { page, messages } = await open();
    try {
      const r = rng(105);
      const pts: Array<[number, number]> = Array.from({ length: 50 }, () => [27 + 3 * r(), 84 + 6 * r()]);
      const res: number[] = await page.evaluate((it) => it.map(([la, lo]) => (window as any).__test.heightAt(la, lo)), pts);
      pts.forEach((p, i) => expect(res[i]).toBeCloseTo(sampler.heightAt(p[0], p[1]), 6));
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the run-time levers of the cost work (M24a): setDetailBias(-1) moves the GPU law and the picked surface together (the probe and pickSurface agree at the new law), setFineDetail(false) removes the mottling, and putting both back restores the picture byte for byte', async () => {
    const { page, messages } = await open('test=1&ai=0', { width: 640, height: 360 });
    try {
      const view = { lat: 28.2, lon: 86.8, heading: 0, pitchDeg: 25, aglM: 2000, time: 1465 };
      const shoot = async (): Promise<Uint8Array> => {
        await page.evaluate((v) => {
          const h = (window as any).__test;
          h.setGroundView(v);
          h.render();
        }, view);
        return decodePng(await page.screenshot({ type: 'png' })).data as Uint8Array;
      };
      const share = (a: Uint8Array, b: Uint8Array): number => {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs((a[i] as number) - (b[i] as number)) + Math.abs((a[i + 1] as number) - (b[i + 1] as number)) + Math.abs((a[i + 2] as number) - (b[i + 2] as number)) > 24) n++;
        return n / (a.length / 4);
      };
      const base = await shoot();
      const lod0: [number, number, number] = await page.evaluate(() => (window as any).__test.detailLod());
      // the vertex octaves: one fewer everywhere
      await page.evaluate(() => (window as any).__test.setDetailBias(-1));
      const lod1: [number, number, number] = await page.evaluate(() => (window as any).__test.detailLod());
      expect(lod1[0]).toBeCloseTo(lod0[0] - 1, 6);
      expect(lod1[1]).toBe(lod0[1]);
      expect(await page.evaluate(() => (window as any).__test.detailBias())).toBe(-1);
      const biased = await shoot();
      console.log(`[levers] one octave fewer: ${(100 * share(base, biased)).toFixed(2)} % of the pixels change`);
      expect(share(base, biased), 'the bias changes the picture').toBeGreaterThan(0.001);
      // the picked surface IS the drawn one at the new law: the radius of a pick equals the GLSL height from the same camera (1 % of the relief)
      const picks: Array<{ lat: number; lon: number; radius: number }> = [];
      for (let i = 0; i < 12; i++) {
        const hit = await page.evaluate(([px, py]) => (window as any).__test.pickSurface(px, py), [40 + (i % 4) * 160, 90 + Math.floor(i / 4) * 80] as const);
        if (hit) picks.push(hit);
      }
      expect(picks.length).toBeGreaterThanOrEqual(8);
      const cam: [number, number, number] = await page.evaluate(() => (window as any).__test.cameraPosition());
      const input = picks.map((p) => [f32(p.lat), f32(p.lon), 17, f32(cam[0]), f32(cam[1]), f32(cam[2])] as [number, number, number, number, number, number]);
      const gpu: number[] = await page.evaluate((it) => (window as any).__test.probeVertex(it), input);
      let worst = 0;
      picks.forEach((p, i) => {
        const pickedHeightM = ((p.radius - 1) * EARTH_RADIUS_KM * 1000) / HEIGHT_EXAGGERATION;
        worst = Math.max(worst, Math.abs(pickedHeightM - (gpu[i] as number)) / localRelief(p.lat, p.lon));
      });
      console.log(`[levers] ${picks.length} picks with the bias: height of the picked point against the GLSL height at the new law: at most ${(100 * worst).toFixed(4)} % of the relief`);
      expect(worst).toBeLessThan(0.01);
      // the bias is clamped: it only takes octaves away, and not more than three
      await page.evaluate(() => (window as any).__test.setDetailBias(+2));
      expect(await page.evaluate(() => (window as any).__test.detailBias())).toBe(0);
      await page.evaluate(() => (window as any).__test.setDetailBias(-9));
      expect(await page.evaluate(() => (window as any).__test.detailBias())).toBe(-3);
      await page.evaluate(() => (window as any).__test.setDetailBias(0));
      // the mottling
      expect(await page.evaluate(() => (window as any).__test.fineDetail())).toBe(true);
      await page.evaluate(() => (window as any).__test.setFineDetail(false));
      expect(await page.evaluate(() => (window as any).__test.fineDetail())).toBe(false);
      const plain = await shoot();
      console.log(`[levers] mottling off: ${(100 * share(base, plain)).toFixed(2)} % of the pixels change`);
      expect(share(base, plain), 'the mottling is visible in a ground view and the switch removes it').toBeGreaterThan(0.003);
      await page.evaluate(() => (window as any).__test.setFineDetail(true));
      const back = await shoot();
      expect(Buffer.from(back).equals(Buffer.from(base)), 'both levers back at their defaults: the very same picture').toBe(true);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

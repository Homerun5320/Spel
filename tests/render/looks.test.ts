import { describe, expect, it } from 'vitest';
import { LIGHTS_HEIGHT, LIGHTS_WIDTH, STAR_COUNT } from '../../src/render/config';
import { buildCityLights } from '../../src/render/nightLights';
import { buildPalette, PALETTE_SIZE } from '../../src/render/palette';
import { atmosphereFragmentShader, atmosphereVertexShader, GLSL_ATMOSPHERE } from '../../src/render/shaders/atmosphere';
import { GLSL_BORDERS } from '../../src/render/shaders/borders';
import { GLSL_OCEAN } from '../../src/render/shaders/ocean';
import { starsFragmentShader, starsVertexShader } from '../../src/render/shaders/stars';
import { terrainFragmentShader } from '../../src/render/shaders/terrain';
import { buildStars } from '../../src/render/stars';
import { createTerrainMaterial } from '../../src/render/terrainMaterial';
import { createLookTextures, createWorldTextures } from '../../src/render/textures';
import { worldLoader } from '../helpers/dataFiles';

const declared = (glsl: string): string[] => [...glsl.matchAll(/^\s*uniform\s+\w+\s+(\w+)(?:\[\d+\])?\s*;/gm)].map((m) => m[1] as string);

describe('night lights texture (CPU, from cities.json)', () => {
  it('is deterministic, 2048x1024, bright at big cities, dark at sea, and wraps at the antimeridian', async () => {
    const cities = await worldLoader().loadCities();
    const a = buildCityLights(cities);
    const b = buildCityLights(cities);
    expect(a.length).toBe(LIGHTS_WIDTH * LIGHTS_HEIGHT);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    const cellOf = (c: { cell: number }): [number, number] => [90 - ((Math.floor(c.cell / 1024) + 0.5) / 512) * 180, ((c.cell % 1024) + 0.5) / 1024 * 360 - 180];
    const at = (lat: number, lon: number): number => a[Math.floor(((90 - lat) / 180) * LIGHTS_HEIGHT) * LIGHTS_WIDTH + Math.floor(((lon + 180) / 360) * LIGHTS_WIDTH)] as number;
    const tokyo = cities.find((c) => c.name === 'Tokyo');
    if (!tokyo) throw new Error('no Tokyo');
    expect(at(...cellOf(tokyo))).toBeGreaterThan(150); // the light sits at the centre of the sim cell of the city
    expect(at(0, -30)).toBe(0); // mid Atlantic
    const lit = a.reduce((n, v) => n + (v > 40 ? 1 : 0), 0);
    expect(lit).toBeGreaterThan(500);
    expect(lit).toBeLessThan(LIGHTS_WIDTH * LIGHTS_HEIGHT * 0.05); // dots, not a glow over the world
    // a city at the antimeridian lights both edges of the texture
    const edge = buildCityLights([{ name: 'E', lat: 0, lon: 179.95, population: 5_000_000, cell: 256 * 1024 + 1023, country: 1, capital: false }]);
    const row = Math.floor(LIGHTS_HEIGHT / 2);
    expect(edge[row * LIGHTS_WIDTH + LIGHTS_WIDTH - 1]).toBeGreaterThan(50);
    expect(edge[row * LIGHTS_WIDTH]).toBeGreaterThan(20);
  });
});

describe('country palette LUT', () => {
  it('has 256 entries, black for id 0, distinct colours for ids 1..242, opaque', () => {
    const p = buildPalette();
    expect(p.length).toBe(PALETTE_SIZE * 4);
    expect([p[0], p[1], p[2]]).toEqual([0, 0, 0]);
    const seen = new Set<string>();
    for (let id = 1; id <= 242; id++) {
      expect(p[id * 4 + 3]).toBe(255);
      seen.add(`${p[id * 4]},${p[id * 4 + 1]},${p[id * 4 + 2]}`);
    }
    expect(seen.size).toBeGreaterThan(220);
  });
});

describe('stars', () => {
  it('are seeded: the same field twice, STAR_COUNT unit directions, sizes in range', () => {
    const a = buildStars();
    const b = buildStars();
    expect(a.sizes.length).toBe(STAR_COUNT);
    expect(Buffer.compare(Buffer.from(a.positions.buffer), Buffer.from(b.positions.buffer))).toBe(0);
    for (let i = 0; i < a.sizes.length; i += 97) {
      const l = Math.hypot(a.positions[i * 3] as number, a.positions[i * 3 + 1] as number, a.positions[i * 3 + 2] as number);
      expect(l).toBeCloseTo(1, 5);
    }
    expect(Math.min(...a.sizes)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...a.sizes)).toBeLessThanOrEqual(2.6);
    expect(buildStars(100, 1).positions[0]).not.toBe(buildStars(100, 2).positions[0]);
  });
});

describe('shader modules of item 3 and 4', () => {
  it('write gl_FragColor, declare no out vec4 and no #version, use GLSL 3.00 names', () => {
    for (const [name, src] of Object.entries({ atmV: atmosphereVertexShader, atmF: atmosphereFragmentShader, starsV: starsVertexShader, starsF: starsFragmentShader, ocean: GLSL_OCEAN, borders: GLSL_BORDERS, atmo: GLSL_ATMOSPHERE })) {
      expect(src, name).not.toMatch(/\bout\s+(highp\s+|mediump\s+|lowp\s+)?vec4\b/);
      expect(src, name).not.toMatch(/#version/);
      expect(src, name).not.toMatch(/\btexture2D\b/);
    }
    expect(atmosphereFragmentShader).toMatch(/gl_FragColor\s*=/);
    expect(starsFragmentShader).toMatch(/gl_FragColor\s*=/);
    expect(terrainFragmentShader).toMatch(/gl_FragColor\s*=/);
  });

  it('the terrain fragment shader composes ocean, atmosphere and borders and samples the country id texture, the palette and the lights', () => {
    for (const fn of ['oceanColor', 'atmosphereScatter', 'borderMask', 'countryAt', 'paletteColor']) expect(terrainFragmentShader).toContain(fn);
    expect(terrainFragmentShader).toMatch(/texelFetch\(uCountry/);
    expect(terrainFragmentShader).toMatch(/uLights/);
    // borders: sea (id 0) never counts as a neighbour, so coast against sea is no border
    expect(GLSL_BORDERS).toMatch(/a != 0 && a != centre/);
    expect(GLSL_BORDERS).toMatch(/if \(centre == 0\) return 0\.0/);
    expect(GLSL_BORDERS).toMatch(/dFdx\(dir\)/);
  });

  it('every uniform declared by the atmosphere shell and the stars is supplied, and shared ones are the same objects', async () => {
    const w = worldLoader();
    const [render, sim, meta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
    const tm = createTerrainMaterial(createWorldTextures(render, sim), render, sim, meta, createLookTextures([]));
    for (const [mat, srcs] of [
      [tm.atmosphere, [atmosphereVertexShader, atmosphereFragmentShader]],
      [tm.stars, [starsVertexShader, starsFragmentShader]],
    ] as const) {
      const d = new Set(srcs.flatMap(declared));
      const s = new Set(Object.keys(mat.uniforms));
      expect([...d].filter((u) => !s.has(u))).toEqual([]);
      expect([...s].filter((u) => !d.has(u))).toEqual([]);
    }
    expect(tm.atmosphere.uniforms.uSun).toBe(tm.material.uniforms.uSun);
    expect(tm.atmosphere.uniforms.uAtmoTop).toBe(tm.material.uniforms.uAtmoTop);
  });
});

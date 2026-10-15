// The shading rules of M07b part B (rock against grass by the REAL slope, the snow line by height, latitude and slope, the shore foam, the territory
// tint, the boreal tone). The rules live in the GLSL text of `src/render/shaders/terrain.ts` with their numbers from `src/render/config.ts`; this test
// EVALUATES the scalar statements of that very text (a few lines of GLSL scalar maths: mix, smoothstep, clamp, max, abs and the constants) with plain
// numbers, so a change of a rule or of a number in the shader or the config changes the verdicts below. The Chromium tests (e2e/shading.test.ts) check
// what the rules do to pixels.
import { describe, expect, it } from 'vitest';
import * as C from '../../src/render/config';
import { chunkVertexShader } from '../../src/render/shaders/chunk';
import { GLSL_TERRITORY } from '../../src/render/shaders/territory';
import { buildTerrainFragmentShader } from '../../src/render/shaders/terrain';
import { stripComments } from '../helpers/shaderCost';

const chunkFrag = stripComments(buildTerrainFragmentShader(true));
const fixedFrag = stripComments(buildTerrainFragmentShader(false));

const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The `const vecN NAME = vecN(a, b, c);` lines of the shader as {x, y, z, w} objects and the `const float NAME = a;` lines as numbers. */
function constants(code: string): Record<string, number | { x: number; y: number; z: number; w: number }> {
  const out: Record<string, number | { x: number; y: number; z: number; w: number }> = {};
  for (const m of code.matchAll(/const\s+(float|vec[234])\s+(\w+)\s*=\s*([^;]+);/g)) {
    const [, type, name, rhs] = m as unknown as [string, string, string, string];
    if (type === 'float') out[name] = Number(rhs);
    else {
      const parts = (rhs.match(/vec\d\((.*)\)/)?.[1] ?? '').split(',').map((v) => Number(v.trim()));
      out[name] = { x: parts[0] as number, y: parts[1] as number, z: parts[2] as number, w: parts[3] as number };
    }
  }
  return out;
}

/** Evaluates `float NAME = expression;` statements of the shader, in the order given, with the inputs as numbers (an input may be an object for `.x` / `.y`). */
function evalScalars(code: string, names: string[], inputs: Record<string, unknown>): Record<string, number> {
  const consts = constants(code);
  const env: Record<string, unknown> = { ...consts, ...inputs, mix, smoothstep, clamp, max: Math.max, min: Math.min, abs: Math.abs, sqrt: Math.sqrt };
  const result: Record<string, number> = {};
  for (const name of names) {
    const m = new RegExp(`float\\s+${name}\\s*=\\s*([^;]+);`).exec(code);
    if (!m) throw new Error(`no statement "float ${name} = ..." in the shader`);
    const expr = (m[1] as string).replace(/\s+/g, ' ');
    const keys = Object.keys(env);
    const value = new Function(...keys, `return ${expr};`)(...keys.map((k) => env[k])) as number;
    env[name] = value;
    result[name] = value;
  }
  return result;
}

const LAND_NAMES = ['aLat', 'snowLine', 'treeLine', 'steep', 'alpine', 'iceKeepIn', 'bare', 'hSnow', 'snow'];
/** The snow / rock verdict of the land colour block at a height (m of the detailed height), a latitude and a REAL slope tangent (0.47 = 25 degrees), no mottling. */
function landRules(hD: number, latDeg: number, tanR: number, iceKeep = 1): { snowLine: number; steep: number; alpine: number; bare: number; snow: number } {
  // the shader's own statements; `iceKeep` and `mot2` are inputs (the biome tone and the mottling come from elsewhere)
  const code = chunkFrag.replace(/float iceKeep = [^;]+;/, 'float iceKeepIn = iceKeep;');
  const r = evalScalars(code, LAND_NAMES, { latDeg, hD, tanR, iceKeep, mot2: { x: 0.5, y: 0.5 } });
  return r as { snowLine: number; steep: number; alpine: number; bare: number; snow: number };
}

describe('the snow line (evaluated from the GLSL text)', () => {
  const line = (lat: number): number => landRules(0, lat, 0).snowLine;

  it('depends on latitude: the Himalaya (28 N) is higher than the Alps (46 N), the Alps higher than the Scandes (62 N), and the polar sheets are near sea level', () => {
    console.log(`[snow line] 0: ${line(0).toFixed(0)}, 28 N: ${line(28).toFixed(0)}, 46 N: ${line(46).toFixed(0)}, 62 N: ${line(62).toFixed(0)}, 78 N: ${line(78).toFixed(0)}, 85 N: ${line(85).toFixed(0)}`);
    expect(line(28)).toBeGreaterThan(5200);
    expect(line(28)).toBeLessThan(5600);
    expect(line(46)).toBeGreaterThan(2450);
    expect(line(46)).toBeLessThan(2750);
    expect(line(62)).toBeGreaterThan(1500);
    expect(line(62)).toBeLessThan(1800);
    expect(line(28)).toBeGreaterThan(line(46) + 2000);
    expect(line(46)).toBeGreaterThan(line(62) + 800);
    expect(line(85)).toBeLessThan(400);
    // never rises poleward of the plateau latitudes; the southern hemisphere is the mirror image
    for (let lat = 32; lat < 85; lat += 1) expect(line(lat + 1)).toBeLessThanOrEqual(line(lat) + 1e-9);
    expect(line(-46)).toBeCloseTo(line(46), 6);
    // the Tibetan plateau (4 500 to 5 000 m at 30 to 34 N) stays bare, the 5 700 m of the massif has snow
    expect(line(32)).toBeGreaterThan(5300);
  });

  it('depends on the detailed height: no snow under the line, snow well above it; and a Himalayan height that is snow at 62 N is bare at 28 N', () => {
    expect(landRules(4500, 28, 0.1).snow, '4 500 m at 28 N (the plateau)').toBe(0);
    expect(landRules(6100, 28, 0.1).snow, '6 100 m at 28 N').toBeGreaterThan(0.95);
    expect(landRules(2000, 46, 0.1).snow, '2 000 m in the Alps').toBeLessThan(0.02);
    expect(landRules(3300, 46, 0.1).snow, '3 300 m in the Alps').toBeGreaterThan(0.95);
    expect(landRules(2200, 62, 0.1).snow, '2 200 m in the Scandes').toBeGreaterThan(0.95);
    expect(landRules(2200, 28, 0.1).snow, 'the same height at 28 N').toBe(0);
    let last = -1;
    for (let h = 0; h <= 8000; h += 100) {
      const s = landRules(h, 46, 0.1).snow;
      expect(s).toBeGreaterThanOrEqual(last - 1e-12); // monotone in height
      last = s;
    }
  });

  it('depends on the slope: steep faces shed the snow, so rock stays grey and the ridges stand out (a 60 degree face above the line is bare, a 20 degree slope is white)', () => {
    const above = 4000; // 1 400 m above the Alpine line
    const gentle = landRules(above, 46, Math.tan((20 * Math.PI) / 180)).snow;
    const steep = landRules(above, 46, Math.tan((60 * Math.PI) / 180)).snow;
    console.log(`[snow] Alps 4 000 m: 20 degree slope ${gentle.toFixed(2)}, 60 degree slope ${steep.toFixed(2)}`);
    expect(gentle).toBeGreaterThan(0.95);
    expect(steep).toBeLessThan(0.1);
  });
});

describe('rock against grass (evaluated from the GLSL text)', () => {
  it('steep faces are bare rock by the real slope, flat ground keeps its biome tone, and the tree line takes the vegetation away at the top of the mountains', () => {
    const tan = (deg: number): number => Math.tan((deg * Math.PI) / 180);
    expect(landRules(600, 46, tan(5)).bare, '5 degrees').toBe(0);
    expect(landRules(600, 46, tan(15)).bare, '15 degrees').toBe(0);
    expect(landRules(600, 46, tan(45)).bare, '45 degrees').toBeGreaterThan(0.6);
    expect(landRules(600, 46, tan(60)).bare, '60 degrees').toBeGreaterThanOrEqual(C.SHADE_ROCK_STRENGTH - 1e-9);
    // the tree line: 900 m under the snow line (1 650 m at 46 N); above it the ground is bare even where it is flat
    expect(landRules(1000, 46, 0.05).bare, '1 000 m at 46 N: forest and meadow').toBeLessThan(0.02);
    expect(landRules(2200, 46, 0.05).bare, '2 200 m at 46 N: above the tree line').toBeGreaterThan(0.6);
    // a glacier class stays white: no rock streaks on an ice sheet
    expect(landRules(2500, 80, tan(60), 0).bare, 'ice').toBe(0);
  });
});

describe('the shore foam (evaluated from the GLSL text)', () => {
  const foam = (land: number, landMask: number, bandPx: number, mot = 0.5): number => evalScalars(chunkFrag, ['foam'], { land, landMask, bandPx, mot })['foam'] as number;

  it('is a band on the sea side of the coast: none over land, none in the open sea, full at the coast line, and none where the band is narrower than a pixel (orbit views keep the old coast)', () => {
    expect(foam(1, 1, 50)).toBe(0);
    expect(foam(0, 0, 50)).toBe(0);
    expect(foam(0, 0.2, 50)).toBe(0);
    expect(foam(0, 0.49, 50)).toBeGreaterThan(0.5);
    expect(foam(0, 0.49, 0.8)).toBe(0);
    expect(foam(0, 0.49, 2.5)).toBeGreaterThan(0);
    expect(foam(0, 0.49, 2.5)).toBeLessThan(foam(0, 0.49, 6));
    // ragged: the mottling moves it by a third either way
    expect(foam(0, 0.4, 50, 0)).toBeLessThan(foam(0, 0.4, 50, 1));
    expect(C.FOAM_FROM).toBeLessThan(0.5);
    expect(C.FOAM_STRENGTH).toBeLessThanOrEqual(1);
  });
});

describe('the shader text wires the rules to the right inputs', () => {
  it('the chunk build reads the detailed height of the vertex shader (varying vH = the metres of detVertexHeight), the fixed mesh the raster height', () => {
    expect(chunkFrag).toContain('varying float vH;');
    expect(chunkFrag).toContain('float hD = mix(vH, heightM, smoothstep(0.7, 2.0, cellTexels));'); // the raster height takes over where a cell is wider than a texel (orbit views)
    expect(fixedFrag).toContain('float hD = heightM;');
    expect(fixedFrag).not.toContain('vH');
    const vs = stripComments(chunkVertexShader);
    expect(vs).toContain('varying float vH;');
    expect(vs).toContain('vH = hM;');
  });

  it('the slope is the REAL one: the tangent of the shading normal divided by the exaggeration, and the rock rules use it', () => {
    expect(chunkFrag).toMatch(/float tanR = sqrt\(max\(1\.0 - cosS \* cosS, 0\.0\)\) \/ \(cosS \* uExag\);/);
    expect(chunkFrag).toContain('smoothstep(ROCK_SLOPE.x, ROCK_SLOPE.y, tanR)');
    expect(chunkFrag).toContain('smoothstep(SNOW_SHED_SLOPE.x, SNOW_SHED_SLOPE.y, tanR)');
  });

  it('every number of the rules reaches the shader from the config (a constant that is edited in the config is edited in the shader)', () => {
    const k = constants(chunkFrag);
    const same = (name: string, want: readonly number[] | number): void => {
      const got = k[name];
      const g = typeof got === 'number' ? [got] : [got?.x, got?.y, got?.z, got?.w];
      const w = typeof want === 'number' ? [want] : want;
      expect(g.slice(0, w.length), name).toEqual([...w]);
    };
    same('ROCK_SLOPE', C.SHADE_ROCK_SLOPE);
    same('ROCK_STRENGTH', C.SHADE_ROCK_STRENGTH);
    same('TREE_BELOW_SNOW', C.SHADE_TREE_BELOW_SNOW_M);
    same('TREE_FADE', C.SHADE_TREE_FADE_M);
    same('SNOW_LINE', C.SHADE_SNOW_LINE_M);
    same('SNOW_RAMP_A', C.SHADE_SNOW_RAMPS.slice(0, 3));
    same('SNOW_RAMP_B', C.SHADE_SNOW_RAMPS.slice(3, 6));
    same('SNOW_POLAR_DROP', C.SHADE_SNOW_POLAR_DROP_M);
    same('SNOW_FADE', C.SHADE_SNOW_FADE_M);
    same('SNOW_SHED', C.SHADE_SNOW_SHED_M);
    same('SNOW_SHED_SLOPE', C.SHADE_SNOW_SHED_SLOPE);
    same('ROCK_WARM', C.SHADE_ROCK_WARM);
    same('ROCK_COOL', C.SHADE_ROCK_COOL);
    same('SNOW_COLOR', C.SHADE_SNOW_COLOR);
    same('BOREAL_TINT', C.SHADE_BOREAL_TINT);
    same('BOREAL_RAMP', C.SHADE_BOREAL_RAMP);
    same('MOTTLE_COLOR', C.SHADE_MOTTLE_COLOR);
    same('MOTTLE_FADE', C.SHADE_MOTTLE_FADE_PX);
    same('MOTTLE_SNOW', C.SHADE_MOTTLE_SNOW_M);
    same('FOAM_FROM', C.FOAM_FROM);
    same('FOAM_BAND_M', C.FOAM_BAND_M);
    same('FOAM_STRENGTH', C.FOAM_STRENGTH);
    same('FOAM_COLOR', C.FOAM_COLOR);
    same('SPECKLE_FINE', C.LIGHTS_SPECKLE_FINE);
    const t = constants(stripComments(GLSL_TERRITORY));
    expect(t['OWNER_TINT_LUM']).toEqual({ x: C.OWNER_TINT_LUM[0], y: C.OWNER_TINT_LUM[1], z: C.OWNER_TINT_LUM[2], w: C.OWNER_TINT_LUM[3] });
    expect(t['OWNER_TINT_CLOSE']).toMatchObject({ x: C.OWNER_TINT_CLOSE[0], y: C.OWNER_TINT_CLOSE[1], z: C.OWNER_TINT_CLOSE[2] });
  });

  it('the numbers are in order (ramps rise, ranges are ranges) and the colours are colours', () => {
    expect(C.SHADE_ROCK_SLOPE[0]).toBeLessThan(C.SHADE_ROCK_SLOPE[1]);
    expect(C.SHADE_SNOW_SHED_SLOPE[0]).toBeLessThan(C.SHADE_SNOW_SHED_SLOPE[1]);
    expect(C.SHADE_ROCK_SLOPE[1]).toBeLessThan(C.SHADE_SNOW_SHED_SLOPE[1]); // rock shows before the snow is shed
    const r = C.SHADE_SNOW_RAMPS;
    expect(r[0]).toBeLessThan(r[1]);
    expect(r[1]).toBeLessThanOrEqual(r[2]);
    expect(r[2]).toBeLessThan(r[3]);
    expect(r[3]).toBeLessThan(r[4]);
    expect(r[4]).toBeLessThan(r[5]);
    expect(C.SHADE_SNOW_LINE_M[0]).toBeGreaterThan(C.SHADE_SNOW_LINE_M[1]);
    expect(C.SHADE_SNOW_LINE_M[1]).toBeGreaterThan(C.SHADE_SNOW_LINE_M[2]);
    expect(C.SHADE_MOTTLE_FADE_PX[0]).toBeLessThan(C.SHADE_MOTTLE_FADE_PX[1]);
    expect(C.SHADE_MOTTLE_FADE_PX[0]).toBeGreaterThanOrEqual(3); // never a grain of one or two pixels
    expect(C.OWNER_TINT_LUM[2]).toBeLessThan(C.OWNER_TINT_LUM[3]);
    expect(C.OWNER_TINT_CLOSE[1]).toBeLessThan(C.OWNER_TINT_CLOSE[2]);
    for (const c of [C.SHADE_ROCK_WARM, C.SHADE_ROCK_COOL, C.SHADE_SNOW_COLOR, C.SHADE_BOREAL_TINT, C.FOAM_COLOR]) for (const v of c) expect(v).toBeGreaterThan(0), expect(v).toBeLessThanOrEqual(1);
  });
});

describe('the territory tint keeps the terrain visible', () => {
  it('the owner colour is scaled by the luminance of the terrain colour (bright snow keeps a bright tint, dark forest a dark one), and the tint is weaker in a close view', () => {
    const code = stripComments(GLSL_TERRITORY);
    expect(code).toContain('vec3 tint = col * clamp(OWNER_TINT_LUM.x + OWNER_TINT_LUM.y * lumA, OWNER_TINT_LUM.z, OWNER_TINT_LUM.w);');
    expect(code).toContain('vec3 outAlbedo = mix(albedo, tint, fill);');
    expect(code).toContain('mix(OWNER_TINT_CLOSE.x, 1.0, smoothstep(OWNER_TINT_CLOSE.y, OWNER_TINT_CLOSE.z, pc))');
    const [base, gain, lo, hi] = C.OWNER_TINT_LUM;
    const factor = (lum: number): number => clamp(base + gain * lum, lo, hi);
    expect(factor(0.95)).toBeGreaterThan(factor(0.15) * 1.8); // bright over dark: the relief and the colours survive the tint
    expect(factor(0.15)).toBeGreaterThanOrEqual(lo);
    expect(C.OWNER_TINT_CLOSE[0]).toBeLessThan(1);
    expect(C.OWNER_TINT_CLOSE[0]).toBeGreaterThan(0.5); // still readable
  });
});

describe('the night speckle is smooth (no hard squares)', () => {
  it('the speckle is value noise interpolated between lattice hashes, not a hash of a floored cell (M02)', () => {
    expect(chunkFrag).toContain('float speckNoise(vec2 p)');
    expect(chunkFrag).not.toMatch(/hash12\(floor\(uv \* vec2\(8192\.0, 4096\.0\)\)\)/);
    expect(chunkFrag).toContain('float s1 = speckNoise(uv * vec2(8192.0, 4096.0));');
    expect(chunkFrag).toContain('float s2 = speckNoise(uv * vec2(32768.0, 16384.0) + 17.0);');
    expect(chunkFrag).toContain('if (speckFade > 0.0 && nightF * land * lightTex > 0.001)'); // no work where there is nothing to modulate
  });
});

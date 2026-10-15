// The per-pixel cost of the default tier must not grow with the terrain detail (M07b): the detail is a VERTEX-path cost (per vertex, LOD-limited
// octaves), the fragment shader keeps the call sites and loops of M07a. The numbers are the static proxy of tests/helpers/shaderCost.ts
// (call sites and operators of the source, not GPU time) measured on the M07a chunk fragment shader. Part B (slope / snow / forest shading, foam,
// the smooth night speckle) is the first change that raised them, on purpose and by little: NO texture fetch, NO loop, NO derivative site more, ONE
// square root more (the real slope), about 135 operators more of which 74 sit in the near-view mottling that an orbit view never enters (the first
// test of `fineMottle` is a smoothstep and a branch). The open sea skips the sixteen class fetches of the biome tone altogether (M07a ran them for
// every pixel), so the default tier's executed work in an orbit view is below M07a's. Every later increase has to say so here and in
// docs/ARCHITECTURE.md "Budgetar".
import { describe, expect, it } from 'vitest';
import { chunkVertexShader } from '../../src/render/shaders/chunk';
import { GLSL_DETAIL } from '../../src/render/shaders/detail';
import { buildTerrainFragmentShader } from '../../src/render/shaders/terrain';
import { shaderCost, stripComments } from '../helpers/shaderCost';

/** The chunk fragment shader of M07a (commit 2dc59c0), by the proxy. M07b adds one multiplication and one product to the facet weight (`uDetailLod.z * capKeep`) and nothing else. */
const M07A_FRAGMENT = { fetches: 19, loops: 6, transcendentals: 26, derivatives: 12, operators: 528 };
/** The chunk fragment shader of M07b part B (the shading of the detail). */
const M07B_FRAGMENT = { fetches: 19, loops: 6, transcendentals: 27, derivatives: 12, operators: 663, mottleOperators: 74 };
const OPERATOR_ALLOWANCE = 4;

/** The text of `fineMottle` (the near-view mottling, brace matched). */
function mottleFunction(code: string): string {
  const start = code.indexOf('vec2 fineMottle(');
  let depth = 0;
  for (let k = code.indexOf('{', start); k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}' && --depth === 0) return code.slice(start, k + 1);
  }
  return '';
}

describe('the shader cost proxy (static call sites and operators; not a GPU measurement)', () => {
  it('the chunk FRAGMENT shader has the call sites of M07a (no fetch, no loop, no derivative more) and a bounded number of operators more: the shading of part B is a few multiply-adds', () => {
    const c = shaderCost(buildTerrainFragmentShader(true));
    console.log(`[shader cost] chunk fragment: ${JSON.stringify(c)} (M07a: ${JSON.stringify(M07A_FRAGMENT)})`);
    expect(c.fetches).toBe(M07A_FRAGMENT.fetches);
    expect(c.loops).toBe(M07A_FRAGMENT.loops);
    expect(c.derivatives).toBe(M07A_FRAGMENT.derivatives);
    expect(c.transcendentals).toBe(M07B_FRAGMENT.transcendentals); // the one square root of the real slope
    expect(c.operators).toBeGreaterThanOrEqual(M07B_FRAGMENT.operators - OPERATOR_ALLOWANCE);
    expect(c.operators).toBeLessThanOrEqual(M07B_FRAGMENT.operators + OPERATOR_ALLOWANCE);
  });

  it('the near-view mottling is gated by the pixel size (a smoothstep and a branch before every octave) and holds no texture fetch and no derivative: an orbit view takes the first test and pays nothing', () => {
    const code = stripComments(buildTerrainFragmentShader(true));
    const fn = mottleFunction(code);
    expect(fn.length).toBeGreaterThan(200);
    const c = shaderCost(fn);
    console.log(`[shader cost] fineMottle: ${JSON.stringify(c)}`);
    expect(c.fetches).toBe(0);
    expect(c.derivatives).toBe(0);
    expect(c.loops).toBe(0);
    expect(c.operators).toBe(M07B_FRAGMENT.mottleOperators);
    // every octave sits behind its own `if (fade > 0.0)`: five of them, nested, the first one the only test an orbit view runs
    expect(fn.match(/if \(f\d > 0\.0\)/g)?.length).toBe(5);
    // the executed work in an orbit view: everything but the mottling
    const always = shaderCost(code.replace(fn, '')).operators;
    console.log(`[shader cost] operators outside the mottling: ${always} (M07a ${M07A_FRAGMENT.operators})`);
    expect(always).toBeLessThanOrEqual(M07A_FRAGMENT.operators + 70);
  });

  it('the open sea skips the biome tone (its sixteen class fetches) and the territory skips open sea: the land colour is only worked out where the land mask says land', () => {
    const code = stripComments(buildTerrainFragmentShader(true));
    expect(code).toContain('if (landMask > 0.001) albedoLand = biomeAlbedo(uv);');
    expect(code).toContain('if (landMask > 0.001) mot2 = fineMottle(');
  });

  it('the fragment shader never includes the detail module (no hash, no octave loop per pixel)', () => {
    const frag = stripComments(buildTerrainFragmentShader(true));
    for (const name of ['detHash', 'detNoise', 'detSum', 'detSample', 'detHeight', 'detVertexHeight']) expect(frag, name).not.toContain(name);
    // the facet weight's max() with the detail switch
    expect(frag).toContain('uniform vec3 uDetailLod;');
    expect(frag).toContain('max(cellTexels * length(dir.xz) * 0.25, uDetailLod.z * capKeep)');
  });

  it('every loop of the vertex path has constant bounds (the octave loop breaks early on the weight, never runs past 12), and the detail module has no unbounded recursion or dynamic loop', () => {
    const code = stripComments(chunkVertexShader);
    for (const m of code.matchAll(/for\s*\(\s*int\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*([^;]+);/g)) {
      const bound = (m[1] as string).trim();
      expect(bound, `loop bound ${bound}`).toMatch(/^(\d+|float\(DET_OCTAVES_MAX\)|DET_OCTAVES_MAX)$/);
    }
    expect(stripComments(GLSL_DETAIL)).toContain('if (w <= 0.0) break;');
    const c = shaderCost(chunkVertexShader);
    console.log(`[shader cost] chunk vertex (static, M07a: 1 fetch site, 0 loops, 87 operators): ${JSON.stringify(c)}`);
    expect(c.loops).toBeLessThanOrEqual(8);
  });

  it('the dynamic work of one vertex is bounded: at most 1 + 4 + 12 texel fetches and 12 + 3 octaves of 8 corner hashes (with the first pass), none in the open sea', () => {
    // the fetch budget per land vertex, counted from the module: the hardware tap (1), the four bilinear texels (4 detCode), the relief ring (12 more of the 4 x 4 block)
    const code = stripComments(GLSL_DETAIL);
    expect(code.match(/detCode\(/g)?.length).toBeGreaterThanOrEqual(2); // the four corner calls and the ring call (one in a loop)
    expect(code).toContain('if (!needRelief) return s;'); // no relief ring without octaves
    expect(code).toContain('if (cov < 0.5) return s;'); // the sea stops after the four bilinear taps
    expect(chunkVertexShader).toContain('if (code > 0.0) hM = detVertexHeight(');
  });
});

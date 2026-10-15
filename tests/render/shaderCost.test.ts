// The per-pixel cost of the default tier must not grow with the terrain detail (M07b): the detail is a VERTEX-path cost (per vertex, LOD-limited
// octaves), the fragment shader keeps the call sites and loops of M07a. The numbers are the static proxy of tests/helpers/shaderCost.ts
// (call sites and operators of the source, not GPU time) measured on the M07a chunk fragment shader. A later change that raises them (Part B's
// slope / snow / forest shading) has to say so here and in docs/ARCHITECTURE.md "Budgetar".
import { describe, expect, it } from 'vitest';
import { chunkVertexShader } from '../../src/render/shaders/chunk';
import { GLSL_DETAIL } from '../../src/render/shaders/detail';
import { buildTerrainFragmentShader } from '../../src/render/shaders/terrain';
import { shaderCost, stripComments } from '../helpers/shaderCost';

/** The chunk fragment shader of M07a (commit 2dc59c0), by the proxy. M07b adds one multiplication and one product to the facet weight (`uDetailLod.z * capKeep`) and nothing else. */
const M07A_FRAGMENT = { fetches: 19, loops: 6, transcendentals: 26, derivatives: 12, operators: 528 };
const OPERATOR_ALLOWANCE = 2;

describe('the shader cost proxy (static call sites and operators; not a GPU measurement)', () => {
  it('the chunk FRAGMENT shader has the call sites, loops and operators of M07a: the detail added no per-pixel work', () => {
    const c = shaderCost(buildTerrainFragmentShader(true));
    console.log(`[shader cost] chunk fragment: ${JSON.stringify(c)} (M07a: ${JSON.stringify(M07A_FRAGMENT)})`);
    expect(c.fetches).toBe(M07A_FRAGMENT.fetches);
    expect(c.loops).toBe(M07A_FRAGMENT.loops);
    expect(c.transcendentals).toBe(M07A_FRAGMENT.transcendentals);
    expect(c.derivatives).toBe(M07A_FRAGMENT.derivatives);
    expect(c.operators).toBeGreaterThanOrEqual(M07A_FRAGMENT.operators);
    expect(c.operators).toBeLessThanOrEqual(M07A_FRAGMENT.operators + OPERATOR_ALLOWANCE);
  });

  it('the fragment shader never includes the detail module (no hash, no octave loop per pixel)', () => {
    const frag = stripComments(buildTerrainFragmentShader(true));
    for (const name of ['detHash', 'detNoise', 'detSum', 'detSample', 'detHeight', 'detVertexHeight']) expect(frag, name).not.toContain(name);
    // the only addition is the facet weight's max() with the detail switch
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

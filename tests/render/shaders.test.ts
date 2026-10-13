import { describe, expect, it } from 'vitest';
import type { RenderPack, SimGrid, WorldMeta } from '../../src/data';
import { POLE_HEIGHT_U } from '../../src/render/geo';
import { terrainFragmentShader, terrainVertexShader } from '../../src/render/shaders/terrain';
import { createTerrainMaterial } from '../../src/render/terrainMaterial';
import { createWorldTextures } from '../../src/render/textures';
import { worldLoader } from '../helpers/dataFiles';

function declaredUniforms(glsl: string): string[] {
  return [...glsl.matchAll(/^\s*uniform\s+\w+\s+(\w+)(?:\[\d+\])?\s*;/gm)].map((m) => m[1] as string);
}

describe('shader modules (GLSL ES 3.00 through ShaderMaterial)', () => {
  const sources = { vertex: terrainVertexShader, fragment: terrainFragmentShader };

  it('write gl_FragColor and never declare their own out vec4 or a #version line', () => {
    expect(terrainFragmentShader).toMatch(/gl_FragColor\s*=/);
    for (const [name, src] of Object.entries(sources)) {
      expect(src, name).not.toMatch(/\bout\s+(highp\s+|mediump\s+|lowp\s+)?vec4\b/);
      expect(src, name).not.toMatch(/#version/);
      expect(src, name).not.toMatch(/\btexture2D\b/); // GLSL 3.00 names only
    }
  });

  it('use texelFetch / textureLod / derivatives of the 3.00 profile', () => {
    expect(terrainFragmentShader).toMatch(/texelFetch/);
    expect(terrainFragmentShader).toMatch(/dFdx/);
    expect(terrainFragmentShader).toMatch(/dFdy/);
    expect(terrainVertexShader).toMatch(/textureLod/);
  });

  it('the vertex shader reads the pole rows (uv.y 0 or 1) at the common longitude of heightLookupUv', () => {
    expect(POLE_HEIGHT_U).toBe(0.5);
    expect(terrainVertexShader).toContain('(uv.y <= 0.0 || uv.y >= 1.0) ? vec2(0.5, uv.y) : uv');
    expect(terrainVertexShader).toMatch(/textureLod\(uHeight, hUv, 0\.0\)/);
  });

  it('every declared uniform is supplied by the material and every supplied uniform is declared', async () => {
    const w = worldLoader();
    const [render, sim, meta]: [RenderPack, SimGrid, WorldMeta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
    const textures = createWorldTextures(render, sim);
    const { material } = createTerrainMaterial(textures, render, sim, meta);
    const declared = new Set([...declaredUniforms(terrainVertexShader), ...declaredUniforms(terrainFragmentShader)]);
    const supplied = new Set(Object.keys(material.uniforms));
    expect([...declared].filter((u) => !supplied.has(u))).toEqual([]);
    expect([...supplied].filter((u) => !declared.has(u))).toEqual([]);
  });

  it('the sqrt decode maxima in the uniforms come from meta.json', async () => {
    const w = worldLoader();
    const [render, sim, meta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
    const { material } = createTerrainMaterial(createWorldTextures(render, sim), render, sim, meta);
    expect(material.uniforms.uHeightMaxM?.value).toBe(meta.encoding.heightSqrt.maxM);
    expect(material.uniforms.uDepthMaxM?.value).toBe(meta.encoding.depthSqrt.maxM);
  });
});

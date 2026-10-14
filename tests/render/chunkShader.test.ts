import { describe, expect, it } from 'vitest';
import type { RenderPack, SimGrid, WorldMeta } from '../../src/data';
import { chunkVertexShader } from '../../src/render/shaders/chunk';
import { buildTerrainFragmentShader, terrainFragmentShader, terrainVertexShader } from '../../src/render/shaders/terrain';
import { ChunkTerrain } from '../../src/render/chunkTerrain';
import { QUALITY } from '../../src/render/quality';
import { createTerrainMaterial } from '../../src/render/terrainMaterial';
import { createWorldTextures } from '../../src/render/textures';
import { worldLoader } from '../helpers/dataFiles';

const declaredUniforms = (glsl: string): string[] => [...glsl.matchAll(/^\s*uniform\s+\w+\s+(\w+)(?:\[\d+\])?\s*;/gm)].map((m) => m[1] as string);
const declaredAttributes = (glsl: string): string[] => [...glsl.matchAll(/^\s*attribute\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1] as string);

describe('the chunk vertex shader (GLSL ES 3.00 through ShaderMaterial)', () => {
  it('writes no version line and no own outputs, reads the height texture with textureLod, and uses the view matrix for its ROTATION only', () => {
    expect(chunkVertexShader).not.toMatch(/#version/);
    expect(chunkVertexShader).not.toMatch(/\bout\s+(highp\s+|mediump\s+|lowp\s+)?vec4\b/);
    expect(chunkVertexShader).toMatch(/textureLod\(uHeight, hUv, 0\.0\)/);
    expect(chunkVertexShader).toContain('mat3(viewMatrix) * rel');
    // no absolute world position: neither the model matrix nor the full view matrix touches a vertex
    expect(chunkVertexShader).not.toMatch(/modelMatrix|modelViewMatrix|viewMatrix\s*\*\s*vec4/);
    expect(chunkVertexShader).not.toMatch(/cameraPosition/);
  });

  it('forms the vertex as originRel + offset * r + up * h, originRel from the high and low parts of chunk and camera, and the offset in half-angle form (no subtraction of absolute coordinates)', () => {
    expect(chunkVertexShader).toContain('vec3 originRel = (aUp.xyz - uCamHi) + (aOrigin.xyz - uCamLo);');
    expect(chunkVertexShader).toContain('vec3 rel = originRel + off * r + up * h;');
    expect(chunkVertexShader).toContain('float on = sdphi + 2.0 * cphi * sinC * sdl * sdl;');
    expect(chunkVertexShader).toContain('float ou = 2.0 * (sdp * sdp + cphi * cosC * sdl * sdl);');
    expect(chunkVertexShader).toContain('vec3 off = east * oe + north * on - up * ou;');
  });

  it('the pole rows read the height at the common longitude of the fixed mesh (POLE_HEIGHT_U), so the pole has one radius', () => {
    expect(chunkVertexShader).toMatch(/vec2\(0\.5, clamp\(v, 0\.0, 1\.0\)\)/);
    expect(terrainVertexShader).toContain('vec2(0.5, uv.y)');
  });

  it('declares the instance attributes ChunkTerrain fills, and nothing else', async () => {
    const w = worldLoader();
    const [render, sim, meta]: [RenderPack, SimGrid, WorldMeta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
    const tm = createTerrainMaterial(createWorldTextures(render, sim), render, sim, meta, undefined, undefined, 'chunks', QUALITY.test.chunkCells);
    const terrain = new ChunkTerrain({ material: tm.material, quality: QUALITY.test, codes: render.height8, width: render.width, height: render.height, maxM: meta.encoding.heightSqrt.maxM, exaggeration: 12 });
    const geo = terrain.mesh.geometry;
    const declared = declaredAttributes(chunkVertexShader).sort();
    expect(declared).toEqual(['aCell', 'aEast', 'aGeo', 'aNeigh', 'aOrigin', 'aUp']); // M07a part B added aCell (the territory position)
    for (const name of declared) expect(geo.getAttribute(name), name).toBeDefined();
    expect(Object.keys(geo.attributes).sort()).toEqual([...declared, 'position'].sort());
    terrain.dispose();
  });
});

describe('the terrain materials share the fragment shader module', () => {
  it('the fixed fragment shader is the chunk-free build of the shared builder; the chunk build adds only the debug colouring and the cell size', () => {
    expect(buildTerrainFragmentShader(false)).toBe(terrainFragmentShader);
    const chunk = buildTerrainFragmentShader(true);
    expect(chunk).toContain('uniform float uChunkDebug;');
    expect(chunk).toContain('uniform float uChunkCells;');
    expect(terrainFragmentShader).not.toContain('uChunkDebug');
    // everything else (ocean, atmosphere, borders, territory, night lights, selection outline) is the very same text
    for (const needle of ['atmosphereScatter', 'oceanColor', 'borderMask', 'applyTerritory', 'selectionMask', 'uLights']) {
      expect(chunk, needle).toContain(needle);
      expect(terrainFragmentShader, needle).toContain(needle);
    }
    expect(chunk).toContain('vec3 flatN = normalize(cross(dFdx(vRel), dFdy(vRel)));');
    expect(terrainFragmentShader).toContain('vec3 flatN = normalize(cross(dFdx(vRel), dFdy(vRel)));');
    expect(terrainFragmentShader).not.toMatch(/\bvPos\b/);
    expect(chunk).not.toMatch(/\bvPos\b/);
  });

  it('every uniform the chunk material declares is supplied and every supplied uniform is declared (vertex and fragment)', async () => {
    const w = worldLoader();
    const [render, sim, meta]: [RenderPack, SimGrid, WorldMeta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
    const { material } = createTerrainMaterial(createWorldTextures(render, sim), render, sim, meta, undefined, undefined, 'chunks', 32);
    const declared = new Set([...declaredUniforms(chunkVertexShader), ...declaredUniforms(buildTerrainFragmentShader(true))]);
    const supplied = new Set(Object.keys(material.uniforms));
    expect([...declared].filter((u) => !supplied.has(u))).toEqual([]);
    expect([...supplied].filter((u) => !declared.has(u))).toEqual([]);
    expect(material.uniforms.uChunkCells?.value).toBe(32);
    expect(material.uniforms.uSkirtsOn?.value).toBe(1);
    expect(material.uniforms.uChunkDebug?.value).toBe(0);
  });

  it('the chunk and the fixed material use the same textures and the same territory / selection / palette uniform objects (one source of truth per Globe)', async () => {
    const w = worldLoader();
    const [render, sim, meta]: [RenderPack, SimGrid, WorldMeta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
    const textures = createWorldTextures(render, sim);
    const fixed = createTerrainMaterial(textures, render, sim, meta, undefined, undefined, 'fixed');
    const chunks = createTerrainMaterial(textures, render, sim, meta, undefined, undefined, 'chunks');
    for (const key of Object.keys(fixed.material.uniforms)) expect(chunks.material.uniforms, key).toHaveProperty(key);
    for (const key of ['uHeight', 'uBathy', 'uClass', 'uCountry']) expect(chunks.material.uniforms[key]?.value, key).toBe(fixed.material.uniforms[key]?.value);
  });
});

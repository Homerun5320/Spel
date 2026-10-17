// The skirt walls and the shading of the chunk shaders: what no pixel of the headless views can see. Measured with the e2e mutants of the
// audit: the number of pixels the walls change (141, 154, 117, ... in the contact-sheet views) is identical with the wall depth scale
// lost (exp2(d) replaced by 1 or by d), with the west edge reading the east neighbour, and with the wall's own position in the fragment
// shader's `vRel`, because the cracks the walls close are sub-pixel in every view that is rendered. So the semantics are checked on the
// shader text: the scale function is EVALUATED (not searched for), and the edge -> neighbour -> lean table is parsed and compared with the
// order the CPU writes the neighbour levels in (west, east, north, south).
import { describe, expect, it } from 'vitest';
import type { RenderPack, SimGrid, WorldMeta } from '../../src/data';
import { CHUNK_SKIRT_CELLS, CHUNK_SKIRT_OUT_CELLS, CHUNK_SKIRT_SAME_SHARE } from '../../src/render/config';
import { chunkVertexShader } from '../../src/render/shaders/chunk';
import { buildTerrainFragmentShader } from '../../src/render/shaders/terrain';
import { QUALITY } from '../../src/render/quality';
import { createTerrainMaterial } from '../../src/render/terrainMaterial';
import { createWorldTextures } from '../../src/render/textures';
import { worldLoader } from '../helpers/dataFiles';

/** The GLSL function `wallScale(float v)` as a JavaScript function (its single return expression, exp2 -> 2^x, uSkirtSame -> the config share). */
function evalWallScale(): (v: number) => number {
  const m = /float wallScale\(float v\) \{\s*return ([^;]+);\s*\}/.exec(chunkVertexShader);
  expect(m, 'wallScale(float v) with one return expression').not.toBeNull();
  const expr = (m as RegExpExecArray)[1]!.replace(/exp2\(/g, 'Math.pow(2.0, ').replace(/\buSkirtSame\b/g, String(CHUNK_SKIRT_SAME_SHARE));
  return new Function('v', `return ${expr};`) as (v: number) => number;
}

describe('the skirt wall of the chunk vertex shader', () => {
  it('its scale doubles per level the neighbour is coarser (the crack to cover is as big as the coarse cell), is full where the neighbour is finer, and a share on the same level', () => {
    const wallScale = evalWallScale();
    for (let d = 1; d <= 6; d++) expect(wallScale(d), `${d} levels coarser`).toBe(2 ** d);
    expect(wallScale(-1)).toBe(1); // finer neighbour (marked -1 in aNeigh)
    expect(wallScale(0)).toBe(CHUNK_SKIRT_SAME_SHARE); // same level
  });

  it('each rim edge reads the neighbour level of its side, in the order the CPU writes them (west, east, north, south = x, y, z, w), and leans away from the chunk', () => {
    const edges = [...chunkVertexShader.matchAll(/if \(g\.([xy]) ([<>]) ([0-9.]+)\) \{ m = max\(m, wallScale\(aNeigh\.([xyzw])\)\); s([xy]) ([-+])= 1\.0; \}/g)].map((e) => `g.${e[1]}${e[2]}${e[3]} -> aNeigh.${e[4]}, s${e[5]}${e[6]}`);
    expect(edges).toEqual([
      'g.x<0.001 -> aNeigh.x, sx-', // west edge: leans west
      'g.x>0.999 -> aNeigh.y, sx+', // east
      'g.y<0.001 -> aNeigh.z, sy+', // north (g.y = 0 is the north row: dphi = (0.5 - g.y) * extent)
      'g.y>0.999 -> aNeigh.w, sy-', // south
    ]);
  });

  it('the depth is the cell size times the scale times the depth in cells, hanging DOWN; the lean is outward, both switched by uSkirtsOn; the rim position is taken BEFORE the wall moves', () => {
    expect(chunkVertexShader).toContain('float k = aUp.w * m * uSkirtsOn;');
    expect(chunkVertexShader).toContain('rel += (east * sx + north * sy) * (k * uSkirt.y) - dir * (k * uSkirt.x);');
    const rim = chunkVertexShader.indexOf('vec3 rim = rel;');
    const wall = chunkVertexShader.indexOf('if (wallFlag > 0.5 && wallFlag < 1.5) {');
    expect(rim).toBeGreaterThan(0);
    expect(wall).toBeGreaterThan(rim);
    expect(chunkVertexShader).toContain('vRel = rim;'); // the fragment shader shades the wall like the ground it hides, not at the wall's own position
    expect(chunkVertexShader).not.toMatch(/vRel = rel;/);
  });

  it('the material carries the config values for the depth, the lean and the same-level share', async () => {
    const w = worldLoader();
    const [render, sim, meta]: [RenderPack, SimGrid, WorldMeta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
    const { material } = createTerrainMaterial(createWorldTextures(render, sim), render, sim, meta, undefined, undefined, 'chunks', QUALITY.test.chunkCells);
    const skirt = material.uniforms.uSkirt!.value as { x: number; y: number };
    expect([skirt.x, skirt.y]).toEqual([CHUNK_SKIRT_CELLS, CHUNK_SKIRT_OUT_CELLS]);
    expect(material.uniforms.uSkirtSame!.value).toBe(CHUNK_SKIRT_SAME_SHARE);
    expect(material.uniforms.uSkirtsOn!.value).toBe(1);
  });
});

describe('the chunk fragment shader', () => {
  it('shades a wall like level ground (the facet normal is the up direction on a wall) on the chunk terrain only', () => {
    expect(buildTerrainFragmentShader(true)).toContain('if (vWall > 0.5) flatN = dir;');
    expect(buildTerrainFragmentShader(false)).not.toContain('vWall');
  });

  it('the territory pixel size in cells has east on x and MINUS north on y (the ownership grid\'s row index grows to the south), for both screen axes', () => {
    const frag = buildTerrainFragmentShader(true);
    expect(frag).toContain('vec2 cpx = vec2(dot(tpx, east) * invCos, -dot(tpx, north))');
    expect(frag).toContain('vec2 cpy = vec2(dot(tpy, east) * invCos, -dot(tpy, north))');
  });

  it('looks along the line of sight from the point to the eye: viewDir = normalize(-vRel)', () => {
    expect(buildTerrainFragmentShader(true)).toContain('vec3 viewDir = normalize(-vRel);');
  });
});

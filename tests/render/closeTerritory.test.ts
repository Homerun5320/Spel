// M07a part B: the territory on the chunk terrain close up. The shader modules are shared with the fixed mesh; what is new is that the
// chunk shader hands the fragment shader the territory's cell position in two parts (a whole cell and a small offset: a float32 cell
// coordinate is good to 2.4 m, which would tear a border line seen from 1 km into a staircase), and that pixel sizes come from the
// camera-relative position.
import { describe, expect, it } from 'vitest';
import { chunkGeo, makeChunkGeo } from '../../src/render/chunkMath';
import { EARTH_RADIUS_KM, OWNER_GRID_H, OWNER_GRID_W } from '../../src/render/config';
import { chunkVertexShader } from '../../src/render/shaders/chunk';
import { GLSL_BORDERS } from '../../src/render/shaders/borders';
import { GLSL_TERRITORY } from '../../src/render/shaders/territory';
import { buildTerrainFragmentShader, terrainFragmentShader } from '../../src/render/shaders/terrain';
import { rng } from '../helpers/chunkWorld';

describe('the territory shader on the chunk terrain', () => {
  it('the chunk fragment shader takes the cell position in two parts and the pixel size from the camera-relative position; the fixed one keeps the M05 way', () => {
    const chunk = buildTerrainFragmentShader(true);
    expect(chunk).toContain('flat varying vec2 vCellBase;');
    expect(chunk).toContain('varying vec2 vCellOff;');
    expect(chunk).toContain('applyTerritoryAt(albedoLand, ivec2(floor(vCellBase + 0.5)), vCellOff, cpx, cpy, landMask)');
    expect(chunk).toContain('vec3 tpx = dFdx(vRel);');
    // the country border line and the selection outline difference the camera-relative position, not the float32 direction
    expect(chunk).not.toMatch(/dFdx\(dir\)/);
    expect(chunk).toMatch(/dFdx\(vRel\) \* 0\.7/);
    expect(terrainFragmentShader).toContain('albedoLand = applyTerritory(albedoLand, uv, landMask);');
    expect(terrainFragmentShader).not.toContain('vCellBase');
    expect(terrainFragmentShader).toMatch(/dFdx\(dir\) \* 0\.7/);
    expect(GLSL_BORDERS).toMatch(/dFdx\(dir\)/); // the module itself is unchanged
  });

  it('the chunk vertex shader writes the two parts from the instance attribute aCell', () => {
    expect(chunkVertexShader).toMatch(/attribute vec4 aCell;/);
    expect(chunkVertexShader).toContain('flat varying vec2 vCellBase;');
    expect(chunkVertexShader).toContain('vCellBase = aCell.xy;');
    expect(chunkVertexShader).toContain(`${OWNER_GRID_W}.0 / TWO_PI`);
    expect(chunkVertexShader).toContain(`${OWNER_GRID_H}.0 / PI_`);
  });

  it('the fine warp octaves are switched on by the pixel size alone: nothing for an orbit view', () => {
    const code = GLSL_TERRITORY.replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/float f = smoothstep\(uOwnerFine\.z, uOwnerFine\.w, lam \/ pc\);\s*if \(f <= 0\.0\) break;/);
    expect(code).toMatch(/for \(int k = 0; k < 6; k\+\+\)/);
    expect(code).not.toMatch(/\b(sin|cos|tan)\s*\(/); // still an integer hash
  });
});

const f = Math.fround;

/** The cell position the vertex shader forms for a grid point of a chunk, every operation in float32 (a mirror of shaders/chunk.ts). */
function cellPositionFloat32(level: number, ix: number, iy: number, gx: number, gy: number): [number, number] {
  const g = chunkGeo(level, ix, iy, makeChunkGeo());
  const cellX = (g.lonC / (2 * Math.PI) + 0.5) * OWNER_GRID_W;
  const cellY = (0.5 - g.latC / Math.PI) * OWNER_GRID_H;
  const baseX = Math.floor(cellX);
  const baseY = Math.floor(cellY);
  const fx = f(cellX - baseX);
  const fy = f(cellY - baseY);
  const dlon = f(f(gx - 0.5) * f(g.dLon));
  const dphi = f(f(0.5 - gy) * f(g.dLat));
  const offX = f(fx + f(f(dlon * OWNER_GRID_W) / f(2 * Math.PI)));
  const offY = f(fy + f(f(-dphi * OWNER_GRID_H) / f(Math.PI)));
  return [baseX + offX, baseY + offY]; // (the base is an exact integer: in the shader it stays an ivec2 and the sum is never formed in float32)
}

describe('the territory position of a vertex', () => {
  it('is exact to 5 mm on the ground for chunks of level 9 to 17 (a plain float32 cell coordinate is 2.4 m off)', () => {
    const r = rng(77);
    let worst = 0;
    let worstPlain = 0;
    const metresPerCell = (2 * Math.PI * EARTH_RADIUS_KM * 1000) / OWNER_GRID_W;
    for (let i = 0; i < 400; i++) {
      const level = 9 + Math.floor(9 * r());
      const cols = 4 * 2 ** level;
      const rows = 2 * 2 ** level;
      const ix = Math.floor(cols * r());
      const iy = Math.floor(rows * r());
      const gx = r();
      const gy = r();
      const g = chunkGeo(level, ix, iy, makeChunkGeo());
      const exactX = ((g.lonC + (gx - 0.5) * g.dLon) / (2 * Math.PI) + 0.5) * OWNER_GRID_W;
      const exactY = (0.5 - (g.latC + (0.5 - gy) * g.dLat) / Math.PI) * OWNER_GRID_H;
      const [px, py] = cellPositionFloat32(level, ix, iy, gx, gy);
      const err = Math.max(Math.abs(px - exactX), Math.abs(py - exactY)) * metresPerCell;
      worst = Math.max(worst, err);
      worstPlain = Math.max(worstPlain, Math.max(Math.abs(f(exactX) - exactX), Math.abs(f(exactY) - exactY)) * metresPerCell);
      expect(err, `level ${level} (${ix}, ${iy}) at (${gx.toFixed(3)}, ${gy.toFixed(3)})`).toBeLessThan(0.005);
    }
    console.log(`[territory] cell position of a vertex: two parts worst ${(worst * 1000).toFixed(2)} mm; one float32 cell coordinate worst ${worstPlain.toFixed(2)} m`);
    expect(worstPlain).toBeGreaterThan(0.5); // the control: the single float32 is metres off
  });
});

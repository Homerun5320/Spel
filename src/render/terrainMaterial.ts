// The terrain ShaderMaterial and its uniforms (kept apart from Globe so that a unit test can compare the uniforms the
// GLSL declares with the ones the JS supplies, without a GL context).
import { FrontSide, ShaderMaterial, Vector2, Vector3 } from 'three';
import { DEPTH_MAX_M, LAND_MAX_M, type RenderPack, type SimGrid, type WorldMeta } from '../data';
import { AMBIENT_DAY, AMBIENT_NIGHT, CLASS_ALBEDO, EARTH_RADIUS_KM, FACET_WEIGHT, HEIGHT_EXAGGERATION, SUN_COLOR } from './config';
import { terrainFragmentShader, terrainVertexShader } from './shaders/terrain';
import type { WorldTextures } from './textures';

export interface TerrainMaterial {
  material: ShaderMaterial;
  /** Unit vector toward the sun; the owner updates it every frame. */
  sun: Vector3;
}

export function createTerrainMaterial(textures: WorldTextures, render: RenderPack, sim: SimGrid, meta: WorldMeta): TerrainMaterial {
  const sun = new Vector3(0, 0, 1);
  const material = new ShaderMaterial({
    vertexShader: terrainVertexShader,
    fragmentShader: terrainFragmentShader,
    side: FrontSide,
    uniforms: {
      uHeight: { value: textures.height },
      uBathy: { value: textures.bathy },
      uClass: { value: textures.terrainClass },
      uHeightSize: { value: new Vector2(render.width, render.height) },
      uBathySize: { value: new Vector2(render.bathyWidth, render.bathyHeight) },
      uClassSize: { value: new Vector2(sim.width, sim.height) },
      // The sqrt decode maxima come from meta.json (the packs are self-describing).
      uHeightMaxM: { value: meta.encoding?.heightSqrt?.maxM ?? LAND_MAX_M },
      uDepthMaxM: { value: meta.encoding?.depthSqrt?.maxM ?? DEPTH_MAX_M },
      uExag: { value: HEIGHT_EXAGGERATION },
      uKmPerUnit: { value: EARTH_RADIUS_KM },
      uSun: { value: sun },
      uSunColor: { value: new Vector3(...SUN_COLOR) },
      uAmbientNight: { value: new Vector3(...AMBIENT_NIGHT) },
      uAmbientDay: { value: new Vector3(...AMBIENT_DAY) },
      uFacet: { value: FACET_WEIGHT },
      uClassAlbedo: { value: CLASS_ALBEDO.map((c) => new Vector3(c[0], c[1], c[2])) },
    },
  });
  return { material, sun };
}

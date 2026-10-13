// The ShaderMaterials of the globe scene and their uniforms (kept apart from Globe so that a unit test can compare the
// uniforms the GLSL declares with the ones the JS supplies, without a GL context): the terrain/ocean material, the
// back-face additive atmosphere shell and the star points.
import { AdditiveBlending, BackSide, FrontSide, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import { DEPTH_MAX_M, LAND_MAX_M, type RenderPack, type SimGrid, type WorldMeta } from '../data';
import * as C from './config';
import { atmosphereFragmentShader, atmosphereVertexShader } from './shaders/atmosphere';
import { starsFragmentShader, starsVertexShader } from './shaders/stars';
import { terrainFragmentShader, terrainVertexShader } from './shaders/terrain';
import { createLookTextures, type LookTextures, type WorldTextures } from './textures';

export interface TerrainMaterial {
  material: ShaderMaterial;
  /** Unit vector toward the sun; the owner updates it every frame. */
  sun: Vector3;
  /** Back-face additive atmosphere shell material (shares the sun and the atmosphere uniforms with the terrain). */
  atmosphere: ShaderMaterial;
  /** Star points material. */
  stars: ShaderMaterial;
}

const v3 = (c: readonly [number, number, number]): Vector3 => new Vector3(c[0], c[1], c[2]);

export function createTerrainMaterial(
  textures: WorldTextures,
  render: RenderPack,
  sim: SimGrid,
  meta: WorldMeta,
  look: LookTextures = createLookTextures([]),
): TerrainMaterial {
  const sun = new Vector3(0, 0, 1);
  // Uniforms used by more than one material are the SAME objects, so one assignment updates all of them.
  const shared = {
    uSun: { value: sun },
    uAtmoTop: { value: C.ATMOSPHERE_TOP },
    uAtmoScaleH: { value: C.ATMOSPHERE_SCALE_HEIGHT },
    uAtmoStrength: { value: C.ATMOSPHERE_STRENGTH },
    uAtmoExtinction: { value: C.ATMOSPHERE_EXTINCTION },
    uAtmoColor: { value: v3(C.ATMOSPHERE_COLOR) },
    uAtmoDusk: { value: v3(C.ATMOSPHERE_DUSK) },
  };
  const material = new ShaderMaterial({
    vertexShader: terrainVertexShader,
    fragmentShader: terrainFragmentShader,
    side: FrontSide,
    uniforms: {
      uHeight: { value: textures.height },
      uBathy: { value: textures.bathy },
      uClass: { value: textures.terrainClass },
      uCountry: { value: textures.country },
      uPalette: { value: look.palette },
      uLights: { value: look.lights },
      uHeightSize: { value: new Vector2(render.width, render.height) },
      uBathySize: { value: new Vector2(render.bathyWidth, render.bathyHeight) },
      uClassSize: { value: new Vector2(sim.width, sim.height) },
      uCountrySize: { value: new Vector2(render.width, render.height) },
      // The sqrt decode maxima come from meta.json (the packs are self-describing).
      uHeightMaxM: { value: meta.encoding?.heightSqrt?.maxM ?? LAND_MAX_M },
      uDepthMaxM: { value: meta.encoding?.depthSqrt?.maxM ?? DEPTH_MAX_M },
      uExag: { value: C.HEIGHT_EXAGGERATION },
      uKmPerUnit: { value: C.EARTH_RADIUS_KM },
      uSunColor: { value: v3(C.SUN_COLOR) },
      uSunColorLow: { value: v3(C.SUN_COLOR_LOW) },
      uTwilight: { value: new Vector2(C.TWILIGHT_WIDTH, C.TWILIGHT_STRENGTH) },
      uLightsColor: { value: new Vector4(C.LIGHTS_COLOR[0], C.LIGHTS_COLOR[1], C.LIGHTS_COLOR[2], C.LIGHTS_GAIN) },
      uAmbientNight: { value: v3(C.AMBIENT_NIGHT) },
      uAmbientDay: { value: v3(C.AMBIENT_DAY) },
      uFacet: { value: C.FACET_WEIGHT },
      uClassAlbedo: { value: C.CLASS_ALBEDO.map((c) => new Vector3(c[0], c[1], c[2])) },
      uBorderStrength: { value: C.BORDER_STRENGTH },
      uCountryTint: { value: C.COUNTRY_TINT },
      // Ocean (the animation time is the fx clock, set by Globe.render).
      uTime: { value: 0 },
      uWaveSlope: { value: C.OCEAN_WAVE_SLOPE },
      uOceanF0: { value: C.OCEAN_F0 },
      uSpec: { value: new Vector4(C.OCEAN_SPEC_BROAD, C.OCEAN_SPEC_BROAD_EXP, C.OCEAN_SPEC_TIGHT, C.OCEAN_SPEC_TIGHT_EXP) },
      uSkyHorizon: { value: v3(C.SKY_HORIZON) },
      uSkyZenith: { value: v3(C.SKY_ZENITH) },
      uSkyNight: { value: v3(C.SKY_NIGHT) },
      ...shared,
    },
  });
  const atmosphere = new ShaderMaterial({
    vertexShader: atmosphereVertexShader,
    fragmentShader: atmosphereFragmentShader,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { ...shared },
  });
  const stars = new ShaderMaterial({
    vertexShader: starsVertexShader,
    fragmentShader: starsFragmentShader,
    transparent: false,
    depthWrite: false,
    depthTest: false,
    uniforms: { uPixelRatio: { value: 1 } },
  });
  return { material, sun, atmosphere, stars };
}

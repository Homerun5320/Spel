// The data textures of the globe: uploaded straight from the raw pack bytes, never decoded as images and never
// colour-converted (NoColorSpace, flipY false, unpackAlignment 1, no mipmaps). All are single-channel R8.
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three';
import type { City, RenderPack, SimGrid } from '../data';
import { LIGHTS_HEIGHT, LIGHTS_WIDTH } from './config';
import { buildCityLights } from './nightLights';
import { createPaletteTexture } from './palette';

export type TextureFilter = 'linear' | 'nearest';

/** One R8 DataTexture over `bytes` (row 0 = north). Longitude repeats, latitude clamps. */
export function makeR8Texture(bytes: Uint8Array, width: number, height: number, filter: TextureFilter): DataTexture {
  if (bytes.length !== width * height) throw new Error(`texture data is ${bytes.length} bytes, expected ${width}x${height}`);
  const t = new DataTexture(bytes, width, height, RedFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.flipY = false;
  t.unpackAlignment = 1;
  t.generateMipmaps = false;
  t.minFilter = filter === 'linear' ? LinearFilter : NearestFilter;
  t.magFilter = filter === 'linear' ? LinearFilter : NearestFilter;
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export interface WorldTextures {
  /** Land height, sqrt code, 4096x2048, linear (the vertex shader displaces from it). */
  height: DataTexture;
  /** Sea depth, sqrt code, 2048x1024, linear. */
  bathy: DataTexture;
  /** Country id raster 4096x2048, NEAREST (ids must never blend). */
  country: DataTexture;
  /** Sim pack terrain class layer 1024x512, NEAREST. */
  terrainClass: DataTexture;
}

export type WorldTextureName = keyof WorldTextures;

export function createWorldTextures(render: RenderPack, sim: SimGrid): WorldTextures {
  return {
    height: makeR8Texture(render.height8, render.width, render.height, 'linear'),
    bathy: makeR8Texture(render.bathy8, render.bathyWidth, render.bathyHeight, 'linear'),
    country: makeR8Texture(render.country8, render.width, render.height, 'nearest'),
    terrainClass: makeR8Texture(sim.terrainClass, sim.width, sim.height, 'nearest'),
  };
}

/** Bytes a texture occupies on the GPU (R8, no mipmaps). */
export function textureBytes(t: DataTexture): number {
  const img = t.image as { width: number; height: number };
  return img.width * img.height;
}

/** Bytes an RGBA8 texture occupies on the GPU (no mipmaps): the ownership texture and the owner palette. */
export function rgbaTextureBytes(t: { image: unknown }): number {
  const img = t.image as { width: number; height: number };
  return img.width * img.height * 4;
}

export function disposeWorldTextures(t: WorldTextures): void {
  t.height.dispose();
  t.bathy.dispose();
  t.country.dispose();
  t.terrainClass.dispose();
}

/** Textures drawn on the CPU (not baked packs): the night lights from cities.json and the country palette LUT. */
export interface LookTextures {
  /** Night lights 2048x1024, linear, R8. */
  lights: DataTexture;
  /** Country colour palette LUT 256x1 RGBA8, nearest (index = country id). */
  palette: DataTexture;
}

export function createLookTextures(cities: readonly City[]): LookTextures {
  return { lights: makeR8Texture(buildCityLights(cities), LIGHTS_WIDTH, LIGHTS_HEIGHT, 'linear'), palette: createPaletteTexture() };
}

export function disposeLookTextures(t: LookTextures): void {
  t.lights.dispose();
  t.palette.dispose();
}

/** Bytes of the world and look textures on the GPU (R8 data, RGBA8 palette). */
export function allTextureBytes(w: WorldTextures, l: LookTextures): number {
  return textureBytes(w.height) + textureBytes(w.bathy) + textureBytes(w.country) + textureBytes(w.terrainClass) + textureBytes(l.lights) + textureBytes(l.palette) * 4;
}

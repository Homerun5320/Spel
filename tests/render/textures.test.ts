import { NearestFilter, LinearFilter, NoColorSpace, RedFormat, UnsignedByteType } from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldTextures, makeR8Texture, textureBytes } from '../../src/render/textures';
import { worldLoader } from '../helpers/dataFiles';

describe('data textures', () => {
  it('are R8 DataTextures straight over the raw pack bytes: NoColorSpace, flipY false, unpackAlignment 1, no mipmaps', async () => {
    const w = worldLoader();
    const [render, sim] = await Promise.all([w.loadRender(), w.loadSim()]);
    const t = createWorldTextures(render, sim);
    for (const [name, tex] of Object.entries(t)) {
      expect(tex.format, name).toBe(RedFormat);
      expect(tex.type, name).toBe(UnsignedByteType);
      expect(tex.colorSpace, name).toBe(NoColorSpace);
      expect(tex.flipY, name).toBe(false);
      expect(tex.unpackAlignment, name).toBe(1);
      expect(tex.generateMipmaps, name).toBe(false);
    }
    expect([t.height.image.width, t.height.image.height]).toEqual([4096, 2048]);
    expect([t.bathy.image.width, t.bathy.image.height]).toEqual([2048, 1024]);
    expect([t.country.image.width, t.country.image.height]).toEqual([4096, 2048]);
    expect([t.terrainClass.image.width, t.terrainClass.image.height]).toEqual([1024, 512]);
    // the very same bytes, not a copy
    expect(t.height.image.data).toBe(render.height8);
    expect(t.country.image.data).toBe(render.country8);
    expect(t.terrainClass.image.data).toBe(sim.terrainClass);
    // country ids and classes must never blend
    expect(t.country.magFilter).toBe(NearestFilter);
    expect(t.country.minFilter).toBe(NearestFilter);
    expect(t.terrainClass.magFilter).toBe(NearestFilter);
    expect(t.height.magFilter).toBe(LinearFilter);
    expect(textureBytes(t.height) + textureBytes(t.bathy) + textureBytes(t.country) + textureBytes(t.terrainClass)).toBe(8388608 + 2097152 + 8388608 + 524288);
  });

  it('rejects data of the wrong size', () => {
    expect(() => makeR8Texture(new Uint8Array(10), 4, 4, 'nearest')).toThrow(/expected 4x4/);
  });
});

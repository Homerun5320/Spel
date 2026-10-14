// The country selection table of the setup screen (M06): a 256 x 1 NEAREST texture, R = 255 for each country id that belongs to the
// selected country (a country and the territories merged into it by the overrides), 0 elsewhere. The terrain shader reads it with the
// id raster to draw the outline of the selection. Pure helpers plus the texture constructor (the one GL-free `three` use here is the
// DataTexture, like the owner palette).
import { DataTexture, NearestFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';

export const SELECTION_SIZE = 256;

/** The table bytes (RGBA, R = 255 for the selected ids; ids outside 1..255 are ignored). */
export function selectionBytes(ids: readonly number[], out: Uint8Array = new Uint8Array(SELECTION_SIZE * 4)): Uint8Array {
  out.fill(0);
  for (const id of ids) {
    if (Number.isInteger(id) && id >= 1 && id < SELECTION_SIZE) {
      out[id * 4] = 255;
      out[id * 4 + 3] = 255;
    }
  }
  return out;
}

export function createSelectionTexture(): DataTexture {
  const t = new DataTexture(selectionBytes([]), SELECTION_SIZE, 1, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

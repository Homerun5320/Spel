// Country colour palette as a lookup texture (LUT): 256 x 1 RGBA8, index = country id (0 = none). The colours are a
// deterministic walk over the hue circle with the golden angle, so neighbouring ids differ clearly; no art asset.
import { DataTexture, NearestFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';

export const PALETTE_SIZE = 256;

function hsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number): number => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/** RGBA bytes of the palette (alpha 255; index 0 is black). */
export function buildPalette(): Uint8Array {
  const out = new Uint8Array(PALETTE_SIZE * 4);
  for (let id = 1; id < PALETTE_SIZE; id++) {
    const hue = (id * 0.6180339887) % 1;
    const [r, g, b] = hsv(hue, 0.42 + 0.18 * ((id * 7) % 5) / 4, 0.62 + 0.3 * ((id * 3) % 4) / 3);
    out[id * 4] = Math.round(r * 255);
    out[id * 4 + 1] = Math.round(g * 255);
    out[id * 4 + 2] = Math.round(b * 255);
    out[id * 4 + 3] = 255;
  }
  return out;
}

/** The palette as a NEAREST data texture (read with `texelFetch`, never blended). */
export function createPaletteTexture(): DataTexture {
  const t = new DataTexture(buildPalette(), PALETTE_SIZE, 1, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.generateMipmaps = false;
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.wrapS = RepeatWrapping;
  t.needsUpdate = true;
  return t;
}


// The "terrain region" of the crack test and the detector that counts magenta pixels in it. Pure (no GL, no DOM): the page renders with
// a magenta clear colour, so a pixel of that colour INSIDE the silhouette of the sea-level planet (less a margin of a few pixels) is a
// hole in the terrain: everything behind the silhouette is covered by the displaced surface, which never dips below the sea level sphere.
import { CameraRig, type CameraPose } from '../../src/render/camera';
import { DEG, dot, length, normalize, scale } from '../../src/render/geo';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA bytes, row 0 at the top. */
  data: Uint8Array | Uint8ClampedArray | Buffer;
}

/** The clear colour of the crack test (0xFF00FF). */
export const MAGENTA = 0xff00ff;

/**
 * Pixels (1 = terrain) whose view ray hits the unit sphere with `marginPx` to spare: the ray's angle to the direction of the planet centre
 * must be smaller than the angular radius of the planet by `marginPx` pixels (taken at the largest pixel angle of the view).
 */
export function terrainRegionMask(pose: CameraPose, width: number, height: number, marginPx = 4): Uint8Array {
  const rig = new CameraRig(width, height);
  const toCentre = normalize(scale(pose.position, -1));
  const r = length(pose.position);
  const planetAngle = Math.asin(Math.min(1, 1 / r));
  const th = Math.tan((pose.fovDeg * DEG) / 2);
  const pixelAngle = (2 * th) / height; // radians per pixel at the centre (the edges are a little smaller)
  const limit = planetAngle - marginPx * pixelAngle;
  const mask = new Uint8Array(width * height);
  if (limit <= 0) return mask;
  const cosLimit = Math.cos(limit);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ray = rig.rayAt(x + 0.5, y + 0.5, pose);
      if (dot(ray.dir, toCentre) >= cosLimit) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** Magenta pixels (exactly 0xFF00FF) inside the mask. */
export function magentaInRegion(img: RgbaImage, mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const o = i * 4;
    if (img.data[o] === 0xff && img.data[o + 1] === 0x00 && img.data[o + 2] === 0xff) n++;
  }
  return n;
}

/** Distinct RGB colours inside the mask. */
export function distinctColours(img: RgbaImage, mask: Uint8Array): number {
  const seen = new Set<number>();
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const o = i * 4;
    seen.add(((img.data[o] as number) << 16) | ((img.data[o + 1] as number) << 8) | (img.data[o + 2] as number));
  }
  return seen.size;
}

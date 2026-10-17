import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/camera';
import { distinctColours, magentaInRegion, terrainRegionMask, type RgbaImage } from '../helpers/terrainRegion';

const W = 160;
const H = 90;

function solid(r: number, g: number, b: number): RgbaImage {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([r, g, b, 255], i * 4);
  return { width: W, height: H, data };
}
function paint(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) (img.data as Uint8Array).set([...rgb, 255], (y * img.width + x) * 4);
}

describe('the crack detector (a magenta clear colour, 0 magenta pixels inside the terrain region)', () => {
  const rig = new CameraRig(W, H);
  rig.setView({ lat: 20, lon: 10, distKm: 21500, heading: 0, tilt: 0 });
  const pose = rig.pose();
  const mask = terrainRegionMask(pose, W, H, 4);

  it('the terrain region is the disc of the planet less a margin: centre in, corners out, a ring of pixels at the rim out', () => {
    const inside = mask.reduce((s, v) => s + v, 0);
    expect(mask[(H / 2) * W + W / 2]).toBe(1);
    expect(mask[0]).toBe(0);
    expect(mask[W - 1]).toBe(0);
    expect(inside).toBeGreaterThan(0.2 * W * H);
    const wider = terrainRegionMask(pose, W, H, 0).reduce((s, v) => s + v, 0);
    expect(wider).toBeGreaterThan(inside);
    // the planet's disc: radius in pixels from the angular radius (asin(1/r)); the region's radius is that less the margin
    const r = Math.hypot(...pose.position);
    const planetPx = (Math.tan(Math.asin(1 / r)) / Math.tan((pose.fovDeg * Math.PI) / 360)) * (H / 2);
    expect(Math.sqrt(wider / Math.PI)).toBeGreaterThan(planetPx * 0.95);
    expect(Math.sqrt(wider / Math.PI)).toBeLessThan(planetPx * 1.05);
  });

  it('a camera looking away from the planet has an empty region', () => {
    const away = { ...pose, forward: pose.forward.map((v) => -v) as typeof pose.forward, right: pose.right.map((v) => -v) as typeof pose.right };
    expect(terrainRegionMask(away, W, H, 4).reduce((s, v) => s + v, 0)).toBe(0);
  });

  it('a clean image has 0 magenta pixels in the region', () => {
    expect(magentaInRegion(solid(60, 90, 40), mask)).toBe(0);
  });

  it('ALARMS on a synthetic image with a magenta hole inside the region (the detector can fail)', () => {
    const img = solid(60, 90, 40);
    paint(img, 70, 40, 73, 42, [255, 0, 255]);
    expect(magentaInRegion(img, mask)).toBe(6);
  });

  it('alarms on a single magenta pixel, and ignores magenta outside the region (the sky) and off-magenta colours inside it', () => {
    const one = solid(60, 90, 40);
    paint(one, 80, 45, 81, 46, [255, 0, 255]);
    expect(magentaInRegion(one, mask)).toBe(1);
    const sky = solid(60, 90, 40);
    paint(sky, 0, 0, 10, 10, [255, 0, 255]); // a corner: outside the planet
    expect(magentaInRegion(sky, mask)).toBe(0);
    const near = solid(60, 90, 40);
    paint(near, 70, 40, 90, 50, [254, 0, 255]);
    paint(near, 70, 50, 90, 55, [255, 1, 255]);
    expect(magentaInRegion(near, mask)).toBe(0);
  });

  it('counts distinct colours only inside the region', () => {
    const img = solid(60, 90, 40);
    for (let i = 0; i < 300; i++) paint(img, 60 + (i % 40), 30 + Math.floor(i / 40), 61 + (i % 40), 31 + Math.floor(i / 40), [i % 256, (i * 7) % 256, (i * 13) % 256]);
    const n = distinctColours(img, mask);
    expect(n).toBeGreaterThan(250);
    paint(img, 0, 0, 20, 20, [1, 2, 3]); // outside: not counted
    expect(distinctColours(img, mask)).toBe(n);
  });
});

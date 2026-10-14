import { describe, expect, it } from 'vitest';
import { HEIGHT_EXAGGERATION } from '../../src/render/config';
import { rng, loadChunkWorld } from '../helpers/chunkWorld';

describe('terrain heights of the chunk vertices (the global 4096x2048 raster, sqrt code, x12, no noise)', () => {
  it('the displaced radius is 1 + 12 * height over the Earth radius: the sqrt decode of the filtered code, as the vertex shader and picking compute it', async () => {
    const w = await loadChunkWorld();
    // Mount Everest region: the filtered code squared times maxM
    const h = w.field.heightM(28, 86.9);
    expect(h).toBeGreaterThan(3000);
    expect(w.field.radiusOf(h)).toBeCloseTo(1 + (HEIGHT_EXAGGERATION * h) / (6371 * 1000), 12);
    expect(w.field.surfaceRadius(28, 86.9)).toBeCloseTo(w.field.radiusOf(h), 12);
  });

  it('land never changes sign against sea: no vertex is ever below the sea level sphere, a pure sea neighbourhood is exactly at sea level and a land texel is above it', async () => {
    const w = await loadChunkWorld();
    const r = rng(9);
    let seaChecked = 0;
    let landChecked = 0;
    for (let i = 0; i < 20000; i++) {
      const tx = Math.floor(r() * w.width);
      const ty = 1 + Math.floor(r() * (w.height - 2));
      const lat = 90 - ((ty + 0.5) / w.height) * 180;
      const lon = ((tx + 0.5) / w.width) * 360 - 180;
      expect(w.field.surfaceRadius(lat, lon)).toBeGreaterThanOrEqual(1);
      const c = w.codes[ty * w.width + tx] as number;
      // the four texels around a position inside this texel's own cell are this texel and its neighbours
      const around = [w.codes[ty * w.width + ((tx + 1) % w.width)], w.codes[ty * w.width + ((tx + w.width - 1) % w.width)], w.codes[(ty + 1) * w.width + tx], w.codes[(ty - 1) * w.width + tx]] as number[];
      if (c === 0 && around.every((a) => a === 0)) {
        expect(w.field.heightM(lat, lon), `sea at ${lat},${lon}`).toBe(0);
        seaChecked++;
      }
      if (c > 0) {
        expect(w.field.heightM(lat, lon), `land at ${lat},${lon}`).toBeGreaterThan(0);
        landChecked++;
      }
    }
    expect(seaChecked).toBeGreaterThan(5000);
    expect(landChecked).toBeGreaterThan(2000);
  });

  it('the exaggeration is the one constant of config.ts (x12), not a literal of the chunk code', () => {
    expect(HEIGHT_EXAGGERATION).toBe(12);
  });
});

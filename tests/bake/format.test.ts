import { describe, expect, it } from 'vitest';
import {
  DEPTH_MAX_M,
  LAND_MAX_M,
  MIN_LAND_CODE,
  PACK_LAYERS,
  decodeDepth,
  decodeLandHeight,
  encodeDepth,
  encodeLandHeight,
  layoutOf,
} from '../../src/data/format';

describe('sqrt codecs', () => {
  it('every land code from MIN_LAND_CODE up decodes to at least 1 m', () => {
    for (let c = MIN_LAND_CODE; c <= 255; c++) {
      expect(decodeLandHeight(c)).toBeGreaterThanOrEqual(1);
      expect(decodeDepth(c)).toBeGreaterThanOrEqual(1);
    }
    expect(decodeLandHeight(MIN_LAND_CODE - 1)).toBeLessThan(1);
  });
  it('encodes small heights to at least MIN_LAND_CODE and caps at the maxima', () => {
    expect(encodeLandHeight(0)).toBe(MIN_LAND_CODE);
    expect(encodeLandHeight(1)).toBe(MIN_LAND_CODE);
    expect(encodeLandHeight(20_000)).toBe(255);
    expect(decodeLandHeight(255)).toBeCloseTo(LAND_MAX_M, 6);
    expect(encodeDepth(1)).toBe(MIN_LAND_CODE);
    expect(decodeDepth(encodeDepth(DEPTH_MAX_M))).toBeCloseTo(DEPTH_MAX_M, 6);
  });
  it('round trips within the code step', () => {
    for (const m of [10, 100, 500, 1500, 4000, 8800]) {
      const back = decodeLandHeight(encodeLandHeight(m));
      // the step of a sqrt code at height m is about 2 * sqrt(m * max) / 255 metres
      const step = (2 * Math.sqrt(m * LAND_MAX_M)) / 255;
      expect(Math.abs(back - m)).toBeLessThanOrEqual(step);
    }
  });
});

describe('pack layout', () => {
  it('Int16 layers are 2-byte aligned and the layers tile the pack without gaps', () => {
    for (const pack of ['render', 'sim'] as const) {
      const { layers, totalBytes } = layoutOf(pack);
      let expected = 0;
      for (const l of layers) {
        expect(l.offset).toBe(expected);
        if (l.type === 'i16') expect(l.offset % 2).toBe(0);
        expected += l.bytes;
      }
      expect(expected).toBe(totalBytes);
      expect(layers.length).toBe(PACK_LAYERS[pack].length);
    }
  });
});

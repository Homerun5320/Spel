// The ownership texture (RGBA8, owner u16 in R + G, flags in B, reserve in A) and its throttled full upload.
import { describe, expect, it } from 'vitest';
import { OWN_FLAG_PLAYABLE, OWN_FLAG_WATER, OwnershipTexture } from '../../src/render/ownership';
import { OWNERSHIP_MIN_UPLOAD_INTERVAL_S } from '../../src/render/config';

const W = 16;
const H = 8;
/** class layer: row 0 deep sea, row 1 shallows, then plains / forest / hills / mountain / peak / ice in the following rows, last row plains. */
const classes = (): Uint8Array => {
  const c = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) c.fill(y === H - 1 ? 2 : y, y * W, (y + 1) * W);
  return c;
};

describe('OwnershipTexture', () => {
  it('is a W x H RGBA8 texture whose B channel holds the playable / water flags and whose A channel is the reserve', () => {
    const t = new OwnershipTexture(W, H, classes());
    expect(t.data.length).toBe(W * H * 4);
    const img = t.texture.image as { width: number; height: number };
    expect([img.width, img.height]).toEqual([W, H]);
    expect(t.texture.format).toBe(1023); // RGBAFormat
    expect(t.flagsAt(0)).toBe(OWN_FLAG_WATER); // DeepSea
    expect(t.flagsAt(W)).toBe(OWN_FLAG_WATER); // Shallows
    expect(t.flagsAt(2 * W)).toBe(OWN_FLAG_PLAYABLE); // Plains
    expect(t.flagsAt(5 * W)).toBe(OWN_FLAG_PLAYABLE); // Mountain
    expect(t.flagsAt(6 * W)).toBe(0); // Peak: land nobody can own
    expect(t.flagsAt(7 * W - W)).toBe(0);
    for (let i = 0; i < W * H; i++) expect(t.data[i * 4 + 3]).toBe(255);
    expect(t.uploads).toBe(1); // the first upload at creation
  });

  it('packs a u16 owner into R (low byte) and G (high byte) and reads it back, for single cells and for a whole array', () => {
    const t = new OwnershipTexture(W, H, classes());
    t.applyCells([3, 40, 100], [1, 255, 0x1234]);
    expect([t.ownerAt(3), t.ownerAt(40), t.ownerAt(100)]).toEqual([1, 255, 0x1234]);
    expect([t.data[3 * 4], t.data[3 * 4 + 1]]).toEqual([1, 0]);
    expect([t.data[100 * 4], t.data[100 * 4 + 1]]).toEqual([0x34, 0x12]);
    expect(t.flagsAt(40)).toBe(OWN_FLAG_PLAYABLE); // the flags survive an owner write
    const all = new Uint16Array(W * H);
    for (let i = 0; i < all.length; i++) all[i] = (i * 37) % 300;
    expect(t.flush(100)).toBe(true); // upload what the writes above left, so that the texture is clean again
    expect(t.isDirty).toBe(false);
    t.setFromOwners(all);
    for (let i = 0; i < all.length; i++) expect(t.ownerAt(i)).toBe(all[i]);
    // a whole-array write (the first fill, and the full owner array after an outbox overflow) marks the texture dirty and the next flush uploads it
    expect(t.isDirty).toBe(true);
    expect(t.flush(200)).toBe(true);
    expect(t.isDirty).toBe(false);
  });

  it('uploads the whole texture at most once per OWNERSHIP_MIN_UPLOAD_INTERVAL_S of fx time, only when dirty, and counts the uploads', () => {
    const t = new OwnershipTexture(W, H, classes());
    expect(t.flush(5)).toBe(false); // clean: nothing to upload
    t.applyCells([1], [2]);
    expect(t.flush(5)).toBe(true); // the first upload after creation is not delayed by the interval
    expect(t.uploads).toBe(2);
    t.applyCells([2], [2]);
    expect(t.flush(5 + OWNERSHIP_MIN_UPLOAD_INTERVAL_S * 0.5)).toBe(false); // too soon, stays dirty
    expect(t.isDirty).toBe(true);
    expect(t.flush(5 + OWNERSHIP_MIN_UPLOAD_INTERVAL_S + 1e-6)).toBe(true);
    expect(t.isDirty).toBe(false);
    t.applyCells([3], [2]);
    expect(t.flush(5 + OWNERSHIP_MIN_UPLOAD_INTERVAL_S + 0.01, true)).toBe(true); // force ignores the interval
    expect(t.uploads).toBe(4);
  });

  it('never exceeds 10 uploads per fx second however often the owners change (60 frames per second, every frame dirty)', () => {
    const t = new OwnershipTexture(W, H, classes());
    let now = 100;
    const base = t.uploads;
    for (let frame = 0; frame < 600; frame++) {
      now += 1 / 60;
      t.applyCells([frame % (W * H)], [(frame % 5) + 1]);
      t.flush(now);
    }
    const perSecond = (t.uploads - base) / 10;
    expect(perSecond).toBeLessThanOrEqual(10);
    expect(perSecond).toBeGreaterThan(5); // it does upload
  });

  it('refuses a class layer of the wrong size', () => {
    expect(() => new OwnershipTexture(W, H, new Uint8Array(3))).toThrow();
  });
});

describe('the territory shader module', () => {
  it('builds its noise from an integer hash: no sin, no cos, no fract(sin) trick, and it uses unsigned integers', async () => {
    const { GLSL_TERRITORY } = await import('../../src/render/shaders/territory');
    const code = GLSL_TERRITORY.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(sin|cos|tan)\s*\(/);
    expect(code).toMatch(/\buint\b/);
    expect(code).toMatch(/\bfwidth|dFdx\b/); // pixel-sized lines through the screen-space derivatives
    expect(code).toContain('texelFetch(uOwnerTex');
  });
});

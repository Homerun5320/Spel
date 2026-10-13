import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CONSOLE_WARNINGS,
  CHROMIUM_ARGS,
  GOLDEN_MISSING_TEXT,
  THRESHOLDS,
  analyzeImage,
  checkImageStats,
  checkShot,
  compareGolden,
  decodePng,
  disallowedConsole,
  encodePng,
  median,
  resolveChromiumPath,
  type RawImage,
} from '../scripts/shot.mjs';
import { makePrng } from '../src/render/spike';

const W = 960;
const H = 540;

function blank(): RawImage {
  const data = new Uint8Array(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: W, height: H, data };
}

function noise(): RawImage {
  const img = blank();
  const rnd = makePrng(42);
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = Math.floor(rnd() * 256);
    img.data[i * 4 + 1] = Math.floor(rnd() * 256);
    img.data[i * 4 + 2] = Math.floor(rnd() * 256);
  }
  return img;
}

function checker(cell = 30): RawImage {
  const img = blank();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 230 : 25;
      const i = (y * W + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
    }
  }
  return img;
}

/** A synthetic lit globe: black background, disc of diameter = height, brighter on the left. */
function globe(): RawImage {
  const img = blank();
  const r = H / 2;
  const cx = W / 2;
  const cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / r;
      const dy = (y - cy) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const lit = Math.max(0, -0.6 * dx + 0.34 * -dy + 0.72 * nz);
      const v = 12 + 220 * lit;
      const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, v * 0.7);
      img.data[i + 1] = Math.min(255, v * 0.9);
      img.data[i + 2] = Math.min(255, v);
    }
  }
  return img;
}

describe('image analysis: positive control', () => {
  it('a synthetic lit globe passes every statistic', () => {
    const m = analyzeImage(globe());
    expect(checkImageStats(m)).toEqual([]);
    expect(m.coverage).toBeGreaterThan(0.43);
    expect(m.coverage).toBeLessThan(0.46);
    expect(m.leftRightRatio).toBeGreaterThanOrEqual(THRESHOLDS.minLeftRightRatio);
  });
});

describe('image analysis: broken images must be rejected', () => {
  it('an empty (single colour) canvas fails', () => {
    const fails = checkImageStats(analyzeImage(blank()));
    expect(fails.length).toBeGreaterThan(0);
    expect(fails.join('\n')).toMatch(/distinct colours/);
    expect(fails.join('\n')).toMatch(/luma std/);
    expect(fails.join('\n')).toMatch(/coverage/);
  });
  it('a uniformly lit grey canvas fails', () => {
    const img = blank();
    for (let i = 0; i < W * H; i++) img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 128;
    expect(checkImageStats(analyzeImage(img)).length).toBeGreaterThan(0);
  });
  it('noise fails (structure: left/right ratio and coverage)', () => {
    const fails = checkImageStats(analyzeImage(noise()));
    expect(fails.length).toBeGreaterThan(0);
    expect(fails.join('\n')).toMatch(/left\/right/);
    expect(fails.join('\n')).toMatch(/coverage/);
  });
  it('a checkerboard fails (colours and left/right ratio)', () => {
    const fails = checkImageStats(analyzeImage(checker()));
    expect(fails.length).toBeGreaterThan(0);
    expect(fails.join('\n')).toMatch(/distinct colours/);
    expect(fails.join('\n')).toMatch(/left\/right/);
  });
  it('a globe lit from the right fails the left/right ratio', () => {
    const img = globe();
    // Mirror the image horizontally.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W / 2; x++) {
        for (let c = 0; c < 4; c++) {
          const a = (y * W + x) * 4 + c;
          const b = (y * W + (W - 1 - x)) * 4 + c;
          const t = img.data[a] as number;
          img.data[a] = img.data[b] as number;
          img.data[b] = t;
        }
      }
    }
    expect(checkImageStats(analyzeImage(img)).join('\n')).toMatch(/left\/right/);
  });
  it('a disc that is too small or too large fails the coverage band', () => {
    const tiny = globe();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - W / 2, y - H / 2) > 80) tiny.data.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3);
    expect(checkImageStats(analyzeImage(tiny)).join('\n')).toMatch(/coverage/);
  });
});

describe('checkShot', () => {
  const okInfo = { renderer: 'ANGLE (SwiftShader)', webgl2: true };
  it('flags a missing WebGL2 context, an empty renderer string and console errors', () => {
    const fails = checkShot({
      image: globe(),
      info: { renderer: '', webgl2: false } as never,
      consoleMessages: [{ type: 'error', text: 'boom' }],
    });
    expect(fails.join('\n')).toMatch(/no WebGL2/);
    expect(fails.join('\n')).toMatch(/renderer string/);
    expect(fails.join('\n')).toMatch(/console error: boom/);
  });
  it('console warnings fail unless on the exact allow-list', () => {
    expect(checkShot({ image: globe(), info: okInfo as never, consoleMessages: [{ type: 'warning', text: 'x' }] }).length).toBe(1);
    expect(disallowedConsole([{ type: 'warning', text: 'known' }], ['known'])).toEqual([]);
    expect(disallowedConsole([{ type: 'warning', text: 'known and more' }], ['known']).length).toBe(1);
    expect(disallowedConsole([{ type: 'error', text: 'known' }], ['known']).length).toBe(1);
  });
  it('a clean shot passes', () => {
    expect(checkShot({ image: globe(), info: okInfo as never, consoleMessages: [] })).toEqual([]);
  });
  it('the allow-list is empty unless DECISIONS.md justifies an entry', () => {
    expect(ALLOWED_CONSOLE_WARNINGS).toEqual([]);
  });
});

describe('chromium launch arguments', () => {
  it('are exactly the documented array, with the precise-memory switch as its own argument', () => {
    expect(CHROMIUM_ARGS).toEqual([
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader',
      '--force-color-profile=srgb',
      '--js-flags=--expose-gc',
      '--enable-precise-memory-info',
    ]);
    expect(CHROMIUM_ARGS.find((a) => a.startsWith('--js-flags='))).toBe('--js-flags=--expose-gc');
  });
  it('CHROMIUM_PATH wins over the default', () => {
    expect(resolveChromiumPath({ CHROMIUM_PATH: '/x/chrome' })).toBe('/x/chrome');
  });
});

describe('png helpers', () => {
  it('encode/decode roundtrip', () => {
    const img = globe();
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(W);
    expect(Buffer.from(back.data).equals(Buffer.from(img.data))).toBe(true);
  });
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('golden comparison rules', () => {
  function tmp(): { goldenDir: string; outDir: string } {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
    return { goldenDir: path.join(base, 'goldens'), outDir: path.join(base, 'out') };
  }
  const pngA = encodePng(globe());

  it('a missing golden fails with the instruction text', () => {
    const d = tmp();
    expect(() => compareGolden(pngA, 'x', { ...d, env: {} })).toThrow(GOLDEN_MISSING_TEXT);
  });
  it('UPDATE_GOLDENS=1 writes the golden, then an identical render matches', () => {
    const d = tmp();
    expect(compareGolden(pngA, 'x', { ...d, env: { UPDATE_GOLDENS: '1' } }).status).toBe('updated');
    expect(fs.existsSync(path.join(d.goldenDir, 'x.png'))).toBe(true);
    const r = compareGolden(pngA, 'x', { ...d, env: {} });
    expect(r.status).toBe('match');
    expect(r.diffPixels).toBe(0);
  });
  it('a clearly different image fails; GOLDEN_COMPARE=warn does not throw; GOLDEN_MAX_DIFF can raise the limit', () => {
    const d = tmp();
    compareGolden(pngA, 'x', { ...d, env: { UPDATE_GOLDENS: '1' } });
    const other = encodePng(checker());
    expect(() => compareGolden(other, 'x', { ...d, env: {} })).toThrow(/differs/);
    expect(fs.existsSync(path.join(d.outDir, 'x.actual.png'))).toBe(true);
    expect(fs.existsSync(path.join(d.outDir, 'x.diff.png'))).toBe(true);
    expect(compareGolden(other, 'x', { ...d, env: { GOLDEN_COMPARE: 'warn' } }).status).toBe('mismatch-warn');
    expect(compareGolden(other, 'x', { ...d, env: { GOLDEN_MAX_DIFF: '1' } }).status).toBe('match');
  });
  it('a tiny deviation (<= 0.2 % of pixels) passes, a larger one fails', () => {
    const d = tmp();
    compareGolden(pngA, 'x', { ...d, env: { UPDATE_GOLDENS: '1' } });
    const img = globe();
    const small = Math.floor(W * H * 0.001); // 0.1 %
    for (let i = 0; i < small; i++) {
      const p = (i * 7 + 20000) % (W * H);
      img.data[p * 4] = 255 - (img.data[p * 4] as number);
      img.data[p * 4 + 1] = 255 - (img.data[p * 4 + 1] as number);
      img.data[p * 4 + 2] = 255 - (img.data[p * 4 + 2] as number);
    }
    expect(compareGolden(encodePng(img), 'x', { ...d, env: {} }).status).toBe('match');
    const big = globe();
    const many = Math.floor(W * H * 0.01); // 1 %
    for (let i = 0; i < many; i++) {
      const p = (i * 7 + 20000) % (W * H);
      big.data[p * 4] = 255 - (big.data[p * 4] as number);
      big.data[p * 4 + 1] = 255 - (big.data[p * 4 + 1] as number);
      big.data[p * 4 + 2] = 255 - (big.data[p * 4 + 2] as number);
    }
    expect(() => compareGolden(encodePng(big), 'x', { ...d, env: {} })).toThrow(/differs/);
  });
});

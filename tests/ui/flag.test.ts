// Procedural flags (M06, item 2): a pure function of a seed; the golden is the spec and the draw commands, never the raster; at least
// 45 distinct pictures among 50 seeds; a custom nation's colours come out of the drawing within dE 10 of spec.colors; the emblem differs
// from the pattern behind it.
import { describe, expect, it } from 'vitest';
import { deltaE76, rgbToLab } from '../../src/render/color';
import {
  FLAG_EMBLEM_COUNT,
  FLAG_MIN_COLOR_DE,
  FLAG_PALETTE,
  FLAG_PATTERN_COUNT,
  FLAG_SIZE_COUNT,
  FlagRecorder,
  cssOfHex,
  drawFlag,
  drawFlagEmblem,
  drawFlagPattern,
  emblemRadius,
  flagCommands,
  flagHash,
  flagSpecText,
  hexDeltaE,
  makeFlagSpec,
  rgbOfHex,
  type FlagSpec,
} from '../../src/ui/flag';
import { SoftCanvas } from '../helpers/softCanvas';

const SEEDS_50 = Array.from({ length: 50 }, (_, i) => i + 1);

function raster(spec: FlagSpec, w = 96, h = 64, layers: 'both' | 'pattern' = 'both'): SoftCanvas {
  const c = new SoftCanvas(w, h);
  if (layers === 'both') drawFlag(c, spec, w, h);
  else drawFlagPattern(c, spec, w, h);
  return c;
}

function rasterHash(c: SoftCanvas): number {
  let x = 0x811c9dc5;
  for (const b of c.data) x = Math.imul(x ^ b, 0x01000193);
  return x >>> 0;
}

describe('the spec is a pure function of the seed', () => {
  it('the same seed (and options) always gives the same spec, a different seed usually a different one', () => {
    for (const seed of [0, 1, 7, -1, 2147483647, 4294967295, 123456789]) {
      expect(makeFlagSpec(seed)).toEqual(makeFlagSpec(seed));
      expect(makeFlagSpec(seed, { primary: 0x336699 })).toEqual(makeFlagSpec(seed, { primary: 0x336699 }));
    }
    expect(flagSpecText(makeFlagSpec(1))).not.toBe(flagSpecText(makeFlagSpec(2)));
  });

  it('every part of a spec is in range and the two colours are well apart', () => {
    for (let seed = 0; seed < 400; seed++) {
      const s = makeFlagSpec(seed);
      expect(Number.isInteger(s.pattern) && s.pattern >= 0 && s.pattern < FLAG_PATTERN_COUNT, `pattern ${seed}`).toBe(true);
      expect(Number.isInteger(s.emblem) && s.emblem >= 0 && s.emblem < FLAG_EMBLEM_COUNT, `emblem ${seed}`).toBe(true);
      expect(Number.isInteger(s.size) && s.size >= 0 && s.size < FLAG_SIZE_COUNT, `size ${seed}`).toBe(true);
      expect(FLAG_PALETTE).toContain(s.colors[0]);
      expect(FLAG_PALETTE).toContain(s.colors[1]);
      expect(hexDeltaE(s.colors[0], s.colors[1]), `colours of ${seed}`).toBeGreaterThanOrEqual(FLAG_MIN_COLOR_DE);
    }
  });

  it('over many seeds every pattern, every emblem, every size and every palette colour occurs', () => {
    const patterns = new Set<number>();
    const emblems = new Set<number>();
    const sizes = new Set<number>();
    const colors = new Set<number>();
    for (let seed = 0; seed < 2000; seed++) {
      const s = makeFlagSpec(seed);
      patterns.add(s.pattern);
      emblems.add(s.emblem);
      sizes.add(s.size);
      colors.add(s.colors[0]);
      colors.add(s.colors[1]);
    }
    expect(patterns.size).toBe(FLAG_PATTERN_COUNT);
    expect(emblems.size).toBe(FLAG_EMBLEM_COUNT);
    expect(sizes.size).toBe(FLAG_SIZE_COUNT);
    expect(colors.size).toBe(FLAG_PALETTE.length);
  });

  it('the palette colours are all distinct enough to name', () => {
    for (let i = 0; i < FLAG_PALETTE.length; i++) for (let j = i + 1; j < FLAG_PALETTE.length; j++) expect(hexDeltaE(FLAG_PALETTE[i] as number, FLAG_PALETTE[j] as number), `${i} ${j}`).toBeGreaterThan(8);
  });
});

describe('golden hashes (on the spec and on the draw commands, not on the raster)', () => {
  // Re-pin only with a reason in docs/DECISIONS.md: these numbers are the flags of the seeds 1, 2, 3, 42 and 2024.
  const GOLDEN: Record<number, { spec: string; hash: number }> = {
    1: { spec: 'p11 #5bb4e5 #e8d9a8 e5 s0', hash: 833452895 },
    2: { spec: 'p3 #ffffff #00a3a1 e11 s2', hash: 1159817452 },
    3: { spec: 'p3 #5bb4e5 #2e9e44 e6 s2', hash: 2124012923 },
    42: { spec: 'p6 #0b1f5c #7a4a21 e0 s2', hash: 3814502056 },
    2024: { spec: 'p8 #8c8c8c #2e9e44 e8 s0', hash: 2405974291 },
  };
  it('are pinned', () => {
    const now = Object.fromEntries(Object.keys(GOLDEN).map((k) => [k, { spec: flagSpecText(makeFlagSpec(Number(k))), hash: flagHash(makeFlagSpec(Number(k))) }]));
    expect(now).toEqual(GOLDEN);
  });
});

describe('the pictures', () => {
  it('at least 45 distinct pictures among 50 seeds, by draw commands AND by raster', () => {
    const byCommands = new Set(SEEDS_50.map((s) => flagHash(makeFlagSpec(s))));
    const byRaster = new Set(SEEDS_50.map((s) => rasterHash(raster(makeFlagSpec(s)))));
    expect(byCommands.size).toBeGreaterThanOrEqual(45);
    expect(byRaster.size).toBeGreaterThanOrEqual(45);
    // and in a bigger crowd almost every flag is its own
    const many = new Set(Array.from({ length: 1000 }, (_, i) => flagHash(makeFlagSpec(1000 + i))));
    expect(many.size).toBeGreaterThanOrEqual(985);
  });

  it('two flags with the same hash have the same commands (the hash is of the commands), and the commands change with the size', () => {
    const a = makeFlagSpec(5);
    expect(flagCommands(a)).toEqual(flagCommands(a));
    expect(flagHash(a, 96, 64)).not.toBe(flagHash(a, 192, 128));
    expect(flagCommands(a, 96, 64)[1]).toBe('fillRect 0 0 96 64');
  });

  it('the recorder sees only the calls the flag canvas allows, in a fixed order that starts with the field', () => {
    const rec = new FlagRecorder();
    drawFlag(rec, makeFlagSpec(9), 90, 60);
    const names = new Set(rec.commands.map((c) => c.split(' ')[0]));
    for (const n of names) expect(['fillStyle', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'fill']).toContain(n);
    expect(rec.commands[0]).toMatch(/^fillStyle #[0-9a-f]{6}$/);
    expect(rec.commands[1]).toBe('fillRect 0 0 90 60');
    // every path that is begun is closed and filled
    const text = rec.commands.join('\n');
    const count = (re: RegExp): number => (text.match(re) ?? []).length;
    expect(count(/^beginPath$/gm)).toBeGreaterThan(0);
    expect(count(/^beginPath$/gm)).toBe(count(/^closePath$/gm));
    expect(count(/^beginPath$/gm)).toBe(count(/^fill$/gm));
  });

  it('nothing is drawn outside the flag: every coordinate of every emblem, pattern and size lies inside the rectangle', () => {
    for (let seed = 0; seed < 300; seed++) {
      const spec = makeFlagSpec(seed);
      for (const [w, h] of [[96, 64], [30, 20], [200, 100]] as const) {
        for (const line of flagCommands(spec, w, h)) {
          const [op, ...rest] = line.split(' ');
          const n = rest.map(Number);
          if (op === 'moveTo' || op === 'lineTo') {
            expect(n[0], line).toBeGreaterThanOrEqual(-0.001);
            expect(n[0], line).toBeLessThanOrEqual(w + 0.001);
            expect(n[1], line).toBeGreaterThanOrEqual(-0.001);
            expect(n[1], line).toBeLessThanOrEqual(h + 0.001);
          } else if (op === 'arc') {
            const [x, y, r] = n as [number, number, number];
            expect(x - r, line).toBeGreaterThanOrEqual(-0.001);
            expect(x + r, line).toBeLessThanOrEqual(w + 0.001);
            expect(y - r, line).toBeGreaterThanOrEqual(-0.001);
            expect(y + r, line).toBeLessThanOrEqual(h + 0.001);
          }
        }
      }
    }
  });
});

describe('a custom nation: its own colour and a seeded flag', () => {
  const PRIMARIES = [0xec3296, 0x336699, 0xffffff, 0x111111, 0xc8102e, 0x0b5d3b, 0x7a4a21, 0x123456];

  it('the field colour is the chosen colour and the accent is well apart from it', () => {
    for (const primary of PRIMARIES) {
      for (let seed = 0; seed < 40; seed++) {
        const s = makeFlagSpec(seed, { primary });
        expect(s.colors[0]).toBe(primary);
        expect(hexDeltaE(s.colors[0], s.colors[1]), `${primary.toString(16)} ${seed}`).toBeGreaterThanOrEqual(FLAG_MIN_COLOR_DE);
      }
    }
  });

  it('drawn, the flag has at least two dominant colours and both match spec.colors within dE 10', () => {
    for (const primary of PRIMARIES) {
      for (let seed = 1; seed <= 30; seed++) {
        const spec = makeFlagSpec(seed, { primary });
        const hist = raster(spec).histogram();
        const total = 96 * 64;
        const dominant = hist.filter(([, n]) => n >= total * 0.05);
        expect(dominant.length, `${primary.toString(16)} ${seed}: ${hist.length} colours`).toBeGreaterThanOrEqual(2);
        for (const want of spec.colors) {
          const best = Math.min(...dominant.map(([c]) => hexDeltaE(c, want)));
          expect(best, `${primary.toString(16)} ${seed} wants ${cssOfHex(want)}`).toBeLessThanOrEqual(10);
        }
        // nothing but the two colours is drawn (no anti-aliasing here), and both really appear
        expect(hist.map(([c]) => c).sort()).toEqual([...spec.colors].sort());
      }
    }
  });

  it('the same holds for the flags of 200 plain seeds', () => {
    for (let seed = 100; seed < 300; seed++) {
      const spec = makeFlagSpec(seed);
      const hist = raster(spec).histogram();
      expect(hist.length, String(seed)).toBe(2);
      expect(hist[0]?.[1] as number, String(seed)).toBeGreaterThan(96 * 64 * 0.05);
      expect(hist[1]?.[1] as number, String(seed)).toBeGreaterThan(96 * 64 * 0.05);
    }
  });

  it('the colour maths used here is the render colour maths (a sanity pin)', () => {
    const [r, g, b] = rgbOfHex(0xec3296);
    expect(deltaE76(rgbToLab(r, g, b), rgbToLab(r, g, b))).toBe(0);
    expect(hexDeltaE(0xffffff, 0x111111)).toBeGreaterThan(80);
  });
});

describe('the emblem', () => {
  it('differs from the pattern behind it: in the emblem area at least a sixth of the pixels change, whatever the pattern', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const spec = makeFlagSpec(seed);
      const w = 120;
      const h = 80;
      const both = raster(spec, w, h);
      const pattern = raster(spec, w, h, 'pattern');
      const r = (emblemRadius(spec, w, h) * 6) / 5;
      const inside = (x: number, y: number): boolean => (x + 0.5 - w / 2) ** 2 + (y + 0.5 - h / 2) ** 2 <= r * r;
      let area = 0;
      let changed = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!inside(x, y)) continue;
          area++;
          if (both.pixel(x, y) !== pattern.pixel(x, y)) changed++;
        }
      }
      expect(changed / area, `seed ${seed} ${flagSpecText(spec)}`).toBeGreaterThan(1 / 6);
    }
  });

  it('stays inside its badge: outside the badge the picture is the pattern, untouched', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const spec = makeFlagSpec(seed);
      const w = 120;
      const h = 80;
      const both = raster(spec, w, h);
      const pattern = raster(spec, w, h, 'pattern');
      const r = (emblemRadius(spec, w, h) * 6) / 5 + 1.5;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if ((x + 0.5 - w / 2) ** 2 + (y + 0.5 - h / 2) ** 2 > r * r) expect(both.pixel(x, y), `seed ${seed} at ${x},${y}`).toBe(pattern.pixel(x, y));
        }
      }
    }
  });

  it('the pattern alone and the emblem alone add up to drawFlag (the three functions issue the same calls)', () => {
    for (const seed of [3, 4, 5]) {
      const spec = makeFlagSpec(seed);
      const a = new FlagRecorder();
      drawFlag(a, spec, 80, 50);
      const b = new FlagRecorder();
      drawFlagPattern(b, spec, 80, 50);
      drawFlagEmblem(b, spec, 80, 50);
      expect(b.commands).toEqual(a.commands);
    }
  });

  it('every one of the 12 emblems and 12 patterns is visibly different from the others (pairwise different rasters)', () => {
    const emblemRasters = new Set<number>();
    for (let e = 0; e < FLAG_EMBLEM_COUNT; e++) emblemRasters.add(rasterHash(raster({ pattern: 0, colors: [0xffffff, 0x111111], emblem: e, size: 2 })));
    expect(emblemRasters.size).toBe(FLAG_EMBLEM_COUNT);
    const patternRasters = new Set<number>();
    for (let p = 0; p < FLAG_PATTERN_COUNT; p++) patternRasters.add(rasterHash(raster({ pattern: p, colors: [0xffffff, 0x111111], emblem: 0, size: 0 })));
    expect(patternRasters.size).toBe(FLAG_PATTERN_COUNT);
  });
});

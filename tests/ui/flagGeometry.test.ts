// The geometry of the flag patterns and emblems, pinned one by one (M06 audit): the golden seeds of flag.test.ts cover only a few
// combinations, so a moved vertex in the bolt or the chevron would pass them. Here EVERY pattern and EVERY (emblem, size) has a hash of
// its draw commands, with fixed colours, in e2e/goldens/flag-geometry.json (rewrite only with UPDATE_GOLDENS=1 and a reason in
// docs/DECISIONS.md), plus command-level checks of the parts that have a hole (the ring).
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FLAG_EMBLEM_COUNT, FLAG_PATTERN_COUNT, FLAG_SIZE_COUNT, FlagRecorder, cssOfHex, drawFlagEmblem, drawFlagPattern, emblemRadius, type FlagSpec } from '../../src/ui/flag';

const GOLDEN_PATH = path.resolve(__dirname, '../../e2e/goldens/flag-geometry.json');
const W = 96;
const H = 64;
const FIELD = 0x1f4fb8;
const ACCENT = 0xfcd116;

interface Golden {
  schema: 1;
  /** FNV-1a (hex) of the draw commands of drawFlagPattern per pattern, at 96 x 64, colours 0x1f4fb8 / 0xfcd116. */
  patterns: string[];
  /** FNV-1a (hex) of the draw commands of drawFlagEmblem per emblem, then per size. */
  emblems: string[][];
}

function fnv(lines: readonly string[]): string {
  let x = 0x811c9dc5;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) x = Math.imul(x ^ line.charCodeAt(i), 0x01000193);
    x = Math.imul(x ^ 10, 0x01000193);
  }
  return (x >>> 0).toString(16).padStart(8, '0');
}

const spec = (pattern: number, emblem: number, size: number): FlagSpec => ({ pattern, colors: [FIELD, ACCENT], emblem, size });

function patternCommands(pattern: number): string[] {
  const rec = new FlagRecorder();
  drawFlagPattern(rec, spec(pattern, 0, 0), W, H);
  return rec.commands;
}

function emblemCommands(emblem: number, size: number): string[] {
  const rec = new FlagRecorder();
  drawFlagEmblem(rec, spec(0, emblem, size), W, H);
  return rec.commands;
}

function compute(): Golden {
  return {
    schema: 1,
    patterns: Array.from({ length: FLAG_PATTERN_COUNT }, (_, p) => fnv(patternCommands(p))),
    emblems: Array.from({ length: FLAG_EMBLEM_COUNT }, (_, e) => Array.from({ length: FLAG_SIZE_COUNT }, (_, s) => fnv(emblemCommands(e, s)))),
  };
}

beforeAll(() => {
  if (process.env.UPDATE_GOLDENS === '1') {
    fs.writeFileSync(GOLDEN_PATH, `${JSON.stringify(compute(), null, 1)}\n`);
    console.log('[golden] updated e2e/goldens/flag-geometry.json');
  }
});

describe('every pattern and every emblem has its geometry pinned', () => {
  it('the committed table equals the draw commands of the 12 patterns and of the 12 emblems at 3 sizes', () => {
    expect(fs.existsSync(GOLDEN_PATH), 'kör UPDATE_GOLDENS=1 och committa e2e/goldens/flag-geometry.json').toBe(true);
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as Golden;
    const now = compute();
    expect(golden.schema).toBe(1);
    expect(now.patterns).toEqual(golden.patterns);
    expect(now.emblems).toEqual(golden.emblems);
  });

  it('all 12 patterns and all 36 emblem pictures are different from each other (the table pins 12 + 36 distinct things)', () => {
    const now = compute();
    expect(new Set(now.patterns).size).toBe(FLAG_PATTERN_COUNT);
    expect(new Set(now.emblems.flat()).size).toBe(FLAG_EMBLEM_COUNT * FLAG_SIZE_COUNT);
  });
});

describe('the ring emblem has a hole in the field colour', () => {
  const RING = 9;

  it('draws the badge in the field colour, a full circle in the accent colour, then a smaller circle in the FIELD colour', () => {
    for (let size = 0; size < FLAG_SIZE_COUNT; size++) {
      const cmds = emblemCommands(RING, size);
      const r = emblemRadius(spec(0, RING, size), W, H);
      const num = (x: number): string => String(Math.round(x * 1000) / 1000);
      const styles = cmds.filter((c) => c.startsWith('fillStyle'));
      expect(styles, `size ${size}`).toEqual([`fillStyle ${cssOfHex(FIELD)}`, `fillStyle ${cssOfHex(ACCENT)}`, `fillStyle ${cssOfHex(FIELD)}`]);
      const arcs = cmds.filter((c) => c.startsWith('arc'));
      expect(arcs.map((a) => a.split(' ')[3]), `size ${size}`).toEqual([num((r * 6) / 5), num(r), num(r * 0.56)]);
      // the colour change comes before the arc it paints: field, badge arc, accent, outer arc, field, inner arc
      const order = cmds.filter((c) => c.startsWith('fillStyle') || c.startsWith('arc')).map((c) => (c.startsWith('arc') ? 'arc' : c));
      expect(order).toEqual(['fillStyle #1f4fb8', 'arc', 'fillStyle #fcd116', 'arc', 'fillStyle #1f4fb8', 'arc']);
    }
  });
});

describe('the emblem parts keep their colours', () => {
  it('every emblem except the ring is drawn in the accent colour only, after the badge in the field colour', () => {
    for (let e = 0; e < FLAG_EMBLEM_COUNT; e++) {
      if (e === 9) continue;
      const styles = emblemCommands(e, 1).filter((c) => c.startsWith('fillStyle'));
      expect(styles[0], `emblem ${e}`).toBe(`fillStyle ${cssOfHex(FIELD)}`);
      expect(new Set(styles.slice(1)), `emblem ${e}`).toEqual(new Set([`fillStyle ${cssOfHex(ACCENT)}`]));
    }
  });
});

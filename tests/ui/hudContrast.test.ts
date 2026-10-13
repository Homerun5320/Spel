// Readability of the HUD by arithmetic: every text colour against the panel colour, with the panel composed over the worst
// backgrounds (white snow and black night), must reach WCAG AA (4.5:1); buttons and the slider are at least 44 px; the style
// sheet uses no CSS clock. The pixel check on real screenshots (day and night) is in e2e/hud.test.ts.
import { describe, expect, it } from 'vitest';
import { hudCss } from '../../src/ui/hudStyle';
import { CONTRAST_PAIRS, HUD_FONT_MAX_PX, HUD_FONT_MIN_PX, TARGET_MIN_PX, UI_COLORS } from '../../src/ui/uiConfig';

type Rgba = [number, number, number, number];

function parse(css: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) {
    const n = parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css);
  if (!m) throw new Error(`cannot parse ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

function over(top: Rgba, bottom: [number, number, number]): [number, number, number] {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a)];
}

function luminance(c: [number, number, number]): number {
  const f = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

export function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('HUD colours', () => {
  it('the parser reads hex and rgba', () => {
    expect(parse('#ffffff')).toEqual([255, 255, 255, 1]);
    expect(parse('rgba(8, 13, 24, 0.88)')).toEqual([8, 13, 24, 0.88]);
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
  });

  it('every text colour reaches 4.5:1 on its panel, over white snow and over black night', () => {
    const worst: string[] = [];
    for (const [fgKey, bgKey] of CONTRAST_PAIRS) {
      const fg = parse(UI_COLORS[fgKey]);
      const bgRaw = parse(UI_COLORS[bgKey]);
      for (const backdrop of [[255, 255, 255], [0, 0, 0]] as Array<[number, number, number]>) {
        const bg = over(bgRaw, backdrop);
        const text = over(fg, bg);
        const ratio = contrast(text, bg);
        worst.push(`${fgKey} on ${bgKey} over ${backdrop[0] === 255 ? 'white' : 'black'}: ${ratio.toFixed(1)}`);
        expect(ratio, `${fgKey} on ${bgKey} over ${backdrop[0] === 255 ? 'white' : 'black'}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    console.log(`[hud] contrast ratios: ${worst.join('; ')}`);
  });

  it('the panel stays dark over the brightest background (it is nearly opaque)', () => {
    const over255 = over(parse(UI_COLORS.panel), [255, 255, 255]);
    expect(luminance(over255)).toBeLessThan(0.05);
  });
});

describe('HUD sizes and style sheet', () => {
  it('targets are at least 44 px, the font follows the width between two limits', () => {
    expect(TARGET_MIN_PX).toBeGreaterThanOrEqual(44);
    expect(HUD_FONT_MIN_PX).toBeGreaterThanOrEqual(14);
    expect(HUD_FONT_MAX_PX).toBeGreaterThan(HUD_FONT_MIN_PX);
    const css = hudCss();
    expect(css).toContain(`min-height: ${TARGET_MIN_PX}px`);
    expect(css).toContain(`clamp(${HUD_FONT_MIN_PX}px`);
  });

  it('the style sheet has no CSS transition, animation or keyframes (cosmetic time is the fx clock only)', () => {
    const css = hudCss();
    expect(css).not.toMatch(/\b(?:transition|animation)(?:-[a-z-]+)?\s*:/);
    expect(css).not.toMatch(/@keyframes/);
    expect(css).toContain('.hud-root');
    expect(css).toContain('.start-root');
  });
});

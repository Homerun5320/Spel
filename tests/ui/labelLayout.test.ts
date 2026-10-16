// M20a-2: the pure parts of the nation labels and the front arrows: the layout (40 candidates), the centroids (the date line), the zoom fades and the troop text.
import { describe, expect, it } from 'vitest';
import { NationCentroids } from '../../src/app/nationCentroids';
import { frontFade } from '../../src/render/frontLayer';
import { FRONT_FADE_FULL_ALT_R, FRONT_FADE_GONE_ALT_R } from '../../src/render/config';
import { LabelLayout } from '../../src/ui/labelLayout';
import { compactTroops, labelOpacity, labelScale, labelWidth } from '../../src/ui/nationLabels';
import { LABELS } from '../../src/ui/uiConfig';

/** A deterministic scatter (no Math.random). */
function scatter(n: number, w: number, h: number, seed: number): Array<[number, number]> {
  let s = seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return Array.from({ length: n }, () => [next() * w, next() * h] as [number, number]);
}

describe('LabelLayout', () => {
  for (const [vw, vh] of [
    [960, 540],
    [1280, 720],
    [640, 400],
  ] as const) {
    it(`40 candidates in ${vw}x${vh}: between 8 and 32 shown, no two boxes overlap, none outside the window`, () => {
      const layout = new LabelLayout(64);
      const pts = scatter(40, vw, vh, 7 + vw);
      pts.forEach(([x, y], i) => layout.add(i, x, y, labelWidth(10), LABELS.heightPx, 1000 - i));
      const shown = layout.solve(vw, vh, LABELS.max, LABELS.gapPx, LABELS.edgePx);
      expect(shown).toBeGreaterThanOrEqual(8);
      expect(shown).toBeLessThanOrEqual(32);
      const boxes: Array<[number, number, number, number]> = [];
      for (let k = 0; k < shown; k++) {
        const i = layout.placed[k] as number;
        const w = layout.w[i] as number;
        const h = layout.h[i] as number;
        const l = (layout.x[i] as number) - w / 2;
        const t = (layout.y[i] as number) - h / 2;
        expect(l).toBeGreaterThanOrEqual(LABELS.edgePx - 1e-3);
        expect(t).toBeGreaterThanOrEqual(LABELS.edgePx - 1e-3);
        expect(l + w).toBeLessThanOrEqual(vw - LABELS.edgePx + 1e-3);
        expect(t + h).toBeLessThanOrEqual(vh - LABELS.edgePx + 1e-3);
        boxes.push([l, t, w, h]);
      }
      for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
          const p = boxes[a] as number[];
          const q = boxes[b] as number[];
          expect(p[0]! < q[0]! + q[2]! && q[0]! < p[0]! + p[2]! && p[1]! < q[1]! + q[3]! && q[1]! < p[1]! + p[3]!, `boxes ${a} and ${b} overlap`).toBe(false);
        }
      }
    });
  }

  it('the highest priority wins a clash, a box is pushed inside the window, a blocked rectangle is respected and a pool of 32 is never exceeded', () => {
    const layout = new LabelLayout(64);
    layout.add(1, 100, 100, 80, 32, 5);
    layout.add(2, 110, 105, 80, 32, 9); // the same place, higher priority
    layout.add(3, -50, 300, 80, 32, 1); // off the left edge: moved inside
    layout.add(4, 600, 300, 80, 32, 1); // under a blocked rectangle
    layout.block(560, 280, 100, 60);
    layout.solve(800, 600, 32, 4, 4);
    expect(layout.shown[0]).toBe(0);
    expect(layout.shown[1]).toBe(1);
    expect(layout.shown[2]).toBe(1);
    expect((layout.x[2] as number) - 40).toBeGreaterThanOrEqual(4 - 1e-3);
    expect(layout.shown[3]).toBe(0);
    const many = new LabelLayout(64);
    for (let i = 0; i < 60; i++) many.add(i, 20 + (i % 10) * 80, 20 + Math.floor(i / 10) * 40, 60, 24, i);
    expect(many.solve(1000, 400, 32, 2, 2)).toBeLessThanOrEqual(32);
  });
});

describe('NationCentroids', () => {
  it('counts the cells and takes the circular mean in x: a nation across the date line has its centre at the date line, not in the middle of the map', () => {
    const w = 64;
    const h = 32;
    const owner = new Uint16Array(w * h);
    // owner 1: columns 62, 63, 0, 1 of rows 10..13 (across the date line); owner 2: a block in the middle
    for (let y = 10; y < 14; y++) for (const x of [62, 63, 0, 1]) owner[y * w + x] = 1;
    for (let y = 20; y < 24; y++) for (let x = 30; x < 34; x++) owner[y * w + x] = 2;
    const c = new NationCentroids(3, w, h);
    c.compute(owner);
    expect(c.count[1]).toBe(16);
    expect(c.count[2]).toBe(16);
    const dx1 = Math.min(Math.abs((c.cx[1] as number) - 0), Math.abs((c.cx[1] as number) - w));
    expect(dx1).toBeLessThan(0.6);
    expect(c.cx[2]).toBeCloseTo(32, 0);
    expect(c.cy[1]).toBeCloseTo(12, 0);
    // a centre off the nation's land falls back to the capital cell
    const split = new Uint16Array(w * h);
    split[5 * w + 4] = 1;
    split[5 * w + 20] = 1;
    const s = new NationCentroids(2, w, h);
    s.compute(split);
    expect(split[s.anchorCell(1, split, -1)]).toBe(0); // no capital: the centre cell, which is not the nation's
    expect(s.anchorCell(1, split, 5 * w + 4)).toBe(5 * w + 4);
    expect(s.anchorCell(0, split, -1)).toBe(-1);
  });
});

describe('the zoom fades and the troop text', () => {
  it('labels are gone at globe distance, full and full size when zoomed in, in between small and fading', () => {
    expect(labelOpacity(LABELS.hideAltR)).toBe(0);
    expect(labelOpacity(3)).toBe(0);
    expect(labelOpacity(LABELS.fadeFullAltR)).toBe(1);
    expect(labelOpacity(0.1)).toBe(1);
    const mid = labelOpacity((LABELS.hideAltR + LABELS.fadeFullAltR) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(labelScale(LABELS.scaleFullAltR)).toBe(1);
    expect(labelScale(LABELS.scaleFromAltR)).toBeCloseTo(LABELS.smallScale, 6);
    expect(labelScale(2)).toBeCloseTo(LABELS.smallScale, 6);
  });

  it('the arrows are fully drawn below FRONT_FADE_FULL_ALT_R, gone from FRONT_FADE_GONE_ALT_R and monotone in between', () => {
    expect(frontFade(0)).toBe(1);
    expect(frontFade(FRONT_FADE_FULL_ALT_R)).toBe(1);
    expect(frontFade(FRONT_FADE_GONE_ALT_R)).toBe(0);
    expect(frontFade(3)).toBe(0);
    let prev = 1;
    for (let a = FRONT_FADE_FULL_ALT_R; a <= FRONT_FADE_GONE_ALT_R; a += 0.05) {
      const f = frontFade(a);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it('writes troops short: whole numbers below a thousand, then k and M cut (not rounded)', () => {
    expect(compactTroops(0)).toBe('0');
    expect(compactTroops(999.9)).toBe('999');
    expect(compactTroops(12000)).toBe('12k');
    expect(compactTroops(123456)).toBe('123k');
    expect(compactTroops(1234)).toMatch(/^1[.,]2k$/);
    expect(compactTroops(1999)).toMatch(/^1[.,]9k$/);
    expect(compactTroops(2500000)).toMatch(/^2[.,]5M$/);
    expect(compactTroops(15000000)).toBe('15M');
    expect(labelWidth(1)).toBe(LABELS.minWidthPx);
    expect(labelWidth(200)).toBe(LABELS.maxWidthPx);
  });
});

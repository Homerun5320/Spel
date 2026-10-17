// Connected land masses: the connectivity a Spawn disc walks through.
import { describe, expect, it } from 'vitest';
import { computeLandmasses, landmassSizeAt } from '../../src/app/landmass';
import { CLASS_DEEP_SEA, CLASS_FOREST, CLASS_HILLS, CLASS_ICE, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS, CLASS_SHALLOWS } from '../../src/sim/terrain';

/** A grid from rows of characters: . sea, p plains, f forest, h hills, m mountain, K peak, i ice, s shallows. */
function grid(rows: string[]): { w: number; h: number; t: Uint8Array } {
  const w = (rows[0] as string).length;
  const t = new Uint8Array(w * rows.length);
  const cls: Record<string, number> = { '.': CLASS_DEEP_SEA, p: CLASS_PLAINS, f: CLASS_FOREST, h: CLASS_HILLS, m: CLASS_MOUNTAIN, K: CLASS_PEAK, i: CLASS_ICE, s: CLASS_SHALLOWS };
  rows.forEach((row, y) => [...row].forEach((ch, x) => (t[y * w + x] = cls[ch] as number)));
  return { w, h: rows.length, t };
}

describe('computeLandmasses', () => {
  it('counts 4-neighbour connected playable cells; a diagonal touch does not connect', () => {
    const { w, h, t } = grid(['pp...', 'pp...', '..pp.', '..pp.', '.....']);
    const l = computeLandmasses(w, h, t);
    expect(landmassSizeAt(l, 0)).toBe(4);
    expect(landmassSizeAt(l, 2 * w + 2)).toBe(4);
    expect(l.size.length).toBe(2);
  });

  it('x wraps around the world (west edge joins east edge) and y does not (north row does not join south row)', () => {
    const wrapped = grid(['p...p', '.....']);
    const lw = computeLandmasses(wrapped.w, wrapped.h, wrapped.t);
    expect(landmassSizeAt(lw, 0)).toBe(2);
    expect(landmassSizeAt(lw, 4)).toBe(2);
    const poles = grid(['pp', '..', '..', 'pp']);
    const lp = computeLandmasses(poles.w, poles.h, poles.t);
    expect(landmassSizeAt(lp, 0)).toBe(2);
    expect(landmassSizeAt(lp, 3 * 2)).toBe(2);
  });

  it('Ice, Peak, Shallows and sea are not land: they neither count nor connect', () => {
    const { w, h, t } = grid(['pip', 'pKp', 'psp', 'f.m', 'hhh']);
    const l = computeLandmasses(w, h, t);
    expect(landmassSizeAt(l, 1)).toBe(0); // ice
    expect(landmassSizeAt(l, w + 1)).toBe(0); // peak
    expect(landmassSizeAt(l, 2 * w + 1)).toBe(0); // shallows
    expect(landmassSizeAt(l, 3 * w + 1)).toBe(0); // sea
    // the left column p p p f h and the bottom row h h h and the right column m (rows 3, 4) are one mass through the bottom row; the p's of the right column join through x wrap
    expect(landmassSizeAt(l, 0)).toBe(landmassSizeAt(l, 4 * w + 2));
  });

  it('every playable cell has a mass whose size is the number of cells with its label; the sizes add up to the playable cells', () => {
    const { w, h, t } = grid(['ppp.pp', 'p.p.pp', 'ppp.ii', '......', 'mmhhff']);
    const l = computeLandmasses(w, h, t);
    let playable = 0;
    for (let i = 0; i < t.length; i++) if ((t[i] as number) >= 2 && (t[i] as number) <= 5) playable++;
    expect(Array.from(l.size).reduce((a, b) => a + b, 0)).toBe(playable);
    const counts = new Map<number, number>();
    for (const id of l.label) if (id >= 0) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) expect(l.size[id]).toBe(n);
  });

  it('landmassSizeAt is 0 outside the grid and for non-integers', () => {
    const { w, h, t } = grid(['pp']);
    const l = computeLandmasses(w, h, t);
    expect([landmassSizeAt(l, -1), landmassSizeAt(l, 2), landmassSizeAt(l, 0.5), landmassSizeAt(l, Number.NaN)]).toEqual([0, 0, 0, 0]);
  });
});

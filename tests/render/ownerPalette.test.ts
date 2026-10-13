// Territory colours: the own colour is far from every other colour, and the colour maths behind that statement is right.
import { describe, expect, it } from 'vitest';
import { deltaE76, deltaE76Rgb, labToRgb, rgbToLab } from '../../src/render/color';
import { buildOwnerPalette, DISTINCT_COLORS, OWN_SEPARATION_DE, OWNER_PALETTE_SIZE, PLAYER_COLORS } from '../../src/render/ownerPalette';

const colour = (p: Uint8Array, id: number): [number, number, number] => [p[id * 4] as number, p[id * 4 + 1] as number, p[id * 4 + 2] as number];

describe('CIE76 colour maths', () => {
  it('matches the reference values (white, black, mid grey, red) and round trips', () => {
    const white = rgbToLab(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(Math.abs(white[1])).toBeLessThan(0.1);
    expect(Math.abs(white[2])).toBeLessThan(0.1);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 3);
    expect(rgbToLab(119, 119, 119)[0]).toBeCloseTo(50, 0);
    const red = rgbToLab(255, 0, 0); // sRGB red in D65 L*a*b*: 53.24, 80.09, 67.20
    expect(red[0]).toBeCloseTo(53.24, 1);
    expect(red[1]).toBeCloseTo(80.09, 0);
    expect(red[2]).toBeCloseTo(67.2, 0);
    for (const c of [[10, 200, 90], [250, 250, 20], [128, 64, 200]] as const) {
      const lab = rgbToLab(c[0], c[1], c[2]);
      expect(labToRgb(lab[0], lab[1], lab[2])).toEqual([c[0], c[1], c[2]]);
    }
    expect(deltaE76([50, 0, 0], [50, 3, 4])).toBe(5);
    expect(deltaE76Rgb([0, 0, 0], [255, 255, 255])).toBeCloseTo(100, 1);
  });
});

describe('owner palette', () => {
  const p = buildOwnerPalette();

  it('has 256 entries, owner 0 is nobody (transparent), owner 1 is the blue of the player, every other entry is opaque', () => {
    expect(p.length).toBe(OWNER_PALETTE_SIZE * 4);
    expect(p[3]).toBe(0); // nobody: transparent
    expect(colour(p, 1)).toEqual(PLAYER_COLORS[0]);
    for (let id = 1; id < OWNER_PALETTE_SIZE; id++) expect(p[id * 4 + 3], `alpha ${id}`).toBe(255);
  });

  it('keeps dE76 >= 25 between the own colour and EVERY other palette colour (the acceptance), in fact OWN_SEPARATION_DE', () => {
    const own = colour(p, 1);
    let worst = Infinity;
    for (let id = 2; id < OWNER_PALETTE_SIZE; id++) worst = Math.min(worst, deltaE76Rgb(own, colour(p, id)));
    console.log(`[palette] own colour against the other 254 entries: worst dE76 ${worst.toFixed(1)}`);
    expect(worst).toBeGreaterThanOrEqual(25);
    expect(OWN_SEPARATION_DE).toBeGreaterThanOrEqual(25);
  });

  it('the six players are pairwise far apart (dE76 >= 25) and the 26 seats of a standard match are all distinct from each other (dE76 >= 12)', () => {
    let worstPlayers = Infinity;
    for (let a = 1; a <= PLAYER_COLORS.length; a++) for (let b = a + 1; b <= PLAYER_COLORS.length; b++) worstPlayers = Math.min(worstPlayers, deltaE76Rgb(colour(p, a), colour(p, b)));
    expect(worstPlayers).toBeGreaterThanOrEqual(25);
    let worst = Infinity;
    for (let a = 1; a <= 26; a++) for (let b = a + 1; b <= 26; b++) worst = Math.min(worst, deltaE76Rgb(colour(p, a), colour(p, b)));
    console.log(`[palette] players pairwise worst dE76 ${worstPlayers.toFixed(1)}; the 26 seats of a match pairwise worst dE76 ${worst.toFixed(1)}; ${DISTINCT_COLORS} distinct entries`);
    expect(worst).toBeGreaterThanOrEqual(12);
  });

  it('is deterministic (two builds are byte-identical)', () => {
    expect(Array.from(buildOwnerPalette())).toEqual(Array.from(p));
  });
});

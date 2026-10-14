// Territory colours: the own colour is far from every other colour, and the colour maths behind that statement is right.
import { describe, expect, it } from 'vitest';
import { deltaE76, deltaE76Rgb, labToRgb, rgbToLab } from '../../src/render/color';
import { CUSTOM_COLORS } from '../../src/app/matchSetup';
import { rgbOfHex } from '../../src/ui/flag';
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

  it('has 256 entries, owner 0 is nobody (transparent), owner 1 is the colour of the player, every other entry is opaque', () => {
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

  it('the player\'s own colour is neither a sea nor a land colour (D108): dE76 >= 40 from shallow and deep sea, grass, forest, desert, rock and snow, and no hue of the blue or green kind', () => {
    const own = colour(p, 1);
    const nature: Array<[string, [number, number, number]]> = [
      ['shallow sea', [60, 130, 170]],
      ['sea', [30, 90, 150]],
      ['deep sea', [12, 40, 90]],
      ['grass', [110, 150, 70]],
      ['forest', [60, 105, 55]],
      ['desert', [205, 180, 125]],
      ['rock', [125, 105, 85]],
      ['snow', [235, 240, 250]],
    ];
    const lab = rgbToLab(own[0], own[1], own[2]);
    for (const [name, c] of nature) expect(deltaE76Rgb(own, c), name).toBeGreaterThanOrEqual(40);
    const hue = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI; // CIE hue angle: blue is about -130 to -45 degrees, green and teal 100 to 180 and -180 to -150
    const kind = hue > -130 && hue < -45 ? 'blue' : hue > 100 || hue < -150 ? 'green or teal' : 'other';
    expect(kind, `hue ${hue.toFixed(0)}`).toBe('other');
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

describe('owner palette with a custom own colour (M06)', () => {
  const nature: Array<[number, number, number]> = [[60, 130, 170], [30, 90, 150], [12, 40, 90], [110, 150, 70], [60, 105, 55], [205, 180, 125], [125, 105, 85], [235, 240, 250]];

  it('the default call is the palette of M05 (owner 1 magenta) and passing the default colour changes nothing', () => {
    expect(Array.from(buildOwnerPalette(PLAYER_COLORS[0]))).toEqual(Array.from(buildOwnerPalette()));
  });

  it('every swatch a custom nation can choose is readable on the globe (dE76 >= 38 from sea and land) and in the palette it is >= 25 from every other seat', () => {
    expect(CUSTOM_COLORS.length).toBeGreaterThanOrEqual(5);
    for (const hex of CUSTOM_COLORS) {
      const own = rgbOfHex(hex);
      for (const n of nature) expect(deltaE76Rgb(own, n), `swatch ${hex.toString(16)} against ${n.join(',')}`).toBeGreaterThanOrEqual(38);
      const p = buildOwnerPalette(own);
      expect(colour(p, 1)).toEqual(own);
      let worst = Infinity;
      for (let id = 2; id < OWNER_PALETTE_SIZE; id++) worst = Math.min(worst, deltaE76Rgb(own, colour(p, id)));
      expect(worst, `swatch ${hex.toString(16)}`).toBeGreaterThanOrEqual(25);
      // the 26 seats of a match stay distinct from each other as well
      let seats = Infinity;
      for (let a = 1; a <= 26; a++) for (let b = a + 1; b <= 26; b++) seats = Math.min(seats, deltaE76Rgb(colour(p, a), colour(p, b)));
      expect(seats, `swatch ${hex.toString(16)} seats`).toBeGreaterThanOrEqual(12);
      expect(Array.from(buildOwnerPalette(own))).toEqual(Array.from(p)); // deterministic
    }
  });

  it('an AI colour that clashes with the chosen colour is replaced, the others keep their hand-picked colour', () => {
    const red = rgbOfHex(0xc8102e);
    const p = buildOwnerPalette(red);
    const base = buildOwnerPalette();
    // owner 2 is the hand-picked red of the standard palette: too close to a red own colour, so it must have changed
    expect(colour(base, 2)).toEqual(PLAYER_COLORS[1]);
    expect(deltaE76Rgb(colour(p, 2), red)).toBeGreaterThanOrEqual(OWN_SEPARATION_DE);
    expect(colour(p, 2)).not.toEqual(PLAYER_COLORS[1]);
    // yellow (owner 3) is far from red and keeps its colour
    expect(colour(p, 3)).toEqual(PLAYER_COLORS[2]);
  });
});

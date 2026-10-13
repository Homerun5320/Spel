// Territory colours: a lookup table from ownerId (0..255) to an RGBA colour. No art assets; the table is computed.
//  - owner 0 (nobody) is transparent black;
//  - owners 1..PLAYER_COLORS.length are the players: hand-picked, strongly different hues (owner 1 is YOU, blue);
//  - the owners after them are tribes and further seats: muted colours chosen greedily so that each is as far as possible
//    (CIE76) from every colour chosen before, and never within OWN_SEPARATION_DE of the player's own colour.
// tests/render/ownerPalette.test.ts states the acceptance: dE76 >= 25 between the own colour and every other colour.
import { DataTexture, NearestFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import { deltaE76, labToRgb, rgbToLab, type Lab, type Rgb8 } from './color';

export const OWNER_PALETTE_SIZE = 256;
/** Colours chosen greedily (the players and 26 further owners: the 20 tribes of a standard match and a few spare); later ids repeat them in order. */
export const DISTINCT_COLORS = 32;

/** Players: you (blue), then the five AI nations. */
export const PLAYER_COLORS: readonly Rgb8[] = [
  [40, 120, 235],
  [225, 55, 55],
  [235, 190, 40],
  [170, 70, 205],
  [240, 125, 35],
  [35, 185, 175],
];

/** The own colour is at least this far (CIE76) from every other colour of the table. */
export const OWN_SEPARATION_DE = 30;

function candidates(): Array<{ lab: Lab; rgb: Rgb8 }> {
  const out: Array<{ lab: Lab; rgb: Rgb8 }> = [];
  for (const l of [44, 56, 68, 80]) {
    for (const c of [16, 26, 36]) {
      for (let h = 0; h < 360; h += 12) {
        const rgb = labToRgb(l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180));
        const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
        // keep only colours that survived the gamut clamp (the round trip stays on the intended point)
        if (deltaE76(lab, [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]) < 3) out.push({ lab, rgb });
      }
    }
  }
  return out;
}

/** RGBA bytes of the table (256 entries, alpha 255 except owner 0). */
export function buildOwnerPalette(): Uint8Array {
  const out = new Uint8Array(OWNER_PALETTE_SIZE * 4);
  const chosen: Lab[] = [];
  const own = PLAYER_COLORS[0] as Rgb8;
  const ownLab = rgbToLab(own[0], own[1], own[2]);
  PLAYER_COLORS.forEach((c, i) => {
    out.set([c[0], c[1], c[2], 255], (i + 1) * 4);
    chosen.push(rgbToLab(c[0], c[1], c[2]));
  });
  const pool = candidates().filter((c) => deltaE76(c.lab, ownLab) >= OWN_SEPARATION_DE);
  for (let id = PLAYER_COLORS.length + 1; id <= DISTINCT_COLORS; id++) {
    // farthest-first: the candidate whose nearest chosen colour is the farthest away (ties: the first in the fixed pool order)
    let best = -1;
    let bestD = -1;
    for (let k = 0; k < pool.length; k++) {
      const lab = (pool[k] as { lab: Lab }).lab;
      let nearest = Infinity;
      for (const q of chosen) nearest = Math.min(nearest, deltaE76(lab, q));
      if (nearest > bestD + 1e-9) {
        bestD = nearest;
        best = k;
      }
    }
    const pick = pool[best] as { lab: Lab; rgb: Rgb8 };
    chosen.push(pick.lab);
    out.set([pick.rgb[0], pick.rgb[1], pick.rgb[2], 255], id * 4);
  }
  // Ids beyond the distinct colours (a match with more than 31 seats) repeat the tribe colours in order.
  const firstTribe = PLAYER_COLORS.length + 1;
  const span = DISTINCT_COLORS - PLAYER_COLORS.length;
  for (let id = DISTINCT_COLORS + 1; id < OWNER_PALETTE_SIZE; id++) {
    const from = firstTribe + ((id - firstTribe) % span);
    out.set(out.subarray(from * 4, from * 4 + 4), id * 4);
  }
  return out;
}

/** The palette as a NEAREST data texture, read with `texelFetch` (never blended). */
export function createOwnerPaletteTexture(): DataTexture {
  const t = new DataTexture(buildOwnerPalette(), OWNER_PALETTE_SIZE, 1, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

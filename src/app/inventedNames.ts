// Invented nation names for the neutral "no real borders" mode (M06, item 4): made of syllables, never a real country's name
// (the syllables are chosen so that none of the combinations that are likely is a place on the map is relied on, and the neutral mode
// draws no country names at all). A free, untranslated name: the same in every language. Seeded: the same stream gives the same names.
import { nextBelow } from '../sim/public';

const START = ['Al', 'Bor', 'Cal', 'Dro', 'El', 'Fen', 'Gor', 'Hal', 'Ir', 'Jor', 'Kel', 'Lum', 'Mor', 'Nor', 'Or', 'Pel', 'Quo', 'Rav', 'Sel', 'Tor', 'Ul', 'Vel', 'Wen', 'Xan', 'Yor', 'Zel'];
const MIDDLE = ['a', 'e', 'i', 'o', 'u', 'ar', 'en', 'il', 'on', 'ur', 'ae', 'io'];
const END = ['ia', 'land', 'ora', 'stan', 'mark', 'ria', 'dar', 'vik', 'nia', 'sia', 'thar', 'gard'];

/** One name from the stream; `taken` names are never repeated (the stream is advanced until a free one comes up). */
export function inventName(rng: Uint32Array, taken: ReadonlySet<string>): string {
  for (let tries = 0; tries < 64; tries++) {
    const name = `${START[nextBelow(rng, START.length)] as string}${MIDDLE[nextBelow(rng, MIDDLE.length)] as string}${END[nextBelow(rng, END.length)] as string}`;
    if (!taken.has(name)) return name;
  }
  // 26 * 12 * 12 names exist and a match needs at most a few dozen; this is only reached by a pathological `taken`.
  let n = taken.size + 1;
  while (taken.has(`Nova${n}`)) n++;
  return `Nova${n}`;
}

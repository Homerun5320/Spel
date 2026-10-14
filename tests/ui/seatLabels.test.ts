// The seat label provider (M06): country names follow the UI language, free names do not, generic seats keep the numbered keys.
import { afterEach, describe, expect, it } from 'vitest';
import { makeFlagSpec } from '../../src/ui/flag';
import { setLanguage } from '../../src/ui/i18n';
import { createSeatLabels, type SeatLabelEntry } from '../../src/ui/seatLabels';

afterEach(() => setLanguage('sv'));

const flag = makeFlagSpec(4);
const entries: SeatLabelEntry[] = [
  { identity: { kind: 'custom', name: 'Zorlandia' }, flag },
  { identity: { kind: 'country', nameEn: 'Sweden', nameSv: 'Sverige' }, flag: makeFlagSpec(5) },
  { identity: { kind: 'invented', name: 'Veloria' }, flag: makeFlagSpec(6) },
  { identity: { kind: 'generic' }, flag: null },
];

describe('createSeatLabels', () => {
  const labels = createSeatLabels(entries, 4, 0);

  it('a country name follows the UI language (or the language asked for), a free name is shown as it is in every language', () => {
    setLanguage('sv');
    expect(labels.name(1)).toBe('Sverige');
    expect(labels.name(1, 'en')).toBe('Sweden');
    setLanguage('en');
    expect(labels.name(1)).toBe('Sweden');
    expect(labels.name(1, 'sv')).toBe('Sverige');
    for (const lang of ['sv', 'en'] as const) {
      expect(labels.name(0, lang)).toBe('Zorlandia');
      expect(labels.name(2, lang)).toBe('Veloria');
    }
  });

  it('a seat without an identity (or past the list) keeps the numbered keys of the HUD: Nation n, Tribe n, You', () => {
    setLanguage('sv');
    expect(labels.name(3)).toBe('Nation 3');
    expect(labels.name(4)).toBe('Stam 1');
    expect(labels.name(9)).toBe('Stam 6');
    setLanguage('en');
    expect(labels.name(3)).toBe('Nation 3');
    expect(labels.name(4)).toBe('Tribe 1');
    const generic = createSeatLabels([], 3, 1);
    expect(generic.name(1)).toBe('You');
    setLanguage('sv');
    expect(generic.name(1)).toBe('Du');
  });

  it('gives the flag of a seat or null, and says who the local seat is', () => {
    expect(labels.flag(0)).toBe(flag);
    expect(labels.flag(3)).toBeNull();
    expect(labels.flag(50)).toBeNull();
    expect([labels.isYou(0), labels.isYou(1)]).toEqual([true, false]);
  });
});

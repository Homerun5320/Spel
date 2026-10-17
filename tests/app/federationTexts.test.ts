// Fix-5C: the setup texts of "Dela upp stormakter" agree with createMatch (only startable sub-nations count; India is not split), the diplomacy
// hint takes its seconds from the rule, and sub-nation names are the province's own with the country in the language of the UI.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { membersOf, subNationLabel, subNationName } from '../../src/app/federationSetup';
import { federationLineModel, startableSubNations } from '../../src/app/federationStarts';
import { createMatch, matchSetupConfig } from '../../src/app/matchSetup';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { PROPOSAL_TTL_TICKS, TICK_HZ } from '../../src/sim/rules';
import { setLanguage, t } from '../../src/ui/i18n';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});
afterEach(() => setLanguage('sv'));

const country = (a3: string) => world.countries.find((c) => c.a3 === a3)!;
const config = (a3: string, seed = 1) => matchSetupConfig({ kind: 'real', countryId: country(a3).id }, { seed, federations: true, tribes: false, win: null });

describe('the setup line counts startable sub-nations', () => {
  it('equals the sub-nation seats createMatch builds, for every candidate', () => {
    for (const a3 of ['RUS', 'CAN', 'USA', 'CHN', 'BRA', 'AUS', 'IND']) {
      const built = createMatch(world, { ...config(a3), aiNations: 12 });
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      const seats = built.match.seats.filter((s) => s.subNation !== undefined).length;
      expect(startableSubNations(world, config(a3)), a3).toBe(seats);
    }
  });

  it('India has five sub-nations in the pack but none (fewer than two) can start, so the line must say so', () => {
    expect(membersOf(world.data.federations ?? null, country('IND')).length).toBeGreaterThanOrEqual(2);
    expect(startableSubNations(world, config('IND'))).toBeLessThan(2);
    expect(startableSubNations(world, config('CHN'))).toBeGreaterThanOrEqual(2);
  });

  it('the line model says "none" for India and counts startable partners for China', () => {
    const india = federationLineModel(startableSubNations(world, config('IND')), 12, 12);
    expect(india.key).toBe('setup.federation.none');
    const n = startableSubNations(world, config('CHN'));
    const china = federationLineModel(n, 12, 12);
    expect(china).toEqual({ key: 'setup.federation.sub', members: n, ai: n - 1 + Math.min(12, 12 - (n - 1)) });
  });

  it('the hint no longer promises India', () => {
    for (const lang of ['sv', 'en'] as const) {
      setLanguage(lang);
      expect(t('setup.federation.hint')).not.toMatch(/Indien|India is split|and India/);
    }
  });
});

describe('diplo.hint', () => {
  it('takes the seconds as an argument (no literal 60) in both languages', () => {
    const secs = Math.round(PROPOSAL_TTL_TICKS / TICK_HZ);
    for (const lang of ['sv', 'en'] as const) {
      setLanguage(lang);
      expect(t('diplo.hint', { s: 7 })).toContain('7');
      expect(t('diplo.hint', { s: 7 })).not.toContain('60');
      expect(t('diplo.hint', { s: secs })).toContain(String(secs));
    }
  });
});

describe('sub-nation names', () => {
  it('are the province alone, without the country and without a redundant "Region"', () => {
    const f = world.data.federations!;
    for (const a3 of ['RUS', 'USA']) {
      const c = country(a3);
      for (const sub of membersOf(f, c)) {
        const n = subNationName(sub, c);
        expect(n, sub.name).not.toContain('(');
        expect(n, sub.name).not.toMatch(/ Region$/);
        expect(n.length).toBeGreaterThan(0);
      }
    }
    const kh = f.subNations.find((s) => s.name.startsWith('Khabarovsk'))!;
    expect(subNationName(kh, country('RUS'))).toBe('Khabarovsk Krai');
  });

  it('a built match names a sub-nation seat by the province only', () => {
    const built = createMatch(world, { ...config('USA'), aiNations: 4 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const subs = built.match.seats.filter((s) => s.subNation !== undefined);
    expect(subs.length).toBeGreaterThanOrEqual(2);
    for (const s of subs) {
      expect(s.identity.kind).toBe('country');
      if (s.identity.kind === 'country') expect(s.identity.nameEn).not.toContain('United States');
    }
  });

  it('the label with the country follows the language: USA in Swedish, United States of America in English', () => {
    const usa = country('USA');
    const sub = membersOf(world.data.federations ?? null, usa)[0]!;
    expect(subNationLabel(sub, usa, 'sv')).toBe(`${subNationName(sub)} (${usa.nameSv})`);
    expect(subNationLabel(sub, usa, 'en')).toBe(`${subNationName(sub)} (${usa.nameEn})`);
    expect(usa.nameSv).not.toBe(usa.nameEn);
  });
});

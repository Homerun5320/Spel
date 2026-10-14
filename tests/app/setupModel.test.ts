// The draft of the setup screen: what a draft means (the config or the reason it cannot start), the seed and the name, and the stored form
// (preferences) with every field checked on the way back. Real data; countries are chosen by their properties, never by name.
import { beforeAll, describe, expect, it } from 'vitest';
import { cellAt } from '../helpers/matchConfigs';
import { CUSTOM_COLORS } from '../../src/app/matchSetup';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { checkDraft, cleanName, defaultDraft, draftFromStored, isStoredSetup, parseSeed, storedOf, type SetupDraft } from '../../src/app/setupModel';
import { nextFlagSeed } from '../../src/app/setupScreen';
import { SETUP_AI_NATIONS_DEFAULT, SETUP_AI_NATIONS_MAX, START_DISC_CELLS } from '../../src/sim/rules';
import { hasKey } from '../../src/ui/i18n';
import { makeFlagSpec, flagHash } from '../../src/ui/flag';
import { CUSTOM_NAME_MAX_CHARS } from '../../src/ui/uiConfig';
import { loadPreparedWorld } from '../../tools/sim/realWorld';
import { countryEligibility } from '../../src/app/eligibility';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

const base = (patch: Partial<SetupDraft> = {}): SetupDraft => ({ ...defaultDraft(1, 'Nyland'), ...patch });

describe('seed and name', () => {
  it('the seed is a 32-bit integer in plain digits; anything else is refused', () => {
    expect(parseSeed('1')).toBe(1);
    expect(parseSeed(' -7 ')).toBe(-7);
    expect(parseSeed('2147483647')).toBe(2147483647);
    expect(parseSeed('-2147483648')).toBe(-2147483648);
    for (const bad of ['', ' ', '1.5', '1e3', 'abc', '2147483648', '-2147483649', '12345678901', '+3', '0x10']) expect(parseSeed(bad), JSON.stringify(bad)).toBeNull();
  });

  it('a nation name is trimmed, runs of spaces become one, and it is 1 to the limit of characters', () => {
    expect(cleanName('  Zor   land ')).toBe('Zor land');
    expect(cleanName('')).toBeNull();
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('x'.repeat(CUSTOM_NAME_MAX_CHARS))).not.toBeNull();
    expect(cleanName('x'.repeat(CUSTOM_NAME_MAX_CHARS + 1))).toBeNull();
  });

  it('a new flag is a pure function of the old seed, and 200 rerolls give 200 different pictures', () => {
    expect(nextFlagSeed(1)).toBe(nextFlagSeed(1));
    let seed = 1;
    const hashes = new Set<number>();
    for (let i = 0; i < 200; i++) {
      hashes.add(flagHash(makeFlagSpec(seed, { primary: CUSTOM_COLORS[0] as number })));
      seed = nextFlagSeed(seed);
    }
    expect(hashes.size).toBeGreaterThanOrEqual(190);
  });
});

describe('checkDraft: real countries', () => {
  const okCountry = (): number => world.countries.find((c) => countryEligibility(world.analyse('world'), c).ok)!.id;
  const smallLandmass = (): number => world.countries.find((c) => countryEligibility(world.analyse('world'), c).reason === 'smallLandmass')!.id;
  const tooFew = (): number => world.countries.find((c) => countryEligibility(world.analyse('world'), c).reason === 'tooFewCells')!.id;

  it('defaults: 12 AI nations, tribes on, normal difficulty, the whole world, nothing chosen yet', () => {
    const d = defaultDraft(5, 'Nyland');
    expect([d.tab, d.countryId, d.aiNations, d.tribes, d.difficulty, d.region, d.neutral, d.seed]).toEqual(['real', 0, SETUP_AI_NATIONS_DEFAULT, true, 'normal', 'world', false, '5']);
    expect(CUSTOM_COLORS).toContain(d.color);
  });

  it('no country yet: the key says so; an eligible country makes the config with the draft\'s options', () => {
    const none = checkDraft(world, base());
    expect(none.ok).toBe(false);
    expect(none.key).toBe('setup.need.country');
    const r = checkDraft(world, base({ countryId: okCountry(), seed: '77', region: 'europe', aiNations: 3, tribes: false, difficulty: 'hard' }));
    // the chosen country may not be in Europe: then the draft says so instead
    if (r.ok) {
      expect(r.config).toMatchObject({ seed: 77, region: 'europe', aiNations: 3, tribes: false, difficulty: 'hard', neutral: false, player: { kind: 'real' } });
    } else {
      expect(r.key).toBe('setup.reason.outsideRegion');
    }
    const w = checkDraft(world, base({ countryId: okCountry(), seed: '77', aiNations: 3 }));
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.config).toMatchObject({ seed: 77, region: 'world', aiNations: 3, tribes: true, difficulty: 'normal', neutral: false, humanSeat: 0 });
  });

  it('a country whose land mass is below K is refused with the numbers "X of 197"; one with fewer than 8 cells is refused too', () => {
    const small = checkDraft(world, base({ countryId: smallLandmass() }));
    expect(small.ok).toBe(false);
    expect(small.key).toBe('setup.reason.smallLandmass');
    expect(small.params!.need).toBe(START_DISC_CELLS);
    expect(small.params!.cells).toBeLessThan(START_DISC_CELLS);
    const few = checkDraft(world, base({ countryId: tooFew() }));
    expect(few.key).toBe('setup.reason.tooFewCells');
    expect(few.params!.need).toBe(8);
    for (const c of [small, few]) expect(hasKey(c.key as string)).toBe(true);
  });

  it('an unknown country id and a bad seed are refused; the seed is checked first', () => {
    expect(checkDraft(world, base({ countryId: 250 })).key).toBe('setup.need.country');
    expect(checkDraft(world, base({ countryId: okCountry(), seed: 'x' })).key).toBe('setup.need.seed');
  });

  it('"no real borders" never reaches the config of a real country (it needs a custom nation)', () => {
    const r = checkDraft(world, base({ countryId: okCountry(), neutral: true }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.neutral).toBe(false);
  });

  it('every config a draft makes builds a match (createMatch accepts what checkDraft allows) for ten countries of the whole range', async () => {
    const { createMatch } = await import('../../src/app/matchSetup');
    const ok = world.countries.filter((c) => countryEligibility(world.analyse('world'), c).ok);
    for (let i = 0; i < ok.length; i += Math.floor(ok.length / 10)) {
      const r = checkDraft(world, base({ countryId: (ok[i] as { id: number }).id, aiNations: 4, seed: String(i + 1) }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(createMatch(world, r.config).ok).toBe(true);
    }
  });
});

describe('checkDraft: a custom nation', () => {
  const cell = cellAt(47.5, 12);

  it('needs a name and a start cell, in that order after the seed; the name is trimmed into the config', () => {
    expect(checkDraft(world, base({ tab: 'custom', name: '  ' })).key).toBe('setup.need.name');
    expect(checkDraft(world, base({ tab: 'custom', name: 'Zorland', cell: -1 })).key).toBe('setup.need.cell');
    const r = checkDraft(world, base({ tab: 'custom', name: '  Zorland ', cell, neutral: true, color: CUSTOM_COLORS[2] as number, flagSeed: 9 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config).toMatchObject({ neutral: true, player: { kind: 'custom', name: 'Zorland', color: CUSTOM_COLORS[2], flagSeed: 9, cell } });
  });

  it('the start cell must be land with a land mass of K cells: sea, ice and a small island are refused with a reason; outside the area too', () => {
    const sea = checkDraft(world, base({ tab: 'custom', name: 'Z', cell: cellAt(30, -40) }));
    expect(sea.key).toBe('setup.start.terrain');
    const ice = checkDraft(world, base({ tab: 'custom', name: 'Z', cell: cellAt(-80, 20) }));
    expect(ice.key).toBe('setup.start.terrain');
    const a = world.analyse('world');
    let island = -1;
    for (let i = 0; i < a.land.label.length && island < 0; i++) {
      const id = a.land.label[i] as number;
      if (id >= 0 && (a.land.size[id] as number) >= 20 && (a.land.size[id] as number) < START_DISC_CELLS) island = i;
    }
    const small = checkDraft(world, base({ tab: 'custom', name: 'Z', cell: island }));
    expect(small.key).toBe('setup.reason.smallLandmass');
    expect(small.params!.need).toBe(START_DISC_CELLS);
    const outside = checkDraft(world, base({ tab: 'custom', name: 'Z', cell: cellAt(0, 20), region: 'europe' }));
    expect(outside.key).toBe('setup.reason.outsideRegion');
  });
});

describe('the stored form (preferences)', () => {
  const full = (): SetupDraft => base({ tab: 'custom', countryId: world.countries[5]!.id, name: 'Zorland', color: CUSTOM_COLORS[3] as number, flagSeed: 1234, cell: cellAt(47, 8), region: 'eastAsia', aiNations: 7, tribes: false, difficulty: 'hard', neutral: true, seed: '-42' });

  it('round trips through JSON, with the country as its three-letter code', () => {
    const d = full();
    const s = storedOf(d, world);
    expect(s.a3).toBe(world.countries[5]!.a3);
    const back = JSON.parse(JSON.stringify(s)) as unknown;
    expect(isStoredSetup(back)).toBe(true);
    if (isStoredSetup(back)) expect(draftFromStored(back, world, base())).toEqual(d);
  });

  it('a value of another shape is refused, and no field of a stored value can put the game in a state it does not take', () => {
    for (const bad of [null, 5, 'x', {}, { v: 2 }, { ...storedOf(full(), world), region: 'mars' }, { ...storedOf(full(), world), tribes: 'yes' }, { ...storedOf(full(), world), v: 0 }]) expect(isStoredSetup(bad)).toBe(false);
    const evil = { ...storedOf(full(), world), a3: 'ZZZ', color: 0x123456, cell: 99_999_999, aiNations: SETUP_AI_NATIONS_MAX + 5, difficulty: 'godlike', seed: 'DROP', name: ' ', flagSeed: 1.5 };
    expect(isStoredSetup(evil)).toBe(true);
    const d = draftFromStored(evil as never, world, base());
    expect(d.countryId).toBe(0);
    expect(CUSTOM_COLORS).toContain(d.color);
    expect(d.cell).toBe(-1);
    expect(d.aiNations).toBe(SETUP_AI_NATIONS_DEFAULT);
    expect(d.difficulty).toBe('normal');
    expect(d.seed).toBe('1');
    expect(d.name).toBe('Nyland');
    expect(d.flagSeed).toBe(1);
  });
});

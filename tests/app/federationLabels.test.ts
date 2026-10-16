// M18b-3: the federation labels of a built match (one flag per FEDERATION, the country's name) and the sim groups of the same match.
import { beforeAll, describe, expect, it } from 'vitest';
import { type PreparedWorld } from '../../src/app/matchWorld';
import { createMatch, matchSetupConfig, type BuiltMatch, type MatchSetupConfig } from '../../src/app/matchSetup';
import { federationRoots } from '../../src/sim/groups';
import { flagHash } from '../../src/ui/flag';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

const id = (a3: string): number => world.countries.find((c) => c.a3 === a3)?.id as number;
function build(a3: string, options: Partial<MatchSetupConfig> = {}): BuiltMatch {
  const r = createMatch(world, matchSetupConfig({ kind: 'real', countryId: id(a3) }, { seed: 5, tribes: false, aiNations: 4, win: null, ...options }));
  if (!r.ok) throw new Error(`refused: ${r.error.code} ${r.error.key}`);
  return r.match;
}

describe('federation labels and groups of a built match', () => {
  it('one labelled federation per group with the country name and its own flag, the same for the same seed; none without the option', () => {
    const m = build('USA', { federations: true });
    expect(m.labels.federations.length).toBe(m.federationGroups.length);
    const f0 = m.labels.federations[0];
    expect(f0?.seats).toEqual(m.federationGroups[0]);
    expect(f0?.nameEn).toBe('United States of America');
    for (const s of f0?.seats ?? []) expect(m.labels.federationOf(s)).toBe(0);
    expect(m.labels.federationName(0, 'en')).toBe('United States of America');
    // the federation flag is not the flag of any member, and is stable
    const memberFlags = (f0?.seats ?? []).map((s) => flagHash(m.labels.flag(s) as NonNullable<ReturnType<typeof m.labels.flag>>));
    expect(memberFlags).not.toContain(flagHash(f0!.flag));
    expect(flagHash(build('USA', { federations: true }).labels.federations[0]!.flag)).toBe(flagHash(f0!.flag));
    const plain = build('USA');
    expect(plain.labels.federations).toEqual([]);
    expect(federationRoots(plain.state)).toBeNull();
  });

  it('the sim groups of the built state are exactly the federation groups (root = lowest ownerId)', () => {
    const m = build('USA', { federations: true });
    const roots = federationRoots(m.state);
    expect(roots).not.toBeNull();
    for (const g of m.federationGroups) {
      const root = Math.min(...g) + 1;
      for (const s of g) expect(roots?.[s + 1]).toBe(root);
    }
    const inGroup = new Set(m.federationGroups.flat());
    for (let s = 0; s < m.players; s++) if (!inGroup.has(s)) expect(roots?.[s + 1]).toBe(s + 1);
  });
});

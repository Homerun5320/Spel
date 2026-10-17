// Names of the nations (M06): the custom name is validated after trimming, the invented names of the neutral mode never repeat and never
// equal the custom name, and the generator itself skips the names that are taken.
import { beforeAll, describe, expect, it } from 'vitest';
import { inventName } from '../../src/app/inventedNames';
import { createMatch, matchSetupConfig, type BuiltMatch, type MatchSetupConfig, type PlayerChoice } from '../../src/app/matchSetup';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { createRng } from '../../src/sim/public';
import { SETUP_AI_NATIONS_MAX } from '../../src/sim/rules';
import { CUSTOM_NAME_MAX_CHARS } from '../../src/ui/uiConfig';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

const cellAt = (lat: number, lon: number): number => Math.floor(((90 - lat) / 180) * 512) * 1024 + Math.floor(((lon + 180) / 360) * 1024);
const custom = (name: string): PlayerChoice => ({ kind: 'custom', name, color: 0x336699, flagSeed: 3, cell: cellAt(50, 10) });
const neutral = (name: string, seed: number, aiNations: number): MatchSetupConfig => matchSetupConfig(custom(name), { seed, aiNations, neutral: true, tribes: false });

function inventedNames(m: BuiltMatch): string[] {
  const out: string[] = [];
  for (const s of m.seats) if (s.kind === 'ai' && s.identity.kind === 'invented') out.push(s.identity.name);
  return out;
}

describe('the custom name is checked after trimming', () => {
  const opts = { aiNations: 0, tribes: false } as const;

  it('a name of only whitespace is refused as an invalid player.name, an empty one too', () => {
    for (const name of ['', ' ', '   ', '\t\n ', '  ']) {
      const r = createMatch(world, matchSetupConfig(custom(name), opts));
      expect(r.ok, JSON.stringify(name)).toBe(false);
      if (!r.ok) expect(r.error, JSON.stringify(name)).toMatchObject({ code: 'invalid', params: { field: 'player.name' } });
    }
  });

  it('the longest allowed name is accepted, one more character is refused, and the limit counts the trimmed name', () => {
    const max = 'x'.repeat(CUSTOM_NAME_MAX_CHARS);
    expect(createMatch(world, matchSetupConfig(custom(max), opts)).ok).toBe(true);
    const r = createMatch(world, matchSetupConfig(custom(`${max}x`), opts));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'invalid', params: { field: 'player.name' } });
    // padding does not count, and the stored identity is the trimmed name
    const padded = createMatch(world, matchSetupConfig(custom(`   ${max}   `), opts));
    expect(padded.ok).toBe(true);
    if (padded.ok) expect(padded.match.seats[0]?.identity).toEqual({ kind: 'custom', name: max });
  });
});

describe('inventName', () => {
  it('is seeded: the same stream gives the same names', () => {
    const a = createRng(5);
    const b = createRng(5);
    const na = [inventName(a, new Set()), inventName(a, new Set())];
    const nb = [inventName(b, new Set()), inventName(b, new Set())];
    expect(na).toEqual(nb);
  });

  it('never returns a name in `taken`, even when it is asked for far more names than a match needs', () => {
    const rng = createRng(9);
    const taken = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const name = inventName(rng, taken);
      expect(taken.has(name), `${i} ${name}`).toBe(false);
      taken.add(name);
    }
    expect(taken.size).toBe(4000);
  });

  it('skips a name that is taken: the first name of a stream is not returned when it is in `taken`', () => {
    const first = inventName(createRng(21), new Set());
    const second = inventName(createRng(21), new Set([first]));
    expect(second).not.toBe(first);
  });
});

describe('the invented names of the neutral mode', () => {
  it('24 AI nations get 24 distinct names, for 60 seeds', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = createMatch(world, neutral('Zorland', seed, SETUP_AI_NATIONS_MAX));
      expect(r.ok, `seed ${seed}`).toBe(true);
      if (!r.ok) continue;
      const names = inventedNames(r.match);
      expect(names.length, `seed ${seed}`).toBe(SETUP_AI_NATIONS_MAX);
      expect(new Set(names).size, `seed ${seed}: ${names.join(', ')}`).toBe(names.length);
      expect(names, `seed ${seed}`).not.toContain('Zorland');
    }
  });

  it('an invented name never equals the custom name, even when you type exactly the name the generator would give first (padding included)', () => {
    const probe = createMatch(world, neutral('Zorland', 4, 3));
    expect(probe.ok).toBe(true);
    if (!probe.ok) return;
    const wanted = inventedNames(probe.match)[0] as string;
    for (const typed of [wanted, `  ${wanted} `]) {
      const r = createMatch(world, neutral(typed, 4, 3));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const names = inventedNames(r.match);
      expect(names.length).toBe(3);
      expect(names).not.toContain(wanted);
      expect(new Set(names).size).toBe(3);
    }
  });
});

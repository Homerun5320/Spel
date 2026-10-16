// M12b: `npm run sim:scenario -- heli-raid --fixture <alps|plains-sam|ridge-sam> --seed N`: one smoke run per fixture, the same arguments print the same bytes
// (in this process and in the real npm script), and bad arguments are refused.
import { describe, expect, it } from 'vitest';
import { heliRaid, parseHeliRaidArgs } from '../../tools/sim/heliRaid';
import { runTsxScript } from '../helpers/nodeScripts';

describe('heli-raid', () => {
  for (const fixture of ['alps', 'plains-sam', 'ridge-sam'] as const) {
    it(`${fixture}: one raid prints tick, state, position, altitude, exposure and the events, and the same seed prints the same bytes`, async () => {
      const args = parseHeliRaidArgs(['--fixture', fixture, '--seed', '4']);
      const a = await heliRaid(args);
      const b = await heliRaid(args);
      expect(b).toBe(a);
      const lines = a.split('\n');
      expect(lines[0]).toBe(`heli-raid fixture=${fixture} seed=4 mode=low`);
      expect(lines.some((l) => /^tick \d+ cruise pos=\(\d+\.\d,\d+\.\d\) alt=\d+m hp=\d+ exp=[D-][P-]/.test(l))).toBe(true);
      expect(lines.some((l) => l.includes('launched'))).toBe(true);
      expect(lines[lines.length - 1]).toMatch(/^result: (landed|downed) cells=\d cause=\S+ \| state hash [0-9a-f]{8}$/);
    });
  }

  it('the plains replay shows a SAM covering the approach (exposure D) and, for another seed, a different history', async () => {
    const a = await heliRaid(parseHeliRaidArgs(['--fixture', 'plains-sam', '--seed', '1']));
    const b = await heliRaid(parseHeliRaidArgs(['--fixture', 'plains-sam', '--seed', '2']));
    expect(b).not.toBe(a);
    expect(a.split('\n').some((l) => /exp=D-.*DOWNED cause=SAM/.test(l))).toBe(true); // the kill happens inside the coverage of the site that fired
    const ridge = await heliRaid(parseHeliRaidArgs(['--fixture', 'ridge-sam', '--seed', '1']));
    expect(ridge.split('\n').some((l) => /exp=D-/.test(l))).toBe(false); // Low behind the ridge is never covered
    expect(ridge.split('\n').some((l) => /landed cells=\d/.test(l))).toBe(true);
  });

  it('--mode high and --trials print the statistics', async () => {
    const stats = await heliRaid(parseHeliRaidArgs(['--fixture', 'ridge-sam', '--seed', '1', '--mode', 'high', '--trials', '10']));
    expect(stats.split('\n')[0]).toBe('heli-raid fixture=ridge-sam seed=1 mode=high trials=10');
    expect(stats).toMatch(/success \d+\/10 = [\d.]+% \| downed by SAM \d+, Post 0, fuel 0$/);
  });

  it('the real npm script prints the same text as the function, and a bad argument fails with a message', async () => {
    const r = runTsxScript('sim:scenario', ['heli-raid', '--fixture', 'ridge-sam', '--seed', '4']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(await heliRaid(parseHeliRaidArgs(['--fixture', 'ridge-sam', '--seed', '4'])));
    const bad = runTsxScript('sim:scenario', ['heli-raid', '--fixture', 'moon']);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/--fixture/);
  }, 60_000);

  it('rejects bad arguments', () => {
    expect(() => parseHeliRaidArgs([])).toThrow(/--fixture is required/);
    expect(() => parseHeliRaidArgs(['--fixture', 'alps', '--seed', 'x'])).toThrow(/--seed/);
    expect(() => parseHeliRaidArgs(['--fixture', 'alps', '--mode', 'mid'])).toThrow(/--mode/);
    expect(() => parseHeliRaidArgs(['--fixture', 'alps', '--trials', '0'])).toThrow(/--trials/);
    expect(() => parseHeliRaidArgs(['--bogus'])).toThrow(/unknown argument/);
  });
});

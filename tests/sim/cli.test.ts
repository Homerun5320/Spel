// `npm run sim:run -- --seed N --ticks T` prints the hashes at ticks 1/10/100/1000/6000 and the final one.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { format, parseArgs, run } from '../../tools/sim/run';
import { readGolden } from '../helpers/simGolden';

describe('sim:run', () => {
  it('prints the committed golden hashes for the golden seed and 6000 ticks (the real npm script, a child process)', () => {
    const golden = readGolden();
    const r = spawnSync('npm', ['run', '-s', 'sim:run', '--', '--seed', String(golden.seed), '--ticks', '6000', '--canary'], { encoding: 'utf8', cwd: process.cwd() });
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.trim().split('\n');
    for (const t of golden.ticks) expect(lines).toContain(`tick ${t}: ${golden.hashes[String(t)]}`);
    expect(lines.some((l) => l.startsWith(`final tick 6000: ${golden.hashes['6000']} `))).toBe(true);
    expect(lines).toContain(`canary: ${golden.canary.hash}`);
    expect(lines[0]).toContain(`mapHash=${golden.mapHash}`);
  }, 60_000);

  it('prints only the tick points up to --ticks and then the final hash', () => {
    const rep = run(parseArgs(['--seed', '1', '--ticks', '50']));
    expect(rep.hashes.map((h) => h.tick)).toEqual([1, 10]);
    expect(rep.final.tick).toBe(50);
    const golden = readGolden();
    expect(rep.hashes[1]?.hash).toBe(golden.hashes['10']);
    expect(format(rep)).toContain('final tick 50:');
  });

  it('another seed gives other hashes; --ticks 0 gives just the final line', () => {
    const a = run(parseArgs(['--seed', '2', '--ticks', '1000']));
    expect(a.hashes[3]?.hash).not.toBe(readGolden().hashes['1000']);
    const z = run(parseArgs(['--ticks', '0']));
    expect(z.hashes).toEqual([]);
    expect(z.final.tick).toBe(0);
  });

  it('rejects bad arguments with a message', () => {
    expect(() => parseArgs(['--seed'])).toThrow(/--seed/);
    expect(() => parseArgs(['--ticks', 'abc'])).toThrow(/--ticks/);
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/);
    const r = spawnSync('npm', ['run', '-s', 'sim:run', '--', '--ticks', 'x'], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--ticks/);
  }, 30_000);
});

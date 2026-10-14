// The headless scenario runner on the real world: arguments, reproducibility, the territory curves, snapshots with territory
// active, and the npm script.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { format, parseArgs, runScenario } from '../../tools/sim/scenario';
import { startRealMatch } from '../helpers/realMatch';

describe('sim:scenario arguments', () => {
  it('defaults: seed 1, 10 minutes, 12 players, 20 tribes, the players fight; --no-fighters keeps them to unowned land', () => {
    const a = parseArgs([]);
    expect([a.seed, a.minutes, a.players, a.tribes, a.solo, a.fighters]).toEqual([1, 10, 12, 20, false, true]);
    expect(parseArgs(['--no-fighters']).fighters).toBe(false);
  });
  it('--solo means one player and no tribes; numbers are checked', () => {
    const a = parseArgs(['--solo', '--minutes', '3', '--country', 'SWE']);
    expect([a.players, a.tribes, a.minutes, a.country]).toEqual([1, 0, 3, 'SWE']);
    expect(() => parseArgs(['--minutes', '0'])).toThrow(/--minutes/);
    expect(() => parseArgs(['--players', 'x'])).toThrow(/--players/);
    expect(() => parseArgs(['--seed'])).toThrow(/--seed/);
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/);
    expect(() => parseArgs(['--players', '200', '--tribes', '100'])).toThrow(/255/);
  });
});

describe('sim:scenario on the real world', () => {
  it('is reproducible and depends on the seed; the curves grow; all seats own land', async () => {
    const args = parseArgs(['--seed', '3', '--minutes', '2', '--players', '4', '--tribes', '6']);
    const a = await runScenario(args);
    const b = await runScenario(args);
    expect(a.report.finalHash).toBe(b.report.finalHash);
    expect(a.report.rows).toEqual(b.report.rows);
    const c = await runScenario(parseArgs(['--seed', '4', '--minutes', '2', '--players', '4', '--tribes', '6']));
    expect(c.report.finalHash).not.toBe(a.report.finalHash);
    expect(a.report.rows.length).toBe(2);
    // With fighters a player can be eaten within the minute since the tempo pass (D142: the conquest is 3 to 4 times as fast), so the
    // "every curve grows" property is checked on the run where the players only expand; with fighters the land owned in total grows.
    const peaceful = await runScenario(parseArgs(['--seed', '3', '--minutes', '2', '--players', '4', '--tribes', '6', '--no-fighters']));
    const [m1, m2] = peaceful.report.rows;
    for (let seat = 0; seat < 10; seat++) {
      expect(m1?.cells[seat] as number).toBeGreaterThan(197);
      expect(m2?.cells[seat] as number).toBeGreaterThan(m1?.cells[seat] as number);
    }
    const total = (cells: number[] | undefined): number => (cells ?? []).reduce((x, y) => x + y, 0);
    expect(total(a.report.rows[1]?.cells)).toBeGreaterThan(total(a.report.rows[0]?.cells));
    const text = format(a.report);
    expect(text).toContain('min  1:');
    expect(text).toContain('min  2:');
    expect(text).toContain('final hash');
  }, 60000);

  it('a snapshot taken in the middle of a 12 + 20 match (attacks, frontiers, enclave queue, economy) resumes into the straight run', async () => {
    const straight = await startRealMatch(2, 12, 20, true);
    const first = await startRealMatch(2, 12, 20, true);
    for (let t = 0; t < 900; t++) {
      straight.tick();
      first.tick();
    }
    expect(first.state.attacks.list.length).toBeGreaterThan(10);
    expect(first.state.enclaves.length).toBeGreaterThan(0);
    const r = deserialize(serialize(first.state));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(first.state));
    first.swap(r.state);
    for (let t = 900; t < 1500; t++) {
      straight.tick();
      first.tick();
      if (t % 100 === 0) expect(hashState(first.state), `tick ${t}`).toBe(hashState(straight.state));
    }
    expect(hashState(first.state)).toBe(hashState(straight.state));
    expect(Array.from(first.state.agg.area)).toEqual(Array.from(straight.state.agg.area));
  }, 120000);

  it('the npm script prints the table (a child process)', () => {
    const r = spawnSync('npm', ['run', '-s', 'sim:scenario', '--', '--seed', '1', '--minutes', '1', '--players', '3', '--tribes', '2'], { encoding: 'utf8', cwd: process.cwd() });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('sim:scenario seed=1 minutes=1 players=3 tribes=2');
    expect(r.stdout).toContain('min  1:');
    const bad = spawnSync('npm', ['run', '-s', 'sim:scenario', '--', '--minutes', 'x'], { encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/--minutes/);
  }, 60000);
});

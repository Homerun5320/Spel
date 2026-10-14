// The pace report (tools/sim/pace.ts, tempo pass D142): its pure parts, the scripted human, and the report on the real world.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { SimView } from '../../src/sim/public';
import { PHASE_PLAY, PHASE_SPAWN } from '../../src/sim/public';
import { HumanBot, DEFAULT_HUMAN_BOT } from '../../tools/sim/humanBot';
import {
  GUARD_ALIVE_MINUTE3_PCT,
  GUARD_TOP_SHARE_MINUTE10,
  evaluateMatchGuards,
  evaluatePassiveGuard,
  formatTable,
  median,
  medianOrNull,
  parseArgs,
  secondsText,
  secondsToReach,
  sharePct,
  type MatchSample,
} from '../../tools/sim/paceMath';
import { CONQUEST_CAP_SECONDS, formatConquest, runConquest, type ConquestRow } from '../../tools/sim/pace';

describe('paceMath: statistics', () => {
  it('median: the middle value, the mean of the two middle ones, one decimal, NaN for nothing; the input is not changed', () => {
    const xs = [5, 1, 3];
    expect(median(xs)).toBe(3);
    expect(xs).toEqual([5, 1, 3]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([1, 2])).toBe(1.5);
    expect(median([1, 2, 2.04])).toBe(2);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('medianOrNull: null when most runs did not reach the goal', () => {
    expect(medianOrNull([10, 20, null])).toBe(15);
    expect(medianOrNull([10, null, null])).toBeNull();
    expect(medianOrNull([10, 20, null, null])).toBeNull();
    expect(medianOrNull([])).toBeNull();
  });

  it('secondsToReach: linear between two samples, the first sample if it is already there, null if never', () => {
    const series = [
      { t: 0, v: 0 },
      { t: 10, v: 100 },
      { t: 20, v: 150 },
    ];
    expect(secondsToReach(series, 50)).toBe(5);
    expect(secondsToReach(series, 100)).toBe(10);
    expect(secondsToReach(series, 125)).toBe(15);
    expect(secondsToReach(series, 150)).toBe(20);
    expect(secondsToReach(series, 151)).toBeNull();
    expect(secondsToReach(series, 0)).toBe(0);
    expect(secondsToReach([], 1)).toBeNull();
    // a flat step (no growth between two samples) cannot divide by zero
    expect(secondsToReach([{ t: 0, v: 5 }, { t: 4, v: 5 }, { t: 8, v: 5 }], 5)).toBe(0);
    expect(secondsToReach([{ t: 0, v: 0 }, { t: 4, v: 0 }, { t: 8, v: 5 }], 5)).toBe(8);
  });

  it('sharePct and secondsText', () => {
    expect(sharePct(1, 3)).toBe(33.3);
    expect(sharePct(0, 100)).toBe(0);
    expect(sharePct(5, 0)).toBe(0);
    expect(secondsText(74.4, 900)).toBe('74');
    expect(secondsText(null, 900)).toBe('>900');
  });
});

describe('paceMath: the table and the arguments', () => {
  it('formatTable: a header, a rule, the rows; the first column left, the others right aligned', () => {
    const text = formatTable(['name', 'a', 'bb'], [['x', '1', '22'], ['long name', '333', '4']]);
    expect(text.split('\n')).toEqual(['name         a  bb', '---------  ---  --', 'x            1  22', 'long name  333   4']);
  });

  it('parseArgs: the defaults (all parts, seeds 1 to 5, 15 minutes, both setups) and the options', () => {
    const d = parseArgs([]);
    expect([d.parts, d.seeds, d.minutes, d.json, d.setups]).toEqual([['solo', 'conquest', 'match'], [1, 2, 3, 4, 5], 15, false, ['play', 'skirmish']]);
    const a = parseArgs(['--part', 'match,solo', '--seeds', '7,-3', '--minutes', '4', '--setup', 'skirmish', '--json']);
    expect([a.parts, a.seeds, a.minutes, a.json, a.setups]).toEqual([['match', 'solo'], [7, -3], 4, true, ['skirmish']]);
  });

  it('parseArgs: bad input is an error with the name of the flag', () => {
    expect(() => parseArgs(['--part', 'x'])).toThrow(/--part/);
    expect(() => parseArgs(['--part'])).toThrow(/--part/);
    expect(() => parseArgs(['--seeds', '1,a'])).toThrow(/--seeds/);
    expect(() => parseArgs(['--seeds'])).toThrow(/--seeds/);
    expect(() => parseArgs(['--minutes', '0'])).toThrow(/--minutes/);
    expect(() => parseArgs(['--minutes', '61'])).toThrow(/--minutes/);
    expect(() => parseArgs(['--setup', 'big'])).toThrow(/--setup/);
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/);
  });
});

function sample(minute: number, p: Partial<MatchSample> = {}): MatchSample {
  return { minute, topShare: 5, topAiShare: 5, humanShare: 3, nationsAlive: 5, nations: 5, tribesAlive: 20, tribes: 20, humanAlive: true, freeShare: 50, ...p };
}

describe('paceMath: the guard rails', () => {
  it('pass when nobody runs away and almost everybody is alive at minute 3', () => {
    const guards = evaluateMatchGuards([[sample(3), sample(10)], [sample(3), sample(10, { topAiShare: GUARD_TOP_SHARE_MINUTE10 })]]);
    expect(guards.map((g) => g.pass)).toEqual([true, true, true]);
  });

  it('fail on the worst seed: a leader above the share, too few nations or tribes alive', () => {
    const ok = [sample(3), sample(10)];
    expect(evaluateMatchGuards([ok, [sample(3), sample(10, { topAiShare: GUARD_TOP_SHARE_MINUTE10 + 0.1 })]])[0]?.pass).toBe(false);
    // 75 % of 12 nations is 9: 9 pass, 8 fail
    const nations = (alive: number): MatchSample[] => [sample(3, { nationsAlive: alive, nations: 12 }), sample(10)];
    expect(evaluateMatchGuards([ok, nations(9)])[1]?.pass).toBe(true);
    expect(evaluateMatchGuards([ok, nations(8)])[1]?.pass).toBe(false);
    const tribes = (alive: number): MatchSample[] => [sample(3, { tribesAlive: alive, tribes: 20 }), sample(10)];
    expect(evaluateMatchGuards([ok, tribes(15)])[2]?.pass).toBe(true);
    expect(evaluateMatchGuards([ok, tribes(14)])[2]?.pass).toBe(false);
    expect(GUARD_ALIVE_MINUTE3_PCT).toBe(75);
  });

  it('a seed without a sample at minute 10 fails the share guard instead of passing by accident (NaN)', () => {
    expect(evaluateMatchGuards([[sample(3)]])[0]?.pass).toBe(false);
  });

  it('a match without tribes cannot fail the tribe guard', () => {
    expect(evaluateMatchGuards([[sample(3, { tribes: 0, tribesAlive: 0 }), sample(10)]])[2]?.pass).toBe(true);
  });

  it('the passive guard fails when the human is wiped out in any seed', () => {
    expect(evaluatePassiveGuard([true, true, true]).pass).toBe(true);
    const bad = evaluatePassiveGuard([true, false, true]);
    expect(bad.pass).toBe(false);
    expect(bad.detail).toContain('2 of 3');
  });
});

/** A SimView stub for the scripted human: seats 0 (the human), 1 and 2; stats per seat; contact lengths from a table. */
function stubView(tick: number, p: { troops: number[]; cap: number[]; alive?: number[]; contact: Record<string, number>; phase?: number }): SimView {
  const n = p.troops.length;
  const stats = {
    seats: n,
    troopsQt: p.troops,
    capQt: p.cap,
    alive: p.alive ?? p.troops.map(() => 1),
    goldMilli: p.troops.map(() => 0),
    goldPerSecMilli: p.troops.map(() => 0),
    cells: p.troops.map(() => 100),
    landShareQ15: p.troops.map(() => 0),
    capital: p.troops.map(() => 1),
  };
  return {
    width: 1,
    height: 1,
    tick,
    seats: n,
    players: n,
    owner: [],
    ownerVersion: 0,
    terrainClass: [],
    stats,
    rejects: 0,
    phase: (p.phase ?? PHASE_PLAY) as SimView['phase'],
    phaseTicksLeft: 0,
    flow: true,
    debugIntents: false,
    contactLength: (a: number, b: number) => p.contact[`${Math.min(a, b)}-${Math.max(a, b)}`] ?? 0,
  };
}

describe('the scripted human (tools/sim/humanBot.ts)', () => {
  const bot = (): HumanBot => new HumanBot({ seat: 0, ...DEFAULT_HUMAN_BOT });
  /** The ticks on which the bot acts: (tick + 7) % 10 === 0. */
  const T = 3;

  it('acts once a second, on its own phase, in play only', () => {
    const view = (tick: number, phase?: number): SimView => stubView(tick, { troops: [1000, 1000], cap: [1000, 1000], contact: { '0-1': 9 }, phase });
    for (const [tick, phase, acts] of [[T, PHASE_PLAY, true], [T + 1, PHASE_PLAY, false], [T + 10, PHASE_PLAY, true], [T, PHASE_SPAWN, false]] as const) {
      const sent: unknown[] = [];
      bot().onTick(view(tick, phase), (b) => sent.push(b));
      expect(sent.length > 0, `tick ${tick} phase ${phase}`).toBe(acts);
    }
  });

  it('expands into free land at its expand share, at most once per cooldown', () => {
    const b = bot();
    const sent: Array<{ kind: string; target: number; pct: number }> = [];
    const submit = (x: unknown): void => void sent.push(x as { kind: string; target: number; pct: number });
    const at = (tick: number): SimView => stubView(tick, { troops: [1000, 1000], cap: [1000, 1000], contact: { '0-1': 9 } });
    b.onTick(at(T), submit);
    expect(sent).toEqual([{ kind: 'Attack', seat: 0, target: 0, pct: DEFAULT_HUMAN_BOT.expandPct }]);
    b.onTick(at(T + 10), submit);
    b.onTick(at(T + 20), submit);
    b.onTick(at(T + 30), submit);
    expect(sent).toHaveLength(1);
    b.onTick(at(T + 40), submit);
    expect(sent).toHaveLength(2);
  });

  it('keeps a reserve: below its share of the cap it does nothing', () => {
    const sent: unknown[] = [];
    const low = stubView(T, { troops: [399, 1000], cap: [1000, 1000], contact: { '0-1': 9 } });
    bot().onTick(low, (x) => sent.push(x));
    expect(sent).toEqual([]);
    const enough = stubView(T, { troops: [400, 1000], cap: [1000, 1000], contact: { '0-1': 9 } });
    bot().onTick(enough, (x) => sent.push(x));
    expect(sent).toHaveLength(1);
  });

  it('attacks the WEAKEST neighbour it outnumbers by the ratio, never a dead one, and waits out the war cooldown', () => {
    const b = bot();
    const sent: Array<{ target: number; pct: number }> = [];
    const submit = (x: unknown): void => void sent.push(x as { target: number; pct: number });
    // seats: 0 = me (1500), 1 = owner 2 with 1000 (too strong at 150 %), 2 = owner 3 with 900 (strong enough), 3 = owner 4 with 600 (weakest, but dead)
    const view = (tick: number): SimView => stubView(tick, { troops: [1500, 1000, 900, 600], cap: [2000, 2000, 2000, 2000], alive: [1, 1, 1, 0], contact: { '1-2': 5, '1-3': 5, '1-4': 5 } });
    b.onTick(view(T), submit);
    // the human has 1500; the ratio is 150 %, so only a neighbour with at most 1000 troops qualifies; owner 3 (900) is the weakest alive one
    expect(sent).toEqual([{ kind: 'Attack', seat: 0, target: 3, pct: DEFAULT_HUMAN_BOT.warPct }]);
    sent.length = 0;
    b.onTick(view(T + 10), submit);
    expect(sent.filter((x) => x.target === 3)).toEqual([]);
    b.onTick(view(T + 80), submit);
    expect(sent.some((x) => x.target === 3)).toBe(true);
  });

  it('does not attack a neighbour that is too strong', () => {
    const sent: unknown[] = [];
    bot().onTick(stubView(T, { troops: [1000, 1001], cap: [1000, 1000], contact: { '1-2': 5 } }), (x) => sent.push(x));
    expect(sent).toEqual([]);
  });
});

describe('the report on the real world', () => {
  it('a conquest run is deterministic, and committing everything beats one 40 % click, on a real border', async () => {
    const spec = { location: 'POL', mode: 'disc', defender: 'passive', seed: 1 } as const;
    const all = await runConquest({ ...spec, commitPct: 100 });
    const again = await runConquest({ ...spec, commitPct: 100 });
    expect(again).toEqual(all);
    const single = await runConquest({ ...spec, commitPct: 40, reissueTicks: 0 });
    expect(all.seconds).not.toBeNull();
    expect(all.defenderCells).toBe(197);
    expect(all.contact).toBeGreaterThan(0);
    // troop parity: the attacker has what the defender has
    expect(all.attackerTroops).toBe(all.defenderTroops);
    expect(single.seconds === null ? CONQUEST_CAP_SECONDS : single.seconds).toBeGreaterThan(all.seconds as number);
  }, 60000);

  it('formatConquest prints every row with its median and the start contacts', () => {
    const rows: ConquestRow[] = [{ mode: 'disc', commitPct: 100, defender: 'passive', clicks: 'repeat', seconds: [50, null, 70], median: 60, contacts: [1, 2, 3] }];
    const text = formatConquest(rows);
    expect(text).toContain('whole 197-cell disc');
    expect(text).toContain('>900');
    expect(text).toContain('start contact (sim cells) of the disc runs per location: 1 2 3');
  });

  it('the npm script prints the solo table (a child process)', () => {
    const r = spawnSync('npm', ['run', '-s', 'sim:pace', '--', '--part', 'solo'], { encoding: 'utf8', cwd: process.cwd() });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('solo (land cells)');
    expect(r.stdout).toContain('RUS');
    expect(r.stdout).toContain('median');
    const bad = spawnSync('npm', ['run', '-s', 'sim:pace', '--', '--part', 'nope'], { encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/--part/);
  }, 60000);
});

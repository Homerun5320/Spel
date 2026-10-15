// The pace report (tools/sim/pace.ts, tempo pass D142): its pure parts, the scripted human, and the report on the real world.
import { describe, expect, it } from 'vitest';
import type { SimView } from '../../src/sim/public';
import { PHASE_PLAY, PHASE_SPAWN } from '../../src/sim/public';
import { HumanBot, DEFAULT_HUMAN_BOT } from '../../tools/sim/humanBot';
import {
  GUARD_ALIVE_MINUTE3_PCT,
  GUARD_FROZEN_BY_MINUTE,
  GUARD_LATE_MINUTES,
  GUARD_PASSIVE_MINUTE,
  GUARD_TOP_SHARE_LATE,
  GUARD_TOP_SHARE_MINUTE10,
  evaluateMatchGuards,
  frozenAtMinute,
  evaluatePassiveGuard,
  formatTable,
  median,
  medianOrNull,
  minuteReaching,
  parseArgs,
  secondsText,
  secondsToReach,
  sharePct,
  type MatchSample,
} from '../../tools/sim/paceMath';
import {
  CONQUEST_CAP_SECONDS,
  CONQUEST_LOCATIONS,
  COUNTRY_CELLS,
  SOLO_MINUTES,
  formatConquest,
  passiveAlive,
  runConquest,
  runConquestTable,
  runMatch,
  runPace,
  runSolo,
  type ConquestRow,
} from '../../tools/sim/pace';
import { parseArgs as parseScenarioArgs, runScenario } from '../../tools/sim/scenario';
import { SOLO_BAND } from '../../tools/sim/bands';
import { runTsxScript } from '../helpers/nodeScripts';

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

  it('minuteReaching (D143): the minute a gold stock first reaches a price, linear between two minutes, 0 at minute 0, null when never', () => {
    const stock = [100, 300, 800];
    expect(minuteReaching(stock, 50)).toBe(0.5);
    expect(minuteReaching(stock, 100)).toBe(1);
    expect(minuteReaching(stock, 200)).toBe(1.5);
    expect(minuteReaching(stock, 800)).toBe(3);
    expect(minuteReaching(stock, 801)).toBeNull();
    expect(minuteReaching([], 1)).toBeNull();
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

  it('parseArgs: the defaults (all parts, seeds 1 to 5, 25 minutes since D143 so that the late-share guard has its minutes, play and skirmish) and the options', () => {
    const d = parseArgs([]);
    expect([d.parts, d.seeds, d.minutes, d.json, d.setups]).toEqual([['solo', 'conquest', 'match'], [1, 2, 3, 4, 5], 25, false, ['play', 'skirmish']]);
    const a = parseArgs(['--part', 'match,solo', '--seeds', '7,-3', '--minutes', '4', '--setup', 'skirmish', '--json']);
    expect([a.parts, a.seeds, a.minutes, a.json, a.setups]).toEqual([['match', 'solo'], [7, -3], 4, true, ['skirmish']]);
    expect(parseArgs(['--setup', 'asia,play']).setups).toEqual(['asia', 'play']);
    expect(d.prices).toEqual([1000, 2400, 7000, 20000]);
    expect(parseArgs(['--prices', '500,9000']).prices).toEqual([500, 9000]);
    expect(() => parseArgs(['--prices', '0'])).toThrow(/--prices/);
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
  /** A whole 25-minute run: free land falls by 2 points a minute, the top AI share is `top`, `over` replaces single minutes. */
  const run25 = (top = 12, over: Record<number, Partial<MatchSample>> = {}): MatchSample[] =>
    Array.from({ length: 25 }, (_, i) => sample(i + 1, { topAiShare: top, freeShare: 80 - 2 * i, ...over[i + 1] }));

  it('pass when nobody runs away and almost everybody is alive at minute 3', () => {
    const guards = evaluateMatchGuards([run25(), run25(GUARD_TOP_SHARE_MINUTE10)]);
    expect(guards.map((g) => g.pass)).toEqual([true, true, true, true, true]);
  });

  it('the late-share guard (D143): a leader above the share at minute 15, 20 or 25 fails, one at the bound passes, a run without those minutes fails instead of passing by accident', () => {
    expect(GUARD_LATE_MINUTES).toEqual([15, 20, 25]);
    const late = (m: number, share: number): boolean => evaluateMatchGuards([run25(12, { [m]: { topAiShare: share } })])[3]?.pass as boolean;
    for (const m of GUARD_LATE_MINUTES) {
      expect(late(m, GUARD_TOP_SHARE_LATE), `minute ${m} at the bound`).toBe(true);
      expect(late(m, GUARD_TOP_SHARE_LATE + 0.1), `minute ${m} above it`).toBe(false);
    }
    // minute 12 is not a late minute (minute 10 has its own guard)
    expect(late(12, 60)).toBe(true);
    const short = evaluateMatchGuards([run25().slice(0, 12)]);
    expect(short[3]?.pass).toBe(false);
    expect(short[3]?.detail).toContain('25 minutes');
  });

  it('the frozen-board guard (D143): free land above 10 % that does not change for 5 minutes by minute 20 fails; land under 10 %, a slow change and a freeze after minute 20 pass', () => {
    const flat = (from: number, to: number, free: number): Record<number, Partial<MatchSample>> =>
      Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, { freeShare: free }]));
    const frozen = (over: Record<number, Partial<MatchSample>>): boolean => evaluateMatchGuards([run25(12, over)])[4]?.pass === false;
    expect(frozen({})).toBe(false);
    // 30 % free from minute 12 to 18: a window of five minutes (13 to 18) is flat
    expect(frozen(flat(12, 18, 30))).toBe(true);
    expect(frozenAtMinute(run25(12, flat(12, 18, 30)))).toBe(17);
    // four flat minutes are not a window; a change of 0.2 in the window is a change
    expect(frozen(flat(12, 16, 30))).toBe(false);
    expect(frozen({ ...flat(12, 18, 30), 15: { freeShare: 30.2 } })).toBe(false);
    // under 10 % of free land the sea and the caps may settle the match
    expect(frozen(flat(10, 25, 9.5))).toBe(false);
    // a freeze that ends after minute 20 is allowed
    expect(GUARD_FROZEN_BY_MINUTE).toBe(20);
    expect(frozen(flat(19, 25, 40))).toBe(false);
    expect(frozen(flat(15, 25, 40))).toBe(true);
    expect(frozenAtMinute([])).toBeNull();
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
    // D143: the minute is 5 (it was 2, which only the 200 s war grace satisfied)
    expect(GUARD_PASSIVE_MINUTE).toBe(5);
    expect(bad.name).toContain(`${GUARD_PASSIVE_MINUTE} minutes`);
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
    attackRunning: () => false,
    structures: { capacity: 0, highWater: 0, liveCount: 0, type: [], owner: [], cell: [], level: [], buildTick: [], readyTick: [], upgradeReadyTick: [], idAt: () => -1, ownedCount: () => 0, deleteReadyTick: () => 0 },
    districts: { districtKind: [], districtLevel: [], districtReadyTick: [], districtUpgradeReadyTick: [], districtsOwned: () => 0 },
    falloutUntilAt: () => 0,
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

  it('its defaults are the sane human of D142 (60 % into free land and into wars, a 1.5 : 1 ratio, a 40 % reserve), and a neighbour at 1.2 : 1 is NOT attacked', () => {
    expect(DEFAULT_HUMAN_BOT).toEqual({ expandPct: 60, warPct: 60, warMinRatioPct: 150, minTroopsPct: 40 });
    const sent: Array<{ target: number }> = [];
    bot().onTick(stubView(T, { troops: [1200, 1000], cap: [2000, 2000], contact: { '1-2': 5 } }), (x) => sent.push(x as { target: number }));
    expect(sent).toEqual([]);
    bot().onTick(stubView(T, { troops: [1500, 1000], cap: [2000, 2000], contact: { '1-2': 5 } }), (x) => sent.push(x as { target: number }));
    expect(sent.map((x) => x.target)).toEqual([2]);
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

  it('POL, the integrated pace of a CONTESTED conquest (the user\'s complaint, D142): at troop parity a 100 % attacker takes the 197-cell disc in 45 to 90 s and 500 cells of a country in 90 to 180 s; 40 % is slower but active; a counter-attacking defender stalls the front', async () => {
    const run = (mode: 'disc' | 'country', commitPct: number, defender: 'passive' | 'counter', reissueTicks?: number) =>
      runConquest({ location: 'POL', mode, commitPct, defender, seed: 1, reissueTicks });
    const disc = await run('disc', 100, 'passive');
    const country = await run('country', 100, 'passive');
    const repeat40 = await run('disc', 40, 'passive');
    const single40 = await run('disc', 40, 'passive', 0);
    // measured 55.2 s, 108.8 s, 70.5 s and 216.7 s; a regression to the old pace (183 s and 354 s) fails these
    expect(disc.seconds).toBeGreaterThanOrEqual(45);
    expect(disc.seconds).toBeLessThanOrEqual(90);
    // the country run is the other goal: the defender holds COUNTRY_CELLS cells and the number is the time to take 500 of them
    expect(disc.goal).toBe(197);
    expect(country.goal).toBe(COUNTRY_CELLS);
    expect(country.goal).toBe(500);
    expect(country.defenderCells).toBeGreaterThanOrEqual(COUNTRY_CELLS);
    expect(country.defenderCells).toBeLessThan(COUNTRY_CELLS + 40);
    expect(country.attackerTroops).toBe(country.defenderTroops);
    expect(country.seconds).toBeGreaterThanOrEqual(90);
    expect(country.seconds).toBeLessThanOrEqual(180);
    expect(country.seconds as number).toBeGreaterThan(disc.seconds as number);
    // 40 % with repeated clicks (the REISSUE interval is part of the tool): active; one single click is much slower
    expect(repeat40.seconds).toBeGreaterThan(disc.seconds as number);
    expect(repeat40.seconds).toBeLessThanOrEqual(120);
    expect(single40.seconds).toBeGreaterThan(repeat40.seconds as number);
    expect(single40.seconds).toBeLessThanOrEqual(300);
    // a defender that hits back (60 % at the attacker every 4 s) sets the forces against each other (D85): at least three times as slow, or not at all
    for (const mode of ['disc', 'country'] as const) {
      const passive = mode === 'disc' ? (disc.seconds as number) : (country.seconds as number);
      const counter = await run(mode, 100, 'counter');
      expect(counter.seconds === null || counter.seconds >= 3 * passive, `${mode}: counter ${String(counter.seconds)} against passive ${passive}`).toBe(true);
    }
  }, 120000);

  it('the conquest table over the five locations: the medians of the acceptance (disc 45 to 90 s, country 90 to 180 s at 100 %), the 40 % rows active, ten rows of five locations', async () => {
    expect(CONQUEST_LOCATIONS).toEqual(['POL', 'FRA', 'TUR', 'THA', 'UKR']);
    const rows = await runConquestTable(1);
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.seconds).toHaveLength(CONQUEST_LOCATIONS.length);
      expect(r.contacts).toHaveLength(CONQUEST_LOCATIONS.length);
    }
    const row = (mode: 'disc' | 'country', commitPct: number, defender: string, clicks: string): ConquestRow => {
      const r = rows.find((x) => x.mode === mode && x.commitPct === commitPct && x.defender === defender && x.clicks === clicks);
      if (r === undefined) throw new Error('no such row');
      return r;
    };
    const disc = row('disc', 100, 'passive', 'repeat').median as number;
    const country = row('country', 100, 'passive', 'repeat').median as number;
    expect(disc).toBeGreaterThanOrEqual(45);
    expect(disc).toBeLessThanOrEqual(90);
    expect(country).toBeGreaterThanOrEqual(90);
    expect(country).toBeLessThanOrEqual(180);
    expect(row('disc', 40, 'passive', 'repeat').median as number).toBeLessThanOrEqual(120);
    expect(row('country', 40, 'passive', 'repeat').median as number).toBeLessThanOrEqual(180);
    expect(row('disc', 40, 'passive', 'single').median as number).toBeLessThanOrEqual(300);
    // every location takes the disc at 100 % within two minutes (the mountains of TUR are the slowest)
    for (const s of row('disc', 100, 'passive', 'repeat').seconds) expect(s).toBeLessThanOrEqual(120);
  }, 120000);

  it('the solo part reads the right minute of the scenario: row m is the land after m minutes, and the curve is the band\'s reference (D88, D142)', async () => {
    expect(SOLO_MINUTES).toEqual([1, 2, 3, 5, 10]);
    const [rus] = await runSolo(['RUS']);
    const { report } = await runScenario(parseScenarioArgs(['--solo', '--minutes', '10', '--country', 'RUS', '--seed', '1']));
    expect(rus?.country).toBe('RUS');
    SOLO_MINUTES.forEach((m, i) => expect(rus?.cells[i], `minute ${m}`).toBe(report.rows[m - 1]?.cells[0]));
    expect(rus?.cells[0]).toBeGreaterThan(1200);
    // the income of D143: the gold stock of an expander that buys nothing (measured 30 252 after 10 minutes, 2.3 minutes to 2 400 gold), ten minutes of both
    expect(rus?.goldPerSec).toHaveLength(10);
    expect(rus?.goldStock).toHaveLength(10);
    expect(rus?.goldStock[9]).toBeGreaterThan(25000);
    expect(rus?.goldStock[9]).toBeLessThan(36000);
    expect(rus?.goldPerSec[9]).toBeGreaterThan(rus?.goldPerSec[0] as number);
    for (let m = 1; m < 10; m++) expect(rus?.goldStock[m] as number).toBeGreaterThan(rus?.goldStock[m - 1] as number);
    const t = minuteReaching(rus?.goldStock ?? [], 2400) as number;
    expect(t).toBeGreaterThan(1.5);
    expect(t).toBeLessThan(3.5);
    expect(rus?.cells[3]).toBeGreaterThanOrEqual(SOLO_BAND.minute5[0]);
    expect(rus?.cells[3]).toBeLessThanOrEqual(SOLO_BAND.minute5[1]);
    expect(rus?.cells[4]).toBeGreaterThanOrEqual(SOLO_BAND.minute10[0]);
    expect(rus?.cells[4]).toBeLessThanOrEqual(SOLO_BAND.minute10[1]);
  }, 60000);

  it('a match run samples every minute from 1, the human is alive, and the AI share leaves the human out (the scripted human of East Asia, seed 3: Vietnam, holds more than every AI nation)', async () => {
    const passive = await runMatch('skirmish', 1, 3, true);
    expect(passive.samples.map((x) => x.minute)).toEqual([1, 2, 3]);
    expect(passive.passive).toBe(true);
    expect(passive.samples.every((x) => x.humanAlive)).toBe(true);
    expect(passive.samples[0]?.nations).toBe(12);
    expect(passive.samples[0]?.nationsAlive).toBe(12);
    // a passive human never gains land
    expect(passive.samples[2]?.humanShare).toBe(passive.samples[0]?.humanShare);
    const bot = await runMatch('asia', 3, 10, false);
    const at10 = bot.samples.find((x) => x.minute === 10);
    // measured: human 45.5 %, top AI nation 15 %
    expect(at10?.humanShare).toBeGreaterThan(30);
    expect(at10?.topAiShare).toBeLessThanOrEqual(20);
    expect(at10?.topShare).toBe(at10?.humanShare);
    expect(bot.human).toBe('VNM');
  }, 60000);

  it('passiveAlive reads GUARD_PASSIVE_MINUTE of the run: alive earlier and dead then is dead, an unsampled minute is dead', () => {
    const run = (samples: MatchSample[]): Parameters<typeof passiveAlive>[0] => ({ setup: 'skirmish', seed: 1, human: 'SWE', passive: true, samples });
    const upTo = (n: number, dead: number[]): MatchSample[] => Array.from({ length: n }, (_, i) => sample(i + 1, { humanAlive: !dead.includes(i + 1) }));
    expect(passiveAlive(run(upTo(GUARD_PASSIVE_MINUTE, [])))).toBe(true);
    expect(passiveAlive(run(upTo(GUARD_PASSIVE_MINUTE, [GUARD_PASSIVE_MINUTE])))).toBe(false);
    // dead before the minute and (impossibly) alive again at it is not what is asked; dead at an earlier minute only
    expect(passiveAlive(run(upTo(GUARD_PASSIVE_MINUTE, [GUARD_PASSIVE_MINUTE - 1])))).toBe(true);
    expect(passiveAlive(run(upTo(GUARD_PASSIVE_MINUTE - 1, [])))).toBe(false);
  });

  it('runPace evaluates the guards at the right minutes: the passive guard looks at GUARD_PASSIVE_MINUTE of a passive run, the match runs have one sample per minute (--json prints one line)', async () => {
    const lines: string[] = [];
    const report = await runPace(parseArgs(['--part', 'match', '--seeds', '1,2', '--minutes', '6', '--setup', 'skirmish', '--json']), (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    const m = report.matches?.[0];
    expect(m?.setup).toBe('skirmish');
    expect(m?.runs.map((r) => r.samples.length)).toEqual([6, 6]);
    expect(m?.passive.map((r) => r.samples.length)).toEqual([GUARD_PASSIVE_MINUTE, GUARD_PASSIVE_MINUTE]);
    const guard = m?.guards.find((g) => g.name.includes('passive'));
    expect(guard?.name).toContain(`${GUARD_PASSIVE_MINUTE} minutes`);
    expect(guard?.pass).toBe(true);
    // the nation / tribe guards read minute 3, the share guard minute 10 (not sampled in six minutes: it fails, it does not pass by accident)
    expect(m?.guards.find((g) => g.name.includes('minute 10'))?.pass).toBe(false);
    expect(m?.guards.find((g) => g.name.includes('nations alive'))?.pass).toBe(true);
  }, 60000);

  it('formatConquest prints every row with its median and the start contacts', () => {
    const rows: ConquestRow[] = [{ mode: 'disc', commitPct: 100, defender: 'passive', clicks: 'repeat', seconds: [50, null, 70], median: 60, contacts: [1, 2, 3] }];
    const text = formatConquest(rows);
    expect(text).toContain('whole 197-cell disc');
    expect(text).toContain('>900');
    expect(text).toContain('start contact (sim cells) of the disc runs per location: 1 2 3');
  });

  it('the npm script prints the solo table (a child process)', () => {
    const r = runTsxScript('sim:pace', ['--part', 'solo']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('solo (land cells)');
    expect(r.stdout).toContain('RUS');
    expect(r.stdout).toContain('median');
    const bad = runTsxScript('sim:pace', ['--part', 'nope']);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/--part/);
  }, 60000);
});

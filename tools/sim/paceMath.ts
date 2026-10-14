// The pure parts of the pace report (tools/sim/pace.ts): statistics, the time a series takes to reach a target, the table
// formatter, the argument parser and the guard rails of a match. No I/O, no sim state: the unit test (tests/sim/pace.test.ts) covers
// all of it. Deterministic: no clock, no Math.random.

/** The median of a list (the mean of the two middle values when the count is even, rounded to one decimal); NaN for an empty list. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  const m = s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  return Math.round(m * 10) / 10;
}

/** The median of the entries that are numbers; null when a majority is null (the goal was not reached in most runs). */
export function medianOrNull(xs: ReadonlyArray<number | null>): number | null {
  const hit = xs.filter((x): x is number => x !== null);
  if (hit.length * 2 <= xs.length) return null;
  return median(hit);
}

/** One sample of a growing quantity: `t` in game seconds, `v` the value. */
export interface Sample {
  readonly t: number;
  readonly v: number;
}

/**
 * The minute (a tenth) at which a stock that is `stock[m - 1]` at the end of minute m (and 0 at minute 0) first reaches `price`
 * (linear between two minutes); null when it never does within the samples.
 */
export function minuteReaching(stock: readonly number[], price: number): number | null {
  const t = secondsToReach([{ t: 0, v: 0 }, ...stock.map((v, i) => ({ t: i + 1, v }))], price);
  return t;
}

/** The first time (game seconds) a series reaches `target` (linear between two samples, rounded to a tenth); null when it never does. */
export function secondsToReach(series: readonly Sample[], target: number): number | null {
  for (let i = 0; i < series.length; i++) {
    const cur = series[i] as Sample;
    if (cur.v < target) continue;
    if (i === 0) return Math.round(cur.t * 10) / 10;
    const prev = series[i - 1] as Sample;
    const span = cur.v - prev.v;
    const frac = span <= 0 ? 1 : (target - prev.v) / span;
    return Math.round((prev.t + frac * (cur.t - prev.t)) * 10) / 10;
  }
  return null;
}

/** Cells as a percentage of `total` with one decimal (0 for an empty total). */
export function sharePct(cells: number, total: number): number {
  return total <= 0 ? 0 : Math.round((1000 * cells) / total) / 10;
}

/** A whole-seconds text for a table cell: "74", "212" or ">900" for a goal that was not reached. */
export function secondsText(s: number | null, cap: number): string {
  return s === null ? `>${cap}` : String(Math.round(s));
}

/** A fixed-width text table: the first column left-aligned, the others right-aligned. */
export function formatTable(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => (r[c] ?? '').length)));
  const line = (cells: readonly string[]): string =>
    cells.map((cell, c) => (c === 0 ? cell.padEnd(widths[c] as number) : cell.padStart(widths[c] as number))).join('  ');
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

/** The parts of the report. */
export const PARTS = ['solo', 'conquest', 'match'] as const;
export type Part = (typeof PARTS)[number];

export interface PaceArgs {
  readonly parts: readonly Part[];
  /** Seeds for the match part and the conquest part. */
  readonly seeds: readonly number[];
  /** Minutes the match part runs. */
  readonly minutes: number;
  readonly json: boolean;
  /** Gold prices (whole gold) for which the solo part prints the minute at which an expander that buys nothing could first pay them (D143). */
  readonly prices: readonly number[];
  /** Which match setups to run: 'play' (you + 5 AI + 20 tribes, the world), 'skirmish' (you + 12 AI + 20 tribes in Europe) and, on request, 'asia' (you + 5 AI + 20 tribes in East Asia). */
  readonly setups: readonly MatchSetupName[];
}

export const MATCH_SETUPS = ['play', 'skirmish', 'asia'] as const;
export type MatchSetupName = (typeof MATCH_SETUPS)[number];
/** The setups a plain `sim:pace` runs. */
/** The prices the solo part marks by default: 1 000 (a City or a Port), 2 400 (Factory + Silo + a Fission missile), 7 000 (the same plus an upgrade and a Fusion missile, the audit's examples) and 20 000. */
export const DEFAULT_PRICE_MARKS: readonly number[] = [1000, 2400, 7000, 20000];
export const DEFAULT_SETUPS: readonly MatchSetupName[] = ['play', 'skirmish'];
/** Minutes the match part plays by default (the late-share guard looks at minute 25). */
export const DEFAULT_MATCH_MINUTES = 25;

function intList(name: string, raw: string | undefined): number[] {
  if (raw === undefined || raw === '') throw new Error(`${name} needs a comma separated list of integers`);
  return raw.split(',').map((x) => {
    const n = Number(x);
    if (!Number.isInteger(n) || n < -2147483648 || n > 4294967295) throw new Error(`${name}: ${x} is not an integer seed`);
    return n;
  });
}

export function parseArgs(argv: readonly string[]): PaceArgs {
  let parts: Part[] = [...PARTS];
  let seeds: number[] = [1, 2, 3, 4, 5];
  let minutes = DEFAULT_MATCH_MINUTES;
  let json = false;
  let prices: number[] = [...DEFAULT_PRICE_MARKS];
  let setups: MatchSetupName[] = [...DEFAULT_SETUPS];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = argv[i + 1];
    if (a === '--part') {
      if (next === undefined) throw new Error('--part needs solo, conquest or match');
      parts = next.split(',').map((p) => {
        if (!(PARTS as readonly string[]).includes(p)) throw new Error(`--part: unknown part ${p}`);
        return p as Part;
      });
      i++;
    } else if (a === '--seeds') {
      seeds = intList('--seeds', next);
      i++;
    } else if (a === '--minutes') {
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error(`--minutes needs an integer in 1..60, got ${String(next)}`);
      minutes = n;
      i++;
    } else if (a === '--setup') {
      if (next === undefined) throw new Error('--setup needs play or skirmish');
      setups = next.split(',').map((p) => {
        if (!(MATCH_SETUPS as readonly string[]).includes(p)) throw new Error(`--setup: unknown setup ${p}`);
        return p as MatchSetupName;
      });
      i++;
    } else if (a === '--prices') {
      prices = intList('--prices', next);
      if (prices.some((x) => x < 1)) throw new Error('--prices needs positive integers');
      i++;
    } else if (a === '--json') json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return { parts, seeds, minutes, json, prices, setups };
}

// ---------------------------------------------------------------------------------------------------------------------
// The guard rails of a match (the numbers of the tempo pass, D142).

/** What one sampled minute of a match looked like. Shares are percent of the playable land, one decimal. */
export interface MatchSample {
  readonly minute: number;
  /** The biggest land share of any seat (the human included), the biggest of an AI nation or tribe, and the human's (cos-weighted percent of all playable land, as the HUD shows it). */
  readonly topShare: number;
  readonly topAiShare: number;
  readonly humanShare: number;
  /** AI nations (not the human) that own land, and how many there were. */
  readonly nationsAlive: number;
  readonly nations: number;
  readonly tribesAlive: number;
  readonly tribes: number;
  readonly humanAlive: boolean;
  readonly freeShare: number;
}

export interface Guard {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

/** The most land one AI nation or tribe may own at minute 10 (percent). The human is not capped: a human who wins his wars is the point of the game (D142). */
export const GUARD_TOP_SHARE_MINUTE10 = 25;
/** The same bound at the late minutes (D143: the war cap alone let a mid-size nation run on to 26 to 29 % after minute 15). */
export const GUARD_TOP_SHARE_LATE = 25;
export const GUARD_LATE_MINUTES: readonly number[] = [15, 20, 25];
/** Share of the AI nations and of the tribes that must still own land at minute 3 (percent). */
export const GUARD_ALIVE_MINUTE3_PCT = 75;
/** The minute at which a player who never acts must still own land (D143: it was 2, which only the 200 s war grace satisfied). */
export const GUARD_PASSIVE_MINUTE = 5;
/**
 * A frozen board: the free-land share is the same (within GUARD_FROZEN_EPSILON) at the start and the end of a window of
 * GUARD_FROZEN_WINDOW_MINUTES, and above GUARD_FROZEN_MIN_FREE percent, so land is there and nobody takes it. It must not happen
 * before minute GUARD_FROZEN_BY_MINUTE (after that the caps and the sea may settle a match).
 */
export const GUARD_FROZEN_WINDOW_MINUTES = 5;
export const GUARD_FROZEN_MIN_FREE = 10;
export const GUARD_FROZEN_EPSILON = 0.1;
export const GUARD_FROZEN_BY_MINUTE = 20;

function at(samples: readonly MatchSample[], minute: number): MatchSample | undefined {
  return samples.find((s) => s.minute === minute);
}

/** The first minute at which the board has been frozen for a whole window (see GUARD_FROZEN_*), null when it never is within the samples. */
export function frozenAtMinute(samples: readonly MatchSample[]): number | null {
  for (const end of samples) {
    const start = at(samples, end.minute - GUARD_FROZEN_WINDOW_MINUTES);
    if (start === undefined || end.freeShare <= GUARD_FROZEN_MIN_FREE) continue;
    let flat = true;
    for (let m = start.minute; m <= end.minute && flat; m++) {
      const s = at(samples, m);
      if (s === undefined || Math.abs(s.freeShare - end.freeShare) > GUARD_FROZEN_EPSILON) flat = false;
    }
    if (flat) return end.minute;
  }
  return null;
}

/**
 * The guard rails over several seeds of one setup: nobody above GUARD_TOP_SHARE_MINUTE10 at minute 10 and above GUARD_TOP_SHARE_LATE at
 * the late minutes, at least GUARD_ALIVE_MINUTE3_PCT of the nations and of the tribes alive at minute 3, and no frozen board before
 * minute GUARD_FROZEN_BY_MINUTE. `perSeed` has one sample list per seed (sampled at whole minutes).
 */
export function evaluateMatchGuards(perSeed: ReadonlyArray<readonly MatchSample[]>): Guard[] {
  const tops = perSeed.map((s) => at(s, 10)?.topAiShare ?? NaN);
  const worstTop = Math.max(...tops);
  // A seed that has no sample at a late minute fails (NaN) instead of passing by accident; a run shorter than the late minutes is a tool error.
  const lates = perSeed.flatMap((s) => GUARD_LATE_MINUTES.map((m) => at(s, m)?.topAiShare ?? NaN));
  const worstLate = Math.max(...lates);
  const nationsFrac = perSeed.map((s) => {
    const m = at(s, 3);
    return m === undefined || m.nations === 0 ? 100 : (100 * m.nationsAlive) / m.nations;
  });
  const tribesFrac = perSeed.map((s) => {
    const m = at(s, 3);
    return m === undefined || m.tribes === 0 ? 100 : (100 * m.tribesAlive) / m.tribes;
  });
  const worstNations = Math.min(...nationsFrac);
  const worstTribes = Math.min(...tribesFrac);
  const frozen = perSeed.map((s) => frozenAtMinute(s));
  const earliest = frozen.reduce<number | null>((a, f) => (f !== null && (a === null || f < a) ? f : a), null);
  return [
    { name: `top AI land share at minute 10 <= ${GUARD_TOP_SHARE_MINUTE10} %`, pass: worstTop <= GUARD_TOP_SHARE_MINUTE10, detail: `worst seed ${worstTop} %` },
    { name: `AI nations alive at minute 3 >= ${GUARD_ALIVE_MINUTE3_PCT} %`, pass: worstNations >= GUARD_ALIVE_MINUTE3_PCT, detail: `worst seed ${Math.round(worstNations)} %` },
    { name: `tribes alive at minute 3 >= ${GUARD_ALIVE_MINUTE3_PCT} %`, pass: worstTribes >= GUARD_ALIVE_MINUTE3_PCT, detail: `worst seed ${Math.round(worstTribes)} %` },
    { name: `top AI land share at minutes ${GUARD_LATE_MINUTES.join(', ')} <= ${GUARD_TOP_SHARE_LATE} %`, pass: worstLate <= GUARD_TOP_SHARE_LATE, detail: Number.isNaN(worstLate) ? 'a seed has no sample there: play at least 25 minutes' : `worst seed ${worstLate} %` },
    {
      name: `the board is not frozen before minute ${GUARD_FROZEN_BY_MINUTE + 1} (free land above ${GUARD_FROZEN_MIN_FREE} % unchanged for ${GUARD_FROZEN_WINDOW_MINUTES} minutes)`,
      pass: earliest === null || earliest > GUARD_FROZEN_BY_MINUTE,
      detail: earliest === null ? 'never frozen' : `earliest freeze at minute ${earliest}`,
    },
  ];
}

/** The passive-player guard: the human who never acts still owns land at `minute` (GUARD_PASSIVE_MINUTE) in every seed. */
export function evaluatePassiveGuard(aliveAtMinute: readonly boolean[], minute: number = GUARD_PASSIVE_MINUTE): Guard {
  const dead = aliveAtMinute.filter((a) => !a).length;
  return { name: `a passive player is alive at ${minute} minutes`, pass: dead === 0, detail: `${aliveAtMinute.length - dead} of ${aliveAtMinute.length} seeds` };
}

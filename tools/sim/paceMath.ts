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
  /** Which match setups to run: 'play' (you + 5 AI + 20 tribes, the world) and 'skirmish' (you + 12 AI + 20 tribes in Europe). */
  readonly setups: readonly MatchSetupName[];
}

export const MATCH_SETUPS = ['play', 'skirmish'] as const;
export type MatchSetupName = (typeof MATCH_SETUPS)[number];

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
  let minutes = 15;
  let json = false;
  let setups: MatchSetupName[] = [...MATCH_SETUPS];
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
    } else if (a === '--json') json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return { parts, seeds, minutes, json, setups };
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
/** Share of the AI nations and of the tribes that must still own land at minute 3 (percent). */
export const GUARD_ALIVE_MINUTE3_PCT = 75;

function at(samples: readonly MatchSample[], minute: number): MatchSample | undefined {
  return samples.find((s) => s.minute === minute);
}

/**
 * The guard rails over several seeds of one setup: nobody above GUARD_TOP_SHARE_MINUTE10 at minute 10, at least GUARD_ALIVE_MINUTE3_PCT
 * of the nations and of the tribes alive at minute 3. `perSeed` has one sample list per seed (sampled at whole minutes).
 */
export function evaluateMatchGuards(perSeed: ReadonlyArray<readonly MatchSample[]>): Guard[] {
  const tops = perSeed.map((s) => at(s, 10)?.topAiShare ?? NaN);
  const worstTop = Math.max(...tops);
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
  return [
    { name: `top AI land share at minute 10 <= ${GUARD_TOP_SHARE_MINUTE10} %`, pass: worstTop <= GUARD_TOP_SHARE_MINUTE10, detail: `worst seed ${worstTop} %` },
    { name: `AI nations alive at minute 3 >= ${GUARD_ALIVE_MINUTE3_PCT} %`, pass: worstNations >= GUARD_ALIVE_MINUTE3_PCT, detail: `worst seed ${Math.round(worstNations)} %` },
    { name: `tribes alive at minute 3 >= ${GUARD_ALIVE_MINUTE3_PCT} %`, pass: worstTribes >= GUARD_ALIVE_MINUTE3_PCT, detail: `worst seed ${Math.round(worstTribes)} %` },
  ];
}

/** The passive-player guard: the human who never acts still owns land at 120 s in every seed. */
export function evaluatePassiveGuard(aliveAt120s: readonly boolean[]): Guard {
  const dead = aliveAt120s.filter((a) => !a).length;
  return { name: 'a passive player is alive at 2 minutes', pass: dead === 0, detail: `${aliveAt120s.length - dead} of ${aliveAt120s.length} seeds` };
}

// CPU-budget calibration. Every CPU budget assertion goes through budgetMs(x); never hard-code a ms limit.
//
// A fixed reference workload (about 5 M Math.imul / typed-array writes) is timed once per process. The ratio of the
// measured time to REFERENCE_MS (the time on the machine the constants were taken from) is the calibration
// factor, clamped to [MIN_FACTOR, MAX_FACTOR] and logged. budgetMs(x) = x * factor.
//
// Statistics rules: every perf assert uses the median of >= 5 measurements after 2 warm-ups (measureMedianMs);
// a p99 requirement applies only where a test says so explicitly, over >= 200 samples (measureP99Ms);
// each budget states its statistic.

export const MIN_FACTOR = 0.5;
export const MAX_FACTOR = 4;
/** Median time (ms) of the reference workload on the machine these budgets were authored on (cloud sandbox). */
export const REFERENCE_MS = 5.5;
export const REFERENCE_ITERATIONS = 5_000_000;

export function clampFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor));
}

let sink = 0;

/** One timing of the reference workload, in ms. */
export function referenceWorkloadMs(): number {
  const buf = new Int32Array(1024);
  const t0 = performance.now();
  let h = 0x9e3779b9 | 0;
  for (let i = 0; i < REFERENCE_ITERATIONS; i++) {
    h = Math.imul(h ^ i, 0x85ebca6b) | 0;
    buf[i & 1023] = h;
  }
  const t1 = performance.now();
  sink ^= buf[(h >>> 3) & 1023] ?? 0;
  return t1 - t0;
}

/** The per-process calibration measurement: one warm-up, then the median of 3 timings of the reference workload. */
export function calibrationMeasureMs(): number {
  referenceWorkloadMs();
  return median([referenceWorkloadMs(), referenceWorkloadMs(), referenceWorkloadMs()]);
}

export interface PerfGuard {
  readonly factor: number;
  budgetMs(x: number): number;
}

/** Builds a guard from an injectable measurement (ms for the reference workload). */
export function createPerfGuard(measure: () => number = calibrationMeasureMs, referenceMs = REFERENCE_MS): PerfGuard {
  const measured = measure();
  const raw = measured / referenceMs;
  const factor = clampFactor(raw);
  console.log(
    `[perfguard] reference workload ${measured.toFixed(2)} ms vs ${referenceMs} ms -> raw factor ${raw.toFixed(2)}, ` +
      `clamped factor ${factor.toFixed(2)} (range ${MIN_FACTOR}..${MAX_FACTOR})`,
  );
  return { factor, budgetMs: (x: number) => x * factor };
}

let processGuard: PerfGuard | undefined;

/** Lazily measured once per process. */
export function calibrationFactor(): number {
  processGuard ??= createPerfGuard();
  return processGuard.factor;
}

/** Scales a nominal budget (ms on the reference machine) by the process calibration factor. */
export function budgetMs(x: number): number {
  processGuard ??= createPerfGuard();
  return processGuard.budgetMs(x);
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
}

/** Nearest-rank percentile, p in (0, 100]. */
export function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * s.length));
  return s[Math.min(s.length, rank) - 1] as number;
}

export interface MeasureOptions {
  runs?: number;
  warmups?: number;
}

function timeOnce(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

/** Median wall-clock ms of fn over >= 5 runs after >= 2 warm-ups. */
export function measureMedianMs(fn: () => void, { runs = 5, warmups = 2 }: MeasureOptions = {}): number {
  if (runs < 5) throw new Error('perf asserts need at least 5 measurements');
  if (warmups < 2) throw new Error('perf asserts need at least 2 warm-ups');
  for (let i = 0; i < warmups; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) samples.push(timeOnce(fn));
  return median(samples);
}

/** p99 wall-clock ms of fn over >= 200 samples after >= 2 warm-ups. Use only where a budget says p99. */
export function measureP99Ms(fn: () => void, { runs = 200, warmups = 2 }: MeasureOptions = {}): number {
  if (runs < 200) throw new Error('a p99 requirement needs at least 200 samples');
  if (warmups < 2) throw new Error('perf asserts need at least 2 warm-ups');
  for (let i = 0; i < warmups; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) samples.push(timeOnce(fn));
  return percentile(samples, 99);
}

/** Keeps the reference workload from being optimised away. */
export function perfSink(): number {
  return sink;
}

// Adaptive resolution (AutoTier-2, D160): a pure regulator (no three, no DOM, no clock of its own) that turns frame times into a scale of
// the drawing buffer. Every number is in config.ts. Rules: the first frames are ignored (warm-up); the statistic of a window of
// ADAPT_WINDOW frames is its MEDIAN (a single spike cannot move it); two slow windows in a row step the scale down, four fast ones in a
// row step it up, a window in between resets both counts (hysteresis); changes are at least ADAPT_MIN_INTERVAL_MS of frame time apart.
// When the smallest scale is not enough the chunk density goes one step down (once), and comes back only after the scale is 1 again.
import {
  ADAPT_DENSITY_SCALE,
  ADAPT_DOWN_MS,
  ADAPT_DOWN_WINDOWS,
  ADAPT_IGNORE_MS,
  ADAPT_MIN_INTERVAL_MS,
  ADAPT_SCALES,
  ADAPT_UP_MS,
  ADAPT_UP_WINDOWS,
  ADAPT_WARMUP_FRAMES,
  ADAPT_WINDOW,
} from './config';

export interface AdaptiveConfig {
  scales: readonly number[];
  window: number;
  warmupFrames: number;
  downMs: number;
  upMs: number;
  downWindows: number;
  upWindows: number;
  minIntervalMs: number;
  ignoreMs: number;
  densityScale: number;
  /** 'median' (the real thing) or 'mean' (the mutant of the tests). */
  statistic: 'median' | 'mean';
  /** False = the chunk density never changes (the mutant of the tests). */
  densityStep: boolean;
}

export const ADAPTIVE_DEFAULTS: AdaptiveConfig = {
  scales: ADAPT_SCALES,
  window: ADAPT_WINDOW,
  warmupFrames: ADAPT_WARMUP_FRAMES,
  downMs: ADAPT_DOWN_MS,
  upMs: ADAPT_UP_MS,
  downWindows: ADAPT_DOWN_WINDOWS,
  upWindows: ADAPT_UP_WINDOWS,
  minIntervalMs: ADAPT_MIN_INTERVAL_MS,
  ignoreMs: ADAPT_IGNORE_MS,
  densityScale: ADAPT_DENSITY_SCALE,
  statistic: 'median',
  densityStep: true,
};

/** One change, for the log and the report: the step index and density after it, the window statistic that caused it. */
export interface AdaptiveStep {
  /** Frames fed in (after the warm-up) when it happened. */
  frame: number;
  index: number;
  scale: number;
  densityReduced: boolean;
  statMs: number;
}

export class AdaptiveResolution {
  private readonly cfg: AdaptiveConfig;
  private readonly buf: Float64Array;
  private readonly scratch: Float64Array;
  private filled = 0;
  private seen = 0;
  private counted = 0;
  private downStreak = 0;
  private upStreak = 0;
  private sinceChangeMs = Number.POSITIVE_INFINITY;
  private idx = 0;
  private reduced = false;
  private scaleSum = 0;
  private minSeen = 1;
  /** The changes made so far (bounded: the regulator does not oscillate; capped anyway). */
  readonly steps: AdaptiveStep[] = [];

  constructor(config: Partial<AdaptiveConfig> = {}) {
    this.cfg = { ...ADAPTIVE_DEFAULTS, ...config };
    this.buf = new Float64Array(this.cfg.window);
    this.scratch = new Float64Array(this.cfg.window);
    this.minSeen = this.scale;
  }

  get scale(): number {
    return this.cfg.scales[this.idx] as number;
  }

  get stepIndex(): number {
    return this.idx;
  }

  /** True while the chunk density is one step down. */
  get densityReduced(): boolean {
    return this.reduced;
  }

  /** The `Globe.setChunkDensity` argument that goes with the state. */
  get density(): number {
    return this.reduced ? this.cfg.densityScale : 1;
  }

  /** Mean of the scale over the frames counted (after the warm-up); the current scale before any. */
  get scaleMean(): number {
    return this.counted > 0 ? this.scaleSum / this.counted : this.scale;
  }

  get scaleMin(): number {
    return this.minSeen;
  }

  /**
   * Feeds one frame time (ms). Returns true when the scale or the density changed with this frame (the caller applies `scale` and
   * `density`). No allocation per call (a step is recorded only on a change).
   */
  push(ms: number): boolean {
    const c = this.cfg;
    if (!(ms >= 0) || ms > c.ignoreMs) return false; // NaN, a negative interval, a tab switch
    if (this.seen < c.warmupFrames) {
      this.seen++;
      return false;
    }
    this.counted++;
    this.scaleSum += this.scale;
    this.sinceChangeMs += ms;
    this.buf[this.filled++] = ms;
    if (this.filled < c.window) return false;
    this.filled = 0;
    const stat = this.windowStat();
    return this.decide(stat);
  }

  private windowStat(): number {
    const n = this.cfg.window;
    if (this.cfg.statistic === 'mean') {
      let s = 0;
      for (let i = 0; i < n; i++) s += this.buf[i] as number;
      return s / n;
    }
    const a = this.scratch;
    for (let i = 0; i < n; i++) {
      const v = this.buf[i] as number;
      let j = i - 1;
      while (j >= 0 && (a[j] as number) > v) {
        a[j + 1] = a[j] as number;
        j--;
      }
      a[j + 1] = v;
    }
    return n % 2 === 1 ? (a[(n - 1) >> 1] as number) : ((a[n / 2 - 1] as number) + (a[n / 2] as number)) / 2;
  }

  private decide(stat: number): boolean {
    const c = this.cfg;
    if (stat > c.downMs) {
      this.upStreak = 0;
      this.downStreak++;
      if (this.downStreak >= c.downWindows && this.sinceChangeMs >= c.minIntervalMs) return this.stepDown(stat);
    } else if (stat < c.upMs) {
      this.downStreak = 0;
      this.upStreak++;
      if (this.upStreak >= c.upWindows && this.sinceChangeMs >= c.minIntervalMs) return this.stepUp(stat);
    } else {
      this.downStreak = 0;
      this.upStreak = 0;
    }
    return false;
  }

  private stepDown(stat: number): boolean {
    const last = this.cfg.scales.length - 1;
    if (this.idx < last) this.idx++;
    else if (this.cfg.densityStep && !this.reduced) this.reduced = true;
    else return false;
    return this.changed(stat);
  }

  private stepUp(stat: number): boolean {
    if (this.reduced && this.idx === 0) this.reduced = false; // only once the scale is 1 again
    else if (this.idx > 0) this.idx--;
    else return false;
    return this.changed(stat);
  }

  private changed(stat: number): boolean {
    this.downStreak = 0;
    this.upStreak = 0;
    this.sinceChangeMs = 0;
    this.minSeen = Math.min(this.minSeen, this.scale);
    if (this.steps.length < 64) this.steps.push({ frame: this.counted, index: this.idx, scale: this.scale, densityReduced: this.reduced, statMs: stat });
    return true;
  }
}

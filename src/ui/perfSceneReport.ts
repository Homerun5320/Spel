// What the performance scene (`?scene=perf`, M08) records and how it summarises it: a fixed-size recorder (no allocation per frame), the
// frame cadence histogram, the display refresh estimate and the "does the frame rate look capped?" verdict. The module reads no clock and
// touches no DOM or GL: the frame driver pushes the numbers in, so Node tests drive it with synthetic frame series.
//
// The question behind the extra fields (user feedback at M02 to M05, "steady 30 fps on a strong GPU"): a GPU that is merely slow gives
// frame times that move with the work (the orbit view is cheap, 300 m over the Himalaya is dear); a cap or a vsync lock gives the same
// multiple of the display's refresh interval in every phase. The display's refresh is measured BEFORE the scene draws anything (empty
// animation-frame callbacks), so it is not contaminated by the scene's own cost.

/** The bins of the cadence histogram in ms: bin i holds frames with `edges[i] <= interval < edges[i + 1]`, the last bin everything from its edge. */
export const PERF_CADENCE_EDGES_MS: readonly number[] = [0, 6, 9, 12.5, 18, 25, 36, 50, 75, 100];

/** Frames the recorder holds (4 minutes at 60 fps); more frames only add to the counters and set `truncated`. */
export const PERF_MAX_FRAMES = 14400;
/** Refresh probe samples kept. */
export const PERF_PROBE_MAX = 240;

export interface PerfPhaseSummary {
  name: string;
  frames: number;
  meanMs: number;
  p95Ms: number;
  medianMs: number;
  maxTriangles: number;
  maxChunks: number;
  /** The camera's height over the ground at the last frame of the phase, metres. */
  endAglM: number;
}

export type CapVerdict = 'unknown' | 'none' | 'likely-capped' | 'unclear';

export interface PerfSceneSection {
  name: 'perf';
  /** True when the script reached its end (a report copied earlier shows the part that ran). */
  completed: boolean;
  /** True for the shortened script of test mode. */
  quick: boolean;
  /** Wall time of the frames in seconds (the sum of the frame intervals) and the fx clock time the script ran. */
  durationS: number;
  fxDurationS: number;
  frames: number;
  /** More frames than the recorder holds were drawn: the statistics cover the first `PERF_MAX_FRAMES`. */
  truncated: boolean;
  frameMs: { mean: number; p95: number; max: number };
  fps: { mean: number; p95: number };
  maxTriangles: number;
  maxDrawCalls: number;
  maxChunks: number;
  /** The lowest camera height over the ground the script reached, metres. */
  minAglM: number;
  /** The canvas: CSS size, drawing-buffer size, the pixel ratio the renderer uses (`dpr`, capped by the tier) and the window's own `devicePixelRatio`. */
  canvas: { cssWidth: number; cssHeight: number; pixelWidth: number; pixelHeight: number; dpr: number; devicePixelRatio: number };
  /** Display refresh measured with empty animation-frame callbacks before the scene draws (`measured` false: no probe, test mode). */
  refresh: { measured: boolean; samples: number; medianIntervalMs: number; hz: number };
  cadence: {
    edgesMs: number[];
    counts: number[];
    /** Shares of the frames that lasted about 1, 2, 3 and 4 or more refresh intervals (all 0 without a measured refresh). */
    refreshUnits: { x1: number; x2: number; x3: number; x4plus: number };
  };
  cappedHint: { verdict: CapVerdict; lockedMultiple: number; note: string };
  /** JavaScript time of the update and draw submission per frame, ms (the GPU's work is not in it). */
  cpuMs: { mean: number; p95: number };
  /** GPU time of the draw call from the timer query extension (`available` false: the browser does not offer it). */
  gpuMs: { available: boolean; samples: number; mean: number; p95: number };
  phases: PerfPhaseSummary[];
}

const round = (x: number, d = 2): number => Math.round(x * 10 ** d) / 10 ** d;

/** The p-quantile (0..1) of an ascending array by the nearest-rank rule FrameStats uses (p95: index ceil(0.95 n) - 1). */
function rank(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  return n === 0 ? 0 : (sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))] as number);
}

function medianOf(sorted: ArrayLike<number>): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? (sorted[(n - 1) / 2] as number) : ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2;
}

const sortedCopy = (a: Float32Array | Float64Array, n: number): Float64Array => Float64Array.from(a.subarray(0, n)).sort();

/** The cadence histogram of a series of frame intervals (ms). */
export function cadenceCounts(intervals: ArrayLike<number>, edges: readonly number[] = PERF_CADENCE_EDGES_MS): number[] {
  const counts = new Array<number>(edges.length).fill(0);
  for (let i = 0; i < intervals.length; i++) {
    const v = intervals[i] as number;
    let b = edges.length - 1;
    while (b > 0 && v < (edges[b] as number)) b--;
    counts[b] = (counts[b] as number) + 1;
  }
  return counts;
}

/** Shares of the intervals that last about 1, 2, 3 and 4 or more refresh intervals (rounded to the nearest whole number of them). */
export function refreshUnitShares(intervals: ArrayLike<number>, refreshMs: number): { x1: number; x2: number; x3: number; x4plus: number } {
  const out = { x1: 0, x2: 0, x3: 0, x4plus: 0 };
  const n = intervals.length;
  if (n === 0 || !(refreshMs > 0)) return out;
  for (let i = 0; i < n; i++) {
    const k = Math.max(1, Math.round((intervals[i] as number) / refreshMs));
    if (k === 1) out.x1++;
    else if (k === 2) out.x2++;
    else if (k === 3) out.x3++;
    else out.x4plus++;
  }
  return { x1: round(out.x1 / n, 3), x2: round(out.x2 / n, 3), x3: round(out.x3 / n, 3), x4plus: round(out.x4plus / n, 3) };
}

/** A phase needs this many frames before its median counts in the verdict. */
const VERDICT_MIN_FRAMES = 10;
/** Phase medians within this share of one multiple of the refresh interval count as locked to it. */
const LOCK_TOLERANCE = 0.08;
/** Below this many refresh intervals the median frame is "at the display's rate". */
const AT_REFRESH_MAX = 1.25;

/**
 * Does the frame rate look capped? Needs the display's refresh interval (measured before the scene) and the median frame interval of each
 * phase. The frame rate is at the display's rate when the overall median is under 1.25 refresh intervals. Otherwise, if EVERY phase with
 * at least 10 frames has its median within 8 % of the same whole multiple (2 or more) of the refresh interval, although the phases differ
 * greatly in work, the rate is locked to a multiple of the refresh (a cap or a vsync lock: "likely-capped"). Medians that differ between
 * the phases are what a GPU that is simply too slow looks like ("unclear" is the neutral word: slower than the display, not locked).
 */
export function cappedVerdict(refreshMs: number, phases: ReadonlyArray<{ frames: number; medianMs: number }>, overallMedianMs: number, gpuMeanMs: number | null): { verdict: CapVerdict; lockedMultiple: number; note: string } {
  if (!(refreshMs > 0)) return { verdict: 'unknown', lockedMultiple: 0, note: 'The display refresh was not measured (test mode or too few probe frames).' };
  const used = phases.filter((p) => p.frames >= VERDICT_MIN_FRAMES);
  if (used.length === 0 || !(overallMedianMs > 0)) return { verdict: 'unknown', lockedMultiple: 0, note: 'Too few frames per phase to judge.' };
  const k = overallMedianMs / refreshMs;
  if (k < AT_REFRESH_MAX) return { verdict: 'none', lockedMultiple: 1, note: `The median frame takes ${k.toFixed(2)} refresh intervals: the scene runs at the display's rate.` };
  const kk = Math.round(k);
  const locked = kk >= 2 && used.every((p) => Math.abs(p.medianMs - kk * refreshMs) <= LOCK_TOLERANCE * kk * refreshMs);
  if (locked) {
    const idle = gpuMeanMs !== null && gpuMeanMs < 0.6 * overallMedianMs ? ` The GPU was busy only ${gpuMeanMs.toFixed(1)} ms of each ${overallMedianMs.toFixed(1)} ms frame.` : '';
    return { verdict: 'likely-capped', lockedMultiple: kk, note: `Every phase runs at ${kk} refresh intervals (${(kk * refreshMs).toFixed(1)} ms) however much work it has: a frame-rate cap or vsync lock, not the GPU's speed.${idle}` };
  }
  return { verdict: 'unclear', lockedMultiple: 0, note: `The median frame takes ${k.toFixed(2)} refresh intervals and the phases differ: slower than the display, not locked to one multiple of it.` };
}

export interface SectionMeta {
  completed: boolean;
  quick: boolean;
  fxDurationS: number;
  canvas: PerfSceneSection['canvas'];
  phaseNames: readonly string[];
}

/** Records the frames of the performance scene in fixed arrays. One instance per run. */
export class PerfRecorder {
  private readonly interval = new Float32Array(PERF_MAX_FRAMES);
  private readonly cpu = new Float32Array(PERF_MAX_FRAMES);
  private readonly phaseOf = new Uint8Array(PERF_MAX_FRAMES);
  private readonly phaseTriangles: number[] = [];
  private readonly phaseChunks: number[] = [];
  private readonly phaseEndAgl: number[] = [];
  private readonly probeMs = new Float32Array(PERF_PROBE_MAX);
  private readonly gpu = new Float32Array(PERF_MAX_FRAMES);
  private probeN = 0;
  private gpuN = 0;
  private n = 0;
  private total = 0;
  private sumMs = 0;
  private maxTri = 0;
  private maxCalls = 0;
  private maxChunkN = 0;
  private minAgl = Infinity;
  private lastPhase = 0;

  /** One empty animation-frame interval (ms) measured before the scene draws. */
  probe(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0 || this.probeN >= PERF_PROBE_MAX) return;
    this.probeMs[this.probeN++] = ms;
  }

  get probeSamples(): number {
    return this.probeN;
  }

  /** Records one drawn frame: its interval (ms since the previous frame), the JavaScript time of the frame and the renderer's counters. */
  frame(intervalMs: number, cpuMs: number, calls: number, triangles: number, chunks: number, aglM: number, phase: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
    this.total++;
    if (this.n >= PERF_MAX_FRAMES) return;
    const i = this.n++;
    this.interval[i] = intervalMs;
    this.cpu[i] = Number.isFinite(cpuMs) && cpuMs > 0 ? cpuMs : 0;
    this.phaseOf[i] = phase;
    this.sumMs += intervalMs;
    this.lastPhase = phase;
    if (calls > this.maxCalls) this.maxCalls = calls;
    if (triangles > this.maxTri) this.maxTri = triangles;
    if (chunks > this.maxChunkN) this.maxChunkN = chunks;
    if (Number.isFinite(aglM) && aglM < this.minAgl) this.minAgl = aglM;
    while (this.phaseTriangles.length <= phase) {
      this.phaseTriangles.push(0);
      this.phaseChunks.push(0);
      this.phaseEndAgl.push(0);
    }
    if (triangles > (this.phaseTriangles[phase] as number)) this.phaseTriangles[phase] = triangles;
    if (chunks > (this.phaseChunks[phase] as number)) this.phaseChunks[phase] = chunks;
    this.phaseEndAgl[phase] = Number.isFinite(aglM) ? aglM : 0;
  }

  /** One GPU time measurement (ms) of the timer query. */
  gpuSample(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0 || this.gpuN >= PERF_MAX_FRAMES) return;
    this.gpu[this.gpuN++] = ms;
  }

  get frames(): number {
    return this.total;
  }

  /** Cheap running numbers for the overlay (no sorting): frames, mean frame time, the phase of the last frame. */
  live(): { frames: number; meanMs: number; phase: number } {
    return { frames: this.total, meanMs: this.n > 0 ? this.sumMs / this.n : 0, phase: this.lastPhase };
  }

  /** The report section: sorts copies of the series, so call it for a report, not every frame. */
  section(meta: SectionMeta, gpuAvailable: boolean): PerfSceneSection {
    const n = this.n;
    const iv = sortedCopy(this.interval, n);
    const cpu = sortedCopy(this.cpu, n);
    const gpu = sortedCopy(this.gpu, this.gpuN);
    const mean = n > 0 ? this.sumMs / n : 0;
    const p95 = rank(iv, 0.95);
    const refreshMs = this.probeN > 0 ? medianOf(sortedCopy(this.probeMs, this.probeN)) : 0;
    const names = meta.phaseNames;
    const phases: PerfPhaseSummary[] = [];
    for (let p = 0; p < names.length; p++) {
      const v: number[] = [];
      for (let i = 0; i < n; i++) if (this.phaseOf[i] === p) v.push(this.interval[i] as number);
      v.sort((a, b) => a - b);
      let s = 0;
      for (const x of v) s += x;
      phases.push({
        name: names[p] as string,
        frames: v.length,
        meanMs: round(v.length > 0 ? s / v.length : 0),
        p95Ms: round(rank(v, 0.95)),
        medianMs: round(medianOf(v)),
        maxTriangles: this.phaseTriangles[p] ?? 0,
        maxChunks: this.phaseChunks[p] ?? 0,
        endAglM: round(this.phaseEndAgl[p] ?? 0, 1),
      });
    }
    let cpuSum = 0;
    for (let i = 0; i < n; i++) cpuSum += this.cpu[i] as number;
    let gpuSum = 0;
    for (let i = 0; i < gpu.length; i++) gpuSum += gpu[i] as number;
    const gpuMean = gpu.length > 0 ? gpuSum / gpu.length : null;
    const verdict = cappedVerdict(refreshMs, phases, medianOf(iv), gpuMean);
    return {
      name: 'perf',
      completed: meta.completed,
      quick: meta.quick,
      durationS: round(this.sumMs / 1000, 3),
      fxDurationS: round(meta.fxDurationS, 3),
      frames: this.total,
      truncated: this.total > n,
      frameMs: { mean: round(mean), p95: round(p95), max: round(n > 0 ? (iv[n - 1] as number) : 0) },
      fps: { mean: round(mean > 0 ? 1000 / mean : 0), p95: round(p95 > 0 ? 1000 / p95 : 0) },
      maxTriangles: this.maxTri,
      maxDrawCalls: this.maxCalls,
      maxChunks: this.maxChunkN,
      minAglM: round(Number.isFinite(this.minAgl) ? this.minAgl : 0, 1),
      canvas: meta.canvas,
      refresh: { measured: refreshMs > 0, samples: this.probeN, medianIntervalMs: round(refreshMs, 3), hz: round(refreshMs > 0 ? 1000 / refreshMs : 0, 1) },
      cadence: { edgesMs: [...PERF_CADENCE_EDGES_MS], counts: cadenceCounts(iv), refreshUnits: refreshUnitShares(iv, refreshMs) },
      cappedHint: verdict,
      cpuMs: { mean: round(n > 0 ? cpuSum / n : 0, 3), p95: round(rank(cpu, 0.95), 3) },
      gpuMs: { available: gpuAvailable && gpu.length > 0, samples: gpu.length, mean: round(gpuMean ?? 0, 3), p95: round(rank(gpu, 0.95), 3) },
      phases,
    };
  }
}

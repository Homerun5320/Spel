// Frame statistics for the performance overlay: a ring buffer of frame durations (ms) fed by the frame driver (the
// caller measures; this module never reads a clock), the mean fps and the p95 frame time.

export class FrameStats {
  private readonly ring: Float64Array;
  private count = 0;
  private head = 0;
  private total = 0;

  constructor(readonly capacity = 600) {
    this.ring = new Float64Array(capacity);
  }

  /** Records one frame duration in milliseconds (non-positive or non-finite values are ignored). */
  push(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.ring[this.head] = ms;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.total++;
  }

  /** Number of frames recorded since creation. */
  get frames(): number {
    return this.total;
  }

  /** Frame durations currently held (oldest to newest order is not guaranteed). */
  private values(): number[] {
    return Array.from(this.ring.subarray(0, this.count));
  }

  meanMs(): number {
    if (this.count === 0) return 0;
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.ring[i] as number;
    return s / this.count;
  }

  /** Mean fps over the window (1000 / mean frame time); 0 without frames. */
  meanFps(): number {
    const m = this.meanMs();
    return m > 0 ? 1000 / m : 0;
  }

  /** 95th percentile of the frame time (the slowest 5 % of frames start here); 0 without frames. */
  p95Ms(): number {
    if (this.count === 0) return 0;
    const v = this.values().sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1)] as number;
  }

  /** The fps that corresponds to the p95 frame time ("p95 fps": what the slowest 5 % of frames deliver). */
  p95Fps(): number {
    const p = this.p95Ms();
    return p > 0 ? 1000 / p : 0;
  }
}

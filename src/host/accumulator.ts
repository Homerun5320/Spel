// Fixed-timestep accumulator: turns the variable frame times of the caller into whole simulation ticks.
// The accumulator reads no clock; the caller passes the elapsed time of each frame.
import { MAX_TICKS_PER_FRAME, TICK_MS } from '../sim/rules';
import { isSpeed, type Speed } from './protocol';

export class FixedStepAccumulator {
  private acc = 0;
  private current: Speed = 1;

  constructor(
    private readonly stepMs: number = TICK_MS,
    private readonly maxTicksPerFrame: number = MAX_TICKS_PER_FRAME,
  ) {}

  get speed(): Speed {
    return this.current;
  }

  /** Sets the speed; anything but 0, 1, 2 or 4 is ignored. Time already collected is kept. */
  setSpeed(speed: Speed): boolean {
    if (!isSpeed(speed)) return false;
    this.current = speed;
    return true;
  }

  /** Leftover game time in ms that has not yet made a whole tick. */
  get pendingMs(): number {
    return this.acc;
  }

  /**
   * Adds `dtMs` of real time (scaled by the speed) and returns how many ticks to run now: floor(time / stepMs), at most
   * maxTicksPerFrame. A longer backlog is dropped, not queued (a stalled tab must not run a minute of game time in one
   * frame). Paused time, negative, NaN and infinite input add nothing.
   */
  advance(dtMs: number): number {
    if (this.current === 0 || !Number.isFinite(dtMs) || dtMs <= 0) return 0;
    this.acc += dtMs * this.current;
    const due = Math.floor(this.acc / this.stepMs);
    this.acc -= due * this.stepMs;
    return due > this.maxTicksPerFrame ? this.maxTicksPerFrame : due;
  }

  reset(): void {
    this.acc = 0;
  }
}

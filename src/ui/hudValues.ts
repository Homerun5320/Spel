// HUD value interpolation: the sim ticks at 10 Hz (1x) but the screen draws at 60 Hz, so a number shown as it is would jump
// ten times a second. `StatInterpolator` keeps the previous and the current per-seat statistics and returns a value between
// them for the fraction of the tick that has passed. Typed arrays only; nothing is allocated per frame.
import { STAT_COUNT, STAT_FIELDS, type StatField } from '../sim/view';

export class StatInterpolator {
  private readonly prev: Float64Array;
  private readonly cur: Float64Array;
  private primed = false;

  constructor(readonly seats: number) {
    this.prev = new Float64Array(STAT_COUNT * seats);
    this.cur = new Float64Array(STAT_COUNT * seats);
  }

  /** A new snapshot of the statistics (packed, as ViewMirror.stats shares them): the old current becomes the previous. */
  push(packed: ArrayLike<number>): void {
    if (!this.primed) {
      for (let i = 0; i < this.cur.length; i++) this.cur[i] = packed[i] as number;
      this.prev.set(this.cur);
      this.primed = true;
      return;
    }
    this.prev.set(this.cur);
    for (let i = 0; i < this.cur.length; i++) this.cur[i] = packed[i] as number;
  }

  /** The value of `field` for `seat` at fraction `alpha` (0..1) between the previous and the current snapshot. */
  value(field: StatField, seat: number, alpha: number): number {
    const i = STAT_FIELDS.indexOf(field) * this.seats + seat;
    const a = this.prev[i] as number;
    const b = this.cur[i] as number;
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    return a + (b - a) * t;
  }

  /** The current (not interpolated) value. */
  current(field: StatField, seat: number): number {
    return this.cur[STAT_FIELDS.indexOf(field) * this.seats + seat] as number;
  }
}

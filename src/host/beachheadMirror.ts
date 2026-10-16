// The page's copy of the beachhead table (Fix-4B): a `BeachheadView` over the rows of the last `BeachheadSnapshot` the host sent, replaced as a whole when a frame brings a new
// table (at most 64 rows; nothing is patched). The rows sit in slot order and the view is indexed by slot, so the arrays are spread out again on `adopt`.
import type { BeachheadView } from '../sim/view';
import { BEACHHEAD_CAPACITY } from '../sim/rules';
import type { BeachheadSnapshot } from './protocol';

export class MirrorBeachheads implements BeachheadView {
  readonly capacity = BEACHHEAD_CAPACITY;
  liveCount = 0;
  readonly owner = new Uint16Array(BEACHHEAD_CAPACITY);
  readonly seed = new Int32Array(BEACHHEAD_CAPACITY);
  readonly landTick = new Uint32Array(BEACHHEAD_CAPACITY);
  readonly status = new Uint8Array(BEACHHEAD_CAPACITY);
  private readonly cells = new Uint16Array(BEACHHEAD_CAPACITY);
  /** Increases whenever a new table was adopted. */
  version = 0;

  adopt(s: BeachheadSnapshot): void {
    this.owner.fill(0);
    this.seed.fill(0);
    this.landTick.fill(0);
    this.status.fill(0);
    this.cells.fill(0);
    for (let k = 0; k < s.count; k++) {
      const i = s.slot[k] as number;
      this.owner[i] = s.owner[k] as number;
      this.seed[i] = s.seed[k] as number;
      this.landTick[i] = s.landTick[k] as number;
      this.status[i] = s.status[k] as number;
      this.cells[i] = s.cells[k] as number;
    }
    this.liveCount = s.count;
    this.version++;
  }

  cellsOf(slot: number): number {
    return slot >= 0 && slot < BEACHHEAD_CAPACITY ? (this.cells[slot] as number) : 0;
  }
}

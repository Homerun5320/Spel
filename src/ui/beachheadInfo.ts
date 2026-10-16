// The beachhead of a helicopter landing, explained to the player (Fix-4B), pure: the count-down of the soonest own beachhead that is not yet ordinary land, the list of
// their seed cells for the ring, and the watcher that turns the table's change into the two toasts "the beachhead went back to neutral" / "the beachhead is established".
// It reads the read-only `SimView.beachheads` only; nothing here allocates per frame (the watcher looks only when the table version moved).
import { BEACHHEAD_ESTABLISH_CELLS, BEACHHEAD_REVERT_TICKS, seatToOwner, type SimView } from '../sim/public';
import { TICK_HZ } from './hudCodes';

/** Whole seconds left before a beachhead landed at `landTick` goes back to neutral at tick `tick` (rounded up, never below 0: the sim checks every 10 ticks, so it can read 0 for a moment). */
export function beachSecondsLeft(landTick: number, tick: number): number {
  const left = BEACHHEAD_REVERT_TICKS - (tick - landTick);
  return left <= 0 ? 0 : Math.ceil(left / TICK_HZ);
}

/** The soonest-ending own beachhead: its slot (-1 when the seat has none), the cells it holds, the cells it needs and the seconds left. */
export interface BeachChip {
  slot: number;
  cells: number;
  need: number;
  seconds: number;
}

/** Fills `out` with the own beachhead that goes back first; `out.slot` is -1 when there is none. No allocation. */
export function ownBeachChip(view: SimView, seat: number, out: BeachChip): BeachChip {
  const b = view.beachheads;
  const mine = seatToOwner(seat);
  out.slot = -1;
  out.cells = 0;
  out.need = BEACHHEAD_ESTABLISH_CELLS;
  out.seconds = 0;
  if (b.liveCount === 0) return out;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < b.capacity; i++) {
    if (b.owner[i] !== mine) continue;
    const land = b.landTick[i] as number;
    if (land < best) {
      best = land;
      out.slot = i;
    }
  }
  if (out.slot >= 0) {
    out.cells = b.cellsOf(out.slot);
    out.seconds = beachSecondsLeft(b.landTick[out.slot] as number, view.tick);
  }
  return out;
}

/** Writes the seed cells of the seat's beachheads into `out` (at most `out.length`) and returns how many. */
export function ownBeachSeeds(view: SimView, seat: number, out: Int32Array): number {
  const b = view.beachheads;
  const mine = seatToOwner(seat);
  let n = 0;
  if (b.liveCount === 0) return 0;
  for (let i = 0; i < b.capacity && n < out.length; i++) if (b.owner[i] === mine) out[n++] = b.seed[i] as number;
  return n;
}

export const BEACH_REVERTED = 1;
export const BEACH_ESTABLISHED = 2;

/**
 * Compares the seat's beachhead rows between two table versions. A row that is gone and whose seed cell is neutral again REVERTED (the sim hands the cluster back at the
 * deadline); a row that is gone and whose seed cell is still the seat's became ordinary land (ESTABLISHED), unless the seat still has another row, in which case the two
 * merged and nothing is said; a seed taken by somebody else says nothing (the fight is already on the screen). Returns a bit set; 0 on the first look.
 */
export class BeachheadWatcher {
  private version = -1;
  private readonly prevOwner = new Uint16Array(64);
  private readonly prevSeed = new Int32Array(64);
  private readonly prevLand = new Uint32Array(64);

  update(view: SimView, version: number, seat: number): number {
    if (version === this.version) return 0;
    const first = this.version < 0;
    this.version = version;
    const b = view.beachheads;
    const mine = seatToOwner(seat);
    let mineNow = 0;
    for (let i = 0; i < b.capacity; i++) if (b.owner[i] === mine) mineNow++;
    let news = 0;
    if (!first) {
      for (let i = 0; i < this.prevOwner.length; i++) {
        if (this.prevOwner[i] !== mine) continue;
        const same = b.owner[i] === mine && b.landTick[i] === this.prevLand[i];
        if (same) continue;
        const seedOwner = view.owner[this.prevSeed[i] as number] as number;
        if (seedOwner === 0) news |= BEACH_REVERTED;
        else if (seedOwner === mine && mineNow === 0) news |= BEACH_ESTABLISHED;
      }
    }
    for (let i = 0; i < this.prevOwner.length; i++) {
      const o = i < b.capacity ? (b.owner[i] as number) : 0;
      this.prevOwner[i] = o;
      this.prevSeed[i] = o === 0 ? 0 : (b.seed[i] as number);
      this.prevLand[i] = o === 0 ? 0 : (b.landTick[i] as number);
    }
    return news;
  }

  reset(): void {
    this.version = -1;
    this.prevOwner.fill(0);
  }
}

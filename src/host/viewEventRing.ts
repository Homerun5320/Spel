// The side-fact ring of the page channel (Events-1): a fixed Int32Array ring of `VIEW_EVENTS_CAP` events (kind, tick, a, b per event), allocated once.
// The host fills one per match from the outbox and empties it into every diff; a ViewMirror keeps one for the events it was sent and the consumer has not
// read yet. A push into a full ring drops the OLDEST event (the newest are kept) and counts it in `dropped`. Nothing here is game state.
import { VIEW_EVENTS_CAP, type ViewEventsView } from '../sim/view';

const EMPTY_PACKED = new Int32Array(0);

export class ViewEventRing implements ViewEventsView {
  private readonly data = new Int32Array(4 * VIEW_EVENTS_CAP);
  private start = 0;
  private count = 0;
  /** Events lost to the cap since the last `clear()`. */
  dropped = 0;
  /** Events ever pushed (never reset, not even by `clear()`): the sequence number readers keep their cursor in (Fix-6B). */
  pushed = 0;

  get length(): number {
    return this.count;
  }

  push(kind: number, tick: number, a: number, b: number): void {
    const cap = VIEW_EVENTS_CAP;
    this.pushed++;
    let slot: number;
    if (this.count === cap) {
      slot = this.start;
      this.start = this.start + 1 === cap ? 0 : this.start + 1;
      this.dropped++;
    } else {
      slot = this.start + this.count;
      if (slot >= cap) slot -= cap;
      this.count++;
    }
    const d = this.data;
    const at = slot * 4;
    d[at] = kind;
    d[at + 1] = tick;
    d[at + 2] = a;
    d[at + 3] = b;
  }

  private index(i: number): number {
    const s = this.start + i;
    return (s >= VIEW_EVENTS_CAP ? s - VIEW_EVENTS_CAP : s) * 4;
  }
  kindAt(i: number): number {
    return i >= 0 && i < this.count ? (this.data[this.index(i)] as number) : -1;
  }
  tickAt(i: number): number {
    return i >= 0 && i < this.count ? (this.data[this.index(i) + 1] as number) : -1;
  }
  aAt(i: number): number {
    return i >= 0 && i < this.count ? (this.data[this.index(i) + 2] as number) : 0;
  }
  bAt(i: number): number {
    return i >= 0 && i < this.count ? (this.data[this.index(i) + 3] as number) : 0;
  }

  /** The events, oldest first, as a fresh packed array (4 integers per event). No allocation when the ring is empty (a shared empty array: never transfer or write it). */
  toPacked(): Int32Array {
    const n = this.count;
    if (n === 0) return EMPTY_PACKED;
    const out = new Int32Array(n * 4);
    for (let i = 0; i < n; i++) out.set(this.data.subarray(this.index(i), this.index(i) + 4), i * 4);
    return out;
  }

  /** Appends packed events (oldest first) and adds `dropped` to the count; the cap applies as for `push`. No allocation. */
  appendPacked(packed: ArrayLike<number>, dropped: number): void {
    for (let i = 0; i + 3 < packed.length; i += 4) this.push(packed[i] as number, packed[i + 1] as number, packed[i + 2] as number, packed[i + 3] as number);
    this.dropped += dropped;
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
    this.dropped = 0;
  }

  /** The sequence number of the oldest event the ring still holds. */
  oldestSeq(): number {
    return this.pushed - this.count;
  }
}

/**
 * Fix-6B [2.7]: one consumer's window on the ring. Each reader keeps its OWN cursor (the sequence number of the first event it has not read), so any number of consumers
 * can read the same stream in one frame in any order and none can empty it for another: `read()` is the unread events (oldest first; `dropped` = the ones the cap took before
 * this reader looked), `commit()` marks them read at the end of the consumer's frame. The window object is reused: no allocation per frame. The ring itself is bounded (the
 * cap), so nothing has to clear it.
 */
export class EventReader implements ViewEventsView {
  private cursor = 0;
  private skip = 0;
  private count = 0;
  /** Events the cap took from this reader since its last `commit()`. */
  dropped = 0;

  constructor(private readonly ring: ViewEventRing) {}

  get length(): number {
    return this.count;
  }

  /** The window on the unread events (this object; valid until the next `read()` or `commit()`). */
  read(): ViewEventsView {
    const ring = this.ring;
    const oldest = ring.oldestSeq();
    const from = Math.min(Math.max(this.cursor, oldest), ring.pushed);
    this.skip = from - oldest;
    this.count = ring.pushed - from;
    this.dropped = from > this.cursor ? from - this.cursor : 0;
    return this;
  }

  /** Marks everything pushed so far as read. */
  commit(): void {
    this.cursor = this.ring.pushed;
    this.skip = 0;
    this.count = 0;
    this.dropped = 0;
  }

  kindAt(i: number): number {
    return i >= 0 && i < this.count ? this.ring.kindAt(this.skip + i) : -1;
  }
  tickAt(i: number): number {
    return i >= 0 && i < this.count ? this.ring.tickAt(this.skip + i) : -1;
  }
  aAt(i: number): number {
    return i >= 0 && i < this.count ? this.ring.aAt(this.skip + i) : 0;
  }
  bAt(i: number): number {
    return i >= 0 && i < this.count ? this.ring.bAt(this.skip + i) : 0;
  }
}

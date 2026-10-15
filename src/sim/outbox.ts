// The render-only outbox: events for visuals and the host (what was painted, which intent was refused). It is NOT part of
// the game state: not hashed, not serialised, never read by step(). Hosts drain it after every step.

export const OUTBOX_CAPACITY = 8192;

/** An intent was applied as a paint: a = cell, b = new ownerId. */
export const OUTBOX_PAINT = 1;
/** An intent was refused: a = reason (REJECT_*), b = 0. */
export const OUTBOX_REJECT = 2;
/** A seat was eliminated (it spawned and owns no cell any more): a = seat, b = 0. */
export const OUTBOX_ELIMINATED = 3;
/** A seat's capital cell is held by another owner (a transition, once): a = seat, b = 0. */
export const OUTBOX_CAPITAL_LOST = 4;
/** The match ended: a = ownerId of the winner (0 = none), b = WIN_REASON_*. */
export const OUTBOX_MATCH_END = 5;

export interface OutboxEvent {
  readonly kind: number;
  /** The tick of the step that produced the event (the tick before it was incremented). */
  readonly tick: number;
  readonly a: number;
  readonly b: number;
}

export class Outbox {
  /** The events as packed 32-bit integers (kind, tick, a, b per event; every value is a small integer): a push allocates nothing, the objects are made when the host drains. */
  private data = new Int32Array(4 * 256);
  private count = 0;
  /** Events refused since the last drain because the outbox was full. */
  dropped = 0;

  get length(): number {
    return this.count;
  }

  push(kind: number, tick: number, a: number, b: number): void {
    const n = this.count;
    if (n >= OUTBOX_CAPACITY) {
      this.dropped++;
      return;
    }
    let data = this.data;
    const at = n * 4;
    if (at === data.length) {
      const bigger = new Int32Array(at * 2);
      bigger.set(data);
      data = bigger;
      this.data = bigger;
    }
    data[at] = kind;
    data[at + 1] = tick;
    data[at + 2] = a;
    data[at + 3] = b;
    this.count = n + 1;
  }

  /** Hands over everything collected so far and starts empty; also resets `dropped`. */
  drain(): OutboxEvent[] {
    const out: OutboxEvent[] = [];
    const data = this.data;
    for (let i = 0; i < this.count; i++) {
      const at = i * 4;
      out.push({ kind: data[at] as number, tick: data[at + 1] as number, a: data[at + 2] as number, b: data[at + 3] as number });
    }
    this.count = 0;
    this.dropped = 0;
    return out;
  }

  clear(): void {
    this.count = 0;
    this.dropped = 0;
  }
}

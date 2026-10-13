// The render-only outbox: events for visuals and the host (what was painted, which intent was refused). It is NOT part of
// the game state: not hashed, not serialised, never read by step(). Hosts drain it after every step.

export const OUTBOX_CAPACITY = 8192;

/** An intent was applied as a paint: a = cell, b = new ownerId. */
export const OUTBOX_PAINT = 1;
/** An intent was refused: a = reason (REJECT_*), b = 0. */
export const OUTBOX_REJECT = 2;

export interface OutboxEvent {
  readonly kind: number;
  /** The tick of the step that produced the event (the tick before it was incremented). */
  readonly tick: number;
  readonly a: number;
  readonly b: number;
}

export class Outbox {
  private events: OutboxEvent[] = [];
  /** Events refused since the last drain because the outbox was full. */
  dropped = 0;

  get length(): number {
    return this.events.length;
  }

  push(kind: number, tick: number, a: number, b: number): void {
    if (this.events.length >= OUTBOX_CAPACITY) {
      this.dropped++;
      return;
    }
    this.events.push({ kind, tick, a, b });
  }

  /** Hands over everything collected so far and starts empty; also resets `dropped`. */
  drain(): OutboxEvent[] {
    const out = this.events;
    this.events = [];
    this.dropped = 0;
    return out;
  }

  clear(): void {
    this.events = [];
    this.dropped = 0;
  }
}

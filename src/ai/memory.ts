// What one AI seat remembers between thoughts. Plain numbers and one typed array, so a snapshot of it is trivial to serialise
// (M24b); nothing in it refers to the sim. The driver (src/host/aiDriver.ts) owns one memory per AI seat.
import { AI_ANCHOR_SEAT, AI_SPAWN_SPACING_TICKS, AI_THINK_PERIOD_TICKS, AI_THINK_STAGGER_TICKS, type SimView } from '../sim/public';

export interface AiMemory {
  readonly seat: number;
  /** The seat whose capital the AI places its own around (the human's; M06: a parameter of the match, default AI_ANCHOR_SEAT). */
  readonly anchor: number;
  /** A tribe: a seat after the players. Tribes only expand, and commit what the sim gives them whatever pct they send. */
  readonly tribe: boolean;
  /** Ticks after the release (the anchor seat's Spawn, or the wait limit) at which the seat tries its Spawn: the nations first, then the tribes, AI_SPAWN_SPACING_TICKS apart. */
  readonly slot: number;
  /** The tick the seat saw the release (-1 = not yet). */
  release: number;
  /** The seat thinks on the ticks where (tick + phase) is a multiple of AI_THINK_PERIOD_TICKS. */
  readonly phase: number;
  /** Earliest tick of the next Spawn try. */
  retryAt: number;
  /** Spawn tries so far (a counter for the tests and the report). */
  attempts: number;
  /** Tick of the last Attack this seat sent per target ownerId, -1 = never. */
  readonly lastAttack: Int32Array;
}

export interface AiMemoryOptions {
  /** The anchor seat (default AI_ANCHOR_SEAT). */
  readonly anchor?: number;
  /** Position of the seat in the Spawn order (default: seat - 1, i.e. seat 0 is the one human). With several or other human seats the driver counts the AI seats. */
  readonly order?: number;
}

/** The memory of `seat` in the match `view` describes. */
export function createAiMemory(view: SimView, seat: number, options: AiMemoryOptions = {}): AiMemory {
  const tribe = seat >= view.players;
  // Spawn order: the AI seats in seat order (the nations), then the first tribe, the second, ...; the human seats never think.
  const order = options.order ?? seat - 1;
  return {
    seat,
    anchor: options.anchor ?? AI_ANCHOR_SEAT,
    tribe,
    slot: order * AI_SPAWN_SPACING_TICKS,
    release: -1,
    phase: (seat * AI_THINK_STAGGER_TICKS) % AI_THINK_PERIOD_TICKS,
    retryAt: 0,
    attempts: 0,
    lastAttack: new Int32Array(view.seats + 1).fill(-1),
  };
}

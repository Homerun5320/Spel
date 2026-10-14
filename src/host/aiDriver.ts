// The AI driver: calls the AI (src/ai) for every non-human seat at every tick boundary, with the seat's own memory and a random
// stream of its own (derived from the match seed and the seat: never the sim's, never the UI's, never another seat's), and files what
// it answers through the host like any intent (effective at T + 2). It lives in the sim's thread: today beside the MainThreadHost,
// later (M24a) inside the Worker.
// Deterministic: the intents are a function of the seed, the tick and the state, so a replay with the same inputs repeats them.
// M06: which seats are human is a parameter (default: seat 0 only), the first human seat is the anchor the AI places its capitals
// around, and each AI seat draws from its own stream, so adding or removing one AI seat does not change what the others do with
// their random numbers (D118).
import { createAiMemory, think, type AiMemory } from '../ai';
import { createRng } from '../sim/public';
import type { SimView } from '../sim/view';
import type { IntentBody } from '../sim/intents';
import type { TickDriver } from './mainThreadHost';

/** Mixed into the match seed so that the AI's streams are not the sim's stream. */
const AI_STREAM_SALT = 0x41495f31;
/** Golden-ratio multiplier of the per-seat mix, and a tag that keeps seat 0 away from a zero product. */
const SEAT_MIX = 0x9e3779b1;
const SEAT_TAG = 0x5ea70000;
/** An intent sent at tick T runs in the step of tick T + 2, so the view shows its effect from tick T + 3. */
const SPAWN_VISIBLE_AFTER_TICKS = 3;

export interface AiDriverOptions {
  /** The human seats, which the AI never plays (default: seat 0). The first one is the anchor of the AI's capital places. */
  readonly humanSeats?: readonly number[];
}

/** The seed of the random stream of one AI seat: a mix of the match seed and the seat (distinct for every seat of a match). */
export function aiSeatSeed(seed: number, seat: number): number {
  return ((seed ^ AI_STREAM_SALT) + Math.imul(seat ^ SEAT_TAG, SEAT_MIX)) | 0;
}

export class AiDriver implements TickDriver {
  private readonly seed: number;
  private readonly humans: ReadonlySet<number>;
  private readonly anchor: number;
  private memories: Array<AiMemory | null> | null = null;
  private rngs: Uint32Array[] = [];
  /** Intents sent so far (a counter for the report and the tests). */
  sent = 0;
  /** Spawns that are on their way: the cell and the tick it was sent. A Spawn runs 2 ticks later, from the third tick on the view shows the capital and the entry is dropped. */
  private readonly flightCells: number[] = [];
  private readonly flightTicks: number[] = [];

  constructor(seed: number, options: AiDriverOptions = {}) {
    this.seed = seed;
    const humans = options.humanSeats ?? [0];
    this.humans = new Set(humans);
    this.anchor = humans.length > 0 ? (humans[0] as number) : 0;
  }

  /** The memory of an AI seat (null before the first tick, for a human seat and for seats out of range). */
  memoryOf(seat: number): AiMemory | null {
    return this.memories?.[seat] ?? null;
  }

  /** A copy of the state of the random stream of an AI seat (null for a human seat, a seat out of range and before the first tick): what the tests compare with `createRng(aiSeatSeed(seed, seat))`. */
  streamOf(seat: number): Uint32Array | null {
    const r = this.rngs[seat];
    return r === undefined || r.length === 0 ? null : r.slice();
  }

  /** True when the driver plays this seat. */
  plays(seat: number): boolean {
    return !this.humans.has(seat);
  }

  onTick(view: SimView, submit: (body: IntentBody) => void): void {
    if (this.memories === null) {
      this.memories = [];
      let order = 0;
      for (let seat = 0; seat < view.seats; seat++) {
        if (this.humans.has(seat)) {
          this.memories.push(null);
          this.rngs.push(new Uint32Array(0));
          continue;
        }
        this.memories.push(createAiMemory(view, seat, { anchor: this.anchor, order: order++ }));
        this.rngs.push(createRng(aiSeatSeed(this.seed, seat)));
      }
    }
    const memories = this.memories;
    const cells = this.flightCells;
    const ticks = this.flightTicks;
    let kept = 0;
    for (let i = 0; i < cells.length; i++) {
      if ((ticks[i] as number) + SPAWN_VISIBLE_AFTER_TICKS > view.tick) {
        cells[kept] = cells[i] as number;
        ticks[kept++] = ticks[i] as number;
      }
    }
    cells.length = kept;
    ticks.length = kept;
    for (let seat = 0; seat < memories.length; seat++) {
      const memory = memories[seat];
      if (memory === null || memory === undefined) continue;
      const out = think(view, memory, this.rngs[seat] as Uint32Array, cells);
      for (let k = 0; k < out.length; k++) {
        const body = out[k] as IntentBody;
        if (body.kind === 'Spawn') {
          cells.push(body.cell);
          ticks.push(view.tick);
        }
        submit(body);
        this.sent++;
      }
    }
  }
}

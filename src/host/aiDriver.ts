// The AI driver: calls the AI (src/ai) for every non-local seat at every tick boundary, with the seat's own memory and ONE
// random stream of its own (never the sim's, never the UI's), and files what it answers through the host like any intent
// (effective at T + 2). It lives in the sim's thread: today beside the MainThreadHost, later (M24a) inside the Worker.
// Deterministic: the intents are a function of the seed, the tick and the state, so a replay with the same inputs repeats them.
import { createAiMemory, think, type AiMemory } from '../ai';
import { createRng } from '../sim/public';
import type { SimView } from '../sim/view';
import type { IntentBody } from '../sim/intents';
import type { TickDriver } from './mainThreadHost';

/** Mixed into the match seed so that the AI's stream is not the sim's stream. */
const AI_STREAM_SALT = 0x41495f31;
/** Seat 0 is the human; every seat after it is an AI nation or a tribe. */
const FIRST_AI_SEAT = 1;
/** An intent sent at tick T runs in the step of tick T + 2, so the view shows its effect from tick T + 3. */
const SPAWN_VISIBLE_AFTER_TICKS = 3;

export class AiDriver implements TickDriver {
  private readonly rng: Uint32Array;
  private memories: AiMemory[] | null = null;
  /** Intents sent so far (a counter for the report and the tests). */
  sent = 0;
  /** Spawns that are on their way: the cell and the tick it was sent. A Spawn runs 2 ticks later, from the third tick on the view shows the capital and the entry is dropped. */
  private readonly flightCells: number[] = [];
  private readonly flightTicks: number[] = [];

  constructor(seed: number) {
    this.rng = createRng((seed ^ AI_STREAM_SALT) | 0);
  }

  /** The memory of an AI seat (null before the first tick, for seat 0 and for seats out of range). */
  memoryOf(seat: number): AiMemory | null {
    return this.memories?.[seat - FIRST_AI_SEAT] ?? null;
  }

  onTick(view: SimView, submit: (body: IntentBody) => void): void {
    if (this.memories === null) {
      this.memories = [];
      for (let seat = FIRST_AI_SEAT; seat < view.seats; seat++) this.memories.push(createAiMemory(view, seat));
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
    for (let i = 0; i < memories.length; i++) {
      const out = think(view, memories[i] as AiMemory, this.rng, cells);
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

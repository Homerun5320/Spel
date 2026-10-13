// A 12-player + 20-tribe match on the real 1024x512 world, stepped tick by tick with the scripted bots of tools/sim. Shared by
// the work-counter tests and the perf tests.
import { IdAllocator, withId, type Intent, type IntentBody } from '../../src/sim/intents';
import { OUTBOX_PAINT } from '../../src/sim/outbox';
import { step } from '../../src/sim/step';
import { type GameState } from '../../src/sim/state';
import { createWorldState, type SimWorld } from '../../src/sim/world';
import { botIntents, type BotKind } from '../../tools/sim/bots';
import { loadRealWorld } from '../../tools/sim/realWorld';
import { largestCountries, pickCountries } from '../../tools/sim/scenario';

export interface RealMatch {
  /** The state being stepped (replaced by `swap`). */
  state: GameState;
  readonly world: SimWorld;
  /** Steps one tick (the Spawns on tick 0, the bots after it). Returns the milliseconds the step took, and how many cells changed owner. */
  tick(): { ms: number; paints: number };
  /** Carries on with another state (a snapshot that was deserialized); the id counters of the bots' intents go on. */
  swap(next: GameState): void;
}

export async function startRealMatch(seed = 1, players = 12, tribes = 20, fighters = true): Promise<RealMatch> {
  const world = await loadRealWorld();
  const seats = players + tribes;
  const state = createWorldState(world, { seed, seats, players });
  const countries = pickCountries(largestCountries(world), seats, seed, null);
  const alloc = new IdAllocator();
  const kinds: BotKind[] = [];
  for (let seat = 0; seat < seats; seat++) kinds.push(seat < players && fighters ? 'fighter' : 'expander');
  const match: RealMatch = {
    state,
    world,
    swap(next) {
      match.state = next;
    },
    tick() {
      const state = match.state;
      const bodies: IntentBody[] = [];
      if (state.tick === 0) for (let seat = 0; seat < seats; seat++) bodies.push({ kind: 'Spawn', seat, cell: countries[seat]?.capitalCell as number });
      else for (let seat = 0; seat < seats; seat++) bodies.push(...botIntents(state, seat, kinds[seat] as BotKind));
      const intents: Intent[] = bodies.map((b) => withId(b, alloc.alloc(b.seat)));
      const t0 = performance.now();
      const r = step(state, { turn: state.tick, intents });
      const ms = performance.now() - t0;
      if (!r.ok) throw new Error(`step failed: ${r.error}`);
      let paints = 0;
      for (const e of state.outbox.drain()) if (e.kind === OUTBOX_PAINT) paints++;
      return { ms, paints };
    },
  };
  return match;
}

// Properties over random matches (fast-check, 500 runs each): determinism, snapshot-and-resume, intent order.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Intent } from '../../src/sim/intents';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { createEmptyState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { smallMatchIntent } from './helpers/arbitraries';

const W = 6;
const H = 5;
const SEATS = 4;
const RUNS = 500;

const matchArb = fc.record({
  seed: fc.integer({ min: -2147483648, max: 4294967295 }),
  turns: fc.array(fc.array(smallMatchIntent(SEATS, W * H), { maxLength: 6 }), { minLength: 1, maxLength: 40 }),
  debug: fc.boolean(),
});

function fresh(seed: number, debug: boolean): GameState {
  return createEmptyState(W, H, seed, SEATS, { debugIntents: debug });
}

function runTurns(s: GameState, turns: readonly Intent[][], from = 0, hashes?: number[]): void {
  for (let t = from; t < turns.length; t++) {
    const r = step(s, { turn: s.tick, intents: turns[t] as Intent[] });
    if (!r.ok) throw new Error(`step failed at ${t}: ${r.error}`);
    hashes?.push(hashState(s));
  }
}

describe('properties (500 runs each)', () => {
  it('the same seed and the same intents give the same hash at every tick', () => {
    fc.assert(
      fc.property(matchArb, ({ seed, turns, debug }) => {
        const a: number[] = [];
        const b: number[] = [];
        runTurns(fresh(seed, debug), turns, 0, a);
        runTurns(fresh(seed, debug), turns, 0, b);
        expect(a).toEqual(b);
      }),
      { numRuns: RUNS },
    );
  });

  it('a snapshot at tick k plus the remaining intents equals the straight run', () => {
    fc.assert(
      fc.property(matchArb, fc.nat(), ({ seed, turns, debug }, kRaw) => {
        const k = kRaw % (turns.length + 1);
        const straight = fresh(seed, debug);
        runTurns(straight, turns);

        const first = fresh(seed, debug);
        runTurns(first, turns.slice(0, k));
        const r = deserialize(serialize(first));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(hashState(r.state)).toBe(hashState(first));
        runTurns(r.state, turns, k);
        expect(hashState(r.state)).toBe(hashState(straight));
        expect(r.state.rng).toEqual(straight.rng);
        expect(r.state.rejects).toBe(straight.rejects);
      }),
      { numRuns: RUNS },
    );
  });

  it('the order of the intents inside every turn does not matter (ties are resolved by seat and id)', () => {
    fc.assert(
      fc.property(matchArb, fc.infiniteStream(fc.nat()), ({ seed, turns, debug }, rnd) => {
        const it = rnd[Symbol.iterator]();
        const shuffled = turns.map((list) => {
          const out = [...list];
          for (let i = out.length - 1; i > 0; i--) {
            const j = (it.next().value as number) % (i + 1);
            [out[i], out[j]] = [out[j] as Intent, out[i] as Intent];
          }
          return out;
        });
        const a = fresh(seed, debug);
        const b = fresh(seed, debug);
        runTurns(a, turns);
        runTurns(b, shuffled);
        expect(hashState(b)).toBe(hashState(a));
      }),
      { numRuns: RUNS },
    );
  });

  it('a different seed changes the hash (500 pairs of seeds)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 1000 }), (seed, delta) => {
        const a = fresh(seed, true);
        const b = fresh(seed + delta, true);
        runTurns(a, [[], []]);
        runTurns(b, [[], []]);
        expect(hashState(a)).not.toBe(hashState(b));
      }),
      { numRuns: RUNS },
    );
  });
});

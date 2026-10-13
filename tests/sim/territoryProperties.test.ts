// Properties of random matches WITH land: determinism, snapshot-and-resume, intent order, aggregates, economy bounds.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ownerCapQt } from '../../src/sim/economy';
import type { Intent } from '../../src/sim/intents';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { CLASS_DEEP_SEA, CLASS_FOREST, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS } from '../../src/sim/terrain';

const W = 40;
const H = 24;
const SEATS = 5;
const PLAYERS = 3;
const RUNS = 150;
const CLASSES = [CLASS_PLAINS, CLASS_FOREST, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_DEEP_SEA, CLASS_PLAINS, CLASS_PLAINS];

function fresh(seed: number, debug: boolean): GameState {
  const terrain = new Uint8Array(W * H);
  for (let i = 0; i < terrain.length; i++) terrain[i] = CLASSES[(Math.imul(i ^ seed, 2654435761) >>> 20) & 7] as number;
  return createState({ width: W, height: H, seed, seats: SEATS, players: PLAYERS, config: { debugIntents: debug }, terrain, elevation: new Uint16Array(W * H) });
}

const intent = fc.oneof(
  { weight: 5, arbitrary: fc.record({ kind: fc.constant('Spawn' as const), seat: fc.integer({ min: 0, max: SEATS }), id: fc.integer({ min: 0, max: 20 }), cell: fc.integer({ min: 0, max: W * H }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('DebugPaint' as const), seat: fc.integer({ min: 0, max: SEATS - 1 }), id: fc.integer({ min: 0, max: 20 }), cell: fc.integer({ min: 0, max: W * H - 1 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('Noop' as const), seat: fc.integer({ min: 0, max: SEATS - 1 }), id: fc.integer({ min: 0, max: 20 }) }) },
);

const matchArb = fc.record({
  seed: fc.integer({ min: 0, max: 100000 }),
  turns: fc.array(fc.array(intent, { maxLength: 4 }), { minLength: 1, maxLength: 60 }),
  debug: fc.boolean(),
});

function run(s: GameState, turns: readonly (readonly Intent[])[], from = 0, trace?: number[]): void {
  for (let t = from; t < turns.length; t++) {
    const r = step(s, { turn: s.tick, intents: turns[t] as Intent[] });
    if (!r.ok) throw new Error(`step failed: ${r.error}`);
    trace?.push(hashState(s));
  }
}

describe('territory properties', () => {
  it('same seed and intents, same hash at every tick (Spawn and the economy included)', () => {
    fc.assert(
      fc.property(matchArb, ({ seed, turns, debug }) => {
        const a: number[] = [];
        const b: number[] = [];
        run(fresh(seed, debug), turns, 0, a);
        run(fresh(seed, debug), turns, 0, b);
        expect(a).toEqual(b);
      }),
      { numRuns: RUNS },
    );
  });

  it('a snapshot at tick k plus the remaining turns equals the straight run, with territory and economy active', () => {
    fc.assert(
      fc.property(matchArb, fc.nat(), ({ seed, turns, debug }, kRaw) => {
        const k = kRaw % (turns.length + 1);
        const straight = fresh(seed, debug);
        run(straight, turns);
        const first = fresh(seed, debug);
        run(first, turns.slice(0, k));
        const r = deserialize(serialize(first));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(hashState(r.state)).toBe(hashState(first));
        run(r.state, turns, k);
        expect(hashState(r.state)).toBe(hashState(straight));
      }),
      { numRuns: RUNS },
    );
  });

  it('the order of the intents inside a turn does not matter', () => {
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
        run(a, turns);
        run(b, shuffled);
        expect(hashState(a)).toBe(hashState(b));
      }),
      { numRuns: RUNS },
    );
  });

  it('after any run: the aggregates equal a rebuild, nobody owns an unplayable cell via Spawn, troops stay within bounds, remainders below one QT, mark is clean', () => {
    fc.assert(
      fc.property(matchArb, ({ seed, turns }) => {
        const s = fresh(seed, false); // no debug paints: only Spawn changes ownership
        run(s, turns);
        const area = Array.from(s.agg.area);
        const warea = Array.from(s.agg.warea);
        rebuildAggregates(s);
        expect(Array.from(s.agg.area)).toEqual(area);
        expect(Array.from(s.agg.warea)).toEqual(warea);
        for (let c = 0; c < W * H; c++) if (s.owner[c] !== 0) expect(s.grid.playable[c]).toBe(1);
        for (let o = 1; o <= SEATS; o++) {
          expect(s.troopFrac[o]).toBeLessThan(1000000);
          if (area[o] === 0) {
            expect(s.troops[o]).toBe(0);
            expect(s.gold[o]).toBe(0);
          } else {
            expect(s.troops[o]).toBeLessThanOrEqual(ownerCapQt(s, o));
            expect(s.capital[o]).toBeGreaterThan(0);
          }
        }
        expect(Array.from(s.scratch.mark).every((m) => m === 0)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});

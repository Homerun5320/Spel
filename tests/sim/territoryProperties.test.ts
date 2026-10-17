// Properties of random matches WITH land: determinism, snapshot-and-resume, intent order, aggregates, economy bounds.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { freshTerritoryMatch, OVER_CAP_MATCH, REFUND_OVER_CAP_MATCH } from './helpers/overCapMatch';
import { ownerCapQt } from '../../src/sim/economy';
import type { Intent } from '../../src/sim/intents';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { rebuildAggregates, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';

const W = 40;
const H = 24;
const SEATS = 5;
const RUNS = 150;

function fresh(seed: number, debug: boolean): GameState {
  return freshTerritoryMatch(seed, debug);
}

const intent = fc.oneof(
  { weight: 5, arbitrary: fc.record({ kind: fc.constant('Spawn' as const), seat: fc.integer({ min: 0, max: SEATS }), id: fc.integer({ min: 0, max: 20 }), cell: fc.integer({ min: 0, max: W * H }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('DebugPaint' as const), seat: fc.integer({ min: 0, max: SEATS - 1 }), id: fc.integer({ min: 0, max: 20 }), cell: fc.integer({ min: 0, max: W * H - 1 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('Noop' as const), seat: fc.integer({ min: 0, max: SEATS - 1 }), id: fc.integer({ min: 0, max: 20 }) }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('Attack' as const), seat: fc.integer({ min: 0, max: SEATS - 1 }), id: fc.integer({ min: 0, max: 20 }), target: fc.integer({ min: 0, max: SEATS }), pct: fc.integer({ min: 1, max: 100 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('CancelAttack' as const), seat: fc.integer({ min: 0, max: SEATS - 1 }), id: fc.integer({ min: 0, max: 20 }), target: fc.integer({ min: 0, max: SEATS }) }) },
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
          const out: Intent[] = [...list];
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
    // M05fix (D111): troops above the cap are the economy's soft rule, not an error. They arise in exactly two ways: the seat LOSES
    // land (its cap falls and the troops stay, then decay) and an attack ENDS (its committed troops go back to the seat, which may lift it
    // above the cap, then decay; D82). So the property is stated per tick: nothing but those two events leaves a seat above
    // max(cap now, troops the tick before) - the refund of an attack that vanished in this tick counts as allowed slack -
    // and the strict "troops <= cap" at the end of the run holds for every seat that had neither event.
    fc.assert(
      fc.property(matchArb, ({ seed, turns }) => {
        const s = fresh(seed, false); // no debug paints: only Spawn changes ownership
        const surplusPossible: boolean[] = new Array<boolean>(SEATS + 1).fill(false);
        const prevCap: number[] = new Array<number>(SEATS + 1).fill(0);
        const prevTroops: number[] = new Array<number>(SEATS + 1).fill(0);
        const prevHeld: boolean[] = new Array<boolean>(SEATS + 1).fill(false);
        for (const intents of turns) {
          const committed = new Map<number, { attacker: number; troops: number }>();
          for (const a of s.attacks.list) committed.set(a.id, { attacker: a.attacker, troops: a.troops });
          const r = step(s, { turn: s.tick, intents: intents as Intent[] });
          if (!r.ok) throw new Error(`step failed: ${r.error}`);
          const refundSlack: number[] = new Array<number>(SEATS + 1).fill(0);
          for (const a of s.attacks.list) committed.delete(a.id);
          for (const gone of committed.values()) refundSlack[gone.attacker] = (refundSlack[gone.attacker] as number) + gone.troops;
          for (let o = 1; o <= SEATS; o++) {
            const held = (s.agg.area[o] as number) > 0;
            const cap = held ? ownerCapQt(s, o) : 0;
            if (held && prevHeld[o]) {
              if (cap < (prevCap[o] as number) || (refundSlack[o] as number) > 0) surplusPossible[o] = true;
              expect(s.troops[o], `owner ${o} at tick ${s.tick}`).toBeLessThanOrEqual(Math.max(cap, (prevTroops[o] as number) + (refundSlack[o] as number)));
            } else surplusPossible[o] = false; // a new (or wiped) seat starts again
            prevHeld[o] = held;
            prevCap[o] = cap;
            prevTroops[o] = s.troops[o] as number;
          }
        }
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
            if (!surplusPossible[o]) expect(s.troops[o]).toBeLessThanOrEqual(ownerCapQt(s, o));
            expect(s.capital[o]).toBeGreaterThan(0);
          }
        }
        expect(Array.from(s.scratch.mark).every((m) => m === 0)).toBe(true);
      }),
      { numRuns: RUNS, examples: [[OVER_CAP_MATCH], [REFUND_OVER_CAP_MATCH]] },
    );
  });
});

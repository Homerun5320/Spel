import fc from 'fast-check';
import type { Intent, IntentBody, TurnIntents } from '../../../src/sim/intents';

const u32 = fc.integer({ min: 0, max: 4294967295 });
const u8 = fc.integer({ min: 0, max: 255 });

/** Any intent the wire can carry (no regard for whether a state would accept it). */
export const wireIntent: fc.Arbitrary<Intent> = fc.oneof(
  fc.record({ kind: fc.constant('Noop' as const), seat: u8, id: u32 }),
  fc.record({ kind: fc.constant('DebugPaint' as const), seat: u8, id: u32, cell: u32 }),
  fc.record({ kind: fc.constant('Spawn' as const), seat: u8, id: u32, cell: u32 }),
);

/** Mostly small numbers so that varints of every length and valid seats / cells occur often. */
export const mixedIntent: fc.Arbitrary<Intent> = fc.oneof(
  wireIntent,
  fc.record({ kind: fc.constant('Noop' as const), seat: fc.integer({ min: 0, max: 5 }), id: fc.integer({ min: 0, max: 300 }) }),
  fc.record({
    kind: fc.constant('DebugPaint' as const),
    seat: fc.integer({ min: 0, max: 5 }),
    id: fc.integer({ min: 0, max: 300 }),
    cell: fc.integer({ min: 0, max: 40 }),
  }),
  fc.record({
    kind: fc.constant('Spawn' as const),
    seat: fc.integer({ min: 0, max: 5 }),
    id: fc.integer({ min: 0, max: 300 }),
    cell: fc.integer({ min: 0, max: 40 }),
  }),
);

export const wireTurn: fc.Arbitrary<TurnIntents> = fc.record({ turn: u32, intents: fc.array(wireIntent, { maxLength: 30 }) });

/** Intents for a tiny match (4 seats, 6x5 cells): valid ones dominate, invalid ones occur. */
export function smallMatchIntent(seats: number, cells: number): fc.Arbitrary<Intent> {
  return fc.oneof(
    { weight: 6, arbitrary: fc.record({ kind: fc.constant('DebugPaint' as const), seat: fc.integer({ min: 0, max: seats - 1 }), id: fc.integer({ min: 0, max: 12 }), cell: fc.integer({ min: 0, max: cells - 1 }) }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('Noop' as const), seat: fc.integer({ min: 0, max: seats - 1 }), id: fc.integer({ min: 0, max: 12 }) }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('Spawn' as const), seat: fc.integer({ min: 0, max: seats - 1 }), id: fc.integer({ min: 0, max: 12 }), cell: fc.integer({ min: 0, max: cells - 1 }) }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('DebugPaint' as const), seat: fc.integer({ min: 0, max: seats + 2 }), id: fc.integer({ min: 0, max: 12 }), cell: fc.integer({ min: 0, max: cells + 3 }) }) },
  );
}

export type { IntentBody };

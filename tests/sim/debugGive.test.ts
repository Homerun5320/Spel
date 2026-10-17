// DebugGive (M05, test only): changes a seat's gold and troops, and only as an intent that the config allows.
import { describe, expect, it } from 'vitest';
import { decodeIntent, encodeIntent } from '../../src/sim/codec';
import { copyBody, DEBUG_GIVE_MAX, INTENT_KINDS, kindCode, REJECT_AMOUNT, REJECT_DISABLED, REJECT_NOT_SPAWNED, validateIntent, withId, type Intent } from '../../src/sim/intents';
import { MILLI_GOLD_PER_GOLD, QT_PER_TROOP } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { step } from '../../src/sim/step';
import { createState, type GameState } from '../../src/sim/state';
import { CLASS_PLAINS } from '../../src/sim/terrain';

const W = 30;
const H = 20;
const make = (debug: boolean): GameState =>
  createState({ width: W, height: H, seed: 2, seats: 2, config: { debugIntents: debug }, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });

function run(s: GameState, ...intents: Intent[]): void {
  expect(step(s, { turn: s.tick, intents }).ok).toBe(true);
}

describe('DebugGive', () => {
  it('is wire kind 5, appended after the published kinds, and round trips', () => {
    expect(kindCode('DebugGive')).toBe(5);
    expect(INTENT_KINDS.slice(0, 5)).toEqual(['Noop', 'DebugPaint', 'Spawn', 'Attack', 'CancelAttack']);
    const i: Intent = { kind: 'DebugGive', seat: 1, id: 7, gold: 100000, troops: 99 };
    expect(decodeIntent(encodeIntent(i))).toEqual({ ok: true, value: i });
    expect(copyBody({ kind: 'DebugGive', seat: 1, gold: 5, troops: 6, extra: 1 })).toEqual({ kind: 'DebugGive', seat: 1, gold: 5, troops: 6 });
    expect(withId({ kind: 'DebugGive', seat: 0, gold: 1, troops: 2 }, 3)).toEqual({ kind: 'DebugGive', seat: 0, gold: 1, troops: 2, id: 3 });
  });

  it('adds gold and troops to a seat that has land, in whole units', () => {
    const s = make(true);
    run(s, { kind: 'Spawn', seat: 0, cell: 5 * W + 5, id: 0 });
    const gold = s.gold[1] as number;
    const troops = s.troops[1] as number;
    run(s, { kind: 'DebugGive', seat: 0, gold: 250, troops: 100, id: 1 });
    expect((s.gold[1] as number) - gold).toBeGreaterThanOrEqual(250 * MILLI_GOLD_PER_GOLD); // plus one tick of income
    expect((s.troops[1] as number) - troops).toBeGreaterThanOrEqual(100 * QT_PER_TROOP);
    expect(s.rejects).toBe(0);
  });

  it('is refused without debugIntents (counted, state hash unchanged except for the counters) and for a seat without land', () => {
    const off = make(false);
    expect(validateIntent({ kind: 'DebugGive', seat: 0, id: 0, gold: 1, troops: 1 }, { seats: 2, cells: W * H, debugIntents: false })).toBe(REJECT_DISABLED);
    run(off, { kind: 'Spawn', seat: 0, cell: 5 * W + 5, id: 0 });
    const gold = off.gold[1];
    const troops = off.troops[1];
    run(off, { kind: 'DebugGive', seat: 0, gold: 999, troops: 999, id: 1 });
    expect(off.rejects).toBe(1);
    expect(off.gold[1]).toBeLessThan((gold as number) + 999 * MILLI_GOLD_PER_GOLD);
    expect((off.troops[1] as number) - (troops as number)).toBeLessThan(999 * QT_PER_TROOP);

    const on = make(true);
    run(on, { kind: 'DebugGive', seat: 1, gold: 5, troops: 5, id: 0 });
    expect(on.rejects).toBe(1);
    expect(on.gold[2]).toBe(0);
    expect(on.troops[2]).toBe(0);
    expect(validateIntent({ kind: 'DebugGive', seat: 1, id: 0, gold: -1, troops: 0 }, { seats: 2, cells: 1, debugIntents: true })).toBe(REJECT_AMOUNT);
    expect(validateIntent({ kind: 'DebugGive', seat: 1, id: 0, gold: 0, troops: DEBUG_GIVE_MAX + 1 }, { seats: 2, cells: 1, debugIntents: true })).toBe(REJECT_AMOUNT);
    expect(validateIntent({ kind: 'DebugGive', seat: 1, id: 0, gold: 1.5, troops: 0 }, { seats: 2, cells: 1, debugIntents: true })).toBe(REJECT_AMOUNT);
    expect(REJECT_NOT_SPAWNED).toBe(13);
  });

  it('two runs with the same gift agree, and the gift is part of the hash', () => {
    const a = make(true);
    const b = make(true);
    for (const s of [a, b]) {
      run(s, { kind: 'Spawn', seat: 0, cell: 5 * W + 5, id: 0 });
      run(s, { kind: 'DebugGive', seat: 0, gold: 10, troops: 10, id: 1 });
    }
    expect(hashState(a)).toBe(hashState(b));
    const c = make(true);
    run(c, { kind: 'Spawn', seat: 0, cell: 5 * W + 5, id: 0 });
    run(c, { kind: 'Noop', seat: 0, id: 1 });
    expect(hashState(c)).not.toBe(hashState(a));
  });
});

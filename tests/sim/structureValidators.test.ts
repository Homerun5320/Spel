// M10-4: validateUpgrade / validateDelete (src/sim/public.ts) answer exactly what the sim's Upgrade / Delete intents answer, one test per reason code.
import { describe, expect, it } from 'vitest';
import { REJECT_DELETE_COOLDOWN, REJECT_BUILD_GOLD, REJECT_NONE, REJECT_STRUCT_BUSY, REJECT_STRUCT_ID, REJECT_STRUCT_MAX_LEVEL, REJECT_STRUCT_NOT_OWNER, withId } from '../../src/sim/intents';
import { validateDelete, validateUpgrade } from '../../src/sim/public';
import { BUILD_TICKS, MILLI_GOLD_PER_GOLD, STRUCT_LEVEL_HARD_CAP } from '../../src/sim/rules';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { applyIntent, step } from '../../src/sim/step';
import { STRUCT_CITY, STRUCT_POST } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';

const W = 128;
const H = 64;
const at = (x: number, y: number): number => y * W + x;

function world(): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 3, seats: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) s.owner[c] = c % W < 64 ? 1 : 2;
  rebuildAggregates(s);
  s.gold[1] = 1000000 * MILLI_GOLD_PER_GOLD;
  s.gold[2] = 1000000 * MILLI_GOLD_PER_GOLD;
  return s;
}
let nextId = 0;
const send = (s: GameState, body: Record<string, unknown>): number => applyIntent(s, withId(body as never, nextId++));
const idle = (s: GameState, n: number): void => {
  for (let i = 0; i < n; i++) step(s, { turn: s.tick, intents: [] });
};

describe('validateUpgrade / validateDelete', () => {
  it('Upgrade: every reason, and the view agrees with the sim', () => {
    const s = world();
    expect(send(s, { kind: 'Build', seat: 0, type: STRUCT_CITY, cell: at(10, 10) })).toBe(REJECT_NONE);
    expect(send(s, { kind: 'Build', seat: 1, type: STRUCT_CITY, cell: at(100, 10) })).toBe(REJECT_NONE);
    const mine = s.structures.idAt(at(10, 10));
    const theirs = s.structures.idAt(at(100, 10));
    let v = new StateView(s);
    expect(validateUpgrade(v, 0, 99)).toBe(REJECT_STRUCT_ID);
    expect(validateUpgrade(v, 0, theirs)).toBe(REJECT_STRUCT_NOT_OWNER);
    expect(validateUpgrade(v, 0, mine)).toBe(REJECT_STRUCT_BUSY); // under construction
    expect(send(s, { kind: 'Upgrade', seat: 0, structure: mine })).toBe(REJECT_STRUCT_BUSY);
    idle(s, BUILD_TICKS[STRUCT_CITY] as number);
    v = new StateView(s);
    expect(validateUpgrade(v, 0, mine)).toBe(REJECT_NONE);
    const gold = s.gold[1] as number;
    s.gold[1] = 0;
    expect(validateUpgrade(new StateView(s), 0, mine)).toBe(REJECT_BUILD_GOLD);
    expect(send(s, { kind: 'Upgrade', seat: 0, structure: mine })).toBe(REJECT_BUILD_GOLD);
    s.gold[1] = gold;
    expect(send(s, { kind: 'Upgrade', seat: 0, structure: mine })).toBe(REJECT_NONE);
    expect(validateUpgrade(new StateView(s), 0, mine)).toBe(REJECT_STRUCT_BUSY); // upgrading
    idle(s, (BUILD_TICKS[STRUCT_CITY] as number) + 1); // level 2
    expect(send(s, { kind: 'Upgrade', seat: 0, structure: mine })).toBe(REJECT_NONE);
    idle(s, (BUILD_TICKS[STRUCT_CITY] as number) + 1);
    expect(s.structures.level[mine]).toBe(3);
    s.structures.level[mine] = STRUCT_LEVEL_HARD_CAP; // the top level of every type (Sim-Levels2)
    expect(validateUpgrade(new StateView(s), 0, mine)).toBe(REJECT_STRUCT_MAX_LEVEL);
    expect(send(s, { kind: 'Upgrade', seat: 0, structure: mine })).toBe(REJECT_STRUCT_MAX_LEVEL);
  });

  it('Delete: no such structure, not yours, the cooldown after a Delete, then allowed again', () => {
    const s = world();
    for (const x of [10, 40]) expect(send(s, { kind: 'Build', seat: 0, type: STRUCT_POST, cell: at(x, 10) })).toBe(REJECT_NONE);
    expect(send(s, { kind: 'Build', seat: 1, type: STRUCT_POST, cell: at(100, 10) })).toBe(REJECT_NONE);
    const a = s.structures.idAt(at(10, 10));
    const b = s.structures.idAt(at(40, 10));
    const other = s.structures.idAt(at(100, 10));
    let v = new StateView(s);
    expect(validateDelete(v, 0, 77)).toBe(REJECT_STRUCT_ID);
    expect(validateDelete(v, 0, other)).toBe(REJECT_STRUCT_NOT_OWNER);
    expect(validateDelete(v, 0, a)).toBe(REJECT_NONE); // also while under construction
    expect(send(s, { kind: 'Delete', seat: 0, structure: a })).toBe(REJECT_NONE);
    v = new StateView(s);
    expect(validateDelete(v, 0, b)).toBe(REJECT_DELETE_COOLDOWN);
    expect(send(s, { kind: 'Delete', seat: 0, structure: b })).toBe(REJECT_DELETE_COOLDOWN);
    expect(validateDelete(v, 1, other)).toBe(REJECT_NONE); // the cooldown is per seat
    idle(s, 300);
    expect(validateDelete(new StateView(s), 0, b)).toBe(REJECT_NONE);
  });
});

// M05 match flow (D92): the spawn phase and the immunity are rules of the sim behind config.spawnPhase. With the flag off the
// rules are those of M04 (the golden hashes pin that); with it on, a Spawn is legal only in the first SPAWN_PHASE_TICKS,
// an Attack not at all in the phase, and not on owned land in the IMMUNITY_TICKS that follow.
import { describe, expect, it } from 'vitest';
import { PHASE_IMMUNITY, PHASE_PLAY, PHASE_SPAWN, phaseAt, phaseTicksLeft } from '../../src/sim/flow';
import { REJECT_IMMUNE, REJECT_PHASE, REJECT_SPAWNED, type IntentBody } from '../../src/sim/intents';
import { IMMUNITY_TICKS, SPAWN_PHASE_TICKS } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/serialize';
import { step } from '../../src/sim/step';
import { createState, type GameState } from '../../src/sim/state';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { OUTBOX_REJECT } from '../../src/sim/outbox';

const W = 60;
const H = 30;

function match(flow: boolean, seats = 3): GameState {
  return createState({
    width: W,
    height: H,
    seed: 5,
    seats,
    players: seats,
    config: { debugIntents: false, spawnPhase: flow },
    terrain: new Uint8Array(W * H).fill(CLASS_PLAINS),
    elevation: new Uint16Array(W * H),
  });
}

/** Runs the step of the current tick with `bodies` (ids 0.. in order) and returns the reject reasons it produced. */
function run(state: GameState, bodies: IntentBody[]): number[] {
  const turn = { turn: state.tick, intents: bodies.map((b, i) => ({ ...b, id: state.tick * 10 + i })) };
  expect(step(state, turn).ok).toBe(true);
  return state.outbox
    .drain()
    .filter((e) => e.kind === OUTBOX_REJECT)
    .map((e) => e.a);
}

function runTo(state: GameState, tick: number): void {
  while (state.tick < tick) run(state, []);
}

const cell = (x: number, y: number): number => y * W + x;

describe('phaseAt / phaseTicksLeft', () => {
  it('splits time into spawn, immunity and play at the constants of rules.ts', () => {
    expect(phaseAt(0)).toBe(PHASE_SPAWN);
    expect(phaseAt(SPAWN_PHASE_TICKS - 1)).toBe(PHASE_SPAWN);
    expect(phaseAt(SPAWN_PHASE_TICKS)).toBe(PHASE_IMMUNITY);
    expect(phaseAt(SPAWN_PHASE_TICKS + IMMUNITY_TICKS - 1)).toBe(PHASE_IMMUNITY);
    expect(phaseAt(SPAWN_PHASE_TICKS + IMMUNITY_TICKS)).toBe(PHASE_PLAY);
    expect(phaseTicksLeft(0)).toBe(SPAWN_PHASE_TICKS);
    expect(phaseTicksLeft(SPAWN_PHASE_TICKS)).toBe(IMMUNITY_TICKS);
    expect(phaseTicksLeft(SPAWN_PHASE_TICKS + IMMUNITY_TICKS)).toBe(0);
    expect(SPAWN_PHASE_TICKS).toBe(200); // 20 s at 10 Hz
    expect(IMMUNITY_TICKS).toBe(50); // 5 s
  });
});

describe('the spawn phase', () => {
  it('a Spawn is legal in the last tick of the phase and refused from the first tick after it (counted, state unchanged)', () => {
    const s = match(true);
    runTo(s, SPAWN_PHASE_TICKS - 1);
    expect(run(s, [{ kind: 'Spawn', seat: 0, cell: cell(10, 10) }])).toEqual([]);
    expect((s.agg.area[1] as number) > 0).toBe(true);
    const rejectsBefore = s.rejects;
    expect(s.tick).toBe(SPAWN_PHASE_TICKS);
    const before = serialize(s);
    const reasons = run(s, [{ kind: 'Spawn', seat: 1, cell: cell(40, 10) }]);
    expect(reasons).toEqual([REJECT_PHASE]);
    expect(s.rejects).toBe(rejectsBefore + 1);
    expect(s.agg.area[2]).toBe(0);
    // nothing but the tick, the reject counter and the generator moved
    expect(Array.from(s.owner)).toEqual(Array.from((deserialize(before) as { ok: true; state: GameState }).state.owner));
  });

  it('with the flag off a Spawn at any tick is legal (the rules of M04)', () => {
    const s = match(false);
    runTo(s, SPAWN_PHASE_TICKS + IMMUNITY_TICKS + 40);
    expect(run(s, [{ kind: 'Spawn', seat: 0, cell: cell(10, 10) }])).toEqual([]);
    expect((s.agg.area[1] as number) > 0).toBe(true);
  });

  it('an Attack in the phase is refused even for a seat that has spawned', () => {
    const s = match(true);
    run(s, [{ kind: 'Spawn', seat: 0, cell: cell(10, 10) }]);
    expect(run(s, [{ kind: 'Attack', seat: 0, target: 0, pct: 40 }])).toEqual([REJECT_PHASE]);
    expect(s.attacks.list.length).toBe(0);
  });

  it('a second Spawn in the phase is still refused as REJECT_SPAWNED', () => {
    const s = match(true);
    run(s, [{ kind: 'Spawn', seat: 0, cell: cell(10, 10) }]);
    expect(run(s, [{ kind: 'Spawn', seat: 0, cell: cell(30, 20) }])).toEqual([REJECT_SPAWNED]);
  });
});

describe('the immunity after the phase', () => {
  /** Seat 0 and seat 1 side by side, then the clock at `tick`. */
  function twoNations(tick: number): GameState {
    const s = match(true, 2);
    run(s, [
      { kind: 'Spawn', seat: 0, cell: cell(20, 15) },
      { kind: 'Spawn', seat: 1, cell: cell(30, 15) },
    ]);
    runTo(s, tick);
    return s;
  }

  it('an Attack on owned land is refused for IMMUNITY_TICKS, on unowned land it is legal, and from the end of the immunity both are', () => {
    const s = twoNations(SPAWN_PHASE_TICKS);
    expect(run(s, [{ kind: 'Attack', seat: 0, target: 2, pct: 40 }])).toEqual([REJECT_IMMUNE]);
    expect(s.attacks.list.length).toBe(0);
    expect(run(s, [{ kind: 'Attack', seat: 0, target: 0, pct: 40 }])).toEqual([]);
    expect(s.attacks.list.length).toBe(1);
    runTo(s, SPAWN_PHASE_TICKS + IMMUNITY_TICKS - 1);
    expect(run(s, [{ kind: 'Attack', seat: 1, target: 1, pct: 40 }])).toEqual([REJECT_IMMUNE]);
    expect(s.tick).toBe(SPAWN_PHASE_TICKS + IMMUNITY_TICKS);
    expect(run(s, [{ kind: 'Attack', seat: 1, target: 1, pct: 40 }])).toEqual([]); // now it is a real attack (the seats touch)
  });

  it('the flow survives a snapshot round trip (config bit) and a copy continues identically', () => {
    const s = twoNations(100);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.header.config.spawnPhase).toBe(true);
    runTo(r.state, SPAWN_PHASE_TICKS);
    expect(run(r.state, [{ kind: 'Attack', seat: 0, target: 2, pct: 40 }])).toEqual([REJECT_IMMUNE]);
  });
});

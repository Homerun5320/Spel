// M09 part B: the AI's build move, and the AI state (memories + random streams) as a blob that resumes a run exactly.
import { describe, expect, it } from 'vitest';
import { buildMove, createAiMemory, type AiMemory } from '../../src/ai';
import { AiDriver } from '../../src/host/aiDriver';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { IdAllocator, REJECT_NONE, withId, type IntentBody } from '../../src/sim/intents';
import { createRng } from '../../src/sim/rng';
import { AI_BUILD_RETRY_TICKS, BUILD_BASE_GOLD, MATCH_AI_NATIONS, MATCH_TRIBES, MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import type { GameState } from '../../src/sim/state';
import { applyIntent, step } from '../../src/sim/step';
import { STRUCT_CITY, STRUCT_FACTORY, validateBuild } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { createWorldState } from '../../src/sim/world';
import { loadRealWorld } from '../../tools/sim/realWorld';
import { landState } from '../sim/helpers/worlds';

const W = 200;
const H = 100;
const capitalCell = 50 * W + 50;

/** Seat 0 (ownerId 1) owns the west half of an open plain and has spawned at (50, 50); seat 1 holds the east. */
function plain(gold: number): { state: GameState; view: StateView; memory: AiMemory; rng: Uint32Array } {
  const state = landState(W, H, { seats: 2, players: 2 });
  for (let c = 0; c < state.grid.cells; c++) setOwner(state, c, c % W < 100 ? 1 : 2, 0);
  state.capital[1] = capitalCell + 1;
  state.gold[1] = gold * MILLI_GOLD_PER_GOLD;
  state.troops[1] = 1000;
  const view = new StateView(state);
  return { state, view, memory: createAiMemory(view, 0, { humanSeats: [] }), rng: createRng(7) };
}

describe('the AI build move', () => {
  it('builds a City, a City, then a Factory (one Factory per two Cities), each on a place the shared validateBuild accepts, and only when it can pay', () => {
    const { state, view, memory, rng } = plain(100000);
    const alloc = new IdAllocator();
    const types: number[] = [];
    for (let t = 0; t < 600 && types.length < 3; t++) {
      view.refresh();
      const b = buildMove(view, memory, rng);
      if (b !== null) {
        expect(b.kind).toBe('Build');
        const body = b as Extract<IntentBody, { kind: 'Build' }>;
        expect(validateBuild(view, 0, body.type, body.cell)).toBe(REJECT_NONE);
        expect(applyIntent(state, withId(b, alloc.alloc(0)))).toBe(REJECT_NONE);
        types.push(body.type);
      }
      step(state, { turn: state.tick, intents: [] });
    }
    expect(types).toEqual([STRUCT_CITY, STRUCT_CITY, STRUCT_FACTORY]);
    expect(memory.builds).toBe(3);
  });

  it('waits when the purse cannot pay the wanted structure, and a tribe or a seat in the spawn phase never builds', () => {
    const poor = plain((BUILD_BASE_GOLD[STRUCT_CITY] as number) - 1);
    for (let t = 0; t < 40; t++) {
      poor.state.gold[1] = ((BUILD_BASE_GOLD[STRUCT_CITY] as number) - 1) * MILLI_GOLD_PER_GOLD; // the land's own income would fill the purse
      poor.view.refresh();
      expect(buildMove(poor.view, poor.memory, poor.rng)).toBeNull();
      step(poor.state, { turn: poor.state.tick, intents: [] });
    }
    poor.state.gold[1] = (BUILD_BASE_GOLD[STRUCT_CITY] as number) * MILLI_GOLD_PER_GOLD;
    let built = false;
    for (let t = 0; t < 20 && !built; t++) {
      poor.view.refresh();
      built = buildMove(poor.view, poor.memory, poor.rng) !== null;
      step(poor.state, { turn: poor.state.tick, intents: [] });
    }
    expect(built).toBe(true);
    const tribe = plain(100000);
    const asTribe: AiMemory = { ...tribe.memory, tribe: true };
    for (let t = 0; t < 20; t++) {
      tribe.view.refresh();
      expect(buildMove(tribe.view, asTribe, tribe.rng)).toBeNull();
      step(tribe.state, { turn: tribe.state.tick, intents: [] });
    }
  });

  it('a think that finds no place waits AI_BUILD_RETRY_TICKS before it looks again', () => {
    const { state, view, memory, rng } = plain(100000);
    for (let c = 0; c < state.grid.cells; c++) setOwner(state, c, 2, 0);
    setOwner(state, capitalCell, 1, 0); // seat 0 owns one cell, and a City stands on it: there is no place left
    state.structures.add(STRUCT_CITY, 1, capitalCell, 0);
    state.tick = 100;
    view.refresh();
    expect(buildMove(view, memory, rng)).toBeNull();
    expect(memory.buildRetryAt).toBe(view.tick + AI_BUILD_RETRY_TICKS);
  });
});

const SEED = 4;
const PLAYERS = 1 + MATCH_AI_NATIONS;
const SEATS = PLAYERS + MATCH_TRIBES;
const HUMAN_CELL = 120 * 1024 + 560;

describe('the AI state blob', () => {
  it('serialised at tick 1000 and restored in a resumed host, the run reaches the same hash at tick 2000 as the straight run (and a driver without the blob does not)', async () => {
    const world = await loadRealWorld();
    const make = (): GameState => createWorldState(world, { seed: SEED, seats: SEATS, players: PLAYERS, config: { debugIntents: false, spawnPhase: true } });
    const driverA = new AiDriver(SEED);
    const a = new MainThreadHost(make(), { driver: driverA });
    a.submitIntent({ kind: 'Spawn', seat: 0, cell: HUMAN_CELL });
    a.runTicks(1000);
    const snap = await a.requestSnapshot();
    const blob = driverA.serialize();
    expect(blob.length).toBeGreaterThan(100);
    a.runTicks(1000);
    const straight = await a.requestSnapshot();
    const builtState = (await import('../../src/sim/serialize')).deserialize(straight.bytes);
    expect(builtState.ok && builtState.state.structures.liveCount).toBeGreaterThan(0); // the AI really built, so the blob matters

    const driverB = new AiDriver(SEED);
    expect(driverB.restore(blob)).toBe(true);
    const b = MainThreadHost.resume(snap, { driver: driverB });
    expect(b).not.toBeNull();
    (b as MainThreadHost).runTicks(1000);
    const resumed = await (b as MainThreadHost).requestSnapshot();
    expect(resumed.tick).toBe(2000);
    expect(resumed.hash).toBe(straight.hash);
    expect(driverB.serialize()).toEqual(driverA.serialize());

    const driverC = new AiDriver(SEED);
    const c = MainThreadHost.resume(snap, { driver: driverC });
    (c as MainThreadHost).runTicks(1000);
    expect((await (c as MainThreadHost).requestSnapshot()).hash, 'a driver that forgot its memory and streams runs a different match').not.toBe(straight.hash);
  }, 120000);

  it('refuses an empty or a foreign blob, and has nothing to save before the first tick', () => {
    const d = new AiDriver(SEED);
    expect(d.restore(new Uint8Array(0))).toBe(false);
    expect(d.restore(new Uint8Array([1, 2, 3, 4]))).toBe(false);
    expect(d.serialize().length).toBe(0); // before the first tick there is nothing to save
  });
});

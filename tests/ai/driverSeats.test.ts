// The AI driver's seats (M06, D118): which seats are human is a parameter, the first human seat is the anchor of the AI's capital
// places, and each AI seat draws from its own random stream derived from the match seed and the seat.
import { describe, expect, it } from 'vitest';
import { createAiMemory } from '../../src/ai';
import { AiDriver, aiSeatSeed } from '../../src/host/aiDriver';
import { MainThreadHost, type TickDriver } from '../../src/host/mainThreadHost';
import type { IntentBody } from '../../src/sim/intents';
import { createRng } from '../../src/sim/rng';
import { AI_ANCHOR_SEAT } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { StateView } from '../../src/sim/view';
import { createWorldState, type SimWorld } from '../../src/sim/world';
import { loadRealWorld } from '../../tools/sim/realWorld';

const PLAYERS = 4;
const SEATS = 10;

function matchState(world: SimWorld, seed: number) {
  return createWorldState(world, { seed, seats: SEATS, players: PLAYERS, config: { debugIntents: false, spawnPhase: true } });
}

interface Sent {
  readonly tick: number;
  readonly body: IntentBody;
}

function recording(ai: AiDriver): { driver: TickDriver; log: Sent[] } {
  const log: Sent[] = [];
  return {
    log,
    driver: {
      onTick(view, submit) {
        ai.onTick(view, (body) => {
          log.push({ tick: view.tick, body });
          submit(body);
        });
      },
    },
  };
}

describe('the per-seat random streams', () => {
  it('are distinct for every seat of a match and for every seed, and are a pure function of (seed, seat)', () => {
    const seen = new Set<number>();
    for (const seed of [0, 1, 2, 7, 123456]) for (let seat = 0; seat < 60; seat++) seen.add(aiSeatSeed(seed, seat));
    expect(seen.size).toBe(5 * 60);
    expect(aiSeatSeed(5, 3)).toBe(aiSeatSeed(5, 3));
    expect(aiSeatSeed(5, 3)).not.toBe(aiSeatSeed(5, 4));
    expect(aiSeatSeed(5, 3)).not.toBe(aiSeatSeed(6, 3));
  });
});

describe('the human seats are a parameter', () => {
  it('the default is seat 0 (the M05 behaviour), and a driver never thinks for a human seat', async () => {
    const world = await loadRealWorld();
    const state = matchState(world, 3);
    const view = new StateView(state);
    const def = new AiDriver(3);
    def.onTick(view, () => undefined);
    expect(def.memoryOf(0)).toBeNull();
    expect(def.memoryOf(1)?.seat).toBe(1);
    expect(def.memoryOf(1)?.anchor).toBe(AI_ANCHOR_SEAT);
    expect(def.plays(0)).toBe(false);
    expect(def.plays(1)).toBe(true);

    const other = new AiDriver(3, { humanSeats: [2] });
    other.onTick(view, () => undefined);
    expect(other.memoryOf(2)).toBeNull();
    expect(other.memoryOf(0)?.seat).toBe(0);
    expect(other.memoryOf(0)?.anchor).toBe(2);
    expect(other.memoryOf(9)?.anchor).toBe(2);
    // the Spawn order counts the AI seats only: seat 0 is the first AI seat now
    expect(other.memoryOf(0)?.slot).toBe(0);
    expect(other.memoryOf(1)?.slot).toBe(1);
    expect(other.memoryOf(3)?.slot).toBe(2);
  });

  it('two human seats: neither is played, both are left alone, the rest is', async () => {
    const world = await loadRealWorld();
    const { driver, log } = recording(new AiDriver(8, { humanSeats: [0, 3] }));
    const host = new MainThreadHost(matchState(world, 8), { driver });
    host.runTicks(400);
    expect(log.length).toBeGreaterThan(5);
    for (const s of log) expect([0, 3]).not.toContain(s.body.seat);
    expect(new Set(log.map((s) => s.body.seat)).size).toBeGreaterThanOrEqual(5);
  });

  it('the AI places its capitals around the FIRST human seat once that one has spawned (not around seat 0)', async () => {
    const world = await loadRealWorld();
    const humanCell = 120 * 1024 + 560; // central Europe
    const { driver, log } = recording(new AiDriver(5, { humanSeats: [2] }));
    const state = matchState(world, 5);
    const host = new MainThreadHost(state, { driver });
    host.submitIntent({ kind: 'Spawn', seat: 2, cell: humanCell });
    host.runTicks(160);
    const spawns = log.filter((s) => s.body.kind === 'Spawn');
    expect(spawns.length).toBeGreaterThanOrEqual(5);
    // every Spawn came after the human's capital existed (tick 3), not after the wait limit, and within reach of it
    for (const s of spawns) {
      expect(s.tick).toBeLessThan(110);
      const cell = (s.body as { cell: number }).cell;
      const dx = Math.min(Math.abs((cell % 1024) - 560), 1024 - Math.abs((cell % 1024) - 560));
      const dy = Math.abs(Math.floor(cell / 1024) - 120);
      expect(Math.max(dx, dy), `spawn at ${cell}`).toBeLessThanOrEqual(120);
    }
    expect(state.capital[3]).toBe(humanCell + 1);
  });

  it('createAiMemory takes the anchor and the order from its options and keeps the old defaults', async () => {
    const world = await loadRealWorld();
    const view = new StateView(matchState(world, 1));
    const d = createAiMemory(view, 2);
    expect([d.anchor, d.slot]).toEqual([AI_ANCHOR_SEAT, 1]);
    const o = createAiMemory(view, 2, { anchor: 5, order: 7 });
    expect([o.anchor, o.slot]).toEqual([5, 7]);
  });
});

describe('each AI seat has its own stream', () => {
  it('is deterministic: the same seed and seats give the same match, another seed another one', async () => {
    const world = await loadRealWorld();
    const run = (seed: number): number => {
      const state = matchState(world, seed);
      const host = new MainThreadHost(state, { driver: new AiDriver(seed) });
      host.runTicks(500);
      return hashState(state);
    };
    expect(run(2)).toBe(run(2));
    expect(run(2)).not.toBe(run(3));
  });

  it('every AI seat starts from createRng(aiSeatSeed(seed, seat)): one stream per seat, none shared, none for a human seat', async () => {
    const world = await loadRealWorld();
    const view = new StateView(matchState(world, 9));
    const driver = new AiDriver(9, { humanSeats: [1] });
    expect(driver.streamOf(0)).toBeNull(); // before the first tick
    driver.onTick(view, () => undefined);
    const states = new Set<string>();
    for (let seat = 0; seat < SEATS; seat++) {
      const got = driver.streamOf(seat);
      if (seat === 1) {
        expect(got).toBeNull();
        continue;
      }
      expect(Array.from(got as Uint32Array), `seat ${seat}`).toEqual(Array.from(createRng(aiSeatSeed(9, seat))));
      states.add(Array.from(got as Uint32Array).join(','));
    }
    expect(states.size).toBe(SEATS - 1);
    expect(driver.streamOf(SEATS)).toBeNull();
    // a returned state is a copy: writing to it does not change the stream
    const copy = driver.streamOf(0) as Uint32Array;
    copy.fill(0);
    expect(Array.from(driver.streamOf(0) as Uint32Array)).toEqual(Array.from(createRng(aiSeatSeed(9, 0))));
  });

  it('a seat that thinks draws only from its own stream: after the spawn phase the streams of the seats that placed a capital have moved, a human stream does not exist', async () => {
    const world = await loadRealWorld();
    const driver = new AiDriver(4, { humanSeats: [0] });
    const state = matchState(world, 4);
    const host = new MainThreadHost(state, { driver });
    host.submitIntent({ kind: 'Spawn', seat: 0, cell: 120 * 1024 + 560 });
    host.runTicks(60);
    for (let seat = 1; seat < SEATS; seat++) {
      expect(state.capital[seat + 1], `seat ${seat} has spawned`).toBeGreaterThan(0);
      expect(Array.from(driver.streamOf(seat) as Uint32Array), `seat ${seat} drew`).not.toEqual(Array.from(createRng(aiSeatSeed(4, seat))));
    }
    expect(driver.streamOf(0)).toBeNull();
  });
});

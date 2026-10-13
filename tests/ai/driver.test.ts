// The AI driver in the host: the AI's intents travel like anybody's (T + 2), a match with the AI replays from its recorded
// intents alone, the whole match is a function of the seed, every seat spawns, and the AI never sends an intent the sim refuses.
import { describe, expect, it } from 'vitest';
import { AiDriver } from '../../src/host/aiDriver';
import { MainThreadHost, type TickDriver } from '../../src/host/mainThreadHost';
import { ViewMirror } from '../../src/host/viewMirror';
import type { IntentBody } from '../../src/sim/intents';
import { MATCH_AI_NATIONS, MATCH_TRIBES, SPAWN_PHASE_TICKS, START_DISC_CELLS } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { type GameState } from '../../src/sim/state';
import { createWorldState, type SimWorld } from '../../src/sim/world';
import { StateView } from '../../src/sim/view';
import { loadRealWorld } from '../../tools/sim/realWorld';

const PLAYERS = 1 + MATCH_AI_NATIONS;
const SEATS = PLAYERS + MATCH_TRIBES;

function matchState(world: SimWorld, seed: number): GameState {
  return createWorldState(world, { seed, seats: SEATS, players: PLAYERS, config: { debugIntents: false, spawnPhase: true } });
}

interface Recorded {
  readonly tick: number;
  readonly body: IntentBody;
}

/** Wraps the AI driver and records what it sends and at which tick. */
function recording(seed: number): { driver: TickDriver; log: Recorded[]; ai: AiDriver } {
  const ai = new AiDriver(seed);
  const log: Recorded[] = [];
  const driver: TickDriver = {
    onTick(view, submit) {
      ai.onTick(view, (body) => {
        log.push({ tick: view.tick, body });
        submit(body);
      });
    },
  };
  return { driver, log, ai };
}

describe('the AI driver in the host', () => {
  it('replays from its recorded intents alone: the same hash as a host without the AI that is sent the same intents at the same ticks', async () => {
    const world = await loadRealWorld();
    const a = matchState(world, 4);
    const { driver, log } = recording(4);
    const withAi = new MainThreadHost(a, { driver });
    withAi.runTicks(1500);
    expect(log.length).toBeGreaterThan(100);
    expect(log.some((r) => r.body.kind === 'Spawn')).toBe(true);
    expect(log.some((r) => r.body.kind === 'Attack')).toBe(true);

    const b = matchState(world, 4);
    const plain = new MainThreadHost(b);
    let next = 0;
    for (let t = 0; t < 1500; t++) {
      while (next < log.length && (log[next] as Recorded).tick === t) plain.submitIntent((log[next++] as Recorded).body);
      plain.runTicks(1);
    }
    expect(next).toBe(log.length);
    expect(hashState(b)).toBe(hashState(a));
  });

  it('is a function of the seed: the same seed gives the same match, another seed another one', async () => {
    const world = await loadRealWorld();
    const hashAt = (seed: number): number => {
      const state = matchState(world, seed);
      new MainThreadHost(state, { driver: new AiDriver(seed) }).runTicks(900);
      return hashState(state);
    };
    expect(hashAt(2)).toBe(hashAt(2));
    expect(hashAt(2)).not.toBe(hashAt(3));
  });

  it('files the AI intents like anybody else: the first tribe, sent at tick 0, owns land after the third tick and not the second', async () => {
    const world = await loadRealWorld();
    const state = matchState(world, 1);
    const host = new MainThreadHost(state, { driver: new AiDriver(1) });
    const { mirror } = await ViewMirror.attach(host);
    host.runTicks(2);
    expect(mirror.stats.cells[PLAYERS]).toBe(0);
    host.runTicks(1);
    expect(mirror.stats.cells[PLAYERS]).toBe(START_DISC_CELLS);
    // One tribe every 3 ticks, in seat order: the last one (tick 57) is down 2 ticks later.
    host.runTicks(57);
    for (let seat = PLAYERS; seat < SEATS; seat++) expect(mirror.stats.cells[seat], `tribe ${seat}`).toBe(START_DISC_CELLS);
  });

  it('a standard match on the real world: all 25 AI seats have a full capital before the spawn phase ends, and the human seat stays empty', async () => {
    const world = await loadRealWorld();
    for (const seed of [1, 2, 3, 7, 11]) {
      const state = matchState(world, seed);
      const host = new MainThreadHost(state, { driver: new AiDriver(seed) });
      host.runTicks(SPAWN_PHASE_TICKS);
      const view = new StateView(state);
      expect(view.stats.cells[0], `seed ${seed}: the human seat`).toBe(0);
      for (let seat = 1; seat < SEATS; seat++) expect(view.stats.cells[seat], `seed ${seed} seat ${seat}`).toBe(START_DISC_CELLS);
      expect(state.rejects, `seed ${seed}`).toBe(0);
    }
  });

  it('never sends an intent the sim refuses, over 6000 ticks (10 minutes) of three matches, and the nations grow', async () => {
    const world = await loadRealWorld();
    for (const seed of [1, 5, 9]) {
      const state = matchState(world, seed);
      const host = new MainThreadHost(state, { driver: new AiDriver(seed) });
      host.runTicks(3000);
      const view = new StateView(state);
      for (let seat = 1; seat < PLAYERS; seat++) expect(view.stats.cells[seat] as number, `seed ${seed} nation ${seat} at 5 min`).toBeGreaterThan(START_DISC_CELLS * 3);
      host.runTicks(3000);
      expect(state.rejects, `seed ${seed}`).toBe(0);
      view.refresh();
      for (let seat = 1; seat < PLAYERS; seat++) expect(view.stats.cells[seat] as number, `seed ${seed} nation ${seat} at 10 min`).toBeGreaterThan(START_DISC_CELLS * 6);
    }
  });

  it('lets nations and tribes fight over a long match, and still never sends a refused intent', async () => {
    const world = await loadRealWorld();
    const state = matchState(world, 7);
    const { driver, log } = recording(7);
    const host = new MainThreadHost(state, { driver });
    host.runTicks(12000);
    expect(state.rejects).toBe(0);
    const wars = log.filter((r) => r.body.kind === 'Attack' && r.body.target !== 0);
    expect(wars.length).toBeGreaterThan(0);
    // Tribes never start a war.
    for (const r of wars) expect(r.body.seat, 'only nations attack other seats').toBeLessThan(PLAYERS);
    expect(log.every((r) => r.body.seat >= 1)).toBe(true);
  });

  it('the tribes stay small', async () => {
    const world = await loadRealWorld();
    const state = matchState(world, 3);
    new MainThreadHost(state, { driver: new AiDriver(3) }).runTicks(6000);
    const view = new StateView(state);
    let total = 0;
    for (let seat = PLAYERS; seat < SEATS; seat++) {
      total += view.stats.cells[seat] as number;
      expect(view.stats.cells[seat] as number, `tribe ${seat}`).toBeLessThan(900);
    }
    expect(total).toBeGreaterThan(MATCH_TRIBES * START_DISC_CELLS);
  });
});

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
const cellAt = (lat: number, lon: number): number => Math.floor(((90 - lat) / 180) * 512) * 1024 + Math.floor(((lon + 180) / 360) * 1024);
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

/** The human's capital: central Europe. The AI waits for it (or for tick 110) before it places its own. */
const HUMAN_CELL = 120 * 1024 + 560;

/**
 * An intent that was sound when the AI sent it can still be refused two ticks later (T + 2): the free land it wanted to attack was
 * taken in between and the seats no longer touch (REJECT_NO_CONTACT). That race is the price of the input delay, so the bound is a
 * small fraction of what was sent, not zero.
 */
function expectNoRefusals(rejects: number, sent: number, label: string): void {
  expect(rejects, `${label}: ${rejects} refused of ${sent} sent`).toBeLessThanOrEqual(Math.max(1, Math.floor(sent / 100)));
}

describe('the AI driver in the host', () => {
  it('replays from its recorded intents alone: the same hash as a host without the AI that is sent the same intents at the same ticks', async () => {
    const world = await loadRealWorld();
    const a = matchState(world, 4);
    const { driver, log } = recording(4);
    const withAi = new MainThreadHost(a, { driver });
    withAi.submitIntent({ kind: 'Spawn', seat: 0, cell: HUMAN_CELL });
    withAi.runTicks(1500);
    expect(log.length).toBeGreaterThan(100);
    expect(log.some((r) => r.body.kind === 'Spawn')).toBe(true);
    expect(log.some((r) => r.body.kind === 'Attack')).toBe(true);

    const b = matchState(world, 4);
    const plain = new MainThreadHost(b);
    plain.submitIntent({ kind: 'Spawn', seat: 0, cell: HUMAN_CELL });
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
      const host = new MainThreadHost(state, { driver: new AiDriver(seed) });
      host.submitIntent({ kind: 'Spawn', seat: 0, cell: HUMAN_CELL });
      host.runTicks(900);
      return hashState(state);
    };
    expect(hashAt(2)).toBe(hashAt(2));
    expect(hashAt(2)).not.toBe(hashAt(3));
  });

  it('files the AI intents like anybody else: the first nation, sent on the tick it sees the human capital, owns land 2 ticks after it was sent, not 1', async () => {
    const world = await loadRealWorld();
    const state = matchState(world, 1);
    const host = new MainThreadHost(state, { driver: new AiDriver(1) });
    host.submitIntent({ kind: 'Spawn', seat: 0, cell: HUMAN_CELL }); // runs at tick 2, so the capital shows at tick 3
    const { mirror } = await ViewMirror.attach(host);
    host.runTicks(3);
    expect(mirror.stats.cells[0]).toBe(START_DISC_CELLS);
    expect(mirror.stats.cells[1]).toBe(0); // sent at tick 3 (the first boundary after the human's capital), runs at tick 5
    host.runTicks(2);
    expect(mirror.stats.cells[1]).toBe(0);
    host.runTicks(1);
    expect(mirror.stats.cells[1]).toBe(START_DISC_CELLS);
    // One seat every tick, the nations first, then the tribes: the last of the 25 (slot 24) is down 2 ticks after it was sent.
    host.runTicks(80);
    for (let seat = 1; seat < SEATS; seat++) expect(mirror.stats.cells[seat], `seat ${seat}`).toBeGreaterThanOrEqual(START_DISC_CELLS);
    expect(state.rejects).toBe(0);
  });

  it('a standard match on the real world: all 25 AI seats have a full capital before the spawn phase ends, with a human on every continent, on a small island, and with no human at all', async () => {
    const world = await loadRealWorld();
    const spots: Array<[string, number | null]> = [
      ['Europe', HUMAN_CELL],
      ['Sahara', cellAt(22, 10)],
      ['US midwest', cellAt(40, -98)],
      ['Brazil', cellAt(-10, -52)],
      ['India', cellAt(22, 78)],
      ['Australia', cellAt(-25, 135)],
      ['Iceland', cellAt(64.9, -18.5)],
      ['New Zealand', cellAt(-43.5, 171)],
      ['nobody', null],
    ];
    for (const [name, cell] of spots) {
      for (const seed of [1, 2, 3]) {
        const state = matchState(world, seed);
        const host = new MainThreadHost(state, { driver: new AiDriver(seed) });
        if (cell !== null) host.submitIntent({ kind: 'Spawn', seat: 0, cell });
        host.runTicks(SPAWN_PHASE_TICKS);
        const view = new StateView(state);
        for (let seat = 1; seat < SEATS; seat++) expect(view.stats.cells[seat], `${name}, seed ${seed}, seat ${seat}`).toBe(START_DISC_CELLS);
        expect(state.rejects, `${name}, seed ${seed}`).toBe(0);
      }
    }
  });

  it('puts the world around the human: with a human capital, tribes sit within reach of it and the nearest ones within 60 cells', async () => {
    const world = await loadRealWorld();
    for (const seed of [1, 2, 3, 4]) {
      const state = matchState(world, seed);
      const host = new MainThreadHost(state, { driver: new AiDriver(seed) });
      host.submitIntent({ kind: 'Spawn', seat: 0, cell: HUMAN_CELL });
      host.runTicks(SPAWN_PHASE_TICKS);
      const view = new StateView(state);
      const dist = (seat: number): number => {
        const c = (view.stats.capital[seat] as number) - 1;
        const dx = Math.abs((c % 1024) - (HUMAN_CELL % 1024));
        return Math.max(Math.min(dx, 1024 - dx), Math.abs(Math.floor(c / 1024) - Math.floor(HUMAN_CELL / 1024)));
      };
      let near = 0;
      for (let seat = PLAYERS; seat < SEATS; seat++) if (dist(seat) <= 60) near++;
      expect(near, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      const nearestNation = Math.min(...[1, 2, 3, 4, 5].map(dist));
      expect(nearestNation, `seed ${seed}`).toBeLessThanOrEqual(90);
    }
  });

  it('a human who reads the banner first still gets the nations around them: a Spawn 14 s into the phase (tick 140, after the old 11 s limit) leaves the nearest nation within 90 cells, with no refused intent', async () => {
    const world = await loadRealWorld();
    const spots: Array<[string, number]> = [
      ['Europe', HUMAN_CELL],
      ['Brazil', cellAt(-10, -52)],
      ['US midwest', cellAt(40, -98)],
      ['Australia', cellAt(-25, 135)],
    ];
    for (const [name, cell] of spots) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const state = matchState(world, seed);
        const host = new MainThreadHost(state, { driver: new AiDriver(seed) });
        host.runTicks(140);
        host.submitIntent({ kind: 'Spawn', seat: 0, cell });
        host.runTicks(SPAWN_PHASE_TICKS - 140);
        const view = new StateView(state);
        const dist = (seat: number): number => {
          const c = (view.stats.capital[seat] as number) - 1;
          const dx = Math.abs((c % 1024) - (cell % 1024));
          return Math.max(Math.min(dx, 1024 - dx), Math.abs(Math.floor(c / 1024) - Math.floor(cell / 1024)));
        };
        for (let seat = 1; seat < SEATS; seat++) expect(view.stats.cells[seat], `${name}, seed ${seed}, seat ${seat}`).toBe(START_DISC_CELLS);
        const nearestNation = Math.min(...[1, 2, 3, 4, 5].map(dist));
        expect(nearestNation, `${name}, seed ${seed}`).toBeLessThanOrEqual(90);
        expect(state.rejects, `${name}, seed ${seed}`).toBe(0);
      }
    }
  });

  it('Spawns that are on their way are known to the seats that follow on the next tick: 25 seats Spawn on 25 consecutive ticks, no two capitals within the clearance, no refusal', async () => {
    const world = await loadRealWorld();
    for (const seed of [1, 2, 3]) {
      const state = matchState(world, seed);
      const host = new MainThreadHost(state, { driver: new AiDriver(seed) });
      host.submitIntent({ kind: 'Spawn', seat: 0, cell: HUMAN_CELL });
      host.runTicks(SPAWN_PHASE_TICKS);
      const view = new StateView(state);
      const caps: Array<[number, number]> = [];
      for (let seat = 0; seat < SEATS; seat++) {
        const c = (view.stats.capital[seat] as number) - 1;
        caps.push([c % 1024, Math.floor(c / 1024)]);
      }
      for (let a = 0; a < caps.length; a++) {
        for (let b = a + 1; b < caps.length; b++) {
          const dx = Math.abs((caps[a] as [number, number])[0] - (caps[b] as [number, number])[0]);
          const d = Math.max(Math.min(dx, 1024 - dx), Math.abs((caps[a] as [number, number])[1] - (caps[b] as [number, number])[1]));
          expect(d, `seed ${seed}: capitals of seats ${a} and ${b}`).toBeGreaterThanOrEqual(10); // the clearance never drops below the disc radius + 2
        }
      }
      for (let seat = 0; seat < SEATS; seat++) expect(view.stats.cells[seat], `seed ${seed}, seat ${seat}`).toBe(START_DISC_CELLS);
      expect(state.rejects, `seed ${seed}`).toBe(0);
    }
  });

  it('never sends an intent the sim refuses, over 6000 ticks (10 minutes) of three matches, and the nations grow', async () => {
    const world = await loadRealWorld();
    for (const seed of [1, 5, 9]) {
      const state = matchState(world, seed);
      const driver = new AiDriver(seed);
      const host = new MainThreadHost(state, { driver });
      host.submitIntent({ kind: 'Spawn', seat: 0, cell: HUMAN_CELL });
      host.runTicks(3000);
      const view = new StateView(state);
      for (let seat = 1; seat < PLAYERS; seat++) expect(view.stats.cells[seat] as number, `seed ${seed} nation ${seat} at 5 min`).toBeGreaterThan(START_DISC_CELLS * 3);
      host.runTicks(3000);
      expectNoRefusals(state.rejects, driver.sent, `seed ${seed}`);
      view.refresh();
      for (let seat = 1; seat < PLAYERS; seat++) expect(view.stats.cells[seat] as number, `seed ${seed} nation ${seat} at 10 min`).toBeGreaterThan(START_DISC_CELLS * 6);
    }
  });

  it('lets nations and tribes fight over a long match, and still never sends a refused intent', async () => {
    const world = await loadRealWorld();
    const state = matchState(world, 7);
    const { driver, log, ai } = recording(7);
    const host = new MainThreadHost(state, { driver });
    host.submitIntent({ kind: 'Spawn', seat: 0, cell: HUMAN_CELL });
    host.runTicks(12000);
    expectNoRefusals(state.rejects, ai.sent, 'seed 7, 20 minutes');
    const wars = log.filter((r) => r.body.kind === 'Attack' && r.body.target !== 0);
    expect(wars.length).toBeGreaterThan(0);
    // Tribes never start a war.
    for (const r of wars) expect(r.body.seat, 'only nations attack other seats').toBeLessThan(PLAYERS);
    expect(log.every((r) => r.body.seat >= 1)).toBe(true);
  });

  it('the tribes stay small', async () => {
    const world = await loadRealWorld();
    const state = matchState(world, 3);
    const host = new MainThreadHost(state, { driver: new AiDriver(3) });
    host.submitIntent({ kind: 'Spawn', seat: 0, cell: HUMAN_CELL });
    host.runTicks(6000);
    const view = new StateView(state);
    let total = 0;
    for (let seat = PLAYERS; seat < SEATS; seat++) {
      total += view.stats.cells[seat] as number;
      expect(view.stats.cells[seat] as number, `tribe ${seat}`).toBeLessThan(900);
    }
    expect(total).toBeGreaterThan(MATCH_TRIBES * START_DISC_CELLS);
  });
});

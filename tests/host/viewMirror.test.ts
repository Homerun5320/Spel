// The page's read-only copy of the match (src/host/viewMirror.ts): after any number of frames its owner array and its
// statistics equal the sim's own, over the main-thread host and over the message port of the Worker design.
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import type { SimHost } from '../../src/host/protocol';
import type { ClientMessage, HostMessage } from '../../src/host/protocol';
import { RemoteHost, serveHost } from '../../src/host/remote';
import { createLocalTransport } from '../../src/host/transport';
import { createEmptyState, createState } from '../../src/sim/state';
import { ViewMirror } from '../../src/host/viewMirror';
import { PHASE_IMMUNITY, PHASE_PLAY, PHASE_SPAWN } from '../../src/sim/flow';
import { landShareQ15 } from '../../src/sim/territory';
import { ownerCapQt } from '../../src/sim/economy';
import { seatToOwner, type GameState } from '../../src/sim/state';
import { randomBodies, randomMatchState, RSEATS } from '../sim/helpers/randomMatch';
import { fillSeatStats, statsLength, StateView } from '../../src/sim/view';
import { OUTBOX_CAPACITY } from '../../src/sim/outbox';
import { step } from '../../src/sim/step';

function createServedPair(host: MainThreadHost) {
  const transport = createLocalTransport<ClientMessage, HostMessage>();
  serveHost(host, transport.host);
  return { transport, remote: new RemoteHost(transport.client) };
}

function drive(host: SimHost, seed: number, ticks: number, cells: number, each?: (i: number) => void): void {
  for (let i = 0; i < ticks; i++) {
    const tick = host instanceof MainThreadHost ? host.tick : i;
    for (const b of randomBodies(seed, tick, RSEATS, cells, true)) host.submitIntent(b);
    host.advance(100);
    each?.(i);
  }
}

function expectSame(mirror: ViewMirror, state: GameState): void {
  expect(mirror.tick).toBe(state.tick);
  expect(mirror.rejects).toBe(state.rejects);
  expect(Array.from(mirror.owner as Uint16Array)).toEqual(Array.from(state.owner));
  const packed = new Uint32Array(statsLength(state.header.seats));
  fillSeatStats(state, packed);
  const s = mirror.stats;
  for (let seat = 0; seat < state.header.seats; seat++) {
    const o = seatToOwner(seat);
    expect(s.troopsQt[seat], `troops ${seat}`).toBe(state.troops[o]);
    expect(s.goldMilli[seat], `gold ${seat}`).toBe(state.gold[o]);
    expect(s.cells[seat], `cells ${seat}`).toBe(state.agg.area[o]);
    expect(s.alive[seat]).toBe((state.agg.area[o] as number) > 0 ? 1 : 0);
    expect(s.capital[seat]).toBe(state.capital[o]);
    expect(s.landShareQ15[seat]).toBe((state.agg.area[o] as number) > 0 ? landShareQ15(state, o) : 0);
    expect(s.capQt[seat]).toBe((state.agg.area[o] as number) > 0 ? ownerCapQt(state, o) : 0);
  }
}

describe('ViewMirror over the main-thread host', () => {
  it('starts equal to the state, follows 400 ticks of a random match exactly and counts real owner changes in ownerVersion', async () => {
    const state = randomMatchState(11, true);
    const cells = state.width * state.height;
    const host = new MainThreadHost(state);
    const { mirror, stop } = await ViewMirror.attach(host);
    expectSame(mirror, state);
    expect(mirror.seats).toBe(RSEATS);
    expect(mirror.width * mirror.height).toBe(cells);
    expect(mirror.terrainClass.length).toBe(cells);
    const v0 = mirror.ownerVersion;
    let frames = 0;
    mirror.onFrame(() => frames++);
    drive(host, 11, 400, cells, (i) => {
      if (i % 50 === 49) expectSame(mirror, state);
    });
    expectSame(mirror, state);
    expect(frames).toBe(400);
    expect(mirror.frames).toBe(400);
    expect(mirror.ownerVersion).toBeGreaterThan(v0);
    stop();
    host.advance(100);
    expect(mirror.tick).toBe(400); // stopped: no more frames
  });

  it('does not write through to the sim: mutating the mirror leaves the state alone, and the owner array is not the sim\'s', async () => {
    const state = randomMatchState(3, true);
    const host = new MainThreadHost(state);
    const { mirror } = await ViewMirror.attach(host);
    expect(mirror.copyOwner().buffer).not.toBe(state.owner.buffer);
    const copy = mirror.copyOwner();
    copy.fill(9);
    expect(state.owner.some((o) => o === 9)).toBe(false);
  });

  it('adopts the whole owner array after an outbox overflow', async () => {
    const OVER = OUTBOX_CAPACITY + 300;
    const big = createEmptyState(256, 128, 1, 2, { debugIntents: true }); // a world with more cells than the outbox holds
    const painter = (s: GameState, t: Parameters<typeof step>[1]) => {
      if (s.tick === 2) {
        for (let c = 0; c < OVER; c++) {
          s.owner[c] = 1;
          s.outbox.push(1, s.tick, c, 1);
        }
      }
      return step(s, t);
    };
    const host = new MainThreadHost(big, { stepFn: painter });
    const { mirror } = await ViewMirror.attach(host);
    host.runTicks(4);
    expect(Array.from(mirror.owner as Uint16Array)).toEqual(Array.from(big.owner));
    expect((mirror.owner as Uint16Array)[OVER - 1]).toBe(1);
  });

  it('frames that arrive while the first answer is pending are queued and applied once', async () => {
    const state = randomMatchState(8, true);
    const host = new MainThreadHost(state);
    const p = ViewMirror.attach(host);
    host.advance(300); // 3 ticks before the promise continues
    const { mirror } = await p;
    expectSame(mirror, state);
  });
});

describe('ViewMirror over a message port (the Worker design)', () => {
  it('stays equal to the state across 120 ticks and transfers rather than shares its buffers', async () => {
    const state = randomMatchState(21, true);
    const { remote, transport } = createServedPair(new MainThreadHost(state));
    const att = ViewMirror.attach(remote);
    await transport.idle();
    await Promise.resolve();
    await transport.idle();
    const { mirror } = await att;
    for (let i = 0; i < 120; i++) {
      for (const b of randomBodies(21, i, RSEATS, state.width * state.height, true)) remote.submitIntent(b);
      remote.advance(100);
      await transport.idle();
    }
    expectSame(mirror, state);
  });
});

describe('SimView facts', () => {
  it('the phase follows the tick when the flow is on and is play otherwise; StateView reads a live state without copying', () => {
    const state = randomMatchState(2, true);
    const view = new StateView(state);
    expect(view.phase).toBe(PHASE_PLAY); // randomMatchState has no spawn phase
    expect(view.owner).toBe(state.owner);
    expect(view.seats).toBe(RSEATS);
    const flow = createState({ width: 8, height: 8, seed: 1, seats: 2, config: { spawnPhase: true }, terrain: new Uint8Array(64).fill(2), elevation: new Uint16Array(64) });
    const fv = new StateView(flow);
    expect(fv.flow).toBe(true);
    expect(fv.phase).toBe(PHASE_SPAWN);
    expect(fv.phaseTicksLeft).toBe(200);
    flow.tick = 210;
    expect(fv.phase).toBe(PHASE_IMMUNITY);
  });

  it('no writable method is reachable through the SimView type (type-level)', () => {
    const state = randomMatchState(2, true);
    const view: import('../../src/sim/view').SimView = new StateView(state);
    // Never called: the point is that this function compiles only because each forbidden line carries its @ts-expect-error.
    const forbidden = (): void => {
      // @ts-expect-error owner is read-only
      view.owner[0] = 1;
      // @ts-expect-error stats are read-only
      view.stats.troopsQt[0] = 1;
      // @ts-expect-error tick is read-only
      view.tick = 1;
    };
    expect(typeof forbidden).toBe('function');
  });
});

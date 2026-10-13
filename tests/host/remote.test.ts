import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import type { ClientMessage, HostEvent, HostMessage, StateDiff } from '../../src/host/protocol';
import { RemoteHost, serveHost } from '../../src/host/remote';
import { createLocalTransport } from '../../src/host/transport';
import { TICK_MS } from '../../src/sim/rules';
import { GOLDEN_PARAMS, GOLDEN_TICKS, createScenarioState } from '../../src/sim/scenario';
import { deserialize } from '../../src/sim/serialize';
import { createEmptyState } from '../../src/sim/state';
import { hex32 } from '../../src/sim/hash';
import { readGolden } from '../helpers/simGolden';
import { submitScenarioFor } from './helpers';

function pair(state = createScenarioState()) {
  const transport = createLocalTransport<ClientMessage, HostMessage>();
  const host = new MainThreadHost(state);
  const stop = serveHost(host, transport.host);
  const remote = new RemoteHost(transport.client);
  return { transport, host, remote, stop };
}

describe('RemoteHost over LocalTransport', () => {
  it('reaches the committed golden hashes at 1, 10, 100, 1000 and 6000 with only copies crossing the seam', async () => {
    const golden = readGolden();
    const { transport, remote } = pair();
    const cells = GOLDEN_PARAMS.width * GOLDEN_PARAMS.height;
    const got: Record<string, string> = {};
    const rebuilt = new Uint8Array(cells);
    remote.subscribe((e) => {
      if (e.type === 'diff') for (let i = 0; i < e.diff.cells.length; i++) rebuilt[e.diff.cells[i] as number] = e.diff.owners[i] as number;
    });
    const tickSet = new Set<number>(GOLDEN_TICKS);
    for (let tick = 0; tick < 6000; tick++) {
      submitScenarioFor(remote, tick, GOLDEN_PARAMS.seed, GOLDEN_PARAMS.seats, cells);
      remote.advance(TICK_MS);
      if (tickSet.has(tick + 1)) {
        const snap = await remote.requestSnapshot(); // flushes everything before it (messages are ordered)
        expect(snap.tick).toBe(tick + 1);
        got[String(tick + 1)] = hex32(snap.hash);
        if (tick + 1 === 6000) {
          const r = deserialize(snap.bytes);
          expect(r.ok && r.state.owner).toEqual(rebuilt);
        }
      }
    }
    await transport.idle();
    expect(got).toEqual(golden.hashes);
    expect(transport.copies).toBeGreaterThan(12000);
  });

  it('ignores malformed messages at the trust boundary without throwing, and keeps serving', async () => {
    const { transport, host, remote } = pair(createEmptyState(6, 5, 1, 4, { debugIntents: true }));
    const raw = transport.client as unknown as { post(m: unknown): void };
    for (const junk of [null, 5, 'x', [], {}, { type: 'nope' }, { type: 'submit' }, { type: 'submit', body: 3 }, { type: 'speed', speed: 7 }, { type: 'advance', dtMs: 'a' }, { type: 'snapshot', requestId: 'z' }]) raw.post(junk);
    await transport.idle();
    expect(host.tick).toBe(0);
    expect(host.speed).toBe(1);
    remote.advance(100);
    await transport.idle();
    expect(host.tick).toBe(1);
    // the junk "submit" bodies became INVALID intents, not crashes: they are refused by step
    for (let i = 0; i < 3; i++) remote.advance(100);
    await transport.idle();
    const snap = await remote.requestSnapshot();
    const r = deserialize(snap.bytes);
    expect(r.ok && r.state.rejects).toBe(2);
  });

  it('events reach every subscriber as separate copies; unsubscribing works', async () => {
    const { transport, remote } = pair(createEmptyState(6, 5, 1, 4, { debugIntents: true }));
    const a: HostEvent[] = [];
    const b: HostEvent[] = [];
    const stopA = remote.subscribe((e) => a.push(e));
    remote.subscribe((e) => b.push(e));
    remote.submitIntent({ kind: 'DebugPaint', seat: 1, cell: 4 });
    remote.setSpeed(4);
    remote.advance(100);
    await transport.idle();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(2);
    const da = a.find((e) => e.type === 'diff') as { diff: StateDiff };
    const db = b.find((e) => e.type === 'diff') as { diff: StateDiff };
    expect(da.diff.cells.buffer).not.toBe(db.diff.cells.buffer); // every listener has its own copy
    da.diff.cells.fill(55);
    expect(Array.from(db.diff.cells)).toEqual([4]);
    stopA();
    remote.advance(100);
    await transport.idle();
    expect(a.length).toBeLessThan(b.length);
  });

  it('dispose rejects open snapshot requests and stops the host', async () => {
    const { transport, host, remote } = pair();
    const p = remote.requestSnapshot();
    remote.dispose();
    await expect(p).rejects.toThrow(/disposed/);
    await transport.idle();
    host.advance(1000);
    expect(host.tick).toBe(0);
  });

  it('a host that cannot answer a snapshot reports an error message instead of hanging silently', async () => {
    const transport = createLocalTransport<ClientMessage, HostMessage>();
    const broken = {
      submitIntent() {},
      setSpeed() {},
      advance() {},
      subscribe: () => () => {},
      requestSnapshot: () => Promise.reject(new Error('no state')),
      dispose() {},
    };
    serveHost(broken, transport.host);
    const remote = new RemoteHost(transport.client);
    void remote.requestSnapshot();
    await transport.idle();
    await Promise.resolve();
    await transport.idle();
    expect(remote.lastError).toMatch(/no state/);
  });
});

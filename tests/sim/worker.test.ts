// The simulation in a worker_threads Worker against the main thread: same hashes, same host protocol over a real port.
import fc from 'fast-check';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RemoteHost } from '../../src/host/remote';
import type { ClientMessage, HostMessage, Port } from '../../src/host/protocol';
import { hex32 } from '../../src/sim/hash';
import type { Intent } from '../../src/sim/intents';
import { createScenarioState, GOLDEN_PARAMS, GOLDEN_TICKS, scenarioHashes } from '../../src/sim/scenario';
import { deserialize, hashState } from '../../src/sim/serialize';
import { createEmptyState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { TICK_MS } from '../../src/sim/rules';
import { readGolden } from '../helpers/simGolden';
import { submitScenarioFor } from '../host/helpers';
import { smallMatchIntent } from './helpers/arbitraries';

let worker: Worker;
let nextId = 1;
const waiting = new Map<number, (m: any) => void>();
const hostInbox: Array<(m: HostMessage) => void> = [];

function call<T>(job: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve) => {
    waiting.set(id, resolve as (m: any) => void);
    worker.postMessage({ ...job, id });
  });
}

/** The client end of a SimHost port over the worker's message channel (real structured clone across a thread). */
function workerPort(): Port<ClientMessage, HostMessage> {
  return {
    post: (m, transfer) => worker.postMessage({ channel: 'host', m }, transfer ?? []),
    onMessage: (h) => {
      hostInbox.push(h);
      return () => {
        const i = hostInbox.indexOf(h);
        if (i >= 0) hostInbox.splice(i, 1);
      };
    },
    close: () => undefined,
  };
}

beforeAll(async () => {
  worker = new Worker(new URL('./helpers/simWorkerBoot.mjs', import.meta.url));
  worker.on('message', (m: any) => {
    if (m && m.channel === 'host') {
      for (const h of hostInbox) h(m.m as HostMessage);
    } else if (m && typeof m.id === 'number') {
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  });
  worker.on('error', (e) => {
    throw e;
  });
  // A first round trip proves the worker started (tsx loaded) before any test runs.
  const r = await call<{ hashes: number[] }>({ cmd: 'golden', seed: 1 });
  expect(r.hashes).toHaveLength(5);
}, 60_000);

afterAll(async () => {
  await worker?.terminate();
});

describe('worker_threads against the main thread', () => {
  it('the golden scenario in the worker gives the committed hashes at 1, 10, 100, 1000 and 6000', async () => {
    const golden = readGolden();
    const r = await call<{ hashes: number[] }>({ cmd: 'golden', seed: golden.seed });
    expect(r.hashes.map(hex32)).toEqual(GOLDEN_TICKS.map((t) => golden.hashes[String(t)]));
    expect(r.hashes).toEqual(scenarioHashes());
  });

  it('another seed agrees too', async () => {
    const r = await call<{ hashes: number[] }>({ cmd: 'golden', seed: 12345 });
    expect(r.hashes).toEqual(scenarioHashes({ seed: 12345 }));
  });

  it('500 random matches: the worker\'s hash at every tick equals the main thread\'s (fast-check)', async () => {
    const W = 6;
    const H = 5;
    const SEATS = 4;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -2147483648, max: 4294967295 }),
        fc.boolean(),
        fc.array(fc.array(smallMatchIntent(SEATS, W * H), { maxLength: 6 }), { minLength: 1, maxLength: 30 }),
        async (seed, debug, turns) => {
          const local = createEmptyState(W, H, seed, SEATS, { debugIntents: debug });
          const expected: number[] = [];
          for (const intents of turns) {
            step(local, { turn: local.tick, intents: intents as Intent[] });
            expected.push(hashState(local));
          }
          const got = await call<{ trace: number[] }>({ cmd: 'match', seed, debug, width: W, height: H, seats: SEATS, turns });
          expect(got.trace).toEqual(expected);
        },
      ),
      { numRuns: 500 },
    );
  }, 60_000);

  it('a SimHost served by the worker over its real port reaches the committed hashes (RemoteHost on the main thread)', async () => {
    const golden = readGolden();
    await call({ cmd: 'host', seed: golden.seed });
    const remote = new RemoteHost(workerPort());
    const cells = GOLDEN_PARAMS.width * GOLDEN_PARAMS.height;
    const elev = createScenarioState({ seed: golden.seed }).env.maxElev as Int16Array;
    const tickSet = new Set<number>(GOLDEN_TICKS);
    const got: Record<string, string> = {};
    let lastDiffTick = 0;
    remote.subscribe((e) => {
      if (e.type === 'diff') lastDiffTick = e.diff.toTick;
    });
    for (let tick = 0; tick < 6000; tick++) {
      submitScenarioFor(remote, tick, golden.seed, GOLDEN_PARAMS.seats, cells);
      remote.advance(TICK_MS);
      if (tickSet.has(tick + 1)) {
        const snap = await remote.requestSnapshot();
        expect(snap.tick).toBe(tick + 1);
        got[String(tick + 1)] = hex32(snap.hash);
        const r = deserialize(snap.bytes, { maxElev: elev }); // Fix-4A2: the golden scenario has helicopters in the air at the end
        expect(r.ok && hashState(r.state)).toBe(snap.hash);
      }
    }
    expect(got).toEqual(golden.hashes);
    expect(lastDiffTick).toBe(6000);
    remote.dispose();
  }, 60_000);
});

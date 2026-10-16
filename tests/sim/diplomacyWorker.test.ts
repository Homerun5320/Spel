// M18c-1: a diplomacy game (proposals, a truce that runs out, an alliance, a betrayal, embargoes) gives the same hash at every tick in a worker_threads Worker as in
// Node's main thread: nothing in the diplomacy code depends on the thread, the clock or the order of object keys.
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withId, type Intent, type IntentBody } from '../../src/sim/intents';
import { TRUCE_TICKS } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { createEmptyState } from '../../src/sim/state';
import { step } from '../../src/sim/step';

const SEATS = 4;
const SCRIPT: Record<number, IntentBody[]> = {
  3: [{ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }, { kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 2 }, { kind: 'ProposeTreaty', seat: 3, to: 0, treaty: 2 }],
  5: [{ kind: 'AcceptTreaty', seat: 1, from: 0 }, { kind: 'ImposeEmbargo', seat: 0, target: 2 }],
  20: [{ kind: 'DeclineTreaty', seat: 1, from: 2 }, { kind: 'AcceptTreaty', seat: 0, from: 3 }],
  30: [{ kind: 'ProposeTreaty', seat: 1, to: 2, treaty: 2 }],
  34: [{ kind: 'AcceptTreaty', seat: 2, from: 1 }, { kind: 'BreakTreaty', seat: 0, with: 3 }],
  60: [{ kind: 'ImposeEmbargo', seat: 3, target: 2 }, { kind: 'LiftEmbargo', seat: 0, target: 2 }, { kind: 'ProposeTreaty', seat: 3, to: 1, treaty: 1 }],
  700: [{ kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 1 }],
  [5 + TRUCE_TICKS + 2]: [{ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }],
};
const TURNS = 5 + TRUCE_TICKS + 40;

function turns(): Intent[][] {
  let id = 1;
  const out: Intent[][] = [];
  for (let t = 0; t < TURNS; t++) out.push((SCRIPT[t] ?? []).map((b) => withId(b, id++)));
  return out;
}

let worker: Worker;
const waiting = new Map<number, (m: { trace: number[] }) => void>();
let nextId = 1;

beforeAll(() => {
  worker = new Worker(new URL('./helpers/simWorkerBoot.mjs', import.meta.url));
  worker.on('message', (m: { id: number; trace: number[] }) => {
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
});
afterAll(async () => {
  await worker?.terminate();
});

describe('diplomacy in a worker_threads Worker', () => {
  it('the hash trace of a diplomacy game is the same in the worker and in the main thread, and the game really exercised the tables', async () => {
    const list = turns();
    const s = createEmptyState(16, 8, 3, SEATS, { debugIntents: false });
    const trace: number[] = [];
    let sawProposal = false;
    let sawTruce = false;
    let sawAlliance = false;
    for (const intents of list) {
      step(s, { turn: s.tick, intents });
      trace.push(hashState(s));
      sawProposal ||= s.diplo.propCount > 0;
      sawTruce ||= s.diplo.pairs.some((k) => s.diplo.relation[k] === 1);
      sawAlliance ||= s.diplo.pairs.some((k) => s.diplo.relation[k] === 2);
    }
    expect([sawProposal, sawTruce, sawAlliance]).toEqual([true, true, true]);
    expect(s.rejects, 'the script is valid except for the planned refusals').toBeLessThanOrEqual(4);
    expect(s.match.treatiesBroken[1]).toBe(1);
    expect(new Set(trace).size).toBeGreaterThan(40);
    const id = nextId++;
    const got = await new Promise<{ trace: number[] }>((resolve) => {
      waiting.set(id, resolve);
      worker.postMessage({ cmd: 'match', id, seed: 3, debug: false, width: 16, height: 8, seats: SEATS, turns: list });
    });
    expect(got.trace).toEqual(trace);
  }, 60_000);
});

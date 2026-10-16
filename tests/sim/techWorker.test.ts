// M18d-1: a technology game (two seats researching in different branches, a cancel, a refused Research, finished techs with effects on the economy) gives the same hash at every tick in a
// worker_threads Worker as in Node's main thread: nothing in the technology code depends on the thread, the clock or the order of object keys.
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withId, type Intent, type IntentBody } from '../../src/sim/intents';
import { TECH_TICKS } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { createEmptyState } from '../../src/sim/state';
import { step } from '../../src/sim/step';

const SEATS = 3;
const T1 = TECH_TICKS[0] as number;
const SCRIPT: Record<number, IntentBody[]> = {
  0: [{ kind: 'DebugPaint', seat: 0, cell: 5 }, { kind: 'DebugPaint', seat: 1, cell: 90 }],
  1: [{ kind: 'DebugGive', seat: 0, gold: 20000, troops: 0 }, { kind: 'DebugGive', seat: 1, gold: 20000, troops: 0 }],
  5: [{ kind: 'Research', seat: 0, tech: 0 }, { kind: 'Research', seat: 1, tech: 4 }, { kind: 'Research', seat: 2, tech: 8 }],
  9: [{ kind: 'Research', seat: 0, tech: 1 }, { kind: 'Research', seat: 1, tech: 9 }],
  [5 + T1 + 3]: [{ kind: 'Research', seat: 0, tech: 1 }, { kind: 'Research', seat: 1, tech: 5 }],
  [5 + T1 + 8]: [{ kind: 'CancelResearch', seat: 1 }],
  [5 + T1 + 12]: [{ kind: 'Research', seat: 1, tech: 12 }],
  [5 + 3 * T1]: [{ kind: 'Research', seat: 0, tech: 2 }, { kind: 'Research', seat: 0, tech: 3 }],
};
const TURNS = 5 + 4 * T1;

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

describe('technology in a worker_threads Worker', () => {
  it('the hash trace of a research game is the same in the worker and in the main thread, and the game really researched', async () => {
    const list = turns();
    const s = createEmptyState(16, 8, 3, SEATS, { debugIntents: true });
    const trace: number[] = [];
    for (const intents of list) {
      step(s, { turn: s.tick, intents });
      trace.push(hashState(s));
    }
    expect(s.match.techMask[1], 'seat 0 finished steps 1 and 2 of ECONOMY and more').not.toBe(0);
    expect(s.match.techMask[2], 'seat 1 finished a LAND step').not.toBe(0);
    expect(s.rejects, 'the script is valid except for the planned refusals (seat 2 has no gold, the second Research while busy, the cancelled one)').toBeGreaterThan(0);
    expect(s.rejects).toBeLessThanOrEqual(8);
    expect(new Set(trace).size).toBeGreaterThan(40);
    const id = nextId++;
    const got = await new Promise<{ trace: number[] }>((resolve) => {
      waiting.set(id, resolve);
      worker.postMessage({ cmd: 'match', id, seed: 3, debug: true, width: 16, height: 8, seats: SEATS, turns: list });
    });
    expect(got.trace).toEqual(trace);
  }, 60_000);
});

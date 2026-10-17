// M18e-1: a game that builds all nine structure types, upgrades the Airfield and the Lab, produces a helicopter (shortened by the Airfield) and researches (shortened by the Lab)
// gives the same hash at every tick in a worker_threads Worker as in Node's main thread.
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withId, type Intent, type IntentBody } from '../../src/sim/intents';
import { hashState } from '../../src/sim/serialize';
import { createEmptyState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import {
  STRUCT_AIRFIELD,
  STRUCT_CITY,
  STRUCT_FACTORY,
  STRUCT_LAB,
  STRUCT_PLANT,
  STRUCT_PORT,
  STRUCT_POST,
  STRUCT_SAM,
  STRUCT_SILO,
  STRUCT_TYPE_SLOTS,
} from '../../src/sim/structureRules';

const W = 16;
const H = 8;
const SEATS = 2;
const at = (x: number, y: number): number => y * W + x;
const PLAN: Array<[number, number]> = [
  [STRUCT_CITY, at(1, 1)],
  [STRUCT_PLANT, at(3, 1)],
  [STRUCT_FACTORY, at(1, 5)],
  [STRUCT_PORT, at(14, 1)],
  [STRUCT_SAM, at(8, 1)],
  [STRUCT_POST, at(5, 5)],
  [STRUCT_AIRFIELD, at(13, 5)],
  [STRUCT_LAB, at(7, 6)],
];
const SILO_CELL = at(9, 3);
const SCRIPT: Record<number, IntentBody[]> = {
  0: [...PLAN.map(([, cell]): IntentBody => ({ kind: 'DebugPaint', seat: 0, cell })), { kind: 'DebugPaint', seat: 0, cell: SILO_CELL }],
  1: [{ kind: 'DebugGive', seat: 0, gold: 20000, troops: 0 }],
  5: PLAN.map(([type, cell]): IntentBody => ({ kind: 'Build', seat: 0, type, cell })),
  230: [{ kind: 'Build', seat: 0, type: STRUCT_SILO, cell: SILO_CELL }],
  240: [
    { kind: 'ProduceHeli', seat: 0, factory: 2 },
    { kind: 'Upgrade', seat: 0, structure: 6 },
    { kind: 'Upgrade', seat: 0, structure: 7 },
    { kind: 'Research', seat: 0, tech: 0 },
  ],
};
const TURNS = 240 + 700;

function turns(): Intent[][] {
  let id = 1;
  const out: Intent[][] = [];
  for (let t = 0; t < TURNS; t++) out.push((SCRIPT[t] ?? []).map((b) => withId(b, id++)));
  return out;
}

let worker: Worker;
const waiting = new Map<number, (m: { trace: number[] }) => void>();

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

describe('all nine structure types in a worker_threads Worker', () => {
  it('the hash trace is the same in the worker and in the main thread, and the game really had all nine types, a shortened helicopter and a shortened research', async () => {
    const list = turns();
    const s = createEmptyState(W, H, 3, SEATS, { debugIntents: true });
    const trace: number[] = [];
    for (const intents of list) {
      step(s, { turn: s.tick, intents });
      trace.push(hashState(s));
    }
    expect(s.rejects, 'the script is legal').toBe(0);
    for (let type = 1; type < STRUCT_TYPE_SLOTS; type++) expect(s.structures.ownedCount(1, type), `type ${type}`).toBe(1);
    expect(s.helis.liveCount).toBe(1);
    expect(s.match.techMask[1], 'tech 0 researched').toBe(1);
    expect(s.structures.level[6]).toBe(2);
    expect(s.structures.level[7]).toBe(2);
    expect(new Set(trace).size).toBeGreaterThan(40);
    const got = await new Promise<{ trace: number[] }>((resolve) => {
      waiting.set(1, resolve);
      worker.postMessage({ cmd: 'match', id: 1, seed: 3, debug: true, width: W, height: H, seats: SEATS, turns: list });
    });
    expect(got.trace).toEqual(trace);
  }, 60_000);
});

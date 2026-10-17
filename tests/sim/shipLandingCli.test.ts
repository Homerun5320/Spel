// M13c-1: `npm run sim:scenario -- ship-landing --seed N` (tools/sim/shipLanding.ts): the same arguments print the same bytes, the voyage has the documented shape, and a worker_threads
// Worker prints the same lines and ends on the same state hash as Node's main thread.
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hex32 } from '../../src/sim/hash';
import { OUTBOX_BEACHHEAD_FORMED, OUTBOX_SHIP_LANDED, OUTBOX_SHIP_LAUNCHED, OUTBOX_SHIP_RETURNED, OUTBOX_SHIP_RTB } from '../../src/sim/outbox';
import { parseShipLandingArgs, runShipLanding, shipLanding } from '../../tools/sim/shipLanding';

// The final hash of seed 1 (rewrite it only together with an ENGINE or FORMAT bump, DECISIONS M13c-1).
const SEED1_HASH = '804ef7cc'; // ENGINE 27 / FORMAT 18 (M14a: the engine version word and the missile fold move the hash, the voyage itself is unchanged: 'a5b6d6f3' on ENGINE 26)

describe('ship-landing', () => {
  it('prints the same bytes for the same seed and different bytes for another', () => {
    expect(shipLanding({ seed: 1 })).toBe(shipLanding({ seed: 1 }));
    expect(shipLanding({ seed: 1 })).not.toBe(shipLanding({ seed: 2 }));
    expect(runShipLanding(1).hash).not.toBe(runShipLanding(2).hash);
  });

  it('the voyage: launch, landing, the beachhead, the turn for home and the docking, in that order, with the documented ticks', () => {
    const r = runShipLanding(1);
    const kinds = r.events.map((e) => e.kind);
    expect(kinds).toEqual([OUTBOX_SHIP_LAUNCHED, OUTBOX_SHIP_LANDED, OUTBOX_BEACHHEAD_FORMED, OUTBOX_SHIP_RTB, OUTBOX_SHIP_RETURNED]);
    const launched = r.events[0];
    const landed = r.events[1];
    const docked = r.events[4];
    expect(launched?.tick).toBe(123); // the fixture starts at tick 120 (the Port is finished) and the intent is filed for turn 3 of the run
    expect(landed?.b).toBeGreaterThan(0);
    expect(r.landedTick).toBe(landed?.tick);
    // the sail and the return are the same route: the docking is as long after the landing as the landing is after the launch, minus the unloading (the rounding of the corners differs by a tick or two)
    const back = (docked?.tick as number) - (landed?.tick as number);
    const out = (landed?.tick as number) - (launched?.tick as number) - 20;
    expect(Math.abs(back - out)).toBeLessThanOrEqual(4);
    expect(out).toBeGreaterThan(300); // a real crossing round the island, not a hop
    const text = shipLanding({ seed: 1 });
    expect(text.split('\n')[0]).toBe('ship-landing seed=1');
    expect(text).toContain(`tick ${landed?.tick} ship-landed`);
    expect(text.split('\n').at(-1)).toBe(`final state hash ${hex32(r.hash)}`);
  });

  it('the final hash of seed 1 is pinned', () => {
    expect(hex32(runShipLanding(1).hash)).toBe(SEED1_HASH);
  });

  it('reads --seed and refuses nonsense', () => {
    expect(parseShipLandingArgs([])).toEqual({ seed: 1 });
    expect(parseShipLandingArgs(['--seed', '7'])).toEqual({ seed: 7 });
    expect(() => parseShipLandingArgs(['--seed', 'x'])).toThrow();
    expect(() => parseShipLandingArgs(['--seed', '-1'])).toThrow();
    expect(() => parseShipLandingArgs(['--nope'])).toThrow();
  });
});

let worker: Worker;
const waiting = new Map<number, (m: { lines: string[]; hash: number; landedTick: number }) => void>();

beforeAll(() => {
  worker = new Worker(new URL('./helpers/shipWorkerBoot.mjs', import.meta.url));
  worker.on('message', (m: { id: number; lines: string[]; hash: number; landedTick: number }) => {
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
});
afterAll(async () => {
  await worker?.terminate();
});

describe('ship-landing in a worker_threads Worker', () => {
  it('prints the same lines and ends on the same state hash as the main thread, for three seeds', async () => {
    for (let seed = 1; seed <= 3; seed++) {
      const here = runShipLanding(seed);
      const got = await new Promise<{ lines: string[]; hash: number; landedTick: number }>((resolve) => {
        waiting.set(seed, resolve);
        worker.postMessage({ id: seed, seed });
      });
      expect(got.lines, `seed ${seed}`).toEqual(here.lines);
      expect(got.hash, `seed ${seed}`).toBe(here.hash);
      expect(got.landedTick).toBe(here.landedTick);
      expect(here.landedTick, 'the ship really landed').toBeGreaterThan(0);
    }
  }, 60_000);
});

// M14a: `npm run sim:scenario -- missiles --fixture <plain-cruise|fusion-silo> --seed N` (tools/sim/missiles.ts): the same arguments print the same bytes, the replay has the documented shape,
// the final hashes are pinned, and a worker_threads Worker prints the same lines and ends on the same state hash as Node's main thread.
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hex32 } from '../../src/sim/hash';
import {
  OUTBOX_MISSILE_BUILDING_DESTROYED,
  OUTBOX_MISSILE_DETONATED,
  OUTBOX_MISSILE_LAUNCHED,
  OUTBOX_MISSILE_WARNING,
} from '../../src/sim/outbox';
import { MISSILE_FUSION, MISSILE_TACTICAL } from '../../src/sim/missileTable';
import { missiles, parseMissilesArgs, runMissiles, type MissileFixtureName } from '../../tools/sim/missiles';

// The final hashes of seed 1 (rewrite them only together with an ENGINE or FORMAT bump, DECISIONS M14a).
const PINNED: Record<MissileFixtureName, string> = { 'plain-cruise': '0b915a5e', 'fusion-silo': '9805566c', 'ridge-cruise': '4051de41', 'sam-stack': '467f8695' }; // ENGINE 29 (Fix-6A1): the engine word moves the first three; sam-stack also moves because the interceptor meets the warhead on the constant-rate arc (was 120ec259 bed34779 dc297545 6cb6a529 on ENGINE 28)

describe('missiles', () => {
  it('prints the same bytes for the same arguments and different bytes for another seed or fixture', () => {
    expect(missiles({ fixture: 'plain-cruise', seed: 1 })).toBe(missiles({ fixture: 'plain-cruise', seed: 1 }));
    expect(missiles({ fixture: 'plain-cruise', seed: 1 })).not.toBe(missiles({ fixture: 'plain-cruise', seed: 2 }));
    expect(runMissiles('plain-cruise', 1).hash).not.toBe(runMissiles('fusion-silo', 1).hash);
  });

  it('plain-cruise: launch, warning, the destroyed buildings and the blast 30 ticks later; nobody changes owner', () => {
    const r = runMissiles('plain-cruise', 1);
    const kinds = r.events.map((e) => e.kind);
    expect(kinds.slice(0, 2)).toEqual([OUTBOX_MISSILE_LAUNCHED, OUTBOX_MISSILE_WARNING]);
    expect(kinds.at(-1)).toBe(OUTBOX_MISSILE_DETONATED);
    expect(kinds.filter((k) => k === OUTBOX_MISSILE_BUILDING_DESTROYED).length).toBeGreaterThanOrEqual(2);
    const launched = r.events[0];
    const blast = r.events.at(-1);
    expect((blast?.tick as number) - (launched?.tick as number)).toBe(30);
    expect(blast?.a).toBe(MISSILE_TACTICAL);
    expect(r.blastTick).toBe(blast?.tick);
    expect(r.painted).toBe(0);
    const text = missiles({ fixture: 'plain-cruise', seed: 1 });
    expect(text.split('\n')[0]).toBe('missiles fixture=plain-cruise seed=1');
    expect(text).toContain('fallout 0 cells');
    expect(text.split('\n').at(-1)).toBe(`final state hash ${hex32(r.hash)}`);
  });

  it('fusion-silo: 50 ticks of flight, a disc of about a thousand cells goes neutral and becomes fallout', () => {
    const r = runMissiles('fusion-silo', 1);
    const launched = r.events[0];
    const blast = r.events.at(-1);
    expect((blast?.tick as number) - (launched?.tick as number)).toBe(50);
    expect(blast?.a).toBe(MISSILE_FUSION);
    expect(r.painted).toBeGreaterThan(900);
    expect(r.painted).toBeLessThan(1100);
    expect(missiles({ fixture: 'fusion-silo', seed: 1 })).toMatch(/fallout 10\d\d cells/);
  });

  it('the final hashes of seed 1 are pinned', () => {
    expect(hex32(runMissiles('plain-cruise', 1).hash)).toBe(PINNED['plain-cruise']);
    expect(hex32(runMissiles('fusion-silo', 1).hash)).toBe(PINNED['fusion-silo']);
    expect(hex32(runMissiles('ridge-cruise', 1).hash)).toBe(PINNED['ridge-cruise']);
    expect(hex32(runMissiles('sam-stack', 1).hash)).toBe(PINNED['sam-stack']);
  });

  it('reads --fixture and --seed and refuses nonsense (the SAM fixtures are M14b)', () => {
    expect(parseMissilesArgs([])).toEqual({ fixture: 'plain-cruise', seed: 1 });
    expect(parseMissilesArgs(['--fixture', 'fusion-silo', '--seed', '7'])).toEqual({ fixture: 'fusion-silo', seed: 7 });
    expect(parseMissilesArgs(['--fixture', 'sam-stack'])).toEqual({ fixture: 'sam-stack', seed: 1 }); // M14b: the SAM fixtures exist now
    expect(parseMissilesArgs(['--fixture', 'ridge-cruise'])).toEqual({ fixture: 'ridge-cruise', seed: 1 });
    expect(() => parseMissilesArgs(['--fixture', 'nope'])).toThrow();
    expect(() => parseMissilesArgs(['--seed', 'x'])).toThrow();
    expect(() => parseMissilesArgs(['--seed', '-1'])).toThrow();
    expect(() => parseMissilesArgs(['--nope'])).toThrow();
  });
});

let worker: Worker;
const waiting = new Map<number, (m: { lines: string[]; hash: number; blastTick: number }) => void>();

beforeAll(() => {
  worker = new Worker(new URL('./helpers/missileWorkerBoot.mjs', import.meta.url));
  worker.on('message', (m: { id: number; lines: string[]; hash: number; blastTick: number }) => {
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
});
afterAll(async () => {
  await worker?.terminate();
});

describe('missiles in a worker_threads Worker', () => {
  it('prints the same lines and ends on the same state hash as the main thread, for all four fixtures and three seeds', async () => {
    let id = 0;
    for (const fixture of ['plain-cruise', 'fusion-silo', 'ridge-cruise', 'sam-stack'] as const) {
      for (let seed = 1; seed <= 3; seed++) {
        const here = runMissiles(fixture, seed);
        const mine = ++id;
        const got = await new Promise<{ lines: string[]; hash: number; blastTick: number }>((resolve) => {
          waiting.set(mine, resolve);
          worker.postMessage({ id: mine, fixture, seed });
        });
        expect(got.lines, `${fixture} seed ${seed}`).toEqual(here.lines);
        expect(got.hash, `${fixture} seed ${seed}`).toBe(here.hash);
        expect(here.blastTick, 'the missile really blew up').toBeGreaterThan(0);
      }
    }
  }, 60_000);
});

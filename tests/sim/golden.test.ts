// The golden hashes: the same scenario hashed at ticks 1, 10, 100, 1000 and 6000 must equal e2e/goldens/sim-hashes.json,
// which the Playwright test of debug/sim.html reads too. Sensitivity tests make sure a stub cannot pass.
import { describe, expect, it } from 'vitest';
import { canaryHash, CANARY_VALUES } from '../../src/sim/canary';
import { hex32 } from '../../src/sim/hash';
import { GOLDEN_PARAMS, GOLDEN_TICKS, createScenarioState, runScenario, scenarioHashes } from '../../src/sim/scenario';
import { hashState } from '../../src/sim/serialize';
import { step } from '../../src/sim/step';
import { computeGolden, readGolden, writeGolden } from '../helpers/simGolden';
import { withHostileGlobals } from './helpers/hostile';
import { stepWithMathRandom } from './helpers/nondeterministicStep';

if (process.env.UPDATE_GOLDENS === '1') {
  const g = computeGolden();
  writeGolden(g);
  console.log(`[golden] updated e2e/goldens/sim-hashes.json ${JSON.stringify(g.hashes)}`);
}

describe('golden hashes (Node)', () => {
  const golden = readGolden();

  it('the committed file describes the golden scenario', () => {
    expect(golden.seed).toBe(GOLDEN_PARAMS.seed);
    expect(golden.width).toBe(GOLDEN_PARAMS.width);
    expect(golden.height).toBe(GOLDEN_PARAMS.height);
    expect(golden.seats).toBe(GOLDEN_PARAMS.seats);
    expect(golden.debugIntents).toBe(GOLDEN_PARAMS.config.debugIntents);
    expect(golden.ticks).toEqual([1, 10, 100, 1000, 6000]);
    expect(Object.keys(golden.hashes)).toEqual(['1', '10', '100', '1000', '6000']);
  });

  it('matches at ticks 1, 10, 100, 1000 and 6000 (and the fixture world hash)', () => {
    const now = computeGolden();
    expect(now.mapHash).toBe(golden.mapHash);
    expect(now.hashes).toEqual(golden.hashes);
    expect(now.engineVersion).toBe(golden.engineVersion);
    expect(now.formatVersion).toBe(golden.formatVersion);
  });

  it('the five hashes are all different (the run really changes the state)', () => {
    expect(new Set(Object.values(golden.hashes)).size).toBe(5);
  });

  it('the Float64 canary equals the committed value', () => {
    expect(golden.canary.values).toBe(CANARY_VALUES);
    expect(hex32(canaryHash())).toBe(golden.canary.hash);
  });
});

describe('sensitivity: a stub or a changed input cannot pass', () => {
  const golden = readGolden();
  const at = (seed: number, tick: number): string => {
    const s = createScenarioState({ seed });
    runScenario(s, tick);
    return hex32(hashState(s));
  };

  it.each([10, 100, 1000])('another seed gives another hash at tick %i', (tick) => {
    expect(at(2, tick)).not.toBe(golden.hashes[String(tick)]);
    expect(at(3, tick)).not.toBe(at(2, tick));
  });

  it('one DebugPaint of one cell changes the hash', () => {
    const a = createScenarioState();
    const b = createScenarioState();
    runScenario(a, 20);
    runScenario(b, 20);
    expect(hashState(a)).toBe(hashState(b));
    // Both are at tick 20; paint a cell of b in its next turn.
    const cell = 7;
    const free = (b.owner[cell] as number) === 0 ? 1 : 0;
    step(a, { turn: 20, intents: [] });
    step(b, { turn: 20, intents: [{ kind: 'DebugPaint', seat: free, cell, id: 999 }] });
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('a stub that only counts ticks does not match the golden', () => {
    const stub = createScenarioState();
    for (let i = 0; i < 100; i++) stub.tick++;
    expect(hex32(hashState(stub))).not.toBe(golden.hashes['100']);
  });

  it('a deliberately non-deterministic copy of step (Math.random in a test-only module) FAILS the golden test', () => {
    const bad = computeGolden(stepWithMathRandom);
    // Not equal to the committed hashes ...
    expect(bad.hashes).not.toEqual(golden.hashes);
    expect(bad.hashes['6000']).not.toBe(golden.hashes['6000']);
    // ... and not even equal to itself on a second run.
    const again = computeGolden(stepWithMathRandom);
    expect(again.hashes['6000']).not.toBe(bad.hashes['6000']);
  });
});

describe('hostile globals', () => {
  it('a full golden run passes while Math.random, Date, performance.now, crypto and the transcendental Math functions throw', () => {
    // Build the throwing environment first: any use inside the run would surface as a thrown error.
    const hashes = withHostileGlobals(() => scenarioHashes());
    expect(hashes.map(hex32)).toEqual(GOLDEN_TICKS.map((t) => readGolden().hashes[String(t)]));
  });

  it('the hostile environment really throws (the guard itself works) and is restored afterwards', () => {
    const originalRandom = Math.random;
    const originalDate = Date;
    expect(() => withHostileGlobals(() => Math.random())).toThrow(/Math.random/);
    expect(() => withHostileGlobals(() => Date.now())).toThrow(/Date.now/);
    expect(() => withHostileGlobals(() => new Date())).toThrow(/Date used/);
    expect(() => withHostileGlobals(() => performance.now())).toThrow(/performance.now/);
    expect(() => withHostileGlobals(() => Math.sin(1))).toThrow(/Math.sin/);
    expect(Math.random).toBe(originalRandom);
    expect(Date).toBe(originalDate);
    expect(typeof Date.now()).toBe('number');
    expect(typeof performance.now()).toBe('number');
  });

  it('the copy that reads Math.random throws under the hostile environment', () => {
    expect(() => withHostileGlobals(() => scenarioHashes(GOLDEN_PARAMS, GOLDEN_TICKS, stepWithMathRandom))).toThrow(/Math.random/);
  });
});

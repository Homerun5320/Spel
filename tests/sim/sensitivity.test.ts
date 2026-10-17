// A negative test per state array and scalar: flipping one byte must change the hash. Together with the registry check
// this makes sure that a new state array cannot be forgotten in the hash.
import { describe, expect, it } from 'vitest';
import { GOLDEN_PARAMS, createScenarioState, runScenario } from '../../src/sim/scenario';
import { hashState } from '../../src/sim/serialize';
import {
  STATE_ARRAY_NAMES,
  STATE_SCALAR_NAMES,
  createEmptyState,
  createState,
  stateArray,
  type GameState,
} from '../../src/sim/state';

function sample(): GameState {
  const s = createScenarioState();
  runScenario(s, 200);
  return s;
}

function bytesOf(a: ArrayBufferView): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

describe('hash sensitivity', () => {
  it('the array registry is complete: every typed array on a state is listed, and nothing else is', () => {
    const s = sample();
    const typed = Object.entries(s)
      .filter(([, v]) => ArrayBuffer.isView(v))
      .map(([k]) => k)
      .sort();
    expect(typed).toEqual([...STATE_ARRAY_NAMES].sort());
    expect(Object.entries(s).filter(([, v]) => typeof v === 'number').map(([k]) => k).sort()).toEqual(['height', 'rejects', 'tick', 'width']);
    expect([...STATE_SCALAR_NAMES]).toEqual(['tick', 'rejects']);
  });

  describe.each(STATE_ARRAY_NAMES)('state array %s', (name) => {
    const probes = ['first byte', 'middle byte', 'last byte'] as const;
    it.each(probes)('flipping one bit of the %s changes the hash', (probe) => {
      const s = sample();
      const base = hashState(s);
      const bytes = bytesOf(stateArray(s, name));
      const at = probe === 'first byte' ? 0 : probe === 'last byte' ? bytes.length - 1 : bytes.length >> 1;
      for (const mask of [0x01, 0x80]) {
        bytes[at] = (bytes[at] as number) ^ mask;
        expect(hashState(s), `${name}[${at}] ^ ${mask}`).not.toBe(base);
        bytes[at] = (bytes[at] as number) ^ mask;
        expect(hashState(s)).toBe(base);
      }
    });

    it('flipping the top bit of the last word and the top bit of another word (the pure-FNV hole) both register', () => {
      const s = sample();
      const base = hashState(s);
      const bytes = bytesOf(stateArray(s, name));
      const last = bytes.length - 1;
      const other = Math.max(0, (bytes.length >> 1) - ((bytes.length >> 1) % 4) + 3);
      bytes[last] = (bytes[last] as number) ^ 0x80;
      bytes[other] = (bytes[other] as number) ^ 0x80;
      if (other !== last) expect(hashState(s)).not.toBe(base);
    });
  });

  it.each(STATE_SCALAR_NAMES)('state scalar %s', (name) => {
    const s = sample();
    const base = hashState(s);
    s[name] = (s[name] + 1) >>> 0;
    expect(hashState(s)).not.toBe(base);
  });

  it('the header takes part in the hash: seed, config, seats, map hash and engine version', () => {
    const w = sample();
    const make = (over: Partial<{ seed: number; seats: number; debugIntents: boolean; mapHash: number }>): number =>
      hashState(
        createState({
          width: 128,
          height: 64,
          seed: over.seed ?? 1,
          seats: over.seats ?? 4,
          config: { debugIntents: over.debugIntents ?? true },
          terrain: w.terrain,
          elevation: w.elevation,
          mapHash: over.mapHash,
        }),
      );
    const base = make({});
    expect(make({})).toBe(base);
    expect(make({ seed: 2 })).not.toBe(base);
    expect(make({ seats: 5 })).not.toBe(base);
    expect(make({ debugIntents: false })).not.toBe(base);
    expect(make({ mapHash: 1234 })).not.toBe(base);
    const other: GameState = { ...w, header: { ...w.header, engineVersion: w.header.engineVersion + 1 } };
    expect(hashState(other)).not.toBe(hashState(w));
    const h = (width: number, height: number): number => hashState(createEmptyState(width, height, 1, 1));
    expect(h(4, 2)).not.toBe(h(2, 4)); // same cell count, other shape
  });

  it('the golden scenario state at tick 0 hashes to the same value every time', () => {
    expect(hashState(createScenarioState(GOLDEN_PARAMS))).toBe(hashState(createScenarioState(GOLDEN_PARAMS)));
  });
});

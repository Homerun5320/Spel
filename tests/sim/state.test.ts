import { describe, expect, it } from 'vitest';
import { buildFixtureWorld, hash2 } from '../../src/sim/fixture';
import { hex32 } from '../../src/sim/hash';
import {
  ENGINE_VERSION,
  MAX_CELLS,
  MAX_DIMENSION,
  MAX_SEATS,
  NO_OWNER,
  NO_SEAT,
  createEmptyState,
  createState,
  hashWorld,
  ownerToSeat,
  seatToOwner,
} from '../../src/sim/state';
import { withHostileGlobals } from './helpers/hostile';

describe('seats and owners', () => {
  it('ownerId = seat + 1, 0 = unowned, and the two helpers are inverse', () => {
    expect(seatToOwner(0)).toBe(1);
    expect(seatToOwner(254)).toBe(255);
    expect(NO_OWNER).toBe(0);
    expect(ownerToSeat(NO_OWNER)).toBe(NO_SEAT);
    expect(NO_SEAT).toBe(-1);
    for (let seat = 0; seat < MAX_SEATS; seat++) expect(ownerToSeat(seatToOwner(seat))).toBe(seat);
    expect(MAX_SEATS).toBe(255);
  });
});

describe('createState', () => {
  const world = (w: number, h: number) => ({ terrain: new Uint8Array(w * h), elevation: new Uint16Array(w * h) });

  it('is parameterised by (width, height): arrays have width * height cells', () => {
    for (const [w, h] of [[1, 1], [3, 5], [128, 64], [1024, 512]] as const) {
      const s = createEmptyState(w, h, 1, 2);
      expect(s.width).toBe(w);
      expect(s.height).toBe(h);
      for (const a of [s.terrain, s.elevation, s.owner, s.stamp]) expect(a.length).toBe(w * h);
      expect(s.tick).toBe(0);
      expect(s.rejects).toBe(0);
      expect(s.header.engineVersion).toBe(ENGINE_VERSION);
    }
  });

  it('copies the world arrays and freezes the header', () => {
    const w = world(4, 4);
    w.terrain[3] = 5;
    const s = createState({ width: 4, height: 4, seed: 9, seats: 2, ...w });
    w.terrain[3] = 6;
    w.elevation[0] = 77;
    expect(s.terrain[3]).toBe(5);
    expect(s.elevation[0]).toBe(0);
    expect(Object.isFrozen(s.header)).toBe(true);
    expect(Object.isFrozen(s.header.config)).toBe(true);
    expect(s.header.mapHash).toBe(hashWorld(s.terrain, s.elevation));
    expect(createState({ width: 4, height: 4, seed: 9, seats: 2, ...w, mapHash: 0xabcdef01 }).header.mapHash).toBe(0xabcdef01);
  });

  it('the seed is stored as an unsigned 32-bit number, the generator is seeded from it', () => {
    expect(createEmptyState(2, 2, -1, 1).header.seed).toBe(4294967295);
    expect(createEmptyState(2, 2, 5, 1).rng).toEqual(createEmptyState(2, 2, 5, 1).rng);
    expect(createEmptyState(2, 2, 5, 1).rng).not.toEqual(createEmptyState(2, 2, 6, 1).rng);
  });

  it('refuses sizes and counts outside the structural limits (RangeError at construction, never later)', () => {
    const ok = world(2, 2);
    expect(() => createState({ width: 0, height: 2, seed: 1, seats: 1, terrain: new Uint8Array(0), elevation: new Uint16Array(0) })).toThrow(RangeError);
    expect(() => createState({ width: 2.5, height: 2, seed: 1, seats: 1, ...ok })).toThrow(RangeError);
    expect(() => createState({ width: 2, height: 2, seed: 1, seats: 0, ...ok })).toThrow(RangeError);
    expect(() => createState({ width: 2, height: 2, seed: 1, seats: MAX_SEATS + 1, ...ok })).toThrow(RangeError);
    expect(() => createState({ width: 2, height: 2, seed: 1.5, seats: 1, ...ok })).toThrow(RangeError);
    expect(() => createState({ width: 2, height: 2, seed: 1, seats: 1, terrain: new Uint8Array(3), elevation: new Uint16Array(4) })).toThrow(RangeError);
    expect(() => createState({ width: MAX_DIMENSION + 1, height: 1, seed: 1, seats: 1, terrain: new Uint8Array(1), elevation: new Uint16Array(1) })).toThrow(RangeError);
    expect(MAX_CELLS).toBe(2048 * 2048);
    expect(() => createEmptyState(2048, 2049, 1, 1)).toThrow(RangeError);
    expect(createEmptyState(2048, 2048, 1, 1).owner.length).toBe(MAX_CELLS);
  });

  it('has the config flags set from the options only', () => {
    expect(createEmptyState(2, 2, 1, 1).header.config.debugIntents).toBe(false);
    expect(createEmptyState(2, 2, 1, 1, { debugIntents: true }).header.config.debugIntents).toBe(true);
  });
});

describe('fixture world', () => {
  it('is a pure function of (seed, width, height)', () => {
    const a = buildFixtureWorld(1, 128, 64);
    const b = buildFixtureWorld(1, 128, 64);
    expect(a.terrain).toEqual(b.terrain);
    expect(a.elevation).toEqual(b.elevation);
    expect(buildFixtureWorld(2, 128, 64).terrain).not.toEqual(a.terrain);
  });

  it('is built without any float, random, clock or transcendental function (the hostile environment would throw)', () => {
    const w = withHostileGlobals(() => buildFixtureWorld(1, 128, 64));
    expect(hex32(hashWorld(w.terrain, w.elevation))).toBe('ffa491cd');
  });

  it('is a real-looking world: all eight classes, Ice only in the polar rows, sea has elevation 0, mountains are high', () => {
    const w = buildFixtureWorld(1, 128, 64);
    const counts = new Array<number>(8).fill(0);
    for (const t of w.terrain) counts[t] = (counts[t] as number) + 1;
    for (let c = 0; c < 8; c++) expect(counts[c], `class ${c}`).toBeGreaterThan(50);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 128; x++) {
        const i = y * 128 + x;
        const t = w.terrain[i] as number;
        if (t === 7) expect(y < 2 || y >= 62).toBe(true);
        else if (t <= 1) expect(w.elevation[i]).toBe(0);
        else if (t === 5) expect(w.elevation[i] as number).toBeGreaterThanOrEqual(900);
      }
    }
  });

  it('the integer division by 15 of the noise sum is exact for every possible sum', () => {
    for (let sum = 0; sum <= 255 * 15; sum++) expect((sum * 4370) >> 16).toBe(Math.floor(sum / 15));
  });

  it('hash2 spreads: 4096 neighbouring lattice points give 4096 different values', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) seen.add(hash2(1, x, y));
    expect(seen.size).toBe(4096);
  });
});

// The dry run of the Spawn disc (`countDisc`, the one spawn algorithm) and the sim-side match setup (`maskTerrain`, `startSeats`).
import { describe, expect, it } from 'vitest';
import { REJECT_NONE, REJECT_OWNED, REJECT_SPAWNED, REJECT_TERRAIN } from '../../src/sim/intents';
import { START_GOLD_MILLI, START_DISC_CELLS, START_TROOPS_QT } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { maskTerrain, startSeats } from '../../src/sim/setup';
import { claimDisc, countDisc } from '../../src/sim/spawn';
import { CLASS_DEEP_SEA, CLASS_ICE, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS, CLASS_SHALLOWS } from '../../src/sim/terrain';
import { islandState, landState } from './helpers/worlds';

describe('countDisc (a dry Spawn)', () => {
  it('equals what claimDisc really claims, on open land, a small island and a coast, and leaves the state exactly as it was', () => {
    const cases = [
      landState(80, 60, { seats: 4 }),
      islandState(80, 60, 10, 10, 9, 9),
      islandState(80, 60, 10, 10, 40, 30),
      landState(80, 60, { seats: 4, classAt: (x, y) => (x + y < 50 ? CLASS_PLAINS : CLASS_DEEP_SEA) }),
    ];
    for (const s of cases) {
      for (const cell of [12 * 80 + 12, 20 * 80 + 30, 30 * 80 + 40, 5 * 80 + 5]) {
        if (s.grid.playable[cell] !== 1) continue;
        const before = hashState(s);
        const counted = countDisc(s, cell);
        expect(hashState(s), 'a dry run changes nothing').toBe(before);
        expect(Array.from(s.scratch.mark).every((m) => m === 0), 'the scratch mark is left clean').toBe(true);
        const claimed = claimDisc(s, cell, 1, 0);
        expect(counted).toBe(claimed);
        expect(claimed).toBeLessThanOrEqual(START_DISC_CELLS);
        // undo for the next probe on the same state
        for (let i = 0; i < s.owner.length; i++) if (s.owner[i] === 1) s.owner[i] = 0;
        s.agg.area.fill(0);
        s.agg.warea.fill(0);
        s.borders.rebuild(s.owner, s.grid);
      }
    }
  });

  it('gives K on open land, the size of the island on a small island, and 0 for a cell that is owned, sea, Peak, Ice or outside', () => {
    const open = landState(80, 60);
    expect(countDisc(open, 30 * 80 + 40)).toBe(START_DISC_CELLS);
    const island = islandState(80, 60, 10, 10, 7, 7);
    expect(countDisc(island, 12 * 80 + 12)).toBe(49);
    const s = landState(80, 60, { classAt: (x, y) => (x === 5 ? CLASS_DEEP_SEA : x === 6 ? CLASS_PEAK : x === 7 ? CLASS_ICE : x === 8 ? CLASS_SHALLOWS : CLASS_PLAINS) });
    for (const x of [5, 6, 7, 8]) expect(countDisc(s, 30 * 80 + x), `x ${x}`).toBe(0); // sea, Peak, Ice, Shallows
    expect(countDisc(s, -1)).toBe(0);
    expect(countDisc(s, 80 * 60)).toBe(0);
    claimDisc(open, 30 * 80 + 40, 1, 0);
    expect(countDisc(open, 30 * 80 + 40)).toBe(0);
  });

  it('counts only the land that is still free: a disc next to an earlier one is cut short, and the earlier one keeps its K', () => {
    const s = landState(80, 60, { seats: 4 });
    claimDisc(s, 30 * 80 + 30, 1, 0);
    expect(s.agg.area[1]).toBe(START_DISC_CELLS);
    // 12 cells to the east: the two radius-8 discs overlap in a lens, so the second can no longer take the K nearest cells around its centre
    const near = countDisc(s, 30 * 80 + 42);
    expect(near).toBe(START_DISC_CELLS); // free land beyond still gives K: the disc grows outward instead
    // but on an island split by the first disc the second is short
    const strip = landState(80, 60, { seats: 4, classAt: (x, y) => (y >= 28 && y <= 32 ? CLASS_PLAINS : CLASS_DEEP_SEA) });
    claimDisc(strip, 30 * 80 + 40, 1, 0);
    expect(countDisc(strip, 30 * 80 + 41)).toBe(0);
    expect(countDisc(strip, 30 * 80 + 41 + 12)).toBeLessThanOrEqual(START_DISC_CELLS);
  });
});

describe('maskTerrain', () => {
  it('turns every playable cell outside the mask into Ice and leaves the rest, a null mask changes nothing', () => {
    const terrain = Uint8Array.from([CLASS_PLAINS, CLASS_MOUNTAIN, CLASS_DEEP_SEA, CLASS_PEAK, CLASS_SHALLOWS, CLASS_PLAINS]);
    const mask = Uint8Array.from([1, 0, 0, 0, 0, 1]);
    expect(Array.from(maskTerrain(terrain, mask))).toEqual([CLASS_PLAINS, CLASS_ICE, CLASS_DEEP_SEA, CLASS_PEAK, CLASS_SHALLOWS, CLASS_PLAINS]);
    expect(Array.from(maskTerrain(terrain, null))).toEqual(Array.from(terrain));
    expect(maskTerrain(terrain, null)).not.toBe(terrain);
  });
});

describe('startSeats (the pre-placed capitals of the fair start)', () => {
  it('places each seat at tick 0 with a whole disc, the same troops and the same gold', () => {
    const s = landState(120, 80, { seats: 4 });
    const cells = [20 * 120 + 20, 20 * 120 + 60, 60 * 120 + 40];
    const codes = startSeats(s, cells.map((cell, seat) => ({ seat, cell })));
    expect(codes).toEqual([REJECT_NONE, REJECT_NONE, REJECT_NONE]);
    for (let seat = 0; seat < 3; seat++) {
      const owner = seat + 1;
      expect(s.agg.area[owner], `seat ${seat}`).toBe(START_DISC_CELLS);
      expect(s.troops[owner]).toBe(START_TROOPS_QT);
      expect(s.gold[owner]).toBe(START_GOLD_MILLI);
      expect(s.capital[owner]).toBe((cells[seat] as number) + 1);
    }
    expect(s.agg.area[4]).toBe(0);
  });

  it('reports the refusal of a Spawn (terrain, owned cell, second Spawn of a seat) and leaves that seat unplaced', () => {
    const s = islandState(60, 40, 10, 10, 20, 20, { seats: 3 });
    const land = 20 * 60 + 20;
    const codes = startSeats(s, [
      { seat: 0, cell: 2 * 60 + 2 }, // sea
      { seat: 1, cell: land },
      { seat: 2, cell: land }, // owned by seat 1 now
      { seat: 1, cell: 25 * 60 + 15 }, // seat 1 again
    ]);
    expect(codes).toEqual([REJECT_TERRAIN, REJECT_NONE, REJECT_OWNED, REJECT_SPAWNED]);
    expect(s.capital[1]).toBe(0);
    expect(s.agg.area[1]).toBe(0);
  });

  it('throws when the state is not at tick 0 (the setup happens before play)', () => {
    const s = landState(60, 40);
    s.tick = 3;
    expect(() => startSeats(s, [{ seat: 0, cell: 20 * 60 + 20 }])).toThrow(RangeError);
  });
});

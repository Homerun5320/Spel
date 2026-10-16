// Fix-4B: the pure model of the beachhead explanation (src/ui/beachheadInfo.ts): the count-down, the soonest-ending own row, the seeds for the ring and the watcher that makes the two toasts.
import { describe, expect, it } from 'vitest';
import { BEACH_ESTABLISHED, BEACH_REVERTED, BeachheadWatcher, beachSecondsLeft, ownBeachChip, ownBeachSeeds, type BeachChip } from '../../src/ui/beachheadInfo';
import { BEACHHEAD_ESTABLISH_CELLS, BEACHHEAD_REVERT_TICKS, TICK_HZ } from '../../src/sim/rules';
import type { SimView } from '../../src/sim/public';

interface Row {
  owner: number;
  seed: number;
  land: number;
  cells: number;
}
/** A SimView with only what the model reads: the beachhead rows (by slot), the owner array and the tick. */
function fake(rows: Record<number, Row>, tick: number, owner: number[] = []): SimView {
  const o = new Uint16Array(64);
  const seed = new Int32Array(64);
  const land = new Uint32Array(64);
  let live = 0;
  for (const [k, r] of Object.entries(rows)) {
    o[+k] = r.owner;
    seed[+k] = r.seed;
    land[+k] = r.land;
    live++;
  }
  return {
    tick,
    owner,
    beachheads: { capacity: 64, liveCount: live, owner: o, seed, landTick: land, status: new Uint8Array(64), cellsOf: (i: number) => rows[i]?.cells ?? 0 },
  } as unknown as SimView;
}

const neutral = (): number[] => new Array<number>(100).fill(0);

describe('beachSecondsLeft', () => {
  it('counts the 45 seconds down, rounds up and never goes below 0', () => {
    expect(BEACHHEAD_REVERT_TICKS / TICK_HZ).toBe(45);
    expect(beachSecondsLeft(100, 100)).toBe(45);
    expect(beachSecondsLeft(100, 101)).toBe(45); // 449 ticks left: still 45 s on the display
    expect(beachSecondsLeft(100, 110)).toBe(44);
    expect(beachSecondsLeft(100, 100 + BEACHHEAD_REVERT_TICKS - 1)).toBe(1);
    expect(beachSecondsLeft(100, 100 + BEACHHEAD_REVERT_TICKS)).toBe(0);
    expect(beachSecondsLeft(100, 100 + BEACHHEAD_REVERT_TICKS + 30)).toBe(0);
  });
});

describe('ownBeachChip / ownBeachSeeds', () => {
  const scratch = (): BeachChip => ({ slot: 99, cells: 99, need: 0, seconds: 99 });
  it('picks the own row that goes back first and ignores the other seats', () => {
    // seat 0 = ownerId 1; slot 0 is somebody else's and older, slots 3 and 5 are ours
    const v = fake({ 0: { owner: 2, seed: 7, land: 10, cells: 4 }, 3: { owner: 1, seed: 30, land: 200, cells: 6 }, 5: { owner: 1, seed: 50, land: 150, cells: 3 } }, 300);
    const chip = ownBeachChip(v, 0, scratch());
    expect(chip.slot).toBe(5);
    expect(chip.cells).toBe(3);
    expect(chip.need).toBe(BEACHHEAD_ESTABLISH_CELLS);
    expect(chip.seconds).toBe(beachSecondsLeft(150, 300));
    const seeds = new Int32Array(4);
    expect(ownBeachSeeds(v, 0, seeds)).toBe(2);
    expect(Array.from(seeds.subarray(0, 2))).toEqual([30, 50]);
    expect(ownBeachSeeds(v, 1, seeds)).toBe(1); // seat 1 sees only its own
    expect(seeds[0]).toBe(7);
  });
  it('says "none" (slot -1) without a row of the seat, and stops at the length of the output', () => {
    const v = fake({ 0: { owner: 2, seed: 7, land: 10, cells: 4 } }, 300);
    expect(ownBeachChip(v, 0, scratch()).slot).toBe(-1);
    expect(ownBeachChip(fake({}, 5), 0, scratch()).slot).toBe(-1);
    expect(ownBeachSeeds(v, 0, new Int32Array(2))).toBe(0);
    const many = fake({ 0: { owner: 1, seed: 1, land: 1, cells: 1 }, 1: { owner: 1, seed: 2, land: 2, cells: 1 }, 2: { owner: 1, seed: 3, land: 3, cells: 1 } }, 9);
    expect(ownBeachSeeds(many, 0, new Int32Array(2))).toBe(2);
  });
});

describe('BeachheadWatcher', () => {
  const SEED = 40;
  const own = (): number[] => {
    const o = neutral();
    o[SEED] = 1;
    return o;
  };
  const row = (land = 100): Record<number, Row> => ({ 2: { owner: 1, seed: SEED, land, cells: 5 } });

  it('says nothing on the first look, nor while the row stays', () => {
    const w = new BeachheadWatcher();
    expect(w.update(fake(row(), 100, own()), 1, 0)).toBe(0);
    expect(w.update(fake(row(), 110, own()), 2, 0)).toBe(0);
    expect(w.update(fake({}, 110, own()), 2, 0)).toBe(0); // the same version: no work
  });
  it('a row that is gone with a neutral seed REVERTED', () => {
    const w = new BeachheadWatcher();
    w.update(fake(row(), 100, own()), 1, 0);
    expect(w.update(fake({}, 550, neutral()), 2, 0)).toBe(BEACH_REVERTED);
  });
  it('a row that is gone while the seed is still ours is ESTABLISHED, unless another row of ours remains (a merge); a seed taken by somebody else says nothing', () => {
    const a = new BeachheadWatcher();
    a.update(fake(row(), 100, own()), 1, 0);
    expect(a.update(fake({}, 200, own()), 2, 0)).toBe(BEACH_ESTABLISHED);
    const merge = new BeachheadWatcher();
    merge.update(fake({ ...row(), 4: { owner: 1, seed: 60, land: 90, cells: 5 } }, 100, own()), 1, 0);
    expect(merge.update(fake({ 4: { owner: 1, seed: 60, land: 90, cells: 5 } }, 200, own()), 2, 0)).toBe(0);
    const taken = new BeachheadWatcher();
    taken.update(fake(row(), 100, own()), 1, 0);
    const enemy = neutral();
    enemy[SEED] = 2;
    expect(taken.update(fake({}, 200, enemy), 2, 0)).toBe(0);
  });
  it("a new landing in the slot of one that vanished in the same version still counts the old one, and other seats' rows never make news", () => {
    const w = new BeachheadWatcher();
    w.update(fake(row(100), 100, own()), 1, 0);
    expect(w.update(fake(row(560), 560, neutral()), 2, 0)).toBe(BEACH_REVERTED);
    const other = new BeachheadWatcher();
    other.update(fake({ 2: { owner: 2, seed: SEED, land: 100, cells: 5 } }, 100, own()), 1, 0);
    expect(other.update(fake({}, 560, neutral()), 2, 0)).toBe(0);
  });
  it('reset forgets the table (a new match starts with a first look)', () => {
    const w = new BeachheadWatcher();
    w.update(fake(row(), 100, own()), 1, 0);
    w.reset();
    expect(w.update(fake({}, 101, neutral()), 1, 0)).toBe(0);
  });
});

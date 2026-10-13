// Rules that only the pinned hashes used to guard: the order in which attacks run, the order of the phases of a tick, and the
// inputs of the tie-break hashes (D82, D85, D86). Each test states the rule in behaviour, so that a regression is named here
// and not found by a hash comparison two milestones later.
import { describe, expect, it } from 'vitest';
import { Attack, pickIndex } from '../../src/sim/attacks';
import { goldMilliPerTick, ownedStdAreaQ15 } from '../../src/sim/economy';
import { enclaveBucket } from '../../src/sim/enclaveQueue';
import { hash2 } from '../../src/sim/fixture';
import { ENCLAVE_FLIP_TICKS, MICRO_CELLS_PER_CELL, WEIGHT_ONE } from '../../src/sim/rules';
import { OUTBOX_PAINT } from '../../src/sim/outbox';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { setOwner } from '../../src/sim/territory';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';
import { applyAttack } from '../../src/sim/conquest';

/** A w x h plain with every row at full weight (each cell adds 1.25 milli-gold per tick: any change of area changes the income). */
function flatState(w: number, h: number, seed: number, seats: number, classAt: (x: number, y: number) => number = () => CLASS_PLAINS): GameState {
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) terrain[y * w + x] = classAt(x, y);
  return createState({ width: w, height: h, seed, seats, terrain, elevation: new Uint16Array(w * h), rowCos: new Uint16Array(h).fill(WEIGHT_ONE) });
}

describe('attacks run in an order that is a hash of (seed, tick, attack id): no attack is systematically first (D82)', () => {
  /**
   * Two seats hold the two ends of a band of free land 40 rows high and attack it with 100 %. Returns, over `seeds` seeds and
   * `ticks` ticks, in how many ticks both of them took cells and in how many of those the first cell went to the lower attack id.
   */
  function firstMovers(seeds: number[], ticks: number): { both: number; lowFirst: number } {
    let both = 0;
    let lowFirst = 0;
    for (const seed of seeds) {
      const w = 90;
      const h = 200;
      const s = flatState(w, h, seed, 2, (x) => (x < w - 1 ? CLASS_PLAINS : CLASS_DEEP_SEA));
      for (let y = 0; y < h; y++) {
        setOwner(s, y * w, 1, 0);
        setOwner(s, y * w + w - 2, 2, 0);
      }
      s.troops[1] = 4000000000;
      s.troops[2] = 4000000000;
      expect(applyAttack(s, 0, 0, 100)).toBe(0);
      expect(applyAttack(s, 1, 0, 100)).toBe(0);
      s.outbox.clear();
      for (let t = 0; t < ticks; t++) {
        step(s, { turn: s.tick, intents: [] });
        const paints = s.outbox.drain().filter((e) => e.kind === OUTBOX_PAINT);
        const first = new Map<number, number>();
        for (const e of paints) if (!first.has(e.b)) first.set(e.b, first.size);
        if (first.has(1) && first.has(2)) {
          both++;
          if ((first.get(1) as number) < (first.get(2) as number)) lowFirst++;
        }
      }
    }
    return { both, lowFirst };
  }

  it('two attacks that both take cells in a tick: over 8 seeds and 150 ticks the first mover is each of them in 30 to 70 % of the ticks, for every seed set', () => {
    const r = firstMovers([1, 2, 3, 4, 5, 6, 7, 8], 150);
    console.log(`[phases] both attacks took cells in ${r.both} ticks; the lower id went first in ${r.lowFirst} (${((100 * r.lowFirst) / r.both).toFixed(1)} %)`);
    expect(r.both).toBeGreaterThan(200);
    expect(r.lowFirst / r.both).toBeGreaterThan(0.3);
    expect(r.lowFirst / r.both).toBeLessThan(0.7);
    // and a different set of seeds gives a different split of the same kind (the order is not a fixed pattern of the ticks)
    const other = firstMovers([21, 22, 23, 24, 25, 26, 27, 28], 150);
    expect(other.lowFirst / other.both).toBeGreaterThan(0.3);
    expect(other.lowFirst / other.both).toBeLessThan(0.7);
    expect(other.lowFirst).not.toBe(r.lowFirst);
  });
});

describe('the phases of a tick run in the order intents, conquest, enclaves, economy (D85)', () => {
  it('the gold of a tick is earned on the land the seat holds AFTER the conquest of that tick', () => {
    const s = flatState(40, 8, 1, 2);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 2; x++) setOwner(s, y * 40 + x, 1, 0);
    s.troops[1] = 4000000;
    expect(applyAttack(s, 0, 0, 100)).toBe(0);
    const a = s.attacks.list[0];
    if (a === undefined) throw new Error('no attack');
    a.progress = MICRO_CELLS_PER_CELL - 1; // the next tick takes at least one cell
    const goldBefore = s.gold[1] as number;
    const areaBefore = s.agg.area[1] as number;
    step(s, { turn: s.tick, intents: [] });
    const after = s.agg.area[1] as number;
    expect(after).toBeGreaterThan(areaBefore);
    const earned = (s.gold[1] as number) - goldBefore;
    expect(earned).toBe(goldMilliPerTick(ownedStdAreaQ15(s, 1)));
    // the income of the land held before the tick is a different number, so this test can tell the two orders apart
    expect(goldMilliPerTick(Math.floor((WEIGHT_ONE * areaBefore) / 4))).not.toBe(earned);
  });

  it('a capture that closes a pocket flips the pocket in the SAME tick when that tick is the pocket\'s bucket, and the income of that tick counts the flipped cell', () => {
    // owner 1 holds everything but a free cell F; owner 2 holds a pocket cell P that touches F. Owner 1 takes F: P is enclosed.
    const w = 12;
    const h = 8;
    const P = 4 * w + 6;
    const F = 4 * w + 7;
    let tested = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = flatState(w, h, seed, 2);
      for (let c = 0; c < w * h; c++) setOwner(s, c, c === P ? 2 : c === F ? 0 : 1, 0);
      s.troops[1] = 4000000;
      for (let t = 0; t < 2 * ENCLAVE_FLIP_TICKS; t++) step(s, { turn: s.tick, intents: [] }); // the setup's own candidates run, nothing flips (P and F touch each other)
      expect(s.owner[P]).toBe(2);
      expect(s.owner[F]).toBe(0);
      expect(applyAttack(s, 0, 0, 100)).toBe(0);
      const a = s.attacks.list[0];
      if (a === undefined) throw new Error('no attack');
      // wait for the tick whose bucket is the pocket's: the pass of that very tick must already see the closed ring
      const bucket = enclaveBucket(seed, P);
      while (s.tick % ENCLAVE_FLIP_TICKS !== bucket) {
        a.progress = 0;
        step(s, { turn: s.tick, intents: [] });
        expect(s.owner[F], 'F is not taken before the tick we choose').toBe(0);
      }
      a.progress = MICRO_CELLS_PER_CELL - 1;
      const goldBefore = s.gold[1] as number;
      step(s, { turn: s.tick, intents: [] });
      expect(s.owner[F], `seed ${seed}`).toBe(1);
      expect(s.owner[P], `seed ${seed}: the pocket flips in the pass of the tick that closed it`).toBe(1);
      expect((s.gold[1] as number) - goldBefore, `seed ${seed}`).toBe(goldMilliPerTick(ownedStdAreaQ15(s, 1))); // area after conquest AND enclaves
      expect(s.agg.area[1]).toBe(w * h);
      tested++;
    }
    expect(tested).toBe(12);
  });
});

describe('the tie-break hashes take all their inputs', () => {
  const cells = Array.from({ length: 100 }, (_, i) => 5 + 3 * i);

  function picks(seed: number, id: number): number[] {
    const a = new Attack(id, 1, 0, 1000);
    for (const c of cells) a.push(c, 0);
    return cells.map(() => a.pick(seed));
  }

  /** The documented rule: the pick is the entry that hash2(seed, attack id, number of picks so far) points at; the last entry takes its place. */
  function expectedPicks(seed: number, id: number): number[] {
    const bag = [...cells];
    const out: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      const n = bag.length;
      const at = n === 1 ? 0 : pickIndex(hash2(seed, id, i), n);
      out.push(bag[at] as number);
      bag[at] = bag[n - 1] as number;
      bag.pop();
    }
    return out;
  }

  it('a pick is the entry that a hash of (seed, attack id, picks so far) points at: the sequence equals the rule written out in the test', () => {
    for (const [seed, id] of [[1, 1], [1, 2], [7, 1], [123456, 40]] as const) expect(picks(seed, id), `seed ${seed} id ${id}`).toEqual(expectedPicks(seed, id));
  });

  it('the seed, the attack id and the number of picks each change the choice: other seeds and other ids give other sequences, and the second and third pick are not the first one\'s index again', () => {
    const base = picks(1, 1);
    expect(picks(2, 1)).not.toEqual(base);
    expect(picks(1, 2)).not.toEqual(base);
    expect(picks(1, 1)).toEqual(base); // and the same inputs, the same sequence
    // the index chosen with the same bag size would repeat if the pick counter were not an input
    const a = new Attack(3, 1, 0, 1000);
    for (const c of cells) a.push(c, 0);
    const at: number[] = [];
    for (let i = 0; i < 3; i++) at.push(pickIndex(hash2(9, 3, i), cells.length - i));
    expect(new Set(at).size).toBeGreaterThan(1);
    const seq = [a.pick(9), a.pick(9), a.pick(9)];
    expect(new Set(seq).size).toBe(3);
  });

  it('the enclave bucket of a cell depends on the seed and is not the cell number modulo 20; the buckets are about equally full', () => {
    const counts = new Array<number>(ENCLAVE_FLIP_TICKS).fill(0);
    let sameAsModulo = 0;
    let sameAcrossSeeds = 0;
    for (let c = 0; c < 4000; c++) {
      const b = enclaveBucket(1, c);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(ENCLAVE_FLIP_TICKS);
      counts[b] = (counts[b] as number) + 1;
      if (b === c % ENCLAVE_FLIP_TICKS) sameAsModulo++;
      if (b === enclaveBucket(2, c)) sameAcrossSeeds++;
    }
    expect(sameAsModulo).toBeLessThan(4000 * 0.15); // 1 in 20 by chance
    expect(sameAcrossSeeds).toBeLessThan(4000 * 0.15);
    for (const n of counts) {
      expect(n).toBeGreaterThan(4000 / ENCLAVE_FLIP_TICKS / 1.5);
      expect(n).toBeLessThan((4000 / ENCLAVE_FLIP_TICKS) * 1.5);
    }
  });
});

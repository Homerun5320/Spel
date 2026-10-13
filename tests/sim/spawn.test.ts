import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ownerCapQt } from '../../src/sim/economy';
import { REJECT_OWNED, REJECT_SPAWNED, REJECT_TERRAIN, withId, type Intent } from '../../src/sim/intents';
import { OUTBOX_PAINT, OUTBOX_REJECT } from '../../src/sim/outbox';
import { START_DISC_CELLS, START_DISC_RADIUS_CELLS, START_GOLD_MILLI, START_TROOPS_QT } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { claimDisc } from '../../src/sim/spawn';
import { rebuildAggregates } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { CLASS_DEEP_SEA, CLASS_FOREST, CLASS_HILLS, CLASS_ICE, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS, CLASS_SHALLOWS } from '../../src/sim/terrain';
import { islandState, landState } from './helpers/worlds';

const spawn = (seat: number, cell: number, id = 0): Intent => withId({ kind: 'Spawn', seat, cell }, id);
const R = START_DISC_RADIUS_CELLS;

/** Runs one step with the given intents at the state's tick and returns the outbox reject reasons of that step. */
function run(s: ReturnType<typeof landState>, intents: Intent[]): number[] {
  const r = step(s, { turn: s.tick, intents });
  expect(r.ok).toBe(true);
  return s.outbox.drain().filter((e) => e.kind === OUTBOX_REJECT).map((e) => e.a);
}

describe('Spawn: the capital disc on open land', () => {
  it('claims exactly the 197 cells of the radius-8 disc, nearest first, all connected', () => {
    const s = landState(41, 41);
    const center = s.grid.cellAt(20, 20);
    const claimed: number[] = [];
    expect(claimDisc(s, center, 1, 7, claimed)).toBe(START_DISC_CELLS);
    const want = new Set<number>();
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) want.add(s.grid.cellAt(20 + dx, 20 + dy));
    expect(new Set(claimed)).toEqual(want);
    expect(claimed[0]).toBe(center);
    // distance order on open land
    let last = 0;
    for (const c of claimed) {
      const d = s.grid.distance2(c, center);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    // contiguity: every cell after the first touches an earlier one
    const seen = new Set<number>([center]);
    const nb = new Int32Array(4);
    for (const c of claimed.slice(1)) {
      const n = s.grid.neighbours(c, nb);
      expect(Array.from(nb.subarray(0, n)).some((x) => seen.has(x))).toBe(true);
      seen.add(c);
    }
    // ownership, stamp, aggregates, scratch
    for (const c of claimed) {
      expect(s.owner[c]).toBe(1);
      expect(s.stamp[c]).toBe(7);
    }
    expect(s.agg.area[1]).toBe(START_DISC_CELLS);
    expect(Array.from(s.scratch.mark).every((m) => m === 0)).toBe(true);
  });

  it('the disc wraps around the east-west seam of the world', () => {
    const s = landState(41, 41);
    const claimed: number[] = [];
    claimDisc(s, s.grid.cellAt(0, 20), 1, 1, claimed);
    expect(claimed.length).toBe(START_DISC_CELLS);
    expect(claimed.some((c) => s.grid.cellX(c) === 40)).toBe(true); // reached x = -1
    expect(claimed.some((c) => s.grid.cellX(c) === 8)).toBe(true);
  });

  it('through step: start troops, gold, capital, one outbox paint per cell, no reject', () => {
    const s = landState(41, 41);
    const center = s.grid.cellAt(20, 20);
    const rejects = run(s, [spawn(0, center, 5)]);
    expect(rejects).toEqual([]);
    expect(s.capital[1]).toBe(center + 1);
    // the step already ran one economy tick after the start values
    expect(s.troops[1]).toBeGreaterThanOrEqual(START_TROOPS_QT);
    expect(s.troops[1]).toBeLessThan(START_TROOPS_QT + 12); // one economy tick of about 8 QT ran after the start values
    expect(s.gold[1]).toBeGreaterThanOrEqual(START_GOLD_MILLI);
    expect(s.gold[1]).toBeLessThan(START_GOLD_MILLI + 400); // one tick of income, about 0.2 gold
    expect(s.agg.area[1]).toBe(START_DISC_CELLS);
    expect(s.rejects).toBe(0);
    expect(s.stamp[center]).toBe(5);
  });

  it('emits one paint event per claimed cell', () => {
    const s = landState(41, 41);
    step(s, { turn: 0, intents: [spawn(0, s.grid.cellAt(20, 20))] });
    const events = s.outbox.drain();
    expect(events.filter((e) => e.kind === OUTBOX_PAINT).length).toBe(START_DISC_CELLS);
    expect(events.every((e) => e.kind !== OUTBOX_PAINT || e.b === 1)).toBe(true);
  });
});

describe('Spawn: landmasses', () => {
  it('a landmass smaller than the disc gives ALL of its cells (and nothing across the sea)', () => {
    const s = islandState(60, 40, 10, 10, 5, 5); // 25 cells
    const other = s.grid.cellAt(20, 12); // a second island 5 cells away would have been nearer than the far cells
    for (let y = 10; y < 15; y++) for (let x = 17; x < 22; x++) s.terrain[y * 60 + x] = CLASS_PLAINS; // not seen by the grid: built before
    const t = islandState(60, 40, 10, 10, 5, 5);
    expect(claimDisc(t, t.grid.cellAt(12, 12), 1, 1)).toBe(25);
    expect(t.agg.area[1]).toBe(25);
    void other;
  });

  it('does not jump to another landmass even when that is nearer than the far side of its own', () => {
    // island A: x 0..19 at y 10..11 (a thin strip, 40 cells); island B: a 10x10 block 2 cells east of A's right end
    const s = landState(80, 30, {
      classAt: (x, y) => ((x < 20 && y >= 10 && y < 12) || (x >= 22 && x < 32 && y >= 5 && y < 15) ? CLASS_PLAINS : CLASS_DEEP_SEA),
    });
    const n = claimDisc(s, s.grid.cellAt(0, 10), 1, 1);
    expect(n).toBe(40);
    for (let y = 5; y < 15; y++) for (let x = 22; x < 32; x++) expect(s.owner[y * 80 + x]).toBe(0);
  });

  it('only Plains, Forest, Hills and Mountain cells are claimed: Shallows, sea, Peak and Ice are skipped and block the way', () => {
    const cls = [CLASS_PLAINS, CLASS_FOREST, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_SHALLOWS, CLASS_DEEP_SEA, CLASS_PEAK, CLASS_ICE];
    // x 0..3 playable, x 4..7 the four unplayable classes, x 8..12 Plains BEHIND the wall, x 13 sea (so the seam does not connect)
    const s = landState(14, 3, { classAt: (x) => (x < 8 ? (cls[x] as number) : x < 13 ? CLASS_PLAINS : CLASS_DEEP_SEA) });
    const claimed: number[] = [];
    expect(claimDisc(s, s.grid.cellAt(1, 1), 1, 1, claimed)).toBe(4 * 3);
    for (const c of claimed) expect([0, 1, 2, 3]).toContain(s.grid.cellX(c));
  });

  it('a one-cell island gives exactly one cell', () => {
    const s = islandState(20, 20, 7, 7, 1, 1);
    expect(claimDisc(s, s.grid.cellAt(7, 7), 1, 1)).toBe(1);
  });
});

describe('Spawn: the hash tie-break', () => {
  // The playable land is the disc of d2 <= 65 around the centre minus six cells inside it: the 191 inner cells are taken
  // first, and the last 6 cells must come from the 16 cells at d2 = 65, all at the same distance. Which 6 is decided by
  // the hash of the cell (and the match seed), not by index order.
  const REMOVED = [[2, 0], [0, 2], [-2, 0], [0, -2], [3, 3], [-3, -3]];
  const world = (seed: number) =>
    landState(41, 41, {
      seed,
      classAt: (x, y) => {
        const dx = x - 20;
        const dy = y - 20;
        if (dx * dx + dy * dy > 65) return CLASS_DEEP_SEA;
        return REMOVED.some(([rx, ry]) => rx === dx && ry === dy) ? CLASS_DEEP_SEA : CLASS_PLAINS;
      },
    });
  const claim = (seed: number) => {
    const s = world(seed);
    const claimed: number[] = [];
    expect(claimDisc(s, s.grid.cellAt(20, 20), 1, 1, claimed)).toBe(START_DISC_CELLS);
    return { s, claimed };
  };

  it('takes every inner cell, then exactly 6 of the 16 cells of the last shell', () => {
    const { s, claimed } = claim(1);
    const center = s.grid.cellAt(20, 20);
    const inner = claimed.filter((c) => s.grid.distance2(c, center) <= 64);
    const shell = claimed.filter((c) => s.grid.distance2(c, center) === 65);
    expect(inner.length).toBe(191);
    expect(shell.length).toBe(6);
    expect(claimed.length).toBe(197);
  });

  it('is deterministic for a seed, and different seeds cut the shell differently', () => {
    expect(claim(1).claimed).toEqual(claim(1).claimed);
    const sets = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) sets.add(JSON.stringify(claim(seed).claimed.filter((c, _i, all) => c !== all[0]).sort((a, b) => a - b)));
    expect(sets.size).toBeGreaterThan(3);
  });

  it('the choice is not the first cells in index order', () => {
    const { s, claimed } = claim(1);
    const center = s.grid.cellAt(20, 20);
    const shellAll: number[] = [];
    for (let c = 0; c < 41 * 41; c++) if (s.grid.distance2(c, center) === 65) shellAll.push(c);
    const taken = claimed.filter((c) => s.grid.distance2(c, center) === 65).sort((a, b) => a - b);
    expect(shellAll.length).toBe(16);
    expect(taken).not.toEqual(shellAll.slice(0, 6));
    expect(taken).not.toEqual(shellAll.slice(-6));
  });
});

describe('Spawn: refusals (state untouched, one reject, reason in the outbox)', () => {
  it('on sea, Shallows, Peak and Ice', () => {
    const cls = [CLASS_DEEP_SEA, CLASS_SHALLOWS, CLASS_PEAK, CLASS_ICE];
    for (const c of cls) {
      const s = landState(30, 30, { classAt: (x) => (x < 5 ? c : CLASS_PLAINS) });
      const before = Array.from(s.owner);
      const reasons = run(s, [spawn(0, s.grid.cellAt(2, 2))]);
      expect(reasons, `class ${c}`).toEqual([REJECT_TERRAIN]);
      expect(Array.from(s.owner)).toEqual(before);
      expect(s.rejects).toBe(1);
      expect(s.capital[1]).toBe(0);
      expect(s.troops[1]).toBe(0);
    }
  });

  it('a second Spawn of the same seat, even far away, changes nothing', () => {
    const s = landState(60, 30);
    run(s, [spawn(0, s.grid.cellAt(10, 10))]);
    const owners = Array.from(s.owner);
    const hash = hashState(s);
    const reasons = run(s, [spawn(0, s.grid.cellAt(50, 20), 1)]);
    expect(reasons).toEqual([REJECT_SPAWNED]);
    expect(Array.from(s.owner)).toEqual(owners);
    expect(s.rejects).toBe(1);
    expect(hashState(s)).not.toBe(hash); // only tick, rejects, troops and gold moved
    expect(s.capital[1]).toBe(s.grid.cellAt(10, 10) + 1);
  });

  it('on a cell somebody owns (another seat, and the seat itself is refused as spawned first)', () => {
    const s = landState(60, 30);
    run(s, [spawn(0, s.grid.cellAt(10, 10))]);
    const reasons = run(s, [spawn(1, s.grid.cellAt(12, 10))]);
    expect(reasons).toEqual([REJECT_OWNED]);
    expect(s.capital[2]).toBe(0);
    expect(s.agg.area[2]).toBe(0);
  });

  it('a corrupt cell (out of range, fractional, negative) is a shape reject', () => {
    const s = landState(10, 10);
    const r = step(s, { turn: 0, intents: [spawn(0, 100), spawn(1, -1), { kind: 'Spawn', seat: 2, cell: 1.5, id: 0 } as Intent] });
    expect(r).toEqual({ ok: true, applied: 0, rejected: 3 });
    expect(s.agg.area.every((a) => a === 0)).toBe(true);
  });
});

describe('Spawn: conflicts inside one turn are settled by (seat, id)', () => {
  it('two seats on the same cell: the lower seat gets the capital, the other is refused as owned', () => {
    const s = landState(60, 30);
    const cell = s.grid.cellAt(30, 15);
    const reasons = run(s, [spawn(2, cell, 0), spawn(1, cell, 0)]);
    expect(reasons).toEqual([REJECT_OWNED]);
    expect(s.owner[cell]).toBe(2); // seat 1 = ownerId 2
    expect(s.capital[2]).toBe(cell + 1);
    expect(s.capital[3]).toBe(0);
  });

  it('two seats on neighbouring cells: no cell is owned twice, the second disc is cut by the first', () => {
    const s = landState(60, 30);
    const a = s.grid.cellAt(30, 15);
    const b = s.grid.cellAt(39, 15); // just outside the disc of a, whose own disc reaches back into it
    run(s, [spawn(1, b, 0), spawn(0, a, 0)]);
    expect(s.agg.area[1]).toBe(START_DISC_CELLS);
    expect(s.agg.area[2]).toBe(START_DISC_CELLS); // still a full disc's worth of cells ...
    let beyond = 0;
    for (let c = 0; c < s.owner.length; c++) if (s.owner[c] === 2 && s.grid.distance2(c, b) > R * R) beyond++;
    expect(beyond).toBeGreaterThan(0); // ... but taken further out, because the cells of seat 0 are in the way
    expect((s.agg.area[1] as number) + (s.agg.area[2] as number)).toBe(s.owner.reduce((n, o) => n + (o !== 0 ? 1 : 0), 0));
  });

  it('the order of the list does not matter', () => {
    const base = () => landState(60, 30);
    const list = (s: ReturnType<typeof landState>): Intent[] => [spawn(0, s.grid.cellAt(30, 15), 0), spawn(1, s.grid.cellAt(33, 15), 0), spawn(2, s.grid.cellAt(40, 20), 0)];
    const a = base();
    const b = base();
    step(a, { turn: 0, intents: list(a) });
    step(b, { turn: 0, intents: list(b).reverse() });
    expect(hashState(a)).toBe(hashState(b));
  });
});

describe('Spawn: tribes', () => {
  it('a seat after the players is a tribe: it spawns the same disc with a third of the cap', () => {
    const s = landState(41, 41, { seats: 3, players: 1 });
    run(s, [spawn(0, s.grid.cellAt(10, 10)), spawn(1, s.grid.cellAt(30, 30))]);
    expect(s.agg.area[1]).toBe(START_DISC_CELLS);
    expect(s.agg.area[2]).toBe(START_DISC_CELLS);
    expect(ownerCapQt(s, 2)).toBeLessThan(ownerCapQt(s, 1) / 2.5);
  });
});

describe('Spawn: properties', () => {
  it('on random worlds the disc is connected, playable, at most K cells, and equals the whole landmass when that is smaller', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffff }), fc.integer({ min: 20, max: 60 }), fc.integer({ min: 20, max: 40 }), fc.integer({ min: 1, max: 99 }), fc.nat(), (seed, w, h, landPct, pick) => {
        const s = landState(w, h, { seed, classAt: (x, y) => ((((x * 7919 + y * 104729 + seed) ^ (x * y)) >>> 0) % 100 < landPct ? CLASS_PLAINS + ((x + y) % 4) : CLASS_DEEP_SEA) });
        // pick a playable cell
        const playable: number[] = [];
        for (let c = 0; c < w * h; c++) if (s.grid.playable[c] === 1) playable.push(c);
        if (playable.length === 0) return;
        const center = playable[pick % playable.length] as number;
        // size of its landmass by flood fill
        const seen = new Uint8Array(w * h);
        const stack = [center];
        seen[center] = 1;
        let size = 0;
        const nb = new Int32Array(4);
        while (stack.length > 0) {
          const c = stack.pop() as number;
          size++;
          const n = s.grid.neighbours(c, nb);
          for (let i = 0; i < n; i++) {
            const x = nb[i] as number;
            if (seen[x] === 0 && s.grid.playable[x] === 1) {
              seen[x] = 1;
              stack.push(x);
            }
          }
        }
        const claimed: number[] = [];
        const n = claimDisc(s, center, 1, 1, claimed);
        expect(n).toBe(Math.min(START_DISC_CELLS, size));
        expect(new Set(claimed).size).toBe(n);
        for (const c of claimed) {
          expect(s.grid.playable[c]).toBe(1);
          expect(seen[c]).toBe(1); // same landmass
        }
        const have = new Set<number>([center]);
        for (const c of claimed.slice(1)) {
          const k = s.grid.neighbours(c, nb);
          expect(Array.from(nb.subarray(0, k)).some((x) => have.has(x))).toBe(true);
          have.add(c);
        }
        const copy = Array.from(s.agg.area);
        rebuildAggregates(s);
        expect(Array.from(s.agg.area)).toEqual(copy);
        expect(Array.from(s.scratch.mark).every((m) => m === 0)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});

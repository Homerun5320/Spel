// The frontier lists and the structures derived from the owner array, against brute force; enclaves.
import { describe, expect, it } from 'vitest';
import type { Attack } from '../../src/sim/attacks';
import { ENCLAVE_FLIP_TICKS, ENCLAVE_MAX_CELLS } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { rebuildAggregates, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { setOwner } from '../../src/sim/territory';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';
import { MatchDriver, RPLAYERS, RSEATS, RW, RH, randomMatchState } from './helpers/randomMatch';
import { landState } from './helpers/worlds';

const idx = (s: GameState, x: number, y: number): number => y * s.width + x;

/** The cells an attack could take right now, by looking at the whole map: target's, playable, next to a playable cell of the attacker. Ascending. */
export function bruteFrontier(s: GameState, a: Attack): number[] {
  const out: number[] = [];
  const nb = new Int32Array(4);
  for (let c = 0; c < s.grid.cells; c++) {
    if (s.owner[c] !== a.target || s.grid.playable[c] !== 1) continue;
    const n = s.grid.neighbours(c, nb);
    for (let k = 0; k < n; k++) {
      if (nb[k] !== c && s.owner[nb[k] as number] === a.attacker && s.grid.playable[nb[k] as number] === 1) {
        out.push(c);
        break;
      }
    }
  }
  return out;
}

/** The frontier entries that still qualify (unique, ascending): what the lazy bags have to offer. */
function liveHeap(s: GameState, a: Attack): number[] {
  const want = new Set(bruteFrontier(s, a));
  const seen = new Set<number>();
  for (const c of a.entries()) if (want.has(c)) seen.add(c);
  return [...seen].sort((x, y) => x - y);
}

/** Contact length by brute force: adjacencies between playable cells of two different owners, per unordered pair. */
function bruteEdges(s: GameState): Map<string, number> {
  const out = new Map<string, number>();
  const nb = new Int32Array(4);
  for (let c = 0; c < s.grid.cells; c++) {
    if (s.grid.playable[c] !== 1) continue;
    const n = s.grid.neighbours(c, nb);
    for (let k = 0; k < n; k++) {
      const m = nb[k] as number;
      if (m === c || s.grid.playable[m] !== 1 || m < c) continue;
      const a = s.owner[c] as number;
      const b = s.owner[m] as number;
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

function checkDerived(s: GameState, label: string): void {
  // 1. the incrementally kept aggregates and border index equal those of a state rebuilt from the owner array alone (a snapshot round trip)
  const r = deserialize(serialize(s));
  if (!r.ok) throw new Error(`${label}: snapshot failed: ${r.error}`);
  const t = r.state;
  expect(Array.from(s.agg.area), `${label}: area`).toEqual(Array.from(t.agg.area));
  expect(Array.from(s.agg.warea), `${label}: warea`).toEqual(Array.from(t.agg.warea));
  expect(Array.from(s.borders.edges), `${label}: edges`).toEqual(Array.from(t.borders.edges));
  expect(Array.from(s.borders.diff), `${label}: diff`).toEqual(Array.from(t.borders.diff));
  // the boundary lists hold every boundary cell of their owner (stale entries and repeats are allowed)
  for (let o = 1; o <= s.header.seats; o++) {
    const mine = Array.from(new Set(s.borders.validCells(o, s.owner))).sort((x, y) => x - y);
    const rebuilt = Array.from(new Set(t.borders.validCells(o, t.owner))).sort((x, y) => x - y);
    expect(mine, `${label}: boundary of ${o}`).toEqual(rebuilt);
  }
  for (let c = 0; c < s.grid.cells; c++) {
    if (s.grid.playable[c] === 1 && (s.owner[c] as number) !== 0 && (s.borders.diff[c] as number) > 0) expect(s.borders.listed[c], `${label}: cell ${c} is a boundary cell of ${s.owner[c]} but not listed`).toBe(s.owner[c]);
  }
  // the lists do not grow without bound: at most the purge size (stale entries are dropped when a list reaches it)
  for (let o = 1; o <= s.header.seats; o++) expect(s.borders.counts[o] as number, `${label}: list of ${o}`).toBeLessThanOrEqual(Math.max(s.borders.purgeAt[o] as number, 4 * (t.borders.counts[o] as number) + 8));
  // 2. contact lengths equal the brute-force edge count
  const brute = bruteEdges(s);
  for (let a = 0; a <= s.header.seats; a++) {
    for (let b = a + 1; b <= s.header.seats; b++) expect(s.borders.contact(a, b), `${label}: contact ${a}-${b}`).toBe(brute.get(`${a},${b}`) ?? 0);
  }
  // 3. the attack table's lookup and the enclave queue's membership bits
  for (let i = 0; i < s.attacks.list.length; i++) {
    const a = s.attacks.list[i] as Attack;
    expect(s.attacks.indexOf(a.attacker, a.target)).toBe(i);
    expect(a.entries().length, `${label}: size of attack ${a.id}`).toBe(a.size);
    for (let d = 0; d < a.low; d++) expect(a.counts[d], `${label}: bags below low are empty`).toBe(0);
    expect(a.troops).toBeLessThan(2 ** 31);
  }
  let queued = 0;
  for (let b = 0; b < ENCLAVE_FLIP_TICKS; b++) {
    for (let i = 0; i < (s.enclaves.counts[b] as number); i++) {
      expect(s.enclaves.queued[(s.enclaves.buckets[b] as Int32Array)[i] as number]).toBe(1);
      queued++;
    }
  }
  expect(s.enclaves.queued.reduce((n, v) => n + v, 0), `${label}: queued bits`).toBe(queued);
  expect(s.scratch.mark.every((m) => m === 0)).toBe(true);
}

describe('frontier lists and derived structures after 1000 random steps', () => {
  for (const seed of [3, 11, 29]) {
    it(`seed ${seed}: the frontier equals the brute-force recomputation at every 25th step, and the derived structures equal a rebuild`, () => {
      const s = randomMatchState(seed);
      const d = new MatchDriver(s, seed);
      let attacksSeen = 0;
      let captures = 0;
      let flips = 0;
      for (let t = 0; t < 1000; t++) {
        d.tick();
        captures += s.work.captured;
        flips += s.work.enclaveFlipped;
        attacksSeen += s.attacks.list.length;
        if (t % 25 === 24 || t < 40) {
          for (const a of s.attacks.list) {
            const brute = bruteFrontier(s, a);
            const live = liveHeap(s, a);
            expect(live, `seed ${seed} tick ${t} attack ${a.id} (${a.attacker}->${a.target}): the bags miss frontier cells`).toEqual(brute);
          }
        }
        if (t % 100 === 99) checkDerived(s, `seed ${seed} tick ${t}`);
      }
      checkDerived(s, `seed ${seed} end`);
      // the run is not trivial: attacks existed, cells changed hands, enclaves flipped
      expect(attacksSeen).toBeGreaterThan(200);
      expect(captures).toBeGreaterThan(100);
      console.log(`[frontier] seed ${seed}: ${captures} captures, ${flips} enclave cells, ${attacksSeen} attack-ticks`);
    });
  }

  it('a snapshot in the middle of such a match (attacks, frontiers and the enclave queue inside) resumes into the straight run', () => {
    const seed = 5;
    const a = randomMatchState(seed);
    const da = new MatchDriver(a, seed);
    const b = randomMatchState(seed);
    const db = new MatchDriver(b, seed);
    for (let t = 0; t < 400; t++) {
      da.tick();
      db.tick();
    }
    expect(a.attacks.list.length).toBeGreaterThan(0);
    const r = deserialize(serialize(b));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(b));
    const dc = new MatchDriver(r.state, seed);
    dc.next.set(db.next);
    for (let t = 400; t < 800; t++) {
      da.tick();
      dc.tick();
      if (t % 50 === 0) expect(hashState(r.state), `tick ${t}`).toBe(hashState(a));
    }
    expect(hashState(r.state)).toBe(hashState(a));
  });
});

describe('enclaves flip to the player that closes them in, within ENCLAVE_FLIP_TICKS ticks', () => {
  /** An open plain with owner 1 holding everything except a pocket; the pocket holds `inside` (an ownerId). */
  function pocketWorld(inside: number, size = 2, extra: (s: GameState) => void = () => undefined): GameState {
    const s = landState(14, 10, { seats: 4 });
    for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) setOwner(s, idx(s, x, y), 1, 0);
    extra(s);
    for (let y = 4; y < 4 + size; y++) for (let x = 5; x < 5 + size; x++) setOwner(s, idx(s, x, y), inside, 0);
    return s;
  }
  const idle = (s: GameState, ticks: number): void => {
    for (let i = 0; i < ticks; i++) step(s, { turn: s.tick, intents: [] });
  };

  it('a pocket of another player surrounded by one player flips within 20 ticks (and not before it was queued)', () => {
    const s = pocketWorld(2, 2);
    expect(s.owner[idx(s, 5, 4)]).toBe(2);
    idle(s, ENCLAVE_FLIP_TICKS);
    for (let y = 4; y < 6; y++) for (let x = 5; x < 7; x++) expect(s.owner[idx(s, x, y)], `${x},${y}`).toBe(1);
    expect(s.agg.area[2]).toBe(0);
    expect(s.agg.area[1]).toBe(140);
  });

  it('a pocket of unowned land flips too, and a one-cell hole', () => {
    const a = pocketWorld(0, 3);
    idle(a, ENCLAVE_FLIP_TICKS);
    expect(a.agg.area[1]).toBe(140);
    const b = pocketWorld(0, 1);
    idle(b, ENCLAVE_FLIP_TICKS);
    expect(b.agg.area[1]).toBe(140);
  });

  it('it happens in the tick of the cell hash bucket: after exactly the cells of that bucket, never later than the 20th tick', () => {
    const s = pocketWorld(2, 1);
    let flippedAt = -1;
    for (let t = 0; t < ENCLAVE_FLIP_TICKS && flippedAt < 0; t++) {
      step(s, { turn: s.tick, intents: [] });
      if (s.owner[idx(s, 5, 4)] === 1) flippedAt = t;
    }
    expect(flippedAt).toBeGreaterThanOrEqual(0);
    expect(flippedAt).toBeLessThan(ENCLAVE_FLIP_TICKS);
  });

  it('an enclave that is open stays: it touches the sea, a third owner, an unplayable cell, or is larger than ENCLAVE_MAX_CELLS', () => {
    // sea next to the pocket
    const sea = pocketWorld(2, 2, (s) => {
      const c = idx(s, 7, 4);
      s.terrain[c] = CLASS_DEEP_SEA;
      s.grid.playable[c] = 0;
    });
    // note: the sea cell above is owned by 1 in the painting loop; free it
    idle(sea, 3 * ENCLAVE_FLIP_TICKS);
    expect(sea.owner[idx(sea, 5, 4)]).toBe(2);
    // a third owner touches the pocket
    const third = pocketWorld(2, 2, (s) => setOwner(s, idx(s, 7, 4), 3, 0));
    idle(third, 3 * ENCLAVE_FLIP_TICKS);
    expect(third.owner[idx(third, 5, 4)]).toBe(2);
    expect(third.owner[idx(third, 7, 4)]).toBe(3);
    // too big: a pocket of ENCLAVE_MAX_CELLS + 1 cells
    const side = Math.ceil(Math.sqrt(ENCLAVE_MAX_CELLS + 1)) + 1;
    const big = landState(side + 8, side + 8, { seats: 3 });
    for (let c = 0; c < big.grid.cells; c++) setOwner(big, c, 1, 0);
    let n = 0;
    for (let y = 3; y < 3 + side && n < ENCLAVE_MAX_CELLS + 1; y++) for (let x = 3; x < 3 + side && n < ENCLAVE_MAX_CELLS + 1; x++, n++) setOwner(big, idx(big, x, y), 2, 0);
    idle(big, 3 * ENCLAVE_FLIP_TICKS);
    expect(big.agg.area[2]).toBe(ENCLAVE_MAX_CELLS + 1);
    // ... and one cell fewer is small enough
    const fits = landState(side + 8, side + 8, { seats: 3 });
    for (let c = 0; c < fits.grid.cells; c++) setOwner(fits, c, 1, 0);
    n = 0;
    for (let y = 3; y < 3 + side && n < ENCLAVE_MAX_CELLS; y++) for (let x = 3; x < 3 + side && n < ENCLAVE_MAX_CELLS; x++, n++) setOwner(fits, idx(fits, x, y), 2, 0);
    idle(fits, ENCLAVE_FLIP_TICKS);
    expect(fits.agg.area[2]).toBe(0);
  });

  it('an enclave closed by a CONQUEST flips: the attack takes the last cell of the ring and the pocket follows', () => {
    // owner 1 holds a horseshoe around a pocket of unowned land; owner 1 attacks the unowned land, which closes the ring
    const s = landState(16, 9, { seats: 3 });
    for (let x = 4; x <= 8; x++) for (const y of [2, 3, 4]) setOwner(s, idx(s, x, y), 1, 0);
    for (const [x, y] of [[6, 3], [6, 4]] as const) setOwner(s, idx(s, x, y), 0, 0); // the notch (opens to the south)
    s.troops[1] = 400000;
    step(s, { turn: 0, intents: [{ kind: 'Attack', seat: 0, target: 0, pct: 100, id: 0 }] });
    for (let i = 0; i < 4000; i++) step(s, { turn: s.tick, intents: [] });
    expect(s.attacks.list.length).toBe(0);
    // the whole world is owner 1's in the end (it is all connected land) and nothing is left unowned
    expect(s.agg.area[1]).toBe(16 * 9);
  });
});

describe('which changes queue an enclave check (each rule of the candidate rule, with the others unable to help)', () => {
  const idle = (s: GameState, ticks: number): void => {
    for (let i = 0; i < ticks; i++) step(s, { turn: s.tick, intents: [] });
  };
  /** 14 x 10 plain, all owner 1, then the given cells to the given owners; the queue is emptied by idling until every check has run. */
  function settled(cells: Array<[number, number, number]>): GameState {
    const s = landState(14, 10, { seats: 4 });
    for (let c = 0; c < s.grid.cells; c++) setOwner(s, c, 1, 0);
    for (const [x, y, o] of cells) setOwner(s, idx(s, x, y), o, 0);
    idle(s, 2 * ENCLAVE_FLIP_TICKS);
    expect(s.enclaves.length).toBe(0);
    return s;
  }

  it('LEAK: taking the one free cell that touched a pocket of another player closes it in; the pocket follows within 20 ticks', () => {
    const s = settled([[5, 4, 2], [5, 3, 0]]); // pocket cell (5,4) of owner 2, and a free cell (5,3) above it
    expect(s.owner[idx(s, 5, 4)]).toBe(2); // not enclosed yet: it touches free land
    setOwner(s, idx(s, 5, 3), 1, 0); // owner 1 takes the free cell
    idle(s, ENCLAVE_FLIP_TICKS);
    expect(s.owner[idx(s, 5, 4)]).toBe(1);
    expect(s.agg.area[2]).toBe(0);
  });

  it('SPLIT: taking a cell that cuts a region in two closes in the piece without a leak', () => {
    // a river of owner 2 down column 5 from the top edge cell (5,0), which touches a free cell (6,0); K is (5,3) and (5,4)
    const cells: Array<[number, number, number]> = [[6, 0, 0]];
    for (let y = 0; y <= 4; y++) cells.push([5, y, 2]);
    const s = settled(cells);
    expect(s.agg.area[2]).toBe(5);
    setOwner(s, idx(s, 5, 2), 1, 0); // cuts the river
    idle(s, ENCLAVE_FLIP_TICKS);
    expect([s.owner[idx(s, 5, 3)], s.owner[idx(s, 5, 4)]]).toEqual([1, 1]); // the lower piece is enclosed
    expect([s.owner[idx(s, 5, 0)], s.owner[idx(s, 5, 1)]]).toEqual([2, 2]); // the upper piece still touches free land
  });

  it('WALL LEAK: taking the cell that was the only thing touching the sea closes in the rest of its region', () => {
    // a region {(5,3), (5,4)} of owner 2 whose upper cell touches the sea at (5,2); owner 1 holds everything else
    const s = landState(14, 10, { seats: 4, classAt: (x, y) => (x === 5 && y === 2 ? CLASS_DEEP_SEA : CLASS_PLAINS) });
    for (let c = 0; c < s.grid.cells; c++) if (s.grid.playable[c] === 1) setOwner(s, c, 1, 0);
    setOwner(s, idx(s, 5, 3), 2, 0);
    setOwner(s, idx(s, 5, 4), 2, 0);
    idle(s, 2 * ENCLAVE_FLIP_TICKS);
    expect(s.agg.area[2]).toBe(2); // open: it touches the sea
    setOwner(s, idx(s, 5, 3), 1, 0);
    idle(s, ENCLAVE_FLIP_TICKS);
    expect(s.owner[idx(s, 5, 4)]).toBe(1);
  });

  it('THIRD-OWNER LEAK: a big region of a third owner touches the cell; taking the cell closes in the rest of its region', () => {
    // owner 3 holds rows 0 to 5 (84 cells: too big to be an enclave); owner 2 holds (5,6) and (5,7): (5,6) touches owner 3
    const s = landState(14, 12, { seats: 4 });
    for (let c = 0; c < s.grid.cells; c++) setOwner(s, c, c < 14 * 6 ? 3 : 1, 0);
    setOwner(s, idx(s, 5, 6), 2, 0);
    setOwner(s, idx(s, 5, 7), 2, 0);
    idle(s, 2 * ENCLAVE_FLIP_TICKS);
    expect(s.agg.area[2]).toBe(2);
    setOwner(s, idx(s, 5, 6), 1, 0);
    idle(s, ENCLAVE_FLIP_TICKS);
    expect(s.owner[idx(s, 5, 7)]).toBe(1);
  });

  it('A STRAIGHT BORDER queues nothing: taking a border cell between two stretches of the same region does not call for a check', () => {
    const s = settled([[7, 5, 0], [8, 5, 0], [9, 5, 0], [7, 6, 0], [8, 6, 0], [9, 6, 0], [10, 5, 3]]); // a free block that also touches owner 3: open, so it stays
    // owner 1 takes (8, 5) next to a free block: the free cells around it form ONE run, so no neighbour is queued; only the
    // cell itself is (three of its four neighbours are foreign: a tip)
    setOwner(s, idx(s, 8, 5), 1, 0);
    expect(s.enclaves.length).toBe(1);
    // and (7, 5) beside it: one foreign neighbour, three friends, one run: nothing new
    setOwner(s, idx(s, 7, 5), 1, 0);
    expect(s.enclaves.length).toBe(1);
  });

  it('A PENDING CANDIDATE that changes owner hands its job to its neighbours', () => {
    const s = landState(14, 10, { seats: 4 });
    for (let c = 0; c < s.grid.cells; c++) setOwner(s, c, 1, 0);
    const z = idx(s, 5, 3);
    const k = idx(s, 5, 4);
    setOwner(s, z, 2, 0);
    setOwner(s, k, 2, 0);
    // pretend that only z is waiting (as if the ring had been closed by a change next to z)
    s.enclaves.counts.fill(0);
    s.enclaves.queued.fill(0);
    s.enclaves.push(z, s.header.seed);
    setOwner(s, z, 1, 0); // owner 1 takes z before the check ran
    idle(s, ENCLAVE_FLIP_TICKS);
    expect(s.owner[k]).toBe(1);
  });
});

describe('after quiet ticks no small region is left enclosed by one player (the candidate rule loses nothing)', () => {
  /** Brute force: every connected region of one owner with at most ENCLAVE_MAX_CELLS cells whose outside is playable land of one other owner > 0. */
  function enclosedRegions(s: GameState): number[][] {
    const seen = new Uint8Array(s.grid.cells);
    const nb = new Int32Array(4);
    const found: number[][] = [];
    for (let start = 0; start < s.grid.cells; start++) {
      if (seen[start] || s.grid.playable[start] !== 1) continue;
      const x = s.owner[start] as number;
      const region = [start];
      seen[start] = 1;
      let surround = -1;
      let open = false;
      for (let h = 0; h < region.length; h++) {
        const c = region[h] as number;
        const n = s.grid.neighbours(c, nb);
        for (let k = 0; k < n; k++) {
          const m = nb[k] as number;
          if (m === c) continue;
          if (s.grid.playable[m] !== 1) open = true;
          else if (s.owner[m] === x) {
            if (!seen[m]) {
              seen[m] = 1;
              region.push(m);
            }
          } else if (surround === -1) surround = s.owner[m] as number;
          else if (surround !== s.owner[m]) open = true;
        }
      }
      if (!open && surround > 0 && region.length <= ENCLAVE_MAX_CELLS) found.push(region);
    }
    return found;
  }

  let flipped = 0;
  for (const seed of Array.from({ length: 40 }, (_, i) => i + 1)) {
    it(`seed ${seed}: random paints, spawns and attacks, then every attack cancelled and 15 enclave passes: nothing enclosed is left`, () => {
      const s = randomMatchState(seed);
      const d = new MatchDriver(s, seed);
      for (let t = 0; t < 600; t++) {
        d.tick();
        flipped += s.work.enclaveFlipped;
      }
      for (let seat = 0; seat < s.header.seats; seat++) for (let target = 0; target <= s.header.seats; target++) d.step(d.intents([{ kind: 'CancelAttack', seat, target }]));
      expect(s.attacks.list.length).toBe(0);
      for (let t = 0; t < 15 * ENCLAVE_FLIP_TICKS; t++) step(s, { turn: s.tick, intents: [] });
      expect(s.enclaves.length).toBe(0);
      expect(enclosedRegions(s).map((r) => r.length), `seed ${seed}`).toEqual([]);
      checkDerived(s, `seed ${seed} quiet`);
    });
  }

  it('it is not vacuous: the random matches do contain enclaves that flip, and the brute-force finder sees an enclosed region when one is built', () => {
    expect(flipped).toBeGreaterThan(10);
    const s = landState(10, 10, { seats: 3 });
    for (let c = 0; c < 100; c++) setOwner(s, c, 1, 0);
    setOwner(s, idx(s, 4, 4), 2, 0);
    expect(enclosedRegions(s)).toEqual([[idx(s, 4, 4)]]);
    expect(RSEATS).toBeGreaterThan(RPLAYERS);
    expect(RW * RH).toBe(1536);
  });
});

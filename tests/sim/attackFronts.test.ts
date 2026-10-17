// Fix-5A3 (audit 4, finding 2.7): fillAttackFronts as a pure function on hand-built owner grids: the four compass directions, the date-line wrap, the target and touched
// filters, the rounding of the direction, the nearest-to-mean cell across the date line, the row cap (the own attack is never lost) and the per-tick reader.
import { describe, expect, it } from 'vitest';
import { createState, type GameState } from '../../src/sim/state';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { ATTACK_VIEW_CAP, StateView, createAttackFrontData, fillAttackFronts } from '../../src/sim/view';

const A = 1;
const T = 2;
const X = 3;
const W = 10;
const H = 14;

interface Fake {
  state: GameState;
  owner: Uint16Array;
}
/** A state-shaped object with just what fillAttackFronts reads. `bag` lists the candidate front cells of each attack (depth 0). */
function fake(attacks: Array<{ id: number; attacker: number; target: number; bag: number[] }>): Fake {
  const owner = new Uint16Array(W * H);
  const list = attacks.map((a) => {
    const bag = Int32Array.from(a.bag);
    const counts = new Int32Array(4);
    counts[0] = bag.length;
    return { id: a.id, attacker: a.attacker, target: a.target, low: 0, counts, bags: [bag, null, null, null] };
  });
  const state = { width: W, height: H, owner, tick: 0, attacks: { list } } as unknown as GameState;
  return { state, owner };
}
const at = (x: number, y: number): number => y * W + x;

function run(f: Fake): ReturnType<typeof createAttackFrontData> {
  const out = createAttackFrontData();
  fillAttackFronts(f.state, out);
  return out;
}

/** One target cell at (x, y) with an attacker cell at the offset (ax, ay) (wrapped in x). */
function single(x: number, y: number, ax: number, ay: number): ReturnType<typeof createAttackFrontData> {
  const f = fake([{ id: 1, attacker: A, target: T, bag: [at(x, y)] }]);
  f.owner[at(x, y)] = T;
  f.owner[at((x + ax + W) % W, y + ay)] = A;
  return run(f);
}

describe('fillAttackFronts', () => {
  it('points from the attacker into the target in all four compass directions', () => {
    let o = single(5, 3, -1, 0); // attacker west: pushes east
    expect([o.count, o.dirX[0], o.dirY[0]]).toEqual([1, 100, 0]);
    o = single(5, 3, 1, 0); // attacker east: pushes west
    expect([o.dirX[0], o.dirY[0]]).toEqual([-100, 0]);
    o = single(5, 3, 0, -1); // attacker north: pushes south (dirY is south)
    expect([o.dirX[0], o.dirY[0]]).toEqual([0, 100]);
    o = single(5, 3, 0, 1); // attacker south: pushes north
    expect([o.dirX[0], o.dirY[0]]).toEqual([0, -100]);
    expect(o.cell[0]).toBe(at(5, 3));
  });

  it('wraps in x at the date line, both ways, and does not wrap in y', () => {
    let o = single(0, 3, -1, 0); // the attacker's cell is x = W - 1
    expect([o.count, o.dirX[0]]).toEqual([1, 100]);
    o = single(W - 1, 3, 1, 0); // the attacker's cell is x = 0
    expect([o.count, o.dirX[0]]).toEqual([1, -100]);
    // an attacker on the far row does not touch row 0 / row H - 1 from the other side of the map
    const f = fake([{ id: 1, attacker: A, target: T, bag: [at(4, 0)] }]);
    f.owner[at(4, 0)] = T;
    f.owner[at(4, H - 1)] = A;
    expect(run(f).count).toBe(0);
    const g = fake([{ id: 1, attacker: A, target: T, bag: [at(4, H - 1)] }]);
    g.owner[at(4, H - 1)] = T;
    g.owner[at(4, 0)] = A;
    expect(run(g).count).toBe(0);
  });

  it('rounds the direction to whole percent of the larger component', () => {
    // three targets with an attacker to their west (dx 3) and two with an attacker to their north (dy 2): 100 / 67
    const cells = [at(2, 3), at(2, 4), at(2, 5), at(6, 1), at(8, 1)];
    const f = fake([{ id: 1, attacker: A, target: T, bag: cells }]);
    for (const c of cells) f.owner[c] = T;
    for (const c of cells.slice(0, 3)) f.owner[c - 1] = A;
    for (const c of cells.slice(3)) f.owner[c - W] = A;
    let o = run(f);
    expect([o.dirX[0], o.dirY[0]]).toEqual([100, 67]); // 200 / 3 = 66.67 rounds up
    // one north attacker out of three west ones: 33.33 rounds down
    const g = fake([{ id: 1, attacker: A, target: T, bag: cells.slice(0, 4) }]);
    for (const c of cells.slice(0, 4)) g.owner[c] = T;
    for (const c of cells.slice(0, 3)) g.owner[c - 1] = A;
    g.owner[cells[3]! - W] = A;
    o = run(g);
    expect([o.dirX[0], o.dirY[0]]).toEqual([100, 33]);
  });

  it('skips cells of another owner, cells that no longer touch the attacker, and an attack with no usable cell', () => {
    const f = fake([
      { id: 1, attacker: A, target: T, bag: [at(1, 1), at(5, 3), at(8, 4)] },
      { id: 2, attacker: A, target: T, bag: [at(7, 1)] },
    ]);
    f.owner[at(1, 1)] = X; // a third party's cell next to the attacker: not the target's
    f.owner[at(0, 1)] = A;
    f.owner[at(5, 3)] = T; // the target's but no attacker around it
    f.owner[at(8, 4)] = T;
    f.owner[at(8, 3)] = A; // the only usable one: attacker to the north
    f.owner[at(7, 1)] = T; // attack 2: nothing touches
    const o = run(f);
    expect(o.count).toBe(1); // attack 2 is left out and row 0 is attack 1
    expect([o.id[0], o.attacker[0], o.target[0], o.cell[0], o.dirX[0], o.dirY[0]]).toEqual([1, A, T, at(8, 4), 0, 100]);
  });

  it('opposite pushes cancel to direction (0, 0) but the attack keeps its row', () => {
    const f = fake([{ id: 1, attacker: A, target: T, bag: [at(3, 3), at(6, 3)] }]);
    f.owner[at(3, 3)] = T;
    f.owner[at(2, 3)] = A;
    f.owner[at(6, 3)] = T;
    f.owner[at(7, 3)] = A;
    const o = run(f);
    expect([o.count, o.dirX[0], o.dirY[0]]).toEqual([1, 0, 0]);
  });

  it('picks the sampled cell nearest to the mean, the mean taken round the date line', () => {
    const cells = [at(9, 2), at(0, 2), at(1, 2)];
    const f = fake([{ id: 1, attacker: A, target: T, bag: cells }]);
    for (const c of cells) {
      f.owner[c] = T;
      f.owner[c + W] = A;
    }
    const o = run(f);
    expect(o.cell[0]).toBe(at(0, 2)); // mean x = 10 = 0; without the wrap the mean is 3.3 and x = 1 would win
    expect(o.dirY[0]).toBe(-100);
  });

  it('keeps the own attack among at most ATTACK_VIEW_CAP rows: 20 attacks, the own one the 19th, and 40 attacks fill exactly the cap', () => {
    const OWN = 7;
    const mk = (n: number, ownAt: number): Fake => {
      const attacks = [];
      for (let i = 0; i < n; i++) attacks.push({ id: i + 1, attacker: i === ownAt ? OWN : 20 + i, target: T, bag: [at(i % W, 1 + Math.floor(i / W) * 2)] });
      const f = fake(attacks);
      for (let i = 0; i < n; i++) {
        const c = at(i % W, 1 + Math.floor(i / W) * 2);
        f.owner[c] = T;
        f.owner[c - W] = attacks[i]!.attacker;
      }
      return f;
    };
    const o = run(mk(20, 18));
    expect(o.count).toBe(20);
    expect(o.attacker[18]).toBe(OWN);
    expect(ATTACK_VIEW_CAP).toBeGreaterThanOrEqual(32);
    const big = run(mk(40, 18));
    expect(big.count).toBe(ATTACK_VIEW_CAP);
    expect(big.attacker[18]).toBe(OWN);
  });
});

describe('SimView.fronts reader', () => {
  it('describes the attacks once per tick: unchanged within a tick, fresh after the tick moved', () => {
    const state = createState({ width: 40, height: 20, seed: 3, seats: 2, players: 2, config: { debugIntents: false, spawnPhase: false }, terrain: new Uint8Array(800).fill(CLASS_PLAINS), elevation: new Uint16Array(800) });
    const view = new StateView(state);
    expect(view.fronts.count).toBe(0);
    // an attack by hand: owners 1 and 2 side by side
    state.owner[5 * 40 + 10] = 2;
    state.owner[5 * 40 + 9] = 1;
    const bag = Int32Array.of(5 * 40 + 10);
    const counts = new Int32Array(4);
    counts[0] = 1;
    (state.attacks.list as unknown[]).push({ id: 9, attacker: 1, target: 2, low: 0, counts, bags: [bag, null, null, null] });
    (state as { tick: number }).tick = 1;
    expect(view.fronts.count).toBe(1);
    expect(view.fronts.dirX[0]).toBe(100);
    state.owner[5 * 40 + 10] = 0; // the front dies within the same tick: the reader still shows the tick's picture
    expect(view.fronts.count).toBe(1);
    (state as { tick: number }).tick = 2;
    expect(view.fronts.count).toBe(0);
  });
});

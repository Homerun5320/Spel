// Fix-5A3 (audit 4, finding 2.11): ownHeliRows rewrites EVERY field of a reused row (fuelPct and canRecall too, not only id / state / troops), honours `max`, clamps the fuel to 0..100
// and leaves out other seats' rows and rows under production.
import { describe, expect, it } from 'vitest';
import { HELI_BUILDING, HELI_CRUISE, HELI_FUEL_CELLS, HELI_HOVER, HELI_PAD, HELI_POS_ONE, type SimView } from '../../src/sim/public';
import { HeliTable } from '../../src/sim/heliTable';
import { ownHeliRows, type HeliRow } from '../../src/ui/heliInfo';

const FULL = HELI_FUEL_CELLS * HELI_POS_ONE;

function table(): HeliTable {
  const t = new HeliTable(4);
  const specs: Array<[number, number, number]> = [
    [1, HELI_PAD, 3],
    [1, HELI_HOVER, 3],
    [2, HELI_HOVER, 5],
    [1, HELI_HOVER, 3],
    [1, HELI_BUILDING, 3],
  ];
  specs.forEach(([owner, state, factory], i) => {
    const id = t.addBuilding(owner, factory, 10 + i, 100 + i);
    t.state[id] = state;
    t.load[id] = 10 * (i + 1);
    t.fuel[id] = FULL / 2;
    t.alt[id] = 500;
  });
  return t;
}
const viewOf = (t: HeliTable): SimView => ({ helis: t, tick: 1, seats: 3 }) as unknown as SimView;

describe('ownHeliRows', () => {
  it('rewrites fuelPct and canRecall of a reused row, not only its id, state and troops', () => {
    const t = table();
    const buf: HeliRow[] = [];
    ownHeliRows(viewOf(t), 0, buf);
    expect(buf.map((r) => [r.id, r.fuelPct, r.canRecall])).toEqual([
      [0, 50, false], // on the pad
      [1, 50, true], // hovering
      [3, 50, true],
    ]);
    const rows = buf.slice();
    t.fuel[0] = FULL / 4;
    t.fuel[1] = FULL;
    t.fuel[3] = 0;
    t.load[0] = 77;
    t.load[3] = 0;
    t.state[0] = HELI_CRUISE; // now flying: can be recalled
    t.state[1] = HELI_PAD; // landed: cannot
    ownHeliRows(viewOf(t), 0, buf);
    expect(buf.map((r, i) => r === rows[i])).toEqual([true, true, true]); // the same objects
    expect(buf.map((r) => [r.id, r.fuelPct, r.canRecall])).toEqual([
      [0, 25, true],
      [1, 100, false],
      [3, 0, true],
    ]);
    expect(buf.map((r) => r.troops)).toEqual([77, 20, 0]);
  });

  it('keeps to `max` rows, skips other seats and rows under production, and clamps the fuel percentage', () => {
    const t = table();
    t.fuel[1] = FULL * 3; // more than a full tank (cannot happen in the sim; the display clamps)
    const two = ownHeliRows(viewOf(t), 0, [], 2);
    expect(two.map((r) => r.id)).toEqual([0, 1]);
    expect(two[1]?.fuelPct).toBe(100);
    const all = ownHeliRows(viewOf(t), 0, []);
    expect(all.map((r) => r.id)).toEqual([0, 1, 3]); // not slot 2 (seat 1) and not slot 4 (under production)
    const buf: HeliRow[] = [];
    ownHeliRows(viewOf(t), 0, buf);
    expect(buf.length).toBe(3);
    ownHeliRows(viewOf(t), 0, buf, 1);
    expect(buf.length).toBe(1); // a shorter list shrinks the buffer
    expect(ownHeliRows(viewOf(t), 1, []).map((r) => r.id)).toEqual([2]);
  });
});

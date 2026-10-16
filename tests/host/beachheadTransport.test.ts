// Fix-4B: the beachhead table on its way to the page. The live rows (slot, owner, seed, landing tick, status) and the cells each cluster holds travel host -> snapshot -> mirror;
// the host resends the table only when something it carries changed (the cell count included, which is NOT a column of the sim's table); the mirror is indexed by slot.
import { describe, expect, it } from 'vitest';
import { beachheadSignature, snapshotBeachheads } from '../../src/host/beachheadSnapshot';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { MirrorBeachheads } from '../../src/host/beachheadMirror';
import { ViewMirror } from '../../src/host/viewMirror';
import { BEACH_CUT_OFF } from '../../src/sim/heliTable';
import { BEACHHEAD_REVERT_TICKS } from '../../src/sim/rules';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';

const W = 64;
const H = 32;
const at = (x: number, y: number): number => y * W + x;

/** Seat 0 (owner 1) holds a 5-cell strip at x 10..14 and a lone cell at x 40; everything else is neutral. */
function world(): GameState {
  const s = createState({ width: W, height: H, seed: 3, seats: 2, config: { debugIntents: true }, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H).fill(5), maxElev: new Int16Array(W * H).fill(5) });
  for (let x = 10; x <= 14; x++) s.owner[at(x, 5)] = 1;
  s.owner[at(40, 20)] = 1;
  s.owner[at(30, 5)] = 2;
  rebuildAggregates(s);
  return s;
}

describe('the beachhead snapshot', () => {
  it('copies every live row in slot order with the cells of its cluster, and the live view reports the same', () => {
    const s = world();
    s.beachheads.add(1, at(12, 5), 100, BEACH_CUT_OFF);
    s.beachheads.add(2, at(30, 5), 120, BEACH_CUT_OFF);
    s.beachheads.add(1, at(40, 20), 130, BEACH_CUT_OFF);
    s.beachheads.remove(1);
    const snap = snapshotBeachheads(s);
    expect(snap.count).toBe(2);
    expect(Array.from(snap.slot)).toEqual([0, 2]);
    expect(Array.from(snap.owner)).toEqual([1, 1]);
    expect(Array.from(snap.seed)).toEqual([at(12, 5), at(40, 20)]);
    expect(Array.from(snap.landTick)).toEqual([100, 130]);
    expect(Array.from(snap.status)).toEqual([BEACH_CUT_OFF, BEACH_CUT_OFF]);
    expect(Array.from(snap.cells)).toEqual([5, 1]);
    const live = new StateView(s).beachheads;
    expect([live.cellsOf(0), live.cellsOf(1), live.cellsOf(2)]).toEqual([5, 0, 1]);
    // the search leaves no mark behind
    expect(s.scratch.mark.every((m) => m === 0)).toBe(true);
  });

  it('the mirror spreads the rows back to their slots, empties free slots and counts versions', () => {
    const s = world();
    s.beachheads.add(1, at(12, 5), 100, BEACH_CUT_OFF);
    s.beachheads.add(1, at(40, 20), 130, BEACH_CUT_OFF);
    const m = new MirrorBeachheads();
    expect(m.liveCount).toBe(0);
    m.adopt(snapshotBeachheads(s));
    expect(m.version).toBe(1);
    expect(m.liveCount).toBe(2);
    expect([m.owner[0], m.seed[0], m.landTick[0], m.status[0], m.cellsOf(0)]).toEqual([1, at(12, 5), 100, BEACH_CUT_OFF, 5]);
    expect([m.owner[1], m.seed[1], m.landTick[1], m.cellsOf(1)]).toEqual([1, at(40, 20), 130, 1]);
    s.beachheads.remove(0);
    m.adopt(snapshotBeachheads(s));
    expect([m.liveCount, m.owner[0], m.seed[0], m.landTick[0], m.cellsOf(0), m.owner[1]]).toEqual([1, 0, 0, 0, 0, 1]);
    expect(m.cellsOf(-1)).toBe(0);
    expect(m.cellsOf(999)).toBe(0);
  });

  it('the signature changes with every column and with the cell count, and is stable otherwise', () => {
    const s = world();
    const b = s.beachheads;
    b.add(1, at(12, 5), 100, BEACH_CUT_OFF);
    const base = beachheadSignature(s);
    expect(beachheadSignature(s)).toBe(base);
    const seen = new Set<number>([base]);
    const probe = (mutate: () => void, undo: () => void, what: string): void => {
      mutate();
      const sig = beachheadSignature(s);
      expect(seen.has(sig), what).toBe(false);
      seen.add(sig);
      undo();
      expect(beachheadSignature(s), `${what} undone`).toBe(base);
    };
    probe(() => (b.owner[0] = 2), () => (b.owner[0] = 1), 'owner');
    probe(() => (b.seed[0] = at(11, 5)), () => (b.seed[0] = at(12, 5)), 'seed');
    probe(() => (b.landTick[0] = 101), () => (b.landTick[0] = 100), 'landTick');
    probe(() => (b.status[0] = 2), () => (b.status[0] = BEACH_CUT_OFF), 'status');
    probe(() => setOwner(s, at(15, 5), 1, 0), () => setOwner(s, at(15, 5), 0, 0), 'cells held');
    probe(() => b.remove(0), () => void b.add(1, at(12, 5), 100, BEACH_CUT_OFF), 'row gone');
  });
});

describe('the beachhead table over the host', () => {
  it('reaches the mirror, follows a growing cluster, moves its version only on a change and loses the row at the revert', async () => {
    const s = world();
    s.beachheads.add(1, at(12, 5), 0, BEACH_CUT_OFF);
    const host = new MainThreadHost(s);
    const { mirror } = await ViewMirror.attach(host);
    expect(mirror.beachheads.liveCount).toBe(1);
    expect(mirror.beachheads.cellsOf(0)).toBe(5);
    host.advance(100); // the first diff after a full view carries the table again (the host has no signature yet)
    const v0 = mirror.beachheadsVersion;
    host.advance(100);
    host.advance(100);
    expect(mirror.beachheadsVersion).toBe(v0); // two quiet ticks: no resend
    setOwner(s, at(15, 5), 1, 0);
    host.advance(100);
    expect(mirror.beachheadsVersion).toBe(v0 + 1);
    expect(mirror.beachheads.cellsOf(0)).toBe(6);
    // the cluster stays below 80 cells and holds no City: at BEACHHEAD_REVERT_TICKS the sim hands it back and the row goes
    for (let i = mirror.tick; i < BEACHHEAD_REVERT_TICKS + 2; i++) host.advance(100);
    expect(mirror.beachheads.liveCount).toBe(0);
    expect(mirror.owner[at(12, 5)]).toBe(0);
  });
});

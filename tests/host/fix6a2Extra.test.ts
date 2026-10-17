// Fix-6A2: [1.0] the helicopter event set and every snapshot column, [1.1] snapshots share no buffer with the live tables, [1.13] a full view steals no side facts.
import { describe, expect, it } from 'vitest';
import { snapshotHelis } from '../../src/host/heliSnapshot';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import type { HostEvent, StateDiff } from '../../src/host/protocol';
import { snapshotMissiles } from '../../src/host/missileSnapshot';
import { snapshotShips } from '../../src/host/shipSnapshot';
import { isHeliEvent } from '../../src/host/viewEventFilter';
import { ViewEventRing } from '../../src/host/viewEventRing';
import { HELI_HOVER, cellCentreQ8 } from '../../src/sim/heliTable';
import * as outbox from '../../src/sim/outbox';
import { HELI_HP_TENTHS } from '../../src/sim/rules';
import { applyLaunchShip } from '../../src/sim/shipPhase';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_FACTORY, STRUCT_SAM } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { missileFixture } from '../../tools/sim/missiles';
import { shipFixture } from '../../tools/sim/shipLanding';

const W = 256;
const H = 96;
const at = (x: number, y: number): number => y * W + x;

/** Seat 0 (owner 1) owns a parked helicopter far from the SAM of owner 2: hidden from seat 1. */
function world(): { s: GameState; heli: number } {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 3, seats: 4, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H).fill(5), maxElev: new Int16Array(W * H).fill(5) });
  const factory = s.structures.add(STRUCT_FACTORY, 1, at(20, 48), s.tick);
  s.structures.readyTick[factory] = s.tick;
  const sam = s.structures.add(STRUCT_SAM, 2, at(150, 48), s.tick);
  s.structures.readyTick[sam] = s.tick;
  const heli = s.helis.addBuilding(1, factory, s.tick, s.tick);
  const t = s.helis;
  t.state[heli] = HELI_HOVER;
  t.x[heli] = cellCentreQ8(20);
  t.y[heli] = cellCentreQ8(20);
  t.mode[heli] = 0;
  t.hp[heli] = HELI_HP_TENTHS;
  t.alt[heli] = 400;
  t.fuel[heli] = 777;
  t.readyTick[heli] = 99;
  t.factory[heli] = 5;
  t.load[heli] = 55;
  t.stateTick[heli] = s.tick;
  return { s, heli };
}

describe('the helicopter event kinds the filter knows are exactly the exported OUTBOX_HELI_* constants', () => {
  it('isHeliEvent(kind) is true for the eight exported kinds and for no other number in 0..63', () => {
    const heli = Object.entries(outbox)
      .filter(([k, v]) => k.startsWith('OUTBOX_HELI_') && typeof v === 'number')
      .map(([, v]) => v as number);
    expect(heli).toHaveLength(8);
    for (let kind = 0; kind < 64; kind++) expect(isHeliEvent(kind), `kind ${kind}`).toBe(heli.includes(kind));
  });
});

describe('every typed array of a hidden helicopter snapshot is zero at the hidden slot', () => {
  it('iterates the snapshot keys, so a new column that is not zeroed fails here', async () => {
    const { s, heli } = world();
    const v = await new MainThreadHost(s, { viewerSeat: 1 }).requestView();
    const h = v.helis as unknown as Record<string, unknown>;
    let columns = 0;
    for (const key of Object.keys(h)) {
      const col = h[key];
      if (!ArrayBuffer.isView(col)) continue;
      columns++;
      const arr = col as unknown as ArrayLike<number>;
      if (key === 'counts') for (const n of Array.from(arr)) expect(n, 'counts').toBe(0);
      else expect(arr[heli], key).toBe(0);
    }
    expect(columns).toBe(11); // ten per-slot columns and the per-owner counts
    // the same row IS visible to its owner: the zeroing is the filter, not an empty table
    const own = await new MainThreadHost(world().s, { viewerSeat: 0 }).requestView();
    expect((own.helis as unknown as { fuel: ArrayLike<number> }).fuel[heli]).toBe(777);
  });
});

describe('a snapshot shares no buffer with the live table (CHARTER 2.6)', () => {
  const buffersOf = (o: object): Set<ArrayBufferLike> => {
    const set = new Set<ArrayBufferLike>();
    for (const v of Object.values(o)) if (ArrayBuffer.isView(v)) set.add(v.buffer);
    return set;
  };
  const shares = (snap: object, table: object): string[] => {
    const live = buffersOf(table);
    return Object.entries(snap)
      .filter(([, v]) => ArrayBuffer.isView(v) && live.has(v.buffer))
      .map(([k]) => k);
  };
  it('missiles (launch counters included), helicopters and ships', () => {
    const fx = missileFixture('plain-cruise', 1);
    expect(shares(snapshotMissiles(fx.state.missiles), fx.state.missiles)).toEqual([]);
    const { s } = world();
    expect(shares(snapshotHelis(s.helis, 8), s.helis)).toEqual([]);
    const ship = shipFixture(0, { island: false });
    expect(applyLaunchShip(ship.state, 0, ship.port, at(144, 24), 600)).toBe(0);
    expect(shares(snapshotShips(ship.state.ships), ship.state.ships)).toEqual([]);
    // the check itself can fail: a "snapshot" that is the table shares everything
    expect(shares(ship.state.ships, ship.state.ships).length).toBeGreaterThan(0);
  });
});

describe('a full view does not steal the pending side facts of the stream', () => {
  it('a fact collected in tick 1, a full view requested inside tick 2: both facts arrive in ONE diff', () => {
    const { s } = world();
    let calls = 0;
    const ref: { host: MainThreadHost | null } = { host: null };
    ref.host = new MainThreadHost(s, {
      stepFn: (st, input) => {
        const r = step(st, input);
        st.outbox.clear();
        calls++;
        if (calls === 2) void ref.host?.requestView(); // the ring holds tick 1's fact right now
        st.outbox.push(outbox.OUTBOX_ELIMINATED, st.tick, calls, 0);
        return r;
      },
    });
    const diffs: StateDiff[] = [];
    ref.host.subscribe((e: HostEvent) => {
      if (e.type === 'diff') diffs.push(e.diff);
    });
    ref.host.runTicks(2);
    const ev = (diffs[0] as StateDiff).view.events;
    const a: number[] = [];
    for (let i = 0; i < ev.length; i += 4) a.push(ev[i + 2] as number);
    expect(a).toEqual([1, 2]);
  });

  it('the ring answers -1 / 0 for an index below zero or past the end', () => {
    const r = new ViewEventRing();
    r.push(5, 6, 7, 8);
    expect([r.kindAt(0), r.kindAt(-1), r.kindAt(1)]).toEqual([5, -1, -1]);
    expect([r.tickAt(-1), r.aAt(-1)]).toEqual([-1, 0]);
  });
});

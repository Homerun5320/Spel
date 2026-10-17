// M13c-2: the model of the Port's ship block (the button state per refusal, the slider's top), the text of all thirteen refusals, and the ship news of the first consumer of the
// mirror's events. The world is the M13c-1 fixture (tools/sim/shipLanding.ts): the same cases the sim's own tests use, asked through the page-side model.
import { describe, expect, it } from 'vitest';
import { rejectKey } from '../../src/ui/hudLogic';
import { shipButtonReason, shipPanelInfo, shipSliderMax, wholeTroops } from '../../src/ui/shipInfo';
import { shipRefusalKey } from '../../src/ui/shipReasons';
import {
  newShipNews,
  ShipEventWatcher,
  SHIP_NEWS_LANDED,
  SHIP_NEWS_LAND_FAILED,
  SHIP_NEWS_LAND_NONE,
  SHIP_NEWS_LAUNCHED,
  SHIP_NEWS_SCRAP_ELIMINATED,
  SHIP_NEWS_SCRAP_NO_PORT,
  SHIP_NEWS_TREATY,
  shipNewsKey,
} from '../../src/ui/shipEvents';
import { REJECT_DIPLO_TREATY_BOUND, REJECT_HELI_BEACHHEAD_FULL, REJECT_PHASE } from '../../src/sim/intents';
import { OUTBOX_SHIP_LANDED, OUTBOX_SHIP_LAUNCHED, OUTBOX_SHIP_RETURNED, OUTBOX_SHIP_RTB, OUTBOX_SHIP_SCRAPPED, OUTBOX_HELI_LANDED } from '../../src/sim/outbox';
import {
  REJECT_SHIP_BAD_TARGET,
  REJECT_SHIP_COOLDOWN,
  REJECT_SHIP_FLEET_CAP,
  REJECT_SHIP_NOT_OWNER,
  REJECT_SHIP_NO_GOLD,
  REJECT_SHIP_NO_PORT,
  REJECT_SHIP_NO_ROUTE,
  REJECT_SHIP_NO_TROOPS,
  REJECT_SHIP_PORT_BUILDING,
  REJECT_SHIP_PORT_BUSY,
  REJECT_SHIP_TABLE_FULL,
  REJECT_SHIP_TROOPS_HIGH,
  REJECT_SHIP_TROOPS_LOW,
} from '../../src/sim/public';
import { BEACHHEAD_CAPACITY, MILLI_GOLD_PER_GOLD, QT_PER_TROOP, SHIP_CAPACITY, SHIP_FLEET_MAX, SHIP_LAUNCH_GOLD, SHIP_MAX_TROOPS, SHIP_MIN_TROOPS } from '../../src/sim/rules';
import { BEACH_CUT_OFF } from '../../src/sim/heliTable';
import { SHIP_OFF, SHIP_SAIL } from '../../src/sim/shipTable';
import { StateView } from '../../src/sim/view';
import { SHIP_W as W, shipFixture } from '../../tools/sim/shipLanding';
import type { ViewEventsView } from '../../src/sim/view';

const at = (x: number, y: number): number => y * W + x;

function base(opts: Parameters<typeof shipFixture>[1] = {}) {
  const fx = shipFixture(0, { island: false, ...opts });
  return { s: fx.state, port: fx.port };
}
const reasonOf = (c: ReturnType<typeof base>, seat = 0): number => shipButtonReason(new StateView(c.s), seat, c.port);

describe('the Skicka fartyg button: one state per refusal that holds before a target is picked', () => {
  it('is live for a finished own Port with gold, troops and a free slot (the missing target is not a reason)', () => {
    expect(reasonOf(base())).toBe(0);
  });

  it('shows every refusal of the checks that come before the target', () => {
    expect(reasonOf(base({ config: { debugIntents: true, spawnPhase: true } }))).toBe(REJECT_PHASE);
    const c = base();
    expect(shipButtonReason(new StateView(c.s), 0, 99)).toBe(REJECT_SHIP_NO_PORT);
    const o = base();
    o.s.gold[2] = 1000 * MILLI_GOLD_PER_GOLD;
    expect(reasonOf(o, 1)).toBe(REJECT_SHIP_NOT_OWNER);
    const b = base();
    b.s.tick = (b.s.structures.readyTick[b.port] as number) - 1;
    expect(reasonOf(b)).toBe(REJECT_SHIP_PORT_BUILDING);
    const busy = base();
    busy.s.ships.add(0, 1, busy.port, 0, 0, SHIP_MIN_TROOPS, 1);
    expect(reasonOf(busy)).toBe(REJECT_SHIP_PORT_BUSY);
    busy.s.ships.state[0] = SHIP_OFF;
    expect(reasonOf(busy)).toBe(REJECT_SHIP_COOLDOWN);
    const fleet = base();
    for (let i = 0; i < SHIP_FLEET_MAX; i++) fleet.s.ships.add(i, 1, 50 + i, 0, 0, SHIP_MIN_TROOPS, 1);
    expect(reasonOf(fleet)).toBe(REJECT_SHIP_FLEET_CAP);
    const few = base();
    few.s.troops[1] = (SHIP_MIN_TROOPS - 1) * QT_PER_TROOP;
    expect(reasonOf(few)).toBe(REJECT_SHIP_NO_TROOPS);
    const poor = base();
    poor.s.gold[1] = SHIP_LAUNCH_GOLD * MILLI_GOLD_PER_GOLD - 1;
    expect(reasonOf(poor)).toBe(REJECT_SHIP_NO_GOLD);
    const full = base({ seats: 10 });
    for (let i = 0; i < SHIP_CAPACITY; i++) full.s.ships.add(i, 3 + (i % 8), 100 + i, 0, 0, SHIP_MIN_TROOPS, 1);
    expect(reasonOf(full)).toBe(REJECT_SHIP_TABLE_FULL);
    const beach = base();
    for (let i = 0; i < BEACHHEAD_CAPACITY; i++) beach.s.beachheads.add(2, at(150 + (i % 50), 5 + Math.floor(i / 50)), 0, BEACH_CUT_OFF);
    expect(reasonOf(beach)).toBe(REJECT_HELI_BEACHHEAD_FULL);
  });

  it('leaves the refusals that need a target to the mode: a wall of land across the sea does not dim the button', () => {
    const c = base();
    for (let y = 0; y < 64; y++) c.s.terrain[at(120, y)] = 2;
    expect(reasonOf(c)).toBe(0);
  });

  it('the panel info carries the fee, the fleet and the slider top', () => {
    const c = base();
    c.s.ships.add(3, 1, 77, 0, 0, SHIP_MIN_TROOPS, 1);
    const info = shipPanelInfo(new StateView(c.s), 0, c.port);
    expect([info.price, info.fleet, info.cap]).toEqual([SHIP_LAUNCH_GOLD, 1, SHIP_FLEET_MAX]);
    expect(info.maxTroops).toBe(SHIP_MAX_TROOPS); // the fixture seat is rich
  });
});

describe('the troop slider', () => {
  it('is capped by the troops the seat has, never above the ship cap and never below the least launch', () => {
    const c = base();
    const view = new StateView(c.s);
    c.s.troops[1] = 345 * QT_PER_TROOP + 3;
    view.refresh();
    expect(wholeTroops(view, 0)).toBe(345);
    expect(shipSliderMax(view, 0)).toBe(345);
    c.s.troops[1] = 50_000 * QT_PER_TROOP;
    view.refresh();
    expect(shipSliderMax(view, 0)).toBe(SHIP_MAX_TROOPS);
    c.s.troops[1] = 3 * QT_PER_TROOP;
    view.refresh();
    expect(shipSliderMax(view, 0)).toBe(SHIP_MIN_TROOPS);
  });
});

describe('the thirteen refusals have a text each', () => {
  const CODES = [REJECT_SHIP_NO_PORT, REJECT_SHIP_NOT_OWNER, REJECT_SHIP_PORT_BUILDING, REJECT_SHIP_PORT_BUSY, REJECT_SHIP_COOLDOWN, REJECT_SHIP_FLEET_CAP, REJECT_SHIP_TROOPS_LOW, REJECT_SHIP_TROOPS_HIGH, REJECT_SHIP_NO_TROOPS, REJECT_SHIP_NO_GOLD, REJECT_SHIP_BAD_TARGET, REJECT_SHIP_NO_ROUTE, REJECT_SHIP_TABLE_FULL];

  it('each code maps to its own reject.ship key, through the one function every refusal text goes through (rejectKey)', () => {
    const keys = CODES.map((c) => shipRefusalKey(c));
    expect(new Set(keys).size).toBe(13);
    for (const k of keys) expect(k).toMatch(/^reject\.ship\./);
    expect(CODES.map((c) => rejectKey(c))).toEqual(keys);
    // the shared codes keep the older texts
    expect(rejectKey(REJECT_DIPLO_TREATY_BOUND)).not.toMatch(/^reject\.ship\./);
    expect(rejectKey(REJECT_HELI_BEACHHEAD_FULL)).toBe('toast.heli.beachheadFull');
    expect(shipRefusalKey(REJECT_PHASE)).toBeNull();
  });
});

/** A synthetic list of events. */
function events(list: Array<[number, number, number]>): ViewEventsView {
  return {
    length: list.length,
    dropped: 0,
    kindAt: (i) => (list[i] as [number, number, number])[0],
    tickAt: () => 0,
    aAt: (i) => (list[i] as [number, number, number])[1],
    bAt: (i) => (list[i] as [number, number, number])[2],
  };
}

describe('ShipEventWatcher: the news of the own ships', () => {
  const NONE = events([]);

  it('turns set sail, landed (cells), failed, nothing to land on, treaty and both scrap causes into news codes, in order', () => {
    const c = base();
    c.s.ships.add(2, 1, c.port, 0, 0, SHIP_MIN_TROOPS, 1);
    const view = new StateView(c.s);
    const w = new ShipEventWatcher();
    const out = newShipNews();
    const n = w.update(
      events([
        [OUTBOX_SHIP_LAUNCHED, 2, 777],
        [OUTBOX_SHIP_LANDED, 2, 4],
        [OUTBOX_SHIP_LANDED, 2, -1],
        [OUTBOX_SHIP_LANDED, 2, 0],
        [OUTBOX_SHIP_RTB, 2, 1],
        [OUTBOX_SHIP_SCRAPPED, 2, 1],
        [OUTBOX_SHIP_SCRAPPED, 2, 2],
      ]),
      view.ships,
      1,
      out,
    );
    expect(n).toBe(7);
    expect(Array.from(out.codes.subarray(0, 7))).toEqual([SHIP_NEWS_LAUNCHED, SHIP_NEWS_LANDED, SHIP_NEWS_LAND_FAILED, SHIP_NEWS_LAND_NONE, SHIP_NEWS_TREATY, SHIP_NEWS_SCRAP_ELIMINATED, SHIP_NEWS_SCRAP_NO_PORT]);
    expect(out.args[1]).toBe(4); // the cells taken
    expect(new Set(Array.from(out.codes.subarray(0, 7), (k) => shipNewsKey(k))).size).toBe(7);
  });

  it('says nothing about the ends of a mission (RTB with b = 0), docking, helicopter facts or an empty list', () => {
    const c = base();
    c.s.ships.add(2, 1, c.port, 0, 0, SHIP_MIN_TROOPS, 1);
    const view = new StateView(c.s);
    const w = new ShipEventWatcher();
    const out = newShipNews();
    expect(w.update(events([[OUTBOX_SHIP_RTB, 2, 0], [OUTBOX_SHIP_RETURNED, 2, 5], [OUTBOX_HELI_LANDED, 2, 3]]), view.ships, 1, out)).toBe(0);
    expect(w.update(NONE, view.ships, 1, out)).toBe(0);
  });

  it('gives NO news about another seat\'s ship: an enemy fact shows nothing (ships are visible to all in v1, the toasts are the owner\'s)', () => {
    const c = base({ seats: 3 });
    c.s.ships.add(2, 2, c.port, 0, 0, SHIP_MIN_TROOPS, 1); // ownerId 2
    const view = new StateView(c.s);
    const w = new ShipEventWatcher();
    const out = newShipNews();
    expect(w.update(events([[OUTBOX_SHIP_LAUNCHED, 2, 5], [OUTBOX_SHIP_LANDED, 2, 3], [OUTBOX_SHIP_RTB, 2, 1]]), view.ships, 1, out)).toBe(0);
    expect(w.update(events([[OUTBOX_SHIP_LAUNCHED, 2, 5]]), view.ships, 2, out)).toBe(1);
  });

  it('a scrapped row is gone from the table, yet its owner is remembered from the table before: the owner is told, a stranger is not, an unknown slot gives nothing', () => {
    const c = base({ seats: 3 });
    c.s.ships.add(2, 1, c.port, 0, 0, SHIP_MIN_TROOPS, 1);
    c.s.ships.add(4, 2, c.port, 0, 0, SHIP_MIN_TROOPS, 1);
    const view = new StateView(c.s);
    const w = new ShipEventWatcher();
    const out = newShipNews();
    w.update(NONE, view.ships, 1, out); // the watcher sees the table with both rows
    c.s.ships.remove(2);
    c.s.ships.remove(4);
    const ev = events([[OUTBOX_SHIP_SCRAPPED, 2, 2], [OUTBOX_SHIP_SCRAPPED, 4, 2], [OUTBOX_SHIP_SCRAPPED, 6, 2]]);
    expect(w.update(ev, view.ships, 1, out)).toBe(1);
    expect(out.codes[0]).toBe(SHIP_NEWS_SCRAP_NO_PORT);
  });

  it('a burst is cut at SHIP_NEWS_MAX and out-of-range ship ids are ignored', () => {
    const c = base();
    for (let i = 0; i < 12; i++) c.s.ships.add(i, 1, 50 + i, 0, 0, SHIP_MIN_TROOPS, 1);
    const view = new StateView(c.s);
    const w = new ShipEventWatcher();
    const out = newShipNews();
    const burst = events(Array.from({ length: 12 }, (_, i) => [OUTBOX_SHIP_LAUNCHED, i, 1] as [number, number, number]));
    expect(w.update(burst, view.ships, 1, out)).toBe(out.codes.length);
    expect(w.update(events([[OUTBOX_SHIP_LAUNCHED, 99, 1], [OUTBOX_SHIP_LAUNCHED, -1, 1]]), view.ships, 1, out)).toBe(0);
    c.s.ships.state[0] = SHIP_SAIL;
  });
});

// Fix-6A2 [1.7]: deserialize boundary guards, each forged on a blob where every other guard passes (in memory), or patched in the bytes with the exact error asserted
// (the checksum is checked last, so a guard that does not fire shows up as 'checksum' instead of 'air-range').
import { describe, expect, it } from 'vitest';
import { MISSILE_CAPACITY, MISSILE_MAX_FLIGHT_TICKS, SHIP_CAPACITY, SHIP_ROUTE_CAPACITY } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/serialize';
import { applyLaunchShip, shipPhase } from '../../src/sim/shipPhase';
import { SHIP_OFF } from '../../src/sim/shipTable';
import { MISSILE_FISSION } from '../../src/sim/missileTable';
import { STRUCT_SAM } from '../../src/sim/structureRules';
import { missileFixture } from '../../tools/sim/missiles';
import { shipFixture } from '../../tools/sim/shipLanding';

const at = (x: number, y: number, w = 1024): number => y * w + x;
const errorOf = (bytes: Uint8Array): string => {
  const r = deserialize(bytes);
  return r.ok ? 'ok' : r.error;
};

describe('ship table boundaries', () => {
  const docked = (): ReturnType<typeof shipFixture>['state'] => {
    const fx = shipFixture(0, { island: false, seats: 8 });
    const s = fx.state;
    const cell = s.structures.cell[fx.port] as number;
    const water = at(100, 24, 256);
    for (let id = 0; id < SHIP_CAPACITY; id++) {
      const o = 1 + (id % 8); // four ships per seat: exactly the fleet cap
      s.ships.add(id, o, fx.port, cell, 0, 0, 0);
      s.ships.state[id] = SHIP_OFF;
      s.ships.x[id] = 100 * 256 + 128;
      s.ships.y[id] = 24 * 256 + 128;
      s.ships.routeLen[id] = 1;
      s.ships.routeIdx[id] = 0;
      s.ships.route[id * SHIP_ROUTE_CAPACITY] = water;
    }
    return s;
  };

  it('a FULL table (32 ships, four per seat) is a legal blob', () => {
    const s = docked();
    expect(s.ships.liveCount).toBe(SHIP_CAPACITY);
    expect(errorOf(serialize(s))).toBe('ok');
  });

  it('a route of exactly SHIP_ROUTE_CAPACITY waypoints is legal, one more is refused', () => {
    const s = docked();
    for (let k = 0; k < SHIP_ROUTE_CAPACITY; k++) s.ships.route[k] = at(100, 24, 256);
    s.ships.routeLen[0] = SHIP_ROUTE_CAPACITY;
    expect(errorOf(serialize(s))).toBe('ok');
    s.ships.routeLen[0] = SHIP_ROUTE_CAPACITY + 1;
    expect(errorOf(serialize(s))).not.toBe('ok');
  });

  it('two ship rows with the same id are refused as air-range (bytes patched: ids 0, 1 -> 0, 0)', () => {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    expect(applyLaunchShip(s, 0, fx.port, at(144, 24, 256), 600)).toBe(0);
    for (let i = 0; i < 10; i++) {
      shipPhase(s);
      s.tick++;
    }
    const len = s.ships.routeLen[0] as number;
    s.ships.add(1, 1, fx.port, s.structures.cell[fx.port] as number, 0, 0, 0);
    s.ships.state[1] = SHIP_OFF;
    s.ships.x[1] = s.ships.x[0] as number;
    s.ships.y[1] = s.ships.y[0] as number;
    s.ships.routeLen[1] = 1;
    s.ships.route[SHIP_ROUTE_CAPACITY] = s.ships.route[0] as number;
    const bytes = serialize(s);
    expect(errorOf(bytes)).toBe('ok');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const second = (p: number): number => p + 4 + 48 + 4 * len;
    let found = -1;
    for (let p = 0; p + second(0) + 8 < bytes.length; p += 4) {
      if (v.getUint32(p, true) === 2 && v.getUint32(p + 4, true) === 0 && v.getUint32(p + 8, true) === 1 && v.getUint32(second(p), true) === 1 && v.getUint32(second(p) + 4, true) === 1) {
        found = p;
        break;
      }
    }
    expect(found).toBeGreaterThan(0);
    v.setUint32(second(found), 0, true);
    expect(errorOf(bytes)).toBe('air-range');
  });
});

describe('missile table boundaries', () => {
  const base = (): ReturnType<typeof missileFixture>['state'] => {
    const fx = missileFixture('sam-stack', 1);
    for (const id of fx.sams) fx.state.structures.remove(id);
    return fx.state;
  };
  const addAll = (s: ReturnType<typeof base>, n: number): void => {
    for (let id = 0; id < n; id++) s.missiles.add(id, 1, MISSILE_FISSION, 0, s.tick - 5, s.tick + 20, at(296, 250), at(330, 249));
  };

  it('a FULL missile table (64 rows) is a legal blob', () => {
    const s = base();
    addAll(s, MISSILE_CAPACITY);
    expect(errorOf(serialize(s))).toBe('ok');
  });

  it('the flight-time bounds are exact: impact == now and launch == now are legal; impact <= launch, the flight cap + 1 and impact < now are refused', () => {
    const s = base();
    s.missiles.add(0, 1, MISSILE_FISSION, 0, s.tick, s.tick + MISSILE_MAX_FLIGHT_TICKS, at(296, 250), at(330, 249));
    expect(errorOf(serialize(s))).toBe('ok'); // launch == now, flight == cap
    s.missiles.impactTick[0] = s.tick + MISSILE_MAX_FLIGHT_TICKS + 1;
    expect(errorOf(serialize(s))).not.toBe('ok');
    s.missiles.launchTick[0] = s.tick - 10;
    s.missiles.impactTick[0] = s.tick; // impact == now: the blast is due this very tick
    expect(errorOf(serialize(s))).toBe('ok');
    s.missiles.impactTick[0] = s.tick - 1;
    expect(errorOf(serialize(s))).not.toBe('ok');
    s.missiles.launchTick[0] = s.tick + 1; // launched in the future
    s.missiles.impactTick[0] = s.tick + 30;
    expect(errorOf(serialize(s))).not.toBe('ok');
    s.missiles.launchTick[0] = s.tick;
    s.missiles.impactTick[0] = s.tick; // impact == launch
    expect(errorOf(serialize(s))).not.toBe('ok');
  });

  it('two missile rows with the same id are refused as air-range (bytes patched: ids 0, 1 -> 0, 0)', () => {
    const s = base();
    addAll(s, 2);
    const bytes = serialize(s);
    expect(errorOf(bytes)).toBe('ok');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let found = -1;
    // count 2, then rows of 32 bytes: id 0 owner 1 ..., id 1 owner 1 ...
    for (let p = 0; p + 4 + 64 < bytes.length; p += 4) {
      if (v.getUint32(p, true) === 2 && v.getUint32(p + 4, true) === 0 && v.getUint32(p + 8, true) === 1 && v.getUint32(p + 36, true) === 1 && v.getUint32(p + 40, true) === 1 && v.getUint32(p + 20, true) === s.tick - 5) {
        found = p;
        break;
      }
    }
    expect(found).toBeGreaterThan(0);
    v.setUint32(found + 36, 0, true);
    expect(errorOf(bytes)).toBe('air-range');
  });

  it('the interceptor bounds are exact: fire == launch, fire == now and meet == impact are legal', () => {
    const s = base();
    const a = s.structures.add(STRUCT_SAM, 2, at(322, 244), 0);
    s.missiles.add(0, 1, MISSILE_FISSION, 0, s.tick - 10, s.tick + 20, at(296, 250), at(330, 249));
    expect(s.missiles.addInterceptor(0, a, s.tick - 10, s.tick + 20, 1)).toBe(true); // fire == launch, meet == impact
    expect(errorOf(serialize(s))).toBe('ok');
    s.missiles.iFire[0] = s.tick;
    expect(errorOf(serialize(s))).toBe('ok'); // fire == now
    s.missiles.iFire[0] = s.tick - 11;
    expect(errorOf(serialize(s))).not.toBe('ok'); // fire before launch
    s.missiles.iFire[0] = s.tick - 10;
    s.missiles.iMeet[0] = s.tick + 21;
    expect(errorOf(serialize(s))).not.toBe('ok'); // meet after impact
  });
});

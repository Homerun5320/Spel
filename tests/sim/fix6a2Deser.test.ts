// Fix-6A2: audit 5 mutation holes. Each test fails on the one-line mutant named in docs/DECISIONS.md (Fix-6A2).
import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../../src/sim/serialize';
import { applyLaunchShip, shipPhase } from '../../src/sim/shipPhase';
import { MISSILE_FISSION } from '../../src/sim/missileTable';
import { STRUCT_SAM } from '../../src/sim/structureRules';
import { missileFixture } from '../../tools/sim/missiles';
import { shipFixture } from '../../tools/sim/shipLanding';

const at = (x: number, y: number, w = 1024): number => y * w + x;

describe('deserialize guards that the single-field forgeries of the guard tables do not reach', () => {
  const sailing = (): ReturnType<typeof shipFixture>['state'] => {
    const fx = shipFixture(0, { island: false });
    expect(applyLaunchShip(fx.state, 0, fx.port, at(144, 24, 256), 600)).toBe(0);
    for (let i = 0; i < 10; i++) {
      shipPhase(fx.state);
      fx.state.tick++;
    }
    return fx.state;
  };

  it('a ship row in state 0 (and target 0, so no other guard objects) is refused', () => {
    const s = sailing();
    s.ships.state[0] = 0;
    s.ships.target[0] = 0;
    expect(deserialize(serialize(s)).ok).toBe(false);
  });

  it('a ship row in state 5 (target 0, so no other guard objects) is refused', () => {
    const s = sailing();
    s.ships.state[0] = 5;
    s.ships.target[0] = 0;
    expect(deserialize(serialize(s)).ok).toBe(false);
  });

  it('a docked ship with an EMPTY route is refused (routeLen 0)', () => {
    const s = sailing();
    s.ships.state[0] = 4; // SHIP_OFF
    s.ships.target[0] = 0;
    s.ships.load[0] = 0;
    s.ships.routeIdx[0] = 0;
    s.ships.routeLen[0] = 0;
    expect(deserialize(serialize(s)).ok).toBe(false);
  });

  it('a route longer than SHIP_ROUTE_CAPACITY is refused (routeLen 49 would spill into the next ship row)', () => {
    const s = sailing();
    s.ships.routeLen[0] = 49;
    expect(deserialize(serialize(s)).ok).toBe(false);
  });

  it('two interceptor rows for the same (missile, SAM) pair are refused (DECISIONS M14b point 1: one row per pair)', () => {
    const fx = missileFixture('sam-stack', 1);
    const s = fx.state;
    for (const id of fx.sams) s.structures.remove(id);
    const a = s.structures.add(STRUCT_SAM, 2, at(322, 244), 0);
    s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick - 10, s.tick + 20, at(296, 250), at(330, 249));
    expect(s.missiles.addInterceptor(0, a, s.tick - 3, s.tick + 5, 0)).toBe(true);
    expect(deserialize(serialize(s)).ok).toBe(true); // one row: fine
    expect(s.missiles.addInterceptor(0, a, s.tick - 2, s.tick + 6, 0)).toBe(true);
    expect(deserialize(serialize(s)).ok).toBe(false);
  });

  it('an interceptor row fired BEFORE its missile was launched is refused', () => {
    const fx = missileFixture('sam-stack', 1);
    const s = fx.state;
    for (const id of fx.sams) s.structures.remove(id);
    const a = s.structures.add(STRUCT_SAM, 2, at(322, 244), 0);
    s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick - 10, s.tick + 20, at(296, 250), at(330, 249));
    s.missiles.addInterceptor(0, a, s.tick - 12, s.tick + 5, 0);
    expect(deserialize(serialize(s)).ok).toBe(false);
  });
});

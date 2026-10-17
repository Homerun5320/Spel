// Fix-6A2: audit 5 mutation holes. Each test fails on the one-line mutant named in docs/DECISIONS.md (Fix-6A2).
import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../../src/sim/serialize';
import { applyLaunchShip, scrapOwnerShips, shipPhase } from '../../src/sim/shipPhase';
import { SHIP_LAND, SHIP_OFF, SHIP_RETURN, SHIP_SAIL } from '../../src/sim/shipTable';
import { ShipRoute, SHIP_ROUTE_NONE, SHIP_ROUTE_OK, findShipRoute } from '../../src/sim/shipRoute';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_PORT } from '../../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_PLAINS, CLASS_SHALLOWS } from '../../src/sim/terrain';
import { BUILD_TICKS, MILLI_GOLD_PER_GOLD, QT_PER_TROOP } from '../../src/sim/rules';
import { SHIP_W, shipFixture } from '../../tools/sim/shipLanding';

const W = 256;
const H = 64;
const at = (x: number, y: number): number => y * W + x;

/** A 256 x 64 plains world with water at the given columns (all rows), owner 1 on the left of `split`, owner 2 on the right; a finished Port of seat 0 at `port`. */
function dateLineWorld(waterCols: number[], portX: number, ownerOneCols: (x: number) => boolean): { s: GameState; port: number } {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  for (const x of waterCols) for (let y = 0; y < H; y++) terrain[at(x, y)] = CLASS_DEEP_SEA;
  const s = createState({ width: W, height: H, seed: 1, seats: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H).fill(5) });
  const wet = new Set(waterCols);
  for (let c = 0; c < W * H; c++) {
    const x = c % W;
    s.owner[c] = wet.has(x) ? 0 : ownerOneCols(x) ? 1 : 2;
  }
  rebuildAggregates(s);
  s.gold[1] = 1000 * MILLI_GOLD_PER_GOLD;
  s.troops[1] = 2000 * QT_PER_TROOP;
  s.troops[2] = 500 * QT_PER_TROOP;
  const port = s.structures.add(STRUCT_PORT, 1, at(portX, 24), 0);
  s.tick = BUILD_TICKS[STRUCT_PORT] as number;
  return { s, port };
}

describe('a crossing over the date line (x wraps) takes the short way', () => {
  it('sea x 249..255 and 0..7: from the Port at x 248 to the coast at x 8 is a 13 cell voyage, one straight leg, landing inside 130 ticks', () => {
    const sea = [249, 250, 251, 252, 253, 254, 255, 0, 1, 2, 3, 4, 5, 6, 7];
    const { s, port } = dateLineWorld(sea, 248, (x) => x >= 150 && x <= 248);
    const target = at(8, 24);
    const r = new ShipRoute();
    expect(findShipRoute(W, H, s.terrain, at(249, 24), target, r)).toBe(SHIP_ROUTE_OK);
    expect(r.count).toBe(2); // the string-pull sees a straight line across the date line
    expect(r.cells[1]).toBe(at(6, 24));
    expect(applyLaunchShip(s, 0, port, target, 100)).toBe(0);
    let landedAt = -1;
    for (let i = 0; i < 400 && landedAt < 0; i++) {
      shipPhase(s);
      s.tick++;
      if (s.ships.state[0] === SHIP_LAND) landedAt = i;
    }
    expect(landedAt).toBeGreaterThan(0);
    expect(landedAt).toBeLessThan(130); // 13 cells x 8 ticks; the long way round is about 100 cells
    let dockedAt = -1;
    for (let i = 0; i < 400 && dockedAt < 0; i++) {
      shipPhase(s);
      s.tick++;
      if (s.ships.state[0] === SHIP_OFF) dockedAt = i;
      const x = s.ships.x[0] as number;
      expect(x, `tick ${i}`).toBeGreaterThanOrEqual(0); // a position is always inside the world
      expect(x, `tick ${i}`).toBeLessThan(W * 256);
    }
    expect(dockedAt).toBeGreaterThan(0);
    expect(dockedAt).toBeLessThan(130 + 20 + 130); // out, unload, and home the short way (west over the date line)
  });

  it('the Port on the first column finds its water on the LAST column (west neighbour wraps)', () => {
    const sea = [248, 249, 250, 251, 252, 253, 254, 255];
    const { s, port } = dateLineWorld(sea, 0, (x) => x >= 0 && x < 100);
    // owner 2 holds x < 248 .. but the world is arranged so that owner 1 is x 0..99, so give the coast to 2:
    for (let c = 0; c < W * H; c++) if (c % W >= 100 && c % W < 248) s.owner[c] = 2;
    rebuildAggregates(s);
    const target = at(246, 24);
    expect(applyLaunchShip(s, 0, port, target, 100)).toBe(0);
  });
});

describe('route rules', () => {
  it('a diagonal gap between two land corners is not a passage (both orthogonal cells must be water)', () => {
    const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
    terrain[at(100, 30)] = CLASS_DEEP_SEA;
    terrain[at(101, 31)] = CLASS_DEEP_SEA;
    const r = new ShipRoute();
    expect(findShipRoute(W, H, terrain, at(100, 30), at(103, 33), r)).toBe(SHIP_ROUTE_NONE);
  });

  it('a one-corner cut is not taken: in a one-cell channel with a bend the route keeps the waypoint at the corner (R01)', () => {
    const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
    for (const [x, y] of [[100, 30], [101, 30], [101, 31], [101, 32], [102, 32], [103, 32], [104, 32], [105, 32]] as const) terrain[at(x, y)] = CLASS_DEEP_SEA;
    const r = new ShipRoute();
    expect(findShipRoute(W, H, terrain, at(100, 30), at(105, 32), r)).toBe(SHIP_ROUTE_OK);
    const cells = Array.from(r.cells.subarray(0, r.count));
    expect(cells).toContain(at(101, 31)); // (100,30) -> (101,31) diagonally would squeeze between the land corner (100,31) and the water (101,30)
  });

  it('shallow water is sailable (a channel of Shallows from start to goal)', () => {
    const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
    for (let x = 100; x <= 112; x++) terrain[at(x, 30)] = CLASS_SHALLOWS;
    const r = new ShipRoute();
    expect(findShipRoute(W, H, terrain, at(100, 30), at(114, 30), r)).toBe(SHIP_ROUTE_OK);
  });
});

describe('an eliminated owner loses ships in every state', () => {
  const states: Array<[string, number, number]> = [['sail', SHIP_SAIL, 100], ['unloading', SHIP_LAND, 385], ['returning', SHIP_RETURN, 600], ['docked', SHIP_OFF, 900]];
  for (const [name, st, ticks] of states) {
    it(`${name}: scrapOwnerShips removes the row`, () => {
      const fx = shipFixture(0, { island: false });
      const s = fx.state;
      expect(applyLaunchShip(s, 0, fx.port, at(144, 24), 600)).toBe(0);
      for (let i = 0; i < ticks; i++) {
        shipPhase(s);
        s.tick++;
      }
      expect(s.ships.state[0]).toBe(st);
      scrapOwnerShips(s, 1);
      expect(s.ships.liveCount).toBe(0);
    });
  }

  it('deserialize refuses an eliminated seat that still has a ship (docked or not)', () => {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    expect(applyLaunchShip(s, 0, fx.port, at(144, 24), 600)).toBe(0);
    s.match.eliminated[1] = 1;
    for (let c = 0; c < SHIP_W * 64; c++) if (s.owner[c] === 1) s.owner[c] = 0;
    s.structures.transfer(fx.port, 2, 1);
    s.troops[1] = 0;
    rebuildAggregates(s);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(false);
  });
});

describe('a ship docks only in a FINISHED PORT on its cell', () => {
  const setup = (): { s: GameState; port: number; cell: number } => {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    expect(applyLaunchShip(s, 0, fx.port, at(144, 24), 100)).toBe(0);
    const cell = s.structures.cell[fx.port] as number;
    s.ships.state[0] = SHIP_RETURN;
    s.ships.routeIdx[0] = 0;
    s.ships.target[0] = 0;
    return { s, port: fx.port, cell };
  };

  it('the Port was replaced by a City on the same cell (the freed slot is reused): the ship is scrapped, not docked', () => {
    const { s, port, cell } = setup();
    s.structures.remove(port);
    const id = s.structures.add(STRUCT_CITY, 1, cell, 0);
    expect(id).toBe(port);
    s.tick = 400; // the City is finished (150 ticks)
    shipPhase(s);
    expect(s.ships.liveCount).toBe(0);
  });

  it('the Port was rebuilt and is still under construction: the ship is scrapped, not docked', () => {
    const { s, port, cell } = setup();
    s.structures.remove(port);
    const id = s.structures.add(STRUCT_PORT, 1, cell, s.tick);
    expect(id).toBe(port);
    shipPhase(s);
    expect(s.ships.liveCount).toBe(0);
  });
});

describe('a ship can be saved in every tick of its voyage', () => {
  it('the tick after the landing (state RETURN, routeIdx must be the last waypoint)', () => {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    expect(applyLaunchShip(s, 0, fx.port, at(144, 24), 600)).toBe(0);
    let n = 0;
    while (s.ships.state[0] !== SHIP_RETURN && n++ < 1000) {
      shipPhase(s);
      s.tick++;
    }
    expect(s.ships.state[0]).toBe(SHIP_RETURN);
    expect(deserialize(serialize(s)).ok).toBe(true);
  });

  it('a ship turned back by a treaty can be saved at once (no landing cell any more)', () => {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    expect(applyLaunchShip(s, 0, fx.port, at(144, 24), 600)).toBe(0);
    for (let i = 0; i < 100; i++) {
      shipPhase(s);
      s.tick++;
    }
    s.diplo.setRelation(1, 2, 2, 0); // RELATION_ALLIANCE
    shipPhase(s);
    s.tick++;
    expect(s.ships.state[0]).toBe(SHIP_RETURN);
    expect(deserialize(serialize(s)).ok).toBe(true);
  });
});

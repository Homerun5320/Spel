// CPU budget of the ships (M13c-1; perf project). (1) One tick of the ship phase with the table full: 32 ships sailing 200-cell routes on a 1024x512 world; (2) one route search over
// 200 cells of open sea and one round a 60-cell island on the same world. Budgets go through budgetMs (tests/perfguard.ts); statistic: median of 200 runs after 50 warm-ups (the search: median of 20
// after 5).
import { describe, expect, it } from 'vitest';
import { SHIP_CAPACITY, SHIP_ROUTE_CAPACITY } from '../src/sim/rules';
import { SHIP_ROUTE_OK, ShipRoute, findShipRoute } from '../src/sim/shipRoute';
import { shipPhase } from '../src/sim/shipPhase';
import { SHIP_SAIL } from '../src/sim/shipTable';
import { createState, type GameState } from '../src/sim/state';
import { CLASS_PLAINS } from '../src/sim/terrain';
import { budgetMs, measureMedianMs } from './perfguard';

const W = 1024;
const H = 512;
const at = (x: number, y: number): number => y * W + x;

function world(): GameState {
  const terrain = new Uint8Array(W * H); // all deep sea
  const s = createState({ width: W, height: H, seed: 1, seats: 12, terrain, elevation: new Uint16Array(W * H) });
  s.tick = 5000;
  for (let i = 0; i < SHIP_CAPACITY; i++) {
    const t = s.ships;
    const y = 10 + i * 10;
    t.add(i, 1 + (i % 12), 0, at(10, y), s.tick, 300, at(400, y) + 1);
    t.state[i] = SHIP_SAIL;
    t.x[i] = (100 + i) * 256 + 128;
    t.y[i] = y * 256 + 128;
    t.routeLen[i] = 2;
    t.routeIdx[i] = 1;
    t.route[i * SHIP_ROUTE_CAPACITY] = at(100, y);
    t.route[i * SHIP_ROUTE_CAPACITY + 1] = at(300, y); // 200 cells
  }
  return s;
}

describe('ship performance', () => {
  it('a ship phase with all 32 slots sailing 200-cell routes takes at most budgetMs(0.05) (median of 200)', () => {
    const s = world();
    const before = s.ships.x[0] as number;
    const ms = measureMedianMs(
      () => {
        shipPhase(s);
        s.tick++;
      },
      { runs: 200, warmups: 50 },
    );
    expect(s.ships.x[0], 'the ships really moved').toBeGreaterThan(before);
    expect(s.ships.state[31]).toBe(SHIP_SAIL);
    console.log(`ship phase, 32 ships: median ${ms.toFixed(4)} ms`);
    expect(ms).toBeLessThan(budgetMs(0.05));
  });

  it('a route search over 200 cells of open sea takes at most budgetMs(2), one round a 60-cell island at most budgetMs(6) (median of 20)', () => {
    const t = new Uint8Array(W * H);
    for (let y = 200; y < 260; y++) t[at(300, y)] = CLASS_PLAINS; // a wall of land 60 cells long on the straight line
    t[at(500, 230)] = CLASS_PLAINS;
    t[at(400, 100)] = CLASS_PLAINS;
    const r = new ShipRoute();
    const open = measureMedianMs(() => void findShipRoute(W, H, t, at(200, 100), at(400, 100), r), { runs: 20, warmups: 5 });
    expect(findShipRoute(W, H, t, at(200, 100), at(400, 100), r)).toBe(SHIP_ROUTE_OK);
    expect(r.pathCells).toBe(199); // x 200 to 398
    const round = measureMedianMs(() => void findShipRoute(W, H, t, at(200, 230), at(500, 230), r), { runs: 20, warmups: 5 });
    expect(findShipRoute(W, H, t, at(200, 230), at(500, 230), r)).toBe(SHIP_ROUTE_OK);
    expect(r.count, 'the route bends round the wall').toBeGreaterThanOrEqual(3);
    console.log(`route search: open sea ${open.toFixed(3)} ms (${r.expanded} expanded in the last), round the wall ${round.toFixed(3)} ms`);
    expect(open).toBeLessThan(budgetMs(2));
    expect(round).toBeLessThan(budgetMs(6));
  });
});

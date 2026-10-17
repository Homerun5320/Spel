// The ship preview (M13c-2): what the ship mode shows for a picked coast cell. NO RULE IS REPEATED HERE. The verdict is `validateLaunchShip` (the very `checkLaunchShip` the sim's
// LaunchShip runs); the route is the sim's own `findShipRoute` from the water cell beside the Port, so the line drawn is the line the ship will sail (`tests/app/ship.test.ts`
// proves both against the real step path). It is asked once per picked cell or slider step, never per frame, so it allocates its answer.
import { findShipRoute, portWaterCell, ShipRoute, SHIP_ROUTE_OK, validateLaunchShip, type SimView } from '../sim/public';
import { SHIP_CELLS_PER_TICK_Q, TICK_HZ } from '../sim/rules';

export interface ShipPreview {
  readonly port: number;
  readonly cell: number;
  readonly troops: number;
  /** `validateLaunchShip`: 0 = the launch would be accepted, else the REJECT_* code. */
  readonly reason: number;
  /** The route in sim cells (the water cell beside the Port, the turning points, the goal), or null when there is none. */
  readonly waypoints: readonly number[] | null;
  /** Sailing time out, whole seconds (rounded up); 0 without a route. */
  readonly etaSeconds: number;
}

/** The length of a waypoint line in Q8 cells (x wrapping over the date line, the way the sim steps). */
export function routeLengthQ8(width: number, cells: ArrayLike<number>, count: number): number {
  let total = 0;
  const w256 = width * 256;
  for (let i = 0; i + 1 < count; i++) {
    const a = cells[i] as number;
    const b = cells[i + 1] as number;
    const ax = a % width;
    const bx = b % width;
    let dx = (bx - ax) * 256;
    if (dx > w256 / 2) dx -= w256;
    else if (dx < -w256 / 2) dx += w256;
    const dy = (Math.floor(b / width) - Math.floor(a / width)) * 256;
    total += Math.hypot(dx, dy);
  }
  return total;
}

/** The sailing time in whole seconds for a route of `count` waypoints. */
export function shipEtaSeconds(width: number, cells: ArrayLike<number>, count: number): number {
  return Math.ceil(routeLengthQ8(width, cells, count) / SHIP_CELLS_PER_TICK_Q / TICK_HZ);
}

/** The preview for `seat` sending a ship from Port `port` to `cell` with `troops`, answered from the snapshot `view`. */
export function previewShip(view: SimView, seat: number, port: number, cell: number, troops: number): ShipPreview {
  const reason = validateLaunchShip(view, seat, port, cell, troops);
  const none: ShipPreview = { port, cell, troops, reason, waypoints: null, etaSeconds: 0 };
  const s = view.structures;
  if (!Number.isInteger(port) || port < 0 || port >= s.highWater || (s.owner[port] as number) === 0) return none;
  if (!Number.isInteger(cell) || cell < 0 || cell >= view.width * view.height) return none;
  const start = portWaterCell(view.width, view.height, view.terrainClass, s.cell[port] as number);
  if (start < 0) return none;
  const route = new ShipRoute();
  if (findShipRoute(view.width, view.height, view.terrainClass, start, cell, route) !== SHIP_ROUTE_OK) return none;
  const waypoints = Array.from(route.cells.subarray(0, route.count));
  return { port, cell, troops, reason, waypoints, etaSeconds: shipEtaSeconds(view.width, route.cells, route.count) };
}

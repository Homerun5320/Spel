// The ship rules that UI and AI may read (M13c-1): the LaunchShip check. Pure and read-only: everything takes a read-only window (`ShipSource`) and a `ShipProbe`, and returns numbers.
// The sim's own LaunchShip (src/sim/shipPhase.ts) calls `checkLaunchShip` below, the SAME function `validateLaunchShip` wraps, so there is one implementation (the pattern of
// `checkLaunchHeli` / `validateLaunchHeli`). The route search is src/sim/shipRoute.ts, called through the probe so that a page-side caller may cache it.
import { isPlayableClass } from './terrain';
import { PHASE_SPAWN } from './flow';
import { HELI_LIFT, HELI_UNLOAD, type HeliView } from './heliTable';
import {
  REJECT_DIPLO_TREATY_BOUND,
  REJECT_HELI_BEACHHEAD_FULL,
  REJECT_NONE,
  REJECT_PHASE,
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
} from './intents';
import { RELATION_WAR } from './diplomacyTable';
import { MILLI_GOLD_PER_GOLD, QT_PER_TROOP, SHIP_FLEET_MAX, SHIP_LAUNCH_GOLD, SHIP_MAX_TROOPS, SHIP_MIN_TROOPS } from './rules';
import { findPortRoute, portWaterCell, ShipRoute, SHIP_ROUTE_BAD_TARGET, SHIP_ROUTE_OK } from './shipRoute';
import { SHIP_LAND, SHIP_OFF, SHIP_SAIL, type ShipView } from './shipTable';
import { seatToOwner } from './state';
import { STRUCT_PORT, type StructureView } from './structureRules';
import type { SimView } from './view';

type Numbers = { readonly [index: number]: number };

/** What the ship rules read: the tick, the map layers, the structure table and the ship table (a SimView is one; so is the sim's own state through `StateShipSource`). */
export interface ShipSource {
  readonly tick: number;
  readonly width: number;
  readonly height: number;
  /** Terrain class per cell. */
  readonly terrainClass: Numbers;
  /** ownerId per cell. */
  readonly owner: Numbers;
  readonly structures: StructureView;
  readonly ships: ShipView;
}

/** What the LaunchShip check asks of the world beyond the tables. */
export interface ShipProbe {
  /** Whole troops the seat has (floor of the quarter troops / 4). */
  readonly troops: number;
  /** The seat's gold in milli-gold. */
  readonly goldMilli: number;
  /** True when the global beachhead table has no free row left once the landings already under way (helicopters and ships) have taken theirs. */
  beachheadFull(): boolean;
  /** True when the cell belongs to a nation the seat has a truce or an alliance with (a landing there is not allowed, like an Attack). */
  zoneBound(targetCell: number): boolean;
}

/** What a successful LaunchShip check found: the free slot of the ship and its route. */
export interface ShipLaunchPlan {
  ship: number;
  route: ShipRoute;
}

/** A fresh, empty plan to pass to `checkLaunchShip`. */
export function emptyShipPlan(): ShipLaunchPlan {
  return { ship: -1, route: new ShipRoute() };
}

/** Ships whose landing is still to come (sailing or unloading): each will want a beachhead row. */
export function shipLandingsPending(ships: ShipView): number {
  let n = 0;
  for (let id = 0; id < ships.capacity; id++) {
    const s = ships.state[id] as number;
    if (ships.owner[id] !== 0 && (s === SHIP_SAIL || s === SHIP_LAND)) n++;
  }
  return n;
}

/** Landings under way: helicopters between lift-off and the end of the unloading plus ships that sail or unload. Each will want a beachhead row. */
export function landingsPending(helis: HeliView, ships: ShipView): number {
  let n = shipLandingsPending(ships);
  for (let id = 0; id < helis.highWater; id++) {
    const s = helis.state[id] as number;
    if (helis.owner[id] !== 0 && s >= HELI_LIFT && s <= HELI_UNLOAD) n++;
  }
  return n;
}

/**
 * THE LaunchShip rules, in this order: the spawn phase (REJECT_PHASE), a live Port (REJECT_SHIP_NO_PORT), the owner (REJECT_SHIP_NOT_OWNER), the Port is finished
 * (REJECT_SHIP_PORT_BUILDING), no ship of the Port out (REJECT_SHIP_PORT_BUSY) or cooling down (REJECT_SHIP_COOLDOWN), the fleet cap (REJECT_SHIP_FLEET_CAP), the troops
 * (REJECT_SHIP_TROOPS_LOW, _HIGH, REJECT_SHIP_NO_TROOPS), the purse (REJECT_SHIP_NO_GOLD), a free slot (REJECT_SHIP_TABLE_FULL), a free beachhead row
 * (REJECT_HELI_BEACHHEAD_FULL), the target (REJECT_SHIP_BAD_TARGET: not playable land, own land, or no water within reach), the treaty (REJECT_DIPLO_TREATY_BOUND),
 * and the route (REJECT_SHIP_NO_ROUTE). On REJECT_NONE `plan` holds the slot and the route. The sim's `applyLaunchShip` and the public `validateLaunchShip` both call it.
 */
export function checkLaunchShip(src: ShipSource, phaseRefuses: boolean, seat: number, port: number, targetCell: number, troops: number, probe: ShipProbe, plan: ShipLaunchPlan): number {
  if (phaseRefuses) return REJECT_PHASE;
  const s = src.structures;
  if (!Number.isInteger(port) || port < 0 || port >= s.highWater || s.owner[port] === 0 || s.type[port] !== STRUCT_PORT) return REJECT_SHIP_NO_PORT;
  const ownerId = seatToOwner(seat);
  if (s.owner[port] !== ownerId) return REJECT_SHIP_NOT_OWNER;
  if (src.tick < (s.readyTick[port] as number)) return REJECT_SHIP_PORT_BUILDING;
  const ships = src.ships;
  for (let id = 0; id < ships.capacity; id++) {
    if (ships.owner[id] === 0 || ships.port[id] !== port) continue;
    return ships.state[id] === SHIP_OFF ? REJECT_SHIP_COOLDOWN : REJECT_SHIP_PORT_BUSY;
  }
  if (ships.countOf(ownerId) >= SHIP_FLEET_MAX) return REJECT_SHIP_FLEET_CAP;
  if (!Number.isInteger(troops) || troops < SHIP_MIN_TROOPS) return REJECT_SHIP_TROOPS_LOW;
  if (troops > SHIP_MAX_TROOPS) return REJECT_SHIP_TROOPS_HIGH;
  if (troops > probe.troops) return REJECT_SHIP_NO_TROOPS;
  if (probe.goldMilli < SHIP_LAUNCH_GOLD * MILLI_GOLD_PER_GOLD) return REJECT_SHIP_NO_GOLD;
  let slot = -1;
  for (let id = 0; id < ships.capacity; id++) {
    if (ships.owner[id] === 0) {
      slot = id;
      break;
    }
  }
  if (slot < 0) return REJECT_SHIP_TABLE_FULL;
  if (probe.beachheadFull()) return REJECT_HELI_BEACHHEAD_FULL; // before the departure: no troops are drawn
  if (!Number.isInteger(targetCell) || targetCell < 0 || targetCell >= src.width * src.height) return REJECT_SHIP_BAD_TARGET;
  if (!isPlayableClass(src.terrainClass[targetCell] as number) || src.owner[targetCell] === ownerId) return REJECT_SHIP_BAD_TARGET;
  if (probe.zoneBound(targetCell)) return REJECT_DIPLO_TREATY_BOUND;
  if (portWaterCell(src.width, src.height, src.terrainClass, s.cell[port] as number) < 0) return REJECT_SHIP_NO_ROUTE;
  const why = findPortRoute(src.width, src.height, src.terrainClass, s.cell[port] as number, targetCell, plan.route); // Fix-6A1: from every water neighbour of the Port
  if (why === SHIP_ROUTE_BAD_TARGET) return REJECT_SHIP_BAD_TARGET;
  if (why !== SHIP_ROUTE_OK) return REJECT_SHIP_NO_ROUTE;
  plan.ship = slot;
  return REJECT_NONE;
}

/**
 * Why `seat` could not send a ship from Port `port` to the coast cell `targetCell` with `troops` troops right now in the snapshot `view` (REJECT_NONE = it could).
 * The sim runs the same `checkLaunchShip`; the one difference a page-side view cannot show is none: the pending landings are counted from the helicopter and ship tables the view carries.
 */
export function validateLaunchShip(view: SimView, seat: number, port: number, targetCell: number, troops: number): number {
  const probe: ShipProbe = {
    troops: Math.floor((view.stats.troopsQt[seat] as number) / QT_PER_TROOP),
    goldMilli: view.stats.goldMilli[seat] as number,
    beachheadFull: () => view.beachheads.liveCount + landingsPending(view.helis, view.ships) >= view.beachheads.capacity,
    zoneBound: (cell) => {
      const o = view.owner[cell] as number;
      return o !== 0 && o !== seatToOwner(seat) && view.diplomacy.relation(seat, o - 1) !== RELATION_WAR;
    },
  };
  return checkLaunchShip(view, view.flow && view.phase === PHASE_SPAWN, seat, port, targetCell, troops, probe, emptyShipPlan());
}

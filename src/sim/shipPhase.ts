// The ships of M13c-1: LaunchShip and the per-tick flight.
//   Port -> SAIL (the route out) -> LAND (SHIP_LAND_TICKS, then the cells are taken) -> RETURN (the route back) -> OFF (docked, SHIP_COOLDOWN_TICKS) -> the row goes away.
// Integer arithmetic only: positions are Q8 sim cells (1 cell = 256), the direction of a leg comes from `isqrt`, x wraps over the date line, the speed is SHIP_CELLS_PER_TICK_Q.
//
// Troops: LaunchShip takes them (and SHIP_LAUNCH_GOLD gold) from the seat at once; they ride in `load`. The landing is `landTroops` of src/sim/heliLanding.ts, the very code of a
// helicopter landing (price, 1 to 9 cells, beachhead row, cut-off cluster, the rest as an Attack). A landing that is not made (own land) keeps the load aboard and it goes back to the seat
// when the ship docks. A failed or spent landing leaves no load.
// Decisions (DECISIONS M13c-1): a treaty with the owner of the landing cell that begins while the ship is out turns it back (SHIP_RTB_TREATY); the load is handed back at the home Port.
// A home Port that has been lost or deleted does not stop the voyage: the ship sails on and lands, but it does not return, it is scrapped (the load that is still aboard is lost).
// An eliminated owner's ships are scrapped (win.ts). Nothing shoots at ships in v1 (BACKLOG).
import { isqrt } from './detmath';
import { landTroops, landingBlockedBy } from './heliLanding';
import { cellCentreQ8, HELI_POS_ONE } from './heliTable';
import { REJECT_NONE } from './intents';
import {
  OUTBOX_SHIP_LANDED,
  OUTBOX_SHIP_LAUNCHED,
  OUTBOX_SHIP_RETURNED,
  OUTBOX_SHIP_RTB,
  OUTBOX_SHIP_SCRAPPED,
} from './outbox';
import { MILLI_GOLD_PER_GOLD, QT_PER_TROOP, SHIP_CAPACITY, SHIP_CELLS_PER_TICK_Q, SHIP_COOLDOWN_TICKS, SHIP_LAND_TICKS, SHIP_LAUNCH_GOLD, SHIP_ROUTE_CAPACITY } from './rules';
import { checkLaunchShip, emptyShipPlan, landingsPending, type ShipProbe, type ShipSource } from './shipRules';
import { SHIP_LAND, SHIP_OFF, SHIP_RETURN, SHIP_RTB_MISSION, SHIP_RTB_TREATY, SHIP_SAIL, SHIP_SCRAP_ELIMINATED, SHIP_SCRAP_NO_PORT } from './shipTable';
import { seatToOwner, type GameState } from './state';
import { STRUCT_PORT } from './structureRules';
import { spawnPhaseRefuses } from './structures';
import { atWar } from './diplomacy';

/** The sim's own state as the read-only source of the ship rules. */
function sourceOf(state: GameState): ShipSource {
  return { tick: state.tick, width: state.width, height: state.height, terrainClass: state.terrain, owner: state.owner, structures: state.structures, ships: state.ships };
}

function probeOf(state: GameState, seat: number): ShipProbe {
  const ownerId = seatToOwner(seat);
  return {
    troops: Math.floor((state.troops[ownerId] as number) / QT_PER_TROOP),
    goldMilli: state.gold[ownerId] as number,
    beachheadFull: () => state.beachheads.liveCount + landingsPending(state.helis, state.ships) >= state.beachheads.capacity,
    zoneBound: (cell) => {
      const o = state.owner[cell] as number;
      return o !== 0 && o !== ownerId && !atWar(state, ownerId, o);
    },
  };
}

const PLAN = emptyShipPlan();

/** Applies a LaunchShip: the rules (checkLaunchShip), then the troops and the gold are taken and the ship sails along the planned route. */
export function applyLaunchShip(state: GameState, seat: number, port: number, targetCell: number, troops: number): number {
  const why = checkLaunchShip(sourceOf(state), spawnPhaseRefuses(state), seat, port, targetCell, troops, probeOf(state, seat), PLAN);
  if (why !== REJECT_NONE) return why;
  const t = state.ships;
  const ownerId = seatToOwner(seat);
  const id = PLAN.ship;
  const r = PLAN.route;
  state.troops[ownerId] = (state.troops[ownerId] as number) - troops * QT_PER_TROOP;
  state.gold[ownerId] = (state.gold[ownerId] as number) - SHIP_LAUNCH_GOLD * MILLI_GOLD_PER_GOLD;
  t.add(id, ownerId, port, state.structures.cell[port] as number, state.tick, troops, targetCell + 1);
  const w = state.width;
  const base = id * SHIP_ROUTE_CAPACITY;
  for (let k = 0; k < r.count; k++) t.route[base + k] = r.cells[k] as number;
  t.routeLen[id] = r.count;
  t.routeIdx[id] = 1; // waypoint 0 is the water cell the ship leaves from
  const c = r.cells[0] as number;
  const cx = c % w;
  t.x[id] = cellCentreQ8(cx);
  t.y[id] = cellCentreQ8((c - cx) / w);
  state.outbox.push(OUTBOX_SHIP_LAUNCHED, state.tick, id, targetCell);
  return REJECT_NONE;
}

/** Is the home Port of ship `id` still there: a finished Port of the ship's owner on the cell it left from? */
function portAlive(state: GameState, id: number): boolean {
  const t = state.ships;
  const st = state.structures;
  const p = t.port[id] as number;
  return p < st.highWater && st.owner[p] === t.owner[id] && st.type[p] === STRUCT_PORT && st.cell[p] === t.portCell[id] && state.tick >= (st.readyTick[p] as number);
}

function scrap(state: GameState, id: number, cause: number): void {
  state.outbox.push(OUTBOX_SHIP_SCRAPPED, state.tick, id, cause);
  state.ships.remove(id);
}

/** Scraps EVERY ship of an eliminated owner (the load is lost). Called by `winPhase` in the tick of the elimination. */
export function scrapOwnerShips(state: GameState, ownerId: number): void {
  const t = state.ships;
  if (t.liveCount === 0) return;
  for (let id = 0; id < SHIP_CAPACITY; id++) if (t.owner[id] === ownerId) scrap(state, id, SHIP_SCRAP_ELIMINATED);
}

/** Turns ship `id` for its home Port (`reason`: SHIP_RTB_TREATY or SHIP_RTB_MISSION); with no Port left to dock in it is scrapped. */
function startReturn(state: GameState, id: number, reason: number): void {
  const t = state.ships;
  if (!portAlive(state, id)) {
    scrap(state, id, SHIP_SCRAP_NO_PORT);
    return;
  }
  const len = t.routeLen[id] as number;
  const idx = t.routeIdx[id] as number;
  t.state[id] = SHIP_RETURN;
  t.stateTick[id] = state.tick;
  t.target[id] = 0;
  t.routeIdx[id] = idx < len - 1 ? idx : len - 1;
  state.outbox.push(OUTBOX_SHIP_RTB, state.tick, id, reason);
}

/**
 * Moves ship `id` along its route by one tick's step (corners carry the rest of the step on to the next leg): forward to waypoint `routeIdx` and on while `forward`, else back to
 * waypoint `routeIdx - 1` and down to 0.
 */
function advance(state: GameState, id: number, forward: boolean): void {
  const t = state.ships;
  const w = state.width;
  const w256 = w * HELI_POS_ONE;
  const half = w256 >> 1;
  const base = id * SHIP_ROUTE_CAPACITY;
  let remaining = SHIP_CELLS_PER_TICK_Q;
  let x = t.x[id] as number;
  let y = t.y[id] as number;
  let idx = t.routeIdx[id] as number;
  const len = t.routeLen[id] as number;
  while (remaining > 0 && (forward ? idx < len : idx > 0)) {
    const wp = t.route[base + (forward ? idx : idx - 1)] as number;
    const wx = wp % w;
    const tx = cellCentreQ8(wx);
    const ty = cellCentreQ8((wp - wx) / w);
    let dx = tx - x;
    if (dx > half) dx -= w256;
    else if (dx < -half) dx += w256;
    const dy = ty - y;
    const dist = isqrt(dx * dx + dy * dy);
    if (dist <= remaining) {
      x = tx;
      y = ty;
      remaining -= dist;
      idx += forward ? 1 : -1;
    } else {
      x += Math.trunc((dx * remaining) / dist);
      y += Math.trunc((dy * remaining) / dist);
      if (x >= w256) x -= w256;
      else if (x < 0) x += w256;
      remaining = 0;
    }
  }
  t.x[id] = x;
  t.y[id] = y;
  t.routeIdx[id] = idx;
}

/** Docks ship `id` in its Port: the load that is still aboard goes back to the seat, the Port cools down. */
function dock(state: GameState, id: number): void {
  const t = state.ships;
  const owner = t.owner[id] as number;
  state.troops[owner] = (state.troops[owner] as number) + (t.load[id] as number) * QT_PER_TROOP;
  t.load[id] = 0;
  t.state[id] = SHIP_OFF;
  t.stateTick[id] = state.tick;
  t.routeIdx[id] = 0;
  state.outbox.push(OUTBOX_SHIP_RETURNED, state.tick, id, t.port[id] as number);
}

/** One tick of every ship. Called after `heliPhase`. O(SHIP_CAPACITY), nothing at all without ships. */
export function shipPhase(state: GameState): void {
  const t = state.ships;
  if (t.liveCount === 0) return;
  const tick = state.tick;
  for (let id = 0; id < SHIP_CAPACITY; id++) {
    const owner = t.owner[id] as number;
    if (owner === 0) continue;
    const s = t.state[id] as number;
    if (s === SHIP_OFF) {
      if (tick - (t.stateTick[id] as number) >= SHIP_COOLDOWN_TICKS) t.remove(id);
      continue;
    }
    if (s === SHIP_RETURN) {
      if ((t.routeIdx[id] as number) === 0) {
        if (portAlive(state, id)) dock(state, id);
        else scrap(state, id, SHIP_SCRAP_NO_PORT);
        continue;
      }
      advance(state, id, false);
      continue;
    }
    // SAIL and LAND: a treaty with the owner of the landing cell turns the ship back with its load.
    const lz = (t.target[id] as number) - 1;
    const lzOwner = state.owner[lz] as number;
    if (lzOwner !== 0 && lzOwner !== owner && landingBlockedBy(state, owner, lzOwner)) {
      startReturn(state, id, SHIP_RTB_TREATY);
      continue;
    }
    if (s === SHIP_SAIL) {
      advance(state, id, true);
      if ((t.routeIdx[id] as number) >= (t.routeLen[id] as number)) {
        t.state[id] = SHIP_LAND;
        t.stateTick[id] = tick;
      }
      continue;
    }
    if (s === SHIP_LAND && tick - (t.stateTick[id] as number) >= SHIP_LAND_TICKS) {
      t.target[id] = 0;
      const kept = landTroops(state, owner, lz, t.load[id] as number, OUTBOX_SHIP_LANDED, id);
      if (!kept) t.load[id] = 0;
      startReturn(state, id, SHIP_RTB_MISSION);
    }
  }
}

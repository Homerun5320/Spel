// The flight of a helicopter (M12a-2): LaunchHeli, RecallHeli and the per-tick state machine
//   Pad -> LIFT (HELI_TAKEOFF_TICKS) -> CRUISE -> APPROACH (last leg) -> HOVER (HELI_HOVER_TICKS) -> UNLOAD (HELI_UNLOAD_TICKS; the landing, M12a-3) -> RETURN -> Pad
// plus DOWNED (fuel). Everything is integer arithmetic: positions are Q8 sim cells (1 cell = 256), the direction of a leg comes from `isqrt`, x wraps
// over the date line, the speed per tick is the mode table of rules.ts rounded to Q8, the altitude is whole game metres.
//
// Altitude (the rule M12b's visibility questions read): alt = max(GROUND + AGL of the mode, OCCLUDER + HELI_CLEARANCE_GAME_M) of the cell flown over,
// where GROUND = EXAG * mean elevation and OCCLUDER = the effective occluder height of the LOS maths (both from `losOf(state).terrain`). The floor
// ("safety floor") always wins. Between the floors the altitude follows the terrain with a look-ahead of HELI_LOOKAHEAD_CELLS cells along the heading and
// changes by at most HELI_VERT_GM_PER_CELL per cell flown.
//
// Troops: LaunchHeli takes them from the seat at once; they ride in `load` and go back to the seat when the helicopter sets down on a Factory pad (or is
// scrapped). A helicopter that goes down loses its load. The landing (src/sim/heliLanding.ts) turns the load into cells, an Attack or nothing (a failed
// landing loses it); it creates no troops.
import { hasOccluders, losOf, planRouteOf, scoreLzOf } from './access';
import { checkLaunchHeli, checkRecallHeli, emptyLaunchPlan, type LaunchProbe } from './heliRules';
import { HELI_APPROACH, HELI_CRUISE, HELI_DOWNED, HELI_HOVER, HELI_LIFT, HELI_PAD, HELI_POS_ONE, HELI_RETURN, HELI_STATE_MAX, HELI_UNLOAD, cellCentreQ8 } from './heliTable';
import { performLanding } from './heliLanding';
import { isqrt } from './detmath';
import { REJECT_NONE } from './intents';
import {
  OUTBOX_HELI_DOWNED,
  OUTBOX_HELI_HOME,
  OUTBOX_HELI_LAUNCHED,
  OUTBOX_HELI_RTB,
  OUTBOX_HELI_SCRAPPED,
} from './outbox';
import {
  AIR_MODE_AGL_M,
  AIR_MODE_SPEED_MILLICELLS_S,
  HELI_APPROACH_CELLS,
  HELI_CLEARANCE_GAME_M,
  HELI_DOWNED_TICKS,
  HELI_FUEL_MAX_Q8,
  HELI_HOVER_TICKS,
  HELI_LOOKAHEAD_CELLS,
  HELI_ROUTE_CAPACITY,
  HELI_TAKEOFF_TICKS,
  HELI_UNLOAD_TICKS,
  HELI_VERT_GM_PER_CELL,
  QT_PER_TROOP,
  TICK_HZ,
} from './rules';
import { ownerToSeat, seatToOwner, type GameState } from './state';
import { STRUCT_FACTORY } from './structureRules';
import { spawnPhaseRefuses } from './structures';

/** Q8 cells flown per tick in each flight mode: the mode's speed in thousandths of a cell per second, rounded to the nearest Q8 step. */
const STEP_Q8 = AIR_MODE_SPEED_MILLICELLS_S.map((v) => Math.round((v * HELI_POS_ONE) / (1000 * TICK_HZ)));

/** The Q8 step per tick of flight mode `mode` (what a test measures the speed cap against). */
export function heliStepQ8(mode: number): number {
  return STEP_Q8[mode] as number;
}

/** The sim's answers to the two navigation questions of LaunchHeli, from the state's own Los / Nav. */
function probeOf(state: GameState, seat: number): LaunchProbe {
  return {
    troops: Math.floor((state.troops[seatToOwner(seat)] as number) / QT_PER_TROOP),
    canNavigate: hasOccluders(state),
    score: (cell, from, mode) => scoreLzOf(state, seat, cell, from, mode),
    route: (from, to, mode) => planRouteOf(state, seat, from, to, mode),
  };
}

/** Applies a LaunchHeli: the rules (checkLaunchHeli), then the troops are taken and the helicopter lifts off along the planned route. */
export function applyLaunchHeli(state: GameState, seat: number, factory: number, lzCell: number, troops: number, altMode: number): number {
  const plan = emptyLaunchPlan();
  const why = checkLaunchHeli(state, spawnPhaseRefuses(state), seat, factory, lzCell, troops, altMode, probeOf(state, seat), plan);
  if (why !== REJECT_NONE || plan.route === null) return why;
  const t = state.helis;
  const id = plan.heli;
  const owner = seatToOwner(seat);
  const wps = plan.route.waypoints;
  state.troops[owner] = (state.troops[owner] as number) - troops * QT_PER_TROOP;
  t.state[id] = HELI_LIFT;
  t.stateTick[id] = state.tick;
  t.mode[id] = altMode;
  t.target[id] = lzCell + 1;
  t.load[id] = troops;
  t.alt[id] = 0;
  t.fuel[id] = HELI_FUEL_MAX_Q8;
  t.routeLen[id] = wps.length;
  t.routeIdx[id] = 1; // waypoint 0 is the Factory the helicopter stands on
  const base = id * HELI_ROUTE_CAPACITY;
  for (let k = 0; k < wps.length; k++) t.route[base + k] = wps[k] as number;
  state.outbox.push(OUTBOX_HELI_LAUNCHED, state.tick, id, lzCell);
  return REJECT_NONE;
}

/** Applies a RecallHeli: the rules (checkRecallHeli), then the helicopter turns for the nearest own Factory. */
export function applyRecallHeli(state: GameState, seat: number, heli: number): number {
  const why = checkRecallHeli(state, seat, heli);
  if (why !== REJECT_NONE) return why;
  startReturn(state, heli, 1);
  return REJECT_NONE;
}

/** Squared distance in Q8 cells between two Q8 points, x wrapping over the date line. */
function dist2Q8(w256: number, ax: number, ay: number, bx: number, by: number): number {
  let dx = Math.abs(ax - bx);
  if (dx > w256 - dx) dx = w256 - dx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** The finished Factory of `ownerId` nearest to the Q8 point (x, y) (ties: the lowest structure id), or -1. */
function nearestFactory(state: GameState, ownerId: number, x: number, y: number): number {
  const st = state.structures;
  const w = state.width;
  const w256 = w * HELI_POS_ONE;
  let best = -1;
  let bestD = Infinity;
  for (let f = 0; f < st.highWater; f++) {
    if (st.owner[f] !== ownerId || st.type[f] !== STRUCT_FACTORY || state.tick < (st.readyTick[f] as number)) continue;
    const c = st.cell[f] as number;
    const cx = c % w;
    const d = dist2Q8(w256, x, y, cellCentreQ8(cx), cellCentreQ8((c - cx) / w));
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/** Removes a helicopter that is not shot down (scrapped): its load goes back to the seat. */
function scrap(state: GameState, id: number): void {
  const t = state.helis;
  const owner = t.owner[id] as number;
  state.troops[owner] = (state.troops[owner] as number) + (t.load[id] as number) * QT_PER_TROOP;
  state.outbox.push(OUTBOX_HELI_SCRAPPED, state.tick, id, t.state[id] as number);
  t.remove(id);
}

/** Turns helicopter `id` for the nearest own finished Factory (`recalled` 1 = a RecallHeli, 0 = the mission is over); with none left it is scrapped. */
function startReturn(state: GameState, id: number, recalled: number): void {
  const t = state.helis;
  const owner = t.owner[id] as number;
  const w = state.width;
  const f = nearestFactory(state, owner, t.x[id] as number, t.y[id] as number);
  if (f < 0) {
    scrap(state, id);
    return;
  }
  const fcell = state.structures.cell[f] as number;
  const cur = ((t.y[id] as number) >> 8) * w + ((t.x[id] as number) >> 8);
  const base = id * HELI_ROUTE_CAPACITY;
  t.state[id] = HELI_RETURN;
  t.stateTick[id] = state.tick;
  t.target[id] = 0;
  t.route.fill(0, base, base + HELI_ROUTE_CAPACITY);
  if (cur === fcell) {
    t.route[base] = fcell;
    t.routeLen[id] = 1;
    t.routeIdx[id] = 1; // already there: the next flight pass sets it down
  } else {
    const r = hasOccluders(state) ? planRouteOf(state, ownerToSeat(owner), cur, fcell, t.mode[id] === 1 ? 1 : 0) : null;
    if (r !== null && r.ok && r.waypoints.length >= 2 && r.waypoints.length <= HELI_ROUTE_CAPACITY) {
      for (let k = 0; k < r.waypoints.length; k++) t.route[base + k] = r.waypoints[k] as number;
      t.routeLen[id] = r.waypoints.length;
      t.routeIdx[id] = 1;
    } else {
      // No planned way (the helicopter hangs in a cell the nav grid closes): straight home. The altitude floor still clears the ground.
      t.route[base] = fcell;
      t.routeLen[id] = 1;
      t.routeIdx[id] = 0;
    }
  }
  state.outbox.push(OUTBOX_HELI_RTB, state.tick, id, recalled);
}

/** A helicopter that ran dry or was shot down: stays in the table HELI_DOWNED_TICKS, its load is lost. */
function startDowned(state: GameState, id: number, cause: number): void {
  const t = state.helis;
  t.state[id] = HELI_DOWNED;
  t.stateTick[id] = state.tick;
  t.load[id] = 0;
  t.target[id] = 0;
  state.outbox.push(OUTBOX_HELI_DOWNED, state.tick, id, cause);
}

/** The pad landing: the helicopter stands at Factory `f`, refuelled, empty; its load goes back to the seat. */
function setDown(state: GameState, id: number, f: number): void {
  const t = state.helis;
  const w = state.width;
  const owner = t.owner[id] as number;
  const c = state.structures.cell[f] as number;
  const cx = c % w;
  state.troops[owner] = (state.troops[owner] as number) + (t.load[id] as number) * QT_PER_TROOP;
  t.state[id] = HELI_PAD;
  t.stateTick[id] = state.tick;
  t.factory[id] = f;
  t.x[id] = cellCentreQ8(cx);
  t.y[id] = cellCentreQ8((c - cx) / w);
  t.alt[id] = 0;
  t.fuel[id] = HELI_FUEL_MAX_Q8;
  t.load[id] = 0;
  t.target[id] = 0;
  t.routeLen[id] = 0;
  t.routeIdx[id] = 0;
  t.route.fill(0, id * HELI_ROUTE_CAPACITY, (id + 1) * HELI_ROUTE_CAPACITY);
  state.outbox.push(OUTBOX_HELI_HOME, state.tick, id, f);
}

/** The altitude floor of a Q8 point in game metres: max(ground + AGL, occluder + clearance). The cell is clamped in y and wrapped in x. */
function floorAt(state: GameState, x: number, y: number, mode: number): number {
  const terr = losOf(state).terrain;
  const w = state.width;
  const w256 = w * HELI_POS_ONE;
  const xx = ((x % w256) + w256) % w256;
  let yy = y;
  const maxY = state.height * HELI_POS_ONE - 1;
  if (yy < 0) yy = 0;
  else if (yy > maxY) yy = maxY;
  const cell = (yy >> 8) * w + (xx >> 8);
  const a = (terr.groundGm[cell] as number) + (AIR_MODE_AGL_M[mode] as number);
  const b = (terr.occGm[cell] as number) + HELI_CLEARANCE_GAME_M;
  return a > b ? a : b;
}

/**
 * Sets the altitude of helicopter `id` for this tick. `dx`, `dy` (Q8) point at the next waypoint (both 0 = no heading, hovering), `dist` is their length,
 * `moved` the Q8 distance flown this tick. The target is the highest floor along the next HELI_LOOKAHEAD_CELLS cells; the altitude goes there by at most
 * HELI_VERT_GM_PER_CELL per cell flown, and never below the floor of the cell it is over.
 */
function setAltitude(state: GameState, id: number, dx: number, dy: number, dist: number, moved: number): void {
  const t = state.helis;
  const mode = t.mode[id] as number;
  const x = t.x[id] as number;
  const y = t.y[id] as number;
  const here = floorAt(state, x, y, mode);
  let want = here;
  if (dist > 0) {
    for (let k = 1; k <= HELI_LOOKAHEAD_CELLS; k++) {
      const off = k * HELI_POS_ONE;
      const f = floorAt(state, x + Math.trunc((dx * off) / dist), y + Math.trunc((dy * off) / dist), mode);
      if (f > want) want = f;
    }
  }
  const maxDelta = Math.ceil((HELI_VERT_GM_PER_CELL * moved) / HELI_POS_ONE);
  let a = t.alt[id] as number;
  if (want > a) a = Math.min(want, a + maxDelta);
  else a = Math.max(want, a - maxDelta);
  t.alt[id] = a > here ? a : here;
}

/**
 * Moves helicopter `id` along its route by one tick's step (corners carry the rest of the step on to the next leg), spending fuel by the distance flown.
 * Returns the Q8 distance moved; sets `hx`/`hy` of the last heading in `HEADING` for the altitude look-ahead.
 */
const HEADING = new Int32Array(3); // dx, dy, dist of the leg the helicopter was on at the start of the tick
function advance(state: GameState, id: number): number {
  const t = state.helis;
  const w = state.width;
  const w256 = w * HELI_POS_ONE;
  const half = w256 >> 1;
  const base = id * HELI_ROUTE_CAPACITY;
  let remaining = STEP_Q8[t.mode[id] as number] as number;
  let moved = 0;
  let first = true;
  HEADING[0] = 0;
  HEADING[1] = 0;
  HEADING[2] = 0;
  let x = t.x[id] as number;
  let y = t.y[id] as number;
  let idx = t.routeIdx[id] as number;
  const len = t.routeLen[id] as number;
  while (remaining > 0 && idx < len) {
    const wp = t.route[base + idx] as number;
    const wx = wp % w;
    const tx = cellCentreQ8(wx);
    const ty = cellCentreQ8((wp - wx) / w);
    let dx = tx - x;
    if (dx > half) dx -= w256;
    else if (dx < -half) dx += w256;
    const dy = ty - y;
    const dist = isqrt(dx * dx + dy * dy);
    if (first) {
      HEADING[0] = dx;
      HEADING[1] = dy;
      HEADING[2] = dist;
      first = false;
    }
    if (dist <= remaining) {
      x = tx;
      y = ty;
      remaining -= dist;
      moved += dist;
      idx++;
    } else {
      x += Math.trunc((dx * remaining) / dist);
      y += Math.trunc((dy * remaining) / dist);
      if (x >= w256) x -= w256;
      else if (x < 0) x += w256;
      moved += remaining;
      remaining = 0;
    }
  }
  t.x[id] = x;
  t.y[id] = y;
  t.routeIdx[id] = idx;
  const fuel = t.fuel[id] as number;
  t.fuel[id] = moved >= fuel ? 0 : fuel - moved;
  return moved;
}

/** One tick of the flight of every helicopter that is not queued or parked. Called by `heliPhase`. */
export function flyHelis(state: GameState): void {
  const t = state.helis;
  const tick = state.tick;
  for (let id = 0; id < t.highWater; id++) {
    if (t.owner[id] === 0) continue;
    let s = t.state[id] as number;
    if (s < HELI_LIFT || s > HELI_STATE_MAX) continue;
    if (s === HELI_DOWNED) {
      if (tick - (t.stateTick[id] as number) >= HELI_DOWNED_TICKS) t.remove(id);
      continue;
    }
    if (s === HELI_LIFT) {
      const k = tick - (t.stateTick[id] as number);
      if (k < HELI_TAKEOFF_TICKS) {
        const f = floorAt(state, t.x[id] as number, t.y[id] as number, t.mode[id] as number);
        t.alt[id] = Math.floor((f * (k + 1)) / HELI_TAKEOFF_TICKS);
        continue;
      }
      t.state[id] = HELI_CRUISE;
      t.stateTick[id] = tick;
      s = HELI_CRUISE;
    }
    if (s === HELI_HOVER) {
      if (tick - (t.stateTick[id] as number) >= HELI_HOVER_TICKS) {
        t.state[id] = HELI_UNLOAD; // set down and unload (the cells are taken when the ticks are over)
        t.stateTick[id] = tick;
        setAltitude(state, id, 0, 0, 0, 0);
        continue;
      }
      setAltitude(state, id, 0, 0, 0, 0);
      continue;
    }
    if (s === HELI_UNLOAD) {
      const k = tick - (t.stateTick[id] as number);
      if (k >= HELI_UNLOAD_TICKS) {
        performLanding(state, id);
        startReturn(state, id, 0);
        continue;
      }
      // Settling: the altitude goes to the ground of the zone in the ticks that are left (exact: it is there at the last one).
      const g = losOf(state).terrain.groundGm[(t.target[id] as number) - 1] as number;
      const a = t.alt[id] as number;
      if (k > 0 && a > g) t.alt[id] = a - Math.floor((a - g) / (HELI_UNLOAD_TICKS - k));
      continue;
    }
    // CRUISE, APPROACH or RETURN: fly the route.
    if (s === HELI_CRUISE && (t.routeIdx[id] as number) >= (t.routeLen[id] as number) - 1) {
      const wp = t.route[id * HELI_ROUTE_CAPACITY + (t.routeLen[id] as number) - 1] as number;
      const wx = wp % state.width;
      const d2 = dist2Q8(state.width * HELI_POS_ONE, t.x[id] as number, t.y[id] as number, cellCentreQ8(wx), cellCentreQ8((wp - wx) / state.width));
      if (d2 <= HELI_APPROACH_CELLS * HELI_APPROACH_CELLS * HELI_POS_ONE * HELI_POS_ONE) {
        t.state[id] = HELI_APPROACH;
        t.stateTick[id] = tick;
        s = HELI_APPROACH;
      }
    }
    const moved = advance(state, id);
    const arrived = (t.routeIdx[id] as number) >= (t.routeLen[id] as number);
    if (s === HELI_RETURN && arrived) {
      const w = state.width;
      const cell = ((t.y[id] as number) >> 8) * w + ((t.x[id] as number) >> 8);
      const st = state.structures;
      let home = -1;
      for (let f = 0; f < st.highWater; f++) {
        if (st.owner[f] === t.owner[id] && st.type[f] === STRUCT_FACTORY && st.cell[f] === cell && tick >= (st.readyTick[f] as number)) {
          home = f;
          break;
        }
      }
      if (home >= 0) setDown(state, id, home);
      else startReturn(state, id, 0); // its Factory is gone: the nearest remaining one, or scrapped
      continue;
    }
    if (t.fuel[id] === 0) {
      startDowned(state, id, 1);
      continue;
    }
    setAltitude(state, id, HEADING[0] as number, HEADING[1] as number, HEADING[2] as number, moved);
    if (arrived) {
      // Mission leg done: hover over the landing zone.
      t.state[id] = HELI_HOVER;
      t.stateTick[id] = tick;
    }
  }
}

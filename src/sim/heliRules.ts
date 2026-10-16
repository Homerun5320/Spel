// The helicopter rules that UI and AI may read (M12a-1): the fleet cap and count and the ProduceHeli check. Pure and read-only: everything takes a
// read-only window (`HeliSource`) and returns numbers. The sim's own ProduceHeli (src/sim/heliPhase.ts) calls `checkProduceHeli` below, the SAME
// function `validateProduceHeli` wraps, so there is one implementation (the pattern of `checkBuild` / `validateBuild`).
import { HELI_FLEET_BASE, HELI_FLEET_MAX, HELI_MAX_TROOPS, HELI_PRICE_GOLD, HELI_ROUTE_CAPACITY, MILLI_GOLD_PER_GOLD, QT_PER_TROOP } from './rules';
import {
  REJECT_HELI_BAD_TROOPS,
  REJECT_HELI_FACTORY_BUILDING,
  REJECT_HELI_BEACHHEAD_FULL,
  REJECT_HELI_FLEET_CAP,
  REJECT_HELI_TABLE_FULL,
  REJECT_HELI_NO_FACTORY,
  REJECT_HELI_NO_GOLD,
  REJECT_HELI_NO_PAD,
  REJECT_HELI_NO_ROUTE,
  REJECT_HELI_NOT_FLYING,
  REJECT_HELI_NOT_OWNER,
  REJECT_HELI_QUEUE_BUSY,
  REJECT_NONE,
  REJECT_PHASE, REJECT_DIPLO_TREATY_BOUND } from './intents';
import { PHASE_SPAWN } from './flow';
import { HELI_APPROACH, HELI_BUILDING, HELI_CRUISE, HELI_HOVER, HELI_LIFT, HELI_PAD, type HeliView } from './heliTable';
import type { AltMode } from './los/cache';


import { RELATION_WAR } from './diplomacyTable';
import { seatToOwner } from './state';
import { STRUCT_FACTORY, type StructureView } from './structureRules';
import type { Nav } from './nav/grid';
import { scoreLz, type LzResult } from './nav/lz';
import { planRoute, type RouteOk, type RouteResult } from './nav/route';
import { TECH_FX_FLEET, TECH_FX_LOAD, techFxOfMask } from './techTable';
import type { TechMaskSource } from './techRules';
import type { SimView } from './view';

/** What the helicopter rules read: the tick, the structure table and the helicopter table (a SimView is one; so is the sim's own state through `StateHeliSource`). */
export interface HeliSource {
  readonly tick: number;
  readonly structures: StructureView;
  readonly helis: HeliView;
  /** The researched techs (M18d-1): a MatchState or a MatchView; absent = nothing researched. */
  readonly match?: TechMaskSource;
}

/** What the researched techs of `seat` give on an effect channel (0 when the source carries no match). */
function techFxOf(src: HeliSource, seat: number, channel: number): number {
  return src.match === undefined ? 0 : techFxOfMask(src.match.techMaskOfSeat(seat), channel);
}

/** The most troops one helicopter may carry for `seat`: HELI_MAX_TROOPS + the AIR techs' load percent. */
export function heliMaxTroopsOf(src: HeliSource, seat: number): number {
  const pct = techFxOf(src, seat, TECH_FX_LOAD);
  return pct === 0 ? HELI_MAX_TROOPS : HELI_MAX_TROOPS + Math.floor((HELI_MAX_TROOPS * pct) / 100);
}

/** Price of a helicopter in milli-gold. */
export const HELI_PRICE_MILLI = HELI_PRICE_GOLD * MILLI_GOLD_PER_GOLD;

/** The fleet cap of a seat: HELI_FLEET_BASE + the sum of the levels of its FINISHED Factories, at most HELI_FLEET_MAX. */
export function fleetCapOf(src: HeliSource, seat: number): number {
  const s = src.structures;
  const ownerId = seatToOwner(seat);
  const bonus = techFxOf(src, seat, TECH_FX_FLEET);
  let sum = HELI_FLEET_BASE;
  for (let i = 0; i < s.highWater; i++) {
    if (s.owner[i] === ownerId && s.type[i] === STRUCT_FACTORY && src.tick >= (s.readyTick[i] as number)) {
      sum += s.level[i] as number;
      if (sum >= HELI_FLEET_MAX) return HELI_FLEET_MAX + bonus;
    }
  }
  return sum + bonus;
}

/** Helicopters a seat has, also those under production. */
export function fleetCountOf(src: HeliSource, seat: number): number {
  return src.helis.countOf(seatToOwner(seat));
}

/**
 * THE ProduceHeli rules. Returns REJECT_NONE or the reason, checking in this order: the spawn phase (`phaseRefuses`, REJECT_PHASE), a live
 * Factory (REJECT_HELI_NO_FACTORY), the owner (REJECT_HELI_NOT_OWNER), the Factory is finished, nothing under production in it, the fleet cap
 * (a helicopter under production counts), the purse. `goldMilli` is the seat's gold.
 */
export function checkProduceHeli(src: HeliSource, goldMilli: number, phaseRefuses: boolean, seat: number, factory: number): number {
  if (phaseRefuses) return REJECT_PHASE;
  const s = src.structures;
  if (!Number.isInteger(factory) || factory < 0 || factory >= s.highWater || s.owner[factory] === 0 || s.type[factory] !== STRUCT_FACTORY) return REJECT_HELI_NO_FACTORY;
  if (s.owner[factory] !== seatToOwner(seat)) return REJECT_HELI_NOT_OWNER;
  if (src.tick < (s.readyTick[factory] as number)) return REJECT_HELI_FACTORY_BUILDING;
  const h = src.helis;
  for (let id = 0; id < h.highWater; id++) {
    if (h.owner[id] !== 0 && h.state[id] === HELI_BUILDING && h.factory[id] === factory) return REJECT_HELI_QUEUE_BUSY;
  }
  if (fleetCountOf(src, seat) >= fleetCapOf(src, seat)) return REJECT_HELI_FLEET_CAP;
  if (h.liveCount >= h.capacity) return REJECT_HELI_TABLE_FULL; // the table is global (all seats), the cap is per seat
  if (goldMilli < HELI_PRICE_MILLI) return REJECT_HELI_NO_GOLD;
  return REJECT_NONE;
}

/** Why `seat` could not order a helicopter in Factory `factory` right now in the snapshot `view` (REJECT_NONE = it could). The sim runs the same `checkProduceHeli`. */
export function validateProduceHeli(view: SimView, seat: number, factory: number): number {
  return checkProduceHeli(view, view.stats.goldMilli[seat] as number, view.flow && view.phase === PHASE_SPAWN, seat, factory);
}


/** What the LaunchHeli check asks of the world beyond the tables: the two navigation questions (`scoreLz`, `planRoute`) and the seat's troops. The sim answers them from its own Los / Nav (src/sim/access.ts), the UI from a Nav it built on a snapshot. */
export interface LaunchProbe {
  /** Whole troops the seat has (floor of the quarter troops / 4). */
  readonly troops: number;
  /** False when the world has no occluder layer (no Los / Nav can be built): the launch is refused as NO_ROUTE instead of throwing. */
  readonly canNavigate: boolean;
  score(lzCell: number, from: number, mode: AltMode): LzResult;
  route(from: number, to: number, mode: AltMode): RouteResult;
  /** M18c-1 integration: true when the zone cell belongs to a nation the seat has a truce or an alliance with (a landing there is not allowed, like an Attack). */
  zoneBound(lzCell: number): boolean;
  /** Fix-4A1: true when the global beachhead table has no free row (a landing would keep its land for ever). The sim reads its table; the page-side view has no table yet and answers false (the sim still refuses). */
  beachheadFull(): boolean;
}

/** What a successful LaunchHeli check found: the helicopter that goes and its planned route. */
export interface LaunchPlan {
  heli: number;
  route: RouteOk | null;
}

/** A fresh, empty plan to pass to `checkLaunchHeli`. */
export function emptyLaunchPlan(): LaunchPlan {
  return { heli: -1, route: null };
}

/** The lowest-id helicopter parked on the pad of Factory `factory`, or -1. */
export function padHeliAt(h: HeliView, factory: number): number {
  for (let id = 0; id < h.highWater; id++) if (h.owner[id] !== 0 && h.state[id] === HELI_PAD && h.factory[id] === factory) return id;
  return -1;
}

/**
 * THE LaunchHeli rules, in this order: the spawn phase (REJECT_PHASE), a live Factory (REJECT_HELI_NO_FACTORY), the owner (REJECT_HELI_NOT_OWNER), a
 * helicopter on the pad (REJECT_HELI_NO_PAD), the troops 1..HELI_MAX_TROOPS and within the purse (REJECT_HELI_BAD_TROOPS), the landing zone (the
 * `scoreLz` reason 65..72, the same function the UI calls), the route (REJECT_HELI_NO_ROUTE: none, shorter than two waypoints, longer than the
 * route buffer, or no occluder layer). On REJECT_NONE `plan` holds the helicopter and the route. The sim's `applyLaunchHeli` and the public
 * `validateLaunchHeli` both call it.
 */
export function checkLaunchHeli(src: HeliSource, phaseRefuses: boolean, seat: number, factory: number, lzCell: number, troops: number, altMode: number, probe: LaunchProbe, plan: LaunchPlan): number {
  if (phaseRefuses) return REJECT_PHASE;
  const s = src.structures;
  if (!Number.isInteger(factory) || factory < 0 || factory >= s.highWater || s.owner[factory] === 0 || s.type[factory] !== STRUCT_FACTORY) return REJECT_HELI_NO_FACTORY;
  if (s.owner[factory] !== seatToOwner(seat)) return REJECT_HELI_NOT_OWNER;
  const heli = padHeliAt(src.helis, factory);
  if (heli < 0) return REJECT_HELI_NO_PAD;
  if (!Number.isInteger(troops) || troops < 1 || troops > heliMaxTroopsOf(src, seat) || troops > probe.troops) return REJECT_HELI_BAD_TROOPS;
  if (probe.beachheadFull()) return REJECT_HELI_BEACHHEAD_FULL; // before the departure: no troops are drawn
  if (!probe.canNavigate) return REJECT_HELI_NO_ROUTE;
  const mode: AltMode = altMode === 1 ? 1 : 0;
  const from = s.cell[factory] as number;
  if (probe.zoneBound(lzCell)) return REJECT_DIPLO_TREATY_BOUND;
  const lz = probe.score(lzCell, from, mode);
  if (lz.reason !== 0) return lz.reason;
  const route = probe.route(from, lzCell, mode);
  if (!route.ok || route.waypoints.length < 2 || route.waypoints.length > HELI_ROUTE_CAPACITY) return REJECT_HELI_NO_ROUTE;
  plan.heli = heli;
  plan.route = route;
  return REJECT_NONE;
}

/** THE RecallHeli rules: the helicopter exists (else REJECT_HELI_NOT_FLYING), belongs to the seat (REJECT_HELI_NOT_OWNER) and is on a mission in the air (lifting, cruising, approaching or hovering; else REJECT_HELI_NOT_FLYING). */
export function checkRecallHeli(src: HeliSource, seat: number, heli: number): number {
  const h = src.helis;
  if (!Number.isInteger(heli) || heli < 0 || heli >= h.highWater || h.owner[heli] === 0) return REJECT_HELI_NOT_FLYING;
  if (h.owner[heli] !== seatToOwner(seat)) return REJECT_HELI_NOT_OWNER;
  const st = h.state[heli];
  return st === HELI_LIFT || st === HELI_CRUISE || st === HELI_APPROACH || st === HELI_HOVER ? REJECT_NONE : REJECT_HELI_NOT_FLYING;
}

/**
 * Why `seat` could not send the helicopter on the pad of Factory `factory` to `lzCell` with `troops` in mode `altMode` right now in the snapshot `view`
 * (REJECT_NONE = it could). `nav` is the Nav the caller built on the snapshot (`createNav`, as for `scoreLz`); the sim runs the same `checkLaunchHeli`.
 */
export function validateLaunchHeli(view: SimView, nav: Nav, seat: number, factory: number, lzCell: number, troops: number, altMode: number): number {
  const probe: LaunchProbe = {
    troops: Math.floor((view.stats.troopsQt[seat] as number) / QT_PER_TROOP),
    canNavigate: true,
    score: (cell, from, mode) => scoreLz(nav, view, seat, cell, from, mode),
    route: (from, to, mode) => planRoute(nav, view, seat, from, to, mode),
    beachheadFull: () => false,
    zoneBound: (cell) => {
      const o = view.owner[cell] as number;
      return o !== 0 && o !== seatToOwner(seat) && view.diplomacy.relation(seat, o - 1) !== RELATION_WAR;
    },
  };
  return checkLaunchHeli(view, view.flow && view.phase === PHASE_SPAWN, seat, factory, lzCell, troops, altMode, probe, emptyLaunchPlan());
}

/** Why `seat` could not recall helicopter `heli` right now in the snapshot `view` (REJECT_NONE = it could). */
export function validateRecallHeli(view: SimView, seat: number, heli: number): number {
  return checkRecallHeli(view, seat, heli);
}

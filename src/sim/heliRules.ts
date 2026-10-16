// The helicopter rules that UI and AI may read (M12a-1): the fleet cap and count and the ProduceHeli check. Pure and read-only: everything takes a
// read-only window (`HeliSource`) and returns numbers. The sim's own ProduceHeli (src/sim/heliPhase.ts) calls `checkProduceHeli` below, the SAME
// function `validateProduceHeli` wraps, so there is one implementation (the pattern of `checkBuild` / `validateBuild`).
import { HELI_FLEET_BASE, HELI_FLEET_MAX, HELI_PRICE_GOLD, MILLI_GOLD_PER_GOLD } from './rules';
import {
  REJECT_HELI_FACTORY_BUILDING,
  REJECT_HELI_FLEET_CAP,
  REJECT_HELI_NO_FACTORY,
  REJECT_HELI_NO_GOLD,
  REJECT_HELI_NOT_OWNER,
  REJECT_HELI_QUEUE_BUSY,
  REJECT_NONE,
  REJECT_PHASE,
} from './intents';
import { PHASE_SPAWN } from './flow';
import { HELI_BUILDING, type HeliView } from './heliTable';
import { seatToOwner } from './state';
import { STRUCT_FACTORY, type StructureView } from './structureRules';
import type { SimView } from './view';

/** What the helicopter rules read: the tick, the structure table and the helicopter table (a SimView is one; so is the sim's own state through `StateHeliSource`). */
export interface HeliSource {
  readonly tick: number;
  readonly structures: StructureView;
  readonly helis: HeliView;
}

/** Price of a helicopter in milli-gold. */
export const HELI_PRICE_MILLI = HELI_PRICE_GOLD * MILLI_GOLD_PER_GOLD;

/** The fleet cap of a seat: HELI_FLEET_BASE + the sum of the levels of its FINISHED Factories, at most HELI_FLEET_MAX. */
export function fleetCapOf(src: HeliSource, seat: number): number {
  const s = src.structures;
  const ownerId = seatToOwner(seat);
  let sum = HELI_FLEET_BASE;
  for (let i = 0; i < s.highWater; i++) {
    if (s.owner[i] === ownerId && s.type[i] === STRUCT_FACTORY && src.tick >= (s.readyTick[i] as number)) {
      sum += s.level[i] as number;
      if (sum >= HELI_FLEET_MAX) return HELI_FLEET_MAX;
    }
  }
  return sum;
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
  if (fleetCountOf(src, seat) >= fleetCapOf(src, seat) || h.liveCount >= h.capacity) return REJECT_HELI_FLEET_CAP;
  if (goldMilli < HELI_PRICE_MILLI) return REJECT_HELI_NO_GOLD;
  return REJECT_NONE;
}

/** Why `seat` could not order a helicopter in Factory `factory` right now in the snapshot `view` (REJECT_NONE = it could). The sim runs the same `checkProduceHeli`. */
export function validateProduceHeli(view: SimView, seat: number, factory: number): number {
  return checkProduceHeli(view, view.stats.goldMilli[seat] as number, view.flow && view.phase === PHASE_SPAWN, seat, factory);
}


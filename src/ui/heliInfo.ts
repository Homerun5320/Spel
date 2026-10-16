// The helicopter part of the Factory panel (M13a-1), pure: what the build button shows (price, queue, fleet gauge, the reason it is dimmed) read from a
// SimView with the sim's own check (`validateProduceHeli`), and the watcher that turns a change of the helicopter table into the toasts "a helicopter is
// ready" / "the build was scrapped" without any event channel and without allocating per frame (it only looks when the table version moved).
import {
  HELI_APPROACH,
  HELI_BUILDING,
  HELI_BUILD_TICKS,
  HELI_CRUISE,
  HELI_DOWNED,
  HELI_FUEL_CELLS,
  HELI_HOVER,
  HELI_LIFT,
  HELI_PAD,
  HELI_POS_ONE,
  HELI_PRICE_GOLD,
  HELI_RETURN,
  HELI_UNLOAD,
  fleetCapOf,
  fleetCountOf,
  seatToOwner,
  validateProduceHeli,
  validateRecallHeli,
  type SimView,
} from '../sim/public';
import { TICK_HZ } from './hudCodes';
import type { TextKey } from './i18n';

export interface HeliPanelInfo {
  /** The price in sim gold (shown through `formatGold`). */
  readonly price: number;
  /** Seconds a build takes. */
  readonly buildSeconds: number;
  /** `validateProduceHeli` for the seat: 0 = the order would be accepted, else a REJECT_* code. */
  readonly reason: number;
  /** Helicopters of the seat (also those under production) and the fleet cap. */
  readonly fleet: number;
  readonly cap: number;
  /** This Factory is building one: whole seconds left (rounded up), else 0. */
  readonly queueSeconds: number;
}

/** The numbers of the build button for Factory `factory` and `seat`. */
export function heliPanelInfo(view: SimView, seat: number, factory: number): HeliPanelInfo {
  const h = view.helis;
  const owner = seatToOwner(seat);
  let queueSeconds = 0;
  for (let i = 0; i < h.highWater; i++) {
    if (h.owner[i] === owner && h.state[i] === HELI_BUILDING && h.factory[i] === factory) {
      queueSeconds = Math.max(1, Math.ceil(((h.readyTick[i] as number) - view.tick) / TICK_HZ));
      break;
    }
  }
  return { price: HELI_PRICE_GOLD, buildSeconds: HELI_BUILD_TICKS / TICK_HZ, reason: validateProduceHeli(view, seat, factory), fleet: fleetCountOf(view, seat), cap: fleetCapOf(view, seat), queueSeconds };
}

// ---- M13b: sending a helicopter, the list of the seat's helicopters, the mission news ----------------------------------------------------------------

/** The id of the lowest helicopter parked on the pad of Factory `factory` (the one LaunchHeli sends), or -1. The rule is the sim's (`padHeliAt`), read through the table. */
export function padHeliOf(view: SimView, seat: number, factory: number): number {
  const h = view.helis;
  const owner = seatToOwner(seat);
  for (let id = 0; id < h.highWater; id++) if (h.owner[id] === owner && h.state[id] === HELI_PAD && h.factory[id] === factory) return id;
  return -1;
}

/** One row of the helicopter list. */
export interface HeliRow {
  readonly id: number;
  readonly state: number;
  readonly troops: number;
  /** Whole percent of a full tank. */
  readonly fuelPct: number;
  /** `validateRecallHeli` is 0: the Recall button is live. */
  readonly canRecall: boolean;
}

/** The seat's helicopters that are not under production, lowest id first, at most `max` (the list is a compact one). Fills `out` (cleared first). */
export function ownHeliRows(view: SimView, seat: number, out: HeliRow[], max = 8): HeliRow[] {
  out.length = 0;
  const h = view.helis;
  const owner = seatToOwner(seat);
  for (let id = 0; id < h.highWater && out.length < max; id++) {
    if (h.owner[id] !== owner || h.state[id] === HELI_BUILDING || h.state[id] === 0) continue;
    out.push({
      id,
      state: h.state[id] as number,
      troops: h.load[id] as number,
      fuelPct: Math.max(0, Math.min(100, Math.round(((h.fuel[id] as number) * 100) / (HELI_FUEL_CELLS * HELI_POS_ONE)))),
      canRecall: validateRecallHeli(view, seat, id) === 0,
    });
  }
  return out;
}

/** The text key of a helicopter state. */
export function heliStateKey(state: number): TextKey {
  switch (state) {
    case HELI_PAD:
      return 'heli.state.pad';
    case HELI_LIFT:
      return 'heli.state.lift';
    case HELI_CRUISE:
      return 'heli.state.cruise';
    case HELI_APPROACH:
      return 'heli.state.approach';
    case HELI_HOVER:
      return 'heli.state.hover';
    case HELI_UNLOAD:
      return 'heli.state.unload';
    case HELI_RETURN:
      return 'heli.state.return';
    default:
      return 'heli.state.downed';
  }
}

export const MISSION_LANDED = 1;
export const MISSION_LOST = 2;

/** Compares the seat's helicopters between two table versions and says which missions ended: a bit set of MISSION_LANDED (a hovering one set down) and MISSION_LOST (one was shot down or ran dry). No allocation per frame. */
export class MissionWatcher {
  private version = -1;
  private prev = new Uint8Array(0);
  private prevOwner = new Uint16Array(0);

  update(view: SimView, version: number, seat: number): number {
    if (version === this.version) return 0;
    this.version = version;
    const h = view.helis;
    if (this.prev.length !== h.capacity) {
      this.prev = new Uint8Array(h.capacity);
      this.prevOwner = new Uint16Array(h.capacity);
    }
    const mine = seatToOwner(seat);
    let news = 0;
    for (let id = 0; id < h.highWater; id++) {
      const owner = h.owner[id] as number;
      const state = owner === 0 ? 0 : (h.state[id] as number);
      if (owner === mine && this.prevOwner[id] === mine) {
        const before = this.prev[id] as number;
        if (before === HELI_HOVER && state !== HELI_HOVER && state !== HELI_DOWNED && state !== 0) news |= MISSION_LANDED;
        if (state === HELI_DOWNED && before !== HELI_DOWNED) news |= MISSION_LOST;
      }
      this.prev[id] = state;
      this.prevOwner[id] = owner;
    }
    return news;
  }

  reset(): void {
    this.version = -1;
    this.prev.fill(0);
    this.prevOwner.fill(0);
  }
}

export type HeliEvent = 'produced' | 'scrapped' | null;

/** Compares one seat's helicopters between two table versions: a build that finished or was scrapped. */
export class HeliWatcher {
  private version = -1;
  private ready = -1;
  private building = -1;
  private total = -1;

  /** Call every frame; it does work only when `version` moved. Returns the news of the seat since the last change, if any. */
  update(view: SimView, version: number, seat: number): HeliEvent {
    if (version === this.version) return null;
    this.version = version;
    const h = view.helis;
    const owner = seatToOwner(seat);
    let ready = 0;
    let building = 0;
    for (let i = 0; i < h.highWater; i++) {
      if (h.owner[i] !== owner) continue;
      if (h.state[i] === HELI_BUILDING) building++;
      else ready++;
    }
    const total = ready + building;
    const first = this.total < 0;
    let ev: HeliEvent = null;
    if (!first) {
      if (ready > this.ready && building < this.building) ev = 'produced';
      else if (building < this.building && total < this.total) ev = 'scrapped';
    }
    this.ready = ready;
    this.building = building;
    this.total = total;
    return ev;
  }

  /** Forget the history (a new match). */
  reset(): void {
    this.version = -1;
    this.ready = -1;
    this.building = -1;
    this.total = -1;
  }
}

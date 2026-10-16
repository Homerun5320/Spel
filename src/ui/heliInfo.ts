// The helicopter part of the Factory panel (M13a-1), pure: what the build button shows (price, queue, fleet gauge, the reason it is dimmed) read from a
// SimView with the sim's own check (`validateProduceHeli`), and the watcher that turns a change of the helicopter table into the toasts "a helicopter is
// ready" / "the build was scrapped" without any event channel and without allocating per frame (it only looks when the table version moved).
import { HELI_BUILDING, HELI_BUILD_TICKS, HELI_PRICE_GOLD, fleetCapOf, fleetCountOf, seatToOwner, validateProduceHeli, type SimView } from '../sim/public';
import { TICK_HZ } from './hudCodes';

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

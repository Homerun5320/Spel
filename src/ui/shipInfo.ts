// The model of the ship block of the Port panel (M13c-2). No rule is repeated here: the verdict is `validateLaunchShip`, the very check the sim runs. The button asks it with NO target
// (-1) and the least troops: the checks that come before the target decide the answer, and REJECT_SHIP_BAD_TARGET then means "the button may be pressed, a target is still to be
// picked". The reasons that need a target (no route, a treaty, a refused cell) belong to the mode's preview. Pure TypeScript over a read-only `SimView`.
import { REJECT_SHIP_BAD_TARGET, SHIP_FLEET_MAX, SHIP_LAUNCH_GOLD, SHIP_MAX_TROOPS, SHIP_MIN_TROOPS, validateLaunchShip, type SimView } from '../sim/public';
import { QT_PER_TROOP } from '../sim/rules';

export interface ShipPanelInfo {
  /** 0 = the button is live, else the refusal that holds before any target is picked. */
  readonly reason: number;
  /** The gold fee (`SHIP_LAUNCH_GOLD`). */
  readonly price: number;
  /** The seat's ships (also a docked one cooling down) and the fleet cap. */
  readonly fleet: number;
  readonly cap: number;
  /** The most troops the slider offers: the ship's cap, cut to the troops the seat has (never below the least launch). */
  readonly maxTroops: number;
}

/** Whole troops the seat has. */
export function wholeTroops(view: SimView, seat: number): number {
  return Math.floor((view.stats.troopsQt[seat] as number) / QT_PER_TROOP);
}

/** The slider's top for `seat`: `SHIP_MAX_TROOPS` cut to the troops it has, and at least `SHIP_MIN_TROOPS` (a seat with fewer sees the refusal instead). */
export function shipSliderMax(view: SimView, seat: number): number {
  return Math.max(SHIP_MIN_TROOPS, Math.min(SHIP_MAX_TROOPS, wholeTroops(view, seat)));
}

/** The reason the button is dimmed for Port `port` of `seat` (0 = live). */
export function shipButtonReason(view: SimView, seat: number, port: number): number {
  const r = validateLaunchShip(view, seat, port, -1, SHIP_MIN_TROOPS);
  return r === REJECT_SHIP_BAD_TARGET ? 0 : r;
}

export function shipPanelInfo(view: SimView, seat: number, port: number): ShipPanelInfo {
  return {
    reason: shipButtonReason(view, seat, port),
    price: SHIP_LAUNCH_GOLD,
    fleet: view.ships.countOf(seat + 1),
    cap: SHIP_FLEET_MAX,
    maxTroops: shipSliderMax(view, seat),
  };
}

/**
 * Fix-6B [2.5]: `shipPanelInfo` runs the sim's whole launch check (a probe, closures, a plan and its route buffer), which is garbage every call. The Port panel asks it every frame, so a
 * resting panel goes through this cache: the answer of one tick for one (view, seat, port) is computed once and handed out again until the tick, the port, the seat or the view changes.
 */
export class ShipPanelInfoCache {
  private view: SimView | null = null;
  private tick = -1;
  private seat = -1;
  private port = -1;
  private info: ShipPanelInfo | null = null;

  get(view: SimView, seat: number, port: number): ShipPanelInfo {
    if (this.info !== null && this.view === view && this.tick === view.tick && this.seat === seat && this.port === port) return this.info;
    const info = shipPanelInfo(view, seat, port);
    this.view = view;
    this.tick = view.tick;
    this.seat = seat;
    this.port = port;
    this.info = info;
    return info;
  }
}

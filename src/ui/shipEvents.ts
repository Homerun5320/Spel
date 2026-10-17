// The ship news (M13c-2): the FIRST consumer of `ViewSnapshot.events` (Events-1). `ShipEventWatcher.update` reads the side facts the mirror holds and turns the OWN ship's facts into
// toast codes: set sail, landed (with the cells taken, or failed, or nothing to land on), turned back because of a treaty, scrapped. It writes into caller-owned arrays, so a frame
// without ship events allocates nothing.
//
// WHAT AN ENEMY FACT MAY SHOW. In v1 every ship is visible to every viewer (there is no fog for ships, `SimView.ships` is the whole table), but a TOAST is the owner's news only: a fact
// about another seat's ship, or about a ship whose owner cannot be told (a scrapped row is gone from the table), gives no toast. The owner of a slot is remembered from the last table
// the watcher saw, so a ship scrapped in the frame its row vanished is still told apart.
import { OUTBOX_SHIP_LANDED, OUTBOX_SHIP_LAUNCHED, OUTBOX_SHIP_RTB, OUTBOX_SHIP_SCRAPPED, type ShipView } from '../sim/public';
import type { ViewEventsView } from '../sim/view';
import type { TextKey } from './i18n';

export const SHIP_NEWS_LAUNCHED = 1;
export const SHIP_NEWS_LANDED = 2;
export const SHIP_NEWS_LAND_FAILED = 3;
export const SHIP_NEWS_LAND_NONE = 4;
export const SHIP_NEWS_TREATY = 5;
export const SHIP_NEWS_SCRAP_ELIMINATED = 6;
export const SHIP_NEWS_SCRAP_NO_PORT = 7;

/** At most this many toasts come out of one `update` (the rest of a burst is dropped: a toast per ship is plenty). */
export const SHIP_NEWS_MAX = 8;

/** The toast key of a news code. */
export function shipNewsKey(code: number): TextKey {
  switch (code) {
    case SHIP_NEWS_LAUNCHED:
      return 'toast.ship.launched';
    case SHIP_NEWS_LANDED:
      return 'toast.ship.landed';
    case SHIP_NEWS_LAND_FAILED:
      return 'toast.ship.landFailed';
    case SHIP_NEWS_LAND_NONE:
      return 'toast.ship.landNone';
    case SHIP_NEWS_TREATY:
      return 'toast.ship.treaty';
    case SHIP_NEWS_SCRAP_ELIMINATED:
      return 'toast.ship.scrapEliminated';
    default:
      return 'toast.ship.scrapNoPort';
  }
}

/** Where `update` puts its answer: `codes[0..count)` and, for SHIP_NEWS_LANDED, the cells taken in `args`. */
export interface ShipNews {
  count: number;
  readonly codes: Int32Array;
  readonly args: Int32Array;
}

export function newShipNews(): ShipNews {
  return { count: 0, codes: new Int32Array(SHIP_NEWS_MAX), args: new Int32Array(SHIP_NEWS_MAX) };
}

export class ShipEventWatcher {
  /** The owner of each slot in the last table seen (0 = free). */
  private readonly seen: Uint16Array;

  constructor(capacity = 32) {
    this.seen = new Uint16Array(capacity);
  }

  /**
   * Call once per frame BEFORE `view.clearEvents()`: turns the events of the mirror into the news of `ownerId` (own ships only) in `out`, then remembers the owners of the table.
   * Returns the count (also `out.count`).
   */
  update(events: ViewEventsView, ships: ShipView, ownerId: number, out: ShipNews): number {
    out.count = 0;
    const n = events.length;
    for (let i = 0; i < n && out.count < SHIP_NEWS_MAX; i++) {
      const kind = events.kindAt(i);
      if (kind !== OUTBOX_SHIP_LAUNCHED && kind !== OUTBOX_SHIP_LANDED && kind !== OUTBOX_SHIP_RTB && kind !== OUTBOX_SHIP_SCRAPPED) continue;
      const id = events.aAt(i);
      if (id < 0 || id >= this.seen.length) continue;
      const b = events.bAt(i);
      const live = ships.owner[id] as number;
      const owner = live !== 0 ? live : (this.seen[id] as number);
      if (owner !== ownerId || ownerId === 0) continue;
      let code = 0;
      let arg = 0;
      if (kind === OUTBOX_SHIP_LAUNCHED) code = SHIP_NEWS_LAUNCHED;
      else if (kind === OUTBOX_SHIP_LANDED) {
        if (b > 0) {
          code = SHIP_NEWS_LANDED;
          arg = b;
        } else code = b < 0 ? SHIP_NEWS_LAND_FAILED : SHIP_NEWS_LAND_NONE;
      } else if (kind === OUTBOX_SHIP_RTB) {
        if (b === 1) code = SHIP_NEWS_TREATY; // a mission that is over (b = 0) has its landing toast already
      } else code = b === 1 ? SHIP_NEWS_SCRAP_ELIMINATED : SHIP_NEWS_SCRAP_NO_PORT;
      if (code === 0) continue;
      out.codes[out.count] = code;
      out.args[out.count] = arg;
      out.count++;
    }
    for (let id = 0; id < this.seen.length; id++) this.seen[id] = ships.owner[id] as number;
    return out.count;
  }

  /** Forgets the owners (a new match). */
  reset(): void {
    this.seen.fill(0);
  }
}

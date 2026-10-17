// The page's copy of the ship table (M13c-1): a `ShipView` over the rows of the last `ShipSnapshot` the host sent, replaced as a whole when a frame brings a new table (at most
// 32 rows; nothing is patched). The rows sit in slot order and the view is indexed by slot, so the arrays are spread out again on `adopt`.
import type { ShipView } from '../sim/shipTable';
import { SHIP_CAPACITY, SHIP_ROUTE_CAPACITY } from '../sim/rules';
import type { ShipSnapshot } from './protocol';

export class MirrorShips implements ShipView {
  readonly capacity = SHIP_CAPACITY;
  liveCount = 0;
  readonly owner = new Uint16Array(SHIP_CAPACITY);
  readonly state = new Uint8Array(SHIP_CAPACITY);
  readonly port = new Uint16Array(SHIP_CAPACITY);
  readonly stateTick = new Uint32Array(SHIP_CAPACITY);
  readonly x = new Int32Array(SHIP_CAPACITY);
  readonly y = new Int32Array(SHIP_CAPACITY);
  readonly load = new Uint16Array(SHIP_CAPACITY);
  readonly target = new Uint32Array(SHIP_CAPACITY);
  readonly routeLen = new Uint8Array(SHIP_CAPACITY);
  readonly routeIdx = new Uint8Array(SHIP_CAPACITY);
  private readonly route = new Int32Array(SHIP_CAPACITY * SHIP_ROUTE_CAPACITY);
  /** Increases whenever a new table was adopted. */
  version = 0;

  adopt(s: ShipSnapshot): void {
    this.owner.fill(0);
    this.state.fill(0);
    this.port.fill(0);
    this.stateTick.fill(0);
    this.x.fill(0);
    this.y.fill(0);
    this.load.fill(0);
    this.target.fill(0);
    this.routeLen.fill(0);
    this.routeIdx.fill(0);
    this.route.fill(0);
    for (let k = 0; k < s.count; k++) {
      const i = s.slot[k] as number;
      this.owner[i] = s.owner[k] as number;
      this.state[i] = s.state[k] as number;
      this.port[i] = s.port[k] as number;
      this.stateTick[i] = s.stateTick[k] as number;
      this.x[i] = s.x[k] as number;
      this.y[i] = s.y[k] as number;
      this.load[i] = s.load[k] as number;
      this.target[i] = s.target[k] as number;
      this.routeLen[i] = s.routeLen[k] as number;
      this.routeIdx[i] = s.routeIdx[k] as number;
      for (let r = 0; r < (s.routeLen[k] as number); r++) this.route[i * SHIP_ROUTE_CAPACITY + r] = s.route[k * SHIP_ROUTE_CAPACITY + r] as number;
    }
    this.liveCount = s.count;
    this.version++;
  }

  routeCell(id: number, k: number): number {
    return this.route[id * SHIP_ROUTE_CAPACITY + k] as number;
  }

  cellOf(id: number, width: number): number {
    return ((this.y[id] as number) >> 8) * width + ((this.x[id] as number) >> 8);
  }

  countOf(ownerId: number): number {
    let n = 0;
    for (let i = 0; i < SHIP_CAPACITY; i++) if (this.owner[i] === ownerId) n++;
    return n;
  }
}

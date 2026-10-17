// The ship table on its way to the page (M13c-1), in the pattern of the helicopter and beachhead snapshots: `snapshotShips` copies the live rows into plain typed arrays,
// `shipSignature` is a cheap fingerprint the host uses to send the table in a frame's diff only when it changed. Both are called by the host, never the page. Every ship is
// visible in v1 (there is no per-viewer filter, DECISIONS M13c-1). Nothing here is game state.
import { SHIP_CAPACITY, SHIP_ROUTE_CAPACITY } from '../sim/rules';
import type { ShipTable } from '../sim/shipTable';
import type { ShipSnapshot } from './protocol';

/** A snapshot with no rows (what a mirror holds before the first table). */
export const NO_SHIPS: ShipSnapshot = Object.freeze({
  count: 0,
  slot: new Uint8Array(0),
  owner: new Uint16Array(0),
  state: new Uint8Array(0),
  port: new Uint16Array(0),
  stateTick: new Uint32Array(0),
  x: new Int32Array(0),
  y: new Int32Array(0),
  load: new Uint16Array(0),
  target: new Uint32Array(0),
  routeLen: new Uint8Array(0),
  routeIdx: new Uint8Array(0),
  route: new Int32Array(0),
});

/** The live rows in slot order; row k's route is `route[k * SHIP_ROUTE_CAPACITY ...]` (routeLen waypoints). */
export function snapshotShips(t: ShipTable): ShipSnapshot {
  const n = t.liveCount;
  if (n === 0) return NO_SHIPS;
  const slot = new Uint8Array(n);
  const owner = new Uint16Array(n);
  const state = new Uint8Array(n);
  const port = new Uint16Array(n);
  const stateTick = new Uint32Array(n);
  const x = new Int32Array(n);
  const y = new Int32Array(n);
  const load = new Uint16Array(n);
  const target = new Uint32Array(n);
  const routeLen = new Uint8Array(n);
  const routeIdx = new Uint8Array(n);
  const route = new Int32Array(n * SHIP_ROUTE_CAPACITY);
  let k = 0;
  for (let i = 0; i < SHIP_CAPACITY && k < n; i++) {
    const o = t.owner[i] as number;
    if (o === 0) continue;
    slot[k] = i;
    owner[k] = o;
    state[k] = t.state[i] as number;
    port[k] = t.port[i] as number;
    stateTick[k] = t.stateTick[i] as number;
    x[k] = t.x[i] as number;
    y[k] = t.y[i] as number;
    load[k] = t.load[i] as number;
    target[k] = t.target[i] as number;
    routeLen[k] = t.routeLen[i] as number;
    routeIdx[k] = t.routeIdx[i] as number;
    for (let r = 0; r < (t.routeLen[i] as number); r++) route[k * SHIP_ROUTE_CAPACITY + r] = t.route[i * SHIP_ROUTE_CAPACITY + r] as number;
    k++;
  }
  return { count: k, slot, owner, state, port, stateTick, x, y, load, target, routeLen, routeIdx, route };
}

/** A 32-bit fingerprint of everything a snapshot carries but the route (FNV-style fold; a route only changes with a new row). Cheap: 32 rows at most. */
export function shipSignature(t: ShipTable): number {
  let h = 0x811c9dc5;
  const fold = (v: number): void => {
    h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0;
  };
  fold(t.liveCount);
  if (t.liveCount === 0) return h;
  for (let i = 0; i < SHIP_CAPACITY; i++) {
    const o = t.owner[i] as number;
    if (o === 0) continue;
    fold(i);
    fold(o);
    fold(t.state[i] as number);
    fold(t.port[i] as number);
    fold(t.stateTick[i] as number);
    fold(t.x[i] as number);
    fold(t.y[i] as number);
    fold(t.load[i] as number);
    fold(t.target[i] as number);
    fold(t.routeLen[i] as number);
    fold(t.routeIdx[i] as number);
    fold(t.route[i * SHIP_ROUTE_CAPACITY] as number);
    fold(t.route[i * SHIP_ROUTE_CAPACITY + (t.routeLen[i] as number) - 1] as number);
  }
  return h;
}

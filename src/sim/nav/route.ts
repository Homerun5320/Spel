// planRoute (M11b): weighted A* over the nav grid (8 neighbours, wrapX, no corner cutting, heuristic weight AIR_ROUTE_WEIGHT_PCT / 100).
// Step cost = km * (1 + climb + ceiling + lambda * exposed(nav cell)), where "exposed" is the M11a exposure of the enemy seats (radar
// seen or inside a Post radius) evaluated in the nav cell's lowest sim cell. Unreachable goals are answered by the component labels
// without running A*. Pure, deterministic and allocation-free apart from the result; nothing here is hashed state.
import { ALT_MODE_LOW, type AltMode, type LosSource } from '../los/cache';
import {
  AIR_CEILING_COST_PCT,
  AIR_CEILING_MARGIN_M,
  AIR_CLIMB_COST_PCT_PER_KM_M,
  AIR_EXPOSURE_LAMBDA,
  AIR_MODE_AGL_M,
  AIR_MODE_SPEED_MILLICELLS_S,
  AIR_ROUTE_WEIGHT_PCT,
  SERVICE_CEILING_M,
  TICK_HZ,
} from '../rules';
import type { Nav } from './grid';

/** What a view must offer: the LOS source plus the number of seats (a SimView is one). */
export interface NavView extends LosSource {
  readonly seats: number;
}

export const ROUTE_NO_ROUTE = 1;

export interface RouteOk {
  readonly ok: true;
  /** Sim cells: the start, the turning points (nav cell centres) and the goal. */
  readonly waypoints: number[];
  /** Length of the flown polyline in sim cells, rounded up. */
  readonly fuelCells: number;
  /** Flight time in ticks (TICK_HZ per second) at the mode's speed. */
  readonly etaTicks: number;
  /** Nav cells of the path that are exposed to the enemy seats. */
  readonly exposedCells: number;
  /** The nav cells of the path (for drawing and tests). */
  readonly navCells: number[];
}
export interface RouteFail {
  readonly ok: false;
  readonly reason: typeof ROUTE_NO_ROUTE;
}
export type RouteResult = RouteOk | RouteFail;

const FAIL: RouteFail = { ok: false, reason: ROUTE_NO_ROUTE };
const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

function exposedAt(nav: Nav, view: NavView, seat: number, mode: AltMode, n: number): number {
  if (nav.expStamp[n] === nav.generation) return nav.expVal[n] as number;
  const cell = nav.lowCell[n] as number;
  let hit = 0;
  const owners = nav.owners;
  for (let i = 0; i < owners.length; i++) {
    const o = owners[i] as number;
    if (o === seat + 1) continue;
    if (nav.los.detected(o, cell, mode) || nav.los.inPostRadius(o, cell)) {
      hit = 1;
      break;
    }
  }
  nav.expStamp[n] = nav.generation;
  nav.expVal[n] = hit;
  return hit;
}

function heapPush(nav: Nav, size: number, key: number, node: number): number {
  if (size === nav.heapKey.length) {
    const k = new Float64Array(size * 2);
    const v = new Int32Array(size * 2);
    k.set(nav.heapKey);
    v.set(nav.heapNode);
    nav.heapKey = k;
    nav.heapNode = v;
  }
  const hk = nav.heapKey;
  const hn = nav.heapNode;
  let i = size;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if ((hk[p] as number) <= key) break;
    hk[i] = hk[p] as number;
    hn[i] = hn[p] as number;
    i = p;
  }
  hk[i] = key;
  hn[i] = node;
  return size + 1;
}

/** Removes the smallest; returns the new size. The popped node and key are left in `popped`. */
const popped = { node: 0, key: 0 };
function heapPop(nav: Nav, size: number): number {
  const hk = nav.heapKey;
  const hn = nav.heapNode;
  popped.node = hn[0] as number;
  popped.key = hk[0] as number;
  const n = size - 1;
  const key = hk[n] as number;
  const node = hn[n] as number;
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= n) break;
    if (c + 1 < n && (hk[c + 1] as number) < (hk[c] as number)) c++;
    if ((hk[c] as number) >= key) break;
    hk[i] = hk[c] as number;
    hn[i] = hn[c] as number;
    i = c;
  }
  hk[i] = key;
  hn[i] = node;
  return n;
}

/** Horizontal distance in sim cells between two sim cells (wrapX). */
export function cellDistance(simWidth: number, a: number, b: number): number {
  const ax = a % simWidth;
  const bx = b % simWidth;
  let dx = Math.abs(ax - bx);
  if (dx > simWidth - dx) dx = simWidth - dx;
  const dy = (a - ax) / simWidth - (b - bx) / simWidth;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Plans a helicopter route of flight mode `mode` from sim cell `from` to sim cell `to` for `seat`. The enemies are every other seat; their
 * SAM coverage and Post radii make nav cells "exposed". `lambda` weighs the exposure (0 = the straightest route). NO_ROUTE when a
 * cell is closed to the mode or the two are in different components (answered by the labels, no search).
 */
export function planRoute(nav: Nav, view: NavView, seat: number, from: number, to: number, mode: AltMode = ALT_MODE_LOW, lambda: number = AIR_EXPOSURE_LAMBDA): RouteResult {
  const a = nav.navOf(from);
  const b = nav.navOf(to);
  const label = nav.airLabel[mode] as Int32Array;
  const la = label[a] as number;
  if (la < 0 || la !== (label[b] as number)) {
    nav.labelRejects++;
    return FAIL;
  }
  nav.astarRuns++;
  nav.los.sync(view);
  nav.los.sensorOwners(nav.owners);
  const gen = ++nav.generation;
  const W = nav.width;
  const H = nav.height;
  const blocked = nav.blocked[mode] as Uint8Array;
  const mean = nav.meanM;
  const agl = AIR_MODE_AGL_M[mode] as number;
  const nearCeiling = SERVICE_CEILING_M - AIR_CEILING_MARGIN_M - agl;
  const climbK = AIR_CLIMB_COST_PCT_PER_KM_M / 100 / 1000;
  const ceilK = AIR_CEILING_COST_PCT / 100;
  const hw = AIR_ROUTE_WEIGHT_PCT / 100;
  const bx = b % W;
  const by = (b - bx) / W;
  const g = nav.gCost;
  const gs = nav.gStamp;
  const closed = nav.closedStamp;
  const parent = nav.parent;

  // ADMISSIBLE heuristic (Fix-3A2). On the 8-neighbour lattice a path that must cover D columns and V rows takes at least min(D, V) diagonal
  // steps' worth of both, so its cost is at least min * sqrt(w^2 + h^2) + (D - min) * w + (V - min) * h at the narrowest row width w it
  // visits (the cost factor is >= 1; a diagonal step is cheaper than its two legs, so using as many diagonals as possible is the lower bound).
  // A path may leave the rows between the node and the goal to fly a narrower row nearer a pole (the great-circle bend); that excursion is
  // priced in (rows walked twice), so the bound holds for EVERY path. The scan stops as soon as more rows can only cost more than the best
  // bound found, so it touches a few rows. The old code measured D with the expanded row's width and was not a bound.
  const wKm = nav.wKm;
  const hKm = nav.hKm;
  const lattice = (d: number, v: number, w: number): number => {
    if (d >= v) return v * Math.sqrt(w * w + hKm * hKm) + (d - v) * w;
    return d * Math.sqrt(w * w + hKm * hKm) + (v - d) * hKm;
  };
  const heuristic = (n: number): number => {
    const x = n % W;
    const y = (n - x) / W;
    let dx = Math.abs(x - bx);
    if (dx > W - dx) dx = W - dx;
    const lo = y < by ? y : by;
    const hi = y < by ? by : y;
    const span = hi - lo;
    if (dx === 0) return hw * span * hKm;
    let wI = wKm[lo] as number;
    for (let r = lo + 1; r <= hi; r++) if ((wKm[r] as number) < wI) wI = wKm[r] as number;
    let best = lattice(dx, span, wI);
    let wMin = wI;
    for (let r = lo - 1; r >= 0; r--) {
      if ((span + 2 * (lo - r)) * hKm >= best) break;
      if ((wKm[r] as number) < wMin) wMin = wKm[r] as number;
      const v = lattice(dx, span + 2 * (lo - r), wMin);
      if (v < best) best = v;
    }
    wMin = wI;
    for (let r = hi + 1; r < H; r++) {
      if ((span + 2 * (r - hi)) * hKm >= best) break;
      if ((wKm[r] as number) < wMin) wMin = wKm[r] as number;
      const v = lattice(dx, span + 2 * (r - hi), wMin);
      if (v < best) best = v;
    }
    return hw * best;
  };

  let size = 0;
  g[a] = 0;
  gs[a] = gen;
  parent[a] = -1;
  size = heapPush(nav, size, heuristic(a), a);
  let found = false;
  while (size > 0) {
    size = heapPop(nav, size);
    const n = popped.node;
    if (closed[n] === gen) continue;
    closed[n] = gen;
    if (n === b) {
      found = true;
      break;
    }
    const nx = n % W;
    const ny = (n - nx) / W;
    const gn = g[n] as number;
    for (let d = 0; d < 8; d++) {
      const dx = DX[d] as number;
      const dy = DY[d] as number;
      const my = ny + dy;
      if (my < 0 || my >= H) continue;
      const mx = (nx + dx + W) % W;
      const m = my * W + mx;
      if (blocked[m] === 1 || closed[m] === gen) continue;
      if (dx !== 0 && dy !== 0 && (blocked[ny * W + mx] === 1 || blocked[my * W + nx] === 1)) continue;
      const wkm = ((nav.wKm[ny] as number) + (nav.wKm[my] as number)) * 0.5;
      const km = dy === 0 ? wkm : dx === 0 ? nav.hKm : Math.sqrt(wkm * wkm + nav.hKm * nav.hKm);
      let factor = 1 + Math.abs((mean[m] as number) - (mean[n] as number)) * climbK;
      if ((mean[m] as number) > nearCeiling) factor += ceilK;
      if (lambda > 0) factor += lambda * exposedAt(nav, view, seat, mode, m);
      const g2 = gn + km * factor;
      if (gs[m] === gen && g2 >= (g[m] as number)) continue;
      gs[m] = gen;
      g[m] = g2;
      parent[m] = n;
      size = heapPush(nav, size, g2 + heuristic(m), m);
    }
  }
  if (!found) return FAIL; // cannot happen when the labels agree; kept as a guard
  const navCells: number[] = [];
  for (let n = b; n !== -1; n = parent[n] as number) navCells.push(n);
  navCells.reverse();
  // turning points: the start, every nav cell where the step direction changes, the goal
  const waypoints: number[] = [from];
  let pdx = 0;
  let pdy = 0;
  for (let i = 1; i < navCells.length; i++) {
    const p = navCells[i - 1] as number;
    const c = navCells[i] as number;
    let sx = (c % W) - (p % W);
    if (sx > 1) sx -= W;
    else if (sx < -1) sx += W;
    const sy = Math.floor(c / W) - Math.floor(p / W);
    if (i > 1 && (sx !== pdx || sy !== pdy)) waypoints.push(nav.centerOf(p));
    pdx = sx;
    pdy = sy;
  }
  waypoints.push(to);
  let len = 0;
  for (let i = 1; i < waypoints.length; i++) len += cellDistance(nav.simWidth, waypoints[i - 1] as number, waypoints[i] as number);
  const fuelCells = Math.ceil(len - 1e-9);
  const speed = AIR_MODE_SPEED_MILLICELLS_S[mode] as number;
  const etaTicks = Math.ceil((fuelCells * 1000 * TICK_HZ) / speed);
  nav.generation++; // exposure of the path is counted under its own stamp (the lambda = 0 search never evaluated it)
  let exposedCells = 0;
  for (const n of navCells) exposedCells += exposedAt(nav, view, seat, mode, n);
  return { ok: true, waypoints, fuelCells, etaTicks, exposedCells, navCells };
}

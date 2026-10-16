// The launch preview (M13b): what the deploy mode shows for the cell under the cursor. Pure TypeScript over the sim's read-only queries; the page owns the
// Nav (built once on the world's elevation layers, like the debug page does) and hands it in.
//
// NO RULE IS REPEATED HERE. The verdict is `validateLaunchHeli` (the very `checkLaunchHeli` the sim's LaunchHeli runs, so the preview and the intent agree by
// construction; `tests/app/launchPreview.test.ts` proves it against the real step path). The route, the ETA and the fuel come from `planRoute`, the colour of
// the route from `isExposed` over the enemy seats; they are only drawn, never decided on.
//
// THROTTLE. `LaunchPreviewer` runs at most ONE query at a time and at most `PREVIEW_MIN_INTERVAL_S` apart on the clock it is given (the fx clock in the
// page). The cursor can move on while a query is out: an answer that is no longer for the wanted request is dropped, and only the newest wanted request is
// ever sent next (older ones are replaced, not queued). The answer arrives as a Promise, as it will from a WorkerHost (M24a).
import { isExposed, planRoute, validateLaunchHeli, type AltMode, type Nav, type SimView } from '../sim/public';
import { TICK_HZ } from '../sim/rules';

export interface PreviewRequest {
  readonly factory: number;
  readonly lzCell: number;
  readonly troops: number;
  /** 0 = Low, 1 = High (the altMode of the intent). */
  readonly mode: AltMode;
}

export interface PreviewResult {
  readonly request: PreviewRequest;
  /** `validateLaunchHeli`: 0 = the launch would be accepted, else the REJECT_* / LZ reason code of the sim. */
  readonly reason: number;
  /** The planned route in sim cells (start, turning points, goal), or null when there is none. */
  readonly waypoints: readonly number[] | null;
  /** Per waypoint: 1 when an enemy sensor sees it in this flight mode, else 0. Same length as `waypoints`. */
  readonly exposed: Uint8Array | null;
  /** Flight time out, whole seconds (rounded up). */
  readonly etaSeconds: number;
  /** Route length in sim cells (the fuel the flight uses) and the nav cells of it that are exposed. */
  readonly fuelCells: number;
  readonly exposedCells: number;
}

/** Minimum clock seconds between two queries (5 Hz). */
export const PREVIEW_MIN_INTERVAL_S = 0.2;

/** Whether two requests ask the same thing (the four numbers; no string is built). */
export function sameRequest(a: PreviewRequest, b: PreviewRequest): boolean {
  return a.factory === b.factory && a.lzCell === b.lzCell && a.troops === b.troops && a.mode === b.mode;
}

/** The request as a string (kept for logs and tests; the previewer itself compares numbers). */
export function requestKey(r: PreviewRequest): string {
  return `${r.factory}:${r.lzCell}:${r.troops}:${r.mode}`;
}

/**
 * The preview for `seat`, answered synchronously from the snapshot `view` and the Nav built on it. The verdict is the sim's own check; the route is planned
 * from the Factory's cell in the same flight mode whenever one exists (also for a refused zone, so that "too far" still shows where the line would go).
 */
export function previewLaunch(nav: Nav, view: SimView, seat: number, req: PreviewRequest): PreviewResult {
  const reason = validateLaunchHeli(view, nav, seat, req.factory, req.lzCell, req.troops, req.mode);
  const f = req.factory;
  const valid = Number.isInteger(f) && f >= 0 && f < view.structures.highWater && (view.structures.owner[f] as number) !== 0;
  if (!valid || req.lzCell < 0 || req.lzCell >= nav.simWidth * nav.simHeight) return { request: req, reason, waypoints: null, exposed: null, etaSeconds: 0, fuelCells: 0, exposedCells: 0 };
  const route = planRoute(nav, view, seat, view.structures.cell[f] as number, req.lzCell, req.mode);
  if (!route.ok) return { request: req, reason, waypoints: null, exposed: null, etaSeconds: 0, fuelCells: 0, exposedCells: 0 };
  const exposed = new Uint8Array(route.waypoints.length);
  for (let i = 0; i < route.waypoints.length; i++) {
    for (let s = 0; s < view.seats; s++) {
      if (s === seat) continue;
      if (isExposed(nav.los, view, s, route.waypoints[i] as number, req.mode)) {
        exposed[i] = 1;
        break;
      }
    }
  }
  return { request: req, reason, waypoints: route.waypoints, exposed, etaSeconds: Math.ceil(route.etaTicks / TICK_HZ), fuelCells: route.fuelCells, exposedCells: route.exposedCells };
}

/** Where an answer of the previewer stands for the wanted request. */
export type PreviewStatus = 'idle' | 'pending' | 'ready';

export class LaunchPreviewer {
  private wanted: PreviewRequest | null = null;
  /** Which request is wanted / held / out, as a counter: it moves when the wanted request changes (0 = none), so no key string is built per frame. */
  private wantedId = 0;
  private nextId = 0;
  private inflight = false;
  private lastSent = -Infinity;
  private result: PreviewResult | null = null;
  private resultId = 0;
  /** Bumped by `clear`, so an answer to a question asked before it is thrown away. */
  private epoch = 0;
  /** Queries sent so far (tests: the throttle). */
  sent = 0;
  /** Answers thrown away because the wanted request had moved on (tests). */
  dropped = 0;

  constructor(
    private readonly query: (req: PreviewRequest) => Promise<PreviewResult>,
    private readonly minIntervalS: number = PREVIEW_MIN_INTERVAL_S,
  ) {}

  /** Says what is wanted now (the cell under the cursor, the sliders). Sends nothing by itself. */
  want(req: PreviewRequest | null): void {
    if (req === this.wanted) return;
    if (req !== null && this.wanted !== null && sameRequest(req, this.wanted)) {
      this.wanted = req; // the same question in a new object: nothing changes
      return;
    }
    this.wanted = req;
    this.wantedId = req === null ? 0 : ++this.nextId;
  }

  /** Once per frame with the clock: sends the wanted request when none is out, the interval is over and the answer we hold is not already for it. */
  poll(now: number): void {
    const w = this.wanted;
    if (w === null || this.inflight || this.wantedId === this.resultId || now - this.lastSent < this.minIntervalS) return;
    this.inflight = true;
    this.lastSent = now;
    this.sent++;
    const epoch = this.epoch;
    const id = this.wantedId;
    this.query(w).then(
      (res) => {
        this.inflight = false;
        if (epoch !== this.epoch || id !== this.wantedId) {
          this.dropped++;
          return;
        }
        this.result = res;
        this.resultId = id;
      },
      () => {
        this.inflight = false; // a failed query is simply not an answer
      },
    );
  }

  /** The answer for the CURRENT wanted request, or null while it is pending (an answer for an earlier request is never returned). */
  current(): PreviewResult | null {
    return this.result !== null && this.resultId === this.wantedId && this.wantedId !== 0 ? this.result : null;
  }

  status(): PreviewStatus {
    if (this.wanted === null) return 'idle';
    return this.current() !== null ? 'ready' : 'pending';
  }

  /** Forgets the wanted request and the held answer (the mode ended); a query still out will be dropped when it returns. */
  clear(): void {
    this.epoch++;
    this.wanted = null;
    this.wantedId = 0;
    this.result = null;
    this.resultId = 0;
    this.lastSent = -Infinity; // `inflight` stays: a query still out is the one outstanding query
  }
}

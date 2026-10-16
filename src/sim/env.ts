// The environment of a state that is NOT game state (M12a-1, the decision "M12 preparation: Los/Nav access inside step"): the occluder layer
// `maxElev` and the lazily built Los / Nav caches that the helicopter rules query from inside `step`. Derived data: never hashed, never
// serialised, dropped by `deserialize` (a restored state gets a fresh environment with the same `maxElev` handed in again). This file has no
// runtime imports, so `state.ts` can hold it without an import cycle; the builders and the queries are in `src/sim/access.ts`.
import type { Los } from './los/cache';
import type { Nav } from './nav/grid';
import type { NavView } from './nav/route';

export class SimEnv {
  /** Real maximum elevation in metres per cell (the occluder layer), or null when the world was built without it. */
  readonly maxElev: Int16Array | null;
  /** Built at the first query, then kept for the life of the state. */
  los: Los | null = null;
  nav: Nav | null = null;
  /** The reused read-only window of the state that the Los / Nav queries take (src/sim/access.ts). */
  view: NavView | null = null;

  constructor(maxElev: Int16Array | null) {
    this.maxElev = maxElev;
  }
}

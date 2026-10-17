// Los / Nav access from inside `step` (M12a-1). The caches live on `state.env` and are built at the first question, from the state's own
// terrain, elevation and row weights plus the occluder layer `maxElev` of the world. Everything here is derived: nothing is hashed or serialised,
// and a deserialized state builds its own on demand and answers the same questions the same way (the caches are pure functions of the state).
// A state whose world had no `maxElev` throws MissingOccluderError at the first question, not before: matches that never fly do not need it.
import { exposure } from './los/exposure';
import { createLos, ALT_MODE_LOW, type AltMode, type Los } from './los/cache';
import { createLosTerrain } from './los/terrain';
import { createNav, type Nav } from './nav/grid';
import { scoreLz, type LzResult } from './nav/lz';
import { planRoute, type NavView, type RouteResult } from './nav/route';
import { DiplomacyReader, type DiplomacyView } from './diplomacyTable';
import { AIR_EXPOSURE_LAMBDA } from './rules';
import type { StructureView } from './structureRules';
import type { GameState } from './state';

/** Thrown when a Los / Nav query is made on a state whose world was built without `maxElev` (a programming error of the loader). */
export class MissingOccluderError extends Error {
  constructor() {
    super('this world has no maxElev layer: pass maxElev to createSimWorld (or deserialize) before asking Los / Nav questions');
    this.name = 'MissingOccluderError';
  }
}

/** The state as the read-only source that Los.sync and planRoute take (tick, structures, terrain class, seats). */
class StateNavView implements NavView {
  readonly diplomacy: DiplomacyView;
  constructor(private readonly state: GameState) {
    this.diplomacy = new DiplomacyReader(state.diplo, state.header.players, () => state.tick);
  }
  get tick(): number {
    return this.state.tick;
  }
  get structures(): StructureView {
    return this.state.structures;
  }
  get terrainClass(): { readonly [index: number]: number } {
    return this.state.terrain;
  }
  get seats(): number {
    return this.state.header.seats;
  }
}

/** The state as a NavView (reused; one object per state). */
export function navViewOf(state: GameState): NavView {
  const env = state.env;
  if (env.view === null) env.view = new StateNavView(state);
  return env.view;
}

/** Does this state's world carry the occluder layer? */
export function hasOccluders(state: GameState): boolean {
  return state.env.maxElev !== null;
}

/** The line-of-sight cache of the state (built at the first call). Throws MissingOccluderError without `maxElev`. */
export function losOf(state: GameState): Los {
  const env = state.env;
  if (env.los !== null) return env.los;
  if (env.maxElev === null) throw new MissingOccluderError();
  env.los = createLos(createLosTerrain(state.width, state.height, state.rowCos, state.elevation, env.maxElev));
  return env.los;
}

/** The air-navigation grid of the state (built at the first call, on top of `losOf`). Throws MissingOccluderError without `maxElev`. */
export function navOf(state: GameState): Nav {
  const env = state.env;
  if (env.nav !== null) return env.nav;
  const los = losOf(state);
  env.nav = createNav({ width: state.width, height: state.height, terrainClass: state.terrain, meanElev: state.elevation }, los);
  return env.nav;
}

/** `exposure` (src/sim/los/exposure.ts) of a seat's helicopter at `cell`, asked of a live state. */
export function exposureOf(state: GameState, seat: number, cell: number, mode: AltMode = ALT_MODE_LOW): number {
  return exposure(losOf(state), navViewOf(state), seat, cell, mode);
}

/** `planRoute` (src/sim/nav/route.ts) asked of a live state. */
export function planRouteOf(state: GameState, seat: number, from: number, to: number, mode: AltMode = ALT_MODE_LOW, lambda: number = AIR_EXPOSURE_LAMBDA): RouteResult {
  return planRoute(navOf(state), navViewOf(state), seat, from, to, mode, lambda);
}

/** `scoreLz` (src/sim/nav/lz.ts) asked of a live state: the very function the UI calls on a snapshot. */
export function scoreLzOf(state: GameState, seat: number, cell: number, from: number, mode: AltMode = ALT_MODE_LOW): LzResult {
  return scoreLz(navOf(state), navViewOf(state), seat, cell, from, mode);
}

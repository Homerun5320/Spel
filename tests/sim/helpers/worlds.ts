// Small hand-made worlds for the territory tests: all numbers explicit, no randomness.
import { createState, type GameState } from '../../../src/sim/state';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../../src/sim/terrain';

export interface WorldOptions {
  readonly seed?: number;
  readonly seats?: number;
  readonly players?: number;
  readonly debug?: boolean;
  /** Overrides the terrain class of single cells. */
  readonly classAt?: (x: number, y: number) => number;
}

/** A width x height world that is Plains everywhere unless `classAt` says otherwise. */
export function landState(width: number, height: number, o: WorldOptions = {}): GameState {
  const terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) terrain[y * width + x] = o.classAt ? o.classAt(x, y) : CLASS_PLAINS;
  return createState({
    width,
    height,
    seed: o.seed ?? 1,
    seats: o.seats ?? 4,
    players: o.players,
    config: { debugIntents: o.debug === true },
    terrain,
    elevation: new Uint16Array(width * height),
  });
}

/** An island: a w x h block of Plains with its top left corner at (x0, y0), sea elsewhere. */
export function islandState(width: number, height: number, x0: number, y0: number, w: number, h: number, o: WorldOptions = {}): GameState {
  return landState(width, height, { ...o, classAt: (x, y) => (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h ? CLASS_PLAINS : CLASS_DEEP_SEA) });
}

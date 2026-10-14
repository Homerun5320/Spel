// SimWorld: the 1024x512 sim pack as the simulation wants it, built from plain arrays that the caller loaded (through
// src/data and fetch in the browser, through the fs variant in Node). src/sim does NOT import src/data; the input type
// below is structural, so a SimGrid of the data layer plus the cos table of meta.json fits it as it is.
import { validDimensions, createState, validRowCos, type GameState, type MatchConfig } from './state';

/** What the loader hands over. `terrainClass` uses the numbering of the baked pack (src/sim/terrain.ts). */
export interface SimWorldInput {
  readonly width: number;
  readonly height: number;
  /** Terrain class per cell. */
  readonly terrainClass: ArrayLike<number>;
  /** Mean elevation per cell in metres (negative at sea). */
  readonly meanElev: ArrayLike<number>;
  /** The committed Q15 cos(latitude) table: one value per row (`sim.cosQ15` of meta.json). */
  readonly cosQ15: ArrayLike<number>;
  /** Overrides the computed world hash (a real match passes the checksum of the sim pack). */
  readonly mapHash?: number;
}

export interface SimWorld {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  /** Mean elevation in metres, sea clamped to 0. */
  readonly elevation: Uint16Array;
  readonly rowCos: Uint16Array;
  readonly mapHash?: number;
}

/** Copies and checks the input. Throws RangeError for sizes that do not match (a programming error of the loader). */
export function createSimWorld(input: SimWorldInput): SimWorld {
  const { width, height } = input;
  if (!validDimensions(width, height)) throw new RangeError(`bad world size ${width}x${height}`);
  const n = width * height;
  if (input.terrainClass.length !== n || input.meanElev.length !== n) throw new RangeError('world arrays must be width * height long');
  if (input.cosQ15.length !== height) throw new RangeError('the cos table must have one value per row');
  const terrain = new Uint8Array(n);
  const elevation = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    terrain[i] = input.terrainClass[i] as number;
    const m = input.meanElev[i] as number;
    elevation[i] = m <= 0 ? 0 : m > 65535 ? 65535 : m;
  }
  const rowCos = new Uint16Array(height);
  for (let y = 0; y < height; y++) rowCos[y] = input.cosQ15[y] as number;
  if (!validRowCos(rowCos)) throw new RangeError('cos table values must be 0..32768');
  return input.mapHash === undefined ? { width, height, terrain, elevation, rowCos } : { width, height, terrain, elevation, rowCos, mapHash: input.mapHash };
}

export interface WorldMatchOptions {
  readonly seed: number;
  /** Seats in total, players first, then tribes. */
  readonly seats: number;
  /** How many seats are players (default: all). */
  readonly players?: number;
  readonly config?: Partial<MatchConfig>;
  /** The country id of every cell; required exactly when `config.homeRules` is on (M06, D112). */
  readonly countryMap?: ArrayLike<number>;
}

/** A state at tick 0 on a world. The world is copied; the state shares nothing with it. */
export function createWorldState(world: SimWorld, options: WorldMatchOptions): GameState {
  return createState({
    width: world.width,
    height: world.height,
    seed: options.seed,
    seats: options.seats,
    players: options.players,
    config: options.config,
    countryMap: options.countryMap,
    terrain: world.terrain,
    elevation: world.elevation,
    rowCos: world.rowCos,
    mapHash: world.mapHash,
  });
}

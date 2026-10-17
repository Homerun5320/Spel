// Terrain class numbers of the baked sim pack (the same values as TerrainClass in src/data/format.ts; src/sim does not
// import src/data, a test keeps the two in step) and the playable test, which is the cost table of rules.ts.
import { TERRAIN_COST_PCT } from './rules';

export const CLASS_DEEP_SEA = 0;
export const CLASS_SHALLOWS = 1;
export const CLASS_PLAINS = 2;
export const CLASS_FOREST = 3;
export const CLASS_HILLS = 4;
export const CLASS_MOUNTAIN = 5;
export const CLASS_PEAK = 6;
export const CLASS_ICE = 7;
export const CLASS_COUNT = 8;

/** Can a cell of this class be owned, spawned on and attacked into? (Sea, Shallows, Peak and Ice cannot.) */
export function isPlayableClass(cls: number): boolean {
  return cls >= 0 && cls < CLASS_COUNT && (TERRAIN_COST_PCT[cls] as number) > 0;
}

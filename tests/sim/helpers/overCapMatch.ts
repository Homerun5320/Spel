// M05fix: the counterexample the flake hunt found for the territory property "troops stay within the cap" (D111). On the 40x24 match
// of tests/sim/territoryProperties.test.ts (seed 46939, 5 seats, 3 players, terrain from the test's class table) the tribe of
// owner 4 holds its full cap, owner 2 takes one of its cells at tick 10, the cap falls from 4721 to 4713 and the 4720 troops stay
// above it while the economy decays the surplus slowly. Used by the property (as an explicit example) and by tests/sim/overCap.test.ts.
import type { Intent } from '../../../src/sim/intents';
import { createState, type GameState } from '../../../src/sim/state';
import { CLASS_DEEP_SEA, CLASS_FOREST, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS } from '../../../src/sim/terrain';

const W = 40;
const H = 24;
const CLASSES = [CLASS_PLAINS, CLASS_FOREST, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_DEEP_SEA, CLASS_PLAINS, CLASS_PLAINS];

/** The 40x24 match of the territory properties: 5 seats, 3 players, terrain from the class table by an integer hash of the cell and the seed. */
export function freshTerritoryMatch(seed: number, debug: boolean): GameState {
  const terrain = new Uint8Array(W * H);
  for (let i = 0; i < terrain.length; i++) terrain[i] = CLASSES[(Math.imul(i ^ seed, 2654435761) >>> 20) & 7] as number;
  return createState({ width: W, height: H, seed, seats: 5, players: 3, config: { debugIntents: debug }, terrain, elevation: new Uint16Array(W * H) });
}

export const OVER_CAP_MATCH = {
  seed: 46939,
  turns: [
    [{ kind: 'Spawn', seat: 1, id: 0, cell: 554 }],
    [{ kind: 'Spawn', seat: 3, id: 0, cell: 0 }],
    [{ kind: 'Attack', seat: 1, id: 0, target: 4, pct: 66 }],
    ...Array.from({ length: 7 }, () => [] as Intent[]),
  ] as Intent[][],
  debug: false,
};

/**
 * The second counterexample (found at 200 times the usual run count, 1 match in about 19 000): the tribe of owner 5 sits at its cap 4703,
 * commits 235 QT to an attack on owner 2, regenerates to 4469, and when the attack is cancelled at tick 9 the 235 QT go back: 4704 against
 * the cap 4703. The committed troops live outside the pool the cap limits (D82), so a refund can lift a seat over the cap; the economy decays it.
 */
export const REFUND_OVER_CAP_MATCH = {
  seed: 0,
  turns: [
    [{ kind: 'Spawn', seat: 4, id: 0, cell: 893 }],
    [{ kind: 'Spawn', seat: 1, id: 0, cell: 53 }],
    [{ kind: 'Attack', seat: 4, id: 0, target: 2, pct: 1 }],
    ...Array.from({ length: 5 }, () => [] as Intent[]),
    [{ kind: 'CancelAttack', seat: 4, id: 0, target: 2 }],
    [] as Intent[],
  ] as Intent[][],
  debug: false,
};

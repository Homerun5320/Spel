// A big open world for the conquest stress tests: every cell Plains, uniform row weights small enough for the 32-bit weight
// sums (so the 1024x512 grid is all playable), owner 1 holding a strip of columns and attacking unowned land with an
// enormous pool of troops. Used by the burst perf test and by the work-counter tests.
import { applyAttack } from '../../src/sim/conquest';
import { createState, type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';

/** Q15 weight of every row: 524288 cells * 8000 < 2^32, so the whole map can be playable. */
export const BURST_ROW_WEIGHT = 8000;

export interface BurstOptions {
  readonly width?: number;
  readonly height?: number;
  /** Columns held by the attacker (default 2). */
  readonly strip?: number;
  readonly seed?: number;
}

/** The attacker (ownerId 1) holds the first `strip` columns and has launched an all-in attack on unowned land. */
export function makeBurstState(o: BurstOptions = {}): GameState {
  const width = o.width ?? 1024;
  const height = o.height ?? 512;
  const strip = o.strip ?? 2;
  const s = createState({
    width,
    height,
    seed: o.seed ?? 1,
    seats: 4,
    terrain: new Uint8Array(width * height).fill(2),
    elevation: new Uint16Array(width * height),
    rowCos: new Uint16Array(height).fill(BURST_ROW_WEIGHT),
  });
  for (let y = 0; y < height; y++) for (let x = 0; x < strip; x++) setOwner(s, y * width + x, 1, 0);
  s.troops[1] = 4000000000;
  if (applyAttack(s, 0, 0, 100) !== 0) throw new Error('burst attack was refused');
  s.outbox.clear();
  return s;
}

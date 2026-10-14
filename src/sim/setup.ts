// Match setup in the sim (M06): what happens to a fresh state before tick 0. Pure functions of their arguments; the order of the
// seats is the caller's. Nothing here runs during play.
//  - `maskTerrain`: the playable mask (D115). A cell outside the mask that could be owned becomes Ice, so the sim's own playable grid
//    (Spawn, Attack, the frontier, the enclave rule) keeps every owner inside the mask; there is no second check to forget.
//  - `startSeats`: the pre-placed capitals of the fair start (D112): each seat Spawns at its cell at tick 0 through the same
//    `applySpawn` an intent would use (the K nearest contiguous unowned land cells, hash tie-break), gets the same start troops and
//    gold, and, in a match with home rules, its home land and trait multipliers.
import { CLASS_ICE, isPlayableClass } from './terrain';
import { setOwnerRules, type SeatRules } from './homeRules';
import { REJECT_NONE } from './intents';
import { applySpawn } from './spawn';
import { seatToOwner, type GameState } from './state';

/** A copy of `terrain` in which every playable cell outside `mask` (1 = inside) is Ice. A null mask changes nothing. */
export function maskTerrain(terrain: ArrayLike<number>, mask: ArrayLike<number> | null): Uint8Array {
  const out = new Uint8Array(terrain.length);
  for (let i = 0; i < terrain.length; i++) {
    const c = terrain[i] as number;
    out[i] = mask !== null && (mask[i] as number) === 0 && isPlayableClass(c) ? CLASS_ICE : c;
  }
  return out;
}

export interface SeatStart {
  readonly seat: number;
  /** The capital cell. */
  readonly cell: number;
  /** Home land and traits; used only when the state has home rules. */
  readonly rules?: SeatRules;
}

/**
 * Spawns the seats in the given order at tick 0 and returns, per start, the REJECT code of its Spawn (REJECT_NONE = placed). A seat whose
 * Spawn is refused is left unplaced. Throws RangeError when the state is not at tick 0 (a programming error: the setup happens before play).
 */
export function startSeats(state: GameState, starts: readonly SeatStart[]): number[] {
  if (state.tick !== 0) throw new RangeError('seats are placed at tick 0');
  const codes: number[] = [];
  for (const s of starts) {
    const code = applySpawn(state, s.seat, s.cell, 0);
    if (code === REJECT_NONE && state.home !== null && s.rules !== undefined) setOwnerRules(state.home, seatToOwner(s.seat), s.rules);
    codes.push(code);
  }
  return codes;
}

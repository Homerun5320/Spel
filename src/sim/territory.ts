// Who owns which cell. setOwner is the ONLY function that writes state.owner during play: it keeps the per-owner
// aggregates (cells, Q15 weight) in step and reports the change to the render-only outbox. Conquest (M04 part B) and
// the debug paint go through it too.
import { OUTBOX_PAINT } from './outbox';
import { WEIGHT_ONE } from './rules';
import { NO_OWNER, type GameState } from './state';

/**
 * Gives a cell to `owner` (an ownerId, or NO_OWNER to free it), stamps it with the id of the intent or attack that did it
 * and tells the outbox. Does nothing but the stamp when the owner does not change. `owner` must be 0..seats.
 */
export function setOwner(state: GameState, cell: number, owner: number, stamp: number): void {
  const prev = state.owner[cell] as number;
  state.stamp[cell] = stamp;
  if (prev === owner) return;
  const weight = state.grid.weight(cell);
  const { area, warea } = state.agg;
  if (prev !== NO_OWNER) {
    area[prev] = (area[prev] as number) - 1;
    warea[prev] = (warea[prev] as number) - weight;
  }
  if (owner !== NO_OWNER) {
    area[owner] = (area[owner] as number) + 1;
    warea[owner] = (warea[owner] as number) + weight;
  }
  state.owner[cell] = owner;
  state.outbox.push(OUTBOX_PAINT, state.tick, cell, owner);
}

/** The share of all playable land an owner holds, cos-weighted, as a Q15 fraction (32768 = all of it). 0 when the world has no playable land. */
export function landShareQ15(state: GameState, owner: number): number {
  const total = state.grid.totalWeight;
  if (total === 0) return 0;
  return Math.floor(((state.agg.warea[owner] as number) * WEIGHT_ONE) / total);
}

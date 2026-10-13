// Where an AI seat plants its capital: a seeded search for a place that the sim's Spawn will accept and that is worth having
// (a whole capital disc of playable land, nobody else's land close by), near the anchor (the human's capital) when there is one.
// Reads the view only.
import { NO_OWNER, START_DISC_RADIUS_CELLS, AI_SPAWN_TRIES, isPlayableClass, nextBelow, type SimView } from '../sim/public';

const R = START_DISC_RADIUS_CELLS;
/** The clearance never drops below this, so two capitals never overlap. */
const MIN_CLEARANCE = R + 2;

/** Is every cell of the capital disc around (x, y) playable? (x wraps around the world; y is already inside by R.) */
function discIsLand(view: SimView, x: number, y: number): boolean {
  const w = view.width;
  const terrain = view.terrainClass;
  for (let dy = -R; dy <= R; dy++) {
    const row = (y + dy) * w;
    const reach = Math.floor(Math.sqrt(R * R - dy * dy));
    for (let dx = -reach; dx <= reach; dx++) {
      const xx = (x + dx + w) % w;
      if (!isPlayableClass(terrain[row + xx] as number)) return false;
    }
  }
  return true;
}

/** Is there no owned cell within `clearance` cells (a square, sampled every second cell) of (x, y)? */
function isClear(view: SimView, x: number, y: number, clearance: number): boolean {
  const w = view.width;
  const owner = view.owner;
  const y0 = Math.max(0, y - clearance);
  const y1 = Math.min(view.height - 1, y + clearance);
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * w;
    for (let dx = -clearance; dx <= clearance; dx += 2) {
      if ((owner[row + ((x + dx + w) % w)] as number) !== NO_OWNER) return false;
    }
  }
  return true;
}

/**
 * A cell to Spawn on, or -1 when none was found in AI_SPAWN_TRIES random places.
 *  - `anchor` (a cell, or -1): the first half of the tries stay within `reach` cells of it (a square, x wrapping); the second half
 *    ignore it, so a human on a small island does not leave the AI without a capital.
 *  - the clearance (cells to the nearest owned cell) is halved after every quarter of the tries, down to a floor, so that a
 *    crowded map still finds a place.
 */
export function pickSpawnCell(view: SimView, rng: Uint32Array, clearance: number, anchor = -1, reach = 0): number {
  const w = view.width;
  const h = view.height;
  if (h <= 2 * R) return -1;
  const quarter = Math.max(1, Math.floor(AI_SPAWN_TRIES / 4));
  const ax = anchor >= 0 ? anchor % w : 0;
  const ay = anchor >= 0 ? (anchor - ax) / w : 0;
  const side = 2 * reach + 1;
  let need = clearance;
  for (let i = 0; i < AI_SPAWN_TRIES; i++) {
    if (i > 0 && i % quarter === 0) need = Math.max(MIN_CLEARANCE, Math.floor(need / 2));
    let x: number;
    let y: number;
    if (anchor >= 0 && reach > 0 && i < AI_SPAWN_TRIES / 2) {
      x = (ax + nextBelow(rng, side) - reach + w) % w;
      y = ay + nextBelow(rng, side) - reach;
      if (y < R || y >= h - R) continue;
    } else {
      x = nextBelow(rng, w);
      y = R + nextBelow(rng, h - 2 * R);
    }
    const cell = y * w + x;
    if (!isPlayableClass(view.terrainClass[cell] as number) || (view.owner[cell] as number) !== NO_OWNER) continue;
    if (!discIsLand(view, x, y) || !isClear(view, x, y, need)) continue;
    return cell;
  }
  return -1;
}

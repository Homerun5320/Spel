// Checks on a built match shared by the setup tests: who owns what at tick 0.
import type { GameState } from '../../src/sim/state';

/** The cells an owner holds. */
export function ownedCells(state: GameState, owner: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.owner.length; i++) if (state.owner[i] === owner) out.push(i);
  return out;
}

/** Are the cells of an owner one 4-neighbour connected piece (x wraps, y does not)? */
export function isConnected(state: GameState, owner: number): boolean {
  const cells = ownedCells(state, owner);
  if (cells.length === 0) return false;
  const w = state.width;
  const h = state.height;
  const seen = new Set<number>([cells[0] as number]);
  const queue = [cells[0] as number];
  while (queue.length > 0) {
    const c = queue.pop() as number;
    const x = c % w;
    const y = (c - x) / w;
    for (const m of [y > 0 ? c - w : -1, y + 1 < h ? c + w : -1, y * w + ((x + 1) % w), y * w + ((x + w - 1) % w)]) {
      if (m >= 0 && state.owner[m] === owner && !seen.has(m)) {
        seen.add(m);
        queue.push(m);
      }
    }
  }
  return seen.size === cells.length;
}

/** Squared distance between two cells on the cylinder. */
export function dist2(width: number, a: number, b: number): number {
  const ax = a % width;
  const bx = b % width;
  const dx0 = Math.abs(ax - bx);
  const dx = Math.min(dx0, width - dx0);
  const dy = (a - ax) / width - (b - bx) / width;
  return dx * dx + dy * dy;
}

/** The largest distance from a cell to the cells of an owner. */
export function maxDistanceFrom(state: GameState, owner: number, cell: number): number {
  let best = 0;
  for (const c of ownedCells(state, owner)) best = Math.max(best, dist2(state.width, c, cell));
  return Math.sqrt(best);
}

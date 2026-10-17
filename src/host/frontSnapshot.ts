// The attack fronts on their way to the page (M20a-2), in the pattern of the beachhead snapshot: `snapshotFronts` copies the description of the attacks running (src/sim/view.ts
// `fillAttackFronts`) into plain typed arrays, `frontSignature` is a cheap fingerprint the host uses to send them in a frame's diff only when they changed. Both are called
// by the host, never the page. The front of a running attack moves all the time, so while one runs the signature also changes every FRONT_REFRESH_TICKS ticks.
import type { GameState } from '../sim/state';
import { ATTACK_VIEW_CAP, createAttackFrontData, fillAttackFronts } from '../sim/view';
import type { AttackFrontSnapshot } from './protocol';

/** Ticks between two front snapshots while an attack runs (10 ticks = once a second). */
export const FRONT_REFRESH_TICKS = 10;

/** A snapshot with no rows (what a mirror holds before the first one). */
export const NO_FRONTS: AttackFrontSnapshot = Object.freeze({
  count: 0,
  id: new Uint32Array(0),
  attacker: new Uint16Array(0),
  target: new Uint16Array(0),
  cell: new Int32Array(0),
  dirX: new Int8Array(0),
  dirY: new Int8Array(0),
});

const scratch = createAttackFrontData();

/** The fronts of the attacks running now (at most ATTACK_VIEW_CAP rows). */
export function snapshotFronts(state: GameState): AttackFrontSnapshot {
  if (state.attacks.list.length === 0) return NO_FRONTS;
  fillAttackFronts(state, scratch);
  const n = scratch.count;
  if (n === 0) return NO_FRONTS;
  return { count: n, id: scratch.id.slice(0, n), attacker: scratch.attacker.slice(0, n), target: scratch.target.slice(0, n), cell: scratch.cell.slice(0, n), dirX: scratch.dirX.slice(0, n), dirY: scratch.dirY.slice(0, n) };
}

/** A 32-bit fingerprint: the attacks (id, owners) of the first ATTACK_VIEW_CAP and, while any runs, the refresh period of the tick. Costs nothing without attacks. */
export function frontSignature(state: GameState): number {
  const list = state.attacks.list;
  let h = 0x811c9dc5;
  const fold = (x: number): void => {
    h = Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0;
  };
  const n = list.length < ATTACK_VIEW_CAP ? list.length : ATTACK_VIEW_CAP;
  fold(n);
  if (n === 0) return h;
  fold(Math.floor(state.tick / FRONT_REFRESH_TICKS));
  for (let i = 0; i < n; i++) {
    const a = list[i] as (typeof list)[number];
    fold(a.id);
    fold(a.attacker);
    fold(a.target);
  }
  return h;
}

// Hostility is a relation, not "another seat" (M12b, decision (b) of "Audit 3 downstream decisions"): `hostile(a, b)` is true unless the two parties are the
// same or have a truce or an alliance. ONE predicate for the route planner (planRoute), the landing-zone rating (scoreLz, ENEMY_CITY_NEAR), the route preview's
// exposure colour and the air-defence rules of the sim (src/sim/airDefense.ts). A view without a `diplomacy` window (a test view, a fixture) treats every other
// party as hostile, which is exactly the war-by-default of a fresh match, so the navigation fingerprints do not move.
import { RELATION_WAR, type DiplomacyView } from './diplomacyTable';

/** What the predicate reads: the optional diplomacy window of a SimView. */
export interface HostileSource {
  readonly diplomacy?: DiplomacyView;
}

/** Are seats `a` and `b` hostile to each other? A seat is never hostile to itself; a tribe or a seat out of range is always hostile. */
export function hostileSeats(src: HostileSource, a: number, b: number): boolean {
  if (a === b) return false;
  const d = src.diplomacy;
  return d === undefined || d.relation(a, b) === RELATION_WAR;
}

/** The same question for ownerIds (owner = seat + 1; owner 0 = nobody, hostile to everyone but itself). */
export function hostileOwners(src: HostileSource, ownerA: number, ownerB: number): boolean {
  if (ownerA === ownerB) return false;
  if (ownerA === 0 || ownerB === 0) return true;
  return hostileSeats(src, ownerA - 1, ownerB - 1);
}

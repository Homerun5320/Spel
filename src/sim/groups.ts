// Groups of seats (M18b-3): a FEDERATION is the set of player seats that federation-bound alliances link (`bindFederation`, ALLIANCE with `until`
// ALLIANCE_FEDERATION). The groups are DERIVED from the diplomacy table on every call, so there is no new state, no new serialised byte and no new hash
// word. A seat without a federation is a group of one; a match without a bound pair takes the exact code path it had before M18b-3 (`federationRoots` is null).
// An eliminated seat loses all its relations (clearDiplomacyOf), so it leaves its group: the group lives on in its remaining members.
// The root of a group is its lowest ownerId; it is the group's representative (the winner, the leader, the holder of the land timer).
import { ALLIANCE_FEDERATION, RELATION_ALLIANCE, type DiplomacyTable } from './diplomacyTable';
import type { GameState } from './state';

let rootScratch = new Uint16Array(0);
const sumScratch: number[] = [];

function hasFederationPair(d: DiplomacyTable): boolean {
  const pairs = d.pairs;
  for (let i = 0; i < pairs.length; i++) {
    const key = pairs[i] as number;
    if (d.relation[key] === RELATION_ALLIANCE && d.until[key] === ALLIANCE_FEDERATION) return true;
  }
  return false;
}

/**
 * The group root (lowest ownerId of the group) of every ownerId in a shared scratch array of ownerSlots length (valid until the next call; index 0 and the
 * tribes are their own roots). Null when no federation pair exists: every seat is its own group and the caller keeps its plain code path.
 * O(pairs + slots), no allocation after the first call.
 */
export function federationRoots(state: GameState): Uint16Array | null {
  const d = state.diplo;
  if (!hasFederationPair(d)) return null;
  const s = d.slots;
  if (rootScratch.length < s) rootScratch = new Uint16Array(s);
  const r = rootScratch;
  for (let o = 0; o < s; o++) r[o] = o;
  const pairs = d.pairs;
  for (let i = 0; i < pairs.length; i++) {
    const key = pairs[i] as number;
    if (d.relation[key] !== RELATION_ALLIANCE || d.until[key] !== ALLIANCE_FEDERATION) continue;
    let a = Math.floor(key / s);
    let b = key - a * s;
    while (r[a] !== a) a = r[a] as number;
    while (r[b] !== b) b = r[b] as number;
    if (a < b) r[b] = a;
    else if (b < a) r[a] = b;
  }
  for (let o = 1; o < s; o++) {
    let a = o;
    while (r[a] !== a) a = r[a] as number;
    r[o] = a;
  }
  return r;
}

/** A zeroed shared scratch of at least `n` plain numbers (for per-group weight sums, which exceed 32 bits; valid until the next call). */
export function groupSumScratch(n: number): number[] {
  for (let i = 0; i < n; i++) sumScratch[i] = 0;
  return sumScratch;
}

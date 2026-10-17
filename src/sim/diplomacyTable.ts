// The diplomacy table (M18c-1): who is at war, truce or alliance with whom, the open proposals, the betrayal cooldowns and who put an embargo on whom.
// Game state: serialised and hashed (src/sim/serialize.ts). The rules that change it are in src/sim/diplomacy.ts; this file is storage, the read-only
// `DiplomacyView` the UI and the AI read through `SimView.diplomacy`, and the hash fold. Plain integers and typed arrays only.
//
// Everything stored here is indexed by ownerId (seat + 1, like the attack and structure tables); the VIEW speaks in seats (0-based), like the intents.
// Relations are only ever between two player seats (never a tribe, never the neutral owner 0).
import { foldU32, foldWord } from './hash';
import { PROPOSAL_CAPACITY } from './rules';
import { ownerToSeat, seatToOwner } from './state';

/** Relation values. War is the default for every pair. */
export const RELATION_WAR = 0;
export const RELATION_TRUCE = 1;
export const RELATION_ALLIANCE = 2;

/**
 * The `until` value of an ALLIANCE that a federation binds (M18b-2): the sub-nations of one federation are allied from tick 0 and none of them can break it.
 * An ordinary alliance has `until` 0; no proposal or acceptance ever creates the bound one, only the match setup (`bindFederation`, src/sim/diplomacy.ts).
 */
export const ALLIANCE_FEDERATION = 1;

/** Treaty kinds of a proposal (the `treaty` field of ProposeTreaty): they equal the relation they create. */
export const TREATY_TRUCE = 1;
export const TREATY_ALLIANCE = 2;

/** "No event is due" for the derived `nextEvent`. */
const NEVER = 0xffffffff;

export class DiplomacyTable {
  readonly slots: number;
  /** Relation per (ownerId a, ownerId b), index a * slots + b, kept symmetric by `setRelation`. */
  readonly relation: Uint8Array;
  /** The tick a truce ends at (it is war from that tick on), symmetric like `relation`; 0 for war and alliance. */
  readonly until: Uint32Array;
  /** 1 at imposer * slots + target when the imposer put an embargo on the target (the trade effect lives in StructureTable.embargo, kept equal by the rules). */
  readonly embargoBy: Uint8Array;
  /** Per ownerId: the tick from which the owner may propose again after it broke a treaty (0 or a past tick = free). */
  readonly cooldownUntil: Uint32Array;
  /** The open proposals in creation order, `propCount` of them: sender, receiver (ownerIds), treaty kind and the tick they are gone from. */
  propCount = 0;
  readonly propFrom = new Uint16Array(PROPOSAL_CAPACITY);
  readonly propTo = new Uint16Array(PROPOSAL_CAPACITY);
  readonly propKind = new Uint8Array(PROPOSAL_CAPACITY);
  readonly propExpire = new Uint32Array(PROPOSAL_CAPACITY);
  /** Derived, not state: the earliest tick at which a truce ends or a proposal runs out (NEVER when none). */
  nextEvent = NEVER;
  /** Derived, not state: pairs (a < b) that are not at war, as a * slots + b. */
  readonly pairs: number[] = [];
  /** Not state: counts every change, so a host can send the table to the page only when it moved. */
  version = 0;

  constructor(ownerSlotCount: number) {
    this.slots = ownerSlotCount;
    this.relation = new Uint8Array(ownerSlotCount * ownerSlotCount);
    this.until = new Uint32Array(ownerSlotCount * ownerSlotCount);
    this.embargoBy = new Uint8Array(ownerSlotCount * ownerSlotCount);
    this.cooldownUntil = new Uint32Array(ownerSlotCount);
  }

  /** The relation between two ownerIds as stored (a truce that has run out but has not been swept yet still reads as a truce; `DiplomacyReader` is the tick-aware reader). */
  relationOf(a: number, b: number): number {
    return a === b || a < 0 || b < 0 || a >= this.slots || b >= this.slots ? RELATION_WAR : (this.relation[a * this.slots + b] as number);
  }

  /** Sets the relation of a pair in both directions (`until` is the end tick of a truce, 0 otherwise). */
  setRelation(a: number, b: number, rel: number, until: number): void {
    const s = this.slots;
    this.relation[a * s + b] = rel;
    this.relation[b * s + a] = rel;
    this.until[a * s + b] = until;
    this.until[b * s + a] = until;
    this.version++;
    this.trackPair(a, b);
  }

  embargoFrom(a: number, b: number): boolean {
    return a >= 0 && b >= 0 && a < this.slots && b < this.slots && this.embargoBy[a * this.slots + b] === 1;
  }

  /** Index of the open proposal from `from` to `to`, or -1. */
  findProposal(from: number, to: number): number {
    for (let i = 0; i < this.propCount; i++) if (this.propFrom[i] === from && this.propTo[i] === to) return i;
    return -1;
  }

  /** Appends a proposal (the caller has checked that the table has room and the directed pair is free). */
  addProposal(from: number, to: number, kind: number, expire: number): void {
    const i = this.propCount++;
    this.propFrom[i] = from;
    this.propTo[i] = to;
    this.propKind[i] = kind;
    this.propExpire[i] = expire;
    this.version++;
    this.rebuildDerived();
  }

  /** Removes the proposal at index i, keeping the order of the others. */
  removeProposalAt(i: number): void {
    for (let k = i; k + 1 < this.propCount; k++) {
      this.propFrom[k] = this.propFrom[k + 1] as number;
      this.propTo[k] = this.propTo[k + 1] as number;
      this.propKind[k] = this.propKind[k + 1] as number;
      this.propExpire[k] = this.propExpire[k + 1] as number;
    }
    this.propCount--;
    this.propFrom[this.propCount] = 0;
    this.propTo[this.propCount] = 0;
    this.propKind[this.propCount] = 0;
    this.propExpire[this.propCount] = 0;
    this.version++;
    this.rebuildDerived();
  }

  /** Removes every open proposal between two owners, in both directions. */
  removeProposalsBetween(a: number, b: number): void {
    for (let i = this.propCount - 1; i >= 0; i--) {
      const f = this.propFrom[i] as number;
      const t = this.propTo[i] as number;
      if ((f === a && t === b) || (f === b && t === a)) this.removeProposalAt(i);
    }
  }

  /** Recomputes the derived parts (the list of pairs that are not at war and the next due tick) from the stored arrays. Cheap: O(slots^2) only when asked by deserialize, otherwise O(pairs + proposals). */
  rebuildDerived(): void {
    let next = NEVER;
    for (let k = 0; k < this.pairs.length; k++) {
      const key = this.pairs[k] as number;
      if (this.relation[key] === RELATION_TRUCE && (this.until[key] as number) < next) next = this.until[key] as number;
    }
    for (let i = 0; i < this.propCount; i++) if ((this.propExpire[i] as number) < next) next = this.propExpire[i] as number;
    this.nextEvent = next;
  }

  /** Rebuilds the list of pairs from the matrix (deserialize), then the rest of the derived parts. */
  rebuildPairs(): void {
    this.pairs.length = 0;
    const s = this.slots;
    for (let a = 1; a < s; a++) for (let b = a + 1; b < s; b++) if (this.relation[a * s + b] !== RELATION_WAR) this.pairs.push(a * s + b);
    this.rebuildDerived();
  }

  /** Keeps `pairs` in step after a change of one pair (called by the rules through setRelationTracked). */
  trackPair(a: number, b: number): void {
    const key = a < b ? a * this.slots + b : b * this.slots + a;
    const at = this.pairs.indexOf(key);
    const peace = this.relation[key] !== RELATION_WAR;
    if (peace && at < 0) this.pairs.push(key);
    else if (!peace && at >= 0) this.pairs.splice(at, 1);
    this.rebuildDerived();
  }

  /** How many other owners (ownerIds 1..players) the owner has a truce or an alliance with at `tick`. */
  activeCountOf(owner: number, tick: number, players: number): number {
    let n = 0;
    const s = this.slots;
    for (let o = 1; o <= players; o++) {
      if (o === owner) continue;
      const rel = this.relation[owner * s + o] as number;
      if (rel === RELATION_ALLIANCE || (rel === RELATION_TRUCE && (this.until[owner * s + o] as number) > tick)) n++;
    }
    return n;
  }
}

/** Does the pair carry anything in either direction (a relation or an end tick)? */
function pairUsed(d: DiplomacyTable, a: number, b: number): boolean {
  const s = d.slots;
  return d.relation[a * s + b] !== 0 || d.relation[b * s + a] !== 0 || d.until[a * s + b] !== 0 || d.until[b * s + a] !== 0;
}

/** Number of stored pairs, embargoes and proposals (what serialisation counts). */
export function diplomacyCounts(d: DiplomacyTable): { pairs: number; embargoes: number; proposals: number } {
  let pairs = 0;
  let embargoes = 0;
  const s = d.slots;
  for (let a = 1; a < s; a++) {
    for (let b = a + 1; b < s; b++) if (pairUsed(d, a, b)) pairs++;
  }
  for (let i = 0; i < d.embargoBy.length; i++) if (d.embargoBy[i] !== 0) embargoes++;
  return { pairs, embargoes, proposals: d.propCount };
}

/**
 * Folds the diplomacy table and the two treaty statistics into the running hash: the non-war pairs by ascending (a, b), the embargo owners by ascending
 * index, the cooldowns, the proposals in order, then the statistics. `made` and `broken` are the per-owner counters of MatchState.
 */
export function foldDiplomacy(h: number, d: DiplomacyTable, made: Uint32Array, broken: Uint32Array): number {
  const s = d.slots;
  let x = foldWord(h, s);
  let n = 0;
  for (let a = 1; a < s; a++) for (let b = a + 1; b < s; b++) if (pairUsed(d, a, b)) n++;
  x = foldWord(x, n);
  for (let a = 1; a < s; a++) {
    for (let b = a + 1; b < s; b++) {
      if (!pairUsed(d, a, b)) continue;
      x = foldWord(x, a);
      x = foldWord(x, b);
      x = foldWord(x, d.relation[a * s + b] as number);
      x = foldWord(x, d.until[a * s + b] as number);
      // The mirrored entry is part of the state too: a table whose two directions differ must not hash like a symmetric one.
      x = foldWord(x, (d.relation[b * s + a] as number) | ((d.until[b * s + a] as number) << 8));
    }
  }
  n = 0;
  for (let i = 0; i < d.embargoBy.length; i++) if (d.embargoBy[i] !== 0) n++;
  x = foldWord(x, n);
  for (let i = 0; i < d.embargoBy.length; i++) if (d.embargoBy[i] !== 0) x = foldWord(x, i);
  x = foldU32(x, d.cooldownUntil);
  x = foldWord(x, d.propCount);
  for (let i = 0; i < d.propCount; i++) {
    x = foldWord(x, d.propFrom[i] as number);
    x = foldWord(x, d.propTo[i] as number);
    x = foldWord(x, d.propKind[i] as number);
    x = foldWord(x, d.propExpire[i] as number);
  }
  x = foldU32(x, made);
  return foldU32(x, broken);
}

/**
 * The read-only diplomacy window of a match (`SimView.diplomacy`). Seats are 0-based, like the intents. A truce whose end tick has come reads as war.
 * `ticksLeft` values are in sim ticks (TICK_HZ per second).
 */
export interface DiplomacyView {
  /** RELATION_WAR, RELATION_TRUCE or RELATION_ALLIANCE between two seats (war for a seat with itself, a tribe or a seat out of range). */
  relation(a: number, b: number): number;
  /** Ticks left of the truce between two seats, 0 when there is none. */
  truceTicksLeft(a: number, b: number): number;
  /** The treaty (TREATY_TRUCE, TREATY_ALLIANCE) of the open proposal from `from` to `to`, 0 when there is none. */
  proposalKind(from: number, to: number): number;
  /** Ticks left of that proposal, 0 when there is none. */
  proposalTicksLeft(from: number, to: number): number;
  /** The open proposals, in creation order: `proposalCount` of them; `proposalFrom(i)`, `proposalTo(i)` (seats), `proposalTreaty(i)`, `proposalLeft(i)` (ticks). */
  readonly proposalCount: number;
  proposalFrom(i: number): number;
  proposalTo(i: number): number;
  proposalTreaty(i: number): number;
  proposalLeft(i: number): number;
  /** Ticks left of the betrayal cooldown of a seat (it may not propose before), 0 when it is free. */
  breakCooldownLeft(seat: number): number;
  /** Whether trade between the two seats is under embargo (either of them put it on). */
  embargo(a: number, b: number): boolean;
  /** Whether seat `a` itself put an embargo on `b` (the one `a` can lift). */
  embargoFrom(a: number, b: number): boolean;
  /** How many other players the seat has a truce or an alliance with right now. */
  activeRelations(seat: number): number;
  /** Whether the two seats are allied by one federation (M18b-2): that alliance cannot be broken. */
  federationBound(a: number, b: number): boolean;
}

/** A `DiplomacyView` over a table and a clock (the live state's tick, or the mirror's). No allocation per call. */
export class DiplomacyReader implements DiplomacyView {
  constructor(
    private readonly table: DiplomacyTable,
    private readonly players: number,
    private readonly now: () => number,
  ) {}

  private pair(a: number, b: number): number {
    const s = this.table.slots;
    const oa = seatToOwner(a);
    const ob = seatToOwner(b);
    if (a === b || a < 0 || b < 0 || oa >= s || ob >= s) return -1;
    return oa * s + ob;
  }

  relation(a: number, b: number): number {
    const k = this.pair(a, b);
    if (k < 0) return RELATION_WAR;
    const rel = this.table.relation[k] as number;
    return rel === RELATION_TRUCE && (this.table.until[k] as number) <= this.now() ? RELATION_WAR : rel;
  }

  truceTicksLeft(a: number, b: number): number {
    const k = this.pair(a, b);
    if (k < 0 || this.table.relation[k] !== RELATION_TRUCE) return 0;
    const left = (this.table.until[k] as number) - this.now();
    return left > 0 ? left : 0;
  }

  proposalKind(from: number, to: number): number {
    const i = this.table.findProposal(seatToOwner(from), seatToOwner(to));
    return i >= 0 && (this.table.propExpire[i] as number) > this.now() ? (this.table.propKind[i] as number) : 0;
  }

  proposalTicksLeft(from: number, to: number): number {
    const i = this.table.findProposal(seatToOwner(from), seatToOwner(to));
    if (i < 0) return 0;
    const left = (this.table.propExpire[i] as number) - this.now();
    return left > 0 ? left : 0;
  }

  get proposalCount(): number {
    return this.table.propCount;
  }
  proposalFrom(i: number): number {
    return ownerToSeat(this.table.propFrom[i] as number);
  }
  proposalTo(i: number): number {
    return ownerToSeat(this.table.propTo[i] as number);
  }
  proposalTreaty(i: number): number {
    return this.table.propKind[i] as number;
  }
  proposalLeft(i: number): number {
    const left = (this.table.propExpire[i] as number) - this.now();
    return left > 0 ? left : 0;
  }

  breakCooldownLeft(seat: number): number {
    if (seat < 0 || seatToOwner(seat) >= this.table.slots) return 0;
    const left = (this.table.cooldownUntil[seatToOwner(seat)] as number) - this.now();
    return left > 0 ? left : 0;
  }

  embargo(a: number, b: number): boolean {
    return this.embargoFrom(a, b) || this.embargoFrom(b, a);
  }

  federationBound(a: number, b: number): boolean {
    const k = this.pair(a, b);
    return k >= 0 && this.table.relation[k] === RELATION_ALLIANCE && this.table.until[k] === ALLIANCE_FEDERATION;
  }

  embargoFrom(a: number, b: number): boolean {
    return this.table.embargoFrom(seatToOwner(a), seatToOwner(b));
  }

  activeRelations(seat: number): number {
    return seat < 0 || seatToOwner(seat) >= this.table.slots ? 0 : this.table.activeCountOf(seatToOwner(seat), this.now(), this.players);
  }
}

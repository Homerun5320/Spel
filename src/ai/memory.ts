// What one AI seat remembers between thoughts. Plain numbers and one typed array, so a snapshot of it is trivial to serialise
// (M24b); nothing in it refers to the sim. The driver (src/host/aiDriver.ts) owns one memory per AI seat.
import { AI_ANCHOR_SEAT, AI_SPAWN_SPACING_TICKS, AI_THINK_PERIOD_TICKS, AI_THINK_STAGGER_TICKS, type SimView } from '../sim/public';

export interface AiMemory {
  readonly seat: number;
  /** The seat whose capital the AI places its own around (the human's; M06: a parameter of the match, default AI_ANCHOR_SEAT). */
  readonly anchor: number;
  /** A tribe: a seat after the players. Tribes only expand, and commit what the sim gives them whatever pct they send. */
  readonly tribe: boolean;
  /** Ticks after the release (the anchor seat's Spawn, or the wait limit) at which the seat tries its Spawn: the nations first, then the tribes, AI_SPAWN_SPACING_TICKS apart. */
  readonly slot: number;
  /** The tick the seat saw the release (-1 = not yet). */
  release: number;
  /** The seat thinks on the ticks where (tick + phase) is a multiple of AI_THINK_PERIOD_TICKS. */
  readonly phase: number;
  /** Earliest tick of the next Spawn try. */
  retryAt: number;
  /** Spawn tries so far (a counter for the tests and the report). */
  attempts: number;
  /** Earliest tick of the next look for a build place (set after a think that found none). */
  buildRetryAt: number;
  /** Earliest tick of the next look for a district to build or upgrade (set after a think that found none). */
  districtRetryAt: number;
  /** Builds asked for so far (a counter for the tests and the report). */
  builds: number;
  /** Tick of the last Attack this seat sent per target ownerId, -1 = never. */
  readonly lastAttack: Int32Array;
  /** Diplomacy (M18c-1): earliest tick of the next proposal this seat makes, and the tick it last sent a BreakTreaty (-1 = never). */
  proposeAt: number;
  lastBreakAt: number;
  /** Per seat: the tick at which this AI answers the open proposal of that seat (-1 = it has not seen one). */
  readonly replyAt: Int32Array;
  /** Per seat: the tick that seat last broke a treaty against this AI (-1 = never). */
  readonly betrayedAt: Int32Array;
  /** Per seat: the relation to it and the end tick of the truce as of the last look (to tell a broken treaty from one that ran out). */
  readonly lastRel: Int32Array;
  readonly lastUntil: Int32Array;
  /** Per seat: how many think rounds (M18c-2) an attack of that seat on this one was running; the neighbour with the highest count is the one the AI asks for a truce. */
  readonly hits: Int32Array;
  /** 1 per seat that a human plays (index = seat): a nation starts no war on such a seat before AI_WAR_HUMAN_START_TICKS (D143). */
  readonly human: Uint8Array;
}

export interface AiMemoryOptions {
  /** The anchor seat (default AI_ANCHOR_SEAT). */
  readonly anchor?: number;
  /** The seats a human plays (default: the anchor seat only). */
  readonly humanSeats?: readonly number[];
  /** Position of the seat in the Spawn order (default: seat - 1, i.e. seat 0 is the one human). With several or other human seats the driver counts the AI seats. */
  readonly order?: number;
}

/** The memory of `seat` in the match `view` describes. */
export function createAiMemory(view: SimView, seat: number, options: AiMemoryOptions = {}): AiMemory {
  const tribe = seat >= view.players;
  // Spawn order: the AI seats in seat order (the nations), then the first tribe, the second, ...; the human seats never think.
  const order = options.order ?? seat - 1;
  const anchor = options.anchor ?? AI_ANCHOR_SEAT;
  const human = new Uint8Array(view.seats);
  for (const h of options.humanSeats ?? [anchor]) if (h >= 0 && h < view.seats) human[h] = 1;
  return {
    seat,
    anchor,
    tribe,
    slot: order * AI_SPAWN_SPACING_TICKS,
    release: -1,
    phase: (seat * AI_THINK_STAGGER_TICKS) % AI_THINK_PERIOD_TICKS,
    retryAt: 0,
    attempts: 0,
    buildRetryAt: 0,
    districtRetryAt: 0,
    builds: 0,
    lastAttack: new Int32Array(view.seats + 1).fill(-1),
    proposeAt: 0,
    lastBreakAt: -1,
    replyAt: new Int32Array(view.seats).fill(-1),
    betrayedAt: new Int32Array(view.seats).fill(-1),
    lastRel: new Int32Array(view.seats),
    lastUntil: new Int32Array(view.seats),
    hits: new Int32Array(view.seats),
    human,
  };
}

/** Words before the per-owner Attack ticks in the serialised form of a memory (release, retryAt, attempts, buildRetryAt, builds, districtRetryAt). */
export const MEMORY_FIXED_WORDS = 6;

/** The changing part of a memory as words (the rest follows from the seed, the seats and the driver's options). For the AI-state blob (M24b saves it). */
export function memoryWords(m: AiMemory): Int32Array {
  const out = new Int32Array(MEMORY_FIXED_WORDS + m.lastAttack.length);
  out[0] = m.release;
  out[1] = m.retryAt;
  out[2] = m.attempts;
  out[3] = m.buildRetryAt;
  out[4] = m.builds;
  out[5] = m.districtRetryAt;
  out.set(m.lastAttack, MEMORY_FIXED_WORDS);
  return out;
}

/** Words of the diplomacy part of a memory (M18c-1): proposeAt, lastBreakAt, then replyAt, betrayedAt, lastRel and lastUntil (`seats` words each) and hits (M18c-2). Kept apart from `memoryWords` so that part keeps its layout. */
export function diplomacyWordCount(m: AiMemory): number {
  return 2 + 5 * m.replyAt.length;
}

export function diplomacyWords(m: AiMemory): Int32Array {
  const n = m.replyAt.length;
  const out = new Int32Array(diplomacyWordCount(m));
  out[0] = m.proposeAt;
  out[1] = m.lastBreakAt;
  out.set(m.replyAt, 2);
  out.set(m.betrayedAt, 2 + n);
  out.set(m.lastRel, 2 + 2 * n);
  out.set(m.lastUntil, 2 + 3 * n);
  out.set(m.hits, 2 + 4 * n);
  return out;
}

/** Puts words from `diplomacyWords` back; false when the length does not match this memory. */
export function loadDiplomacyWords(m: AiMemory, words: ArrayLike<number>): boolean {
  if (words.length !== diplomacyWordCount(m)) return false;
  const n = m.replyAt.length;
  m.proposeAt = words[0] as number;
  m.lastBreakAt = words[1] as number;
  for (let i = 0; i < n; i++) {
    m.replyAt[i] = words[2 + i] as number;
    m.betrayedAt[i] = words[2 + n + i] as number;
    m.lastRel[i] = words[2 + 2 * n + i] as number;
    m.lastUntil[i] = words[2 + 3 * n + i] as number;
    m.hits[i] = words[2 + 4 * n + i] as number;
  }
  return true;
}

/** Puts words from `memoryWords` back; false when the length does not match this memory. */
export function loadMemoryWords(m: AiMemory, words: ArrayLike<number>): boolean {
  if (words.length !== MEMORY_FIXED_WORDS + m.lastAttack.length) return false;
  m.release = words[0] as number;
  m.retryAt = words[1] as number;
  m.attempts = words[2] as number;
  m.buildRetryAt = words[3] as number;
  m.builds = words[4] as number;
  m.districtRetryAt = words[5] as number;
  for (let i = 0; i < m.lastAttack.length; i++) m.lastAttack[i] = words[MEMORY_FIXED_WORDS + i] as number;
  return true;
}

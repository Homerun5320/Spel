// The one function that changes a game state: step(state, turn).
//
// A step runs the turn whose index equals state.tick: it validates the turn's intents, puts the valid ones in the
// canonical order (seat, id, kind, payload), applies them, draws once from the state's generator and increments the tick.
// An intent that is invalid in this match becomes a no-op and raises state.rejects. step() never throws for bad data: a
// turn that cannot be run at all (wrong index, not a list, too long) is reported as an error result and leaves the state
// untouched.
import { compareIntents, REJECT_DUPLICATE, REJECT_NONE, validateIntent, type Intent, type TurnIntents } from './intents';
import { MAX_INTENTS_PER_TURN } from './rules';
import { OUTBOX_PAINT, OUTBOX_REJECT } from './outbox';
import { nextU32 } from './rng';
import { seatToOwner, type GameState } from './state';

export type StepError = 'turn-mismatch' | 'bad-turn' | 'too-many';

export type StepResult =
  | { readonly ok: true; readonly applied: number; readonly rejected: number }
  | { readonly ok: false; readonly error: StepError };

const NOTHING_TO_DO: StepResult = Object.freeze({ ok: true, applied: 0, rejected: 0 });

/** The function type hosts and the golden runner take, so a test can substitute a broken copy of step. */
export type StepFn = (state: GameState, turn: TurnIntents) => StepResult;

export function step(state: GameState, turn: TurnIntents): StepResult {
  if (typeof turn !== 'object' || turn === null) return { ok: false, error: 'bad-turn' };
  if (turn.turn !== state.tick) return { ok: false, error: 'turn-mismatch' };
  const list: unknown = turn.intents;
  if (!Array.isArray(list)) return { ok: false, error: 'bad-turn' };
  if (list.length > MAX_INTENTS_PER_TURN) return { ok: false, error: 'too-many' };

  let applied = 0;
  let rejected = 0;
  if (list.length > 0) {
    const ctx = { seats: state.header.seats, cells: state.width * state.height, debugIntents: state.header.config.debugIntents };
    const valid: Intent[] = [];
    for (let i = 0; i < list.length; i++) {
      const x: unknown = list[i];
      const reason = validateIntent(x, ctx);
      if (reason === REJECT_NONE) {
        valid.push(x as Intent);
      } else {
        rejected++;
        state.outbox.push(OUTBOX_REJECT, state.tick, reason, 0);
      }
    }
    if (valid.length > 1) valid.sort(compareIntents);
    for (let i = 0; i < valid.length; i++) {
      const intent = valid[i] as Intent;
      const prev = i > 0 ? (valid[i - 1] as Intent) : null;
      if (prev !== null && prev.seat === intent.seat && prev.id === intent.id) {
        rejected++;
        state.outbox.push(OUTBOX_REJECT, state.tick, REJECT_DUPLICATE, 0);
        continue;
      }
      if (intent.kind === 'DebugPaint') {
        const owner = seatToOwner(intent.seat);
        state.owner[intent.cell] = owner;
        state.stamp[intent.cell] = intent.id;
        state.outbox.push(OUTBOX_PAINT, state.tick, intent.cell, owner);
      }
      applied++;
    }
  }
  if (rejected > 0) state.rejects = (state.rejects + rejected) >>> 0;
  nextU32(state.rng);
  state.tick = (state.tick + 1) >>> 0;
  return applied === 0 && rejected === 0 ? NOTHING_TO_DO : { ok: true, applied, rejected };
}

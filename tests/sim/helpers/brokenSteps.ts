// Deliberately broken copies of step() for mutation-style tests: each keeps everything of the real step except one rule.
// The golden tests demand that every one of them lands on other hashes than the committed ones.
import { conquestPhase } from '../../../src/sim/conquest';
import { economyTick } from '../../../src/sim/economy';
import { enclavePhase } from '../../../src/sim/enclaves';
import { compareIntents, REJECT_DUPLICATE, REJECT_NONE, validateIntent, type Intent } from '../../../src/sim/intents';
import { OUTBOX_REJECT } from '../../../src/sim/outbox';
import { nextU32 } from '../../../src/sim/rng';
import { MAX_INTENTS_PER_TURN } from '../../../src/sim/rules';
import type { StepFn } from '../../../src/sim/step';
import { applyIntent } from '../../../src/sim/step';

function makeStep(opts: { sort: boolean; dedupe: boolean }): StepFn {
  return (state, turn) => {
    if (turn.turn !== state.tick) return { ok: false, error: 'turn-mismatch' };
    if (turn.intents.length > MAX_INTENTS_PER_TURN) return { ok: false, error: 'too-many' };
    state.work.reset();
    const ctx = { seats: state.header.seats, cells: state.width * state.height, debugIntents: state.header.config.debugIntents };
    const valid: Intent[] = [];
    let rejected = 0;
    for (const x of turn.intents) {
      const reason = validateIntent(x, ctx);
      if (reason === REJECT_NONE) valid.push(x);
      else {
        rejected++;
        state.outbox.push(OUTBOX_REJECT, state.tick, reason, 0);
      }
    }
    if (opts.sort && valid.length > 1) valid.sort(compareIntents);
    let applied = 0;
    for (let i = 0; i < valid.length; i++) {
      const intent = valid[i] as Intent;
      const prev = i > 0 ? (valid[i - 1] as Intent) : null;
      if (opts.dedupe && prev !== null && prev.seat === intent.seat && prev.id === intent.id) {
        rejected++;
        state.outbox.push(OUTBOX_REJECT, state.tick, REJECT_DUPLICATE, 0);
        continue;
      }
      const why = applyIntent(state, intent);
      if (why !== REJECT_NONE) {
        rejected++;
        state.outbox.push(OUTBOX_REJECT, state.tick, why, 0);
        continue;
      }
      applied++;
    }
    conquestPhase(state);
    enclavePhase(state);
    economyTick(state);
    if (rejected > 0) state.rejects = (state.rejects + rejected) >>> 0;
    nextU32(state.rng);
    state.tick = (state.tick + 1) >>> 0;
    return { ok: true, applied, rejected };
  };
}

/** The real rules, but intents run in arrival order instead of the canonical order. */
export const stepWithoutSort: StepFn = makeStep({ sort: false, dedupe: true });
/** The real rules, but a repeated (seat, id) is applied again instead of refused. */
export const stepWithoutDedupe: StepFn = makeStep({ sort: true, dedupe: false });
/** The faithful copy: proves the copies above differ from the real step only by the one rule they drop. */
export const stepCopyIntact: StepFn = makeStep({ sort: true, dedupe: true });

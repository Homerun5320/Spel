// The one function that changes a game state: step(state, turn).
//
// A step runs the turn whose index equals state.tick: it validates the turn's intents, puts the valid ones in the
// canonical order (seat, id, kind, payload), applies them, runs the conquest (every attack takes its cells) and the enclave
// check, runs the economy and the structure phase (finished upgrades), draws once from the state's generator and increments the tick.
// An intent that is invalid in this match becomes a no-op and raises state.rejects. step() never throws for bad data: a
// turn that cannot be run at all (wrong index, not a list, too long) is reported as an error result and leaves the state
// untouched.
import { applyAttack, applyCancelAttack, conquestPhase } from './conquest';
import { compareIntents, REJECT_DUPLICATE, REJECT_NONE, validateIntent, type Intent, type TurnIntents } from './intents';
import { economyTick } from './economy';
import { enclavePhase } from './enclaves';
import { applyDebugGive } from './debugGive';
import { MAX_INTENTS_PER_TURN } from './rules';
import { OUTBOX_REJECT } from './outbox';
import { nextU32 } from './rng';
import { applySpawn } from './spawn';
import { applyBuildDistrict, applyRemoveDistrict, applyUpgradeDistrict } from './districts';
import { applyBuild, applyDelete, applyUpgrade, structuresPhase } from './structures';
import { seatToOwner, type GameState } from './state';
import { setOwner } from './territory';
import { winPhase } from './win';

export type StepError = 'turn-mismatch' | 'bad-turn' | 'too-many';

export type StepResult =
  | { readonly ok: true; readonly applied: number; readonly rejected: number }
  | { readonly ok: false; readonly error: StepError };

const NOTHING_TO_DO: StepResult = Object.freeze({ ok: true, applied: 0, rejected: 0 });

/** The function type hosts and the golden runner take, so a test can substitute a broken copy of step. */
export type StepFn = (state: GameState, turn: TurnIntents) => StepResult;

/**
 * Applies one VALID intent (see validateIntent) to the state. Returns REJECT_NONE, or the reason the state refuses it
 * (nothing changed then). Shared by step() and the broken copies of it that the tests use.
 */
export function applyIntent(state: GameState, intent: Intent): number {
  switch (intent.kind) {
    case 'DebugPaint':
      setOwner(state, intent.cell, seatToOwner(intent.seat), intent.id);
      return REJECT_NONE;
    case 'Spawn':
      return applySpawn(state, intent.seat, intent.cell, intent.id);
    case 'Attack':
      return applyAttack(state, intent.seat, intent.target, intent.pct);
    case 'CancelAttack':
      return applyCancelAttack(state, intent.seat, intent.target);
    case 'DebugGive':
      return applyDebugGive(state, intent.seat, intent.gold, intent.troops);
    case 'Build':
      return applyBuild(state, intent.seat, intent.type, intent.cell);
    case 'Upgrade':
      return applyUpgrade(state, intent.seat, intent.structure);
    case 'Delete':
      return applyDelete(state, intent.seat, intent.structure);
    case 'BuildDistrict':
      return applyBuildDistrict(state, intent.seat, intent.structure, intent.slot, intent.districtKind);
    case 'UpgradeDistrict':
      return applyUpgradeDistrict(state, intent.seat, intent.structure, intent.slot);
    case 'RemoveDistrict':
      return applyRemoveDistrict(state, intent.seat, intent.structure, intent.slot);
    default:
      return REJECT_NONE;
  }
}

export function step(state: GameState, turn: TurnIntents): StepResult {
  if (typeof turn !== 'object' || turn === null) return { ok: false, error: 'bad-turn' };
  if (turn.turn !== state.tick) return { ok: false, error: 'turn-mismatch' };
  const list: unknown = turn.intents;
  if (!Array.isArray(list)) return { ok: false, error: 'bad-turn' };
  if (list.length > MAX_INTENTS_PER_TURN) return { ok: false, error: 'too-many' };

  if (state.match.ended === 1) {
    // The match is over (M18-1): the rules stop, only the tick counter runs so that a host and its clock go on.
    state.tick = (state.tick + 1) >>> 0;
    return NOTHING_TO_DO;
  }
  state.work.reset();
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
      const why = applyIntent(state, intent);
      if (why !== REJECT_NONE) {
        rejected++;
        state.outbox.push(OUTBOX_REJECT, state.tick, why, 0);
        continue;
      }
      applied++;
    }
  }
  // Phases of a tick: 1 intents (above), 2 conquest, 3 enclaves, 4 economy, 5 structures (finished upgrades), 6 the generator, 7 the tick, 8 the match end (peak land, elimination, win conditions; M18-1).
  conquestPhase(state);
  enclavePhase(state);
  economyTick(state);
  structuresPhase(state);
  if (rejected > 0) state.rejects = (state.rejects + rejected) >>> 0;
  nextU32(state.rng);
  state.tick = (state.tick + 1) >>> 0;
  winPhase(state);
  return applied === 0 && rejected === 0 ? NOTHING_TO_DO : { ok: true, applied, rejected };
}

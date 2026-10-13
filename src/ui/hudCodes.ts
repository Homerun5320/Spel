// The numbers the UI needs from the sim, re-exported in one place so that src/ui imports the sim through a single narrow file:
// the match phases and the REJECT_* codes of the intents (all plain constants).
export { PHASE_IMMUNITY, PHASE_PLAY, PHASE_SPAWN } from '../sim/flow';
export {
  REJECT_AMOUNT,
  REJECT_IMMUNE,
  REJECT_NOT_SPAWNED,
  REJECT_NO_CONTACT,
  REJECT_NO_TROOPS,
  REJECT_OWNED,
  REJECT_PHASE,
  REJECT_SELF,
  REJECT_SPAWNED,
  REJECT_TERRAIN,
} from '../sim/intents';

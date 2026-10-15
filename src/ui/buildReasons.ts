// The text key of a build refusal (a REJECT_BUILD_* code of the sim, the same codes `validateBuild` returns). Tests check this KEY, not the text.
import {
  REJECT_BUILD_FALLOUT,
  REJECT_BUILD_FOREST,
  REJECT_BUILD_FULL,
  REJECT_BUILD_GOLD,
  REJECT_BUILD_HILLS,
  REJECT_BUILD_MOUNTAIN,
  REJECT_BUILD_NO_COAST,
  REJECT_BUILD_NO_FACTORY,
  REJECT_BUILD_NOT_OWNED,
  REJECT_BUILD_OCCUPIED,
  REJECT_BUILD_PEAK,
  REJECT_BUILD_SPACING,
  REJECT_DELETE_COOLDOWN,
  REJECT_STRUCT_BUSY,
  REJECT_STRUCT_ID,
  REJECT_STRUCT_MAX_LEVEL,
  REJECT_STRUCT_NOT_OWNER,
} from '../sim/public';
import { PHASE_SPAWN, REJECT_PHASE } from './hudCodes';
import type { TextKey } from './i18n';

/** Polish-1: true while the sim refuses Build / Upgrade / Delete (a match with a spawn phase, still in it). The UI mirrors the sim's own gate. */
export function spawnPhaseBlocks(view: { readonly flow: boolean; readonly phase: number }): boolean {
  return view.flow && view.phase === PHASE_SPAWN;
}

export function buildRejectKey(reason: number): TextKey {
  switch (reason) {
    case REJECT_PHASE:
      return 'toast.build.phase';
    case REJECT_BUILD_NOT_OWNED:
      return 'toast.build.notOwned';
    case REJECT_BUILD_PEAK:
      return 'toast.build.peak';
    case REJECT_BUILD_MOUNTAIN:
      return 'toast.build.mountain';
    case REJECT_BUILD_HILLS:
      return 'toast.build.hills';
    case REJECT_BUILD_FOREST:
      return 'toast.build.forest';
    case REJECT_BUILD_NO_COAST:
      return 'toast.build.noCoast';
    case REJECT_BUILD_OCCUPIED:
      return 'toast.build.occupied';
    case REJECT_BUILD_SPACING:
      return 'toast.build.spacing';
    case REJECT_BUILD_FALLOUT:
      return 'toast.build.fallout';
    case REJECT_BUILD_NO_FACTORY:
      return 'toast.build.noFactory';
    case REJECT_BUILD_GOLD:
      return 'toast.build.gold';
    case REJECT_BUILD_FULL:
      return 'toast.build.full';
    default:
      return 'reject.other';
  }
}

/**
 * The toast key of ANY refusal of a Build, Upgrade or Delete the sim reports back (the codes 21 to 38). The Upgrade and Delete tooltips carry
 * parameters ({price}, {seconds}), so a refused click gets its own parameter-free toast texts. Other codes: 'reject.other'.
 */
export function structureRefusalKey(reason: number): TextKey {
  switch (reason) {
    case REJECT_STRUCT_ID:
      return 'toast.struct.gone';
    case REJECT_STRUCT_NOT_OWNER:
      return 'toast.struct.notOwner';
    case REJECT_STRUCT_MAX_LEVEL:
      return 'toast.struct.maxLevel';
    case REJECT_STRUCT_BUSY:
      return 'toast.struct.busy';
    case REJECT_DELETE_COOLDOWN:
      return 'toast.struct.cooldown';
    case REJECT_PHASE: // Fix-Sim: Build / Upgrade / Delete are refused in the spawn phase like Attack
      return 'reject.phase';
    default:
      return buildRejectKey(reason);
  }
}

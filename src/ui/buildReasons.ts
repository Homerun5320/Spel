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
} from '../sim/public';
import type { TextKey } from './i18n';

export function buildRejectKey(reason: number): TextKey {
  switch (reason) {
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

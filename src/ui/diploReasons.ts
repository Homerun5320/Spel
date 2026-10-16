// The text key of a diplomacy refusal (M18c-1): the REJECT_DIPLO_* codes 80 to 93 that the six diplomacy intents and the Attack ban return. Every other code goes on
// to the build and helicopter refusals (src/ui/buildReasons.ts). Tests check this KEY, not the text. The interface that shows them comes with M18c-2.
import {
  REJECT_DIPLO_ALLIED,
  REJECT_DIPLO_AT_PEACE,
  REJECT_DIPLO_COOLDOWN,
  REJECT_DIPLO_ELIMINATED,
  REJECT_DIPLO_EMBARGO_NONE,
  REJECT_DIPLO_EMBARGO_SET,
  REJECT_DIPLO_FEDERATION,
  REJECT_DIPLO_FULL,
  REJECT_DIPLO_MATCH_ENDED,
  REJECT_DIPLO_NOT_PLAYER,
  REJECT_DIPLO_NO_PROPOSAL,
  REJECT_DIPLO_NO_TREATY,
  REJECT_DIPLO_PENDING,
  REJECT_DIPLO_SELF,
  REJECT_DIPLO_TREATY_BOUND,
} from '../sim/public';
import { structureRefusalKey } from './buildReasons';
import type { TextKey } from './i18n';

export function diplomacyRefusalKey(reason: number): TextKey {
  switch (reason) {
    case REJECT_DIPLO_NOT_PLAYER:
      return 'reject.diplo.notPlayer';
    case REJECT_DIPLO_SELF:
      return 'reject.diplo.self';
    case REJECT_DIPLO_AT_PEACE:
      return 'reject.diplo.atPeace';
    case REJECT_DIPLO_ALLIED:
      return 'reject.diplo.allied';
    case REJECT_DIPLO_PENDING:
      return 'reject.diplo.pending';
    case REJECT_DIPLO_NO_PROPOSAL:
      return 'reject.diplo.noProposal';
    case REJECT_DIPLO_COOLDOWN:
      return 'reject.diplo.cooldown';
    case REJECT_DIPLO_NO_TREATY:
      return 'reject.diplo.noTreaty';
    case REJECT_DIPLO_ELIMINATED:
      return 'reject.diplo.eliminated';
    case REJECT_DIPLO_MATCH_ENDED:
      return 'reject.diplo.matchEnded';
    case REJECT_DIPLO_TREATY_BOUND:
      return 'reject.diplo.treatyBound';
    case REJECT_DIPLO_EMBARGO_SET:
      return 'reject.diplo.embargoSet';
    case REJECT_DIPLO_EMBARGO_NONE:
      return 'reject.diplo.embargoNone';
    case REJECT_DIPLO_FEDERATION:
      return 'reject.diplo.federation';
    case REJECT_DIPLO_FULL:
      return 'reject.diplo.full';
    default:
      return structureRefusalKey(reason);
  }
}

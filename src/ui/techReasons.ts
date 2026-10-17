// The text key of a technology refusal (M18d-1): the REJECT_TECH_* codes 110 to 117 that Research and CancelResearch return. Every other code goes on to the diplomacy,
// build and helicopter refusals (src/ui/diploReasons.ts). Tests check this KEY, not the text. The research panel that shows them comes with M18d-2.
import {
  REJECT_TECH_BUSY,
  REJECT_TECH_DONE,
  REJECT_TECH_ELIMINATED,
  REJECT_TECH_GOLD,
  REJECT_TECH_ID,
  REJECT_TECH_MATCH_ENDED,
  REJECT_TECH_NOT_ACTIVE,
  REJECT_TECH_PREREQ,
} from '../sim/public';
import { diplomacyRefusalKey } from './diploReasons';
import type { TextKey } from './i18n';

export function techRefusalKey(reason: number): TextKey {
  switch (reason) {
    case REJECT_TECH_ID:
      return 'reject.tech.id';
    case REJECT_TECH_PREREQ:
      return 'reject.tech.prereq';
    case REJECT_TECH_DONE:
      return 'reject.tech.done';
    case REJECT_TECH_BUSY:
      return 'reject.tech.busy';
    case REJECT_TECH_GOLD:
      return 'reject.tech.gold';
    case REJECT_TECH_MATCH_ENDED:
      return 'reject.tech.matchEnded';
    case REJECT_TECH_ELIMINATED:
      return 'reject.tech.eliminated';
    case REJECT_TECH_NOT_ACTIVE:
      return 'reject.tech.notActive';
    default:
      return diplomacyRefusalKey(reason);
  }
}

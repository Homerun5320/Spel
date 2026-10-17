// The text key of a LaunchShip refusal (M13c-2): the thirteen REJECT_SHIP_* codes of the sim (block SHIP_REASON_BASE + n). A treaty (REJECT_DIPLO_TREATY_BOUND), the spawn phase
// (REJECT_PHASE) and a full beachhead table (REJECT_HELI_BEACHHEAD_FULL) are answered by the older tables; any other code gives null. Tests check this KEY, not the text.
import {
  REJECT_SHIP_BAD_TARGET,
  REJECT_SHIP_COOLDOWN,
  REJECT_SHIP_FLEET_CAP,
  REJECT_SHIP_NOT_OWNER,
  REJECT_SHIP_NO_GOLD,
  REJECT_SHIP_NO_PORT,
  REJECT_SHIP_NO_ROUTE,
  REJECT_SHIP_NO_TROOPS,
  REJECT_SHIP_PORT_BUILDING,
  REJECT_SHIP_PORT_BUSY,
  REJECT_SHIP_TABLE_FULL,
  REJECT_SHIP_TROOPS_HIGH,
  REJECT_SHIP_TROOPS_LOW,
} from '../sim/public';
import type { TextKey } from './i18n';

/** The key of a ship refusal, or null for a code that is not one of the thirteen. */
export function shipRefusalKey(reason: number): TextKey | null {
  switch (reason) {
    case REJECT_SHIP_NO_PORT:
      return 'reject.ship.noPort';
    case REJECT_SHIP_NOT_OWNER:
      return 'reject.ship.notOwner';
    case REJECT_SHIP_PORT_BUILDING:
      return 'reject.ship.portBuilding';
    case REJECT_SHIP_PORT_BUSY:
      return 'reject.ship.portBusy';
    case REJECT_SHIP_COOLDOWN:
      return 'reject.ship.cooldown';
    case REJECT_SHIP_FLEET_CAP:
      return 'reject.ship.fleetCap';
    case REJECT_SHIP_TROOPS_LOW:
      return 'reject.ship.troopsLow';
    case REJECT_SHIP_TROOPS_HIGH:
      return 'reject.ship.troopsHigh';
    case REJECT_SHIP_NO_TROOPS:
      return 'reject.ship.noTroops';
    case REJECT_SHIP_NO_GOLD:
      return 'reject.ship.noGold';
    case REJECT_SHIP_BAD_TARGET:
      return 'reject.ship.badTarget';
    case REJECT_SHIP_NO_ROUTE:
      return 'reject.ship.noRoute';
    case REJECT_SHIP_TABLE_FULL:
      return 'reject.ship.tableFull';
    default:
      return null;
  }
}

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
  REJECT_DISTRICT_CITY_BUILDING,
  REJECT_DISTRICT_EMPTY,
  REJECT_DISTRICT_KIND,
  REJECT_DISTRICT_NOT_CITY,
  REJECT_DISTRICT_OCCUPIED,
  REJECT_DISTRICT_SLOT,
  REJECT_STRUCT_BUSY,
  REJECT_STRUCT_ID,
  REJECT_STRUCT_MAX_LEVEL,
  REJECT_STRUCT_NOT_OWNER,
  LZ_ENEMY_CITY_NEAR,
  LZ_NO_ROUTE,
  LZ_OUT_OF_FUEL,
  LZ_PEAK,
  LZ_STEEP,
  LZ_TERRAIN_CLASS,
  LZ_TOO_HIGH,
  LZ_WATER,
  REJECT_HELI_FACTORY_BUILDING,
  REJECT_HELI_FLEET_CAP,
  REJECT_HELI_NO_FACTORY,
  REJECT_HELI_NO_GOLD,
  REJECT_HELI_BAD_TROOPS,
  REJECT_HELI_NO_PAD,
  REJECT_HELI_NO_ROUTE,
  REJECT_HELI_NOT_FLYING,
  REJECT_HELI_NOT_OWNER,
  REJECT_HELI_QUEUE_BUSY,
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
    case REJECT_DISTRICT_NOT_CITY: // Districts-2a: the district intents' own codes 39 to 44
      return 'toast.district.notCity';
    case REJECT_DISTRICT_SLOT:
      return 'toast.district.slot';
    case REJECT_DISTRICT_OCCUPIED:
      return 'toast.district.occupied';
    case REJECT_DISTRICT_EMPTY:
      return 'toast.district.empty';
    case REJECT_DISTRICT_KIND:
      return 'toast.district.kind';
    case REJECT_DISTRICT_CITY_BUILDING:
      return 'toast.district.cityBuilding';
    case REJECT_PHASE: // Fix-Sim: Build / Upgrade / Delete are refused in the spawn phase like Attack
      return 'reject.phase';
    default:
      return airRefusalKey(reason);
  }
}

/**
 * The toast key of a helicopter refusal (M12a-1): the ProduceHeli codes 45 to 50 and the eight landing-zone reasons 65 to 72 that `scoreLz` returns
 * (LaunchHeli of part 2 reports the same). Other codes: the build refusals, then 'reject.other'.
 */
export function airRefusalKey(reason: number): TextKey {
  switch (reason) {
    case REJECT_HELI_NO_FACTORY:
      return 'toast.heli.noFactory';
    case REJECT_HELI_NOT_OWNER:
      return 'toast.heli.notOwner';
    case REJECT_HELI_FACTORY_BUILDING:
      return 'toast.heli.factoryBuilding';
    case REJECT_HELI_QUEUE_BUSY:
      return 'toast.heli.queueBusy';
    case REJECT_HELI_FLEET_CAP:
      return 'toast.heli.fleetCap';
    case REJECT_HELI_NO_GOLD:
      return 'toast.heli.noGold';
    case REJECT_HELI_NO_PAD:
      return 'toast.heli.noPad';
    case REJECT_HELI_BAD_TROOPS:
      return 'toast.heli.badTroops';
    case REJECT_HELI_NO_ROUTE:
      return 'toast.heli.noRoute';
    case REJECT_HELI_NOT_FLYING:
      return 'toast.heli.notFlying';
    case LZ_WATER:
      return 'toast.lz.water';
    case LZ_PEAK:
      return 'toast.lz.peak';
    case LZ_TERRAIN_CLASS:
      return 'toast.lz.terrain';
    case LZ_STEEP:
      return 'toast.lz.steep';
    case LZ_ENEMY_CITY_NEAR:
      return 'toast.lz.enemyCity';
    case LZ_TOO_HIGH:
      return 'toast.lz.tooHigh';
    case LZ_OUT_OF_FUEL:
      return 'toast.lz.outOfFuel';
    case LZ_NO_ROUTE:
      return 'toast.lz.noRoute';
    default:
      return buildRejectKey(reason);
  }
}

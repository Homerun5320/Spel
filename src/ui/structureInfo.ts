// What the selection panel says about a structure (M10-4): pure functions over the snapshot and the sim's numbers. Every number comes from
// `src/sim/public.ts` (the constants of rules.ts, the validators, the price functions); nothing here is a balance value.
import {
  CAP_CITY_LEVEL_TROOPS,
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  DELETE_COOLDOWN_TICKS,
  FACTORY_CITY_BONUS_PCT,
  FACTORY_GOLD_MILLI_PER_SEC,
  FACTORY_RADIUS_CELLS,
  PORT_GOLD_MILLI_PER_SEC,
  POST_COST_DEN,
  POST_COST_NUM,
  POST_RADIUS_CELLS,
  REJECT_BUILD_GOLD,
  REJECT_DELETE_COOLDOWN,
  REJECT_STRUCT_BUSY,
  REJECT_STRUCT_ID,
  REJECT_STRUCT_MAX_LEVEL,
  REJECT_STRUCT_NOT_OWNER,
  STRUCT_CITY,
  STRUCT_FACTORY,
  STRUCT_MAX_LEVEL,
  STRUCT_PORT,
  STRUCT_POST,
  STRUCT_SAM,
  STRUCT_SILO,
  TICK_HZ,
  samRadiusCells,
  seatToOwner,
  upgradePriceGold,
  validateDelete,
  validateUpgrade,
  type SimView,
} from '../sim/public';
import type { TextKey, TextParams } from './i18n';

export interface EffectLine {
  readonly key: TextKey;
  readonly params: TextParams;
}

/** Gold per second with at most one decimal ("1.5", "3"). */
function gold(milliPerSec: number): string {
  return String(Math.round(milliPerSec / 100) / 10);
}

/** The radius in sim cells of a range ring (SAM, Defense Post) at a level, 0 for a type without a ring. `onMountain` is the +20 % rule of the sim. */
export function rangeRingCells(type: number, level: number, onMountain: boolean): number {
  if (type === STRUCT_SAM) return samRadiusCells(level, onMountain);
  if (type === STRUCT_POST) return POST_RADIUS_CELLS;
  return 0;
}

/** What a structure of `type` at `level` gives, from the sim's constants. */
export function effectLines(type: number, level: number, onMountain = false): EffectLine[] {
  switch (type) {
    case STRUCT_CITY:
      return [{ key: 'sel.fx.city', params: { gold: gold(CITY_GOLD_MILLI_PER_SEC_PER_LEVEL * level), troops: CAP_CITY_LEVEL_TROOPS * level } }];
    case STRUCT_FACTORY:
      return [{ key: 'sel.fx.factory', params: { gold: gold(FACTORY_GOLD_MILLI_PER_SEC), pct: FACTORY_CITY_BONUS_PCT, radius: FACTORY_RADIUS_CELLS } }];
    case STRUCT_PORT:
      return [{ key: 'sel.fx.port', params: { gold: gold(PORT_GOLD_MILLI_PER_SEC) } }];
    case STRUCT_SILO:
      return [{ key: 'sel.fx.silo', params: { radius: samRadiusCells(level, onMountain) } }];
    case STRUCT_SAM:
      return [{ key: 'sel.fx.sam', params: { radius: samRadiusCells(level, onMountain) } }];
    case STRUCT_POST:
      return [{ key: 'sel.fx.post', params: { mult: String(POST_COST_NUM / POST_COST_DEN), radius: POST_RADIUS_CELLS } }];
    default:
      return [];
  }
}

/** The text key of a structure type's name (the build bar's). */
export function structureNameKey(type: number): TextKey {
  switch (type) {
    case STRUCT_CITY:
      return 'hud.build.city';
    case STRUCT_FACTORY:
      return 'hud.build.factory';
    case STRUCT_PORT:
      return 'hud.build.port';
    case STRUCT_SILO:
      return 'hud.build.silo';
    case STRUCT_SAM:
      return 'hud.build.sam';
    default:
      return 'hud.build.post';
  }
}

export interface SelectionInfo {
  readonly id: number;
  readonly type: number;
  readonly level: number;
  readonly owned: boolean;
  /** Finished (the construction time is over). */
  readonly finished: boolean;
  /** An upgrade is running. */
  readonly upgrading: boolean;
  /** Price in gold of the next level, 0 at the top level. */
  readonly upgradePrice: number;
  readonly upgradeReason: number;
  readonly deleteReason: number;
  /** Seconds until the seat may Delete again (0 = now). */
  readonly deleteSeconds: number;
  /** The Delete cooldown the sim applies after a Delete, in seconds. */
  readonly cooldownSeconds: number;
}

/** The panel's numbers for structure `id`, or null when it no longer exists. */
export function selectionInfo(view: SimView, seat: number, id: number): SelectionInfo | null {
  const s = view.structures;
  if (!Number.isInteger(id) || id < 0 || id >= s.highWater || s.owner[id] === 0) return null;
  const type = s.type[id] as number;
  const level = s.level[id] as number;
  const owner = seatToOwner(seat);
  const wait = Math.max(0, s.deleteReadyTick(owner) - view.tick);
  return {
    id,
    type,
    level,
    owned: s.owner[id] === owner,
    finished: view.tick >= (s.readyTick[id] as number),
    upgrading: (s.upgradeReadyTick[id] as number) !== 0,
    upgradePrice: level >= STRUCT_MAX_LEVEL ? 0 : upgradePriceGold(type, level + 1),
    upgradeReason: validateUpgrade(view, seat, id),
    deleteReason: validateDelete(view, seat, id),
    deleteSeconds: Math.ceil(wait / TICK_HZ),
    cooldownSeconds: DELETE_COOLDOWN_TICKS / TICK_HZ,
  };
}

/** The tooltip key of a refused Upgrade. */
export function upgradeWhyKey(reason: number): TextKey {
  switch (reason) {
    case REJECT_STRUCT_NOT_OWNER:
      return 'sel.why.notOwner';
    case REJECT_STRUCT_MAX_LEVEL:
      return 'sel.why.maxLevel';
    case REJECT_STRUCT_BUSY:
      return 'sel.why.busy';
    case REJECT_BUILD_GOLD:
      return 'sel.why.gold';
    case REJECT_STRUCT_ID:
      return 'sel.why.gone';
    default:
      return 'reject.other';
  }
}

/** The tooltip key of a refused Delete. */
export function deleteWhyKey(reason: number): TextKey {
  switch (reason) {
    case REJECT_STRUCT_NOT_OWNER:
      return 'sel.why.notOwner';
    case REJECT_DELETE_COOLDOWN:
      return 'sel.why.cooldown';
    case REJECT_STRUCT_ID:
      return 'sel.why.gone';
    default:
      return 'reject.other';
  }
}

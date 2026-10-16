// What the selection panel says about a structure (M10-4): pure functions over the snapshot and the sim's numbers. Every number comes from
// `src/sim/public.ts` (the constants of rules.ts, the validators, the price functions); nothing here is a balance value.
import {
  DELETE_COOLDOWN_TICKS,
  FACTORY_CITY_BONUS_PCT_BY_LEVEL,
  FACTORY_GOLD_MILLI_BY_LEVEL,
  FACTORY_RADIUS_CELLS_BY_LEVEL,
  PORT_GOLD_MILLI_BY_LEVEL,
  PORT_TRADE_PCT_BY_LEVEL,
  SAM_MOUNTAIN_PCT,
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
  STRUCT_PORT,
  STRUCT_POST,
  STRUCT_SAM,
  STRUCT_SILO,
  TICK_HZ,
  cityGoldMilli,
  cityTroopCap,
  maxLevelOf,
  samRadiusCells,
  seatToOwner,
  upgradePriceGold,
  upgradeTicksOf,
  validateDelete,
  validateUpgrade,
  type SimView,
} from '../sim/public';
import { spawnPhaseBlocks } from './buildReasons';
import { REJECT_PHASE } from './hudCodes';
import { formatFixed, formatGoldRate, formatInt, type TextKey, type TextParams } from './i18n';

export interface EffectLine {
  readonly key: TextKey;
  readonly params: TextParams;
}

const gold = formatGoldRate; // Look-2: the displayed gold per second (GOLD_DISPLAY_FACTOR in, up to two decimals)

/** The value of a per-level table at `level` (clamped to the table, so a level outside 1..max shows the nearest). */
function atLevel(table: readonly number[], level: number): number {
  return table[Math.min(Math.max(level, 1), table.length - 1)] as number;
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
      return [{ key: 'sel.fx.city', params: { gold: gold(cityGoldMilli(level)), troops: formatInt(cityTroopCap(level)) } }];
    case STRUCT_FACTORY:
      return [
        {
          key: 'sel.fx.factory',
          params: { gold: gold(atLevel(FACTORY_GOLD_MILLI_BY_LEVEL, level)), pct: atLevel(FACTORY_CITY_BONUS_PCT_BY_LEVEL, level), radius: atLevel(FACTORY_RADIUS_CELLS_BY_LEVEL, level) },
        },
      ];
    case STRUCT_PORT:
      return [{ key: 'sel.fx.port', params: { gold: gold(atLevel(PORT_GOLD_MILLI_BY_LEVEL, level)), pct: atLevel(PORT_TRADE_PCT_BY_LEVEL, level) } }];
    case STRUCT_SILO:
      return [{ key: 'sel.fx.silo', params: {} }]; // no function until M14: the panel says so instead of showing a radius
    case STRUCT_SAM:
      return [{ key: 'sel.fx.sam', params: { radius: samRadiusCells(level, onMountain), pct: SAM_MOUNTAIN_PCT - 100 } }];
    case STRUCT_POST:
      return [{ key: 'sel.fx.post', params: { mult: formatFixed(POST_COST_NUM / POST_COST_DEN, 1), radius: POST_RADIUS_CELLS } }];
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
  /** Seconds the upgrade to the next level takes (the sim's `upgradeTicksOf`), 0 at the top level. */
  readonly upgradeSeconds: number;
  readonly upgradeReason: number;
  readonly deleteReason: number;
  /** Seconds until the seat may Delete again (0 = now). */
  readonly deleteSeconds: number;
  /** The Delete cooldown the sim applies after a Delete, in seconds. */
  readonly cooldownSeconds: number;
}

/** Polish-1: in the spawn phase the sim refuses every Upgrade / Delete of the seat's own structure with REJECT_PHASE; a foreign or missing one keeps its own reason. */
function phaseFirst(view: SimView, reason: number): number {
  return (reason === 0 || reason === REJECT_STRUCT_BUSY || reason === REJECT_BUILD_GOLD || reason === REJECT_DELETE_COOLDOWN || reason === REJECT_STRUCT_MAX_LEVEL) && spawnPhaseBlocks(view) ? REJECT_PHASE : reason;
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
    upgradePrice: level >= maxLevelOf(type) ? 0 : upgradePriceGold(type, level + 1),
    upgradeSeconds: level >= maxLevelOf(type) ? 0 : upgradeTicksOf(type, level + 1) / TICK_HZ,
    upgradeReason: phaseFirst(view, validateUpgrade(view, seat, id)),
    deleteReason: phaseFirst(view, validateDelete(view, seat, id)),
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
    case REJECT_PHASE:
      return 'sel.why.phase';
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
    case REJECT_PHASE:
      return 'sel.why.phase';
    default:
      return 'reject.other';
  }
}

// ---- the two-step Delete -----------------------------------------------------------------------------------------------------------------

/** How long the first Delete click keeps the button armed ("Bekräfta"), in milliseconds. */
export const DELETE_ARM_MS = 3000;

/** A Delete armed for structure `id` until `until` (a clock in ms; the panel's own clock, not the sim's). */
export interface DeleteArm {
  readonly id: number;
  readonly until: number;
}

/** Is Delete armed for `id` at `now`? */
export function deleteArmed(arm: DeleteArm | null, id: number, now: number): boolean {
  return arm !== null && arm.id === id && now < arm.until;
}

/** One click on Delete: the first arms it, a second one inside DELETE_ARM_MS (same structure) deletes. */
export function deleteClick(arm: DeleteArm | null, id: number, now: number): { readonly send: boolean; readonly arm: DeleteArm | null } {
  if (deleteArmed(arm, id, now)) return { send: true, arm: null };
  return { send: false, arm: { id, until: now + DELETE_ARM_MS } };
}

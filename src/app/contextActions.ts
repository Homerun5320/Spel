// The right-click menu model (Ctx-1): what the player can do with the cell under the pointer, as DATA. `contextActionsFor` is pure and headless-testable: it returns the
// title, the groups and the entries, and each entry says what would happen (`effect`, a description, never a callback with side effects). NO RULE IS REPEATED HERE: every
// state is the answer of the sim's own validator (`validateBuild`, `validateUpgrade` through `selectionInfo`, `validateLaunchHeli`, `validateLaunchShip`, the diplomacy buttons of
// `buildDiploRows`, `attackBlock`), and the reason text key is the one the panels already use (`rejectKey`). The page (src/app/contextActionsRun.ts) turns an effect into an intent
// or a mode. A later milestone adds entries through `registerContextProvider` (M15b: "Fire missile") without touching this function.
// This module and the ones it pulls in are loaded LAZILY (import() at the first right click), so the start chunk does not grow.
import {
  HELI_PRICE_GOLD,
  REJECT_DIPLO_ALLIED,
  REJECT_DIPLO_AT_PEACE,
  REJECT_DIPLO_NOT_PLAYER,
  REJECT_DIPLO_NO_TREATY,
  REJECT_DIPLO_SELF,
  REJECT_HELI_BAD_TROOPS,
  REJECT_HELI_BEACHHEAD_FULL,
  REJECT_HELI_NO_FACTORY,
  REJECT_HELI_NO_PAD,
  REJECT_HELI_NO_ROUTE,
  REJECT_NONE,
  REJECT_DIPLO_TREATY_BOUND,
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
  STRUCT_AIRFIELD,
  STRUCT_CITY,
  STRUCT_FACTORY,
  STRUCT_LAB,
  STRUCT_PLANT,
  STRUCT_PORT,
  STRUCT_POST,
  STRUCT_SAM,
  STRUCT_SILO,
  TREATY_ALLIANCE,
  TREATY_TRUCE,
  buildPriceMilli,
  heliMaxTroopsOf,
  seatToOwner,
  validateBuild,
  validateLaunchHeli,
  validateLaunchShip,
  type Nav,
  type SimView,
} from '../sim/public';
import { QT_PER_TROOP } from '../sim/rules';
import { isPlayableClass } from '../sim/terrain';
import { spawnPhaseBlocks } from '../ui/buildReasons';
import { buildDiploRows, attackBlock } from '../ui/diploModel';
import { heliPanelInfo, padHeliOf } from '../ui/heliInfo';
import { REJECT_PHASE } from '../ui/hudCodes';
import { rejectKey } from '../ui/hudLogic';
import type { TextKey, TextParams } from '../ui/i18n';
import { shipButtonReason, shipSliderMax } from '../ui/shipInfo';
import { selectionInfo, structureNameKey } from '../ui/structureInfo';
import { SHIP } from '../ui/uiConfig';

/** What choosing an entry does. A description, not a callback: the page maps it to an intent, a mode or a panel. `cell` -1 = "pick the target afterwards". */
export type ContextEffect =
  | { readonly kind: 'none' }
  | { readonly kind: 'attack'; readonly owner: number; readonly cell: number }
  | { readonly kind: 'build'; readonly type: number; readonly cell: number }
  | { readonly kind: 'upgrade'; readonly id: number }
  | { readonly kind: 'delete'; readonly id: number }
  | { readonly kind: 'openCity'; readonly id: number }
  | { readonly kind: 'select'; readonly id: number }
  | { readonly kind: 'produceHeli'; readonly id: number }
  | { readonly kind: 'deploy'; readonly factory: number; readonly cell: number }
  | { readonly kind: 'ship'; readonly port: number; readonly cell: number }
  | { readonly kind: 'propose'; readonly seat: number; readonly treaty: number }
  | { readonly kind: 'break'; readonly seat: number }
  | { readonly kind: 'embargo'; readonly seat: number; readonly lift: boolean }
  /** An entry of a registered provider (M15b): the page hands it to the provider's own handler. */
  | { readonly kind: 'extension'; readonly id: string; readonly cell: number };

export type ContextGroupId = 'act' | 'build' | 'diplo';

export interface ContextEntry {
  readonly id: string;
  readonly group: ContextGroupId;
  readonly labelKey: TextKey;
  readonly params: TextParams;
  readonly state: 'ok' | 'disabled';
  /** The visible reason of a disabled entry (the key the panels use for the sim's refusal code). */
  readonly reasonKey?: TextKey;
  /** The sim's refusal code behind `reasonKey` (tests compare it with the validator). */
  readonly reasonCode?: number;
  /** The values the reason texts may name (`{code}`, `{max}`: the helicopter troop cap). */
  readonly reasonParams?: TextParams;
  /** Gold price shown beside the name (whole gold), when the action costs something. */
  readonly priceGold?: number;
  /** The key that does the same thing (printed as a hint), when there is one. */
  readonly keyHint?: string;
  /** The first activation only arms the entry (it asks again); the second one acts. */
  readonly confirm?: boolean;
  readonly effect: ContextEffect;
}

export interface ContextGroup {
  readonly id: ContextGroupId;
  /** A group without a title is a plain list (the main entries). */
  readonly titleKey?: TextKey;
  readonly params: TextParams;
  readonly keyHint?: string;
  /** Unfolded when the menu opens. */
  readonly open: boolean;
}

export interface ContextModel {
  readonly title: { readonly key: TextKey; readonly params: TextParams };
  readonly groups: readonly ContextGroup[];
  readonly entries: readonly ContextEntry[];
  /** Why there is no menu (the page shows a short toast), or null. */
  readonly blocked: null | 'unplayable' | 'not-spawned';
}

/** What the page knows that the view does not: names, the commit slider, the Nav and the deploy / ship box values. */
export interface ContextOptions {
  nameOf(seat: number): string;
  /** The commit percent of an attack (the HUD slider). */
  readonly commitPct: number;
  /** The Nav the helicopter validator reads, or null when the page has none (then every helicopter entry is dimmed with "no route"). */
  readonly nav: Nav | null;
  /** The troops and the flight mode (0 low, 1 high) the deploy box shows. */
  readonly heliTroops: number;
  readonly heliMode: number;
}

export interface ContextTarget {
  readonly cell: number;
  /** The id of YOUR structure on this cell (or beside it), -1 = none. */
  readonly structure: number;
}

const NO_PARAMS: TextParams = {};

// ---- providers (M15b hooks in here) -----------------------------------------------------------------------------------------------

export interface ContextProviderInput {
  readonly view: SimView;
  readonly localSeat: number;
  readonly target: ContextTarget;
  /** 'own' = your land, 'nation' = another nation's land, 'neutral' = nobody's or a tribe's. */
  readonly kind: 'own' | 'nation' | 'neutral';
}
export type ContextProvider = (input: ContextProviderInput, out: ContextEntry[]) => void;

const providers: ContextProvider[] = [];

/** Adds a provider that may append entries (group 'act') to every menu; returns the function that removes it. */
export function registerContextProvider(provider: ContextProvider): () => void {
  providers.push(provider);
  return () => {
    const i = providers.indexOf(provider);
    if (i >= 0) providers.splice(i, 1);
  };
}

// ---- the choice of a Factory / Port ------------------------------------------------------------------------------------------------

/**
 * The refusal codes in the order the sim checks them, earliest first: of several candidates that all fail, the one that got FURTHEST is the best candidate and its reason is the
 * one shown (a Factory with a helicopter on the pad that only lacks a route beats one with no pad). A code not listed ranks as the latest (a landing-zone reason).
 */
const HELI_RANK: readonly number[] = [REJECT_PHASE, REJECT_HELI_NO_FACTORY, REJECT_HELI_NO_PAD, REJECT_HELI_BAD_TROOPS, REJECT_HELI_BEACHHEAD_FULL];
const SHIP_RANK: readonly number[] = [
  REJECT_PHASE,
  REJECT_SHIP_NO_PORT,
  REJECT_SHIP_NOT_OWNER,
  REJECT_SHIP_PORT_BUILDING,
  REJECT_SHIP_PORT_BUSY,
  REJECT_SHIP_COOLDOWN,
  REJECT_SHIP_FLEET_CAP,
  REJECT_SHIP_TROOPS_LOW,
  REJECT_SHIP_TROOPS_HIGH,
  REJECT_SHIP_NO_TROOPS,
  REJECT_SHIP_NO_GOLD,
  REJECT_SHIP_TABLE_FULL,
  REJECT_HELI_BEACHHEAD_FULL,
  REJECT_SHIP_BAD_TARGET,
  REJECT_DIPLO_TREATY_BOUND,
  REJECT_SHIP_NO_ROUTE,
];

function rankOf(order: readonly number[], code: number): number {
  const i = order.indexOf(code);
  return i < 0 ? order.length : i;
}

export interface Pick {
  /** The structure id, -1 = none exists. */
  readonly id: number;
  /** 0 = the launch is accepted, else the refusal code of the best candidate. */
  readonly reason: number;
}

/** The first own Factory whose `validateLaunchHeli` accepts; else the best failing candidate (the one that got furthest); -1 / NO_FACTORY without any Factory. */
export function pickFactory(view: SimView, seat: number, cell: number, nav: Nav | null, troops: number, mode: number): Pick {
  const s = view.structures;
  const owner = seatToOwner(seat);
  let best: Pick = { id: -1, reason: REJECT_HELI_NO_FACTORY };
  let bestRank = -1;
  for (let id = 0; id < s.highWater; id++) {
    if (s.owner[id] !== owner || s.type[id] !== STRUCT_FACTORY) continue;
    const reason = spawnPhaseBlocks(view) ? REJECT_PHASE : nav === null ? (padHeliOf(view, seat, id) < 0 ? REJECT_HELI_NO_PAD : REJECT_HELI_NO_ROUTE) : validateLaunchHeli(view, nav, seat, id, cell, troops, mode);
    if (reason === REJECT_NONE) return { id, reason };
    const r = rankOf(HELI_RANK, reason);
    if (r > bestRank) {
      bestRank = r;
      best = { id, reason };
    }
  }
  return best;
}

/** The first own Port whose `validateLaunchShip` accepts the clicked cell; else the best failing candidate. The sim itself decides "a sea route to a coast near the target". */
export function pickPort(view: SimView, seat: number, cell: number): Pick {
  const s = view.structures;
  const owner = seatToOwner(seat);
  const troops = Math.min(SHIP.troopsDefault, shipSliderMax(view, seat));
  let best: Pick = { id: -1, reason: REJECT_SHIP_NO_PORT };
  let bestRank = -1;
  for (let id = 0; id < s.highWater; id++) {
    if (s.owner[id] !== owner || s.type[id] !== STRUCT_PORT) continue;
    const reason = validateLaunchShip(view, seat, id, cell, troops);
    if (reason === REJECT_NONE) return { id, reason };
    const r = rankOf(SHIP_RANK, reason);
    if (r > bestRank) {
      bestRank = r;
      best = { id, reason };
    }
  }
  return best;
}

// ---- entries ----------------------------------------------------------------------------------------------------------------------

const entry = (e: ContextEntry): ContextEntry => e;
/** The helicopter troop cap of the seat the model is being built for (the reason text of a bad troop count names it); set at the top of `contextActionsFor`. */
let reasonMax = 0;

function gate(id: string, group: ContextGroupId, labelKey: TextKey, params: TextParams, reason: number, effect: ContextEffect, extra: Partial<ContextEntry> = {}): ContextEntry {
  return entry({ id, group, labelKey, params, state: reason === REJECT_NONE ? 'ok' : 'disabled', ...(reason === REJECT_NONE ? {} : { reasonKey: rejectKey(reason), reasonCode: reason, reasonParams: { code: reason, max: reasonMax } }), effect, ...extra });
}

const BUILD_ORDER: readonly number[] = [STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_SILO, STRUCT_SAM, STRUCT_POST, STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT];

/** The diplomacy refusals that mean "this can never apply to this relation" (the entry is left out); every other refusal shows the entry dimmed with its reason. */
const NEVER_APPLIES: readonly number[] = [REJECT_DIPLO_AT_PEACE, REJECT_DIPLO_ALLIED, REJECT_DIPLO_NO_TREATY, REJECT_DIPLO_NOT_PLAYER, REJECT_DIPLO_SELF];

function diploEntries(view: SimView, seat: number, target: number, out: ContextEntry[]): void {
  const row = buildDiploRows(view, seat).find((r) => r.seat === target);
  if (row === undefined) return;
  const add = (id: string, labelKey: TextKey, reason: number, effect: ContextEffect, confirm = false): void => {
    if (NEVER_APPLIES.includes(reason)) return;
    out.push(gate(id, 'diplo', labelKey, NO_PARAMS, reason, effect, confirm ? { confirm: true } : {}));
  };
  add('diplo-truce', 'diplo.btn.truce', row.truce.reason, { kind: 'propose', seat: target, treaty: TREATY_TRUCE });
  add('diplo-alliance', 'diplo.btn.alliance', row.alliance.reason, { kind: 'propose', seat: target, treaty: TREATY_ALLIANCE });
  add('diplo-break', 'diplo.btn.break', row.breakTreaty.reason, { kind: 'break', seat: target }, true);
  add('diplo-embargo', row.embargoOwn ? 'diplo.btn.lift' : 'diplo.btn.embargo', row.embargoButton.reason, { kind: 'embargo', seat: target, lift: row.embargoOwn });
}

/** The menu for the cell `target.cell` as seen by `localSeat`. */
export function contextActionsFor(view: SimView, localSeat: number, target: ContextTarget, opts: ContextOptions): ContextModel {
  const cell = target.cell;
  reasonMax = heliMaxTroopsOf(view, localSeat);
  const none = (blocked: ContextModel['blocked']): ContextModel => ({ title: { key: 'ctx.title.land', params: NO_PARAMS }, groups: [], entries: [], blocked });
  if ((view.stats.capital[localSeat] as number) === 0) return none('not-spawned');
  if (!isPlayableClass(view.terrainClass[cell] as number)) return none('unplayable');
  const localOwner = seatToOwner(localSeat);
  const owner = view.owner[cell] as number;
  const entries: ContextEntry[] = [];
  const groups: ContextGroup[] = [];
  let title: ContextModel['title'];
  let kind: ContextProviderInput['kind'];

  if (owner === localOwner) {
    kind = 'own';
    const id = target.structure;
    if (id < 0) {
      title = { key: 'ctx.title.own', params: NO_PARAMS };
      groups.push({ id: 'build', titleKey: 'ctx.group.build', params: NO_PARAMS, open: true });
      const phase = spawnPhaseBlocks(view);
      for (const type of BUILD_ORDER) {
        const reason = phase ? REJECT_PHASE : validateBuild(view, localSeat, type, cell);
        entries.push(gate(`build.${type}`, 'build', structureNameKey(type), NO_PARAMS, reason, { kind: 'build', type, cell }, { priceGold: Math.floor(buildPriceMilli(view.structures, localOwner, type) / 1000), keyHint: String(type) }));
      }
    } else {
      const info = selectionInfo(view, localSeat, id);
      const type = view.structures.type[id] as number;
      title = { key: structureNameKey(type), params: NO_PARAMS };
      groups.push({ id: 'act', params: NO_PARAMS, open: true });
      if (info !== null) {
        entries.push(gate('upgrade', 'act', 'ctx.upgrade', { level: info.level + 1 }, info.upgradeReason, { kind: 'upgrade', id }, info.upgradePrice > 0 ? { priceGold: info.upgradePrice } : {}));
        if (type === STRUCT_CITY) entries.push(entry({ id: 'city', group: 'act', labelKey: 'ctx.openCity', params: NO_PARAMS, state: 'ok', effect: { kind: 'openCity', id } }));
        if (type === STRUCT_FACTORY) {
          const h = heliPanelInfo(view, localSeat, id);
          entries.push(gate('produceHeli', 'act', 'ctx.produceHeli', NO_PARAMS, h.reason, { kind: 'produceHeli', id }, { priceGold: HELI_PRICE_GOLD }));
          const pad = padHeliOf(view, localSeat, id);
          entries.push(gate('deploySend', 'act', 'ctx.deploySend', NO_PARAMS, spawnPhaseBlocks(view) ? REJECT_PHASE : pad < 0 ? REJECT_HELI_NO_PAD : REJECT_NONE, { kind: 'deploy', factory: id, cell: -1 }, { keyHint: 'L' }));
        }
        if (type === STRUCT_PORT) entries.push(gate('shipSend', 'act', 'ctx.shipSend', NO_PARAMS, spawnPhaseBlocks(view) ? REJECT_PHASE : shipButtonReason(view, localSeat, id), { kind: 'ship', port: id, cell: -1 }, { keyHint: 'B' }));
        entries.push(entry({ id: 'select', group: 'act', labelKey: 'ctx.select', params: NO_PARAMS, state: 'ok', effect: { kind: 'select', id } }));
        entries.push(gate('delete', 'act', 'ctx.delete', NO_PARAMS, info.deleteReason, { kind: 'delete', id }, { confirm: true }));
      }
    }
  } else {
    const seat = owner - 1;
    const nation = owner > 0 && seat < view.players;
    kind = nation ? 'nation' : 'neutral';
    title = nation ? { key: 'ctx.title.nation', params: { name: opts.nameOf(seat) } } : { key: 'ctx.title.land', params: NO_PARAMS };
    groups.push({ id: 'act', params: NO_PARAMS, open: true });
    // Attack: the very intent of a plain right click; a treaty party is not attacked (`attackBlock`), the spawn phase refuses everything
    const troops = Math.floor(((view.stats.troopsQt[localSeat] as number) / QT_PER_TROOP) * opts.commitPct / 100);
    const attackReason = spawnPhaseBlocks(view) ? REJECT_PHASE : attackBlock(view, localSeat, owner);
    entries.push(gate('attack', 'act', 'ctx.attack', { pct: opts.commitPct, troops }, attackReason, { kind: 'attack', owner, cell }));
    const factory = pickFactory(view, localSeat, cell, opts.nav, opts.heliTroops, opts.heliMode);
    entries.push(gate('deployHere', 'act', 'ctx.deployHere', NO_PARAMS, factory.reason, { kind: 'deploy', factory: factory.id, cell }));
    const port = pickPort(view, localSeat, cell);
    entries.push(gate('shipHere', 'act', 'ctx.shipHere', NO_PARAMS, port.reason, { kind: 'ship', port: port.id, cell }));
    if (nation) {
      diploEntries(view, localSeat, seat, entries);
      if (entries.some((e) => e.group === 'diplo')) groups.push({ id: 'diplo', titleKey: 'ctx.group.diplo', params: { name: opts.nameOf(seat) }, keyHint: 'D', open: false });
    }
  }
  const input: ContextProviderInput = { view, localSeat, target, kind };
  for (const p of providers) p(input, entries);
  return { title, groups, entries, blocked: null };
}

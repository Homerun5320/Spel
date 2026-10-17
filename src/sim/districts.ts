// Applying the district intents (Districts-1): BuildDistrict, UpgradeDistrict, RemoveDistrict. The rules are the shared `check*District` functions of
// src/sim/districtRules.ts (the very ones UI and AI call through `validate*District`); this file only takes the price, changes the table and starts
// the Delete cooldown. Like Build / Upgrade / Delete they are refused with REJECT_PHASE in the spawn phase of a match that has one (Fix-Sim).
import { DELETE_COOLDOWN_TICKS, DISTRICT_BUILD_TICKS, MILLI_GOLD_PER_GOLD } from './rules';
import { REJECT_NONE, REJECT_PHASE } from './intents';
import { checkBuildDistrict, checkRemoveDistrict, checkUpgradeDistrict, districtBuildPriceMilli, districtIndex, districtUpgradePriceGold } from './districtRules';
import { seatToOwner, type GameState } from './state';
import { spawnPhaseRefuses } from './structures';

/** Applies a BuildDistrict: the checks, then the price is taken and the district starts as level 1, finished after its build time. */
export function applyBuildDistrict(state: GameState, seat: number, structure: number, slot: number, kind: number): number {
  if (spawnPhaseRefuses(state)) return REJECT_PHASE;
  const t = state.structures;
  const ownerId = seatToOwner(seat);
  const why = checkBuildDistrict(t, t, state.tick, state.gold[ownerId] as number, seat, structure, slot, kind);
  if (why !== REJECT_NONE) return why;
  state.gold[ownerId] = (state.gold[ownerId] as number) - districtBuildPriceMilli(t, ownerId, kind);
  t.setDistrict(structure, slot, kind, 1, state.tick + (DISTRICT_BUILD_TICKS[kind] as number), 0);
  state.match.districts[ownerId] = ((state.match.districts[ownerId] as number) + 1) >>> 0;
  return REJECT_NONE;
}

/** Applies an UpgradeDistrict: pays base * (level + 1) and starts the upgrade, which takes the kind's build time. */
export function applyUpgradeDistrict(state: GameState, seat: number, structure: number, slot: number): number {
  if (spawnPhaseRefuses(state)) return REJECT_PHASE;
  const t = state.structures;
  const ownerId = seatToOwner(seat);
  const why = checkUpgradeDistrict(t, t, state.tick, state.gold[ownerId] as number, seat, structure, slot);
  if (why !== REJECT_NONE) return why;
  const at = districtIndex(structure, slot);
  const kind = t.districtKind[at] as number;
  state.gold[ownerId] = (state.gold[ownerId] as number) - districtUpgradePriceGold(kind, (t.districtLevel[at] as number) + 1) * MILLI_GOLD_PER_GOLD;
  t.districtUpgradeReadyTick[at] = state.tick + (DISTRICT_BUILD_TICKS[kind] as number);
  t.effDirty = true;
  return REJECT_NONE;
}

/** Applies a RemoveDistrict: the district goes (no refund) and the seat's Delete cooldown starts. */
export function applyRemoveDistrict(state: GameState, seat: number, structure: number, slot: number): number {
  if (spawnPhaseRefuses(state)) return REJECT_PHASE;
  const t = state.structures;
  const why = checkRemoveDistrict(t, t, state.tick, t.deleteReadyTick(seatToOwner(seat)), seat, structure, slot);
  if (why !== REJECT_NONE) return why;
  t.clearDistrict(structure, slot);
  t.deleteReady[seatToOwner(seat)] = state.tick + DELETE_COOLDOWN_TICKS;
  return REJECT_NONE;
}

// The missiles of M14a: LaunchMissile, the blast and its aftermath. The flight itself is a pure function of the row (src/sim/missileGeom.ts); the phase only waits for the blast tick.
//   Silo -> (flight, launchTick .. impactTick) -> blast.
// A blast of a Fission or Fusion missile: the inner disc turns neutral through `setOwner` (the one writer of the owner array, so the frontier and enclave invariants hold), its buildings are
// destroyed and its land is fallout for FALLOUT_TICKS; the outer ring hits each building with MISSILE_OUTER_HIT_PCT percent (a stateless hash roll) for one level (a level 1 building is
// destroyed); every owner with land within the outer radius loses min(60 % of its troops, 3 x troops x cellsHit / cells owned). A Tactical missile hits buildings only: no owner changes, no fallout,
// no troop loss. Decision (DECISIONS M14a): a missile is refused at launch when its target cell belongs to a nation that is not hostile; a blast that still reaches such a nation's land or
// buildings breaks the treaty (war again, the break cooldown, a betrayal in the statistics, as BreakTreaty), except a federation, which cannot be broken: it only counts the betrayal.
// The SAM interception (M14b) is src/sim/interceptor.ts: `interceptPhase` runs first in `missilePhase` (after the launches of the tick, before the blasts), so a warhead shot down at its meeting tick never blows up.
import { RELATION_ALLIANCE, RELATION_WAR, ALLIANCE_FEDERATION } from './diplomacyTable';
import { atWar } from './diplomacy';
import { interceptPhase } from './interceptor';

export { interceptPhase };
import { dirtyTrade } from './diplomacyClear';
import { districtSlotsOf } from './districtRules';
import { REJECT_NONE } from './intents';
import { forEachInBlast, inBlast } from './missileBlast';
import { checkLaunchMissile, emptyMissilePlan } from './missileRules';
import { MISSILE_TACTICAL, MISSILE_CLASS_COUNT } from './missileTable';
import {
  OUTBOX_MISSILE_BUILDING_DESTROYED,
  OUTBOX_MISSILE_DETONATED,
  OUTBOX_MISSILE_LAUNCHED,
  OUTBOX_MISSILE_WARNING,
} from './outbox';
import { splitmix32Mix } from './rng';
import {
  DISTRICT_MAX_SLOTS,
  FALLOUT_TICKS,
  MISSILE_CAPACITY,
  MISSILE_COOLDOWN_TICKS,
  MISSILE_OUTER_HIT_PCT,
  MISSILE_R_IN_KM,
  MISSILE_R_OUT_KM,
  MISSILE_TROOP_LOSS_CAP_PCT,
  MISSILE_TROOP_LOSS_FACTOR,
  TREATY_BREAK_COOLDOWN_TICKS,
} from './rules';
import { missilePriceMilli, type MissileSource } from './missileRules';
import { ownerSlots, seatToOwner, type GameState } from './state';
import { STRUCT_CITY, STRUCT_FACTORY } from './structureRules';
import { setOwner } from './territory';
import { spawnPhaseRefuses } from './structures';
import { scrapFactoryHelis } from './heliPhase';

/** The sim's own state as the read-only source of the missile rules. */
function sourceOf(state: GameState): MissileSource {
  return { tick: state.tick, width: state.width, height: state.height, terrainClass: state.terrain, owner: state.owner, structures: state.structures, missiles: state.missiles };
}

const PLAN = emptyMissilePlan();

/** Applies a LaunchMissile: the rules (checkLaunchMissile), then the gold is taken, the Silo cools down and the missile is in the air. */
export function applyLaunchMissile(state: GameState, seat: number, silo: number, cls: number, targetCell: number): number {
  const ownerId = seatToOwner(seat);
  const why = checkLaunchMissile(
    sourceOf(state),
    spawnPhaseRefuses(state),
    seat,
    silo,
    cls,
    targetCell,
    state.gold[ownerId] as number,
    (o) => o !== ownerId && atWar(state, ownerId, o),
    PLAN,
  );
  if (why !== REJECT_NONE) return why;
  const m = state.missiles;
  const k = ownerId * MISSILE_CLASS_COUNT + cls;
  state.gold[ownerId] = (state.gold[ownerId] as number) - missilePriceMilli(cls, m.launches[k] as number);
  if ((m.launches[k] as number) < 65535) m.launches[k] = (m.launches[k] as number) + 1;
  state.structures.salvoTick[silo] = state.tick + MISSILE_COOLDOWN_TICKS;
  const id = PLAN.slot;
  const ticks = PLAN.track.ticks;
  m.add(id, ownerId, cls, silo, state.tick, state.tick + ticks, state.structures.cell[silo] as number, targetCell);
  state.outbox.push(OUTBOX_MISSILE_LAUNCHED, state.tick, id, targetCell);
  const targetOwner = state.owner[targetCell] as number;
  if (targetOwner !== 0 && targetOwner !== ownerId) state.outbox.push(OUTBOX_MISSILE_WARNING, state.tick, id, ticks);
  return REJECT_NONE;
}

/** The stateless roll of the outer ring: 0..99 from the match seed, the tick, the missile and the cell. */
function ringRoll(seed: number, tick: number, missile: number, cell: number): number {
  const h = splitmix32Mix(splitmix32Mix(splitmix32Mix(seed | 0) ^ tick) ^ (Math.imul(missile + 1, 0x9e3779b1) | 0));
  return splitmix32Mix(h ^ (Math.imul(cell + 1, 0x85ebca6b) | 0)) % 100;
}

function destroyStructure(state: GameState, id: number): void {
  const t = state.structures;
  if (t.type[id] === STRUCT_FACTORY) scrapFactoryHelis(state, id);
  state.outbox.push(OUTBOX_MISSILE_BUILDING_DESTROYED, state.tick, t.cell[id] as number, t.type[id] as number);
  t.remove(id);
}

/** One level off a building (a level 1 building is destroyed). A City that drops below the slots of its districts loses the highest ones. */
function hitStructure(state: GameState, id: number): void {
  const t = state.structures;
  const level = t.level[id] as number;
  if (level <= 1) {
    destroyStructure(state, id);
    return;
  }
  t.level[id] = level - 1;
  t.upgradeReadyTick[id] = 0;
  if (t.type[id] === STRUCT_CITY && t.districtCount !== 0) {
    const keep = districtSlotsOf(level - 1);
    for (let slot = keep; slot < DISTRICT_MAX_SLOTS; slot++) t.clearDistrict(id, slot);
  }
  t.effDirty = true;
  t.version++;
}

/** The launcher breaks (or, in a federation, only dishonours) its relation with an owner whose land or buildings the blast reached. */
function betray(state: GameState, me: number, other: number): void {
  const d = state.diplo;
  const rel = d.relationOf(me, other);
  if (rel === RELATION_WAR) return;
  const bound = rel === RELATION_ALLIANCE && d.until[me * d.slots + other] === ALLIANCE_FEDERATION;
  if (!bound) {
    d.setRelation(me, other, RELATION_WAR, 0);
    dirtyTrade(state);
  }
  d.cooldownUntil[me] = state.tick + TREATY_BREAK_COOLDOWN_TICKS;
  d.version++;
  state.match.treatiesBroken[me] = ((state.match.treatiesBroken[me] as number) + 1) >>> 0;
}

/**
 * The blast of one missile at `center` with the given radii (km). `missileId` only seeds the roll of the outer ring. Exported for the tests and the synthetic 100k-cell case; the phase calls it
 * with the radii of the class.
 */
export function blastAt(state: GameState, launcher: number, missileId: number, cls: number, center: number, rInKm: number, rOutKm: number): void {
  const w = state.width;
  const h = state.height;
  const tick = state.tick;
  const slots = ownerSlots(state.header.seats);
  const touched = new Uint8Array(slots);
  const land = cls !== MISSILE_TACTICAL;
  if (land) {
    // 1. Who has land in the outer radius, and how much (counted BEFORE the inner disc turns neutral); the troop loss follows.
    const hit = new Uint32Array(slots);
    const owner = state.owner;
    const playable = state.grid.playable;
    forEachInBlast(w, h, center, rOutKm, (c) => {
      const o = owner[c] as number;
      if (o !== 0 && playable[c] === 1) hit[o] = (hit[o] as number) + 1;
    });
    for (let o = 1; o < slots; o++) {
      const cells = hit[o] as number;
      if (cells === 0) continue;
      touched[o] = 1;
      const troops = state.troops[o] as number;
      const owned = state.agg.area[o] as number;
      const cap = Math.floor((troops * MISSILE_TROOP_LOSS_CAP_PCT) / 100);
      const share = owned > 0 ? Math.floor((MISSILE_TROOP_LOSS_FACTOR * troops * cells) / owned) : cap;
      state.troops[o] = troops - (share < cap ? share : cap);
    }
  }
  // 2. Buildings: all of the inner disc, each of the outer ring with a roll. By ascending id.
  const t = state.structures;
  for (let id = 0; id < t.highWater; id++) {
    const o = t.owner[id] as number;
    if (o === 0) continue;
    const c = t.cell[id] as number;
    if (!inBlast(w, h, center, rOutKm, c)) continue;
    touched[o] = 1;
    if (inBlast(w, h, center, rInKm, c)) destroyStructure(state, id);
    else if (ringRoll(state.header.seed, tick, missileId, c) < MISSILE_OUTER_HIT_PCT) hitStructure(state, id);
  }
  // 3. The inner disc turns neutral and becomes fallout.
  if (land) {
    const until = tick + FALLOUT_TICKS;
    const owner = state.owner;
    const playable = state.grid.playable;
    const m = state.missiles;
    forEachInBlast(w, h, center, rInKm, (c) => {
      if (playable[c] !== 1) return;
      if (owner[c] !== 0) setOwner(state, c, 0, 0);
      m.setFallout(c, until);
    });
  }
  // 4. The treaty: an owner the launcher is not at war with, but whose land or buildings were hit.
  for (let o = 1; o < slots; o++) if (touched[o] === 1 && o !== launcher) betray(state, launcher, o);
  state.outbox.push(OUTBOX_MISSILE_DETONATED, tick, cls, center);
}

/** One tick of the missiles. Called after `shipPhase`. O(MISSILE_CAPACITY), nothing at all without missiles. */
export function missilePhase(state: GameState): void {
  const m = state.missiles;
  if (m.liveCount === 0) return;
  interceptPhase(state);
  const tick = state.tick;
  for (let id = 0; id < MISSILE_CAPACITY; id++) {
    if (m.owner[id] === 0 || (m.impactTick[id] as number) > tick) continue;
    const cls = m.cls[id] as number;
    const launcher = m.owner[id] as number;
    const target = m.targetCell[id] as number;
    m.remove(id);
    blastAt(state, launcher, id, cls, target, MISSILE_R_IN_KM[cls] as number, MISSILE_R_OUT_KM[cls] as number);
  }
}

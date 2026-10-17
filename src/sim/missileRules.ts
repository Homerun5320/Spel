// The missile rules that UI and AI may read (M14a): the LaunchMissile check, the price, and the two previews. Pure and read-only: everything takes a read-only window (`MissileSource`) and
// returns numbers. The sim's own LaunchMissile (src/sim/missilePhase.ts) calls `checkLaunchMissile`, the SAME function `validateMissileLaunch` wraps (the pattern of `checkLaunchShip`).
import { PHASE_SPAWN } from './flow';
import {
  REJECT_CELL,
  REJECT_MISSILE_BAD_CLASS,
  REJECT_MISSILE_COOLDOWN,
  REJECT_MISSILE_NEED_SILO_L2,
  REJECT_MISSILE_NOT_HOSTILE,
  REJECT_MISSILE_NOT_OWNER,
  REJECT_MISSILE_NO_GOLD,
  REJECT_MISSILE_NO_SILO,
  REJECT_MISSILE_OUT_OF_RANGE,
  REJECT_MISSILE_SILO_NOT_READY,
  REJECT_MISSILE_TABLE_FULL,
  REJECT_MISSILE_TARGET_NOT_LAND,
  REJECT_NONE,
  REJECT_PHASE,
} from './intents';
import { blastRows, blastSpans, inBlast } from './missileBlast';
import { cellVector, chordOfAngle, chordQ15, inRange, missilePosition, newTrack, trackOf, type Track } from './missileGeom';
import { MISSILE_CLASS_COUNT, MISSILE_TACTICAL, type MissileView } from './missileTable';
import { hostileOwners } from './hostile';
import { MILLI_GOLD_PER_GOLD, MISSILE_BASE_GOLD, MISSILE_FUSION_SILO_LEVEL, MISSILE_PRICE_STEP_PCT, MISSILE_R_IN_KM, MISSILE_R_OUT_KM, MISSILE_SAM_HIT_PCT } from './rules';
import { ownerSlots, seatToOwner } from './state';
import { samRadiusCells } from './structureEffects';
import { STRUCT_SAM, STRUCT_SILO, type StructureView } from './structureRules';
import { CLASS_MOUNTAIN, CLASS_PLAINS } from './terrain';
import type { SimView } from './view';

type Numbers = { readonly [index: number]: number };

/** What the missile rules read: the tick, the map layers, the structure table, the missile table and (for the hostility test) the diplomacy window. A SimView is one. */
export interface MissileSource {
  readonly tick: number;
  readonly width: number;
  readonly height: number;
  readonly terrainClass: Numbers;
  readonly owner: Numbers;
  readonly structures: StructureView & { readonly salvoTick?: Numbers };
  readonly missiles: MissileView;
}

/** Milli-gold a launch of class `cls` costs a seat that has fired `launches` missiles of it before: base x (100 + step x n) / 100. */
export function missilePriceMilli(cls: number, launches: number): number {
  return Math.floor(((MISSILE_BASE_GOLD[cls] as number) * MILLI_GOLD_PER_GOLD * (100 + MISSILE_PRICE_STEP_PCT * launches)) / 100);
}

/** What a successful check found: the free slot and the flight. */
export interface MissilePlan {
  slot: number;
  track: Track;
}

/** A fresh plan to pass to `checkLaunchMissile`. */
export function emptyMissilePlan(): MissilePlan {
  return { slot: -1, track: newTrack() };
}

/**
 * THE LaunchMissile rules, in this order: the spawn phase (REJECT_PHASE), the class (REJECT_MISSILE_BAD_CLASS), a live Silo (NO_SILO), the owner (NOT_OWNER), the Silo is finished
 * (SILO_NOT_READY), its cooldown (COOLDOWN), a Fusion missile needs level 2 (NEED_SILO_L2), the target cell (REJECT_CELL off the map, TARGET_NOT_LAND on water), its owner is hostile or nobody
 * (NOT_HOSTILE: a truce, an alliance, a federation or the seat's own land), the range (OUT_OF_RANGE), the purse (NO_GOLD) and a free slot (TABLE_FULL). On REJECT_NONE `plan` holds the slot
 * and the flight. `goldMilli` is the seat's purse in milli-gold, `hostile(ownerId)` whether the seat is at war with that owner. The sim and the public `validateMissileLaunch` both call it.
 */
export function checkLaunchMissile(src: MissileSource, phaseRefuses: boolean, seat: number, silo: number, cls: number, targetCell: number, goldMilli: number, hostile: (targetOwner: number) => boolean, plan: MissilePlan): number {
  if (phaseRefuses) return REJECT_PHASE;
  if (!Number.isInteger(cls) || cls < 0 || cls >= MISSILE_CLASS_COUNT) return REJECT_MISSILE_BAD_CLASS;
  const s = src.structures;
  if (!Number.isInteger(silo) || silo < 0 || silo >= s.highWater || s.owner[silo] === 0 || s.type[silo] !== STRUCT_SILO) return REJECT_MISSILE_NO_SILO;
  const ownerId = seatToOwner(seat);
  if (s.owner[silo] !== ownerId) return REJECT_MISSILE_NOT_OWNER;
  if (src.tick < (s.readyTick[silo] as number)) return REJECT_MISSILE_SILO_NOT_READY;
  const sal = s.salvoTick;
  if (sal !== undefined && src.tick < (sal[silo] as number)) return REJECT_MISSILE_COOLDOWN;
  if (cls === 2 && (s.level[silo] as number) < MISSILE_FUSION_SILO_LEVEL) return REJECT_MISSILE_NEED_SILO_L2;
  if (!Number.isInteger(targetCell) || targetCell < 0 || targetCell >= src.width * src.height) return REJECT_CELL;
  if ((src.terrainClass[targetCell] as number) < CLASS_PLAINS) return REJECT_MISSILE_TARGET_NOT_LAND;
  const targetOwner = src.owner[targetCell] as number;
  if (targetOwner !== 0 && !hostile(targetOwner)) return REJECT_MISSILE_NOT_HOSTILE;
  const t = trackOf(s.cell[silo] as number, targetCell, src.width, src.height, cls, plan.track);
  if (!inRange(t.chord, cls)) return REJECT_MISSILE_OUT_OF_RANGE;
  if (goldMilli < missilePriceMilli(cls, src.missiles.launchesOf(ownerId, cls))) return REJECT_MISSILE_NO_GOLD;
  const slot = firstFree(src.missiles);
  if (slot < 0) return REJECT_MISSILE_TABLE_FULL;
  plan.slot = slot;
  return REJECT_NONE;
}

function firstFree(m: MissileView): number {
  for (let i = 0; i < m.capacity; i++) if (m.owner[i] === 0) return i;
  return -1;
}

/**
 * Why `seat` could not fire a missile of class `cls` from Silo `silo` at `targetCell` right now in the snapshot `view` (REJECT_NONE = it could). The sim runs the same
 * `checkLaunchMissile`. One difference: a ViewMirror does not carry the salvo clock of the Silo, so the cooldown is only checked on a StateView (BACKLOG).
 */
export function validateMissileLaunch(view: SimView, seat: number, silo: number, cls: number, targetCell: number): number {
  return checkLaunchMissile(view, view.flow && view.phase === PHASE_SPAWN, seat, silo, cls, targetCell, view.stats.goldMilli[seat] as number, (o) => hostileOwners(view, seatToOwner(seat), o), emptyMissilePlan());
}

/** What a blast would do (M14a): the numbers the targeting UI shows. */
export interface BlastPreview {
  /** Owned land cells that turn neutral (the inner disc; 0 for a Tactical missile, which changes no owner). */
  readonly cells: number;
  /** Owned land cells in the outer radius, the cells the troop loss counts (0 for a Tactical missile). */
  readonly hitCells: number;
  /** Structures in the inner disc: all destroyed. */
  readonly buildingsDestroyed: number;
  /** Structures in the outer ring: each is hit with MISSILE_OUTER_HIT_PCT percent. */
  readonly buildingsAtRisk: number;
  /** Owners with land or a building in the outer radius. */
  readonly owners: number;
}

/** Counts what a missile of class `cls` aimed at `cell` would hit in the snapshot `view`. Pure and read-only. */
export function previewBlast(view: SimView, cell: number, cls: number): BlastPreview {
  const w = view.width;
  const h = view.height;
  const cx = cell % w;
  const cy = (cell - cx) / w;
  const rIn = MISSILE_R_IN_KM[cls] as number;
  const rOut = MISSILE_R_OUT_KM[cls] as number;
  const seen = new Uint8Array(ownerSlots(view.seats));
  let cells = 0;
  let hitCells = 0;
  const landOnly = cls !== MISSILE_TACTICAL;
  if (landOnly) {
    const rows = blastRows(w, h, cx, cy, rOut);
    const sp = blastSpans();
    for (let r = 0; r < rows; r++) {
      const y = sp[r * 3] as number;
      const half = sp[r * 3 + 1] as number;
      const base = y * w;
      const full = half >= w;
      const from = full ? 0 : cx - half;
      const to = full ? w - 1 : cx + half;
      for (let x = from; x <= to; x++) {
        const c = base + (x < 0 ? x + w : x >= w ? x - w : x);
        const o = view.owner[c] as number;
        if (o === 0 || (view.terrainClass[c] as number) < CLASS_PLAINS) continue;
        hitCells++;
        seen[o] = 1;
        if (inBlast(w, h, cell, rIn, c)) cells++;
      }
    }
  }
  const st = view.structures;
  let destroyed = 0;
  let atRisk = 0;
  for (let id = 0; id < st.highWater; id++) {
    const o = st.owner[id] as number;
    if (o === 0) continue;
    const c = st.cell[id] as number;
    if (!inBlast(w, h, cell, rOut, c)) continue;
    seen[o] = 1;
    if (inBlast(w, h, cell, rIn, c)) destroyed++;
    else atRisk++;
  }
  let owners = 0;
  for (let i = 0; i < seen.length; i++) owners += seen[i] as number;
  return { cells, hitCells, buildingsDestroyed: destroyed, buildingsAtRisk: atRisk, owners };
}

/** One air-defence site whose radius a flight crosses (M14b). */
export interface ThreatSite {
  readonly structure: number;
  /** Chance in percent that the site's interceptor kills the warhead (the class chance; the owner's SAM techs are not in a view, see BACKLOG M14b). */
  readonly pct: number;
  /** The tick of the flight (0 = the launch) at which the warhead is first within the radius of the site. */
  readonly fromTick: number;
}

/**
 * The finished SAM sites that are hostile to the owner of `startCell` (the launching Silo's cell; nobody's land counts everybody as hostile) and whose radius the flight from
 * `startCell` to `targetCell` crosses, by ascending structure id. It is the geometry of the flight only: a Tactical missile behind a ridge is still listed (the site may not see it, BACKLOG),
 * and whether an interceptor would be in time is the sim's own question at the moment of firing. Pure and read-only; it allocates (the sampled flight), so it is for a preview, not for a frame.
 */
export function previewThreat(view: SimView, startCell: number, targetCell: number, cls: number): readonly ThreatSite[] {
  const w = view.width;
  const h = view.height;
  const st = view.structures;
  const track = trackOf(startCell, targetCell, w, h, cls, newTrack());
  const f = track.ticks;
  const path = new Int32Array((f + 1) * 3);
  const one = new Int32Array(3);
  for (let t = 0; t <= f; t++) {
    missilePosition(startCell, targetCell, 0, f, t, w, h, one);
    path.set(one, t * 3);
  }
  const launcher = view.owner[startCell] as number;
  const sam = new Int32Array(3);
  const out: ThreatSite[] = [];
  for (let id = 0; id < st.highWater; id++) {
    const so = st.owner[id] as number;
    if (so === 0 || st.type[id] !== STRUCT_SAM || view.tick < (st.readyTick[id] as number) || !hostileOwners(view, launcher, so)) continue;
    const cell = st.cell[id] as number;
    const r = samRadiusCells(st.level[id] as number, (view.terrainClass[cell] as number) === CLASS_MOUNTAIN);
    const rAngle = Math.floor((r * 65536) / w);
    const radiusChord = chordOfAngle(rAngle > 32768 ? 32768 : rAngle);
    cellVector(cell, w, h, sam, 0);
    for (let t = 0; t <= f; t++) {
      if (chordQ15(sam, 0, path, t * 3) > radiusChord) continue;
      out.push({ structure: id, pct: MISSILE_SAM_HIT_PCT[cls] as number, fromTick: t });
      break;
    }
  }
  return out;
}

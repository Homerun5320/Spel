// SAM interception of missiles (M14b). A hostile SAM site that has a warhead inside its radius fires ONE interceptor at it (never a second at the same warhead: the row stays in the table
// until the missile ends). Everything is decided when the interceptor leaves and applied at the meeting tick:
//  - the meeting tick is found by integer iteration over the coming ticks: the first tick at which the warhead's position (`missilePosition`) is within what the interceptor has flown
//    (INTERCEPTOR_SPEED_ANGLE_PER_TICK x ticks, a chord comparison on the unit sphere) and within the site's radius; a warhead that is not reached before its blast is not fired at;
//  - the hit is a stateless roll (splitmix32 mixer on match seed, tick, SAM id and missile id): MISSILE_SAM_HIT_PCT of the class plus the owner's SAM techs; several sites are
//    independent rolls, so their kill chances stack as 1 - prod(1 - p);
//  - at the meeting tick a hit takes the warhead out of the table before the blast phase runs (it never blows up), if the site still stands and its owner is STILL at war with the
//    missile's owner (a truce signed in flight lets the interceptor miss).
// Who can fire: the site must be finished, hostile to the missile's OWNER (`atWar`, as the helicopter rule: an ally or a treaty partner does not shoot), off its salvo clock
// (`salvoTick`, the same word and the same period SAM_SALVO_PERIOD_TICKS (techs: TECH_FX_SAM_SALVO) as the helicopter salvo: a salvo spent on a helicopter is not available for a missile) and the warhead
// must be within the radius of the site (cell distance, as the helicopter rule). A Tactical cruise missile flies low and terrain-following: it must be DETECTED by the SAM owner's coverage and
// inside the site's OWN mask (`Los.detected` and `Los.fireControl` in the Low mode, the rule of a Low helicopter). Fission and Fusion are ballistic: always visible inside the radius.
// Sites are found through the AaIndex of src/sim/airDefense.ts and visited in ascending id for each warhead (ascending id), so the order of the rows is canonical.
import { AaIndex, indexOf, within } from './airDefense';
import { atWar } from './diplomacy';
import { hasOccluders, losOf, navViewOf } from './access';
import { ALT_MODE_LOW, type Los } from './los/cache';
import { cellOfVector, cellVector, chordOfAngle, chordQ15, missilePosition } from './missileGeom';
import { MISSILE_CAPACITY, INTERCEPTOR_SPEED_ANGLE_PER_TICK, MISSILE_SAM_HIT_PCT, SAM_SALVO_PERIOD_TICKS, STRUCT_CAPACITY } from './rules';
import { OUTBOX_MISSILE_INTERCEPTED, OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED } from './outbox';
import { MISSILE_TACTICAL } from './missileTable';
import { splitmix32Mix } from './rng';
import type { GameState } from './state';
import { STRUCT_SAM } from './structureRules';
import { TECH_FX_SAM_HIT, TECH_FX_SAM_SALVO } from './techTable';

const SAM_VEC = new Int32Array(3);
const POS = new Int32Array(3);
const NEAR = new Int32Array(STRUCT_CAPACITY);
const SITES = new Int32Array(STRUCT_CAPACITY);

/** The hit roll of one interceptor, 0..99: a stateless mix of the match seed, the tick it leaves, the SAM id and the missile id. */
export function interceptRoll(seed: number, tick: number, samId: number, missileId: number): number {
  const h = splitmix32Mix(splitmix32Mix(splitmix32Mix(seed | 0) ^ tick) ^ (Math.imul(samId + 1, 0x9e3779b1) | 0));
  return Math.floor((splitmix32Mix(h ^ (Math.imul(missileId + 1, 0x85ebca6b) | 0)) * 100) / 4294967296);
}

/** Percent chance that ONE interceptor of a site of `samOwner` kills a warhead of class `cls` (the class chance plus the owner's SAM techs, at most 100). */
export function interceptPct(state: GameState, samOwner: number, cls: number): number {
  const p = (MISSILE_SAM_HIT_PCT[cls] as number) + state.match.fx(samOwner, TECH_FX_SAM_HIT);
  return p > 100 ? 100 : p;
}

/**
 * The first tick after `tick` at which an interceptor that leaves the site at `samCell` now can be where warhead `id` is, within `radiusCells` of the site; 0 when it cannot be there before
 * the blast (the meeting tick may be the blast tick itself: the interception runs before the blast). Integer iteration over at most radius / speed ticks (a handful).
 */
export function meetingTick(state: GameState, id: number, samCell: number, radiusCells: number, tick: number): number {
  const m = state.missiles;
  const w = state.width;
  const h = state.height;
  cellVector(samCell, w, h, SAM_VEC, 0);
  const rAngle = Math.floor((radiusCells * 65536) / w);
  const radiusChord = chordOfAngle(rAngle > 32768 ? 32768 : rAngle);
  const start = m.startCell[id] as number;
  const target = m.targetCell[id] as number;
  const launch = m.launchTick[id] as number;
  const impact = m.impactTick[id] as number;
  // The meeting must lie within the radius, so the interceptor never needs more than radius / speed ticks: the loop is a handful of steps, not a flight.
  const last = Math.min(impact, tick + Math.ceil(rAngle / INTERCEPTOR_SPEED_ANGLE_PER_TICK));
  for (let t = tick + 1; t <= last; t++) {
    missilePosition(start, target, launch, impact, t, w, h, POS);
    const chord = chordQ15(SAM_VEC, 0, POS, 0);
    if (chord > radiusChord) continue;
    const flown = INTERCEPTOR_SPEED_ANGLE_PER_TICK * (t - tick);
    if (chord <= chordOfAngle(flown > 32768 ? 32768 : flown)) return t;
  }
  return 0;
}

/** The cell warhead `id` is over at `tick`. */
function cellOfMissile(state: GameState, id: number, tick: number): number {
  const m = state.missiles;
  missilePosition(m.startCell[id] as number, m.targetCell[id] as number, m.launchTick[id] as number, m.impactTick[id] as number, tick, state.width, state.height, POS);
  return cellOfVector(POS[0] as number, POS[1] as number, POS[2] as number, state.width, state.height);
}

/** The interceptors that reach their warheads this tick: a hit by a site that still stands and is still at war with the missile's owner takes the warhead out of the table. */
function resolveDue(state: GameState): void {
  const m = state.missiles;
  const st = state.structures;
  const tick = state.tick;
  let i = 0;
  while (i < m.interceptorCount) {
    if (m.iMeet[i] !== tick || m.iHit[i] !== 1) {
      i++;
      continue;
    }
    const id = m.iMissile[i] as number;
    const sam = m.iSam[i] as number;
    const so = st.owner[sam] as number;
    const mo = m.owner[id] as number;
    if (so === 0 || st.type[sam] !== STRUCT_SAM || mo === 0 || so === mo || !atWar(state, so, mo)) {
      i++;
      continue;
    }
    state.outbox.push(OUTBOX_MISSILE_INTERCEPTED, tick, cellOfMissile(state, id, tick), id | (sam << 6));
    m.remove(id); // drops its rows too, so row i is now another one: do not advance
  }
}

/** One tick of the interception: first the interceptors that arrive now, then the sites that fire at warheads inside their radius. Cheap without missiles in the air. */
export function interceptPhase(state: GameState): void {
  const m = state.missiles;
  if (m.liveCount === 0) return;
  if (m.interceptorCount !== 0) resolveDue(state);
  if (m.liveCount === 0) return;
  const idx: AaIndex = indexOf(state);
  if (idx.rebuild(state, false) === 0) return;
  const st = state.structures;
  const w = state.width;
  const tick = state.tick;
  const seed = state.header.seed;
  let los: Los | null = null;
  let losReady = false;
  for (let id = 0; id < MISSILE_CAPACITY; id++) {
    const mo = m.owner[id] as number;
    if (mo === 0 || (m.impactTick[id] as number) <= tick) continue;
    const cell = cellOfMissile(state, id, tick);
    const cx = cell % w;
    const cy = (cell - cx) / w;
    const n = idx.collect(w, cx, cy, NEAR);
    let sites = 0;
    for (let k = 0; k < n; k++) {
      const sid = NEAR[k] as number;
      if (st.type[sid] !== STRUCT_SAM) continue;
      let j = sites++; // insertion sort by id: the rows come out in a canonical order
      while (j > 0 && (SITES[j - 1] as number) > sid) {
        SITES[j] = SITES[j - 1] as number;
        j--;
      }
      SITES[j] = sid;
    }
    const cls = m.cls[id] as number;
    for (let k = 0; k < sites; k++) {
      const sid = SITES[k] as number;
      const so = st.owner[sid] as number;
      if (so === mo || tick < (st.salvoTick[sid] as number) || !atWar(state, so, mo)) continue;
      if (!within(w, cx << 8, cy << 8, st.cell[sid] as number, idx.radius[sid] as number)) continue;
      if (m.hasInterceptor(id, sid)) continue;
      if (cls === MISSILE_TACTICAL) {
        if (!losReady) {
          losReady = true;
          if (hasOccluders(state)) {
            los = losOf(state);
            los.sync(navViewOf(state));
          }
        }
        if (los === null || !los.detected(so, cell, ALT_MODE_LOW) || !los.fireControl(sid, cell, ALT_MODE_LOW)) continue;
      }
      const meet = meetingTick(state, id, st.cell[sid] as number, idx.radius[sid] as number, tick);
      if (meet === 0) continue;
      const hit = interceptRoll(seed, tick, sid, id) < interceptPct(state, so, cls) ? 1 : 0;
      if (!m.addInterceptor(id, sid, tick, meet, hit)) continue;
      const cut = state.match.fx(so, TECH_FX_SAM_SALVO);
      st.salvoTick[sid] = tick + (cut === 0 ? SAM_SALVO_PERIOD_TICKS : SAM_SALVO_PERIOD_TICKS - Math.floor((SAM_SALVO_PERIOD_TICKS * cut) / 100));
      state.outbox.push(OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED, tick, id | (sid << 6), meet * 2 + hit);
    }
  }
}

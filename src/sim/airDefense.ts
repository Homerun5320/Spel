// Air defence against helicopters (M12b). Two kinds of finished structure shoot at a HOSTILE airborne helicopter (`hostile()`, src/sim/hostile.ts: war, not
// truce or alliance, read from the live diplomacy table every tick, so a treaty signed in mid-flight holds from the next tick):
//  - a Defense Post wears it down: POST_AA_TENTHS_PER_TICK per Post within POST_AA_RADIUS_CELLS, in both flight modes, stacking between Posts;
//  - a SAM site fires a salvo every SAM_SALVO_PERIOD_TICKS (the first as soon as a target is valid) at the lowest-id target it can SEE: the owner's coverage
//    detects it (`Los.detected`, Low only above the mask, High anywhere in range), the site's own mask lets it fire (`Los.fireControl`: fire control, range
//    from the level curve `samRadiusCells`), and a salvo hits with SAM_HIT_PCT, drawn from the splitmix32 mixer on (match seed, tick, SAM id). A hit is a kill.
// A helicopter that goes down loses its load (HELI_DOWNED with the cause HELI_DOWN_SAM or HELI_DOWN_POST); it takes no territory.
//
// Order independence (the rule of this file): every decision of a tick is taken from the state as it was at the START of the phase (helicopters are tested in
// ascending id, each SAM picks the lowest-id valid target, no PRNG state is advanced), and only then are the kills and the damage applied. So the order in which the
// structures are visited cannot change the outcome (`airDefensePhase(state, true)` visits them backwards; a test compares the hashes).
// The structures are found through a spatial hash of typed arrays (`AaIndex`, derived data on `state.env`, never hashed or serialised).
import { TECH_FX_SAM_HIT, TECH_FX_SAM_SALVO } from './techTable';
import { hasOccluders, losOf, navViewOf } from './access';
import { atWar } from './diplomacy';
import { downHeli } from './heliFlight';
import { HELI_DOWN_POST, HELI_DOWN_SAM, HELI_LIFT, HELI_PAD, HELI_RETURN } from './heliTable';
import { ALT_MODE_HIGH, ALT_MODE_LOW, type AltMode } from './los/cache';
import { splitmix32Mix } from './rng';
import { POST_AA_RADIUS_CELLS, POST_AA_TENTHS_PER_TICK, SAM_HIT_PCT, SAM_SALVO_PERIOD_TICKS, STRUCT_CAPACITY } from './rules';
import type { GameState } from './state';
import { samRadiusCells } from './structureEffects';
import { STRUCT_POST, STRUCT_SAM } from './structureRules';
import { CLASS_MOUNTAIN } from './terrain';

/** Side of a spatial-hash bucket in sim cells. */
const BUCKET = 32;

/** The spatial hash of the finished Posts and SAM sites: a counting-sort layout (bucket starts, then structure ids) in typed arrays, rebuilt each tick that has an airborne helicopter. */
export class AaIndex {
  readonly bx: number;
  readonly by: number;
  readonly start: Int32Array;
  readonly items: Int32Array;
  /** Per structure id: radius in cells (Post: POST_AA_RADIUS_CELLS), 0 = not indexed. */
  readonly radius = new Uint8Array(STRUCT_CAPACITY);
  /** Per structure id: the lowest-id helicopter the SAM picked this tick (+ 1), 0 = none. */
  readonly pick = new Int32Array(STRUCT_CAPACITY);
  /** The SAMs that picked a target this tick, in discovery order. */
  readonly fired = new Int32Array(STRUCT_CAPACITY);
  /** Reach in buckets (rounded up) of the largest radius of the last rebuild. */
  reach = 1;
  count = 0;
  private readonly fill: Int32Array;
  private readonly bucketOf = new Int32Array(STRUCT_CAPACITY);

  constructor(width: number, height: number) {
    this.bx = Math.ceil(width / BUCKET);
    this.by = Math.ceil(height / BUCKET);
    this.start = new Int32Array(this.bx * this.by + 1);
    this.fill = new Int32Array(this.bx * this.by);
    this.items = new Int32Array(STRUCT_CAPACITY);
  }

  /** Re-indexes the finished Posts and SAM sites of `state`; `reverse` stores the ids of a bucket in descending order (tests). Returns how many were indexed. */
  rebuild(state: GameState, reverse: boolean): number {
    const st = state.structures;
    const w = state.width;
    const tick = state.tick;
    const nb = this.bx * this.by;
    this.start.fill(0);
    this.radius.fill(0);
    let n = 0;
    let maxR = 0;
    for (let id = 0; id < st.highWater; id++) {
      const owner = st.owner[id] as number;
      if (owner === 0 || tick < (st.readyTick[id] as number)) continue;
      const type = st.type[id] as number;
      let r = 0;
      if (type === STRUCT_POST) r = POST_AA_RADIUS_CELLS;
      else if (type === STRUCT_SAM) r = samRadiusCells(st.level[id] as number, state.terrain[st.cell[id] as number] === CLASS_MOUNTAIN);
      if (r === 0) continue;
      const c = st.cell[id] as number;
      const x = c % w;
      const b = Math.floor((c - x) / w / BUCKET) * this.bx + Math.floor(x / BUCKET);
      this.bucketOf[id] = b;
      this.radius[id] = r > 255 ? 255 : r;
      this.start[b + 1] = (this.start[b + 1] as number) + 1;
      if (r > maxR) maxR = r;
      n++;
    }
    for (let b = 0; b < nb; b++) this.start[b + 1] = (this.start[b + 1] as number) + (this.start[b] as number);
    this.fill.fill(0);
    for (let k = 0; k < st.highWater; k++) {
      const id = reverse ? st.highWater - 1 - k : k;
      if ((this.radius[id] as number) === 0) continue;
      const b = this.bucketOf[id] as number;
      this.items[(this.start[b] as number) + (this.fill[b] as number)] = id;
      this.fill[b] = (this.fill[b] as number) + 1;
    }
    this.reach = Math.max(1, Math.ceil(maxR / BUCKET));
    this.count = n;
    return n;
  }
}

/** The index of a state (built at the first use; derived, like the Los / Nav caches). */
function indexOf(state: GameState): AaIndex {
  const env = state.env;
  if (env.aa === null) env.aa = new AaIndex(state.width, state.height);
  return env.aa;
}

/** The kill roll of one salvo: 0..99 from the splitmix32 mixer on (match seed, tick, SAM id). No state is advanced, so the visiting order cannot matter. */
export function samRoll(seed: number, tick: number, samId: number): number {
  const h = splitmix32Mix(splitmix32Mix(splitmix32Mix(seed | 0) ^ tick) ^ (Math.imul(samId + 1, 0x9e3779b1) | 0));
  return Math.floor((h * 100) / 4294967296);
}

/** Does the Q8 point (x256, y256) lie within `r` cells of cell `c`? (Euclidean on cells, x wraps.) */
function within(w: number, x256: number, y256: number, c: number, r: number): boolean {
  const cx = c % w;
  const cy = (c - cx) / w;
  let dx = Math.abs((x256 >> 8) - cx);
  if (dx > w - dx) dx = w - dx;
  const dy = (y256 >> 8) - cy;
  return dx * dx + dy * dy <= r * r;
}

// Per-tick scratch for the helicopters (indexed by helicopter id; the table has HELI_CAPACITY 64 slots).
const DAMAGE = new Int32Array(256);
const KILLED = new Uint8Array(256);

/**
 * One tick of air defence (called by `heliPhase` after the flight). `reverse` is for the order-independence test only: it visits the structures backwards.
 * Costs nothing without a helicopter in the air.
 */
export function airDefensePhase(state: GameState, reverse = false): void {
  const t = state.helis;
  const hw = t.highWater;
  let any = false;
  for (let id = 0; id < hw; id++) {
    const s = t.state[id] as number;
    if (t.owner[id] !== 0 && s >= HELI_LIFT && s <= HELI_RETURN) {
      any = true;
      break;
    }
  }
  if (!any) return;
  const idx = indexOf(state);
  if (idx.rebuild(state, reverse) === 0) return;
  const st = state.structures;
  const w = state.width;
  const tick = state.tick;
  const los = hasOccluders(state) ? losOf(state) : null;
  if (los !== null) los.sync(navViewOf(state));
  const seed = state.header.seed;
  let nFired = 0;
  for (let id = 0; id < hw; id++) {
    DAMAGE[id] = 0;
    KILLED[id] = 0;
  }
  idx.pick.fill(0);
  const cols = 2 * idx.reach + 1 >= idx.bx ? idx.bx : 2 * idx.reach + 1;
  for (let id = 0; id < hw; id++) {
    const s = t.state[id] as number;
    const heliOwner = t.owner[id] as number;
    // Airborne: lifting, cruising, approaching, hovering, unloading or returning (not queued, parked or already down).
    if (heliOwner === 0 || s < HELI_LIFT || s > HELI_RETURN || s === HELI_PAD) continue;
    const hx = t.x[id] as number;
    const hy = t.y[id] as number;
    const cell = (hy >> 8) * w + (hx >> 8);
    const mode = (t.mode[id] === 1 ? ALT_MODE_HIGH : ALT_MODE_LOW) as AltMode;
    const bx = Math.floor((hx >> 8) / BUCKET);
    const by = Math.floor((hy >> 8) / BUCKET);
    const col0 = cols === idx.bx ? 0 : bx - idx.reach;
    for (let dy = -idx.reach; dy <= idx.reach; dy++) {
      const yy = by + dy;
      if (yy < 0 || yy >= idx.by) continue;
      for (let i = 0; i < cols; i++) {
        const b = yy * idx.bx + ((((col0 + i) % idx.bx) + idx.bx) % idx.bx);
        for (let k = idx.start[b] as number; k < (idx.start[b + 1] as number); k++) {
          const sid = idx.items[k] as number;
          const so = st.owner[sid] as number;
          if (so === heliOwner || !atWar(state, so, heliOwner)) continue; // hostile(): not an ally's, not a truce partner's
          if (!within(w, hx, hy, st.cell[sid] as number, idx.radius[sid] as number)) continue;
          if (st.type[sid] === STRUCT_POST) {
            DAMAGE[id] = (DAMAGE[id] as number) + POST_AA_TENTHS_PER_TICK;
          } else if (los !== null && tick >= (st.salvoTick[sid] as number) && idx.pick[sid] === 0 && los.detected(so, cell, mode) && los.fireControl(sid, cell, mode)) {
            idx.pick[sid] = id + 1; // helicopters are tested in ascending id: the first to pick is the lowest id
            idx.fired[nFired++] = sid;
          }
        }
      }
    }
  }
  // Fire: each SAM that picked a target spends its salvo (the clock restarts) and rolls.
  for (let k = 0; k < nFired; k++) {
    const sid = idx.fired[k] as number;
    // The SAM owner's researched techs (M18d-1): a shorter salvo period (DEFENCE) and more percentage points of hit chance (AIR).
    const samOwner = st.owner[sid] as number;
    const salvoCut = state.match.fx(samOwner, TECH_FX_SAM_SALVO);
    st.salvoTick[sid] = tick + (salvoCut === 0 ? SAM_SALVO_PERIOD_TICKS : SAM_SALVO_PERIOD_TICKS - Math.floor((SAM_SALVO_PERIOD_TICKS * salvoCut) / 100));
    if (samRoll(seed, tick, sid) < SAM_HIT_PCT + state.match.fx(samOwner, TECH_FX_SAM_HIT)) KILLED[(idx.pick[sid] as number) - 1] = 1;
  }
  // Apply: a SAM kill wins over the wear of the Posts in the same tick; the load is lost either way.
  for (let id = 0; id < hw; id++) {
    if (KILLED[id] === 1) downHeli(state, id, HELI_DOWN_SAM);
    else if ((DAMAGE[id] as number) > 0) {
      const hp = (t.hp[id] as number) - (DAMAGE[id] as number);
      if (hp <= 0) {
        t.hp[id] = 0;
        downHeli(state, id, HELI_DOWN_POST);
      } else t.hp[id] = hp;
    }
  }
}

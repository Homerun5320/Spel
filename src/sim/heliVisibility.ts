// Helicopter visibility per viewer (M17-pre, decision (c) of "Audit 3 downstream decisions"). `SimView.helis` of the sim side is the global truth; what a SEAT may
// see of it is decided here, ONCE per change of the world (not per read), from the very rule the air defence uses to find a target (`Los.detected`, src/sim/los/cache.ts):
//  - the viewer's own helicopters are always visible;
//  - so are those of everybody who is not hostile to the viewer (`atWar` false: an ally, a federation member, a truce partner);
//  - a hostile helicopter that is airborne (lifting off .. returning, or a wreck) is visible only when the viewer's own sensors detect its cell at its flight level;
//  - a hostile helicopter that is under production or parked on its pad is never visible (it sits inside a Factory).
// The result is derived data, never hashed or serialised (like the Los / Nav caches). A world without the occluder layer has no sensors: hostile helicopters are hidden.
// The host filters the table it sends to the page with it, and the AI reads `SimView.visibleHelis(seat)`; neither reads another seat's raw rows.
import { atWar } from './diplomacy';
import { hasOccluders, losOf, navViewOf } from './access';
import { HELI_LIFT, type HeliView } from './heliTable';
import { ALT_MODE_HIGH, ALT_MODE_LOW, type AltMode } from './los/cache';
import { HELI_CAPACITY } from './rules';
import { seatToOwner, type GameState } from './state';

/** The helicopters (ids of the table) one viewer may see, lowest id first. */
export interface HeliSight {
  /** How many. */
  readonly count: number;
  /** The id of the k-th visible helicopter, k in 0..count-1. */
  idAt(k: number): number;
  /** Whether helicopter `id` is visible. */
  has(id: number): boolean;
}

/** A reusable list of ids with a bit per id. */
export class ListSight implements HeliSight {
  count = 0;
  readonly ids = new Uint16Array(HELI_CAPACITY);
  readonly bits = new Uint8Array(HELI_CAPACITY);
  idAt(k: number): number {
    return k >= 0 && k < this.count ? (this.ids[k] as number) : -1;
  }
  has(id: number): boolean {
    return id >= 0 && id < HELI_CAPACITY && this.bits[id] === 1;
  }
  clear(): void {
    this.count = 0;
    this.bits.fill(0);
  }
  add(id: number): void {
    this.ids[this.count++] = id;
    this.bits[id] = 1;
  }
}

const NOBODY = new ListSight();

/** Every live row of a table, for a table that is already the viewer's (the page's mirror). */
export function fillSightOfRows(table: HeliView, out: ListSight): void {
  out.clear();
  const n = Math.min(table.highWater, HELI_CAPACITY);
  for (let id = 0; id < n; id++) if (table.owner[id] !== 0) out.add(id);
}

class ViewerRow extends ListSight {
  serial = -1;
}

export class HeliVisibility {
  private readonly rows: ViewerRow[] = [];
  private sig = 0;
  private serial = 0;
  private started = false;

  constructor(private readonly state: GameState) {
    for (let s = 0; s < state.header.players; s++) this.rows.push(new ViewerRow());
  }

  /** What `seat` may see now. A seat that is no player (a tribe, out of range) sees nothing. The answer object is reused: read it, do not keep it across ticks. */
  sight(seat: number): HeliSight {
    const row = this.rows[seat];
    if (row === undefined) return NOBODY;
    const sig = this.signature();
    if (!this.started || sig !== this.sig) {
      this.started = true;
      this.sig = sig;
      this.serial++;
    }
    if (row.serial !== this.serial) {
      row.serial = this.serial;
      this.compute(seat, row);
    }
    return row;
  }

  /** A fingerprint of everything the rule reads: the tick, the relations, the structure table, the helicopter rows. 64 rows, no allocation. */
  private signature(): number {
    const s = this.state;
    const t = s.helis;
    let h = 0x811c9dc5;
    const fold = (x: number): void => {
      h = Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0;
    };
    fold(s.tick);
    fold(s.diplo.version);
    fold(s.structures.version);
    fold(s.structures.highWater);
    fold(s.structures.liveCount);
    fold(t.highWater);
    for (let id = 0; id < t.highWater; id++) {
      const o = t.owner[id] as number;
      fold(o);
      if (o === 0) continue;
      fold(t.state[id] as number);
      fold(t.x[id] as number);
      fold(t.y[id] as number);
      fold(t.mode[id] as number);
    }
    return h;
  }

  private compute(seat: number, out: ListSight): void {
    out.clear();
    const s = this.state;
    const t = s.helis;
    const me = seatToOwner(seat);
    const los = hasOccluders(s) ? losOf(s) : null;
    let synced = false;
    const w = s.width;
    for (let id = 0; id < t.highWater; id++) {
      const o = t.owner[id] as number;
      if (o === 0) continue;
      if (o === me || !atWar(s, me, o)) {
        out.add(id);
        continue;
      }
      const st = t.state[id] as number;
      if (los === null || st < HELI_LIFT) continue;
      if (!synced) {
        los.sync(navViewOf(s));
        synced = true;
      }
      const cell = ((t.y[id] as number) >> 8) * w + ((t.x[id] as number) >> 8);
      const mode = (t.mode[id] === 1 ? ALT_MODE_HIGH : ALT_MODE_LOW) as AltMode;
      if (los.detected(me, cell, mode)) out.add(id);
    }
  }
}

/** The visibility of a state (built at the first use, kept in `state.env` for the life of the state; derived, never hashed). */
export function heliVisibilityOf(state: GameState): HeliVisibility {
  const env = state.env;
  if (env.heliVis === null) env.heliVis = new HeliVisibility(state);
  return env.heliVis;
}

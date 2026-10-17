// The render-only outbox: events for visuals and the host (what was painted, which intent was refused). It is NOT part of
// the game state: not hashed, not serialised, never read by step(). Hosts drain it after every step.

export const OUTBOX_CAPACITY = 8192;

/** An intent was applied as a paint: a = cell, b = new ownerId. */
export const OUTBOX_PAINT = 1;
/** An intent was refused: a = reason (REJECT_*), b = 0. */
export const OUTBOX_REJECT = 2;
/** A seat was eliminated (it spawned and owns no cell any more): a = seat, b = 0. */
export const OUTBOX_ELIMINATED = 3;
/** A seat's capital cell is held by another owner (a transition, once): a = seat, b = 0. */
export const OUTBOX_CAPITAL_LOST = 4;
/** The match ended: a = ownerId of the winner (0 = none), b = WIN_REASON_*. */
export const OUTBOX_MATCH_END = 5;

// M12a-1: helicopter events. HELI_QUEUED, HELI_PRODUCED and HELI_SCRAPPED are pushed from part 1; the rest are declared for parts 2 and 3.
/** A helicopter was ordered: a = helicopter id, b = Factory structure id. */
export const OUTBOX_HELI_QUEUED = 6;
/** A helicopter finished production and stands on its pad: a = helicopter id, b = Factory structure id. */
export const OUTBOX_HELI_PRODUCED = 7;
/** A parked or queued helicopter was scrapped because its Factory was lost: a = helicopter id, b = its state (HELI_*). */
export const OUTBOX_HELI_SCRAPPED = 8;
/** (part 2) A helicopter took off: a = helicopter id, b = landing-zone cell. */
export const OUTBOX_HELI_LAUNCHED = 9;
/** A helicopter set down at its landing zone (M12a-3, `performLanding` in src/sim/heliLanding.ts): a = helicopter id, b = cells taken (1 to 9), -1 = the zone could not be taken and the load is lost, 0 = nothing to land on (own or blocked land: the load flies home). */
export const OUTBOX_HELI_LANDED = 10;
/** A beachhead was formed at a landing: a = beachhead slot, b = seed cell (the landing zone). */
export const OUTBOX_BEACHHEAD_FORMED = 11;
/** A cut-off beachhead returned to neutral, 450 ticks after its landing: a = beachhead slot, b = seed cell. */
export const OUTBOX_BEACHHEAD_REVERTED = 12;
/** (part 2) A helicopter went down: a = helicopter id, b = cause (1 = out of fuel; the air-defence causes come with M12b). */
export const OUTBOX_HELI_DOWNED = 13;
/** (part 2) A helicopter turned for home: a = helicopter id, b = 1 when recalled, 0 when its mission ended. */
export const OUTBOX_HELI_RTB = 14;
/** (part 2) A helicopter set down on a Factory pad again: a = helicopter id, b = Factory structure id. */
export const OUTBOX_HELI_HOME = 15;

// M13c-1: ship events (a = ship id).
/** A ship left its Port: a = ship id, b = landing cell. */
export const OUTBOX_SHIP_LAUNCHED = 16;
/** A ship set its troops down (`landTroops` in src/sim/heliLanding.ts): a = ship id, b = cells taken (1 to 9), -1 = the zone could not be taken and the load is lost, 0 = nothing to land on (own or blocked land: the load sails home). */
export const OUTBOX_SHIP_LANDED = 17;
/** A ship docked in its home Port again (it cools down there): a = ship id, b = Port structure id. */
export const OUTBOX_SHIP_RETURNED = 18;
/** A ship was scrapped: a = ship id, b = cause (1 = its owner was eliminated, 2 = its Port was lost and it could not dock; the load is lost). */
export const OUTBOX_SHIP_SCRAPPED = 19;
/** A ship turned for home: a = ship id, b = 1 when a truce or an alliance now binds its owner to the owner of the landing cell, 0 when its mission is over. */
export const OUTBOX_SHIP_RTB = 20;

// M14a: missile events. The interceptor events (25, 26) are declared for M14b and not pushed yet.
/** A missile left its Silo: a = missile id, b = target cell. */
export const OUTBOX_MISSILE_LAUNCHED = 21;
/** A warning to the owner of the target cell (pushed only when somebody else's land is aimed at): a = missile id, b = ticks until the blast (the ETA). */
export const OUTBOX_MISSILE_WARNING = 22;
/** A missile blew up: a = class (0 Tactical, 1 Fission, 2 Fusion), b = the centre cell. The row is gone by then; the radii are the class's (rules.ts). */
export const OUTBOX_MISSILE_DETONATED = 23;
/** A building was destroyed by a blast: a = its cell, b = its structure type. */
export const OUTBOX_MISSILE_BUILDING_DESTROYED = 24;
/** (M14b) An interceptor left a SAM site: a = missile id, b = the tick it meets the warhead. */
export const OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED = 25;
/** (M14b) A warhead was shot down: a = missile id, b = the cell it was over. */
export const OUTBOX_MISSILE_INTERCEPTED = 26;

export interface OutboxEvent {
  readonly kind: number;
  /** The tick of the step that produced the event (the tick before it was incremented). */
  readonly tick: number;
  readonly a: number;
  readonly b: number;
}

export class Outbox {
  /** The events as packed 32-bit integers (kind, tick, a, b per event; every value is a small integer): a push allocates nothing, the objects are made when the host drains. */
  private data = new Int32Array(4 * 256);
  private count = 0;
  /** Events refused since the last drain because the outbox was full. */
  dropped = 0;

  get length(): number {
    return this.count;
  }

  push(kind: number, tick: number, a: number, b: number): void {
    const n = this.count;
    if (n >= OUTBOX_CAPACITY) {
      this.dropped++;
      return;
    }
    let data = this.data;
    const at = n * 4;
    if (at === data.length) {
      const bigger = new Int32Array(at * 2);
      bigger.set(data);
      data = bigger;
      this.data = bigger;
    }
    data[at] = kind;
    data[at + 1] = tick;
    data[at + 2] = a;
    data[at + 3] = b;
    this.count = n + 1;
  }

  /** Hands over everything collected so far and starts empty; also resets `dropped`. */
  drain(): OutboxEvent[] {
    const out: OutboxEvent[] = [];
    const data = this.data;
    for (let i = 0; i < this.count; i++) {
      const at = i * 4;
      out.push({ kind: data[at] as number, tick: data[at + 1] as number, a: data[at + 2] as number, b: data[at + 3] as number });
    }
    this.count = 0;
    this.dropped = 0;
    return out;
  }

  clear(): void {
    this.count = 0;
    this.dropped = 0;
  }
}

// ViewMirror: the page's read-only copy of the match, kept current by the host's events. It implements SimView
// (src/sim/view.ts): typed-array COPIES that no sim code can reach. It is built from one `requestView()` answer (the full
// owner array, the terrain layer, the statistics) and then follows the stream of frame events:
//   - a `diff` event brings the changed cells (applied in place, no allocation) or, after an outbox overflow, the whole owner
//     array (adopted with one `set`), and the light view of the frame (statistics, tick, the last refusal);
//   - a `speed` event updates the speed.
// Consumers that want to react (the ownership texture, the HUD) register with `onFrame`; they get the diff of the frame and
// must not keep it. Diffs that arrive before the first answer are queued and the ones older than it dropped.
import { ownerSlots } from '../sim/state';
import { PHASE_PLAY, phaseAt, phaseTicksLeft, type MatchPhase } from '../sim/flow';
import type { StructureView } from '../sim/structureRules';
import { countContacts, statsViewOf, type ReadonlyNumbers, type SeatStatsView, type SimView } from '../sim/view';
import type { HostEvent, SimHost, Speed, StateDiff, Unsubscribe, ViewSnapshot } from './protocol';

const NO_NUMBERS: ArrayLike<number> = new Uint8Array(0);
const EMPTY_STRUCTURES: StructureView = Object.freeze({
  capacity: 0,
  highWater: 0,
  liveCount: 0,
  type: NO_NUMBERS,
  owner: NO_NUMBERS,
  cell: NO_NUMBERS,
  level: NO_NUMBERS,
  buildTick: NO_NUMBERS,
  readyTick: NO_NUMBERS,
  upgradeReadyTick: NO_NUMBERS,
  idAt: () => -1,
  ownedCount: () => 0,
  deleteReadyTick: () => 0,
});

export type FrameListener = (mirror: ViewMirror, diff: StateDiff) => void;

export class ViewMirror implements SimView {
  readonly width: number;
  readonly height: number;
  readonly seats: number;
  readonly players: number;
  readonly flow: boolean;
  readonly debugIntents: boolean;
  readonly stats: SeatStatsView;
  tick: number;
  rejects: number;
  ownerVersion = 1;
  /** REJECT_* code of the most recent refusal (0 = none) and the tick of the step that refused it (-1 = none). */
  lastRejectReason: number;
  lastRejectTick: number;
  /** The speed the host runs at (follows its `speed` events). */
  speed: Speed = 1;
  /** Frames (diff events) applied since the mirror was built. */
  frames = 0;
  private readonly ownerArray: Uint16Array;
  private readonly terrain: Uint8Array;
  private readonly packed: Uint32Array;
  private listeners: FrameListener[] = [];
  /** Contact lengths per pair of owners (countContacts), rebuilt on demand when the owners changed since. */
  private contacts: Int32Array | null = null;
  private contactsVersion = -1;
  /** Attacks running, one flag per (attacker, target) pair of owner ids (index attacker * slots + target); rebuilt from every frame's snapshot. */
  private readonly attackFlags: Uint8Array;
  private readonly slots: number;

  private constructor(v: ViewSnapshot) {
    if (v.owner === null || v.terrain === null) throw new Error('a mirror needs the full view (requestView)');
    this.width = v.width;
    this.height = v.height;
    this.seats = v.seats;
    this.players = v.players;
    this.flow = v.flow;
    this.debugIntents = v.debugIntents;
    this.tick = v.tick;
    this.rejects = v.rejects;
    this.lastRejectReason = v.lastRejectReason;
    this.lastRejectTick = v.lastRejectTick;
    this.ownerArray = v.owner.slice();
    this.terrain = v.terrain.slice();
    this.packed = v.stats.slice();
    this.stats = statsViewOf(v.seats, this.packed);
    this.slots = ownerSlots(v.seats);
    this.attackFlags = new Uint8Array(this.slots * this.slots);
    this.setAttacks(v.attacks);
  }

  private setAttacks(pairs: Uint16Array): void {
    const flags = this.attackFlags;
    flags.fill(0);
    for (let i = 0; i + 1 < pairs.length; i += 2) flags[(pairs[i] as number) * this.slots + (pairs[i + 1] as number)] = 1;
  }

  /** Empty until the M10 snapshot extension carries the structure table to the page. */
  get structures(): StructureView {
    return EMPTY_STRUCTURES;
  }

  falloutUntilAt(): number {
    return 0;
  }

  attackRunning(attacker: number, target: number): boolean {
    if (attacker < 0 || target < 0 || attacker >= this.slots || target >= this.slots) return false;
    return this.attackFlags[attacker * this.slots + target] === 1;
  }

  /** Subscribes to `host`, asks for the full view and resolves with a mirror that is current. `stop` ends the subscription. */
  static async attach(host: SimHost): Promise<{ mirror: ViewMirror; stop: Unsubscribe }> {
    let mirror: ViewMirror | null = null;
    const queued: StateDiff[] = [];
    let speed: Speed | null = null;
    const stop = host.subscribe((e: HostEvent) => {
      if (e.type === 'speed') {
        if (mirror === null) speed = e.speed;
        else mirror.speed = e.speed;
      } else if (e.type === 'diff') {
        if (mirror === null) queued.push(e.diff);
        else mirror.apply(e.diff);
      }
    });
    const view = await host.requestView();
    const m = new ViewMirror(view);
    if (speed !== null) m.speed = speed;
    for (const d of queued) if (d.fromTick >= m.tick) m.apply(d);
    mirror = m;
    return { mirror: m, stop };
  }

  /** The packed statistics array that `stats` slices (STAT_COUNT blocks of `seats` values); for interpolators that copy it. */
  get packedStats(): ArrayLike<number> {
    return this.packed;
  }

  get owner(): ReadonlyNumbers {
    return this.ownerArray;
  }

  get terrainClass(): ReadonlyNumbers {
    return this.terrain;
  }

  get phase(): MatchPhase {
    return this.flow ? phaseAt(this.tick) : PHASE_PLAY;
  }

  get phaseTicksLeft(): number {
    return this.flow ? phaseTicksLeft(this.tick) : 0;
  }

  contactLength(a: number, b: number): number {
    const slots = ownerSlots(this.seats);
    if (a === b || a < 0 || b < 0 || a >= slots || b >= slots) return 0;
    if (this.contacts === null || this.contactsVersion !== this.ownerVersion) {
      this.contacts ??= new Int32Array(slots * slots);
      countContacts(this.width, this.height, this.ownerArray, this.terrain, slots, this.contacts);
      this.contactsVersion = this.ownerVersion;
    }
    return this.contacts[a < b ? a * slots + b : b * slots + a] as number;
  }

  /** Registers a function called after each applied frame; returns its unsubscribe. */
  onFrame(listener: FrameListener): Unsubscribe {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Applies one frame. A frame that does not start at the mirror's tick is a gap: the owner array is then NOT trusted (should not happen on a lossless channel). */
  apply(d: StateDiff): void {
    if (d.fullOwner !== null) {
      this.ownerArray.set(d.fullOwner);
      this.ownerVersion++;
    } else if (d.cells.length > 0) {
      const owner = this.ownerArray;
      for (let i = 0; i < d.cells.length; i++) owner[d.cells[i] as number] = d.owners[i] as number;
      this.ownerVersion++;
    }
    this.tick = d.toTick;
    this.rejects = d.rejects;
    this.lastRejectReason = d.view.lastRejectReason;
    this.lastRejectTick = d.view.lastRejectTick;
    this.packed.set(d.view.stats);
    this.setAttacks(d.view.attacks);
    this.frames++;
    for (const l of this.listeners) l(this, d);
  }

  /** A deep copy of the owner array (tests compare it with the sim's). */
  copyOwner(): Uint16Array {
    return this.ownerArray.slice();
  }
}

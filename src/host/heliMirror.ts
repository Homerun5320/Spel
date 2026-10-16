// The page's copy of the helicopter table (M12a-1): a `HeliView` over the arrays of the last `HeliSnapshot` the host sent, replaced as a whole when a
// frame brings a new table (the table has 64 slots; nothing is patched).
import type { HeliView } from '../sim/heliTable';
import type { HeliSnapshot } from './protocol';

const EMPTY: HeliSnapshot = Object.freeze({
  capacity: 0,
  highWater: 0,
  liveCount: 0,
  owner: new Uint16Array(0),
  state: new Uint8Array(0),
  factory: new Uint16Array(0),
  readyTick: new Uint32Array(0),
  x: new Int32Array(0),
  y: new Int32Array(0),
  alt: new Int32Array(0),
  hp: new Uint16Array(0),
  load: new Uint16Array(0),
  fuel: new Uint32Array(0),
  counts: new Uint16Array(0),
});

export class MirrorHelis implements HeliView {
  private snap: HeliSnapshot = EMPTY;
  /** Increases whenever a new table was adopted. */
  version = 0;

  adopt(s: HeliSnapshot): void {
    this.snap = s;
    this.version++;
  }

  get capacity(): number {
    return this.snap.capacity;
  }
  get highWater(): number {
    return this.snap.highWater;
  }
  get liveCount(): number {
    return this.snap.liveCount;
  }
  get owner(): ArrayLike<number> {
    return this.snap.owner;
  }
  get state(): ArrayLike<number> {
    return this.snap.state;
  }
  get factory(): ArrayLike<number> {
    return this.snap.factory;
  }
  get readyTick(): ArrayLike<number> {
    return this.snap.readyTick;
  }
  get x(): ArrayLike<number> {
    return this.snap.x;
  }
  get y(): ArrayLike<number> {
    return this.snap.y;
  }
  get alt(): ArrayLike<number> {
    return this.snap.alt;
  }
  get hp(): ArrayLike<number> {
    return this.snap.hp;
  }
  get load(): ArrayLike<number> {
    return this.snap.load;
  }
  get fuel(): ArrayLike<number> {
    return this.snap.fuel;
  }
  countOf(ownerId: number): number {
    return ownerId >= 0 && ownerId < this.snap.counts.length ? (this.snap.counts[ownerId] as number) : 0;
  }
}

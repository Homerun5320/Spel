// The page's copy of the missile table (M14a): a `MissileView` over the rows of the last `MissileSnapshot` the host sent, replaced as a whole when a frame brings a new table (at most 64
// rows; nothing is patched). The rows sit in slot order and the view is indexed by slot, so the arrays are spread out again on `adopt`. The fallout layer is NOT mirrored (BACKLOG).
import { MISSILE_CAPACITY } from '../sim/rules';
import { MISSILE_CLASS_COUNT, type MissileView } from '../sim/missileTable';
import type { MissileSnapshot } from './protocol';

export class MirrorMissiles implements MissileView {
  readonly capacity = MISSILE_CAPACITY;
  liveCount = 0;
  readonly owner = new Uint16Array(MISSILE_CAPACITY);
  readonly cls = new Uint8Array(MISSILE_CAPACITY);
  readonly silo = new Uint16Array(MISSILE_CAPACITY);
  readonly launchTick = new Uint32Array(MISSILE_CAPACITY);
  readonly impactTick = new Uint32Array(MISSILE_CAPACITY);
  readonly startCell = new Int32Array(MISSILE_CAPACITY);
  readonly targetCell = new Int32Array(MISSILE_CAPACITY);
  private launches: ArrayLike<number> = new Uint16Array(0);
  /** Increases whenever a new table was adopted. */
  version = 0;

  adopt(s: MissileSnapshot): void {
    this.owner.fill(0);
    this.cls.fill(0);
    this.silo.fill(0);
    this.launchTick.fill(0);
    this.impactTick.fill(0);
    this.startCell.fill(0);
    this.targetCell.fill(0);
    for (let k = 0; k < s.count; k++) {
      const i = s.slot[k] as number;
      this.owner[i] = s.owner[k] as number;
      this.cls[i] = s.cls[k] as number;
      this.silo[i] = s.silo[k] as number;
      this.launchTick[i] = s.launchTick[k] as number;
      this.impactTick[i] = s.impactTick[k] as number;
      this.startCell[i] = s.startCell[k] as number;
      this.targetCell[i] = s.targetCell[k] as number;
    }
    this.launches = s.launches;
    this.liveCount = s.count;
    this.version++;
  }

  launchesOf(ownerId: number, cls: number): number {
    const k = ownerId * MISSILE_CLASS_COUNT + cls;
    return k >= 0 && k < this.launches.length ? (this.launches[k] as number) : 0;
  }
}

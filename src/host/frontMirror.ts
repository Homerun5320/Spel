// The page's copy of the attack fronts (M20a-2): an `AttackView` over the rows of the last `AttackFrontSnapshot` the host sent, replaced as a whole when a frame brings a new one
// (at most ATTACK_VIEW_CAP rows; nothing is patched, no allocation on adopt).
import { ATTACK_VIEW_CAP, createAttackFrontData, type AttackView } from '../sim/view';
import type { AttackFrontSnapshot } from './protocol';

export class MirrorFronts implements AttackView {
  private readonly data = createAttackFrontData();
  /** Increases whenever a new snapshot was adopted. */
  version = 0;

  get count(): number {
    return this.data.count;
  }
  get id(): ArrayLike<number> {
    return this.data.id;
  }
  get attacker(): ArrayLike<number> {
    return this.data.attacker;
  }
  get target(): ArrayLike<number> {
    return this.data.target;
  }
  get cell(): ArrayLike<number> {
    return this.data.cell;
  }
  get dirX(): ArrayLike<number> {
    return this.data.dirX;
  }
  get dirY(): ArrayLike<number> {
    return this.data.dirY;
  }

  adopt(s: AttackFrontSnapshot): void {
    const n = s.count < ATTACK_VIEW_CAP ? s.count : ATTACK_VIEW_CAP;
    const d = this.data;
    d.id.set(s.id.subarray(0, n));
    d.attacker.set(s.attacker.subarray(0, n));
    d.target.set(s.target.subarray(0, n));
    d.cell.set(s.cell.subarray(0, n));
    d.dirX.set(s.dirX.subarray(0, n));
    d.dirY.set(s.dirY.subarray(0, n));
    d.count = n;
    this.version++;
  }
}

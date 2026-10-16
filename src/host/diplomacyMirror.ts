// The page's copy of the diplomacy table (M18c-1): a `DiplomacyView` over a table that `adopt` fills from the last `DiplomacySnapshot` the host sent (the table is small;
// nothing is patched). The view reads the mirror's own clock, so a truce that has run out reads as war even before the next snapshot arrives.
import { DiplomacyReader, DiplomacyTable, type DiplomacyView } from '../sim/diplomacyTable';
import type { DiplomacySnapshot } from './protocol';

export class MirrorDiplomacy {
  private readonly table: DiplomacyTable;
  /** The read-only view (SimView.diplomacy). */
  readonly view: DiplomacyView;
  /** Increases whenever a new table was adopted. */
  version = 0;

  constructor(
    slots: number,
    players: number,
    now: () => number,
  ) {
    this.table = new DiplomacyTable(slots);
    this.view = new DiplomacyReader(this.table, players, now);
  }

  adopt(s: DiplomacySnapshot): void {
    const t = this.table;
    t.relation.set(s.relation);
    t.until.set(s.until);
    t.embargoBy.set(s.embargoBy);
    t.cooldownUntil.set(s.cooldownUntil);
    t.propCount = s.propFrom.length;
    t.propFrom.fill(0);
    t.propTo.fill(0);
    t.propKind.fill(0);
    t.propExpire.fill(0);
    t.propFrom.set(s.propFrom);
    t.propTo.set(s.propTo);
    t.propKind.set(s.propKind);
    t.propExpire.set(s.propExpire);
    this.version++;
  }
}

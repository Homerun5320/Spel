// The diplomacy table on its way to the page (M18c-1): `snapshotDiplomacy` copies the sim's table into plain typed arrays (the host calls it, never the page).
// The host sends it in a frame's diff only when `DiplomacyTable.version` moved. Nothing here is game state.
import type { DiplomacyTable } from '../sim/diplomacyTable';
import type { DiplomacySnapshot } from './protocol';

export function snapshotDiplomacy(d: DiplomacyTable): DiplomacySnapshot {
  const n = d.propCount;
  return {
    slots: d.slots,
    relation: d.relation.slice(),
    until: d.until.slice(),
    embargoBy: d.embargoBy.slice(),
    cooldownUntil: d.cooldownUntil.slice(),
    propFrom: d.propFrom.slice(0, n),
    propTo: d.propTo.slice(0, n),
    propKind: d.propKind.slice(0, n),
    propExpire: d.propExpire.slice(0, n),
  };
}

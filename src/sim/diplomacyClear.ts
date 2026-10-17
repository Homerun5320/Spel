// The parts of the diplomacy rules that do not depend on the conquest code (so that win.ts can call them without an import cycle): the trade flags and the
// clean-up of an eliminated owner. See src/sim/diplomacy.ts for the rest.
import { RELATION_WAR } from './diplomacyTable';
import type { GameState } from './state';

/** Marks the trade income cache stale (an alliance or an embargo changed what a Port earns). */
export function dirtyTrade(state: GameState): void {
  state.structures.effDirty = true;
}

/** The trade flag of the structure table follows the owners: on when either owner has an embargo on the other. */
export function syncEmbargo(state: GameState, a: number, b: number): void {
  const d = state.diplo;
  state.structures.setEmbargo(a, b, d.embargoFrom(a, b) || d.embargoFrom(b, a));
  d.version++;
}

/** An eliminated owner leaves diplomacy: its treaties end (no cooldown, no betrayal), its proposals (both ways) go and its embargoes are lifted. */
export function clearDiplomacyOf(state: GameState, owner: number): void {
  const d = state.diplo;
  const s = d.slots;
  for (let o = 1; o < s; o++) {
    if (o === owner) continue;
    if (d.relationOf(owner, o) !== RELATION_WAR) d.setRelation(owner, o, RELATION_WAR, 0);
    d.removeProposalsBetween(owner, o);
    if (d.embargoBy[owner * s + o] === 1 || d.embargoBy[o * s + owner] === 1) {
      d.embargoBy[owner * s + o] = 0;
      d.embargoBy[o * s + owner] = 0;
      syncEmbargo(state, owner, o);
    }
  }
  dirtyTrade(state);
}

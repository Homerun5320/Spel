// Fix-4A2 (audit 3, finding 0.7): surviving mutants of the diplomacy side effects that nobody else touches. The income cache must go stale when an alliance ends or
// an owner is eliminated (an allied Port earns trade income), and the page copy of the table must be resent when an embargo changes (diplo.version).
import { describe, expect, it } from 'vitest';
import { applyBreakTreaty, applyImposeEmbargo, applyLiftEmbargo } from '../../src/sim/diplomacy';
import { clearDiplomacyOf } from '../../src/sim/diplomacyClear';
import { RELATION_ALLIANCE, RELATION_WAR } from '../../src/sim/diplomacyTable';
import { REJECT_NONE } from '../../src/sim/intents';
import { type GameState } from '../../src/sim/state';
import { landState } from './helpers/worlds';

function world(): GameState {
  const s = landState(20, 4, { seats: 3, players: 3 });
  s.tick = 500;
  s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
  return s;
}

describe('the side effects of the diplomacy rules that other seats read', () => {
  it('BreakTreaty makes the trade income stale, at once', () => {
    const s = world();
    s.structures.effDirty = false;
    expect(applyBreakTreaty(s, 0, 1)).toBe(REJECT_NONE);
    expect(s.diplo.relationOf(1, 2)).toBe(RELATION_WAR);
    expect(s.structures.effDirty).toBe(true);
  });

  it('the elimination clean-up (an ally is gone) makes the trade income stale and ends the treaty', () => {
    const s = world();
    s.structures.effDirty = false;
    clearDiplomacyOf(s, 2);
    expect(s.diplo.relationOf(1, 2)).toBe(RELATION_WAR);
    expect(s.structures.effDirty).toBe(true);
  });

  it('ImposeEmbargo and LiftEmbargo each bump diplo.version (the host resends the table only when it moved) and set and clear both flags', () => {
    const s = world();
    const v0 = s.diplo.version;
    expect(applyImposeEmbargo(s, 0, 2)).toBe(REJECT_NONE);
    const v1 = s.diplo.version;
    expect(v1).toBeGreaterThan(v0);
    expect(s.structures.embargoed(1, 3)).toBe(true);
    expect(s.structures.embargoed(3, 1)).toBe(true);
    expect(applyLiftEmbargo(s, 0, 2)).toBe(REJECT_NONE);
    expect(s.diplo.version).toBeGreaterThan(v1);
    expect(s.structures.embargoed(1, 3)).toBe(false);
  });

  it('lifting one side of a two-sided embargo keeps the trade flag (the other side still holds its own)', () => {
    const s = world();
    expect(applyImposeEmbargo(s, 0, 2)).toBe(REJECT_NONE);
    expect(applyImposeEmbargo(s, 2, 0)).toBe(REJECT_NONE);
    expect(applyLiftEmbargo(s, 0, 2)).toBe(REJECT_NONE);
    expect(s.structures.embargoed(1, 3)).toBe(true);
    expect(applyLiftEmbargo(s, 2, 0)).toBe(REJECT_NONE);
    expect(s.structures.embargoed(1, 3)).toBe(false);
  });
});

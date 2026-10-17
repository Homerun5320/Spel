// "Dela upp stormakter" (M18b-2): createMatch with federations on. Real data: the committed world and federations pack.
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareWorld, type PreparedWorld } from '../../src/app/matchWorld';
import { createMatch, matchSetupConfig, type BuiltMatch, type MatchSetupConfig } from '../../src/app/matchSetup';
import { applyBreakTreaty, validateBreakTreaty } from '../../src/sim/diplomacy';
import { RELATION_ALLIANCE, RELATION_WAR } from '../../src/sim/diplomacyTable';
import { REJECT_DIPLO_FEDERATION, REJECT_DIPLO_TREATY_BOUND } from '../../src/sim/intents';
import { applyAttack } from '../../src/sim/conquest';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { SETUP_AI_NATIONS_MAX, START_DISC_CELLS } from '../../src/sim/rules';
import { StateView } from '../../src/sim/view';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

const id = (a3: string): number => world.countries.find((c) => c.a3 === a3)?.id as number;

function build(a3: string, options: Partial<MatchSetupConfig> = {}): BuiltMatch {
  const r = createMatch(world, matchSetupConfig({ kind: 'real', countryId: id(a3) }, { seed: 5, tribes: false, aiNations: 4, win: null, ...options }));
  if (!r.ok) throw new Error(`refused: ${r.error.code} ${r.error.key}`);
  return r.match;
}

describe('federations in createMatch', () => {
  it('USA and Russia: a seat per sub-nation, each start whole and inside its own sub-nation', () => {
    const f = world.data.federations;
    expect(f).toBeTruthy();
    for (const [a3, members] of [['USA', 9], ['RUS', 12]] as const) {
      const m = build(a3, { federations: true });
      const mine = m.seats.filter((s) => s.subNation !== undefined && s.countryId === id(a3));
      expect(mine.length).toBe(members);
      expect(m.federationGroups.length).toBeGreaterThanOrEqual(1);
      expect(m.federationGroups[0]?.length).toBe(members);
      expect(m.players).toBeLessThanOrEqual(1 + SETUP_AI_NATIONS_MAX);
      for (const s of mine) {
        const owned: number[] = [];
        for (let c = 0; c < m.state.owner.length; c++) if (m.state.owner[c] === s.seat + 1) owned.push(c);
        expect(owned.length).toBe(START_DISC_CELLS);
        for (const c of owned) expect(f?.federationRaster[c]).toBe(s.subNation);
      }
      expect(m.seats[m.humanSeat]?.kind).toBe('human');
      expect(m.seats[m.humanSeat]?.subNation).toBeGreaterThan(0);
    }
  });

  it('names are the province alone (Fix-5C: the country is in the group row); the chosen sub-nation is the one the player plays', () => {
    const f = world.data.federations;
    const members = f?.membersByCountry[id('USA') - 1] ?? [];
    const pick = members[3] as number;
    const m = build('USA', { federations: true, subNation: pick });
    expect(m.seats[m.humanSeat]?.subNation).toBe(pick);
    const name = m.seats[m.humanSeat]?.identity;
    const sub = f?.subNations[pick - 1];
    expect(name?.kind === 'country' && name.nameEn === sub?.name.replace(/ Region$/, '') && !name.nameEn.includes('(')).toBe(true);
  });

  it('members are allied at tick 0, the alliance cannot be broken and nobody attacks a member', () => {
    const m = build('USA', { federations: true, spawnPhase: false });
    const g = m.federationGroups[0] as readonly number[];
    const s = m.state;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) expect(s.diplo.relationOf((g[i] as number) + 1, (g[j] as number) + 1)).toBe(RELATION_ALLIANCE);
    const view = new StateView(s);
    expect(view.diplomacy.federationBound(g[0] as number, g[1] as number)).toBe(true);
    expect(validateBreakTreaty(view, g[0] as number, g[1] as number)).toBe(REJECT_DIPLO_FEDERATION);
    const before = hashState(s);
    expect(applyBreakTreaty(s, g[0] as number, g[1] as number)).toBe(REJECT_DIPLO_FEDERATION);
    expect(hashState(s)).toBe(before);
    expect(s.diplo.relationOf((g[0] as number) + 1, (g[1] as number) + 1)).toBe(RELATION_ALLIANCE);
    expect(s.diplo.relationOf((g[0] as number) + 1, (g[1] as number) + 1)).not.toBe(RELATION_WAR);
    // An attack on a member is refused with the treaty ban (the target is an ownerId).
    expect(applyAttack(s, g[0] as number, (g[1] as number) + 1, 50)).toBe(REJECT_DIPLO_TREATY_BOUND);
  });

  it('the bound alliance survives a save and a load', () => {
    const m = build('USA', { federations: true });
    const back = deserialize(serialize(m.state));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(hashState(back.state)).toBe(hashState(m.state));
    const g = m.federationGroups[0] as readonly number[];
    expect(new StateView(back.state).diplomacy.federationBound(g[0] as number, g[1] as number)).toBe(true);
  });

  it('off (absent, or on for a country that is not a candidate) changes nothing', () => {
    const a = build('SWE', { aiNations: 0 });
    const b = build('SWE', { aiNations: 0, federations: true });
    expect(hashState(b.state)).toBe(hashState(a.state));
    const c = build('USA');
    const d = build('USA', { federations: false });
    expect(hashState(d.state)).toBe(hashState(c.state));
    expect(c.federationGroups.length).toBe(0);
  });
});

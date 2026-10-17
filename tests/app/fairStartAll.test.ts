// The slower twin of the 20-country check in matchSetup.test.ts: EVERY selectable country of meta.json, and every country in every
// region where it is selectable, starts with the same troops, the same gold and exactly K contiguous cells on its capital.
import { beforeAll, describe, expect, it } from 'vitest';
import { listCountries, type CountryChoice } from '../../src/app/eligibility';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { createMatch, matchSetupConfig } from '../../src/app/matchSetup';
import { START_DISC_CELLS, START_GOLD_MILLI, START_TROOPS_QT } from '../../src/sim/rules';
import { loadPreparedWorld } from '../../tools/sim/realWorld';
import { isConnected } from '../helpers/matchChecks';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

describe('every selectable country starts alike (slow)', () => {
  it('the whole world: troops, gold and a whole, contiguous start disc on the capital, for each of the selectable countries', () => {
    const choices = listCountries(world, 'world').filter((x) => x.eligibility.ok);
    expect(choices.length).toBeGreaterThan(120);
    for (const { country } of choices) {
      const r = createMatch(world, matchSetupConfig({ kind: 'real', countryId: country.id }, { seed: 17, aiNations: 2, tribes: false }));
      expect(r.ok, country.a3).toBe(true);
      if (!r.ok) continue;
      const s = r.match.state;
      const owner = r.match.humanSeat + 1;
      expect(s.agg.area[owner], country.a3).toBe(START_DISC_CELLS);
      expect(s.troops[owner], country.a3).toBe(START_TROOPS_QT);
      expect(s.gold[owner], country.a3).toBe(START_GOLD_MILLI);
      expect(s.owner[country.capitalCell], country.a3).toBe(owner);
      expect(isConnected(s, owner), country.a3).toBe(true);
      for (const seat of r.match.seats) expect(s.agg.area[seat.seat + 1], `${country.a3} seat ${seat.seat}`).toBe(START_DISC_CELLS);
    }
  }, 180_000);

  it('each region: every country selectable there starts with a whole disc inside the region', () => {
    for (const region of ['europe', 'eastAsia', 'americas', 'africaMiddleEast'] as const) {
      const choices = listCountries(world, region).filter((x): x is CountryChoice => x.eligibility.ok);
      const mask = world.analyse(region).mask as Uint8Array;
      for (const { country } of choices) {
        const r = createMatch(world, matchSetupConfig({ kind: 'real', countryId: country.id }, { seed: 3, region, aiNations: 1, tribes: false }));
        expect(r.ok, `${region} ${country.a3}`).toBe(true);
        if (!r.ok) continue;
        const s = r.match.state;
        expect(s.agg.area[1], `${region} ${country.a3}`).toBe(START_DISC_CELLS);
        expect(s.troops[1]).toBe(START_TROOPS_QT);
        for (let i = 0; i < s.owner.length; i++) if (s.owner[i] !== 0) expect(mask[i], `${region} ${country.a3} cell ${i}`).toBe(1);
      }
    }
  }, 180_000);
});

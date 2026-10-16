// M12a-2: the 100-flight run of the property test on the real world (see heliFlightReal.test.ts for the 40-flight run in the quick path). Allowed to be slower,
// but it must finish well under 30 s when run alone.
import { beforeAll, describe, expect, it } from 'vitest';
import { checkFlights, makeFlightWorld, runFlights, type FlightResult } from '../helpers/heliFlights';

let results: FlightResult[] = [];

beforeAll(async () => {
  const state = await makeFlightWorld();
  results = runFlights(state, 17, 20260202);
}, 120_000);

describe('helicopter flights on the real world (100)', () => {
  it('flew at least 100 flights, over all three regions in both modes', () => {
    expect(results.length).toBeGreaterThanOrEqual(100);
    for (const region of ['alps', 'himalaya', 'andes']) for (const mode of [0, 1]) expect(results.filter((r) => r.region === region && r.mode === mode).length, `${region} mode ${mode}`).toBeGreaterThanOrEqual(12);
  });

  it('every tick of every flight: clearance, AGL floor, no Peak cell, no NaN, no tick above 1.05 x the speed, liveness, mean speed, reach, raid time', () => {
    checkFlights('100', results);
  });
});

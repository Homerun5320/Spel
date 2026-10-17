// M12a-2 property test: many helicopter flights on the REAL world over the Alps, the Himalaya and the Andes in both flight modes. This file flies 40
// (a lower tick count); heliFlightReal100.test.ts flies 100 and may be slower. Every flight goes through `step` with a LaunchHeli intent; every tick is checked.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameState } from '../../src/sim/state';
import { checkFlights, makeFlightWorld, runFlights, type FlightResult } from '../helpers/heliFlights';

let results: FlightResult[] = [];
let state: GameState;

beforeAll(async () => {
  state = await makeFlightWorld();
  results = runFlights(state, 7, 20260101);
}, 120_000);

describe('helicopter flights on the real world (40)', () => {
  it('flew at least 40 flights, over all three regions in both modes', () => {
    expect(results.length).toBeGreaterThanOrEqual(40);
    for (const region of ['alps', 'himalaya', 'andes']) for (const mode of [0, 1]) expect(results.filter((r) => r.region === region && r.mode === mode).length, `${region} mode ${mode}`).toBeGreaterThanOrEqual(5);
  });

  it('every tick of every flight: clearance, AGL floor, no Peak cell, no NaN, no tick above 1.05 x the speed, liveness, mean speed, reach, raid time', () => {
    checkFlights('40', results);
  });
});

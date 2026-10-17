// Fix-6B [3.0]: both start paths (Play = MatchSession.create, the setup screen = fromMatch) build a host with the human viewer seat, so the
// helicopter fog and the event filter are on in every match.
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchSession } from '../../src/app/match';
import { createMatch, matchSetupConfig } from '../../src/app/matchSetup';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { rowCosFromLut } from '../../src/sim/grid';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

describe('the viewer seat of a match host', () => {
  it('Play (create) filters for seat 0', async () => {
    const terrainClass = new Uint8Array(64 * 32).fill(CLASS_PLAINS);
    const w = { width: 64, height: 32, terrainClass, meanElev: new Int16Array(64 * 32), cosQ15: Array.from(rowCosFromLut(32)) };
    const s = await MatchSession.create(w, { seed: 3, interpolate: false, ai: false });
    expect(s.viewerSeat).toBe(0);
    s.dispose();
  });

  it('the setup screen (fromMatch) filters for the human seat of the config', async () => {
    const swe = world.countries.find((c) => c.a3 === 'SWE')!;
    const r = createMatch(world, matchSetupConfig({ kind: 'real', countryId: swe.id }, { seed: 2, aiNations: 5, humanSeat: 2 }));
    if (!r.ok) throw new Error(r.error.key);
    const s = await MatchSession.fromMatch(r.match, { interpolate: false, ai: false });
    expect(s.viewerSeat).toBe(2);
    s.dispose();
  });
});

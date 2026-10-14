// Golden hashes of built matches (M06): the same config and seed give the same initial state hash, and the same state after 60 s of play
// with the AI, in Node and, in Part B's e2e test, in Chromium (both read e2e/goldens/match-hashes.json). Rewrite only with
// UPDATE_GOLDENS=1 and a reason in docs/DECISIONS.md.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { createMatch, matchSetupConfig, type MatchSetupConfig } from '../../src/app/matchSetup';
import { AiDriver } from '../../src/host/aiDriver';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { hex32 } from '../../src/sim/hash';
import { hashState } from '../../src/sim/serialize';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

export const MATCH_GOLDEN_PATH = path.resolve(__dirname, '../../e2e/goldens/match-hashes.json');

const cellAt = (lat: number, lon: number): number => Math.floor(((90 - lat) / 180) * 512) * 1024 + Math.floor(((lon + 180) / 360) * 1024);

/** The golden configs by name; the country is looked up by its a3 code (a data fact, not a name in the UI). */
function configs(world: PreparedWorld): Record<string, MatchSetupConfig> {
  const id = (a3: string): number => world.countries.find((c) => c.a3 === a3)?.id as number;
  return {
    'sweden-default': matchSetupConfig({ kind: 'real', countryId: id('SWE') }, { seed: 1 }),
    'custom-central-europe': matchSetupConfig({ kind: 'custom', name: 'Zorland', color: 0xc8102e, flagSeed: 77, cell: cellAt(47, 8) }, { seed: 2 }),
    'custom-neutral': matchSetupConfig({ kind: 'custom', name: 'Zorland', color: 0x336699, flagSeed: 5, cell: cellAt(47, 8) }, { seed: 3, neutral: true, aiNations: 8 }),
    'europe-skirmish': matchSetupConfig({ kind: 'real', countryId: id('DEU') }, { seed: 4, region: 'europe', aiNations: 8 }),
  };
}

export interface MatchGolden {
  schema: 1;
  ticks: number;
  hashes: Record<string, { initial: string; after: string }>;
}

function compute(world: PreparedWorld, ticks: number): MatchGolden {
  const hashes: MatchGolden['hashes'] = {};
  for (const [name, config] of Object.entries(configs(world))) {
    const r = createMatch(world, config);
    if (!r.ok) throw new Error(`${name}: ${r.error.code} ${r.error.key}`);
    const initial = hex32(hashState(r.match.state));
    const host = new MainThreadHost(r.match.state, { speed: 1, driver: new AiDriver(config.seed, { humanSeats: [r.match.humanSeat] }) });
    host.runTicks(ticks);
    hashes[name] = { initial, after: hex32(hashState(r.match.state)) };
    host.dispose();
  }
  return { schema: 1, ticks, hashes };
}

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
  if (process.env.UPDATE_GOLDENS === '1') {
    const g = compute(world, 600);
    fs.writeFileSync(MATCH_GOLDEN_PATH, `${JSON.stringify(g, null, 2)}\n`);
    console.log(`[golden] updated e2e/goldens/match-hashes.json ${JSON.stringify(g.hashes)}`);
  }
});

describe('golden match hashes (Node)', () => {
  it('the committed file exists and names the configs of this test', () => {
    expect(fs.existsSync(MATCH_GOLDEN_PATH), 'kör UPDATE_GOLDENS=1 och committa e2e/goldens/match-hashes.json').toBe(true);
    const g = JSON.parse(fs.readFileSync(MATCH_GOLDEN_PATH, 'utf8')) as MatchGolden;
    expect(g.schema).toBe(1);
    expect(g.ticks).toBe(600);
    expect(Object.keys(g.hashes)).toEqual(Object.keys(configs(world)));
  });

  it('the initial state and the state after 600 ticks of the AI equal the committed hashes', () => {
    const g = JSON.parse(fs.readFileSync(MATCH_GOLDEN_PATH, 'utf8')) as MatchGolden;
    expect(compute(world, g.ticks).hashes).toEqual(g.hashes);
  });

  it('the four initial hashes differ from each other, and playing changes them', () => {
    const g = JSON.parse(fs.readFileSync(MATCH_GOLDEN_PATH, 'utf8')) as MatchGolden;
    const initial = Object.values(g.hashes).map((h) => h.initial);
    expect(new Set(initial).size).toBe(initial.length);
    for (const h of Object.values(g.hashes)) expect(h.after).not.toBe(h.initial);
  });
});

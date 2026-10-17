// The four configs of the golden match hashes (e2e/goldens/match-hashes.json), shared by the Node test (tests/app/matchGolden.test.ts) and
// the Chromium test (e2e/setup.test.ts): both must build exactly these matches through `createMatch`.
import type { PreparedWorld } from '../../src/app/matchWorld';
import { matchSetupConfig, type MatchSetupConfig } from '../../src/app/matchSetup';

/** The sim cell under a latitude and longitude. */
export const cellAt = (lat: number, lon: number): number => Math.floor(((90 - lat) / 180) * 512) * 1024 + Math.floor(((lon + 180) / 360) * 1024);

/** The golden configs by name; the country is looked up by its a3 code (a data fact, not a name in the UI). */
export function goldenConfigs(world: PreparedWorld): Record<string, MatchSetupConfig> {
  const id = (a3: string): number => world.countries.find((c) => c.a3 === a3)?.id as number;
  return {
    'sweden-default': matchSetupConfig({ kind: 'real', countryId: id('SWE') }, { seed: 1 }),
    'custom-central-europe': matchSetupConfig({ kind: 'custom', name: 'Zorland', color: 0xc8102e, flagSeed: 77, cell: cellAt(47, 8) }, { seed: 2 }),
    'custom-neutral': matchSetupConfig({ kind: 'custom', name: 'Zorland', color: 0x336699, flagSeed: 5, cell: cellAt(47, 8) }, { seed: 3, neutral: true, aiNations: 8 }),
    'europe-skirmish': matchSetupConfig({ kind: 'real', countryId: id('DEU') }, { seed: 4, region: 'europe', aiNations: 8 }),
  };
}

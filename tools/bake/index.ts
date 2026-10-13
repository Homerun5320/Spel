// `npm run bake`: fetch (cached), build, write public/data. Usage:
//   npm run bake -- [--out=public/data] [--ne-sha=<sha>] [--synthetic]
// --synthetic replaces the real inputs with seeded noise and a few boxes. It exists ONLY to test the pipeline, writes
// under .cache/bake-synthetic and refuses any other output folder, so synthetic data can never be committed as packs.
import fs from 'node:fs';
import path from 'node:path';
import { fnv1a32 } from '../../src/data/bytes';
import { buildWorld } from './build';
import { fetchNe, fetchTerrarium, lookupNeSha, NE_FALLBACK_SHA, NE_FILES } from './fetch';
import { prepareOutput, writeOutput } from './output';
import { decodeTiles } from './terrarium';
import { syntheticInputs } from './synthetic';

const REPO = path.resolve(import.meta.dirname, '../..');
const DEFAULT_OUT = path.join(REPO, 'public/data');
const SYNTH_OUT = path.join(REPO, '.cache/bake-synthetic');

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}

function resolveNeSha(): { sha: string; how: string } {
  const given = arg('ne-sha');
  if (given) return { sha: given, how: '--ne-sha' };
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(DEFAULT_OUT, 'meta.json'), 'utf8')) as { source?: { naturalEarth?: { sha?: string } } };
    const sha = meta.source?.naturalEarth?.sha;
    if (sha && /^[0-9a-f]{40}$/.test(sha)) return { sha, how: 'committed meta.json (reproducible)' };
  } catch {
    /* first bake */
  }
  const looked = lookupNeSha();
  if (looked) return { sha: looked, how: 'git ls-remote HEAD' };
  return { sha: NE_FALLBACK_SHA, how: 'fallback constant (git ls-remote failed)' };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const log = (s: string): void => console.log(`[bake ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
  const synthetic = process.argv.includes('--synthetic');
  const outDir = path.resolve(REPO, arg('out') ?? (synthetic ? SYNTH_OUT : DEFAULT_OUT));
  if (synthetic && outDir !== SYNTH_OUT) throw new Error(`--synthetic may only write to ${SYNTH_OUT}`);
  if (!synthetic && outDir.startsWith(SYNTH_OUT)) throw new Error('refusing to write real data into the synthetic folder');

  let inputs;
  if (synthetic) {
    log('SYNTHETIC inputs (pipeline test only, never committed)');
    inputs = syntheticInputs();
  } else {
    const { sha, how } = resolveNeSha();
    log(`Natural Earth commit ${sha} (${how})`);
    const countries = JSON.parse(await fetchNe(sha, NE_FILES.countries));
    const places = JSON.parse(await fetchNe(sha, NE_FILES.places));
    const ports = JSON.parse(await fetchNe(sha, NE_FILES.ports));
    log('Terrarium z4 tiles');
    const { tiles } = await fetchTerrarium(log);
    log('decoding tiles');
    const merc = decodeTiles(tiles);
    inputs = { merc, countries, places, ports, naturalEarthSha: sha };
  }
  log('building');
  const world = buildWorld({ ...inputs, log });
  log(`land cells ${String(world.stats.landCells)}, without Antarctica ${String(world.stats.landCellsNoAntarctica)}`);
  const out = prepareOutput(world);
  writeOutput(out, outDir);
  let gzTotal = 0;
  for (const [name, bytes] of out.files) {
    log(`  ${name}: ${bytes.length} bytes`);
    gzTotal += bytes.length;
  }
  log(`wrote ${out.files.size} files (${gzTotal} bytes) to ${path.relative(REPO, outDir)}; manifest fnv1a ${fnv1a32(out.files.get('manifest.json') as Uint8Array).toString(16)}`);
  log(`stats ${JSON.stringify(world.stats)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

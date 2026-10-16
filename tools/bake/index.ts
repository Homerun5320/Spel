// `npm run bake`: fetch (cached), build, write public/data. Usage:
//   npm run bake -- [--out=public/data] [--ne-sha=<sha>] [--synthetic] [--only=federations]
// --only=federations rebuilds just the federations pack from the committed sim pack and meta.json plus the cached admin-1 file;
// it writes federations.bin.gz, manifest.json and checksums.json (old rows unchanged) and nothing else.
// --synthetic replaces the real inputs with seeded noise and a few boxes. It exists ONLY to test the pipeline, writes
// under .cache/bake-synthetic and refuses any other output folder, so synthetic data can never be committed as packs.
import fs from 'node:fs';
import path from 'node:path';
import { fnv1a32 } from '../../src/data/bytes';
import { buildWorld } from './build';
import { fetchNe, fetchTerrarium, lookupNeSha, NE_FALLBACK_SHA, NE_FILES } from './fetch';
import { addFederationsOutput, prepareOutput, writeOutput, type OutputFiles } from './output';
import { buildFederations, formatReport, type Admin1Feature } from './federations';
import { packFederations } from '../../src/data/federations';
import { simGridView } from '../../src/data/world';
import type { Checksums, Manifest } from '../../src/data/loader';
import zlib from 'node:zlib';
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

async function federationsFor(sha: string, simPayload: Uint8Array, countries: Array<{ id: number; a3: string; name_en: string }>, log: (s: string) => void): Promise<Uint8Array> {
  const admin1 = (JSON.parse(await fetchNe(sha, NE_FILES.admin1)) as { features: Admin1Feature[] }).features;
  const sim = simGridView(simPayload);
  const built = buildFederations(sim.country, sim.land, countries, admin1);
  if (built.skipped.length > 0) log(`  federations: ${built.skipped.length} admin-1 features skipped (unknown country): ${built.skipped.slice(0, 8).join(', ')}`);
  log(`federations:\n${formatReport(built.federations, countries)}`);
  return packFederations(built.federations);
}

async function bakeFederationsOnly(outDir: string, log: (s: string) => void): Promise<void> {
  const read = (n: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(outDir, n)));
  const json = <T>(n: string): T => JSON.parse(new TextDecoder().decode(read(n))) as T;
  const meta = json<{ countries: Array<{ id: number; a3: string; name_en: string }>; source: { naturalEarth: { sha: string } } }>('meta.json');
  const manifest = json<Manifest>('manifest.json');
  const checksums = json<Checksums>('checksums.json');
  const sim = new Uint8Array(zlib.gunzipSync(read('sim.bin.gz')));
  const payload = await federationsFor(meta.source.naturalEarth.sha, sim, meta.countries, log);
  const files = new Map<string, Uint8Array>();
  addFederationsOutput(files, manifest, checksums, payload);
  writeOutput({ files, checksums } satisfies OutputFiles, outDir);
  log(`wrote ${[...files.keys()].join(', ')} (${files.get('federations.bin.gz')?.length ?? 0} bytes gz) to ${path.relative(REPO, outDir)}`);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const log = (s: string): void => console.log(`[bake ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
  const synthetic = process.argv.includes('--synthetic');
  const outDir = path.resolve(REPO, arg('out') ?? (synthetic ? SYNTH_OUT : DEFAULT_OUT));
  if (synthetic && outDir !== SYNTH_OUT) throw new Error(`--synthetic may only write to ${SYNTH_OUT}`);
  if (!synthetic && outDir.startsWith(SYNTH_OUT)) throw new Error('refusing to write real data into the synthetic folder');

  if (arg('only') === 'federations') {
    if (synthetic) throw new Error('--only=federations needs the real packs');
    await bakeFederationsOnly(outDir, log);
    return;
  }

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
  log(`land cells ${String(world.stats.landCells)}, without Antarctica ${String(world.stats.landCellsNoAntarctica)}; countries with >= 8 cells: ${world.countries.filter((c) => c.cells >= 8).length} of ${world.countries.length}`);
  const out = prepareOutput(world);
  if (!synthetic) {
    const payload = await federationsFor(inputs.naturalEarthSha, world.packs.sim, world.countries, log);
    addFederationsOutput(out.files, JSON.parse(new TextDecoder().decode(out.files.get('manifest.json'))) as Manifest, out.checksums, payload);
    out.checksums = JSON.parse(new TextDecoder().decode(out.files.get('checksums.json'))) as Checksums;
  }
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

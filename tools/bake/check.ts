// `npm run bake:check`: verifies the committed files in public/data against checksums.json without any network.
// The sha256 of the UNCOMPRESSED payload is authoritative; the sha256 of the .gz is informational (reported, never fatal).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fnv1a32, hasGzipMagic, hex8 } from '../../src/data/bytes';
import { layoutOf, PACK_NAMES } from '../../src/data/format';
import type { Checksums, Manifest } from '../../src/data/loader';
import { JSON_FILES, sha256 } from './output';

/** Total committed data budget (bytes) for everything in public/data. */
export const DATA_BUDGET_BYTES = 6 * 1024 * 1024;

export interface CheckReport {
  problems: string[];
  notes: string[];
  totalBytes: number;
}

export function checkData(dir: string): CheckReport {
  const problems: string[] = [];
  const notes: string[] = [];
  const read = (name: string): Uint8Array | null => {
    const p = path.join(dir, name);
    return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null;
  };
  const checksumsRaw = read('checksums.json');
  const manifestRaw = read('manifest.json');
  if (!checksumsRaw) return { problems: ['checksums.json is missing'], notes, totalBytes: 0 };
  if (!manifestRaw) return { problems: ['manifest.json is missing'], notes, totalBytes: 0 };
  const checksums = JSON.parse(new TextDecoder().decode(checksumsRaw)) as Checksums;
  const manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as Manifest;
  let totalBytes = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('.')) continue;
    totalBytes += fs.statSync(path.join(dir, f)).size;
  }
  if (totalBytes > DATA_BUDGET_BYTES) problems.push(`public/data holds ${totalBytes} bytes, over the ${DATA_BUDGET_BYTES} byte budget`);

  for (const name of PACK_NAMES) {
    const entry = manifest[name];
    const want = checksums.packs[name];
    if (!entry) {
      problems.push(`manifest.json has no pack "${name}"`);
      continue;
    }
    if (!want) {
      problems.push(`checksums.json has no record for pack "${name}"`);
      continue;
    }
    const gz = read(entry.file);
    if (!gz) {
      problems.push(`${entry.file} is missing`);
      continue;
    }
    if (!hasGzipMagic(gz)) {
      problems.push(`${entry.file} has no gzip magic`);
      continue;
    }
    if (gz[4] !== 0 || gz[5] !== 0 || gz[6] !== 0 || gz[7] !== 0) problems.push(`${entry.file}: gzip header has a timestamp`);
    let payload: Uint8Array;
    try {
      payload = new Uint8Array(zlib.gunzipSync(gz));
    } catch (err) {
      problems.push(`${entry.file}: cannot inflate (${String(err)})`);
      continue;
    }
    const { layers, totalBytes: expectBytes } = layoutOf(name);
    if (payload.length !== expectBytes || payload.length !== want.bytes) problems.push(`${name}: ${payload.length} bytes, format says ${expectBytes}, checksums say ${want.bytes}`);
    if (sha256(payload) !== want.sha256) problems.push(`${name}: sha256 of the payload differs from checksums.json`);
    if (hex8(fnv1a32(payload)) !== want.fnv1a) problems.push(`${name}: fnv1a of the payload differs from checksums.json`);
    for (const l of layers) {
      const rec = want.layers?.[l.name];
      if (!rec) {
        problems.push(`${name}: checksums.json has no layer "${l.name}"`);
        continue;
      }
      const part = payload.subarray(l.offset, l.offset + l.bytes);
      if (rec.offset !== l.offset || rec.bytes !== l.bytes || rec.sha256 !== sha256(part) || rec.fnv1a !== hex8(fnv1a32(part))) {
        problems.push(`${name}: layer "${l.name}" differs from checksums.json`);
      }
    }
    if (want.gzSha256 && want.gzSha256 !== sha256(gz)) notes.push(`${entry.file}: the .gz bytes differ from the baked ones (informational: gzip output can vary between Node versions)`);
  }
  for (const f of JSON_FILES) {
    const bytes = read(f);
    const want = checksums.files[f];
    if (!bytes) problems.push(`${f} is missing`);
    else if (!want) problems.push(`checksums.json has no record for ${f}`);
    else if (sha256(bytes) !== want.sha256 || hex8(fnv1a32(bytes)) !== want.fnv1a || bytes.length !== want.bytes) problems.push(`${f} differs from checksums.json`);
  }
  const metaBytes = read('meta.json');
  if (metaBytes) {
    const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as { source?: { naturalEarth?: { sha?: string } } };
    if (!/^[0-9a-f]{40}$/.test(meta.source?.naturalEarth?.sha ?? '')) problems.push('meta.json has no valid Natural Earth commit SHA (synthetic data?)');
  }
  return { problems, notes, totalBytes };
}

function main(): void {
  const dir = path.resolve(import.meta.dirname, '../../public/data');
  const report = checkData(dir);
  for (const n of report.notes) console.log(`note: ${n}`);
  if (report.problems.length > 0) {
    console.error(`bake:check FAILED (${report.problems.length}):\n${report.problems.map((p) => `- ${p}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`bake:check ok: ${PACK_NAMES.length} packs and ${JSON_FILES.length} JSON files match checksums.json; ${report.totalBytes} bytes in public/data`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();

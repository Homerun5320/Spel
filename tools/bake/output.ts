// Deterministic output: gzip level 9 with a fixed header, sorted JSON keys, checksums.json, manifest.json.
// Nothing here depends on the clock, the machine or the order of the file system.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fnv1a32, hex8 } from '../../src/data/bytes';
import { layoutOf, type PackName } from '../../src/data/format';
import type { ChecksumRecord, Checksums, Manifest } from '../../src/data/loader';
import type { BuiltWorld } from './build';

export const PACK_FILES: Record<PackName, string> = { render: 'render.bin.gz', sim: 'sim.bin.gz' };
export const JSON_FILES = ['cities.json', 'meta.json', 'overrides.json', 'ports.json'] as const;

export function sha256(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * gzip level 9. The header is normalised: mtime 0 (Node already writes 0), XFL 2 (best compression), OS 255 (unknown),
 * so the bytes do not depend on the platform that wrote them. The deflate stream itself comes from the bundled zlib
 * and can differ between Node versions, which is why the sha256 of the .gz is informational only.
 */
export function gzipDeterministic(payload: Uint8Array): Uint8Array {
  const gz = new Uint8Array(zlib.gzipSync(payload, { level: 9, memLevel: 9 }));
  gz[4] = 0;
  gz[5] = 0;
  gz[6] = 0;
  gz[7] = 0;
  gz[8] = 2;
  gz[9] = 255;
  return gz;
}

/** JSON with sorted object keys, two-space indent for small files, compact for big arrays; always a trailing newline. */
export function stableJson(value: unknown, indent: number | undefined = undefined): Uint8Array {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v !== null && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) o[k] = sorted((v as Record<string, unknown>)[k]);
      return o;
    }
    return v;
  };
  return new TextEncoder().encode(JSON.stringify(sorted(value), null, indent) + '\n');
}

function record(bytes: Uint8Array): ChecksumRecord {
  return { bytes: bytes.length, sha256: sha256(bytes), fnv1a: hex8(fnv1a32(bytes)) };
}

export interface OutputFiles {
  /** file name -> bytes, in write order. */
  files: Map<string, Uint8Array>;
  checksums: Checksums;
}

export function prepareOutput(world: BuiltWorld): OutputFiles {
  const files = new Map<string, Uint8Array>();
  const checksums: Checksums = { version: 1, packs: {}, files: {} };
  const manifest: Manifest = {};
  for (const name of Object.keys(PACK_FILES).sort() as PackName[]) {
    const payload = world.packs[name];
    const gz = gzipDeterministic(payload);
    const file = PACK_FILES[name];
    files.set(file, gz);
    const layers: Record<string, ChecksumRecord & { offset: number }> = {};
    for (const l of layoutOf(name).layers) {
      layers[l.name] = { offset: l.offset, ...record(payload.subarray(l.offset, l.offset + l.bytes)) };
    }
    checksums.packs[name] = { file, ...record(payload), gzBytes: gz.length, gzSha256: sha256(gz), layers };
    manifest[name] = { file, enc: 'raw' };
  }
  const docs: Record<(typeof JSON_FILES)[number], Uint8Array> = {
    'cities.json': stableJson(world.cities),
    'meta.json': stableJson(world.meta, 1),
    'overrides.json': stableJson(world.overrides, 1),
    'ports.json': stableJson(world.ports),
  };
  for (const f of JSON_FILES) {
    files.set(f, docs[f]);
    checksums.files[f] = record(docs[f]);
  }
  files.set('manifest.json', stableJson(manifest, 1));
  files.set('checksums.json', stableJson(checksums, 1));
  return { files, checksums };
}

/** Writes all files into `dir` via temp files and renames, so a failed bake never leaves half-written output. */
export function writeOutput(out: OutputFiles, dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const tmp: Array<[string, string]> = [];
  try {
    for (const [name, bytes] of out.files) {
      const target = path.join(dir, name);
      const t = `${target}.tmp${process.pid}`;
      fs.writeFileSync(t, bytes);
      tmp.push([t, target]);
    }
  } catch (err) {
    for (const [t] of tmp) fs.rmSync(t, { force: true });
    throw err;
  }
  for (const [t, target] of tmp) fs.renameSync(t, target);
}

export const FEDERATIONS_FILE = 'federations.bin.gz';

/**
 * Adds the federations pack (M18b-1) to a prepared output: the file, a manifest entry and a NEW row in checksums.json under
 * packs.federations. Every existing row is carried over untouched, so no old hash changes. `manifest` and `checksums` are
 * the current JSON documents (from prepareOutput or from the committed files).
 */
export function addFederationsOutput(files: Map<string, Uint8Array>, manifest: Manifest, checksums: Checksums, payload: Uint8Array): void {
  const gz = gzipDeterministic(payload);
  files.set(FEDERATIONS_FILE, gz);
  const m: Manifest = { ...manifest, federations: { file: FEDERATIONS_FILE, enc: 'raw' } };
  const c: Checksums = { ...checksums, packs: { ...checksums.packs, federations: { file: FEDERATIONS_FILE, ...record(payload), gzBytes: gz.length, gzSha256: sha256(gz) } } };
  files.delete('manifest.json');
  files.delete('checksums.json');
  files.set('manifest.json', stableJson(m, 1));
  files.set('checksums.json', stableJson(c, 1));
}

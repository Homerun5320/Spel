// Runtime loading of data packs (docs/ARCHITECTURE.md). Packs are gzip bytes that are never decoded as
// images. Every fetch goes through siteUrl(). In an Artifact build the same bytes may sit under .png/.wasm
// (raw) or as base64 text under .txt (`enc: "b64"`); data/manifest.json says which (rewritten by
// scripts/artifact-pack.mjs).
import { siteUrl } from './paths';

export type PackEnc = 'raw' | 'b64';

export interface PackEntry {
  /** File name relative to the data/ folder. */
  file: string;
  /** Default 'raw' when absent (the source manifest need not say). */
  enc?: PackEnc;
}

export type PackManifest = Record<string, PackEntry>;

/** FNV-1a 32-bit over bytes (used by the probe page and its expected.json). */
export function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface FromBase64 {
  fromBase64?: (s: string) => Uint8Array;
}

/**
 * Base64 text to bytes. Uses Uint8Array.fromBase64 when the engine has it, otherwise a plain loop over the
 * atob string. Never Uint8Array.from(atob(s), fn): it is about eight times slower.
 */
export function decodeBase64(text: string): Uint8Array {
  const native = (Uint8Array as unknown as FromBase64).fromBase64;
  if (typeof native === 'function') return native.call(Uint8Array, text);
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Same loop path as decodeBase64's fallback, exported so tests can exercise it where fromBase64 exists. */
export function decodeBase64Loop(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** gzip bytes to raw bytes with DecompressionStream. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Fetches a file of the site and returns the (still gzipped) pack bytes, decoding base64 when `enc` is 'b64'. */
export async function fetchPackBytes(path: string, enc: PackEnc = 'raw'): Promise<Uint8Array> {
  const res = await fetch(siteUrl(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  if (enc === 'b64') return decodeBase64(await res.text());
  return new Uint8Array(await res.arrayBuffer());
}

export async function loadManifest(): Promise<PackManifest> {
  const res = await fetch(siteUrl('data/manifest.json'));
  if (!res.ok) throw new Error(`data/manifest.json: HTTP ${res.status}`);
  return (await res.json()) as PackManifest;
}

/** Loads one named pack from the manifest and returns its decompressed bytes. */
export async function loadPack(name: string, manifest: PackManifest): Promise<Uint8Array> {
  const entry = manifest[name];
  if (!entry) throw new Error(`unknown pack "${name}"`);
  return gunzip(await fetchPackBytes(`data/${entry.file}`, entry.enc ?? 'raw'));
}

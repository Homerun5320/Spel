// Byte helpers of the data loader: FNV-1a, base64, gzip. Pure TypeScript; works in the browser, in workers and in Node.

/** FNV-1a 32-bit over bytes. Pure TS on purpose: crypto.subtle needs a secure context, which an Artifact may not have. */
export function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Lower-case 8-digit hex of a 32-bit value (the form used in checksums.json). */
export function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

interface FromBase64 {
  fromBase64?: (s: string) => Uint8Array;
}

/** Base64 loop over the atob string: charCodeAt into a typed array (Uint8Array.from(atob(s), fn) is about 8 times slower). */
export function decodeBase64Loop(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Base64 text to bytes: Uint8Array.fromBase64 when the engine has it, else the atob loop. */
export function decodeBase64(text: string): Uint8Array {
  const native = (Uint8Array as unknown as FromBase64).fromBase64;
  if (typeof native === 'function') return native.call(Uint8Array, text);
  return decodeBase64Loop(text);
}

/** True when the bytes start with the gzip magic 1f 8b (a server may already have inflated the file). */
export function hasGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Inflates gzip bytes with DecompressionStream. Rejects on corrupt input. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

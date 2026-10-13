import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeBase64, decodeBase64Loop, fnv1a32, gunzip } from '../src/app/dataPack';

describe('data pack helpers', () => {
  const sample = new Uint8Array(1000).map((_, i) => (i * 37 + 11) & 255);
  const b64 = Buffer.from(sample).toString('base64');

  afterEach(() => {
    delete (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64;
  });

  it('decodes base64 with the atob loop when fromBase64 is missing', () => {
    expect(typeof (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64).not.toBe('function');
    expect([...decodeBase64(b64)]).toEqual([...sample]);
    expect([...decodeBase64Loop(b64)]).toEqual([...sample]);
  });

  it('uses Uint8Array.fromBase64 when the engine has it', () => {
    let called = 0;
    (Uint8Array as unknown as { fromBase64: (s: string) => Uint8Array }).fromBase64 = (s: string) => {
      called++;
      return new Uint8Array(Buffer.from(s, 'base64'));
    };
    expect([...decodeBase64(b64)]).toEqual([...sample]);
    expect(called).toBe(1);
  });

  it('never uses Uint8Array.from(atob(...), fn) in the source', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/app/dataPack.ts', 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'));
    expect(src.join('\n')).not.toMatch(/Uint8Array\.from\(\s*atob/);
  });

  it('gunzips what zlib gzipped', async () => {
    const gz = zlib.gzipSync(Buffer.from(sample));
    expect([...(await gunzip(new Uint8Array(gz)))]).toEqual([...sample]);
  });

  it('fnv1a32 matches the published test vectors', () => {
    expect(fnv1a32(new Uint8Array(0))).toBe(0x811c9dc5);
    expect(fnv1a32(new TextEncoder().encode('a'))).toBe(0xe40c292c);
    expect(fnv1a32(new TextEncoder().encode('foobar'))).toBe(0xbf9cf968);
  });
});

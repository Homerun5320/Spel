// File-system variant of the loader's injected readBytes. Lives in tests/ on purpose: src/data never imports it.
import fs from 'node:fs';
import path from 'node:path';
import type { ReadBytes } from '../../src/data/loader';
import { createWorldLoader, type WorldLoad } from '../../src/data/world';

export const DATA_DIR = path.resolve(__dirname, '../../public/data');
export const TEST_MANIFEST_URL = 'http://test.invalid/data/manifest.json';

/** Maps http://test.invalid/data/<name> to <dir>/<name>; `overrides` can replace single files. */
export function fsReadBytes(dir: string = DATA_DIR, overrides: Record<string, Uint8Array | undefined> = {}): ReadBytes {
  return async (url: string): Promise<Uint8Array> => {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\/data\//, ''));
    const o = overrides[name];
    if (o) return o;
    return new Uint8Array(fs.readFileSync(path.join(dir, name)));
  };
}

export function worldLoader(overrides: Record<string, Uint8Array | undefined> = {}, dir: string = DATA_DIR): WorldLoad {
  return createWorldLoader({ manifestUrl: TEST_MANIFEST_URL, readBytes: fsReadBytes(dir, overrides) });
}

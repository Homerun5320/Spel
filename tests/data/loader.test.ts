import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fnv1a32, hex8 } from '../../src/data/bytes';
import { DataIntegrityError } from '../../src/data/loader';
import { DATA_DIR, fsReadBytes, worldLoader } from '../helpers/dataFiles';
import fs from 'node:fs';
import path from 'node:path';

const raw = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(DATA_DIR, name)));
const b64Manifest = (): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({ render: { file: 'render.b64.txt', enc: 'b64' }, sim: { file: 'sim.b64.txt', enc: 'b64' } }),
  );
const b64Files = (): Record<string, Uint8Array> => ({
  'manifest.json': b64Manifest(),
  'render.b64.txt': new TextEncoder().encode(Buffer.from(raw('render.bin.gz')).toString('base64')),
  'sim.b64.txt': new TextEncoder().encode(Buffer.from(raw('sim.bin.gz')).toString('base64')),
});

describe('data loader', () => {
  it('loads the same pack through raw and b64 and gets identical bytes', async () => {
    const rawLoader = worldLoader();
    const b64Loader = worldLoader(b64Files());
    for (const name of ['sim', 'render']) {
      const a = await rawLoader.loader.loadPack(name);
      const b = await b64Loader.loader.loadPack(name);
      expect(b.length).toBe(a.length);
      expect(fnv1a32(b)).toBe(fnv1a32(a));
      expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    }
  });

  it('also works when the server has already inflated the file (no gzip magic)', async () => {
    const inflated = new Uint8Array(zlib.gunzipSync(raw('sim.bin.gz')));
    const l = worldLoader({ 'sim.bin.gz': inflated });
    const bytes = await l.loader.loadPack('sim');
    expect(bytes.length).toBe(inflated.length);
  });

  it('rejects a corrupt byte in the compressed file', async () => {
    const gz = raw('sim.bin.gz').slice();
    gz[Math.floor(gz.length / 2)] = (gz[Math.floor(gz.length / 2)] as number) ^ 0x40;
    await expect(worldLoader({ 'sim.bin.gz': gz }).loader.loadPack('sim')).rejects.toThrow();
  });

  it('rejects a corrupt byte in an already inflated payload (fnv1a mismatch)', async () => {
    const inflated = new Uint8Array(zlib.gunzipSync(raw('sim.bin.gz')));
    inflated[12345] = (inflated[12345] as number) ^ 1;
    await expect(worldLoader({ 'sim.bin.gz': inflated }).loader.loadPack('sim')).rejects.toBeInstanceOf(DataIntegrityError);
  });

  it('rejects a corrupt byte in a JSON file and an unknown pack', async () => {
    const cities = raw('cities.json').slice();
    cities[100] = cities[100] === 0x61 ? 0x62 : 0x61;
    await expect(worldLoader({ 'cities.json': cities }).loadCities()).rejects.toBeInstanceOf(DataIntegrityError);
    await expect(worldLoader().loader.loadPack('nope')).rejects.toThrow(/unknown pack/);
  });

  it('checksums.json holds sha256 and fnv1a of the payload and informational gz data', async () => {
    const sums = await worldLoader().loader.checksums();
    const sim = sums.packs.sim;
    expect(sim).toBeDefined();
    const payload = new Uint8Array(zlib.gunzipSync(raw('sim.bin.gz')));
    expect(sim?.bytes).toBe(payload.length);
    expect(sim?.fnv1a).toBe(hex8(fnv1a32(payload)));
    expect(sim?.gzSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(sim?.layers ?? {})).toContain('ruggedness');
  });

  it('logs load and parse time (target 300 ms) from a Node file read', async () => {
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const l = worldLoader();
      await l.loadSim();
      await l.loadRender();
      await l.loadMeta();
      await l.loadCities();
      await l.loadPorts();
      await l.loadOverrides();
      runs.push(performance.now() - t0);
      if (i === 0) console.log(`[data] node timings ${JSON.stringify(l.timings().map((t) => ({ ...t, readMs: +t.readMs.toFixed(1), inflateMs: +t.inflateMs.toFixed(1), checksumMs: +t.checksumMs.toFixed(1) })))}`);
    }
    runs.sort((a, b) => a - b);
    console.log(`[data] node load + parse, 5 runs (ms): ${runs.map((r) => r.toFixed(0)).join(' ')}; median ${runs[2]?.toFixed(0)} (target 300 ms)`);
    expect(runs[2]).toBeGreaterThan(0);
  });

  it('fsReadBytes is only a test helper: src/data has no file-system import', () => {
    for (const f of fs.readdirSync('src/data')) {
      const text = fs.readFileSync(path.join('src/data', f), 'utf8');
      expect(text, f).not.toMatch(/from 'node:|from "node:|require\(/);
    }
    expect(typeof fsReadBytes).toBe('function');
  });
});

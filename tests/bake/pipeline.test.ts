// Tests the bake pipeline itself on SYNTHETIC input (seeded noise and a few boxes). No network, nothing from public/data.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { RENDER_WIDTH, TerrainClass, layoutOf } from '../../src/data/format';
import { buildWorld, type BuiltWorld } from '../../tools/bake/build';
import { checkData } from '../../tools/bake/check';
import { gzipDeterministic, prepareOutput, sha256, writeOutput } from '../../tools/bake/output';
import { syntheticInputs } from '../../tools/bake/synthetic';
import { cleanHeights, MERC_SIZE } from '../../tools/bake/terrarium';
import { simGridView, renderPackView } from '../../src/data/world';

let a: BuiltWorld;
let b: BuiltWorld;

beforeAll(() => {
  a = buildWorld(syntheticInputs());
  b = buildWorld(syntheticInputs());
}, 120_000);

describe('synthetic pipeline', () => {
  it('is deterministic: two builds give byte-identical payloads, JSON and gzip', () => {
    for (const name of ['render', 'sim'] as const) {
      expect(sha256(a.packs[name])).toBe(sha256(b.packs[name]));
    }
    const oa = prepareOutput(a);
    const ob = prepareOutput(b);
    expect([...oa.files.keys()]).toEqual([...ob.files.keys()]);
    for (const [name, bytes] of oa.files) expect(sha256(bytes), name).toBe(sha256(ob.files.get(name) as Uint8Array));
    // Output order is sorted and fixed.
    expect([...oa.files.keys()]).toEqual(['render.bin.gz', 'sim.bin.gz', 'cities.json', 'meta.json', 'overrides.json', 'ports.json', 'manifest.json', 'checksums.json']);
  });

  it('gzip is level 9 with mtime 0 and a fixed header', () => {
    const gz = gzipDeterministic(new Uint8Array(1000).fill(7));
    expect([...gz.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255]);
  });

  it('rasterises countries: hole stays empty, antimeridian pieces both filled, Antarctica is Ice', () => {
    const render = renderPackView(a.packs.render);
    const sim = simGridView(a.packs.sim);
    const pix = (lon: number, lat: number): number => render.country8[Math.floor(((90 - lat) / 180) * 2048) * RENDER_WIDTH + Math.floor(((lon + 180) / 360) * RENDER_WIDTH)] as number;
    const idOf = (a3: string): number => (a.countries.find((c) => c.a3 === a3) as { id: number }).id;
    expect(pix(-50, 40)).toBe(idOf('AAA'));
    expect(pix(-20, 10)).toBe(0); // inside the hole box(-30,0,-10,20)
    expect(pix(175, 0)).toBe(idOf('BBB'));
    expect(pix(-175, 0)).toBe(idOf('BBB'));
    const cell = (lon: number, lat: number): number => Math.floor(((90 - lat) / 180) * 512) * 1024 + Math.floor(((lon + 180) / 360) * 1024);
    expect(sim.land[cell(0, 30)]).toBe(1);
    expect(sim.terrainClass[cell(0, -80)]).toBe(TerrainClass.Ice); // inside the synthetic Antarctica
    expect(sim.land[cell(0, -80)]).toBe(1);
    // ids are 1..N in order
    for (let i = 1; i < a.countries.length; i++) expect((a.countries[i - 1] as { id: number }).id).toBe(i);
  });

  it('cities snap to land cells of their own country, ports to coast cells, unreachable ones are dropped', () => {
    const sim = simGridView(a.packs.sim);
    expect(a.cities.map((c) => c.name)).toContain('Acity');
    for (const c of a.cities) {
      expect(sim.land[c.cell]).toBe(1);
      expect(sim.country[c.cell]).toBe(c.country);
    }
    expect(a.cities.map((c) => c.name)).not.toContain('Ghost'); // in the ocean, farther than 3 cells from land
    expect(a.ports.map((p) => p.name)).toContain('Aharbour');
    expect(a.ports.map((p) => p.name)).not.toContain('Nowhere');
  });

  it('the bake:check function accepts what the bake wrote and rejects a flipped byte', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spel-bake-'));
    try {
      writeOutput(prepareOutput(a), dir);
      // The synthetic meta carries the SHA "synthetic": check reports exactly that and nothing else.
      expect(checkData(dir).problems).toEqual(['meta.json has no valid Natural Earth commit SHA (synthetic data?)']);
      const f = path.join(dir, 'cities.json');
      const bytes = fs.readFileSync(f);
      bytes[10] = bytes[10] === 0x61 ? 0x62 : 0x61;
      fs.writeFileSync(f, bytes);
      expect(checkData(dir).problems.some((p) => p.includes('cities.json differs'))).toBe(true);
      expect(fs.readdirSync(dir).filter((x) => x.includes('.tmp'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('layer table matches the packs', () => {
    expect(a.packs.sim.length).toBe(layoutOf('sim').totalBytes);
    expect(a.packs.render.length).toBe(layoutOf('render').totalBytes);
  });
});

describe('spike removal', () => {
  it('clamps land to 9000 m and replaces an isolated 11 500 m pixel, but keeps a real peak', () => {
    const n = 32;
    const h = new Float32Array(n * n).fill(100);
    h[5 * n + 5] = 11500; // isolated error pixel
    // a real peak: a ridge sloping up to 4500 m (neighbours within 2000 m of the median survive)
    const peak = 10 * n + 10;
    for (const [dx, dy, v] of [[0, 0, 4500], [1, 0, 3500], [-1, 0, 3000], [0, 1, 3200], [0, -1, 2800], [1, 1, 2500], [-1, -1, 2600], [1, -1, 2400], [-1, 1, 2300]] as number[][]) {
      h[(10 + (dy as number)) * n + 10 + (dx as number)] = v as number;
    }
    const stats = cleanHeights(h, n);
    expect(stats.clampedHigh).toBe(1);
    expect(h[5 * n + 5]).toBe(100);
    expect(h[peak]).toBe(4500);
    expect(stats.maxAfter).toBe(4500);
    expect(MERC_SIZE).toBe(4096);
  });
});

describe('CLI guard', () => {
  it('refuses to write synthetic data anywhere but the cache folder', () => {
    const res = spawnSync('npx', ['tsx', 'tools/bake/index.ts', '--synthetic', '--out=public/data'], { encoding: 'utf8', cwd: path.resolve(__dirname, '../..') });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/--synthetic may only write to/);
  }, 30_000);
});

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkLinks, listFiles, makeBatches, makeProbePack, pack, toFragment } from '../scripts/artifact-pack.mjs';
import { fnv1a32 } from '../src/app/dataPack';
import { REPO, buildDistTo, copyDir, makeTmp } from './helpers/buildDist';

const SCRIPT = path.join(REPO, 'scripts', 'artifact-pack.mjs');
const FORBIDDEN_BATCH_EXT = /\.(bin|gz|zip)$/i;

describe('toFragment', () => {
  it('removes doctype, html, head and body tags (with attributes)', () => {
    const out = toFragment('<!DOCTYPE html>\n<html lang="sv">\n<head>\n<title>T</title>\n</head>\n<body class="x">\n<div id="root"></div>\n</body>\n</html>\n');
    expect(out).not.toMatch(/<!doctype/i);
    expect(out).not.toMatch(/<\/?(html|head|body)(\s[^>]*)?>/i);
    expect(out).toContain('<title>T</title>');
    expect(out).toContain('<div id="root"></div>');
  });

  it('leaves <header> and other tags starting with head/body/html alone', () => {
    const out = toFragment('<html><body><header class="h">x</header><section><header>y</header></section><htmlish></htmlish></body></html>');
    expect(out).toContain('<header class="h">x</header>');
    expect(out).toContain('<header>y</header>');
    expect(out).toContain('<htmlish></htmlish>');
    expect(out).not.toMatch(/<\/?body/);
  });

  it('keeps </html>, <body> and <head> inside inline script and style blocks and comments', () => {
    const html =
      '<!doctype html><html><head><style>/* </head> */ a::after{content:"</body>"}</style></head><body>' +
      '<script>const s = "</html>"; const t = \'<body class="x">\'; document.write("<head>");</script>' +
      '<!-- <html> --></body></html>';
    const out = toFragment(html);
    expect(out).toContain('const s = "</html>"; const t = \'<body class="x">\'; document.write("<head>");');
    expect(out).toContain('content:"</body>"');
    expect(out).toContain('<!-- <html> -->');
    // Outside the protected blocks nothing remains.
    const outside = out.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
    expect(outside).not.toMatch(/<\/?(html|head|body)(\s[^>]*)?>/i);
    expect(outside).not.toMatch(/doctype/i);
  });

  it('is idempotent', () => {
    const once = toFragment('<!doctype html><html><head><meta charset="utf-8"></head><body><header></header></body></html>');
    expect(toFragment(once)).toBe(once);
  });
});

describe('repo hygiene for the pack', () => {
  it('.gitignore contains the line artifact/', () => {
    expect(fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8').split(/\r?\n/)).toContain('artifact/');
  });

  it('public/ holds none of _headers, .nojekyll, CNAME', () => {
    const bad = listFiles(path.join(REPO, 'public')).filter((f) => ['_headers', '.nojekyll', 'CNAME'].includes(path.basename(f)));
    expect(bad).toEqual([]);
  });

  it('package.json has the artifact:pack script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['artifact:pack']).toBe('node scripts/artifact-pack.mjs');
  });
});

describe('makeBatches', () => {
  const file = (i: number, size = 10) => ({ path: `f${String(i).padStart(4, '0')}.js`, source: `artifact/f${i}.js`, size });

  it('caps files and bytes per batch and keeps every file once', () => {
    const files = Array.from({ length: 600 }, (_, i) => file(i));
    const batches = makeBatches(files, []);
    expect(batches.length).toBe(3);
    for (const b of batches) expect(Object.keys(b).length).toBeLessThanOrEqual(250);
    expect(batches.flatMap((b) => Object.keys(b)).sort()).toEqual(files.map((f) => f.path).sort());

    const big = Array.from({ length: 5 }, (_, i) => file(i, 25_000_000));
    const byBytes = makeBatches(big, []);
    expect(byBytes.length).toBe(3);
    for (const b of byBytes) expect(Object.keys(b).length).toBeLessThanOrEqual(2);
  });

  it('puts null entries in the last batch, spilling into a new one only when full', () => {
    const batches = makeBatches([file(1), file(2)], ['gone.js']);
    expect(batches).toEqual([{ 'f0001.js': 'artifact/f1.js', 'f0002.js': 'artifact/f2.js', 'gone.js': null }]);
    const full = makeBatches(Array.from({ length: 250 }, (_, i) => file(i)), ['gone.js']);
    expect(full.length).toBe(2);
    expect(full[1]).toEqual({ 'gone.js': null });
  });

  it('returns one empty batch for nothing', () => {
    expect(makeBatches([], [])).toEqual([{}]);
  });
});

describe('probe pack', () => {
  it('is deterministic, about 3 MB gzipped, and expected.json matches the payload', () => {
    const a = makeProbePack();
    const b = makeProbePack();
    expect(a.gz.equals(b.gz)).toBe(true);
    expect(a.expected).toEqual(b.expected);
    expect(a.gz.length).toBeGreaterThan(2_900_000);
    expect(a.gz.length).toBeLessThan(3_300_000);
    const payload = zlib.gunzipSync(a.gz);
    expect(payload.length).toBe(a.expected.len);
    expect(fnv1a32(new Uint8Array(payload))).toBe(a.expected.fnv1a);
  });
});

describe('npm run artifact:pack against a real build', () => {
  let dist = '';
  const tmps: string[] = [];
  const tmp = (p: string): string => {
    const d = makeTmp(p);
    tmps.push(d);
    return d;
  };
  const run = (distDir: string, outDir: string, ...extra: string[]) =>
    spawnSync(process.execPath, [SCRIPT, `--dist=${distDir}`, `--out=${outDir}`, ...extra], { cwd: REPO, encoding: 'utf8' });
  const readBatches = (outDir: string): Record<string, string | null>[] => JSON.parse(fs.readFileSync(path.join(outDir, 'files.json'), 'utf8'));

  beforeAll(async () => {
    dist = await buildDistTo(tmp('spel-pack-dist'));
  }, 60_000);
  afterAll(() => {
    for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });
  });

  it('exits 0 on the clean build and writes a valid artifact folder', () => {
    const out = tmp('spel-pack-out');
    const r = run(dist, out);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\d+ files, 1 batch\(es\), [\d.]+ MB/);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(index).not.toMatch(/<!doctype/i);
    expect(index).not.toMatch(/<\/?(html|head|body)(\s[^>]*)?>/i);
    expect(index).toContain('<div id="root"></div>');
    const batches = readBatches(out);
    expect(Array.isArray(batches)).toBe(true);
    const published = batches.flatMap((b) => Object.keys(b));
    expect(published).not.toContain('index.html');
    expect(published).not.toContain('files.json');
    expect(published).not.toContain('checksums.txt');
    const sums = fs.readFileSync(path.join(out, 'checksums.txt'), 'utf8').trim().split('\n');
    expect(sums.length).toBe(published.length + 1);
    for (const line of sums) {
      const [hash, rel] = line.split('  ') as [string, string];
      expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(out, rel))).digest('hex')).toBe(hash);
    }
    expect(published.filter((p) => FORBIDDEN_BATCH_EXT.test(p))).toEqual([]);
    expect(published).toContain('probe.html');
    expect(published.some((p) => p.startsWith('assets/') && p.endsWith('.js'))).toBe(true);
    // dot-named files from dist/ (data/.gitkeep) are not published
    expect(published.filter((p) => p.split('/').some((s) => s.startsWith('.')))).toEqual([]);
    expect(checkLinks(out)).toEqual([]);
  });

  it('is deterministic: two runs give byte-identical output', () => {
    const hash = (outDir: string): string => {
      const h = crypto.createHash('sha256');
      for (const f of listFiles(outDir)) h.update(f).update(fs.readFileSync(path.join(outDir, f)));
      return h.digest('hex');
    };
    const a = tmp('spel-pack-a');
    const b = tmp('spel-pack-b');
    expect(run(dist, a, '--probe').status).toBe(0);
    expect(run(dist, b, '--probe').status).toBe(0);
    // files.json holds source paths that depend on the out dir name: compare everything else.
    fs.rmSync(path.join(a, 'files.json'));
    fs.rmSync(path.join(b, 'files.json'));
    expect(hash(a)).toBe(hash(b));
  });

  for (const planted of ['assets/x.glb', 'assets/noextension', 'assets/x.gz', 'assets/x.bin', 'data/world.bin.gz', 'assets/x.zip', 'assets/readme.TXT.bak']) {
    it(`exits non-zero and lists a planted dist/${planted}`, () => {
      const broken = copyDir(dist, 'spel-pack-broken');
      tmps.push(broken);
      fs.mkdirSync(path.dirname(path.join(broken, planted)), { recursive: true });
      fs.writeFileSync(path.join(broken, planted), 'planted');
      const out = tmp('spel-pack-out');
      const r = run(broken, out);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(planted);
      expect(fs.existsSync(path.join(out, 'index.html'))).toBe(false); // nothing written on error
    });
  }

  it('fails clearly when dist has no index.html', () => {
    const r = run(tmp('spel-empty'), tmp('spel-pack-out'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/npm run build/);
  });

  it('rejects an unknown container', () => {
    const r = run(dist, tmp('spel-pack-out'), '--container=zip');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown container');
  });

  it('--prev writes null in the last batch for a path that no longer exists (never for index.html or current files)', () => {
    const out = tmp('spel-pack-out');
    const first = run(dist, out);
    expect(first.status).toBe(0);
    const current = Object.keys(readBatches(out)[0] as object);
    const prev = path.join(tmp('spel-prev'), 'prev.txt');
    fs.writeFileSync(prev, ['index.html', ...current, 'assets/removed-old.js', '/old/gone.png', '', '  '].join('\n') + '\n');
    const out2 = tmp('spel-pack-out');
    const r = run(dist, out2, `--prev=${prev}`);
    expect(r.status, r.stderr).toBe(0);
    const batches = readBatches(out2);
    const last = batches[batches.length - 1] as Record<string, string | null>;
    expect(last['assets/removed-old.js']).toBeNull();
    expect(last['old/gone.png']).toBeNull();
    expect(Object.entries(last).filter(([, v]) => v === null).map(([k]) => k).sort()).toEqual(['assets/removed-old.js', 'old/gone.png']);
    expect('index.html' in last).toBe(false);
    for (const p of current) expect(batches.some((b) => typeof b[p] === 'string')).toBe(true);
  });

  it('keeps probe/ between runs without --probe', () => {
    const out = tmp('spel-pack-out');
    expect(run(dist, out, '--probe').status).toBe(0);
    expect(fs.existsSync(path.join(out, 'probe', 'pack.png'))).toBe(true);
    expect(run(dist, out).status).toBe(0);
    expect(fs.existsSync(path.join(out, 'probe', 'pack.png'))).toBe(true);
    expect(fs.statSync(path.join(out, 'probe', 'pack.png')).size).toBeGreaterThan(2_900_000);
    expect(fs.statSync(path.join(out, 'probe', 'pack.b64.txt')).size).toBeGreaterThan(3_900_000);
    const expected = JSON.parse(fs.readFileSync(path.join(out, 'probe', 'expected.json'), 'utf8')) as { len: number; fnv1a: number };
    expect(Object.keys(expected).sort()).toEqual(['fnv1a', 'len']);
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(out, 'probe', 'pack.wasm')));
    expect(raw.length).toBe(expected.len);
    const b64 = Buffer.from(fs.readFileSync(path.join(out, 'probe', 'pack.b64.txt'), 'utf8'), 'base64');
    expect(b64.equals(fs.readFileSync(path.join(out, 'probe', 'pack.png')))).toBe(true);
  });

  describe('data packs from data/manifest.json', () => {
    const payload = zlib.gzipSync(Buffer.from('hello pack '.repeat(500)));
    const withPack = (): string => {
      const d = copyDir(dist, 'spel-pack-data');
      tmps.push(d);
      fs.mkdirSync(path.join(d, 'data'), { recursive: true });
      fs.writeFileSync(path.join(d, 'data', 'world.bin.gz'), payload);
      fs.writeFileSync(path.join(d, 'data', 'manifest.json'), JSON.stringify({ world: { file: 'world.bin.gz', enc: 'raw' } }));
      fs.writeFileSync(path.join(d, 'data', 'meta.json'), '{"a":1}');
      return d;
    };

    for (const [container, file, enc] of [
      ['png', 'world.bin.png', 'raw'],
      ['wasm', 'world.bin.wasm', 'raw'],
      ['b64', 'world.bin.b64.txt', 'b64'],
    ] as const) {
      it(`--container=${container}: re-encodes the pack and rewrites the manifest`, () => {
        const out = tmp('spel-pack-out');
        const r = run(withPack(), out, `--container=${container}`);
        expect(r.status, r.stderr).toBe(0);
        const manifest = JSON.parse(fs.readFileSync(path.join(out, 'data', 'manifest.json'), 'utf8')) as Record<string, { file: string; enc: string }>;
        expect(manifest).toEqual({ world: { file, enc } });
        const bytes = fs.readFileSync(path.join(out, 'data', file));
        const decoded = enc === 'b64' ? Buffer.from(bytes.toString('utf8'), 'base64') : bytes;
        expect(decoded.equals(payload)).toBe(true);
        expect(fs.existsSync(path.join(out, 'data', 'world.bin.gz'))).toBe(false);
        expect(fs.existsSync(path.join(out, 'data', 'meta.json'))).toBe(true);
        const published = readBatches(out).flatMap((b) => Object.keys(b));
        expect(published).toContain(`data/${file}`);
        expect(published.filter((p) => FORBIDDEN_BATCH_EXT.test(p))).toEqual([]);
        expect(checkLinks(out)).toEqual([]);
      });
    }

    it('still fails for an unlisted .bin.gz next to a manifest', () => {
      const d = withPack();
      fs.writeFileSync(path.join(d, 'data', 'unlisted.bin.gz'), 'x');
      const r = run(d, tmp('spel-pack-out'));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('data/unlisted.bin.gz');
    });

    it('fails when the manifest names a missing file', () => {
      const d = withPack();
      fs.rmSync(path.join(d, 'data', 'world.bin.gz'));
      const r = run(d, tmp('spel-pack-out'));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('world');
    });

    it('fails for a pack over the 15 MB binary limit', () => {
      const d = withPack();
      fs.writeFileSync(path.join(d, 'data', 'world.bin.gz'), Buffer.alloc(15 * 1024 * 1024 + 1));
      const r = run(d, tmp('spel-pack-out'));
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/limit/);
    });
  });

  describe('link check', () => {
    it('finds a missing script, a missing css url, a missing new URL target and an absolute address', () => {
      const out = tmp('spel-links');
      expect(pack([`--dist=${dist}`, `--out=${out}`], { cwd: REPO, log: () => {} }).code).toBe(0);
      fs.writeFileSync(path.join(out, 'page.html'), '<script src="./assets/nope.js"></script><a href="/abs.html">x</a><img src="data:image/png;base64,AAAA"><a href="#top">t</a>');
      fs.writeFileSync(path.join(out, 'assets', 'plant.css'), 'a{background:url(./missing.png)} b{background:url("data:image/png;base64,AA")}');
      fs.writeFileSync(path.join(out, 'assets', 'plant.js'), 'new Worker(new URL("w-missing.js",import.meta.url));new URL(`ok.js`,import.meta.url);new URL("../probe.html",import.meta.url)');
      fs.writeFileSync(path.join(out, 'assets', 'ok.js'), '');
      const problems = checkLinks(out).join('\n');
      expect(problems).toContain('page.html: link "./assets/nope.js" does not exist');
      expect(problems).toContain('page.html: absolute address link "/abs.html"');
      expect(problems).toContain('plant.css: url() "./missing.png" does not exist');
      expect(problems).toContain('plant.js: new URL "w-missing.js" does not exist');
      expect(problems).not.toContain('ok.js');
      expect(problems).not.toContain('../probe.html');
      expect(problems).not.toContain('data:');
      expect(problems).not.toContain('#top');
    });

    it('makes the pack fail when a referenced file is missing in dist', () => {
      const d = copyDir(dist, 'spel-pack-nolink');
      tmps.push(d);
      const worker = fs.readdirSync(path.join(d, 'assets')).find((f) => f.startsWith('probe.worker'));
      expect(worker).toBeTruthy();
      fs.rmSync(path.join(d, 'assets', worker as string));
      const r = run(d, tmp('spel-pack-out'));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not exist');
    });
  });
});

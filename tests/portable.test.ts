import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO, buildDistTo, makeTmp } from './helpers/buildDist';

/** Absolute-address patterns that must never appear in the portable build (M00b step 1). */
export const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: 'src="/', re: /src="\// },
  { label: 'href="/', re: /href="\// },
  { label: 'url(/', re: /url\(\//i },
  { label: 'string literal "/data/', re: /["'`]\/data\// },
  { label: 'string literal "./data/', re: /["'`]\.\/data\// },
];

export function findForbidden(text: string): string[] {
  return FORBIDDEN.filter((f) => f.re.test(text)).map((f) => f.label);
}

function walk(dir: string, filter: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out.sort();
}

describe('the forbidden-address scanner itself', () => {
  it('flags every absolute pattern and accepts relative ones', () => {
    expect(findForbidden('<script src="/assets/a.js">')).toEqual(['src="/']);
    expect(findForbidden('<link href="/x.css">')).toEqual(['href="/']);
    expect(findForbidden('a{background:url(/x.png)}')).toEqual(['url(/']);
    expect(findForbidden('fetch("/data/manifest.json")')).toEqual(['string literal "/data/']);
    expect(findForbidden("fetch('./data/manifest.json')")).toEqual(['string literal "./data/']);
    expect(findForbidden('<script src="./assets/a.js"> fetch("data/x") url(./a.png)')).toEqual([]);
  });
});

/** Size caps in bytes of gzipped JavaScript (Fix-3C): measured plus about 5 %. Raise them only with a line in docs/DECISIONS.md. */
const JS_GZ_TOTAL_MAX = 335_000; // M12a-3: 329 471 measured (was 329 000 at Fix-3C; DECISIONS M12a-3 point 11)
const JS_GZ_MAIN_MAX = 277_000;

describe('portable build (relative addresses only)', () => {
  let dist = '';
  beforeAll(async () => {
    dist = await buildDistTo(makeTmp('spel-portable'));
  }, 60_000);
  afterAll(() => {
    if (dist) fs.rmSync(dist, { recursive: true, force: true });
  });

  it('has no absolute addresses in dist html, css and assets/*.js', () => {
    const files = [
      ...walk(dist, (p) => p.endsWith('.html') || p.endsWith('.css')),
      ...walk(path.join(dist, 'assets'), (p) => p.endsWith('.js')),
    ];
    expect(files.length).toBeGreaterThanOrEqual(4); // index.html, probe.html and at least two chunks
    const offenders: string[] = [];
    for (const f of files) {
      for (const label of findForbidden(fs.readFileSync(f, 'utf8'))) offenders.push(`${path.relative(dist, f)}: ${label}`);
    }
    expect(offenders).toEqual([]);
  });

  it('puts every chunk in assets/ (ROOT_URL relies on it)', () => {
    const js = walk(dist, (p) => p.endsWith('.js')).map((p) => path.relative(dist, p).split(path.sep)[0]);
    expect([...new Set(js)]).toEqual(['assets']);
  });

  // Fix-3C: the old acceptance "JS bundle <= 300 KB gz" was enforced by nothing and was passed long ago (311.9 kB at audit 2). The caps are
  // what was measured at Fix-3C (313 158 B total, main chunk 263 782 B, gzip level 9) plus about 5 %; see docs/DECISIONS.md "Fix-3C".
  it('keeps the gzipped JavaScript under its size caps (total and main chunk)', () => {
    const sizes = walk(path.join(dist, 'assets'), (p) => p.endsWith('.js')).map((p) => ({ name: path.basename(p), gz: gzipSync(fs.readFileSync(p), { level: 9 }).length }));
    const total = sizes.reduce((sum, f) => sum + f.gz, 0);
    const main = Math.max(...sizes.map((f) => f.gz));
    expect(main).toBeLessThanOrEqual(JS_GZ_MAIN_MAX);
    expect(total).toBeLessThanOrEqual(JS_GZ_TOTAL_MAX);
  });
});

describe('sources', () => {
  it('vite.config.ts sets base ./ and assetsDir assets', () => {
    const cfg = fs.readFileSync(path.join(REPO, 'vite.config.ts'), 'utf8');
    expect(cfg).toMatch(/base:\s*'\.\/'/);
    expect(cfg).toMatch(/assetsDir:\s*'assets'/);
  });

  it('index.html puts no attributes on <html> or <body> (they vanish in the fragment)', () => {
    const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<html\s/i);
    expect(html).not.toMatch(/<body\s/i);
  });

  it('src/ never builds data addresses by hand (only siteUrl)', () => {
    const offenders: string[] = [];
    for (const f of walk(path.join(REPO, 'src'), (p) => p.endsWith('.ts'))) {
      // Comments may name the forbidden patterns; only code counts.
      const text = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const rel = path.relative(REPO, f);
      if (/BASE_URL/.test(text)) offenders.push(`${rel}: BASE_URL`);
      if (/["'`]\.?\/data\//.test(text)) offenders.push(`${rel}: "/data/ or "./data/ literal`);
    }
    expect(offenders).toEqual([]);
  });
});

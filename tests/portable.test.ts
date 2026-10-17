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
const JS_GZ_TOTAL_MAX = 408_500; // Fix-6C [1.14]: a FIXED BUDGET NUMBER for all chunks, no longer "measured + 0.15 %"; it is not a gate that follows each slice (a player pays the first load, see JS_GZ_FIRST_LOAD_MAX; DECISIONS "Fix-6C"). Measured 408_043. Older: Round 24 merge (M14b + M13c-2): measured 407_965 (the lazy sim/host chunks grew with the interceptors, the ship UI sits in the start chunk: START headroom 4_380, see DECISIONS "Round 24 integration"). Older: // M13c-2: measured 406_263 (the ship layer, mode, box, watcher and texts: about 4.8 kB over 401_424); START headroom after it is 4_380 (docs/DECISIONS.md "M13c-2"). Before: 402_000, Round 23 merge (M14a + Bundle-diet-2): measured 401_424; the total counts the lazy chunks and both language tables, so the payback of the diet shows in the START and MAIN caps (lowered by 8_000 and 12_200), not here: see DECISIONS "Round 23 integration". Older: // Bundle-diet-2: 396_000 before; measured 397_892 (+2_575: the two tables gzip separately, 8_779 + 9_141, instead of 15_4xx inside main; the total counts the lazy chunks too, so the payback of diet step 1 shows in the START and MAIN caps below, not here; see DECISIONS "Bundle-diet-2"). Older: // Round 22 merge: 393_000 before; measured 395_288 with the ship code, the three structure models in one shared mesh and the event ring (rule of DECISIONS "Bundle diet" 3: paid back by diet step 1, the language tables, about 8.8 kB, which is the NEXT pass and must lower this cap by at least 8_000). Older: // M13c-1: 391_000 before; measured 392_934 with the ship table, the sea route, LaunchShip and the ship snapshot (rule of DECISIONS "Bundle diet" 3: paid back by diet step 1, the language tables, about 8.8 kB, in the pass "Bundle diet 1-3"). Older: 391_000 // Round 19 merge: 370_000 before; measured 372_309 with the technology rules, the federation setup and the helicopter effects, + 5 %
const JS_GZ_MAIN_MAX = 303_500; // Bundle-diet-2: 315_700 before; measured 294_681 after the two language tables left the main chunk (own chunks, import()), + 3 %. Older: // Bundle-diet-1: 321_000 before; measured 306_484 after the dev modules left the main chunk (steps 2 and 3 of the diet), + 3 %. Older notes: // M18d-2: 311_000 before; measured 311_035 with the research panel, + 3 %. M20a-2: 294_500 before, measured 296_501 with the nation labels, the front arrows and the attack-front snapshot, + 5 %. M13b: 277_000 before; measured 280_318 + 5 % (the page now carries Los, Nav, planRoute and scoreLz for the preview; before, they lived only in the sim worker)

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
    console.info(`[Fix-6C] main ${main} total ${total}`);
    expect(main).toBeLessThanOrEqual(JS_GZ_MAIN_MAX);
    expect(total).toBeLessThanOrEqual(JS_GZ_TOTAL_MAX);
  });
});

/** Bundle-diet-1: the first load (the script and the modulepreload chunks of index.html), gzip level 9, measured 348_938 + 3 %. */
const JS_GZ_START_MAX = 351_500; // Bundle-diet-2: 359_500 before; measured 341_231 (the start load no longer carries a language table; the active one is fetched at boot, about 9 kB), + 3 %
/** Fix-6C [2.0]: the first load before diet step 1 (start chunks with the language table inside). */
const JS_GZ_FIRST_LOAD_MAX = 356_583;
/** Chunks that must exist (the dynamic import() targets) and must NOT be in the first load. */
const LAZY_CHUNKS = ['devpanel', 'modes', 'perfOverlay', 'perfScene', 'spike', 'mainThreadHost', 'aiDriver', 'matchHash'];

describe('portable build: the first load stays small (Bundle-diet-1)', () => {
  let dist = '';
  beforeAll(async () => {
    dist = await buildDistTo(makeTmp('spel-portable-start'));
  }, 60_000);
  afterAll(() => {
    if (dist) fs.rmSync(dist, { recursive: true, force: true });
  });

  it('keeps the dev, diagnostic, host and AI chunks out of index.html and under the first-load cap', () => {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const start = [...html.matchAll(/assets\/([^"]+\.js)/g)].map((m) => m[1] as string);
    expect(start.length).toBeGreaterThanOrEqual(2); // the entry plus its shared chunks
    const all = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js'));
    for (const lazy of LAZY_CHUNKS) {
      expect(all.some((f) => f.startsWith(`${lazy}-`)), `${lazy} must be a chunk of its own (import())`).toBe(true);
      expect(start.some((f) => f.startsWith(`${lazy}-`)), `${lazy} must not load with the page`).toBe(false);
    }
    const gz = start.reduce((sum, f) => sum + gzipSync(fs.readFileSync(path.join(dist, 'assets', f)), { level: 9 }).length, 0);
    expect(gz).toBeLessThanOrEqual(JS_GZ_START_MAX);
    console.info(`[Fix-6C] start gz ${gz}`);
  });

  // Fix-6C [2.1]: matchSetup.ts once imported the whole AI barrel for pickSpawnCell and the first load carried about 11.8 kB of minified AI code. Property names survive
  // minification: `lastBreakAt` and `proposeAt` are fields of the AI diplomacy memory and live in the aiDriver chunk only.
  it('keeps AI-only code out of the first load (matchSetup imports ai/place, not the barrel)', () => {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const start = [...html.matchAll(/assets\/([^"]+\.js)/g)].map((m) => m[1] as string);
    const all = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js'));
    const holders = all.filter((f) => fs.readFileSync(path.join(dist, 'assets', f), 'utf8').includes('lastBreakAt'));
    expect(holders.length, 'the needle must exist somewhere (else this test proves nothing)').toBeGreaterThan(0);
    for (const needle of ['lastBreakAt', 'proposeAt']) {
      const inStart = start.filter((f) => fs.readFileSync(path.join(dist, 'assets', f), 'utf8').includes(needle));
      expect(inStart, `${needle} is AI diplomacy code and must not load with the page`).toEqual([]);
    }
  });

  // Fix-6C [2.0]: what a player downloads at the first load is the start chunks PLUS the active language table (fetched at boot), not the start chunks alone. The cap is
  // the figure before diet step 1 (356_583 B), so the diet can never be silently paid back.
  it('keeps the FIRST LOAD (start chunks plus the larger language table) under the pre-diet figure', () => {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const start = [...html.matchAll(/assets\/([^"]+\.js)/g)].map((m) => m[1] as string);
    const gzOf = (f: string): number => gzipSync(fs.readFileSync(path.join(dist, 'assets', f)), { level: 9 }).length;
    const startGz = start.reduce((sum, f) => sum + gzOf(f), 0);
    const tables = fs.readdirSync(path.join(dist, 'assets')).filter((f) => /^i18n\.(sv|en)-.*\.js$/.test(f));
    expect(tables.length).toBe(2);
    const largest = Math.max(...tables.map(gzOf));
    console.info(`[Fix-6C] first load ${startGz + largest} (start ${startGz} + table ${largest})`);
    expect(startGz + largest).toBeLessThanOrEqual(JS_GZ_FIRST_LOAD_MAX);
  });

  // Bundle-diet-2: a unique Swedish and a unique English string of the tables. Each lives in a chunk of its own (loaded by import() for the ACTIVE language only), in
  // none of the first-load chunks and in no other chunk, so the start load never carries both languages.
  it('keeps each language table in a chunk of its own, outside the first load', () => {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const start = new Set([...html.matchAll(/assets\/([^"]+\.js)/g)].map((m) => m[1] as string));
    const all = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js'));
    const holders = (needle: string): string[] => all.filter((f) => fs.readFileSync(path.join(dist, 'assets', f), 'utf8').includes(needle));
    const sv = holders('Erövra jorden');
    const en = holders('Conquer the Earth');
    expect(sv.length, 'the Swedish table is in exactly one chunk').toBe(1);
    expect(en.length, 'the English table is in exactly one chunk').toBe(1);
    expect(sv[0]).not.toBe(en[0]);
    expect(sv[0]).toMatch(/^i18n\.sv-/);
    expect(en[0]).toMatch(/^i18n\.en-/);
    expect(start.has(sv[0] as string) || start.has(en[0] as string), 'no table in the first load').toBe(false);
  });

  it('keeps the shared sim chunk in one place (not copied into the lazy host chunk)', () => {
    const files = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js'));
    expect(files.filter((f) => /^(techRules|missileRules)-/.test(f)).length).toBe(1); // M14a: rollup names the one shared sim chunk after a module in it; it was techRules, it is missileRules now
    const host = files.find((f) => f.startsWith('mainThreadHost-')) as string;
    const gz = gzipSync(fs.readFileSync(path.join(dist, 'assets', host)), { level: 9 }).length;
    expect(gz).toBeLessThanOrEqual(16_000); // M14a: 13_000 before; 14_576 measured with the missile phase, blast and snapshot (the lazy host chunk runs step); about 11.5 kB before; a duplicated sim (about 38 kB) would blow it
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

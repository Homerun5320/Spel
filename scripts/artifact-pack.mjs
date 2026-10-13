// Packs dist/ into artifact/ for publishing as a Claude Artifact (docs/PREVIEW.md has the procedure).
//
//   npm run artifact:pack -- [--container=png|wasm|b64] [--prev=<file>] [--probe] [--dist=dist] [--out=artifact]
//
// Output (all under artifact/, which is gitignored):
//   index.html   the page as a FRAGMENT (no doctype/html/head/body tags); published as `file_path`
//   <files>      every dist/ file with a served extension (data packs re-encoded, data/manifest.json rewritten)
//   files.json   a LIST of batches {"<published path>": "artifact/<path>"}; index.html is never in it
//   checksums.txt  sha256 of every published file (sha256sum format); never published itself
//   probe/       (--probe) deterministic ~3 MB test packs; kept between runs, never in public/ or dist/
// Anything that cannot be served (unknown or missing extension, .gz, .bin, .glb that is not a data pack in
// data/manifest.json) makes the script exit with an error that lists the paths. Nothing is skipped silently.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Extensions the Artifact serves (lower case, with the dot). */
export const ALLOWED_EXT = new Set([
  '.html', '.css', '.js', '.mjs', '.wasm', '.json', '.map', '.geojson', '.webmanifest', '.txt', '.md', '.csv', '.xml',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav',
  '.ogg', '.mp4', '.webm', '.pdf',
]);

/** Text types count against the 16 MB text limit, everything else against the 15 MB binary limit. */
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.map', '.geojson', '.webmanifest', '.txt', '.md', '.csv', '.xml', '.svg']);

export const LIMITS = {
  textFileBytes: 16 * 1024 * 1024,
  binaryFileBytes: 15 * 1024 * 1024,
  /** Our own batch caps (the tool allows 255 files / 64 MB per publish). */
  batchFiles: 250,
  batchBytes: 60_000_000,
  artifactFiles: 511,
  artifactBytes: 256 * 1024 * 1024,
};

export const CONTAINERS = {
  png: { ext: '.png', enc: 'raw' },
  wasm: { ext: '.wasm', enc: 'raw' },
  b64: { ext: '.b64.txt', enc: 'b64' },
};

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..');

// ---------------------------------------------------------------------------------------------
// index.html as a fragment
// ---------------------------------------------------------------------------------------------

/**
 * Turns a full HTML document into a fragment: removes `<!doctype ...>` and the html, head and body tags (and
 * their attributes). Script/style blocks and comments are masked first so that strings such as '</html>' inside
 * an inline script survive. The tag regexp requires whitespace or `>` after the name, so `<header>` is safe.
 * No HTML parser.
 */
export function toFragment(html) {
  if (/[\uE000\uE001]/.test(html)) throw new Error('index.html contains a private-use placeholder character');
  const blocks = [];
  const masked = html.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>/gi, (block) => {
    blocks.push(block);
    return `\uE000${blocks.length - 1}\uE001`;
  });
  const stripped = masked.replace(/<!doctype[^>]*>/gi, '').replace(/<\/?(html|head|body)(\s[^>]*)?>/gi, '');
  const restored = stripped.replace(/\uE000(\d+)\uE001/g, (_, i) => blocks[Number(i)]);
  return restored.replace(/^\s+/, '').replace(/\s+$/, '') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export function fnv1a32(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** All files below `dir` as sorted posix paths relative to `dir`. */
export function listFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) out.push(next);
    }
  };
  if (fs.existsSync(dir)) walk('');
  return out.sort();
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseArgs(argv) {
  const opts = { container: 'png', prev: null, probe: false, dist: 'dist', out: 'artifact' };
  const errors = [];
  for (const arg of argv) {
    let m;
    if (arg === '--probe') opts.probe = true;
    else if ((m = /^--container=(.*)$/.exec(arg))) {
      if (m[1] in CONTAINERS) opts.container = m[1];
      else errors.push(`unknown container "${m[1]}" (use png, wasm or b64)`);
    } else if ((m = /^--prev=(.+)$/.exec(arg))) opts.prev = m[1];
    else if ((m = /^--dist=(.+)$/.exec(arg))) opts.dist = m[1];
    else if ((m = /^--out=(.+)$/.exec(arg))) opts.out = m[1];
    else errors.push(`unknown argument "${arg}"`);
  }
  return { opts, errors };
}

// ---------------------------------------------------------------------------------------------
// Probe packs
// ---------------------------------------------------------------------------------------------

/** Deterministic test payload (seeded PRNG, 3 000 000 random bytes), gzipped (~3 MB, incompressible on purpose). */
export function makeProbePack() {
  const rand = mulberry32(0x5eed1234);
  const payload = Buffer.alloc(3_000_000);
  for (let i = 0; i < payload.length; i++) payload[i] = Math.floor(rand() * 256);
  const gz = zlib.gzipSync(payload, { level: 9 });
  return { gz, expected: { len: payload.length, fnv1a: fnv1a32(payload) } };
}

function writeProbe(outDir) {
  const dir = path.join(outDir, 'probe');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const { gz, expected } = makeProbePack();
  fs.writeFileSync(path.join(dir, 'pack.png'), gz);
  fs.writeFileSync(path.join(dir, 'pack.wasm'), gz);
  fs.writeFileSync(path.join(dir, 'pack.b64.txt'), gz.toString('base64'));
  fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(expected) + '\n');
  return expected;
}

// ---------------------------------------------------------------------------------------------
// Link check
// ---------------------------------------------------------------------------------------------

const SKIP_REF = /^(data:|#|[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Reads artifact/**\/*.html (src/href), artifact/**\/*.css (url()) and the string literals
 * `new URL("...", import.meta.url)` in artifact/**\/*.js and requires that every relative target exists inside
 * the artifact folder. Also checks that every file named in data/manifest.json exists. Returns the problems.
 */
export function checkLinks(outDir) {
  const problems = [];
  const root = path.resolve(outDir);
  const check = (from, ref, kind) => {
    if (ref === '' || SKIP_REF.test(ref)) return;
    if (ref.startsWith('/')) {
      problems.push(`${from}: absolute address ${kind} "${ref}"`);
      return;
    }
    const clean = ref.replace(/[?#].*$/, '');
    if (clean === '') return;
    let decoded = clean;
    try {
      decoded = decodeURI(clean);
    } catch {
      /* keep the raw text */
    }
    const target = path.resolve(root, path.dirname(from), decoded);
    if (target !== root && !target.startsWith(root + path.sep)) {
      problems.push(`${from}: ${kind} "${ref}" points outside the artifact folder`);
    } else if (!fs.existsSync(target)) {
      problems.push(`${from}: ${kind} "${ref}" does not exist in the artifact folder`);
    }
  };
  for (const rel of listFiles(root)) {
    const ext = path.extname(rel).toLowerCase();
    if (ext !== '.html' && ext !== '.css' && ext !== '.js' && ext !== '.mjs') continue;
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    if (ext === '.html') {
      const noComments = text.replace(/<!--[\s\S]*?-->/g, '');
      for (const m of noComments.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)) check(rel, m[2], 'link');
    } else if (ext === '.css') {
      for (const m of text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) check(rel, m[2], 'url()');
    } else {
      for (const m of text.matchAll(/new URL\(\s*(["'`])([^"'`]*?)\1\s*,\s*import\.meta\.url\s*\)/g)) {
        if (m[2].includes('${')) continue;
        check(rel, m[2], 'new URL');
      }
    }
  }
  const manifestPath = path.join(root, 'data', 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const [name, entry] of Object.entries(manifest)) {
        const file = entry && typeof entry === 'object' ? entry.file : undefined;
        if (typeof file !== 'string' || !fs.existsSync(path.join(root, 'data', file))) {
          problems.push(`data/manifest.json: pack "${name}" points to a missing file "${String(file)}"`);
        }
      }
    } catch (err) {
      problems.push(`data/manifest.json: not valid JSON (${String(err)})`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------------------------

/**
 * Splits the published files into batches (a LIST of maps {published path: source path}) with at most
 * `maxFiles` files and `maxBytes` bytes each. `removed` paths are appended as `null` to the LAST batch
 * (overflow goes into extra batches). `files` = [{path, source, size}].
 */
export function makeBatches(files, removed, maxFiles = LIMITS.batchFiles, maxBytes = LIMITS.batchBytes) {
  const batches = [];
  let current = {};
  let count = 0;
  let bytes = 0;
  const flush = () => {
    if (count > 0) batches.push(current);
    current = {};
    count = 0;
    bytes = 0;
  };
  for (const f of files) {
    if (count > 0 && (count + 1 > maxFiles || bytes + f.size > maxBytes)) flush();
    current[f.path] = f.source;
    count++;
    bytes += f.size;
  }
  if (count === 0 && removed.length === 0) return [{}];
  for (const r of removed) {
    if (count + 1 > maxFiles) flush();
    current[r] = null;
    count++;
  }
  flush();
  return batches;
}

export function readPrev(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const paths = new Set();
  for (const line of lines) {
    const p = line.trim().replace(/^\/+/, '');
    if (p !== '' && p !== 'index.html') paths.add(p);
  }
  return paths;
}

// ---------------------------------------------------------------------------------------------
// Main pack
// ---------------------------------------------------------------------------------------------

function packName(file, container) {
  return file.replace(/\.gz$/i, '') + CONTAINERS[container].ext;
}

/** Reads data/manifest.json of dist (if any) and returns {packs: Map(rel dist path -> {name, file})} or errors. */
function readManifest(distDir, errors) {
  const manifestPath = path.join(distDir, 'data', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    errors.push(`dist/data/manifest.json is not valid JSON: ${String(err)}`);
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('dist/data/manifest.json must be an object {name: {file, enc}}');
    return null;
  }
  const entries = [];
  for (const [name, value] of Object.entries(raw)) {
    const file = typeof value === 'string' ? value : value && typeof value === 'object' ? value.file : undefined;
    if (typeof file !== 'string' || file === '') {
      errors.push(`dist/data/manifest.json: pack "${name}" has no "file"`);
      continue;
    }
    const rel = path.posix.normalize(`data/${file}`);
    if (rel.startsWith('..') || !fs.existsSync(path.join(distDir, rel))) {
      errors.push(`dist/data/manifest.json: pack "${name}" points to a missing file "${rel}"`);
      continue;
    }
    entries.push({ name, file, rel });
  }
  return entries;
}

/**
 * Runs the pack. Returns {code, errors, files, batches, bytes, ...}; the CLI prints and exits with `code`.
 * `cwd` is the base for relative paths (default: process.cwd(); npm scripts run in the repo root).
 */
export function pack(argv = [], { cwd = process.cwd(), log = console.log } = {}) {
  const { opts, errors } = parseArgs(argv);
  if (errors.length > 0) return { code: 1, errors };
  const distDir = path.resolve(cwd, opts.dist);
  const outDir = path.resolve(cwd, opts.out);
  const container = opts.container;

  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    return { code: 1, errors: [`${opts.dist}/index.html is missing: run "npm run build" first`] };
  }

  const manifestEntries = readManifest(distDir, errors);
  const packByRel = new Map();
  for (const e of manifestEntries ?? []) packByRel.set(e.rel, e);

  // 1. Classify every dist file. Nothing is skipped silently: unsupported files are collected as errors,
  //    dot-named files (.gitkeep, .nojekyll, ...) are counted and reported.
  const planned = []; // {path, bytes}
  const dotFiles = [];
  const unsupported = [];
  const outputNames = new Map();
  const plan = (publishedPath, bytes) => {
    if (outputNames.has(publishedPath)) {
      errors.push(`two sources produce the same published path "${publishedPath}"`);
      return;
    }
    outputNames.set(publishedPath, true);
    planned.push({ path: publishedPath, bytes });
  };
  const distFiles = listFiles(distDir);
  for (const rel of distFiles) {
    if (rel.split('/').some((seg) => seg.startsWith('.'))) {
      dotFiles.push(rel);
      continue;
    }
    if (rel === 'data/manifest.json' && manifestEntries) continue; // rewritten below
    if (packByRel.has(rel)) continue; // converted below
    const ext = path.extname(rel).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      unsupported.push(rel);
      continue;
    }
    if (rel === 'index.html') {
      plan(rel, Buffer.from(toFragment(fs.readFileSync(path.join(distDir, rel), 'utf8'))));
    } else {
      plan(rel, fs.readFileSync(path.join(distDir, rel)));
    }
  }
  if (unsupported.length > 0) {
    errors.push(
      `these dist files cannot be served by an Artifact and are not data packs in data/manifest.json (${unsupported.length}):\n  - ${unsupported.join('\n  - ')}`,
    );
  }

  // 2. Data packs in the chosen container, plus the rewritten manifest.
  const newManifest = {};
  const converted = [];
  for (const e of manifestEntries ?? []) {
    const bytes = fs.readFileSync(path.join(distDir, e.rel));
    const outFile = packName(e.file, container);
    const outRel = `data/${outFile}`;
    const payload = CONTAINERS[container].enc === 'b64' ? Buffer.from(bytes.toString('base64')) : bytes;
    plan(outRel, payload);
    newManifest[e.name] = { file: outFile, enc: CONTAINERS[container].enc };
    converted.push(`${e.rel} -> ${outRel}`);
  }
  if (manifestEntries) plan('data/manifest.json', Buffer.from(JSON.stringify(newManifest, null, 2) + '\n'));

  // 3. Size limits.
  for (const p of planned) {
    const ext = path.extname(p.path).toLowerCase();
    const limit = TEXT_EXT.has(ext) ? LIMITS.textFileBytes : LIMITS.binaryFileBytes;
    if (p.bytes.length > limit) {
      errors.push(`${p.path} is ${p.bytes.length} bytes, over the ${limit} byte limit for ${TEXT_EXT.has(ext) ? 'text' : 'binary'} files`);
    }
  }
  if (errors.length > 0) return { code: 1, errors };

  // 4. Write artifact/ (everything but probe/ is regenerated; probe/ is regenerated with --probe, otherwise kept).
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(outDir)) {
    if (entry === 'probe' && !opts.probe) continue;
    fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  }
  for (const p of planned) {
    const target = path.join(outDir, p.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, p.bytes);
  }
  if (opts.probe) writeProbe(outDir);

  // 5. Published file list (index.html and files.json excluded), batches, --prev.
  const published = [];
  const outRelDir = toPosix(path.relative(cwd, outDir)) || '.';
  for (const rel of listFiles(outDir)) {
    if (rel === 'index.html' || rel === 'files.json' || rel === 'checksums.txt') continue;
    const ext = path.extname(rel).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      errors.push(`internal error: ${rel} has no served extension`);
      continue;
    }
    published.push({ path: rel, source: `${outRelDir}/${rel}`, size: fs.statSync(path.join(outDir, rel)).size });
  }
  const allPaths = new Set(published.map((f) => f.path));
  allPaths.add('index.html');
  let removed = [];
  if (opts.prev) {
    const prevPath = path.resolve(cwd, opts.prev);
    if (!fs.existsSync(prevPath)) return { code: 1, errors: [`--prev file not found: ${opts.prev}`] };
    removed = [...readPrev(prevPath)].filter((p) => !allPaths.has(p)).sort();
  }
  const batches = makeBatches(published, removed);
  fs.writeFileSync(path.join(outDir, 'files.json'), JSON.stringify(batches, null, 2) + '\n');

  const sums = ['index.html', ...published.map((f) => f.path)].map(
    (rel) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, rel))).digest('hex')}  ${rel}`,
  );
  fs.writeFileSync(path.join(outDir, 'checksums.txt'), sums.join('\n') + '\n');

  const fileCount = published.length + 1;
  const totalBytes = published.reduce((n, f) => n + f.size, 0) + fs.statSync(path.join(outDir, 'index.html')).size;
  if (fileCount > LIMITS.artifactFiles) errors.push(`${fileCount} files exceed the Artifact limit of ${LIMITS.artifactFiles}`);
  if (totalBytes > LIMITS.artifactBytes) errors.push(`${totalBytes} bytes exceed the Artifact limit of ${LIMITS.artifactBytes}`);

  // 6. Link check.
  errors.push(...checkLinks(outDir));

  log(`artifact:pack container=${container}`);
  for (const c of converted) log(`  pack ${c}`);
  if (dotFiles.length > 0) log(`  not published (dot-named): ${dotFiles.join(', ')}`);
  if (removed.length > 0) log(`  removed since last publish (null): ${removed.join(', ')}`);
  log(`  ${fileCount} files, ${batches.length} batch(es), ${(totalBytes / 1_000_000).toFixed(2)} MB -> ${outRelDir}/ (see ${outRelDir}/files.json and checksums.txt)`);
  return { code: errors.length > 0 ? 1 : 0, errors, files: fileCount, batches: batches.length, bytes: totalBytes, removed, converted };
}

export function main(argv = process.argv.slice(2)) {
  const result = pack(argv);
  if (result.errors.length > 0) {
    console.error(`artifact:pack FAILED:\n${result.errors.map((e) => `- ${e}`).join('\n')}`);
  }
  return result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

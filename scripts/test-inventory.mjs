// Test inventory: every test name per file of a finished run (vitest JSON reports) plus a static count of `expect(` calls per file.
//
//   node scripts/test-inventory.mjs --out inventory.json report1.json [report2.json ...]   writes the inventory of vitest JSON reports
//   node scripts/test-inventory.mjs --compare before.json after.json                        exits 1 if a test name or an assertion count was lost
//
// Used by the TestSpeed pass (docs/DECISIONS.md D144): after reorganising the e2e files, no test case may disappear
// (a case may be renamed only together with a note in the report) and no file may lose `expect(` calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Counts `expect(` and `expect.` call sites in a source text (a static proxy for the number of assertions). */
export function countExpects(source) {
  const matches = source.match(/\bexpect(?:\.soft|\.poll)?\s*\(/g);
  return matches ? matches.length : 0;
}

/** Report paths are absolute and may come from another checkout: keep everything from the first e2e/, tests/ or tools/ folder on. */
function repoRelative(name, root) {
  const posix = name.split(path.sep).join('/');
  const m = posix.match(/\/((?:e2e|tests|tools)\/.*)$/);
  return m ? m[1] : path.relative(root, name).split(path.sep).join('/');
}

/**
 * Inventory of a finished run: `reports` are vitest JSON reports (`--reporter=json --outputFile.json=...`). Test names come
 * from the run itself, not from `vitest list`, because loops and async collection make the static list differ from what runs.
 */
export function inventoryFromReports(reports, root = REPO_ROOT) {
  const files = {};
  for (const report of reports) {
    for (const f of report.testResults) {
      const rel = repoRelative(f.name, root);
      files[rel] ??= { tests: [], expects: 0 };
      for (const t of f.assertionResults) files[rel].tests.push(t.fullName ?? t.title);
    }
  }
  for (const rel of Object.keys(files)) {
    files[rel].tests.sort();
    const abs = path.join(root, rel);
    files[rel].expects = fs.existsSync(abs) ? countExpects(fs.readFileSync(abs, 'utf8')) : 0;
  }
  return files;
}

/**
 * Pure comparison used by the unit test. A test whose name is gone from its file but present in another file counts as
 * moved (reported, not a loss). Returns { missing, countDrops, expectDrops, added, moved } (all arrays of text lines).
 * Per-file `expect(` counts must not drop unless the file lost tests by moving them; the grand total must never drop.
 */
export function compareInventories(before, after) {
  const missing = [];
  const countDrops = [];
  const expectDrops = [];
  const added = [];
  const moved = [];
  const where = new Map();
  for (const [file, a] of Object.entries(after)) for (const name of a.tests) where.set(name, file);
  for (const [file, b] of Object.entries(before)) {
    const a = after[file];
    let movedOut = 0;
    for (const name of b.tests) {
      if (a?.tests.includes(name)) continue;
      const elsewhere = where.get(name);
      if (elsewhere !== undefined) {
        moved.push(`${file} -> ${elsewhere}: ${name}`);
        movedOut++;
      } else missing.push(`${file}: ${name}`);
    }
    if (!a) continue;
    if (a.tests.length < b.tests.length - movedOut) countDrops.push(`${file}: ${b.tests.length} -> ${a.tests.length} test cases`);
    if (a.expects < b.expects && movedOut === 0) expectDrops.push(`${file}: ${b.expects} -> ${a.expects} expect() calls`);
  }
  for (const [file, a] of Object.entries(after)) {
    const b = before[file];
    if (!b) added.push(`${file}: new file (${a.tests.length} tests)`);
    else for (const name of a.tests) if (!b.tests.includes(name) && !moved.some((m) => m.endsWith(`: ${name}`))) added.push(`${file}: ${name}`);
  }
  const tb = totals(before);
  const ta = totals(after);
  if (ta.expects < tb.expects) expectDrops.push(`TOTAL: ${tb.expects} -> ${ta.expects} expect() calls`);
  return { missing, countDrops, expectDrops, added, moved };
}

function totals(inv) {
  let tests = 0;
  let expects = 0;
  for (const f of Object.values(inv)) {
    tests += f.tests.length;
    expects += f.expects;
  }
  return { files: Object.keys(inv).length, tests, expects };
}

function main(argv) {
  const iOut = argv.indexOf('--out');
  const iCmp = argv.indexOf('--compare');
  if (iOut >= 0) {
    const reports = argv.slice(iOut + 2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
    const inv = inventoryFromReports(reports);
    fs.writeFileSync(argv[iOut + 1], `${JSON.stringify(inv, null, 1)}\n`);
    const t = totals(inv);
    console.log(`[inventory] ${t.files} files, ${t.tests} test cases, ${t.expects} expect() calls -> ${argv[iOut + 1]}`);
    return 0;
  }
  if (iCmp >= 0) {
    const before = JSON.parse(fs.readFileSync(argv[iCmp + 1], 'utf8'));
    const after = JSON.parse(fs.readFileSync(argv[iCmp + 2], 'utf8'));
    const r = compareInventories(before, after);
    const tb = totals(before);
    const ta = totals(after);
    console.log(`[inventory] before: ${tb.files} files, ${tb.tests} cases, ${tb.expects} expect(); after: ${ta.files} files, ${ta.tests} cases, ${ta.expects} expect()`);
    for (const k of ['moved', 'added', 'missing', 'countDrops', 'expectDrops']) {
      for (const line of r[k]) console.log(`[inventory] ${k}: ${line}`);
    }
    const bad = r.missing.length + r.countDrops.length + r.expectDrops.length;
    console.log(bad === 0 ? '[inventory] OK: nothing lost' : `[inventory] FAILED: ${bad} losses`);
    return bad === 0 ? 0 : 1;
  }
  console.error('usage: node scripts/test-inventory.mjs --out file.json report.json... | --compare before.json after.json');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}

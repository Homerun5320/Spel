// `npm run verify`, `npm run verify:fast` and `npm run verify:local`: the stages of the verification as plain Node (no bash, so the
// same on Windows, macOS and Linux), with a timing table at the end.
//
//   node scripts/verify.mjs            typecheck, lint and unit in parallel, then perf, e2e, e2e-serial; stops at the first failing step
//   node scripts/verify.mjs --fast     typecheck, lint and unit in parallel (the inner loop)
//   node scripts/verify.mjs --shard 2/3  the unit, e2e and e2e-serial test files of the second third only (vitest's --shard; for CI machines that
//                                      run the thirds side by side; typecheck, lint and perf run in every shard, perf is not split)
//   node scripts/verify.mjs --local    everything on a machine with a real GPU (LOCAL_GPU=1, docs/LOCAL.md): a browser/GPU check first,
//                                      every stage runs even after a failure, test-results/local-report.txt is written
//
// Isolation rules (docs/DECISIONS.md D144): typecheck, lint and unit are CPU-only and run side by side; perf starts only when they are
// done and nothing else runs; the e2e project runs a few Chromium instances side by side (vitest.config.ts); the e2e-serial project
// (heap, leak and wall-clock budget tests) starts after it and runs one file at a time. No stage starts while a Chromium of another stage runs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { e2eWorkerCount } from './localGpu.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO_ROOT, 'test-results');
const bin = (...p) => path.join(REPO_ROOT, 'node_modules', ...p);

/**
 * The stages as groups: the stages of a group run side by side, the groups run one after the other.
 * `browser` stages need the browser from the gpu check in local mode.
 */
export function stageGroups({ fast = false, local = false, shard = null } = {}) {
  const vitest = (project, extra = [], sharded = false) => [bin('vitest', 'vitest.mjs'), 'run', '--project', project, ...extra, ...(sharded && shard !== null ? ['--shard', shard] : [])];
  const cpu = [
    { name: 'typecheck', title: 'typecheck', args: [bin('typescript', 'bin', 'tsc'), '--noEmit'] },
    { name: 'lint', title: 'lint', args: [bin('eslint', 'bin', 'eslint.js'), '.'] },
    { name: 'unit', title: 'unit tests', args: vitest('unit', [], true) },
  ];
  const groups = [];
  if (local) groups.push([{ name: 'gpu', title: 'browser and GPU check (one screenshot)', args: [path.join(REPO_ROOT, 'scripts', 'shot.mjs')], fatal: true }]);
  groups.push(cpu);
  if (fast) return groups;
  groups.push([{ name: 'perf', title: 'perf tests (CPU budgets through perfguard, one at a time)', args: vitest('perf', ['--passWithNoTests']) }]);
  groups.push([{ name: 'e2e', title: 'e2e tests (browser, a few files at a time)', args: vitest('e2e', ['--reporter=default', '--reporter=json', `--outputFile.json=${path.join(OUT, 'verify-e2e-times.json')}`], true), browser: true, timesFile: path.join(OUT, 'verify-e2e-times.json') }]);
  groups.push([{ name: 'e2e-serial', title: 'e2e tests that measure memory and time (browser, one at a time)', args: vitest('e2e-serial', [], true), browser: true }]);
  return groups;
}

/**
 * The slowest test files of a vitest JSON report as text lines (what the e2e stage prints after it: the per-file times that the budget
 * discussion of D153, D154 (8) and D156 is about). `json` is the parsed report; a file's time is the sum of its tests.
 */
export function slowestFiles(json, n = 8) {
  const rows = (json?.testResults ?? []).map((f) => ({
    name: String(f.name).split(/[\\/]/).slice(-2).join('/'),
    s: (f.assertionResults ?? []).reduce((a, t) => a + (t.duration ?? 0), 0) / 1000,
    tests: (f.assertionResults ?? []).length,
  }));
  rows.sort((a, b) => b.s - a.s);
  const total = rows.reduce((a, r) => a + r.s, 0);
  return [`test time by file (sum ${formatDuration(total * 1000)} over ${rows.length} files; the wall time is about a third of it with 3 workers), slowest first:`, ...rows.slice(0, n).map((r) => `  ${r.s.toFixed(0).padStart(4)} s  ${r.name} (${r.tests} tests)`)];
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

/** The text table of a finished run. `results`: [{ title, status: 'PASS'|'FAIL'|'SKIPPED', ms }]. */
export function formatSummary(results, totalMs) {
  const width = Math.max(...results.map((r) => r.title.length));
  const lines = results.map((r) => `${r.status.padEnd(8)} ${r.title.padEnd(width)}  ${r.status === 'SKIPPED' ? '-' : formatDuration(r.ms)}`);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  lines.push('', `wall time ${formatDuration(totalMs)}`);
  lines.push(failed === 0 ? 'RESULT: ALL STAGES PASSED' : `RESULT: ${failed} STAGE(S) FAILED (see the logs in test-results/)`);
  return lines.join('\n');
}

function runStage(stage, env, { live }) {
  fs.mkdirSync(OUT, { recursive: true });
  const logPath = path.join(OUT, `verify-${stage.name}.log`);
  const log = fs.createWriteStream(logPath);
  const t0 = Date.now();
  const chunks = [];
  return new Promise((resolve) => {
    const finish = (ok) => log.end(() => resolve({ ok, ms: Date.now() - t0, logPath, output: Buffer.concat(chunks) }));
    const child = spawn(process.execPath, stage.args, { cwd: REPO_ROOT, env, stdio: ['inherit', 'pipe', 'pipe'] });
    const tee = (chunk, stream) => {
      log.write(chunk);
      if (live) stream.write(chunk);
      else chunks.push(chunk);
    };
    child.stdout.on('data', (c) => tee(c, process.stdout));
    child.stderr.on('data', (c) => tee(c, process.stderr));
    child.on('error', (err) => {
      log.write(`spawn error: ${err.message}\n`);
      finish(false);
    });
    child.on('close', (code) => finish(code === 0));
  });
}

/** `--shard i/n` or `--shard=i/n` -> 'i/n' (1 <= i <= n); null without the flag. Throws on anything else so a typo does not run everything. */
export function shardOf(argv) {
  const i = argv.findIndex((a) => a === '--shard' || a.startsWith('--shard='));
  if (i < 0) return null;
  const value = argv[i] === '--shard' ? argv[i + 1] : argv[i].slice('--shard='.length);
  const m = /^(\d+)\/(\d+)$/.exec(value ?? '');
  if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) throw new Error(`--shard needs i/n with 1 <= i <= n, got ${JSON.stringify(value)}`);
  return value;
}

/** The slowest-files text of a stage's JSON report file; empty when the file is missing or unreadable. */
function timesReport(file) {
  try {
    return slowestFiles(JSON.parse(fs.readFileSync(file, 'utf8'))).join('\n');
  } catch {
    return '';
  }
}

function readLog(name) {
  try {
    return fs.readFileSync(path.join(OUT, `verify-${name}.log`), 'utf8');
  } catch {
    return '';
  }
}

/**
 * `deps` lets the unit test run the stage loop without spawning real stages: `runStage(stage, env, { live })` resolves
 * `{ ok, ms, logPath, output }`, `writeLocalReport(summary, workers, cores)` replaces the file write.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const run = deps.runStage ?? runStage;
  const report = deps.writeLocalReport ?? writeLocalReport;
  const local = argv.includes('--local');
  const fast = argv.includes('--fast');
  const shard = shardOf(argv);
  const env = { ...process.env };
  const cores = os.availableParallelism();
  if (local) {
    env.LOCAL_GPU = '1';
    if (env.GOLDEN_COMPARE !== 'fail') env.GOLDEN_COMPARE = 'warn';
  }
  const workers = e2eWorkerCount(env, cores, Math.max(1, Math.min(3, cores - 1))); // the same default as vitest.config.ts
  env.E2E_WORKERS = String(workers);
  console.log(`[verify] ${local ? 'LOCAL_GPU=1 GOLDEN_COMPARE=' + env.GOLDEN_COMPARE + ' ' : ''}e2e workers=${workers} (${cores} cores)`);

  const t0 = Date.now();
  const results = [];
  let browserOk = true;
  let stop = false;
  for (const group of stageGroups({ fast, local, shard })) {
    if (stop) break;
    const runnable = group.filter((s) => !(s.browser && !browserOk));
    for (const s of group) if (!runnable.includes(s)) results.push({ title: s.title, status: 'SKIPPED', ms: 0, name: s.name });
    const live = runnable.length === 1;
    console.log(`\n=== ${runnable.map((s) => s.title).join(' + ')} ===`);
    const done = await Promise.all(runnable.map((s) => run(s, env, { live })));
    runnable.forEach((s, i) => {
      const r = done[i];
      if (!live) {
        console.log(`--- ${s.title}: ${r.ok ? 'PASS' : 'FAIL'} (${formatDuration(r.ms)}) ---`);
        if (!r.ok) process.stdout.write(r.output);
        else process.stdout.write(tailLines(r.output.toString('utf8'), 6));
      }
      if (s.timesFile) console.log(timesReport(s.timesFile));
      results.push({ title: s.title, status: r.ok ? 'PASS' : 'FAIL', ms: r.ms, name: s.name });
      if (!r.ok && s.fatal) browserOk = false;
    });
    if (!local && done.some((r) => !r.ok)) stop = true; // verify stops at the first failing group; verify:local runs everything
  }

  const summary = formatSummary(results, Date.now() - t0);
  console.log(`\n${summary}`);
  if (local) report(summary, workers, cores);
  process.exitCode = results.some((r) => r.status === 'FAIL') ? 1 : 0;
}

function tailLines(text, n) {
  const lines = text.trimEnd().split('\n');
  return `${lines.slice(-n).join('\n')}\n`;
}

function writeLocalReport(summary, workers, cores) {
  const gpuLog = readLog('gpu');
  const rendererLine = gpuLog.split('\n').find((l) => l.startsWith('[shot] renderer:')) ?? '[shot] renderer: (not available: the GPU check failed)';
  const softwareGl = /swiftshader|llvmpipe|software/i.test(rendererLine);
  const perfLines = readLog('perf')
    .split('\n')
    .filter((l) => l.startsWith('[') && /perfguard|perf\]|median|p95|p99|budget/i.test(l))
    .slice(0, 80);
  const slow = readLog('e2e')
    .split('\n')
    .filter((l) => l.startsWith('[guard] slow'))
    .slice(0, 20);
  const report = [
    `verify:local report ${new Date().toISOString()}`,
    `node ${process.version} on ${os.platform()} ${os.release()} (${os.arch()}), ${cores} cores, ${os.cpus()[0]?.model ?? 'unknown CPU'}`,
    rendererLine,
    softwareGl ? 'WARNING: the browser used a SOFTWARE renderer, not the GPU. Install Chrome or Edge, or set CHROME_PATH (docs/LOCAL.md).' : 'The browser reports a hardware renderer.',
    `e2e workers ${workers}; golden image comparison: warn only (the goldens are SwiftShader renders)`,
    '',
    summary,
    '',
    'Perf lines (budgets go through perfguard):',
    ...perfLines,
    '',
    'Slow browser calls (more than half of the 20 s hang guard):',
    ...(slow.length > 0 ? slow : ['(none)']),
    '',
  ].join('\n');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'local-report.txt'), report);
  console.log('Report saved in test-results/local-report.txt');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

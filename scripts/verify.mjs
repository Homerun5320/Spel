// `npm run verify`, `npm run verify:fast` and `npm run verify:local`: the stages of the verification as plain Node (no bash, so the
// same on Windows, macOS and Linux), with a timing table at the end.
//
//   node scripts/verify.mjs            typecheck, lint and unit in parallel, then perf, e2e, e2e-serial; stops at the first failing step
//   node scripts/verify.mjs --fast     typecheck, lint and unit in parallel (the inner loop)
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
export function stageGroups({ fast = false, local = false } = {}) {
  const vitest = (project, extra = []) => [bin('vitest', 'vitest.mjs'), 'run', '--project', project, ...extra];
  const cpu = [
    { name: 'typecheck', title: 'typecheck', args: [bin('typescript', 'bin', 'tsc'), '--noEmit'] },
    { name: 'lint', title: 'lint', args: [bin('eslint', 'bin', 'eslint.js'), '.'] },
    { name: 'unit', title: 'unit tests', args: vitest('unit') },
  ];
  const groups = [];
  if (local) groups.push([{ name: 'gpu', title: 'browser and GPU check (one screenshot)', args: [path.join(REPO_ROOT, 'scripts', 'shot.mjs')], fatal: true }]);
  groups.push(cpu);
  if (fast) return groups;
  groups.push([{ name: 'perf', title: 'perf tests (CPU budgets through perfguard, one at a time)', args: vitest('perf', ['--passWithNoTests']) }]);
  groups.push([{ name: 'e2e', title: 'e2e tests (browser, a few files at a time)', args: vitest('e2e'), browser: true }]);
  groups.push([{ name: 'e2e-serial', title: 'e2e tests that measure memory and time (browser, one at a time)', args: vitest('e2e-serial'), browser: true }]);
  return groups;
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
  for (const group of stageGroups({ fast, local })) {
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

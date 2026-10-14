// `npm run verify:local`: the whole verification on a desktop PC with a real GPU (docs/LOCAL.md). Plain Node, no bash.
//
// Same stages as `npm run verify`, but with LOCAL_GPU=1 (no SwiftShader switches, the machine's GPU, an installed Chrome / Edge
// or Playwright's browser) and GOLDEN_COMPARE=warn (the committed goldens are SwiftShader renders; the pixel rules still assert).
// Prints one table at the end and writes test-results/local-report.txt, the file to send back after a run.
// Every stage runs even if an earlier one failed, so one run shows everything that is wrong.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { e2eWorkerCount, isLocalGpu } from './localGpu.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO_ROOT, 'test-results');
const bin = (...p) => path.join(REPO_ROOT, 'node_modules', ...p);

/** The stages in order. `fatal`: when it fails the browser stages cannot run, so they are skipped. */
export function stages() {
  const vitest = (project, extra = []) => [bin('vitest', 'vitest.mjs'), 'run', '--project', project, ...extra];
  return [
    { name: 'gpu', title: 'browser and GPU check (one screenshot)', args: [path.join(REPO_ROOT, 'scripts', 'shot.mjs')], fatal: true },
    { name: 'typecheck', title: 'typecheck', args: [bin('typescript', 'bin', 'tsc'), '--noEmit'] },
    { name: 'lint', title: 'lint', args: [bin('eslint', 'bin', 'eslint.js'), '.'] },
    { name: 'unit', title: 'unit tests', args: vitest('unit') },
    { name: 'perf', title: 'perf tests (CPU budgets through perfguard, one at a time)', args: vitest('perf', ['--passWithNoTests']) },
    { name: 'e2e', title: 'e2e tests (browser, several at a time)', args: vitest('e2e'), browser: true },
    { name: 'e2e-serial', title: 'e2e tests that measure memory and time (browser, one at a time)', args: vitest('e2e-serial', ['--passWithNoTests']), browser: true },
  ];
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

/** The text table of a finished run. `results`: [{ title, status: 'PASS'|'FAIL'|'SKIPPED', ms }]. */
export function formatSummary(results) {
  const width = Math.max(...results.map((r) => r.title.length));
  const lines = results.map((r) => `${r.status.padEnd(8)} ${r.title.padEnd(width)}  ${r.status === 'SKIPPED' ? '-' : formatDuration(r.ms)}`);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  lines.push('', failed === 0 ? 'RESULT: ALL STAGES PASSED' : `RESULT: ${failed} STAGE(S) FAILED (see the logs in test-results/)`);
  return lines.join('\n');
}

function runStage(stage, env) {
  fs.mkdirSync(OUT, { recursive: true });
  const logPath = path.join(OUT, `local-${stage.name}.log`);
  const log = fs.createWriteStream(logPath);
  const t0 = Date.now();
  console.log(`\n=== ${stage.title} ===`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, stage.args, { cwd: REPO_ROOT, env, stdio: ['inherit', 'pipe', 'pipe'] });
    const tee = (chunk, stream) => {
      stream.write(chunk);
      log.write(chunk);
    };
    child.stdout.on('data', (c) => tee(c, process.stdout));
    child.stderr.on('data', (c) => tee(c, process.stderr));
    child.on('error', (err) => {
      log.write(`spawn error: ${err.message}\n`);
      log.end(() => resolve({ ok: false, ms: Date.now() - t0, logPath }));
    });
    child.on('close', (code) => log.end(() => resolve({ ok: code === 0, ms: Date.now() - t0, logPath })));
  });
}

function readLog(logPath) {
  try {
    return fs.readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
}

export async function main() {
  const env = { ...process.env, LOCAL_GPU: '1' };
  if (env.GOLDEN_COMPARE !== 'fail') env.GOLDEN_COMPARE = 'warn';
  const workers = e2eWorkerCount(env, os.availableParallelism());
  env.E2E_WORKERS = String(workers);
  console.log(`[verify:local] LOCAL_GPU=${env.LOCAL_GPU} GOLDEN_COMPARE=${env.GOLDEN_COMPARE} e2e workers=${workers} (${os.availableParallelism()} cores)`);
  if (!isLocalGpu(env)) throw new Error('internal: LOCAL_GPU must be on');

  const results = [];
  let browserOk = true;
  for (const stage of stages()) {
    if (stage.browser && !browserOk) {
      results.push({ title: stage.title, status: 'SKIPPED', ms: 0, logPath: '' });
      continue;
    }
    const r = await runStage(stage, env);
    results.push({ title: stage.title, status: r.ok ? 'PASS' : 'FAIL', ms: r.ms, logPath: r.logPath, name: stage.name });
    if (stage.fatal && !r.ok) browserOk = false;
  }

  // The report: machine, GPU line, stage table, perf calibration and budget lines (what to send back).
  const gpuLog = readLog(path.join(OUT, 'local-gpu.log'));
  const rendererLine = gpuLog.split('\n').find((l) => l.startsWith('[shot] renderer:')) ?? '[shot] renderer: (not available: the GPU check failed)';
  const softwareGl = /swiftshader|llvmpipe|software/i.test(rendererLine);
  const perfLog = readLog(path.join(OUT, 'local-perf.log'));
  const perfLines = perfLog.split('\n').filter((l) => /\[perfguard\]|median|budget|p99/i.test(l)).slice(0, 80);
  const report = [
    `verify:local report ${new Date().toISOString()}`,
    `node ${process.version} on ${os.platform()} ${os.release()} (${os.arch()}), ${os.availableParallelism()} cores, ${os.cpus()[0]?.model ?? 'unknown CPU'}`,
    rendererLine,
    softwareGl ? 'WARNING: the browser used a SOFTWARE renderer, not the GPU. Install Chrome or Edge, or set CHROME_PATH (docs/LOCAL.md).' : 'The browser reports a hardware renderer.',
    `e2e workers ${workers}, golden image comparison: warn only (SwiftShader goldens)`,
    '',
    formatSummary(results),
    '',
    'Perf lines (budgets go through perfguard):',
    ...perfLines,
    '',
  ].join('\n');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'local-report.txt'), report);
  console.log(`\n${report}`);
  console.log('Report saved in test-results/local-report.txt');
  process.exitCode = results.some((r) => r.status === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// scripts/verify.mjs: the stage order and the isolation rules that make `npm run verify` safe to run with parallel stages (D144),
// and the package.json scripts staying plain cross-platform (no bash-only syntax: the user runs verify:local on Windows).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { formatDuration, formatSummary, main, stageGroups, type Stage, type StageRun } from '../scripts/verify.mjs';

const names = (groups: Array<Array<{ name: string }>>): string[][] => groups.map((g) => g.map((s) => s.name));

describe('stage groups', () => {
  it('verify: typecheck, lint and unit side by side, then perf alone, then e2e alone, then e2e-serial alone', () => {
    expect(names(stageGroups())).toEqual([['typecheck', 'lint', 'unit'], ['perf'], ['e2e'], ['e2e-serial']]);
  });
  it('verify:fast is only the first group', () => {
    expect(names(stageGroups({ fast: true }))).toEqual([['typecheck', 'lint', 'unit']]);
  });
  it('verify:local starts with the browser and GPU check, whose failure makes the browser stages skip', () => {
    const groups = stageGroups({ local: true });
    expect(names(groups)[0]).toEqual(['gpu']);
    expect(groups[0]?.[0]?.fatal).toBe(true);
    expect(names(groups).slice(1)).toEqual([['typecheck', 'lint', 'unit'], ['perf'], ['e2e'], ['e2e-serial']]);
  });
  it('perf and every browser stage run alone: no CPU-budget test shares the machine and no Chromium shares it with another stage', () => {
    for (const group of stageGroups({ local: true })) {
      if (group.some((s) => s.name === 'perf' || s.browser === true)) expect(group).toHaveLength(1);
    }
  });
  it('the browser stages are exactly the two e2e projects, and perf keeps --passWithNoTests', () => {
    const all = stageGroups().flat();
    expect(all.filter((s) => s.browser).map((s) => s.name)).toEqual(['e2e', 'e2e-serial']);
    expect(all.find((s) => s.name === 'perf')?.args).toContain('--passWithNoTests');
    for (const s of all) expect(s.args.every((a) => typeof a === 'string' && a.length > 0)).toBe(true);
  });
});

describe('summary', () => {
  it('formats durations and a pass / fail table', () => {
    expect(formatDuration(4_000)).toBe('4 s');
    expect(formatDuration(125_000)).toBe('2 min 05 s');
    const ok = formatSummary([{ title: 'unit tests', status: 'PASS', ms: 40_000 }], 41_000);
    expect(ok).toContain('PASS     unit tests  40 s');
    expect(ok).toContain('wall time 41 s');
    expect(ok).toContain('RESULT: ALL STAGES PASSED');
    const bad = formatSummary([{ title: 'a', status: 'FAIL', ms: 1000 }, { title: 'b', status: 'SKIPPED', ms: 0 }], 2000);
    expect(bad).toContain('RESULT: 1 STAGE(S) FAILED');
    expect(bad).toMatch(/SKIPPED +b +-/);
  });
});

describe('package.json scripts are plain cross-platform commands', () => {
  const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts as Record<string, string>;
  it('verify, verify:fast and verify:local are one Node script each', () => {
    expect(scripts.verify).toBe('node scripts/verify.mjs');
    expect(scripts['verify:fast']).toBe('node scripts/verify.mjs --fast');
    expect(scripts['verify:local']).toBe('node scripts/verify.mjs --local');
  });
  it('no script uses an environment prefix, $VAR, backticks, a pipe or a semicolon (cmd.exe and PowerShell do not understand them)', () => {
    for (const [name, cmd] of Object.entries(scripts)) {
      expect(cmd, name).not.toMatch(/^[A-Z_][A-Z0-9_]*=/);
      expect(cmd, name).not.toMatch(/\$[A-Za-z_{(]/);
      expect(cmd, name).not.toMatch(/[`|;]/);
      expect(cmd, name).not.toMatch(/\b(export|source)\b/);
    }
  });
});


describe('main(): the exit code and the stop rule that CI relies on', () => {
  const okRun = (): StageRun => ({ ok: true, ms: 1, logPath: 'x.log', output: Buffer.from('') });
  const failRun = (): StageRun => ({ ok: false, ms: 1, logPath: 'x.log', output: Buffer.from('boom') });

  async function runMain(argv: string[], failing: string[]): Promise<{ code: number | string | undefined; started: string[] }> {
    const started: string[] = [];
    const before = process.exitCode;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      process.exitCode = undefined;
      await main(argv, {
        runStage: async (stage: Stage) => {
          started.push(stage.name);
          return failing.includes(stage.name) ? failRun() : okRun();
        },
        writeLocalReport: () => undefined,
      });
      return { code: process.exitCode, started };
    } finally {
      log.mockRestore();
      write.mockRestore();
      process.exitCode = before;
    }
  }

  it('exits 0 and runs every stage in order when everything passes', async () => {
    const r = await runMain([], []);
    expect(r.code).toBe(0);
    expect(r.started).toEqual(['typecheck', 'lint', 'unit', 'perf', 'e2e', 'e2e-serial']);
  });
  it('exits 1 and does not start the next group when a stage of the first group fails', async () => {
    const r = await runMain([], ['lint']);
    expect(r.code).toBe(1);
    expect(r.started).toEqual(['typecheck', 'lint', 'unit']);
  });
  it('exits 1 when only the last stage fails', async () => {
    const r = await runMain([], ['e2e-serial']);
    expect(r.code).toBe(1);
    expect(r.started).toEqual(['typecheck', 'lint', 'unit', 'perf', 'e2e', 'e2e-serial']);
  });
  it('verify:fast runs only the first group and still reports a failure with exit 1', async () => {
    const r = await runMain(['--fast'], ['unit']);
    expect(r.code).toBe(1);
    expect(r.started).toEqual(['typecheck', 'lint', 'unit']);
  });
  it('verify:local runs every group even after a failure, skips the browser stages when the gpu check fails, and exits 1', async () => {
    const all = await runMain(['--local'], ['unit']);
    expect(all.code).toBe(1);
    expect(all.started).toEqual(['gpu', 'typecheck', 'lint', 'unit', 'perf', 'e2e', 'e2e-serial']);
    const noGpu = await runMain(['--local'], ['gpu']);
    expect(noGpu.code).toBe(1);
    expect(noGpu.started).toEqual(['gpu', 'typecheck', 'lint', 'unit', 'perf']);
  });
});

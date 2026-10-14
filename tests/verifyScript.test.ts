// scripts/verify.mjs: the stage order and the isolation rules that make `npm run verify` safe to run with parallel stages (D144),
// and the package.json scripts staying plain cross-platform (no bash-only syntax: the user runs verify:local on Windows).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDuration, formatSummary, stageGroups } from '../scripts/verify.mjs';

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

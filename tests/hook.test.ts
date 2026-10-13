import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve('.claude/session-start.sh');

describe('SessionStart hook', () => {
  it('script has valid bash syntax', () => {
    execFileSync('bash', ['-n', '.claude/session-start.sh']);
  });
  it('settings.json registers the hook with a timeout and valid JSON', () => {
    const s = JSON.parse(fs.readFileSync('.claude/settings.json', 'utf8'));
    const hook = s.hooks.SessionStart[0].hooks[0];
    expect(hook.type).toBe('command');
    expect(hook.command).toContain('.claude/session-start.sh');
    expect(hook.timeout).toBeGreaterThanOrEqual(90);
  });
  it('reports the field as "npm ci körd denna session" and keeps the 90 s timeout', () => {
    const script = fs.readFileSync('.claude/session-start.sh', 'utf8');
    expect(script).toContain('npm ci körd denna session');
    expect(script).not.toContain('npm ci gjord');
    expect(script).toMatch(/timeout (-k \d+ )?90 npm ci/);
  });
});

// Behaviour tests: run the real script against a throw-away project directory with a stub `npm`
// first on PATH (STUB_MODE=ok installs a complete tree, STUB_MODE=fail leaves a half-written one).
describe('SessionStart hook behaviour (stub npm)', () => {
  let dir: string;
  let stubLog: string;

  const run = (mode: 'ok' | 'fail') => {
    const r = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`, STUB_MODE: mode, STUB_LOG: stubLog },
    });
    const lines = r.stdout.split('\n').filter((l) => l.length > 0);
    return { status: r.status, lines, stdout: r.stdout };
  };
  const npmCalls = () => (fs.existsSync(stubLog) ? fs.readFileSync(stubLog, 'utf8').split('\n').filter(Boolean).length : 0);
  const hasHiddenLock = () => fs.existsSync(path.join(dir, 'node_modules', '.package-lock.json'));
  const LINE = /^session-start: node \S+ \| chromium (nej|ja \(.+\)) \| npm ci körd denna session (ja|nej)( \(failed, see \.claude\/hook\.log\))?$/;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
    stubLog = path.join(dir, 'npm-calls.log');
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}\n');
    const stub = [
      '#!/usr/bin/env bash',
      'echo "$@" >>"$STUB_LOG"',
      'rm -rf node_modules',
      'mkdir -p node_modules/dep',
      'if [ "$STUB_MODE" = "fail" ]; then exit 1; fi',
      "echo '{}' >node_modules/.package-lock.json",
      'exit 0',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'bin', 'npm'), stub, { mode: 0o755 });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('runs npm ci when node_modules is missing: one line, exit 0, field says ja', () => {
    const r = run('ok');
    expect(r.status).toBe(0);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(LINE);
    expect(r.lines[0]).toMatch(/npm ci körd denna session ja$/);
    expect(npmCalls()).toBe(1);
    expect(hasHiddenLock()).toBe(true);
  });

  it('treats node_modules without .package-lock.json as an incomplete install and runs npm ci', () => {
    fs.mkdirSync(path.join(dir, 'node_modules', 'half'), { recursive: true });
    const r = run('ok');
    expect(r.status).toBe(0);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/npm ci körd denna session ja$/);
    expect(npmCalls()).toBe(1);
    expect(hasHiddenLock()).toBe(true);
  });

  it('is idempotent: a complete install is left alone and the field says nej', () => {
    expect(run('ok').lines[0]).toMatch(/npm ci körd denna session ja$/);
    const second = run('ok');
    expect(second.status).toBe(0);
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0]).toMatch(LINE);
    expect(second.lines[0]).toMatch(/npm ci körd denna session nej$/);
    expect(npmCalls()).toBe(1);
  });

  it('removes a half-written node_modules when npm ci fails, so the next session retries', () => {
    const failed = run('fail');
    expect(failed.status).toBe(0);
    expect(failed.lines).toHaveLength(1);
    expect(failed.lines[0]).toMatch(LINE);
    expect(failed.lines[0]).toMatch(/npm ci körd denna session nej \(failed, see \.claude\/hook\.log\)$/);
    expect(fs.existsSync(path.join(dir, 'node_modules'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, '.claude', 'hook.log'), 'utf8')).toContain('npm ci failed or timed out');
    const retry = run('ok');
    expect(retry.lines[0]).toMatch(/npm ci körd denna session ja$/);
    expect(npmCalls()).toBe(2);
    expect(hasHiddenLock()).toBe(true);
  });
});

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

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
});

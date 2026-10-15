// Child processes in the tests must run on Windows too (docs/LOCAL.md): a bare npm / npx fails there (npm.cmd needs a shell)
// and bash is not on PATH by default. Tests start Node itself (tests/helpers/nodeScripts.ts); a bash-bound test file must skip
// itself when there is no bash.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['tests', 'e2e', 'tools'];
const SELF = path.join('tests', 'portableSpawn.test.ts');
// The probe `hasBash()` lives here: it is the guard the bash-bound tests use, and it never runs a script.
const BASH_PROBE = path.join('tests', 'helpers', 'nodeScripts.ts');
const CALL = /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\s*\(\s*(['"`])([^'"`]*)\1/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|mts|mjs|js)$/.test(entry.name)) out.push(p);
  }
  return out;
}

export function offenders(text: string, allowBash = false): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(CALL)) {
    const cmd = (m[2] ?? '').trim().split(/\s+/)[0] ?? '';
    if (/^(npm|npx|pnpm|yarn)(\.cmd)?$/.test(cmd)) found.push(`${cmd} (use process.execPath with the tsx CLI)`);
    else if (/^(bash|sh)$/.test(cmd) && !allowBash && !/\bskipIf\b/.test(text)) found.push(`${cmd} without a skipIf guard`);
  }
  return found;
}

describe('portable child processes in the tests', () => {
  it('the scan itself flags a bare npm, npx and an unguarded bash', () => {
    expect(offenders("spawnSync('npm', ['run', 'x'])")).toHaveLength(1);
    expect(offenders('execFileSync("npx", ["tsx", "a.ts"])')).toHaveLength(1);
    expect(offenders("spawnSync('bash', [SCRIPT])")).toHaveLength(1);
    expect(offenders("describe.skipIf(!HAS_BASH)('x'); spawnSync('bash', [SCRIPT])")).toHaveLength(0);
    expect(offenders("spawnSync('bash', ['--version'])", true)).toHaveLength(0);
    expect(offenders('spawnSync(process.execPath, [cli])')).toHaveLength(0);
    expect(offenders("spawnSync('git', ['ls-remote'])")).toHaveLength(0);
  });

  it('no file under tests/, e2e/ or tools/ spawns npm / npx, and bash only behind a skipIf', () => {
    const bad: string[] = [];
    for (const root of ROOTS) {
      if (!fs.existsSync(root)) continue;
      for (const file of sourceFiles(root)) {
        if (file === SELF) continue;
        for (const o of offenders(fs.readFileSync(file, 'utf8'), file === BASH_PROBE)) bad.push(`${file}: ${o}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

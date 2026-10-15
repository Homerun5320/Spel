// Portable child processes for the tests: Node runs the script itself, so there is no `npm`, `npx` or `bash` lookup on PATH
// (on Windows those are npm.cmd / a missing bash and a plain spawnSync fails with ENOENT or EINVAL).
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const TSX_CLI = path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** Runs a TypeScript file through the pinned tsx CLI with the current Node binary. */
export function runTsx(file: string, args: string[] = []): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [TSX_CLI, path.join(REPO, file), ...args], { encoding: 'utf8', cwd: REPO });
}

/**
 * The same as `npm run -s <name> -- <args>` for a package.json script of the form `tsx <file>`: the script text is read from
 * package.json (so a renamed or rewritten script fails the test) and the file is run without going through npm.
 */
export function runTsxScript(name: string, args: string[] = []): SpawnSyncReturns<string> {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const text = pkg.scripts[name];
  const m = text === undefined ? null : /^tsx (\S+\.ts)$/.exec(text);
  if (!m) throw new Error(`package.json script "${name}" is not of the form "tsx <file>.ts": ${String(text)}`);
  return runTsx(m[1] as string, args);
}

/** True when a POSIX bash is on PATH and the platform is not Windows (the SessionStart hook is a cloud-session bash script). */
export function hasBash(): boolean {
  if (process.platform === 'win32') return false;
  const r = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

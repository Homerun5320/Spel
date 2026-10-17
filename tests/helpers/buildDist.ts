// Builds the site with the project's Vite config into a temporary folder (the same build `npm run build` makes)
// so tests never depend on a stale dist/ and never touch the user's dist/ or artifact/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';

export const REPO = path.resolve(__dirname, '..', '..');

export function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

export async function buildDistTo(outDir: string): Promise<string> {
  // Vitest sets NODE_ENV=test, which would make `import.meta.env.DEV` true in the bundle. A real build is production.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({ root: REPO, mode: 'production', logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  return outDir;
}

export function copyDir(from: string, prefix: string): string {
  const to = makeTmp(prefix);
  fs.cpSync(from, to, { recursive: true });
  return to;
}

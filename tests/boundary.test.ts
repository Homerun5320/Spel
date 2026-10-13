import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(process.cwd(), 'src');

function listTs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(p));
    else if (/\.(ts|mts|js|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function imports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const found: string[] = [];
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.push((m[1] ?? m[2] ?? m[3]) as string);
  return found;
}

describe('purity boundary (structural test, complements the ESLint rules)', () => {
  const pure = ['sim', 'ai', 'data'];
  for (const dir of pure) {
    it(`src/${dir} imports neither three, render, ui, audio nor app`, () => {
      for (const file of listTs(path.join(SRC, dir))) {
        for (const spec of imports(file)) {
          expect(spec, `${path.relative(SRC, file)} imports ${spec}`).not.toMatch(/^three(\/|$)/);
          expect(spec, `${path.relative(SRC, file)} imports ${spec}`).not.toMatch(/(^|\/)(render|ui|audio|app)(\/|$)/);
        }
      }
    });
  }

  it('three is imported only under src/render and src/app', () => {
    for (const file of listTs(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep)[0];
      if (rel === 'render' || rel === 'app') continue;
      for (const spec of imports(file)) {
        expect(spec, `${path.relative(SRC, file)} imports ${spec}`).not.toMatch(/^three(\/|$)/);
      }
    }
  });

  it('no test files live next to sources', () => {
    for (const file of listTs(SRC)) {
      expect(file, 'tests belong in tests/ or e2e/').not.toMatch(/\.test\.(ts|mts|js|mjs)$/);
    }
  });
});

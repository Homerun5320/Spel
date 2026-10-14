import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => fs.readFileSync(p, 'utf8');

describe('CLAUDE.md', () => {
  const text = read('CLAUDE.md');
  it('is under 200 lines', () => {
    expect(text.split('\n').length).toBeLessThan(200);
  });
  it('mentions PROMPTLISTA on exactly one line', () => {
    expect(text.split('\n').filter((l) => l.includes('PROMPTLISTA')).length).toBe(1);
  });
  it('contains the required rules', () => {
    for (const needle of [
      'Reply to the user in Swedish',
      'Clean room',
      'PR and merge flow',
      'Usage efter Mxx',
      'Time rule',
      'perfguard',
      'Så spelar du',
      'DRAFT',
      'Compact instruction',
    ]) {
      expect(text, needle).toContain(needle);
    }
  });
});

describe('the user-file rule line', () => {
  // The user's own prompt list is named exactly once in CLAUDE.md (and in the charter's section 7), nowhere else in the docs.
  it('is not repeated in README.md or in any docs/*.md other than the charter', () => {
    const others = ['README.md', ...fs.readdirSync('docs').filter((f) => f.endsWith('.md') && f !== 'CHARTER.md').map((f) => `docs/${f}`)];
    const offenders = others.filter((f) => read(f).includes('PROMPTLISTA'));
    expect(offenders).toEqual([]);
  });
});

describe('docs/PROGRESS.md', () => {
  const text = read('docs/PROGRESS.md');
  it('has the resume line, Environment table and usage table', () => {
    expect(text).toContain('Läs CLAUDE.md och docs/PROGRESS.md, kör git log -10 och npm run verify:fast, fortsätt vid första ej avbockade punkten.');
    expect(text).toMatch(/## Environment/);
    expect(text).toMatch(/\| date \| after milestone \| 5h % \| week % \| note \|/);
    for (const h of ['## Done', '## Now', '## Next', '## Known issues', '## Skipped']) expect(text).toContain(h);
  });
});

describe('docs only mention files that exist (or are marked later)', () => {
  const files = ['CLAUDE.md', 'README.md', 'docs/ARCHITECTURE.md', 'docs/ASSETS.md', 'docs/BACKLOG.md', 'docs/BALANCE.md', 'docs/DECISIONS.md', 'docs/LOCAL.md', 'docs/PROGRESS.md', 'docs/PROMPT_TEMPLATE.md'];
  for (const file of files) {
    it(file, () => {
      const missing: string[] = [];
      for (const line of read(file).split('\n')) {
        if (/later|fallback|\(only/i.test(line)) continue;
        for (const m of line.matchAll(/`([^`\s]+)`/g)) {
          const token = m[1] as string;
          if (/[*<>{}$|=:?#]|^\.\.|^https?/.test(token)) continue;
          if (/^test-results|hook\.log$/.test(token)) continue; // generated, gitignored
          if (!/\/|\.(md|ts|mjs|mts|json|yml|sh|html|js)$/.test(token)) continue;
          if (token.endsWith('/')) {
            if (!fs.existsSync(token)) missing.push(token);
            continue;
          }
          if (!fs.existsSync(path.normalize(token))) missing.push(token);
        }
      }
      expect(missing).toEqual([]);
    });
  }
});

describe('docs never backtick a gitignored generated folder (a fresh checkout lacks it)', () => {
  // The check above passes in a sandbox where artifact/ or dist exists and fails in CI; this one does not depend on what is on disk.
  const ignored = read('.gitignore')
    .split('\n')
    .map((l) => l.trim().replace(/\/$/, ''))
    .filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith('!') && !l.includes('*') && l !== 'node_modules');
  const files = ['CLAUDE.md', 'README.md', 'docs/ARCHITECTURE.md', 'docs/ASSETS.md', 'docs/BACKLOG.md', 'docs/BALANCE.md', 'docs/DECISIONS.md', 'docs/LOCAL.md', 'docs/PROGRESS.md', 'docs/PROMPT_TEMPLATE.md'];
  it('knows the generated folders', () => {
    expect(ignored).toEqual(expect.arrayContaining(['dist', '.cache', 'test-results', 'artifact']));
  });
  for (const file of files) {
    it(file, () => {
      const offenders: string[] = [];
      for (const line of read(file).split('\n')) {
        if (/later|fallback|\(only/i.test(line)) continue; // the same lines the existence check skips
        for (const m of line.matchAll(/`([^`\s]+)`/g)) {
          const raw = m[1] as string;
          if (/[*<>{}$|=:?#]|^\.\.|^https?/.test(raw) || /^test-results|hook\.log$/.test(raw)) continue; // the same filters as the existence check
          if (!/\/|\.(md|ts|mjs|mts|json|yml|sh|html|js)$/.test(raw)) continue;
          const token = path.normalize(raw).replace(/\/$/, '');
          if (ignored.some((g) => token === g || token.startsWith(`${g}${path.sep}`))) offenders.push(m[1] as string);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

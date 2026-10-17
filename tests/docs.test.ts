import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => fs.readFileSync(p, 'utf8');
const archFiles = fs.readdirSync('docs/arch').filter((f) => f.endsWith('.md')).map((f) => `docs/arch/${f}`);

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
  const files = ['CLAUDE.md', 'README.md', 'docs/ARCHITECTURE.md', 'docs/ASSETS.md', 'docs/BACKLOG.md', 'docs/BALANCE.md', 'docs/DECISIONS.md', 'docs/LOCAL.md', 'docs/PROGRESS.md', 'docs/PROMPT_TEMPLATE.md', ...archFiles];
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
  const files = ['CLAUDE.md', 'README.md', 'docs/ARCHITECTURE.md', 'docs/ASSETS.md', 'docs/BACKLOG.md', 'docs/BALANCE.md', 'docs/DECISIONS.md', 'docs/LOCAL.md', 'docs/PROGRESS.md', 'docs/PROMPT_TEMPLATE.md', ...archFiles];
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

describe('docs/ARCHITECTURE.md stays an index (Fix-4C)', () => {
  const text = read('docs/ARCHITECTURE.md');
  it('stays under the size cap (the detail goes to docs/arch/<area>.md)', () => {
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(46000);
  });
  it('keeps every line short enough for the Read tool', () => {
    const long = text.split('\n').filter((l) => l.length > 1300).map((l) => l.slice(0, 60));
    expect(long).toEqual([]);
  });
  it('keeps every module row under 450 characters and linked to an existing area file', () => {
    const rows = text.split('\n').filter((l) => /^\| `/.test(l));
    expect(rows.length).toBeGreaterThan(100);
    const bad: string[] = [];
    for (const row of rows) {
      const link = /\]\(arch\/([a-z]+\.md)\)/.exec(row);
      if (row.length > 450 || !link || !fs.existsSync(`docs/arch/${link[1]}`)) bad.push(row.slice(0, 60));
    }
    expect(bad).toEqual([]);
  });
  it('has area files that all start with a heading and are linked from the index', () => {
    expect(archFiles.length).toBeGreaterThanOrEqual(8);
    for (const f of archFiles) {
      expect(read(f).startsWith('# Architecture detail'), f).toBe(true);
      expect(text, f).toContain(`arch/${path.basename(f)}`);
    }
  });
  it('names the engine and format versions of the code', () => {
    const engine = /ENGINE_VERSION = (\d+)/.exec(read('src/sim/state.ts'))?.[1];
    const format = /FORMAT_VERSION = (\d+)/.exec(read('src/sim/serialize.ts'))?.[1];
    expect(text).toContain(`ENGINE_VERSION ${engine} `);
    expect(text).toContain(`FORMAT_VERSION ${format} `);
  });
});

describe('docs/PREVIEW.md ids (Fix-5C)', () => {
  const lines = read('docs/PREVIEW.md').split('\n');
  it('every section id (### 5x) and every numbered item id (17xx.) occurs once', () => {
    const dup = (ids: string[]): string[] => ids.filter((id, i) => ids.indexOf(id) !== i);
    const sections = lines.map((l) => /^### (\d+[a-z]*)\./.exec(l)?.[1]).filter((x): x is string => x !== undefined);
    const items = lines.map((l) => /^(\d+[a-z]+\d*)\. /.exec(l)?.[1]).filter((x): x is string => x !== undefined);
    expect(dup(sections)).toEqual([]);
    expect(dup(items)).toEqual([]);
    expect(sections.length).toBeGreaterThan(5);
    expect(items.length).toBeGreaterThan(50);
  });
});

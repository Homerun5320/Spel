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
  const files = ['CLAUDE.md', 'README.md', 'docs/ARCHITECTURE.md', 'docs/ASSETS.md', 'docs/BACKLOG.md', 'docs/DECISIONS.md', 'docs/PROGRESS.md', 'docs/PROMPT_TEMPLATE.md'];
  for (const file of files) {
    it(file, () => {
      const missing: string[] = [];
      for (const line of read(file).split('\n')) {
        if (/later|fallback|\(only/i.test(line)) continue;
        for (const m of line.matchAll(/`([^`\s]+)`/g)) {
          const token = m[1] as string;
          if (/[*<>{}$|=:?#]|^\.\.|^https?/.test(token)) continue;
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

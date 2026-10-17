// docs/BALANCE.md and src/sim/rules.ts must say the same thing: one table row per exported constant, with the exact value.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as rules from '../src/sim/rules';

const doc = fs.readFileSync('docs/BALANCE.md', 'utf8');
const src = fs.readFileSync('src/sim/rules.ts', 'utf8');

function show(v: unknown): string {
  return Array.isArray(v) ? `[${v.join(', ')}]` : String(v);
}

/** name -> cells of its table row. */
function rows(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of doc.split('\n')) {
    const m = /^\| `([A-Z][A-Z0-9_]*)` \|(.*)\|\s*$/.exec(line);
    if (!m) continue;
    const name = m[1] as string;
    expect(out.has(name), `${name} has two rows`).toBe(false);
    out.set(name, (m[2] as string).split('|').map((c) => c.trim()));
  }
  return out;
}

describe('docs/BALANCE.md', () => {
  const table = rows();
  const exported = Object.keys(rules);

  it('has a row for every constant of rules.ts and no row for anything else', () => {
    expect(exported.length).toBeGreaterThan(40);
    expect([...table.keys()].sort()).toEqual([...exported].sort());
  });

  it('shows the exact value of each constant', () => {
    for (const name of exported) {
      expect((table.get(name) as string[])[0], name).toBe(show((rules as Record<string, unknown>)[name]));
    }
  });

  it('names a unit and a source (plan or eget val) for each row', () => {
    for (const [name, cells] of table) {
      expect((cells[1] as string).length, `${name} unit`).toBeGreaterThan(0);
      expect(['plan', 'eget val'], name).toContain(cells[2]);
    }
  });

  it('starts with a Swedish summary and says that the rest is English', () => {
    expect(doc.split('\n').slice(0, 5).join('\n')).toMatch(/Sammanfattning \(svenska\)/);
    expect(doc).toContain('Below, everything is in English');
  });
});

describe('src/sim/rules.ts', () => {
  it('declares every constant on one `export const NAME` line each (the table is built from that)', () => {
    const declared = [...src.matchAll(/^export const ([A-Z][A-Z0-9_]*)\b/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual(Object.keys(rules).sort());
  });
});

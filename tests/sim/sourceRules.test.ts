// Source-level determinism rules that ESLint cannot express: no Map / Set / typed floats / float literals in the
// simulation, one place for the seat/owner conversion, rules.ts holds UPPER_SNAKE_CASE constants only.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../src');

function files(dir: string): string[] {
  return fs
    .readdirSync(path.join(SRC, dir))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `${dir}/${f}`);
}

/** Source without comments and string / template literal contents. */
function code(rel: string): string {
  const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
}

const SIM = files('sim');

describe('src/sim source rules', () => {
  it('lists the files it scans (so an empty scan cannot pass)', () => {
    expect(SIM.length).toBeGreaterThanOrEqual(14);
    expect(SIM).toContain('sim/step.ts');
  });

  const banned: Array<[string, RegExp]> = [
    ['Map (iteration order is an easy trap; use arrays or typed arrays)', /\bnew\s+Map\b|\bMap</],
    ['Set', /\bnew\s+Set\b|\bSet</],
    ['WeakMap / WeakRef', /\bWeak(?:Map|Set|Ref)\b/],
    ['sort() without a comparator', /\.sort\(\s*\)/],
    ['JSON (key order, float printing)', /\bJSON\./],
    ['BigInt', /\bBigInt\b|\b\d+n\b/],
    ['Float32Array', /\bFloat32Array\b/],
    ['parseFloat / Number() parsing', /\bparseFloat\b/],
    ['locale functions', /\btoLocale\w*/],
    ['Symbol', /\bSymbol\b/],
    ['Proxy / Reflect', /\bProxy\b/],
    ['setTimeout / setInterval / promises', /\bsetTimeout\b|\bsetInterval\b|\bPromise\b|\basync\b|\bawait\b/],
    ['structuredClone', /\bstructuredClone\b/],
    ['imports from the host or the app', /from\s+['"][^'"]*\/(?:host|app)\b/],
  ];
  for (const [name, re] of banned) {
    it(`no ${name}`, () => {
      const hits = SIM.filter((f) => re.test(code(f)));
      expect(hits).toEqual([]);
    });
  }

  it('no Float64Array, and decimal literals only in the canary (the one deliberate float kernel)', () => {
    const decimal = /(?<![\w.])\d+\.\d+(?![\w.])|(?<![\w.])\.\d+|\b\d+e[+-]?\d+\b/i;
    const f64 = SIM.filter((f) => /\bFloat64Array\b/.test(code(f)));
    expect(f64).toEqual([]);
    const withDecimals = SIM.filter((f) => decimal.test(code(f)));
    expect(withDecimals).toEqual(['sim/canary.ts']);
  });

  it('only src/sim/state.ts converts between seats and ownerIds', () => {
    const pat = /\bseat\w*\s*\+\s*1\b|\bowner\w*\s*-\s*1\b|\b1\s*\+\s*seat\w*\b/i;
    const offenders = [...files('sim'), ...files('host'), ...files('app')].filter((f) => f !== 'sim/state.ts' && pat.test(code(f)));
    expect(offenders).toEqual([]);
    expect(pat.test(code('sim/state.ts'))).toBe(true);
  });

  it('every export of rules.ts is a UPPER_SNAKE_CASE constant (and nothing else is exported)', () => {
    const text = code('sim/rules.ts');
    const exports = [...text.matchAll(/^export\s+(\w+)\s+(\w+)/gm)];
    expect(exports.length).toBeGreaterThanOrEqual(5);
    for (const m of exports) {
      expect(m[1]).toBe('const');
      expect(m[2]).toMatch(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/);
    }
    expect(/\bexport\s+(?:function|class|let|var|default|type|interface)\b/.test(text)).toBe(false);
  });

  it('the host layer imports the sim, never the other way round', () => {
    for (const f of files('host')) expect(code(f)).not.toMatch(/from\s+['"]three|from\s+['"][^'"]*\/(?:render|ui|audio|app)\b/);
  });
});

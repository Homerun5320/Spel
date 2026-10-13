import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

async function lint(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  if (!result) throw new Error('no lint result');
  return result.messages.filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
}

const SIM = 'src/sim/fixture.ts';

describe('lint self-test: determinism rules in src/sim and src/ai', () => {
  const forbidden: Array<[string, string, RegExp]> = [
    ['Math.sin', 'export const a = Math.sin(1);', /no-restricted-syntax/],
    ['Math.asin', 'export const a = Math.asin(0.5);', /no-restricted-syntax/],
    ['Math.log2', 'export const a = Math.log2(8);', /no-restricted-syntax/],
    ['Math.random', 'export const a = Math.random();', /no-restricted-syntax/],
    ['Math.PI', 'export const a = Math.PI;', /no-restricted-syntax/],
    ['Math[computed]', "export const a = Math['sin'](1);", /no-restricted-syntax/],
    ['Math.pow', 'export const a = Math.pow(2, 3);', /no-restricted-syntax/],
    ['three import', "import { Vector3 } from 'three';\nexport const v = Vector3;", /no-restricted-imports/],
    ['three subpath import', "import { x } from 'three/examples/jsm/foo.js';\nexport const v = x;", /no-restricted-imports/],
    ['render import', "import { x } from '../render/spike';\nexport const v = x;", /no-restricted-imports/],
    ['ui import', "import { x } from '../ui/i18n';\nexport const v = x;", /no-restricted-imports/],
    ['audio import', "import { x } from '../audio/engine';\nexport const v = x;", /no-restricted-imports/],
    ['app import', "import { x } from '../app/main';\nexport const v = x;", /no-restricted-imports/],
    ['Date', 'export const a = Date.now();', /no-restricted-globals/],
    ['new Date', 'export const a = new Date();', /no-restricted-globals/],
    ['performance', 'export const a = performance.now();', /no-restricted-globals/],
    ['crypto', 'export const a = crypto.getRandomValues(new Uint8Array(1));', /no-restricted-globals/],
    ['Intl', "export const a = new Intl.NumberFormat('sv');", /no-restricted-globals/],
    ['toFixed', 'export const a = (1.5).toFixed(1);', /no-restricted-syntax/],
    ['localeCompare', "export const a = 'a'.localeCompare('b');", /no-restricted-syntax/],
    ['** operator', 'export const a = 2 ** 3;', /no-restricted-syntax/],
    ['**= operator', 'let a = 2;\na **= 3;\nexport { a };', /no-restricted-syntax/],
    ['for...in', 'export function f(o: object) { let n = 0; for (const k in o) n += k.length; return n; }', /no-restricted-syntax/],
    ['Object.keys', 'export const a = Object.keys({ a: 1 });', /no-restricted-syntax/],
    ['Object.values', 'export const a = Object.values({ a: 1 });', /no-restricted-syntax/],
    ['Object.entries', 'export const a = Object.entries({ a: 1 });', /no-restricted-syntax/],
    ['window', 'export const a = window.innerWidth;', /no-restricted-globals/],
    ['document', "export const a = document.createElement('div');", /no-restricted-globals/],
    ['navigator', 'export const a = navigator.userAgent;', /no-restricted-globals/],
    ['localStorage', "export const a = localStorage.getItem('x');", /no-restricted-globals/],
    ['requestAnimationFrame', 'export const a = requestAnimationFrame(() => {});', /no-restricted-globals/],
    ['globalThis', 'export const a = globalThis;', /no-restricted-globals/],
    // Bypasses of the Math allow-list: Math must only appear as Math.<allowed member>.
    ['Math destructuring (forbidden member)', 'const { asin } = Math;\nexport const a = asin(0.5);', /no-restricted-syntax: Math may only be used as Math\./],
    ['Math destructuring (allowed member)', 'const { floor } = Math;\nexport const a = floor(1.5);', /no-restricted-syntax: Math may only be used as Math\./],
    ['Math alias', 'const M = Math;\nexport const a = M.sin(1);', /no-restricted-syntax: Math may only be used as Math\./],
    ['Math assignment', 'let m: unknown = 0;\nm = Math;\nexport { m };', /no-restricted-syntax: Math may only be used as Math\./],
    ['Math passed as argument', 'declare function use(m: unknown): number;\nexport const a = use(Math);', /no-restricted-syntax: Math may only be used as Math\./],
    ['Math returned', 'export function getMath() {\n  return Math;\n}', /no-restricted-syntax: Math may only be used as Math\./],
    ['Math in array', 'export const a = [Math];', /no-restricted-syntax: Math may only be used as Math\./],
    ['Math in object shorthand', 'export const a = { Math };', /no-restricted-syntax: Math may only be used as Math\./],
    ['Math via sequence expression', 'export const a = (0, Math).sin(1);', /no-restricted-syntax: Math may only be used as Math\./],
    ['Math via type assertion', 'export const a = (Math as unknown as { sin(x: number): number }).sin(1);', /no-restricted-syntax: Math may only be used as Math\./],
    ['Math computed with an allowed-looking variable', "const abs = 'sin';\nexport const a = Math[abs](1);", /no-restricted-syntax: Only exactly-rounded Math functions/],
    // Bypasses of the object-key iteration bans.
    ['Reflect.ownKeys', 'export const a = Reflect.ownKeys({ a: 1 });', /no-restricted-syntax: Reflect\.ownKeys is forbidden/],
    ['Reflect.ownKeys optional call', 'export const a = Reflect.ownKeys?.({ a: 1 });', /no-restricted-syntax: Reflect\.ownKeys is forbidden/],
    ['Object.getOwnPropertyNames', 'export const a = Object.getOwnPropertyNames({ a: 1 });', /no-restricted-syntax: Object\.keys\/values\/entries\/getOwnPropertyNames/],
    ['Object.getOwnPropertySymbols', 'export const a = Object.getOwnPropertySymbols({ a: 1 });', /no-restricted-syntax: Object\.keys\/values\/entries\/getOwnPropertyNames/],
    ['Object computed member', "export const a = Object['keys']({ a: 1 });", /no-restricted-syntax: Computed member access on Object or Reflect/],
    ['Reflect computed member', "export const a = Reflect['ownKeys']({ a: 1 });", /no-restricted-syntax: Computed member access on Object or Reflect/],
    ['Object destructuring', 'const { keys } = Object;\nexport const a = keys({ a: 1 });', /no-restricted-syntax: Object may only be used as Object\./],
    ['Object alias', 'const O = Object;\nexport const a = O.keys({ a: 1 });', /no-restricted-syntax: Object may only be used as Object\./],
    ['Reflect destructuring', 'const { ownKeys } = Reflect;\nexport const a = ownKeys({ a: 1 });', /no-restricted-syntax: Reflect may only be used as Reflect\./],
    ['Reflect alias', 'const R = Reflect;\nexport const a = R.ownKeys({ a: 1 });', /no-restricted-syntax: Reflect may only be used as Reflect\./],
  ];

  for (const [name, code, rule] of forbidden) {
    for (const file of ['src/sim/fixture.ts', 'src/ai/fixture.ts']) {
      it(`${name} fails in ${file}`, async () => {
        const errors = await lint(file, code);
        expect(errors.some((e) => rule.test(e)), `expected ${rule} in ${JSON.stringify(errors)}`).toBe(true);
      });
    }
  }

  it('clean code with exact Math functions passes', async () => {
    const code = [
      'export function clean(a: number, b: number): number {',
      '  const x = Math.floor(a) + Math.ceil(b) + Math.round(a) + Math.trunc(b) + Math.sign(a);',
      '  const y = Math.abs(a) + Math.min(a, b) + Math.max(a, b) + Math.sqrt(Math.abs(b));',
      '  const z = Math.imul(x | 0, y | 0) + Math.fround(a) + Math.clz32(b | 0);',
      '  let s = 0;',
      '  for (let i = 0; i < 3; i++) s += i * i;',
      '  return x + y + z + s;',
      '}',
      '',
    ].join('\n');
    expect(await lint(SIM, code)).toEqual([]);
  });

  it('other Object and Reflect members and plain properties named Math pass', async () => {
    const code = [
      'declare const cfg: Record<string, number>;',
      'export const frozen = Object.freeze(Object.assign({}, { a: 1 }));',
      "export const pairs = Object.fromEntries([['a', 1]]);",
      "export const has = Object.hasOwn({ a: 1 }, 'a') && Reflect.has({ a: 1 }, 'a');",
      'export const floorFn = Math.floor;',
      'export const m = cfg.Math;',
      '',
    ].join('\n');
    expect(await lint(SIM, code)).toEqual([]);
  });

  it('pure sibling imports pass', async () => {
    expect(await lint(SIM, "import { a } from './other';\nexport const b = a;\n")).toEqual([]);
  });
});

describe('lint self-test: scope of the rules', () => {
  it('src/data forbids three and DOM globals but allows Math.sin and Date', async () => {
    expect((await lint('src/data/fixture.ts', "import * as T from 'three';\nexport const a = T;")).length).toBeGreaterThan(0);
    expect((await lint('src/data/fixture.ts', 'export const a = window.innerWidth;')).length).toBeGreaterThan(0);
    expect(await lint('src/data/fixture.ts', 'export const a = Math.sin(1) + Date.now();')).toEqual([]);
  });

  it('src/render and src/app may import three and use the DOM', async () => {
    expect(await lint('src/render/fixture.ts', "import { Vector3 } from 'three';\nexport const v = new Vector3(Math.sin(1), 0, 0);")).toEqual([]);
    expect(await lint('src/app/fixture.ts', 'export const a = window.innerWidth;')).toEqual([]);
  });

  it('tests are exempt from the determinism and boundary rules', async () => {
    expect(await lint('tests/sim/fixture.ts', 'export const a = Math.sin(1) + Date.now() + 2 ** 3;')).toEqual([]);
    expect(await lint('e2e/fixture.ts', "import { Vector3 } from 'three';\nexport const a = [Vector3];")).toEqual([]);
    expect(await lint('src/sim/fixture.test.ts', 'export const a = Math.sin(1) + Date.now();')).toEqual([]);
  });

  it('tests/ and e2e/ may use any and unused variables', async () => {
    const code = 'const unused = 1;\nexport const a: any = 2;\n';
    expect(await lint('tests/fixture.ts', code)).toEqual([]);
    expect(await lint('e2e/fixture.ts', code)).toEqual([]);
    expect((await lint('src/render/fixture.ts', code)).length).toBeGreaterThan(0);
  });

  it('scripts/*.mjs know node and browser globals', async () => {
    const code = "export const a = [process.cwd(), window.innerWidth, document.title, performance.now()];\n";
    expect(await lint('scripts/fixture.mjs', code)).toEqual([]);
  });
});

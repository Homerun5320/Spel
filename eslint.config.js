import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Boundary rules: src/sim, src/ai and src/data are pure (no three, no render/ui/audio/app, no DOM). src/host runs
// inside the M24a Worker, so it gets the same boundary (but not the determinism rules: it never changes a game rule).
const BOUNDARY_FILES = ['src/sim/**/*.ts', 'src/ai/**/*.ts', 'src/data/**/*.ts', 'src/host/**/*.ts'];
// Determinism rules: src/sim and src/ai only.
const DETERMINISM_FILES = ['src/sim/**/*.ts', 'src/ai/**/*.ts'];
// Test files are never exempted by name; they simply live in tests/ and e2e/. The one
// explicit exemption is any stray *.test.ts so that the rules never apply to tests.
const TEST_FILES = ['**/*.test.ts'];

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'requestAnimationFrame',
  'cancelAnimationFrame',
].map((name) => ({ name, message: 'DOM globals are forbidden in src/sim, src/ai, src/data and src/host.' }));

const NONDETERMINISTIC_GLOBALS = ['Date', 'performance', 'crypto', 'Intl', 'globalThis'].map((name) => ({
  name,
  message: `${name} is forbidden in src/sim and src/ai (determinism).`,
}));

const BOUNDARY_IMPORTS = {
  patterns: [
    {
      group: ['three', 'three/*', 'crypto', 'node:crypto'],
      message: 'three and crypto must not be imported from src/sim, src/ai, src/data or src/host.',
    },
    {
      group: ['**/render', '**/render/**', '**/ui', '**/ui/**', '**/audio', '**/audio/**', '**/app', '**/app/**'],
      message: 'src/sim, src/ai, src/data and src/host must not import render, ui, audio or app.',
    },
  ],
};

const ALLOWED_MATH = 'abs|min|max|floor|ceil|round|trunc|sign|sqrt|imul|fround|clz32';

// Math, Object and Reflect may only appear as the object of a member expression
// (`Math.floor(x)`, `Object.freeze(o)`). Any other appearance of the identifier (destructuring,
// aliasing, assignment, passing it as an argument, returning it, `(0, Math)`, `Math as any`, ...)
// would bypass the member-based selectors below, so it is forbidden. A plain property access such
// as `x.Math` is not a reference to the global and stays allowed.
const bareIdentifier = (name, message) => ({
  selector: `Identifier[name='${name}']:not(MemberExpression > Identifier.object, MemberExpression[computed=false] > Identifier.property)`,
  message,
});

const DETERMINISM_SYNTAX = [
  {
    // Only a non-computed member whose name is on the allow-list passes (`Math[abs]` with a variable named abs does not).
    selector: `MemberExpression[object.name='Math']:not([computed=false][property.name=/^(${ALLOWED_MATH})$/])`,
    message: `Only exactly-rounded Math functions are allowed (${ALLOWED_MATH.split('|').join(', ')}).`,
  },
  bareIdentifier(
    'Math',
    `Math may only be used as Math.<member> with an allowed member (${ALLOWED_MATH.split('|').join(', ')}); destructuring, aliasing, assigning, passing or returning Math is forbidden (determinism).`,
  ),
  { selector: "MemberExpression[property.name='toFixed']", message: 'toFixed is forbidden (determinism).' },
  { selector: "MemberExpression[property.name='localeCompare']", message: 'localeCompare is forbidden (determinism).' },
  { selector: "BinaryExpression[operator='**']", message: 'The ** operator is forbidden (determinism).' },
  { selector: "AssignmentExpression[operator='**=']", message: 'The **= operator is forbidden (determinism).' },
  { selector: 'ForInStatement', message: 'for...in is forbidden (object-key iteration).' },
  {
    selector: "MemberExpression[object.name='Object'][property.name=/^(keys|values|entries|getOwnPropertyNames|getOwnPropertySymbols)$/]",
    message: 'Object.keys/values/entries/getOwnPropertyNames/getOwnPropertySymbols are forbidden (object-key iteration).',
  },
  {
    selector: "MemberExpression[object.name='Reflect'][property.name='ownKeys']",
    message: 'Reflect.ownKeys is forbidden (object-key iteration).',
  },
  {
    selector: "MemberExpression[computed=true][object.name=/^(Object|Reflect)$/]",
    message: 'Computed member access on Object or Reflect is forbidden (it would bypass the key-iteration bans).',
  },
  bareIdentifier(
    'Object',
    'Object may only be used as Object.<member>; destructuring, aliasing, assigning, passing or returning Object is forbidden (it would bypass the key-iteration bans).',
  ),
  bareIdentifier(
    'Reflect',
    'Reflect may only be used as Reflect.<member>; destructuring, aliasing, assigning, passing or returning Reflect is forbidden (it would bypass the key-iteration bans).',
  ),
];

export default defineConfig([
  globalIgnores(['dist/**', 'node_modules/**', '.cache/**', 'test-results/**', 'artifact/**', 'e2e/goldens/**', 'public/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['tests/**', 'e2e/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: BOUNDARY_FILES,
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', BOUNDARY_IMPORTS],
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
    },
  },
  {
    // Overrides no-restricted-globals / adds no-restricted-syntax for the deterministic core.
    files: DETERMINISM_FILES,
    ignores: TEST_FILES,
    rules: {
      'no-restricted-globals': ['error', ...DOM_GLOBALS, ...NONDETERMINISTIC_GLOBALS],
      'no-restricted-syntax': ['error', ...DETERMINISM_SYNTAX],
    },
  },
]);

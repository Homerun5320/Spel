import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Boundary rules: src/sim, src/ai and src/data are pure (no three, no render/ui/audio/app, no DOM).
const BOUNDARY_FILES = ['src/sim/**/*.ts', 'src/ai/**/*.ts', 'src/data/**/*.ts'];
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
].map((name) => ({ name, message: 'DOM globals are forbidden in src/sim, src/ai and src/data.' }));

const NONDETERMINISTIC_GLOBALS = ['Date', 'performance', 'crypto', 'Intl', 'globalThis'].map((name) => ({
  name,
  message: `${name} is forbidden in src/sim and src/ai (determinism).`,
}));

const BOUNDARY_IMPORTS = {
  patterns: [
    {
      group: ['three', 'three/*', 'crypto', 'node:crypto'],
      message: 'three and crypto must not be imported from src/sim, src/ai or src/data.',
    },
    {
      group: ['**/render', '**/render/**', '**/ui', '**/ui/**', '**/audio', '**/audio/**', '**/app', '**/app/**'],
      message: 'src/sim, src/ai and src/data must not import render, ui, audio or app.',
    },
  ],
};

const ALLOWED_MATH = 'abs|min|max|floor|ceil|round|trunc|sign|sqrt|imul|fround|clz32';

const DETERMINISM_SYNTAX = [
  {
    selector: `MemberExpression[object.name='Math']:not([property.name=/^(${ALLOWED_MATH})$/])`,
    message: `Only exactly-rounded Math functions are allowed (${ALLOWED_MATH.split('|').join(', ')}).`,
  },
  { selector: "MemberExpression[property.name='toFixed']", message: 'toFixed is forbidden (determinism).' },
  { selector: "MemberExpression[property.name='localeCompare']", message: 'localeCompare is forbidden (determinism).' },
  { selector: "BinaryExpression[operator='**']", message: 'The ** operator is forbidden (determinism).' },
  { selector: "AssignmentExpression[operator='**=']", message: 'The **= operator is forbidden (determinism).' },
  { selector: 'ForInStatement', message: 'for...in is forbidden (object-key iteration).' },
  {
    selector: "MemberExpression[object.name='Object'][property.name=/^(keys|values|entries)$/]",
    message: 'Object.keys/values/entries are forbidden (object-key iteration).',
  },
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

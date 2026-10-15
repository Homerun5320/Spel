// src/ai may import ONLY src/sim/public.ts (which exports SimView): proven three ways.
//  1. the ESLint allow-list fires on every other import (a lint self-test with virtual files),
//  2. a structural scan of the real files of src/ai,
//  3. a TYPE test with the TypeScript compiler: the export list of public.ts is pinned, no exported function takes or returns a
//     GameState, and every property of SimView and its statistics is `readonly` with a read-only array type (never a Uint array).
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });
async function lint(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  if (!result) throw new Error('no lint result');
  return result.messages.filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
}

const AI = 'src/ai/fixture.ts';

describe('lint: src/ai imports only src/sim/public.ts', () => {
  const forbidden: Array<[string, string]> = [
    ['step', "import { step } from '../sim/step';\nexport const a = step;"],
    ['state', "import { createState } from '../sim/state';\nexport const a = createState;"],
    ['a GameState type', "import type { GameState } from '../sim/state';\nexport type A = GameState;"],
    ['territory mutators', "import { setOwner } from '../sim/territory';\nexport const a = setOwner;"],
    ['rules.ts directly', "import { TICK_HZ } from '../sim/rules';\nexport const a = TICK_HZ;"],
    ['view.ts directly (StateView, fillSeatStats)', "import { StateView } from '../sim/view';\nexport const a = StateView;"],
    ['intents.ts directly', "import { validateIntent } from '../sim/intents';\nexport const a = validateIntent;"],
    ['rng.ts directly', "import { createRng } from '../sim/rng';\nexport const a = createRng;"],
    ['the host', "import { MainThreadHost } from '../host/mainThreadHost';\nexport const a = MainThreadHost;"],
    ['a package', "import fs from 'node:fs';\nexport const a = fs;"],
    ['a bare module', "import { x } from 'typescript';\nexport const a = x;"],
    ['a re-export of step', "export { step } from '../sim/step';"],
    ['export *', "export * from '../sim/state';"],
    ['a deeper path', "import { x } from '../../src/sim/step';\nexport const a = x;"],
    ['public.ts with an extension', "import { seatToOwner } from '../sim/public.ts';\nexport const a = seatToOwner;"],
    ['a dynamic import', "export const a = import('../sim/step');"],
    ['three', "import * as T from 'three';\nexport const a = T;"],
  ];
  for (const [name, code] of forbidden) {
    it(`refuses ${name}`, async () => {
      expect((await lint(AI, code)).length, name).toBeGreaterThan(0);
    });
  }

  it('allows src/sim/public.ts (values and types) and files of src/ai itself, and still enforces the determinism rules', async () => {
    const ok = [
      "import { seatToOwner, type SimView } from '../sim/public';\nexport const a = (v: SimView) => seatToOwner(v.players);",
      "import type { IntentBody } from '../sim/public';\nexport type A = IntentBody;",
      "import { think } from './think';\nexport const a = think;",
      "export { createAiMemory } from './memory';",
    ];
    for (const code of ok) expect(await lint(AI, code), code).toEqual([]);
    expect((await lint(AI, 'export const a = Math.sin(1);')).length).toBeGreaterThan(0);
    expect((await lint(AI, 'export const a = Date.now();')).length).toBeGreaterThan(0);
  });
});

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('structure: the files of src/ai', () => {
  const files = listTs('src/ai');
  it('has files, and every import and re-export names only ./x or ../sim/public', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(re)) {
        const spec = (m[1] ?? m[2] ?? m[3]) as string;
        expect(spec === '../sim/public' || /^\.\/[a-z]+$/.test(spec), `${file} imports ${spec}`).toBe(true);
      }
    }
  });
});

describe('types: what src/sim/public.ts lets the AI reach', () => {
  const program = ts.createProgram(['src/sim/public.ts'], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    lib: ['lib.es2023.d.ts'],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile('src/sim/public.ts') as ts.SourceFile;
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source) as ts.Symbol);
  const names = exports.map((s) => s.name).sort();

  it('exports exactly this list (adding an export is a decision that must be reviewed here)', () => {
    expect(names).toEqual(
      [
        'AI_ANCHOR_SEAT',
        'AI_ATTACK_COOLDOWN_TICKS',
        'AI_BUILD_CITIES_PER_FACTORY',
        'AI_BUILD_CITIES_PER_PORT',
        'AI_BUILD_CITIES_PER_POST',
        'AI_BUILD_CITY_TROOP_PCT',
        'AI_BUILD_RETRY_TICKS',
        'AI_BUILD_RICH_PCT',
        'AI_BUILD_TRIES',
        'AI_BUILD_WINDOW_CELLS',
        'AI_EXPAND_COMMIT_PCT',
        'AI_EXPAND_MAX_SHARE_PCT',
        'AI_EXPAND_TROOP_PCT',
        'AI_MIN_CONTACT_LENGTH',
        'AI_NATION_CLEARANCE_CELLS',
        'AI_NATION_REACH_CELLS',
        'AI_SPAWN_RETRY_TICKS',
        'AI_SPAWN_SPACING_TICKS',
        'AI_SPAWN_WAIT_TICKS',
        'AI_SPAWN_TRIES',
        'AI_THINK_PERIOD_TICKS',
        'AI_THINK_STAGGER_TICKS',
        'AI_TRIBE_CLEARANCE_CELLS',
        'AI_TRIBE_REACH_CELLS',
        'AI_TRIBE_COOLDOWN_TICKS',
        'AI_TRIBE_MAX_CELLS',
        'AI_WAR_COMMIT_PCT',
        'AI_WAR_HUMAN_START_TICKS',
        'AI_WAR_MAX_SHARE_PCT',
        'AI_WAR_MIN_CONTACT_LENGTH',
        'AI_WAR_MIN_RATIO_PCT',
        'AI_WAR_START_TICKS',
        'AttackBody',
        'BUILD_BASE_GOLD',
        'BUILD_TICKS',
        'BuildBody',
        'CancelAttackBody',
        'DeleteBody',
        'Intent',
        'IntentBody',
        'MatchPhase',
        'MILLI_GOLD_PER_GOLD',
        'NO_OWNER',
        'NO_SEAT',
        'PHASE_IMMUNITY',
        'PHASE_PLAY',
        'PHASE_SPAWN',
        'REJECT_BUILD_FALLOUT',
        'REJECT_BUILD_FOREST',
        'REJECT_BUILD_FULL',
        'REJECT_BUILD_GOLD',
        'REJECT_BUILD_HILLS',
        'REJECT_BUILD_MOUNTAIN',
        'REJECT_BUILD_NOT_OWNED',
        'REJECT_BUILD_NO_COAST',
        'REJECT_BUILD_NO_FACTORY',
        'REJECT_BUILD_OCCUPIED',
        'REJECT_BUILD_PEAK',
        'REJECT_BUILD_SPACING',
        'REJECT_BUILD_TYPE',
        'REJECT_NONE',
        'RNG_WORDS',
        'ReadonlyNumbers',
        'STAT_COUNT',
        'STAT_FIELDS',
        'SeatStatsView',
        'SimView',
        'SpawnBody',
        'START_DISC_RADIUS_CELLS',
        'STRUCT_CITY',
        'STRUCT_FACTORY',
        'STRUCT_MAX_LEVEL',
        'STRUCT_PORT',
        'STRUCT_POST',
        'STRUCT_SAM',
        'STRUCT_SILO',
        'StatField',
        'StructureView',
        'UpgradeBody',
        'WEIGHT_ONE',
        'attackBody',
        'buildBody',
        'buildPriceGold',
        'buildPriceMilli',
        'cancelAttackBody',
        'createRng',
        'deleteBody',
        'hasFinishedFactory',
        'isPlayableClass',
        'nextBelow',
        'nextU32',
        'ownerSlots',
        'ownerToSeat',
        'phaseAt',
        'phaseTicksLeft',
        'seatToOwner',
        'spawnBody',
        'upgradeBody',
        'upgradePriceGold',
        'validateBuild',
        'validateUpgrade', 'validateDelete', 'REJECT_DELETE_COOLDOWN', 'REJECT_STRUCT_BUSY', 'REJECT_STRUCT_ID', 'REJECT_STRUCT_MAX_LEVEL', 'REJECT_STRUCT_NOT_OWNER', 'samRadiusCells', 'CAP_CITY_LEVEL_TROOPS', 'CITY_GOLD_MILLI_PER_SEC_PER_LEVEL', 'DELETE_COOLDOWN_TICKS', 'FACTORY_CITY_BONUS_PCT', 'FACTORY_GOLD_MILLI_PER_SEC', 'FACTORY_RADIUS_CELLS', 'PORT_GOLD_MILLI_PER_SEC', 'POST_COST_DEN', 'POST_COST_NUM', 'POST_RADIUS_CELLS', 'TICK_HZ', // M10-4
        'FACTORY_CITY_BONUS_PCT_BY_LEVEL', 'FACTORY_GOLD_MILLI_BY_LEVEL', 'FACTORY_RADIUS_CELLS_BY_LEVEL', 'PORT_GOLD_MILLI_BY_LEVEL', 'PORT_TRADE_PCT_BY_LEVEL', 'SAM_MOUNTAIN_PCT', // Fix-UI
        'BuildDistrictBody', 'RemoveDistrictBody', 'UpgradeDistrictBody', 'buildDistrictBody', 'removeDistrictBody', 'upgradeDistrictBody', 'REJECT_DISTRICT_CITY_BUILDING', 'REJECT_DISTRICT_EMPTY', 'REJECT_DISTRICT_KIND', 'REJECT_DISTRICT_NOT_CITY', 'REJECT_DISTRICT_OCCUPIED', 'REJECT_DISTRICT_SLOT', 'DistrictEffect', 'DistrictView', 'DISTRICT_BARRACKS', 'DISTRICT_HOUSING', 'DISTRICT_KIND_SLOTS', 'DISTRICT_MARKET', 'DISTRICT_NONE', 'DISTRICT_WALLS', 'districtBuildPriceGold', 'districtBuildPriceMilli', 'districtEffect', 'districtIndex', 'districtSlotsOf', 'districtUpgradePriceGold', 'isDistrictKind', 'validateBuildDistrict', 'validateRemoveDistrict', 'validateUpgradeDistrict', 'AI_DISTRICT_MIN_CITIES', 'AI_DISTRICT_RETRY_TICKS', 'DISTRICT_BASE_GOLD', 'DISTRICT_BUILD_TICKS', 'DISTRICT_MAX_LEVEL', 'DISTRICT_MAX_SLOTS', 'DISTRICT_SLOTS_BY_LEVEL', 'DISTRICT_WALLS_RADIUS_CELLS', // Districts-1
      ].sort(),
    );
  });

  it('exports no step, state, mutator, serialiser, host or world type by name', () => {
    for (const n of names) expect(n, n).not.toMatch(/^(step|StepFn|StepResult|GameState|createState|createEmptyState|setOwner|changeOwner|applyIntent|launchAttack|serialize|deserialize|hashState|MainThreadHost|StateView|fillSeatStats|SimWorld|createWorldState)$/);
  });

  it('no exported function takes or returns a GameState (or anything that contains one)', () => {
    for (const sym of exports) {
      const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      const decl = resolved.valueDeclaration ?? resolved.declarations?.[0];
      if (!decl) continue;
      const type = checker.getTypeOfSymbolAtLocation(resolved, decl);
      for (const sig of type.getCallSignatures()) {
        const text = [checker.signatureToString(sig), ...sig.getParameters().map((p) => checker.typeToString(checker.getTypeOfSymbolAtLocation(p, decl)))].join(' ');
        expect(text, `${sym.name}: ${text}`).not.toMatch(/GameState|SimWorld|Outbox|AttackTable|BorderIndex/);
      }
    }
  });

  it('every property of StructureView is readonly and no array in it is a writable typed array', () => {
    const sym = exports.find((x) => x.name === 'StructureView') as ts.Symbol;
    const type = checker.getDeclaredTypeOfSymbol(sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym);
    const props = checker.getPropertiesOfType(type);
    expect(props.length).toBeGreaterThanOrEqual(10);
    for (const p of props) {
      const decl = p.valueDeclaration as ts.Declaration;
      if (!ts.isMethodSignature(decl)) expect((ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Readonly) !== 0, `StructureView.${p.name} is readonly`).toBe(true);
      expect(checker.typeToString(checker.getTypeOfSymbolAtLocation(p, decl)), p.name).not.toMatch(/(Uint|Int|Float)(8|16|32|64)(Clamped)?Array/);
    }
  });

  it('every property of SimView and SeatStatsView is readonly and no array in them is a writable typed array', () => {
    for (const interfaceName of ['SimView', 'SeatStatsView']) {
      const sym = exports.find((s) => s.name === interfaceName) as ts.Symbol;
      const type = checker.getDeclaredTypeOfSymbol(sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym);
      const props = checker.getPropertiesOfType(type);
      expect(props.length).toBeGreaterThan(8);
      for (const p of props) {
        const decl = p.valueDeclaration as ts.Declaration;
        const isMethod = ts.isMethodSignature(decl);
        if (!isMethod) {
          const readonly = (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Readonly) !== 0;
          expect(readonly, `${interfaceName}.${p.name} is readonly`).toBe(true);
        }
        const text = checker.typeToString(checker.getTypeOfSymbolAtLocation(p, decl));
        expect(text, `${interfaceName}.${p.name}: ${text}`).not.toMatch(/(Uint|Int|Float)(8|16|32|64)(Clamped)?Array|\[\]/);
      }
    }
  });
});

describe('types: code that writes through a SimView does not compile (M09 part A)', () => {
  const VIRTUAL = path.resolve('tests/ai/virtualWrite.ts');
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ['lib.es2023.d.ts'] };
  function errors(body: string): string[] {
    const code = `import type { SimView } from '../../src/sim/public';\nexport function f(v: SimView): number {\n${body}\n  return 0;\n}\n`;
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, ...rest) => (path.resolve(name) === VIRTUAL ? ts.createSourceFile(name, code, ts.ScriptTarget.ES2022, true) : getSourceFile(name, ...rest));
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (name) => path.resolve(name) === VIRTUAL || fileExists(name);
    const program = ts.createProgram([VIRTUAL], options, host);
    return ts.getPreEmitDiagnostics(program, program.getSourceFile(VIRTUAL)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  }

  it('reads compile (the control)', () => {
    expect(errors('  return v.structures.type[0] + v.structures.owner[1] + v.structures.idAt(3) + v.owner[0] + v.falloutUntilAt(0);')).toEqual([]);
  });

  for (const [name, line] of [
    ['a structure type', '  v.structures.type[0] = 1;'],
    ['a structure level', '  v.structures.level[2] = 3;'],
    ['the structure table itself', '  v.structures = v.structures;'],
    ['a count', '  v.structures.liveCount = 0;'],
    ['the owner layer', '  v.owner[0] = 1;'],
    ['the terrain layer', '  v.terrainClass[0] = 1;'],
    ['the statistics', '  v.stats.goldMilli[0] = 1;'],
  ] as Array<[string, string]>) {
    it(`refuses a write to ${name}`, () => {
      expect(errors(line).length, line).toBeGreaterThan(0);
    });
  }
});

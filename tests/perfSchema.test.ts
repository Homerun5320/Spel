// M08 item 5: the JSON Schema of the perf report (src/ui/perfSchema.ts) and its validator. Reports from `buildPerfReport` validate; each kind of
// violation (a missing field, a wrong type, a non-finite number, an unknown key, a bad enum value, a negative count) is caught, so the schema
// can fail. The e2e test validates the report of a real run of the scene.
import { describe, expect, it } from 'vitest';
import { FrameStats } from '../src/ui/frameStats';
import { buildPerfReport, perfLines } from '../src/ui/perfOverlay';
import { PERF_REPORT_SCHEMA, validateJson, type JsonSchema } from '../src/ui/perfSchema';
import { PerfRecorder } from '../src/ui/perfSceneReport';

const SNAP = { renderer: 'R', vendor: 'V', glVersion: 'WebGL 2.0', webgl2: true, drawCalls: 3, triangles: 74560, geometries: 3, textures: 6, textureMB: 20.5, width: 960, height: 540, dpr: 1, tier: 'test' };
const META = { completed: true, quick: true, fxDurationS: 5, canvas: { cssWidth: 960, cssHeight: 540, pixelWidth: 960, pixelHeight: 540, dpr: 1, devicePixelRatio: 1 }, phaseNames: ['orbit', 'continent'] } as const;

function sceneReport(): ReturnType<typeof buildPerfReport> {
  const stats = new FrameStats();
  for (let i = 0; i < 30; i++) stats.push(16);
  const rec = new PerfRecorder();
  for (let i = 0; i < 40; i++) rec.probe(16.7);
  for (let i = 0; i < 30; i++) rec.frame(16 + (i % 4), 2, 4, 30_000, 14, 5000 - i, i < 15 ? 0 : 1);
  return buildPerfReport({ snapshot: () => SNAP, stats, mode: { test: '1', scene: 'perf' }, scene: () => rec.section(META, false), match: () => ({ tick: 3, speed: 1, hostAdvanceMs: { mean: 1, p95: 2, max: 3, frames: 4 }, ownershipUploads: 1, ownershipGpuUploads: 1 }) });
}

/** A deep copy of the report that a mutation can change. */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('the perf report schema', () => {
  it('accepts the plain overlay report, the match report and the scene report (after a JSON round trip)', () => {
    const stats = new FrameStats();
    const plain = buildPerfReport({ snapshot: () => SNAP, stats, mode: { test: '1' } });
    expect(validateJson(PERF_REPORT_SCHEMA, clone(plain))).toEqual([]);
    const full = sceneReport();
    expect(full.scene?.completed).toBe(true);
    expect(validateJson(PERF_REPORT_SCHEMA, clone(full))).toEqual([]);
    expect(full.schemaVersion).toBe(1);
    expect(perfLines(full).join('\n')).toContain('scen: klar');
  });

  const mutations: Array<[string, (r: Record<string, any>) => void, RegExp]> = [
    ['a missing top-level field', (r) => delete r.renderer, /renderer: missing/],
    ['a missing scene field', (r) => delete r.scene.maxChunks, /scene\.maxChunks: missing/],
    ['a missing canvas field (devicePixelRatio)', (r) => delete r.scene.canvas.devicePixelRatio, /devicePixelRatio: missing/],
    ['a string where a number belongs', (r) => (r.scene.frameMs.mean = 'fast'), /frameMs\.mean: expected number/],
    ['a NaN, which JSON turns into null', (r) => (r.scene.maxTriangles = null), /maxTriangles: expected integer/],
    ['a negative count', (r) => (r.scene.frames = -1), /frames: -1 is below 0/],
    ['a fraction where a count belongs', (r) => (r.scene.maxChunks = 12.5), /maxChunks: expected integer/],
    ['a verdict outside the enum', (r) => (r.scene.cappedHint.verdict = 'maybe'), /verdict: "maybe" is not one of/],
    ['an unknown key inside the scene', (r) => (r.scene.surprise = 1), /scene\.surprise: not in the schema/],
    ['an empty phase list', (r) => (r.scene.phases = []), /phases: fewer than 1 items/],
    ['a wrong kind', (r) => (r.kind = 'other'), /kind: "other" is not one of/],
    ['a phase without frames', (r) => delete r.scene.phases[0].frames, /phases\[0\]\.frames: missing/],
    ['a histogram that is not an array', (r) => (r.scene.cadence.counts = 'many'), /counts: expected array/],
  ];
  for (const [name, mutate, expected] of mutations) {
    it(`rejects ${name}`, () => {
      const r = clone(sceneReport()) as unknown as Record<string, any>;
      mutate(r);
      const errors = validateJson(PERF_REPORT_SCHEMA, r);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join('\n')).toMatch(expected);
    });
  }

  it('the validator itself: enum, minimum, items, required, additionalProperties', () => {
    const s: JsonSchema = { type: 'object', required: ['a'], additionalProperties: false, properties: { a: { type: 'array', items: { type: 'integer', minimum: 2 } }, b: { type: 'string', enum: ['x'] } } };
    expect(validateJson(s, { a: [2, 3] })).toEqual([]);
    expect(validateJson(s, { a: [2, 1] }).join()).toMatch(/\$\.a\[1\]: 1 is below 2/);
    expect(validateJson(s, {}).join()).toMatch(/\$\.a: missing/);
    expect(validateJson(s, { a: [], b: 'y' }).join()).toMatch(/not one of/);
    expect(validateJson(s, { a: [], c: 1 }).join()).toMatch(/\$\.c: not in the schema/);
    expect(validateJson(s, { a: [Number.POSITIVE_INFINITY] }).length).toBeGreaterThan(0);
    expect(validateJson(s, null).join()).toMatch(/expected object/);
  });
});

// The JSON Schema of the performance report (`PerfReport` of perfOverlay.ts, schema version 1, with the optional `match` section of M05 and
// the optional `scene` section of M08) and a small validator for the subset of JSON Schema the schema uses (no new npm package, D-rule
// "no new dependencies"): `type` (with `integer`), `required`, `properties`, `additionalProperties: false`, `items`, `enum`, `minimum`.
// The test (tests/perfSchema.test.ts) validates real reports against it and proves it can fail.

export type JsonSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: readonly (string | number | boolean)[];
  minimum?: number;
  minItems?: number;
  description?: string;
};

const num: JsonSchema = { type: 'number', minimum: 0 };
const int: JsonSchema = { type: 'integer', minimum: 0 };
const str: JsonSchema = { type: 'string' };
const bool: JsonSchema = { type: 'boolean' };
const obj = (properties: Record<string, JsonSchema>, optional: readonly string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
  additionalProperties: false,
});
const stats3 = (extra: Record<string, JsonSchema> = {}): JsonSchema => obj({ mean: num, p95: num, max: num, frames: int, ...extra });

const MATCH: JsonSchema = obj(
  {
    tick: int,
    speed: num,
    hostAdvanceMs: stats3(),
    hudUpdateMs: stats3(),
    ownershipUploads: int,
    ownershipGpuUploads: int,
  },
  ['hudUpdateMs'],
);

const PHASE: JsonSchema = obj({
  name: str,
  frames: int,
  meanMs: num,
  p95Ms: num,
  medianMs: num,
  maxTriangles: int,
  maxChunks: int,
  endAglM: { type: 'number' },
});

const SCENE: JsonSchema = obj({
  name: { type: 'string', enum: ['perf'] },
  completed: bool,
  quick: bool,
  durationS: num,
  fxDurationS: num,
  frames: int,
  truncated: bool,
  frameMs: obj({ mean: num, p95: num, max: num }),
  fps: obj({ mean: num, p95: num }),
  maxTriangles: int,
  maxDrawCalls: int,
  maxChunks: int,
  minAglM: { type: 'number' },
  canvas: obj({ cssWidth: num, cssHeight: num, pixelWidth: num, pixelHeight: num, dpr: num, devicePixelRatio: num }),
  refresh: obj({ measured: bool, samples: int, medianIntervalMs: num, hz: num }),
  cadence: obj({
    edgesMs: { type: 'array', items: num, minItems: 2 },
    counts: { type: 'array', items: int, minItems: 2 },
    refreshUnits: obj({ x1: num, x2: num, x3: num, x4plus: num }),
  }),
  cappedHint: obj({ verdict: { type: 'string', enum: ['unknown', 'none', 'likely-capped', 'unclear'] }, lockedMultiple: int, note: str }),
  cpuMs: obj({ mean: num, p95: num }),
  gpuMs: obj({ available: bool, samples: int, mean: num, p95: num }),
  phases: { type: 'array', items: PHASE, minItems: 1 },
});

export const PERF_REPORT_SCHEMA: JsonSchema = obj(
  {
    schemaVersion: { type: 'integer', minimum: 1 },
    kind: { type: 'string', enum: ['perf'] },
    renderer: str,
    vendor: str,
    glVersion: str,
    webgl2: bool,
    tier: str,
    viewport: obj({ width: num, height: num, dpr: num }),
    fps: obj({ mean: num, p95: num, p95FrameMs: num, frames: int, windowFrames: int }),
    renderInfo: obj({ calls: int, triangles: int, geometries: int, textures: int }),
    textureMB: num,
    mode: { type: 'object', additionalProperties: true },
    userAgent: str,
    match: MATCH,
    scene: SCENE,
  },
  ['match', 'scene'],
);

function typeOk(type: NonNullable<JsonSchema['type']>, v: unknown): boolean {
  switch (type) {
    case 'object':
      return typeof v === 'object' && v !== null && !Array.isArray(v);
    case 'array':
      return Array.isArray(v);
    case 'string':
      return typeof v === 'string';
    case 'boolean':
      return typeof v === 'boolean';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
  }
}

/** The violations of `value` against `schema`, as `path: message` lines (empty = valid). A non-finite number is a violation of `number`. */
export function validateJson(schema: JsonSchema, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  if (schema.type !== undefined && !typeOk(schema.type, value)) {
    errors.push(`${path}: expected ${schema.type}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' ? `non-conforming number ${String(value)}` : typeof value}`);
    return errors;
  }
  if (schema.enum !== undefined && !schema.enum.includes(value as string | number | boolean)) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) errors.push(`${path}: ${value} is below ${schema.minimum}`);
  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.items !== undefined) value.forEach((v, i) => errors.push(...validateJson(schema.items as JsonSchema, v, `${path}[${i}]`)));
  }
  if (schema.type === 'object' && typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in rec)) errors.push(`${path}.${k}: missing`);
    for (const [k, v] of Object.entries(rec)) {
      const sub = schema.properties?.[k];
      if (sub !== undefined) errors.push(...validateJson(sub, v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: not in the schema`);
    }
  }
  return errors;
}

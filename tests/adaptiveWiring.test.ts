// AutoTier-2 (D160): the address grammar of `adapt` and the additive `adaptive` field of the perf report (schema version stays 1).
import { describe, expect, it } from 'vitest';
import { parseAppState } from '../src/app/params';
import { FrameStats } from '../src/ui/frameStats';
import { buildPerfReport, perfLines } from '../src/ui/perfOverlay';
import { PERF_REPORT_SCHEMA, validateJson } from '../src/ui/perfSchema';

const SNAP = { renderer: 'R', vendor: 'V', glVersion: 'WebGL 2.0', webgl2: true, drawCalls: 3, triangles: 100, geometries: 3, textures: 6, textureMB: 20.5, width: 960, height: 540, dpr: 1, tier: 'low' };

describe('the adapt parameter', () => {
  it('?adapt=0 / #adapt-0 off, ?adapt=1 / #adapt-1 forced on, anything else the default (null)', () => {
    expect(parseAppState('?adapt=0', '').adapt).toBe(false);
    expect(parseAppState('', '#adapt-0').adapt).toBe(false);
    expect(parseAppState('?adapt=1', '').adapt).toBe(true);
    expect(parseAppState('', '#scene-perf_adapt-1').adapt).toBe(true);
    expect(parseAppState('', '#scene-perf_adapt-1').scene.scene).toBe('perf');
    expect(parseAppState('', '').adapt).toBeNull();
    expect(parseAppState('?adapt=maybe', '').adapt).toBeNull();
    expect(parseAppState('?adapt=1', '#adapt-0').adapt).toBe(false); // the hash wins
  });
});

describe('the report field adaptive', () => {
  const adaptive = { enabled: true, scale: 0.72, scaleMean: 0.8, scaleMin: 0.6, steps: 3, densityReduced: false };
  it('is carried and rounded, validates, shows a line, and the version stays 1', () => {
    const r = buildPerfReport({ snapshot: () => ({ ...SNAP, adaptive: { ...adaptive, scaleMean: 0.80123456 } }), stats: new FrameStats(), mode: {} });
    expect(r.adaptive).toEqual({ ...adaptive, scaleMean: 0.801 });
    expect(r.schemaVersion).toBe(1);
    expect(validateJson(PERF_REPORT_SCHEMA, JSON.parse(JSON.stringify(r)))).toEqual([]);
    expect(perfLines(r).join('\n')).toContain('adaptiv upplösning: på, skala nu 0.72');
  });
  it('is optional (an older report stays valid) and a wrong type fails', () => {
    const r = buildPerfReport({ snapshot: () => SNAP, stats: new FrameStats(), mode: {} });
    expect(r.adaptive).toBeUndefined();
    expect(validateJson(PERF_REPORT_SCHEMA, JSON.parse(JSON.stringify(r)))).toEqual([]);
    const bad = buildPerfReport({ snapshot: () => ({ ...SNAP, adaptive }), stats: new FrameStats(), mode: {} }) as unknown as Record<string, unknown>;
    const copy = JSON.parse(JSON.stringify(bad)) as { adaptive: Record<string, unknown> };
    copy.adaptive.steps = 'many';
    expect(validateJson(PERF_REPORT_SCHEMA, copy).join('\n')).toMatch(/adaptive\.steps: expected integer/);
    delete copy.adaptive.enabled;
    expect(validateJson(PERF_REPORT_SCHEMA, copy).join('\n')).toMatch(/adaptive\.enabled: missing/);
  });
});

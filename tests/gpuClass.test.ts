// AutoTier-1: the card classes (real renderer strings), the readable name, the default tier by class (every branch of the order) and the new
// report fields. The e2e side (the tip) is in e2e/gpuTip.test.ts.
import { describe, expect, it } from 'vitest';
import { classifyRenderer, readableGpuName, type GpuClass } from '../src/render/gpuClass';
import { QUALITY, resolveQuality, resolveQualityChoice } from '../src/render/quality';
import { FrameStats } from '../src/ui/frameStats';
import { buildPerfReport, perfLines } from '../src/ui/perfOverlay';
import { PERF_REPORT_SCHEMA, validateJson } from '../src/ui/perfSchema';

const USER = 'ANGLE (Intel, Intel(R) UHD Graphics (0x0000A721) Direct3D11 vs_5_0 ps_5_0, D3D11)';

// [renderer, vendor, class, readable name or null when not pinned]
const REAL: Array<[string, string, GpuClass, string | null]> = [
  [USER, 'Google Inc. (Intel)', 'integrated', 'Intel UHD Graphics'],
  ['ANGLE (Intel, Intel(R) HD Graphics 520 (0x00001916) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Intel)', 'integrated', 'Intel HD Graphics 520'],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Intel)', 'integrated', 'Intel Iris Xe Graphics'],
  ['ANGLE (Intel, Intel(R) Iris(R) Plus Graphics (0x00008A52) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Intel)', 'integrated', null],
  ['Mesa Intel(R) UHD Graphics 620 (KBL GT2)', 'Intel', 'integrated', 'Intel UHD Graphics 620 (KBL GT2)'],
  ['Intel Iris OpenGL Engine', 'Intel Inc.', 'integrated', 'Intel Iris'],
  ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Intel)', 'capable', 'Intel Arc A770 Graphics'],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (NVIDIA)', 'capable', 'NVIDIA GeForce RTX 3060 Laptop GPU'],
  ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 with Max-Q Design (0x00001F91) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (NVIDIA)', 'capable', null],
  ['NVIDIA GeForce RTX 4090/PCIe/SSE2', 'NVIDIA Corporation', 'capable', 'NVIDIA GeForce RTX 4090'],
  ['ANGLE (NVIDIA, NVIDIA Quadro T1000 (0x00001FB9) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (NVIDIA)', 'capable', null],
  ['ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (AMD)', 'capable', 'AMD Radeon RX 6700 XT'],
  ['ANGLE (AMD, AMD Radeon RX Vega 56 (0x000067FF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (AMD)', 'capable', null],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (AMD)', 'integrated', 'AMD Radeon Graphics'],
  ['ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (AMD)', 'integrated', null],
  ['ANGLE (AMD, AMD Radeon(TM) 780M (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (AMD)', 'integrated', null],
  ['AMD Radeon Pro 5500M OpenGL Engine', 'ATI Technologies Inc.', 'capable', 'AMD Radeon Pro 5500M'],
  ['Radeon RX 580 Series', 'ATI Technologies Inc.', 'capable', null],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'Google Inc. (Apple)', 'capable', 'Apple M1'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'Google Inc. (Apple)', 'capable', 'Apple M2 Pro'],
  ['Apple GPU', 'Apple Inc.', 'capable', null],
  ['Mali-G78', 'ARM', 'integrated', null],
  ['Adreno (TM) 650', 'Qualcomm', 'integrated', null],
  ['PowerVR Rogue GE8320', 'Imagination Technologies', 'integrated', null],
  ['VideoCore VII', 'Broadcom', 'integrated', null],
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'Google Inc. (Google)', 'software', 'SwiftShader Device (Subzero)'],
  ['Mesa llvmpipe (LLVM 15.0.7, 256 bits)', 'Mesa', 'software', null],
  ['ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Microsoft)', 'software', 'Microsoft Basic Render Driver'],
  ['Software Rasterizer', '', 'software', null],
];

describe('classifyRenderer', () => {
  it('has at least 25 real strings and the user\'s ProBook string is integrated', () => {
    expect(REAL.length).toBeGreaterThanOrEqual(25);
    expect(classifyRenderer(USER, 'Google Inc. (Intel)')).toBe('integrated');
  });
  for (const [renderer, vendor, cls] of REAL) it(`${renderer} -> ${cls}`, () => expect(classifyRenderer(renderer, vendor)).toBe(cls));

  it('an unknown or empty string is capable; the vendor is a second opinion only when the renderer says nothing', () => {
    expect(classifyRenderer('Mystery Graphics 9000')).toBe('capable');
    expect(classifyRenderer('')).toBe('capable');
    expect(classifyRenderer('Mystery', 'Google Inc. (Intel)')).toBe('integrated');
    expect(classifyRenderer('NVIDIA GeForce GTX 1060', 'Google Inc. (Intel)')).toBe('capable'); // the renderer wins
  });
});

describe('readableGpuName', () => {
  for (const [renderer, , , name] of REAL) if (name !== null) it(`${renderer} -> ${name}`, () => expect(readableGpuName(renderer)).toBe(name));
  it('is empty for an empty string and never keeps the ANGLE wrapper, the device id or the Direct3D tail', () => {
    expect(readableGpuName('')).toBe('');
    for (const [renderer] of REAL) expect(readableGpuName(renderer)).not.toMatch(/ANGLE|0x|Direct3D|vs_5/);
  });
});

describe('the default tier by class (resolveQualityChoice)', () => {
  const live = { test: false, quality: null };
  it('param wins over everything, and reports dev when the Dev panel wrote it', () => {
    expect(resolveQualityChoice({ ...live, quality: 'high', gpuClass: 'integrated', pref: 'low' })).toMatchObject({ source: 'param', settings: QUALITY.high });
    expect(resolveQualityChoice({ ...live, quality: 'high', gpuClass: 'integrated', fromDev: true }).source).toBe('dev');
  });
  it('test mode wins over param, pref and class', () => {
    const r = resolveQualityChoice({ test: true, quality: 'high', gpuClass: 'integrated', pref: 'high' });
    expect(r.settings.tier).toBe('test');
    expect(r.source).toBe('test');
    expect(resolveQuality({ test: true, quality: null, gpuClass: 'software' }).tier).toBe('test');
  });
  it('a stored pref wins over the class', () => {
    expect(resolveQualityChoice({ ...live, gpuClass: 'integrated', pref: 'high' })).toMatchObject({ source: 'pref', settings: QUALITY.high });
  });
  it('integrated and software choose low (auto), capable and unknown choose medium (default); an invalid param falls through', () => {
    expect(resolveQualityChoice({ ...live, gpuClass: 'integrated' })).toMatchObject({ source: 'auto', settings: QUALITY.low });
    expect(resolveQualityChoice({ ...live, gpuClass: 'software' })).toMatchObject({ source: 'auto', settings: QUALITY.low });
    expect(resolveQualityChoice({ ...live, gpuClass: 'capable' })).toMatchObject({ source: 'default', settings: QUALITY.medium });
    expect(resolveQualityChoice(live)).toMatchObject({ source: 'default', settings: QUALITY.medium });
    expect(resolveQualityChoice({ ...live, quality: 'ultra', pref: 'nonsense', gpuClass: 'integrated' }).source).toBe('auto');
  });
});

describe('the report', () => {
  const SNAP = { renderer: 'R', vendor: 'V', glVersion: 'WebGL 2.0', webgl2: true, drawCalls: 3, triangles: 100, geometries: 3, textures: 6, textureMB: 20.5, width: 960, height: 540, dpr: 1, tier: 'low' };
  it('carries gpuClass and tierSource, validates against the schema and shows a line in the text; schemaVersion stays 1', () => {
    const r = buildPerfReport({ snapshot: () => ({ ...SNAP, gpuClass: 'integrated', tierSource: 'auto' }), stats: new FrameStats(), mode: {} });
    expect(r.gpuClass).toBe('integrated');
    expect(r.tierSource).toBe('auto');
    expect(r.schemaVersion).toBe(1);
    expect(validateJson(PERF_REPORT_SCHEMA, JSON.parse(JSON.stringify(r)))).toEqual([]);
    expect(perfLines(r).join('\n')).toContain('grafikkort: integrated');
    const bad = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
    bad.gpuClass = 5;
    expect(validateJson(PERF_REPORT_SCHEMA, bad).join('\n')).toMatch(/gpuClass: expected string/);
  });
});

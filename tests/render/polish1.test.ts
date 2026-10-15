// Polish-1 pure parts: the selection ring's per-vertex ground lift, and the spawn-phase refusals of the selection panel.
import { describe, expect, it } from 'vitest';
import { selectRingLiftsM } from '../../src/render/rings';
import { structureFragmentShader } from '../../src/render/shaders/structures';
import { CameraRig } from '../../src/render/camera';
import { maxDistKm } from '../../src/render/fit';
import { selectionInfo, deleteWhyKey, upgradeWhyKey } from '../../src/ui/structureInfo';
import { spawnPhaseBlocks } from '../../src/ui/buildReasons';
import { PHASE_PLAY, PHASE_SPAWN } from '../../src/sim/flow';
import { REJECT_PHASE } from '../../src/sim/intents';

describe('selection ring lifts', () => {
  it('follows a slope: a plane rising 0.2 m per metre to the east lifts the east vertex and lowers the west one; flat ground gives 0', () => {
    const R = 6371000;
    const slope = (_lat: number, lon: number): number => 0.2 * ((lon * Math.PI) / 180) * R; // metres of height, east = up
    const out = new Float32Array(33);
    selectRingLiftsM(0, 10, 1000, 32, 1, R, slope, out);
    expect(out[0]).toBeCloseTo(200, 0); // east
    expect(out[16]).toBeCloseTo(-200, 0); // west
    expect(Math.abs(out[8] as number)).toBeLessThan(1); // north: level
    expect(out[32]).toBeCloseTo(out[0] as number, 3); // closed loop
    selectRingLiftsM(0, 10, 1000, 32, 1, R, () => 500, out);
    expect(Math.max(...out.map(Math.abs))).toBe(0);
    selectRingLiftsM(0, 10, 1000, 32, 1.5, R, slope, out);
    expect(out[0]).toBeCloseTo(300, 0); // the exaggeration is applied
  });
});

describe('spawn phase gate', () => {
  it('spawnPhaseBlocks needs a flow and the spawn phase', () => {
    expect(spawnPhaseBlocks({ flow: true, phase: PHASE_SPAWN })).toBe(true);
    expect(spawnPhaseBlocks({ flow: true, phase: PHASE_PLAY })).toBe(false);
    expect(spawnPhaseBlocks({ flow: false, phase: PHASE_PLAY })).toBe(false);
  });
  it('the panel texts exist for the phase reason', () => {
    expect(upgradeWhyKey(REJECT_PHASE)).toBe('sel.why.phase');
    expect(deleteWhyKey(REJECT_PHASE)).toBe('sel.why.phase');
    expect(typeof selectionInfo).toBe('function');
  });
});

describe('resize while zoomed out', () => {
  it('a camera at the old maximum follows it to the new window shape; one clearly inside keeps its distance', () => {
    const rig = new CameraRig(960, 540);
    rig.setView({ lat: 0, lon: 0, distKm: 1e9, tilt: 0 });
    expect(rig.view.distKm).toBe(maxDistKm(960 / 540));
    rig.setViewport(540, 960); // portrait: the maximum is farther
    expect(rig.view.distKm).toBe(maxDistKm(540 / 960));
    expect(rig.view.distKm).toBeGreaterThan(maxDistKm(960 / 540));
    rig.setViewport(960, 540);
    expect(rig.view.distKm).toBe(maxDistKm(960 / 540)); // and back down
    rig.setView({ distKm: maxDistKm(960 / 540) * 0.9 }); // 10 percent inside: stays
    const before = rig.view.distKm;
    rig.setViewport(540, 960);
    expect(rig.view.distKm).toBe(before);
    rig.setViewport(960, 540);
    rig.setView({ distKm: maxDistKm(960 / 540) * 0.99 }); // within 2 percent of the max: follows
    rig.setViewport(540, 960);
    expect(rig.view.distKm).toBe(maxDistKm(540 / 960));
  });
});

describe('night-side structure shading', () => {
  it('the fragment shader keeps a night floor of the model colour and an owner-coloured rim, with no extra uniform or texture', () => {
    expect(structureFragmentShader).toMatch(/lit = max\(lit, toLinear\(mix\(own, vOwner, [0-9.]+\)[^;]*nightK\)\);/);
    expect(structureFragmentShader).toMatch(/rim = pow\(1\.0 - clamp\(dot\(n, viewDir\)/);
    expect(structureFragmentShader).not.toMatch(/sampler2D/);
  });
});

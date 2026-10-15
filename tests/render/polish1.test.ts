// Polish-1 pure parts: the selection ring's per-vertex ground lift, and the spawn-phase refusals of the selection panel.
import { describe, expect, it } from 'vitest';
import { selectRingLiftsM } from '../../src/render/rings';
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

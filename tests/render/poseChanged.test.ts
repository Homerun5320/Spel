// Fix-4B: `CameraRig.poseChanged(out)` is what lets the deploy mode skip its pick while the camera and the cursor stand still. It must say "changed" for every number that decides
// the pose (the view's latitude, longitude, heading, distance, the tilt that is SHOWN, the window) and "unchanged" otherwise, and it must not allocate.
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/camera';

const fresh = (): Float64Array => new Float64Array(7).fill(Number.NaN);

describe('CameraRig.poseChanged', () => {
  it('is true the first time (an empty memory), false while nothing moves, and true again after each kind of move (mutants: a field left out of the comparison or of the copy)', () => {
    const rig = new CameraRig(960, 540);
    rig.setView({ lat: 40, lon: 10, heading: 30, distKm: 900, tilt: 20 });
    const mem = fresh();
    expect(rig.poseChanged(mem)).toBe(true);
    expect(rig.poseChanged(mem)).toBe(false);
    expect(rig.poseChanged(mem)).toBe(false);
    const moves: Array<[string, () => void]> = [
      ['lat', () => rig.setView({ lat: 41 })],
      ['lon', () => rig.setView({ lon: 11 })],
      ['heading', () => rig.setView({ heading: 31 })],
      ['distKm', () => rig.setView({ distKm: 800 })],
      ['tilt', () => rig.setView({ tilt: 25 })],
      ['width', () => rig.setViewport(1000, 540)],
      ['height', () => rig.setViewport(1000, 560)],
    ];
    for (const [name, move] of moves) {
      move();
      expect(rig.poseChanged(mem), name).toBe(true);
      expect(rig.poseChanged(mem), `${name} then still`).toBe(false);
    }
  });

  it('two rigs with the same view and window agree, and a copy of the memory taken before a move reads "changed" after it', () => {
    const a = new CameraRig(800, 600);
    const b = new CameraRig(800, 600);
    a.setView({ lat: 10, lon: 20, heading: 0, distKm: 500, tilt: 10 });
    b.setView({ lat: 10, lon: 20, heading: 0, distKm: 500, tilt: 10 });
    const ma = fresh();
    const mb = fresh();
    a.poseChanged(ma);
    b.poseChanged(mb);
    expect(Array.from(ma)).toEqual(Array.from(mb));
    const before = ma.slice();
    a.setView({ lon: 21 });
    expect(a.poseChanged(before)).toBe(true);
  });
});

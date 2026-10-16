// The helicopter model (M13a-1): ONE merged procedural low-poly geometry (no asset file, no three), built in a unit disc (x forward = the nose, y up, z to
// the left, y = 0 the skids). Every vertex has a colour and a PART code in `tints`: 0 = neutral, 1 = owner colour (the body and the fin), 2 = the main rotor
// (turns about the y axis in the vertex shader), 4 = the tail rotor (turns about its hub, `HELI_TAIL_HUB`, in the vertex shader). Nothing turns on the
// CPU: the rotor angle is one uniform (shaders/helis.ts).
import { MeshBuilder, type ModelData, type Rgb } from './structureModels';

export const HELI_PART_NEUTRAL = 0;
export const HELI_PART_OWNER = 1;
export const HELI_PART_MAIN_ROTOR = 2;
export const HELI_PART_TAIL_ROTOR = 4;

/** The hub the tail rotor turns about (model units): the model builds its blades around it. */
export const HELI_TAIL_HUB: Rgb = [-0.98, 0.4, 0.08];
/** The height of the main rotor plane. */
export const HELI_ROTOR_Y = 0.62;

const BODY: Rgb = [0.78, 0.8, 0.82];
const BOOM: Rgb = [0.62, 0.64, 0.66];
const GLASS: Rgb = [0.35, 0.5, 0.62];
const SKID: Rgb = [0.18, 0.18, 0.2];
const BLADE: Rgb = [0.1, 0.1, 0.12];
const BLADE_TIP: Rgb = [0.95, 0.85, 0.2];

/** The helicopter: a lofted hexagonal fuselage, a tail boom and fin, two skids, a mast, four main-rotor blades and two tail-rotor blades. */
export function buildHeli(): ModelData {
  const m = new MeshBuilder();
  const N = 6;
  const ring = (x: number, ry: number, rz: number, cy: number, k: number): Rgb => {
    const a = (k / N) * Math.PI * 2;
    return [x, cy + ry * Math.cos(a), rz * Math.sin(a)];
  };
  const loft = (x0: number, ry0: number, rz0: number, cy0: number, x1: number, ry1: number, rz1: number, cy1: number): void => {
    for (let k = 0; k < N; k++) m.quad(ring(x0, ry0, rz0, cy0, k), ring(x0, ry0, rz0, cy0, k + 1), ring(x1, ry1, rz1, cy1, k + 1), ring(x1, ry1, rz1, cy1, k), BODY, HELI_PART_OWNER);
  };
  // fuselage: tail end -> belly -> cockpit, then the nose cone (the two upper faces are glass) and the rear cap
  loft(-0.5, 0.09, 0.09, 0.3, -0.1, 0.23, 0.25, 0.3);
  loft(-0.1, 0.23, 0.25, 0.3, 0.36, 0.2, 0.2, 0.28);
  const nose: Rgb = [0.64, 0.22, 0];
  for (let k = 0; k < N; k++) {
    const glass = k === 0 || k === N - 1;
    m.tri(ring(0.36, 0.2, 0.2, 0.28, k), ring(0.36, 0.2, 0.2, 0.28, k + 1), nose, glass ? GLASS : BODY, glass ? HELI_PART_NEUTRAL : HELI_PART_OWNER);
  }
  const rear: Rgb = [-0.5, 0.3, 0];
  for (let k = 0; k < N; k++) m.tri(rear, ring(-0.5, 0.09, 0.09, 0.3, k + 1), ring(-0.5, 0.09, 0.09, 0.3, k), BOOM, HELI_PART_NEUTRAL);
  // tail boom and fin
  m.beam([-0.48, 0.3, 0], [-1.0, 0.36, 0], 0.045, BOOM, HELI_PART_NEUTRAL);
  m.quad([-0.86, 0.34, 0], [-1.02, 0.34, 0], [-1.04, 0.62, 0], [-0.92, 0.62, 0], BODY, HELI_PART_OWNER);
  // skids and their four cross struts
  for (const z of [-0.2, 0.2]) m.beam([-0.4, 0.04, z], [0.42, 0.04, z], 0.025, SKID, HELI_PART_NEUTRAL);
  for (const x of [-0.18, 0.2]) {
    m.quad([x, 0.04, -0.2], [x + 0.03, 0.04, -0.2], [x + 0.03, 0.14, -0.15], [x, 0.14, -0.15], SKID, HELI_PART_NEUTRAL);
    m.quad([x, 0.04, 0.2], [x + 0.03, 0.04, 0.2], [x + 0.03, 0.14, 0.15], [x, 0.14, 0.15], SKID, HELI_PART_NEUTRAL);
  }
  // mast
  m.beam([0.02, 0.5, 0], [0.02, HELI_ROTOR_Y - 0.01, 0], 0.035, SKID, HELI_PART_NEUTRAL);
  // main rotor: four blades from the hub (the outer quarter of each is yellow so the sweep reads from far away)
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const at = (r: number, w: number): Rgb => [0.02 + c * r - s * w, HELI_ROTOR_Y, s * r + c * w];
    m.quad(at(0.04, -0.045), at(0.74, -0.045), at(0.74, 0.045), at(0.04, 0.045), BLADE, HELI_PART_MAIN_ROTOR);
    m.quad(at(0.74, -0.045), at(1.0, -0.045), at(1.0, 0.045), at(0.74, 0.045), BLADE_TIP, HELI_PART_MAIN_ROTOR);
  }
  // tail rotor: two blades in the x-y plane round the hub, a little outside the fin
  const hub = HELI_TAIL_HUB;
  for (let b = 0; b < 2; b++) {
    const a = b * Math.PI;
    const dx = Math.cos(a) * 0.24;
    const dy = Math.sin(a) * 0.24;
    m.quad([hub[0] - 0.03, hub[1], hub[2]], [hub[0] + 0.03, hub[1], hub[2]], [hub[0] + 0.03 + dx, hub[1] + dy, hub[2]], [hub[0] - 0.03 + dx, hub[1] + dy, hub[2]], BLADE, HELI_PART_TAIL_ROTOR);
  }
  return m.done();
}

let cached: ModelData | null = null;
/** The model, built once. */
export function heliModel(): ModelData {
  cached ??= buildHeli();
  return cached;
}

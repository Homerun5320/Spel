// M13c-2: the ship layer. The model is small and has an owner part; the heading follows the route; one instance per live row, standing on the SEA SURFACE (no ground query: the height
// source is NOT bound in this file, a ground lookup would throw), unloading ships sit lower, a released row is gone, and an empty table draws nothing at all.
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SHIP_INSTANCE_CAP, SHIP_MODEL_MAX_TRIANGLES } from '../../src/render/config';
import { ShipLayer, SHIP_RADIUS, shipHeading } from '../../src/render/shipLayer';
import { buildShip, SHIP_BOW_X, SHIP_PART_OWNER, SHIP_WAKE_X } from '../../src/render/shipModel';
import { shipVertexShader } from '../../src/render/shaders/ships';
import { SHIP_CAPACITY } from '../../src/sim/rules';
import { SHIP_LAND, SHIP_OFF, SHIP_RETURN, SHIP_SAIL, ShipTable } from '../../src/sim/shipTable';

const W = 1024;
const H = 512;
const q = (cell: number): [number, number] => [(cell % W) * 256 + 128, Math.floor(cell / W) * 256 + 128];
const cellAt = (x: number, y: number): number => y * W + x;

/** A row with a route of the given cells, sailing state `state`, at route index `idx`, standing on `pos` (a cell). */
function row(t: ShipTable, id: number, owner: number, state: number, route: number[], idx: number, pos: number): void {
  t.add(id, owner, 1, route[0] as number, 0, 100, (route[route.length - 1] as number) + 1);
  route.forEach((c, k) => (t.route[id * 48 + k] = c));
  t.routeLen[id] = route.length;
  t.routeIdx[id] = idx;
  t.state[id] = state;
  const [x, y] = q(pos);
  t.x[id] = x;
  t.y[id] = y;
}

describe('the ship model', () => {
  it('is small (at most 150 triangles), has an owner-coloured part and a neutral part, and fits the wake behind and the bow before', () => {
    const m = buildShip();
    expect(m.triangles).toBeGreaterThan(20);
    expect(m.triangles).toBeLessThanOrEqual(SHIP_MODEL_MAX_TRIANGLES);
    expect(m.positions.length).toBe(m.triangles * 9);
    expect(m.colors.length).toBe(m.triangles * 9);
    const tints = new Set(Array.from(m.tints));
    expect(tints.has(SHIP_PART_OWNER)).toBe(true);
    expect(tints.has(0)).toBe(true);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      minX = Math.min(minX, m.positions[i] as number);
      maxX = Math.max(maxX, m.positions[i] as number);
    }
    expect([minX, maxX]).toEqual([SHIP_WAKE_X, SHIP_BOW_X].map(Math.fround));
  });

  it('the instance buffer holds exactly the sim table', () => {
    expect(SHIP_INSTANCE_CAP).toBe(SHIP_CAPACITY);
  });

  it('the vertex shader never lets a ship fall under its minimum share of the camera distance and has no upper cap (visible from the globe view)', () => {
    expect(shipVertexShader).toContain('max(1.0, distM * uMinFrac / uSizeM)');
    expect(shipVertexShader).not.toMatch(/min\(\s*max\(1\.0/);
  });
});

describe('shipHeading: the way the route points', () => {
  it('sailing out it points at the waypoint it sails to (east 0, north +pi/2, west pi), across the date line the short way', () => {
    const t = new ShipTable(5);
    row(t, 0, 1, SHIP_SAIL, [cellAt(10, 5), cellAt(20, 5)], 1, cellAt(10, 5));
    expect(shipHeading(t, 0, W, H)).toBeCloseTo(0, 6);
    row(t, 1, 1, SHIP_SAIL, [cellAt(10, 5), cellAt(10, 0)], 1, cellAt(10, 5));
    expect(shipHeading(t, 1, W, H)).toBeCloseTo(Math.PI / 2, 6);
    row(t, 2, 1, SHIP_SAIL, [cellAt(20, 5), cellAt(10, 5)], 1, cellAt(20, 5));
    expect(Math.abs(shipHeading(t, 2, W, H))).toBeCloseTo(Math.PI, 6);
    row(t, 3, 1, SHIP_SAIL, [cellAt(1020, 5), cellAt(3, 5)], 1, cellAt(1020, 5));
    expect(shipHeading(t, 3, W, H)).toBeCloseTo(0, 6); // 7 cells east over the date line, not 1017 west
    row(t, 4, 1, SHIP_SAIL, [cellAt(3, 5), cellAt(1020, 5)], 1, cellAt(3, 5));
    expect(Math.abs(shipHeading(t, 4, W, H))).toBeCloseTo(Math.PI, 6); // 7 cells west over the date line, not 1017 east
  });

  it('returning it points back at the waypoint before; unloading along the last leg; docked back along the first leg', () => {
    const t = new ShipTable(4);
    const route = [cellAt(10, 5), cellAt(20, 5), cellAt(20, 15)];
    row(t, 0, 1, SHIP_RETURN, route, 2, cellAt(20, 10));
    expect(Math.abs(shipHeading(t, 0, W, H))).toBeCloseTo(Math.PI / 2, 6); // from (20,10) towards (20,5): north
    expect(shipHeading(t, 0, W, H)).toBeGreaterThan(0);
    row(t, 1, 1, SHIP_LAND, route, 3, cellAt(20, 15));
    expect(shipHeading(t, 1, W, H)).toBeLessThan(0); // the last leg runs south
    row(t, 2, 1, SHIP_OFF, route, 0, cellAt(10, 5));
    expect(Math.abs(shipHeading(t, 2, W, H))).toBeCloseTo(Math.PI, 6); // the first leg run backwards: west
  });

  it('a route of one point gives 0', () => {
    const t = new ShipTable(2);
    row(t, 0, 1, SHIP_SAIL, [cellAt(10, 5)], 0, cellAt(10, 5));
    expect(shipHeading(t, 0, W, H)).toBe(0);
  });
});

describe('ShipLayer', () => {
  const palette = new Uint8Array(4 * 4);
  palette.set([0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255]);

  function layer(): ShipLayer {
    const l = new ShipLayer({ gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
    l.setOwnerPalette(palette);
    return l;
  }
  const cam = [0, 0, 3];

  it('draws one instance per live row on the sea surface radius, in the owner colour, and sinks only the unloading one', () => {
    const t = new ShipTable(4);
    row(t, 0, 1, SHIP_SAIL, [cellAt(100, 100), cellAt(130, 100)], 1, cellAt(105, 100));
    row(t, 5, 2, SHIP_LAND, [cellAt(100, 200), cellAt(130, 200)], 2, cellAt(130, 200));
    row(t, 9, 3, SHIP_OFF, [cellAt(100, 300), cellAt(130, 300)], 0, cellAt(100, 300));
    const l = layer();
    l.setTable(t, 1);
    l.frame(cam);
    expect(l.count).toBe(3);
    expect(l.meshes).toHaveLength(1);
    expect(l.meshes[0]?.visible).toBe(true);
    const d = l.drawn();
    expect(d.map((s) => s.id)).toEqual([0, 5, 9]);
    expect(d.map((s) => s.sunk)).toEqual([0, 1, 0]);
    for (const s of d) expect(s.radius).toBe(SHIP_RADIUS);
    expect(SHIP_RADIUS).toBeGreaterThan(1);
    expect(SHIP_RADIUS - 1).toBeLessThan(1e-5); // metres above the sea-level sphere, not a ground height
    expect(d[0]?.cellX).toBeCloseTo(105.5, 6);
    expect(d[1]?.owner).toBe(2);
    // the instance colour is the owner's palette entry
    const attr = l.meshes[0]?.geometry.getAttribute('aOwner') as { array: Float32Array };
    expect(Array.from(attr.array.subarray(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(attr.array.subarray(3, 6))).toEqual([0, 0, 1]);
    expect((l.meshes[0]?.geometry as unknown as { instanceCount: number }).instanceCount).toBe(3);
  });

  it('an empty table draws nothing at all, a released row takes its instance away, and the switch hides the layer', () => {
    const t = new ShipTable(4);
    const l = layer();
    l.setTable(t, 1);
    l.frame(cam);
    expect(l.count).toBe(0);
    expect(l.meshes[0]?.visible).toBe(false);
    row(t, 0, 1, SHIP_SAIL, [cellAt(100, 100), cellAt(130, 100)], 1, cellAt(105, 100));
    row(t, 1, 2, SHIP_SAIL, [cellAt(100, 200), cellAt(130, 200)], 1, cellAt(105, 200));
    l.setTable(t, 2);
    l.frame(cam);
    expect([l.count, l.meshes[0]?.visible]).toEqual([2, true]);
    t.remove(0);
    l.setTable(t, 3);
    l.frame(cam);
    expect(l.drawn().map((s) => s.id)).toEqual([1]);
    l.setEnabled(false);
    expect(l.meshes[0]?.visible).toBe(false);
    l.setEnabled(true);
    expect(l.meshes[0]?.visible).toBe(true);
    t.remove(1);
    l.setTable(t, 4);
    l.frame(cam);
    expect([l.count, l.meshes[0]?.visible]).toEqual([0, false]);
  });

  it('rewrites its buffers only when the table version moved (no work for an unchanged table)', () => {
    const t = new ShipTable(4);
    row(t, 0, 1, SHIP_SAIL, [cellAt(100, 100), cellAt(130, 100)], 1, cellAt(105, 100));
    const l = layer();
    l.setTable(t, 1);
    l.frame(cam);
    const first = l.drawn();
    l.setTable(t, 1);
    l.frame(cam);
    expect(l.drawn()).toBe(first); // the same list object: nothing was rebuilt
    l.setTable(t, 2);
    l.frame(cam);
    expect(l.drawn()).not.toBe(first);
  });
});

// Scanline polygon rasteriser for equirectangular grids: even-odd fill, holes, antimeridian.
//
// A polygon is a list of rings (outer rings and holes in any order, GeoJSON [lon, lat] order). Pixel (x, y) is
// covered when its CENTRE lies inside under the even-odd rule: lon = -180 + (x + 0.5) * 360 / width and
// lat = 90 - (y + 0.5) * 180 / height. Rings of one feature are filled together, so a hole, or an island inside
// a hole, comes out right whatever the winding.
//
// Antimeridian: a ring whose consecutive longitudes jump by more than 180 degrees crosses +-180. It is unwrapped
// (continuous longitudes, possibly beyond +-180) and drawn three times (shifted by -360, 0, +360), each copy clipped
// to the grid, so a shape that straddles the seam fills both sides. Natural Earth already splits such shapes at
// +-180, so for that data the jump never happens; the case is covered by tests/bake/raster.test.ts.

export type Ring = ReadonlyArray<readonly [number, number]>;

export interface SpanSink {
  /** Called for every filled run of pixels on row y: columns x0 (inclusive) to x1 (exclusive). */
  (y: number, x0: number, x1: number): void;
}

const POLE_LAT = 89.9999;

/**
 * An edge that runs along a pole (Antarctica is closed along lat -90 from lon 180 to lon -180) covers all longitudes and is
 * not an antimeridian crossing; it never meets a scanline, so it must not trigger the unwrapping.
 */
function isPoleEdge(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.abs(a[1]) >= POLE_LAT && Math.abs(b[1]) >= POLE_LAT;
}

/** Unwraps a ring to continuous longitudes. Returns null if nothing had to change. */
export function unwrapRing(ring: Ring): Array<[number, number]> | null {
  const jump = (a: readonly [number, number], b: readonly [number, number]): number => (isPoleEdge(a, b) ? 0 : b[0] - a[0]);
  let jumps = false;
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(jump(ring[i - 1] as readonly [number, number], ring[i] as readonly [number, number])) > 180) {
      jumps = true;
      break;
    }
  }
  if (!jumps) return null;
  const out: Array<[number, number]> = [];
  let shift = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as readonly [number, number];
    if (i > 0) {
      const d = jump(ring[i - 1] as readonly [number, number], p);
      if (d > 180) shift -= 360;
      else if (d < -180) shift += 360;
    }
    out.push([p[0] + shift, p[1]]);
  }
  return out;
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Fills the polygon (all rings together, even-odd) and reports spans per row. */
export function fillPolygon(rings: ReadonlyArray<Ring>, width: number, height: number, sink: SpanSink): void {
  const dLon = 360 / width;
  const dLat = 180 / height;
  // Edges per row bucket. Edge lists hold [lonA, latA, lonB, latB] with latA < latB after orientation.
  const rowEdges: Array<Edge[] | undefined> = new Array(height);
  let any = false;
  const addRing = (pts: ReadonlyArray<readonly [number, number]>, shift: number): void => {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i] as readonly [number, number];
      const b = pts[(i + 1) % n] as readonly [number, number];
      if (a[1] === b[1]) continue; // horizontal edges never cross a scanline
      const lo = a[1] < b[1] ? a : b;
      const hi = a[1] < b[1] ? b : a;
      // Rows whose centre lat satisfies lo.lat <= lat < hi.lat. Centre of row y is 90 - (y + 0.5) * dLat.
      // lat < hi => y + 0.5 > (90 - hi) / dLat ; lat >= lo => y + 0.5 <= (90 - lo) / dLat.
      let yFirst = Math.floor((90 - hi[1]) / dLat - 0.5) + 1;
      let yLast = Math.floor((90 - lo[1]) / dLat - 0.5);
      if (yFirst < 0) yFirst = 0;
      if (yLast > height - 1) yLast = height - 1;
      if (yFirst > yLast) continue;
      const edge: Edge = { x0: lo[0] + shift, y0: lo[1], x1: hi[0] + shift, y1: hi[1] };
      for (let y = yFirst; y <= yLast; y++) {
        (rowEdges[y] ??= []).push(edge);
      }
      any = true;
    }
  };
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const unwrapped = unwrapRing(ring);
    if (unwrapped) {
      for (const shift of [-360, 0, 360]) addRing(unwrapped, shift);
    } else {
      addRing(ring, 0);
    }
  }
  if (!any) return;
  const xs: number[] = [];
  for (let y = 0; y < height; y++) {
    const edges = rowEdges[y];
    if (!edges) continue;
    const lat = 90 - (y + 0.5) * dLat;
    xs.length = 0;
    for (const e of edges) {
      xs.push(e.x0 + ((lat - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = xs[i] as number;
      const b = xs[i + 1] as number;
      // Columns with centre -180 + (x + 0.5) * dLon in [a, b).
      let x0 = Math.ceil((a + 180) / dLon - 0.5);
      let x1 = Math.ceil((b + 180) / dLon - 0.5);
      if (x0 < 0) x0 = 0;
      if (x1 > width) x1 = width;
      if (x0 < x1) sink(y, x0, x1);
    }
  }
}

/** Convenience: paints `value` into `target` (width x height, row-major). */
export function paintPolygon(target: Uint8Array, width: number, height: number, rings: ReadonlyArray<Ring>, value: number): void {
  fillPolygon(rings, width, height, (y, x0, x1) => {
    target.fill(value, y * width + x0, y * width + x1);
  });
}

/** Rings of a GeoJSON Polygon or MultiPolygon geometry (all polygons, outer rings and holes together). */
export function geometryRings(geometry: { type: string; coordinates: unknown }): Ring[] {
  if (geometry.type === 'Polygon') return geometry.coordinates as Ring[];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as Ring[][]).flat();
  throw new Error(`unsupported geometry type ${geometry.type}`);
}

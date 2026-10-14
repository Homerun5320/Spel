// The one grid mesh every terrain chunk instance is drawn with (pure arrays; chunkTerrain.ts wraps them in a three geometry).
//
// Vertices: (cells + 1)^2 grid points with (gx, gy, 0), gx west to east and gy north to south in 0..1 (the same orientation as the
// rasters), followed by one skirt vertex per edge grid point with (gx, gy, 1): the vertex shader pushes those straight down (toward
// the planet centre) by the skirt depth of the instance, so the wall hangs under the rim of the chunk. The skirt triangles are
// wound so that each wall faces outward from its chunk (a crack is always seen through the open side of the chunk that is higher).
//
// The grid triangles use the winding of the old globe mesh (counter-clockwise seen from outside).

export interface ChunkGrid {
  cells: number;
  /** gx, gy, skirt flag per vertex. */
  position: Float32Array;
  index: Uint16Array;
  gridVertices: number;
  triangles: number;
  skirtTriangles: number;
}

export function buildChunkGrid(cells: number): ChunkGrid {
  if (!Number.isInteger(cells) || cells < 1 || cells > 64) throw new Error(`chunk grid of ${cells} cells is not supported`);
  const n = cells + 1;
  const gridVertices = n * n;
  const skirtVertexOf = new Int32Array(gridVertices).fill(-1);
  let skirtCount = 0;
  const isEdge = (i: number, j: number): boolean => i === 0 || j === 0 || i === cells || j === cells;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (isEdge(i, j)) skirtVertexOf[j * n + i] = gridVertices + skirtCount++;
  const total = gridVertices + skirtCount;
  const position = new Float32Array(total * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      position[v * 3] = i / cells;
      position[v * 3 + 1] = j / cells;
      position[v * 3 + 2] = 0;
      const s = skirtVertexOf[v] as number;
      if (s >= 0) {
        position[s * 3] = i / cells;
        position[s * 3 + 1] = j / cells;
        position[s * 3 + 2] = 1;
      }
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * n + i; // north-west
      const b = a + n; // south-west
      const c = b + 1; // south-east
      const d = a + 1; // north-east
      idx.push(a, b, c, a, c, d);
    }
  }
  const gridTriangles = idx.length / 3;
  // Skirt quads along the four edges, wound to face outward from the chunk (tests/render/chunkMesh.test.ts checks the normals).
  const wall = (p0: number, p1: number): void => {
    // p0 -> p1 is the edge walked clockwise around the chunk seen from above (north-west to north-east to south-east ...).
    const s0 = skirtVertexOf[p0] as number;
    const s1 = skirtVertexOf[p1] as number;
    idx.push(p0, s1, s0, p0, p1, s1);
  };
  for (let i = 0; i < cells; i++) {
    wall(i, i + 1); // north edge, west to east
    wall(cells * n + i + 1, cells * n + i); // south edge, east to west
  }
  for (let j = 0; j < cells; j++) {
    wall(j * n + cells, (j + 1) * n + cells); // east edge, north to south
    wall((j + 1) * n, j * n); // west edge, south to north
  }
  return { cells, position, index: Uint16Array.from(idx), gridVertices, triangles: idx.length / 3, skirtTriangles: idx.length / 3 - gridTriangles };
}

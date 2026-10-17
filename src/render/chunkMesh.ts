// The one grid mesh every terrain chunk instance is drawn with (pure arrays; chunkTerrain.ts wraps them in a three geometry).
//
// Vertices: (cells + 1)^2 grid points with (gx, gy, 0), then for every point on the rim two wall vertices: the BOTTOM (gx, gy, 1) that the
// vertex shader pushes straight down (toward the planet centre) and outward by the skirt depth of the instance, and the TOP (gx, gy, 2)
// that stays at the rim. The wall is its own set of vertices, flagged, so that the fragment shader can shade the whole wall like level
// ground (a wall seen through a hairline between two chunks must not show up as a dark line); the top vertices compute the same
// position as the grid vertex of that rim point (same formulas, same bits), so nothing opens between wall and grid. The wall triangles
// are wound so that each wall faces outward from its chunk (a crack is always seen through the open side of the chunk that is higher).
//
// The grid triangles use the winding of the old globe mesh (counter-clockwise seen from outside).

export interface ChunkGrid {
  cells: number;
  /** gx, gy, wall flag per vertex: 0 grid, 1 wall bottom, 2 wall top. */
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
  const bottomOf = new Int32Array(gridVertices).fill(-1);
  const topOf = new Int32Array(gridVertices).fill(-1);
  let wallCount = 0;
  const isEdge = (i: number, j: number): boolean => i === 0 || j === 0 || i === cells || j === cells;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!isEdge(i, j)) continue;
      bottomOf[j * n + i] = gridVertices + wallCount++;
      topOf[j * n + i] = gridVertices + wallCount++;
    }
  }
  const total = gridVertices + wallCount;
  const position = new Float32Array(total * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      position[v * 3] = i / cells;
      position[v * 3 + 1] = j / cells;
      position[v * 3 + 2] = 0;
      const b = bottomOf[v] as number;
      if (b >= 0) {
        position[b * 3] = i / cells;
        position[b * 3 + 1] = j / cells;
        position[b * 3 + 2] = 1;
        const t = topOf[v] as number;
        position[t * 3] = i / cells;
        position[t * 3 + 1] = j / cells;
        position[t * 3 + 2] = 2;
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
    const b0 = bottomOf[p0] as number;
    const b1 = bottomOf[p1] as number;
    const t0 = topOf[p0] as number;
    const t1 = topOf[p1] as number;
    idx.push(t0, b1, b0, t0, t1, b1);
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

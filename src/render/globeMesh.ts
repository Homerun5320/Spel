// The globe mesh: a lat/lon grid of unit directions. The vertex shader displaces it from the height texture.
// Row 0 is the north pole, column 0 is longitude -180; uv = (column / cols, row / rows) addresses the rasters directly.
import { BufferAttribute, BufferGeometry } from 'three';

export function buildGlobeGeometry(cols: number, rows: number): BufferGeometry {
  const vertexCount = (cols + 1) * (rows + 1);
  const position = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  let v = 0;
  for (let j = 0; j <= rows; j++) {
    const lat = Math.PI / 2 - (Math.PI * j) / rows;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    for (let i = 0; i <= cols; i++) {
      const lon = -Math.PI + (2 * Math.PI * i) / cols;
      position[v * 3] = cl * Math.sin(lon);
      position[v * 3 + 1] = sl;
      position[v * 3 + 2] = cl * Math.cos(lon);
      uv[v * 2] = i / cols;
      uv[v * 2 + 1] = j / rows;
      v++;
    }
  }
  const index = new Uint32Array(cols * rows * 6);
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i; // top left
      const b = a + cols + 1; // bottom left
      const c = b + 1; // bottom right
      const d = a + 1; // top right
      index[k++] = a;
      index[k++] = b;
      index[k++] = c;
      index[k++] = a;
      index[k++] = c;
      index[k++] = d;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

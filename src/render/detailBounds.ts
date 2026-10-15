// The height interval of a quadtree node WITH the terrain detail (M07b). Pure (no three). The quadtree needs, for every node, the lowest and
// the highest radius of the surface that is drawn there (its culling spheres and its distance to the camera): the raster's min / max
// pyramid bounds the BASE, but the detail moves the surface by up to a good share of the local relief (kilometres once the
// exaggeration is applied), so a camera that hovers 300 m over the detailed ground can be several kilometres from the base. The interval
// is therefore taken from the detail itself, once per node (the terrain does not move, so the answers are cached):
//   height = max(g * (base + relief * AMP * S), 1 m)       (src/render/detail.ts)
//   * base: the pyramid's exact range over the node (it bounds every bilinear tap); sea within reach of the relief window makes the low end 0,
//   * relief: between its floor and the largest 3x3 range of the raster within two texels of the node (a bound, the pyramid again),
//   * S, the octave sum: the COARSE octaves (lattice cell at least the node's size, nearly constant over it) are evaluated at the centre and
//     the four corners, widened by how far each can move over the node (a Lipschitz bound per octave); the FINER octaves, down to what the
//     node's level carries, are not sampled: their whole range, a bound that falls with the node's size, is added on both sides.
// This is an ESTIMATE, not a bound (the finer octaves enter with a quarter of their full range): it is what the tree measures its distance to and
// culls with. The interval holds for a drawn octave count of at least the coarse octaves less one (a chunk is drawn near the camera, with the octaves of its
// level or one octave less, see the distance law); a coarse node far from the camera has no coarse octaves at all.
import { chunkGeo, chunkSizeRad, levelCols, levelRows, makeChunkGeo, type ChunkGeo } from './chunkMath';
import { DETAIL_AMP, DETAIL_FREQ0, DETAIL_LAND_MIN_M, DETAIL_OCTAVES_MAX, DETAIL_PERSIST, DETAIL_RELIEF_FLOOR_M, EARTH_RADIUS_KM } from './config';
import { HeightSampler, octavesForLevel } from './detail';
import { POLE_HEIGHT_U } from './geo';
import type { HeightPyramid } from './heightPyramid';

const EARTH_RADIUS_M = EARTH_RADIUS_KM * 1000;
const SIZE = 32768; // table entries (a power of two), two ways: a key may sit in its slot or in the neighbour
const RAD = Math.PI / 180;
/** The largest change of one octave's ridge value per lattice cell of distance: |d(r^2)/dx| <= 4 * 3.3 / cell. */
const OCTAVE_LIPSCHITZ = 13;
/** How far, in nodes' sides, a point of the node is from the nearest of its five samples (the corner to the centre: 0.71 of half a side, rounded up). */
const SAMPLE_REACH = 0.4;

export interface HeightIntervalM {
  lo: number;
  hi: number;
}

export class DetailBounds {
  private readonly keys = new Float64Array(SIZE).fill(-1);
  private readonly los = new Float64Array(SIZE);
  private readonly his = new Float64Array(SIZE);
  private readonly geo: ChunkGeo = makeChunkGeo();
  readonly hits = { hit: 0, miss: 0 };

  constructor(
    private readonly sampler: HeightSampler,
    private readonly pyramid: HeightPyramid,
    private readonly cells: number,
  ) {}

  /**
   * The interval of the detailed surface over the node in render metres (before the exaggeration), written to `out`. Returns false when the
   * node has no land within two texels (the detail is zero there and the caller keeps the base interval).
   */
  range(level: number, ix: number, iy: number, out: HeightIntervalM): boolean {
    const key = (level * 4194304 + ix) * 2097152 + iy;
    // (a full mixing of the key: the low bits of a product depend only on the low bits of the factors, so a plain multiply-shift would hash on the row alone)
    let h = (key | 0) ^ Math.imul((key / 4294967296) | 0, 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    const slot = (h ^ (h >>> 16)) & (SIZE - 1);
    const other = slot ^ 1;
    const hitSlot = this.keys[slot] === key ? slot : this.keys[other] === key ? other : -1;
    if (hitSlot >= 0) {
      this.hits.hit++;
      const lo = this.los[hitSlot] as number;
      if (lo < 0) return false;
      out.lo = lo;
      out.hi = this.his[hitSlot] as number;
      return true;
    }
    this.hits.miss++;
    const ok = this.compute(level, ix, iy, out);
    // an empty way first, else one of the two by a bit of the hash (a third key that maps here replaces one, never both)
    const put = this.keys[slot] === -1 ? slot : this.keys[other] === -1 ? other : h & 0x10000 ? slot : other;
    this.keys[put] = key;
    this.los[put] = ok ? out.lo : -1;
    this.his[put] = ok ? out.hi : 0;
    return ok;
  }

  private compute(level: number, ix: number, iy: number, out: HeightIntervalM): boolean {
    const src = this.sampler.source;
    const cols = levelCols(level);
    const rows = levelRows(level);
    const u0 = ix / cols;
    const u1 = (ix + 1) / cols;
    const v0 = iy / rows;
    const v1 = (iy + 1) / rows;
    const dec = (c: number): number => {
      const f = c / 255;
      return src.maxM * f * f;
    };
    // The relief window reaches two texels past the node: land anywhere there, and the largest range of codes. A node on a pole row also reads
    // the pole column (the pole rows of the mesh take their height at one common longitude, POLE_HEIGHT_U).
    const gu = 2 / src.width;
    const gv = 2 / src.height;
    const onPole = v0 <= 0 || v1 >= 1;
    this.pyramid.range(u0 - gu, u1 + gu, v0 - gv, v1 + gv);
    let wideHi = this.pyramid.maxCode;
    let wideLo = this.pyramid.minCode;
    if (onPole) {
      this.pyramid.range(POLE_HEIGHT_U - gu, POLE_HEIGHT_U + gu, v0 - gv, v1 + gv);
      wideHi = Math.max(wideHi, this.pyramid.maxCode);
      wideLo = Math.min(wideLo, this.pyramid.minCode);
    }
    if (wideHi === 0) return false;
    this.pyramid.range(u0, u1, v0, v1);
    let baseHiCode = this.pyramid.maxCode;
    let baseLoCode = this.pyramid.minCode;
    if (onPole) {
      this.pyramid.range(POLE_HEIGHT_U, POLE_HEIGHT_U, v0, v1);
      baseHiCode = Math.max(baseHiCode, this.pyramid.maxCode);
      baseLoCode = Math.min(baseLoCode, this.pyramid.minCode);
    }
    const baseHi = dec(baseHiCode);
    const baseLo = dec(baseLoCode);
    const reliefHi = Math.max(DETAIL_RELIEF_FLOOR_M, dec(wideHi) - dec(wideLo));
    const reliefLo = DETAIL_RELIEF_FLOOR_M;
    // The octave sum S: samples of the coarse octaves, the Lipschitz allowance over the node, the full range of the finer octaves.
    const g = chunkGeo(level, ix, iy, this.geo);
    const sizeM = chunkSizeRad(level) * EARTH_RADIUS_M;
    const c0 = EARTH_RADIUS_M / DETAIL_FREQ0;
    const nLevel = octavesForLevel(level, this.cells);
    const nCoarse = Math.min(Math.ceil(nLevel), Math.max(0, Math.floor(Math.log2(c0 / sizeM)) + 1));
    let sLo = Infinity;
    let sHi = -Infinity;
    if (nCoarse > 0) {
      const lat0 = g.latC / RAD;
      const lon0 = g.lonC / RAD;
      const dLat = (g.dLat / RAD) * 0.5;
      const dLon = (g.dLon / RAD) * 0.5;
      for (let k = 0; k < 5; k++) {
        const lat = Math.max(-90, Math.min(90, lat0 + (k === 0 ? 0 : k & 1 ? dLat : -dLat)));
        const lon = lon0 + (k === 0 ? 0 : k & 2 ? dLon : -dLon);
        const s = this.sampler.detailSumAt(lat, lon, nCoarse);
        if (s < sLo) sLo = s;
        if (s > sHi) sHi = s;
      }
    } else {
      sLo = 0;
      sHi = 0;
    }
    let slack = 0;
    let amp = 1;
    for (let k = 0; k < DETAIL_OCTAVES_MAX; k++) {
      if (k < nCoarse) slack += amp * Math.min(1, (OCTAVE_LIPSCHITZ * SAMPLE_REACH * sizeM) / (c0 / 2 ** k));
      else if (k < Math.ceil(nLevel)) slack += 0.5 * amp;
      amp *= DETAIL_PERSIST;
    }
    // The estimate takes a quarter of the allowance: the certain bound would put every node near the camera in front of a wall of its own
    // height (the exaggerated terrain is steep) and make the tree split four times as much for nothing; 191 000 sampled heights of the
    // tests stay inside this interval.
    const slackTight = 0.25 * slack;
    sLo -= slackTight;
    sHi += slackTight;
    const dHi = (sHi > 0 ? reliefHi : reliefLo) * DETAIL_AMP * sHi;
    const dLo = (sLo < 0 ? reliefHi : reliefLo) * DETAIL_AMP * sLo;
    // (the coast fade and the 1 m floor: with sea inside the relief window the surface can come down to the sea level; land is never lower than its floor)
    out.hi = Math.max(DETAIL_LAND_MIN_M, baseHi + dHi);
    out.lo = wideLo === 0 ? 0 : Math.max(DETAIL_LAND_MIN_M, baseLo + dLo);
    return true;
  }
}

// Federations bake (M18b-1): Natural Earth admin-1 provinces on the sim grid, and the sub-nations ("delnationer") of the big
// countries. Pure and deterministic: no clock, no random, fixed iteration orders. Input is the sim country and land layers
// (from the freshly built or the committed sim pack) and the admin-1 GeoJSON; the output is a `Federations` (src/data/federations.ts).
import { SIM_HEIGHT, SIM_WIDTH } from '../../src/data/format';
import type { Federations, Province, SubNation } from '../../src/data/federations';
import { FEDERATION_MAX_SUBNATIONS, FEDERATION_MIN_AREA_CELLS, FEDERATION_MIN_PROVINCE_CELLS, PROVINCE_TINY_CELLS } from './classify';
import { fillPolygon, geometryRings, type Ring } from './raster';

const W = SIM_WIDTH;
const H = SIM_HEIGHT;
const N = W * H;

export interface Admin1Feature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}
export interface CountryRef {
  id: number;
  a3: string;
  name_en: string;
}

const str = (v: unknown): string => (typeof v === 'string' && v !== '' && v !== '-99' ? v : '');

/** Squared planar distance between two cells with wrap in x. */
function dist2(a: number, b: number): number {
  const ax = a % W;
  const bx = b % W;
  let dx = Math.abs(ax - bx);
  if (dx > W / 2) dx = W - dx;
  const dy = Math.floor(a / W) - Math.floor(b / W);
  return dx * dx + dy * dy;
}

/** Centre of a cell set: the circular mean of x, the mean of y, snapped to the nearest member cell (so it lies inside). */
function centroidOf(cells: ArrayLike<number>): number {
  if (cells.length === 0) return -1;
  let sx = 0;
  let sy = 0;
  let sc = 0;
  let sn = 0;
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k] as number;
    const a = (((c % W) + 0.5) / W) * 2 * Math.PI;
    sx += Math.cos(a);
    sc += Math.sin(a);
    sy += Math.floor(c / W);
    sn++;
  }
  let ang = Math.atan2(sc, sx);
  if (ang < 0) ang += 2 * Math.PI;
  const cx = Math.min(W - 1, Math.floor((ang / (2 * Math.PI)) * W));
  const cy = Math.min(H - 1, Math.floor(sy / sn));
  const target = cy * W + cx;
  let best = cells[0] as number;
  let bd = dist2(best, target);
  for (let k = 1; k < cells.length; k++) {
    const c = cells[k] as number;
    const d = dist2(c, target);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export interface FederationBuild {
  federations: Federations;
  /** Provinces that were skipped: admin-1 features whose country is unknown. */
  skipped: string[];
}

export function buildFederations(simCountry: Uint8Array, simLand: Uint8Array, countries: readonly CountryRef[], admin1: readonly Admin1Feature[]): FederationBuild {
  const countryCount = countries.length;
  const countryOfA3 = new Map<string, number>();
  countries.forEach((c, i) => countryOfA3.set(c.a3, i));
  const skipped: string[] = [];

  // ---- 1. Provinces: stable ids by (country index, key) ---------------------------------------------------------------
  interface Feat {
    country: number;
    key: string;
    name: string;
    rings: Ring[];
  }
  const feats: Feat[] = [];
  for (const f of admin1) {
    const a3 = str(f.properties.adm0_a3);
    const country = countryOfA3.get(a3);
    const name = str(f.properties.name_en) || str(f.properties.name);
    if (country === undefined || name === '') {
      skipped.push(`${a3 || '?'}:${name || '?'}`);
      continue;
    }
    feats.push({ country, key: str(f.properties.iso_3166_2) || name, name, rings: geometryRings(f.geometry) });
  }
  feats.sort((a, b) => a.country - b.country || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // Keys must be unique inside a country: a repeated key gets the name appended.
  const seenKey = new Set<string>();
  for (const f of feats) {
    let k = f.key;
    if (seenKey.has(`${f.country}|${k}`)) k = `${f.key}/${f.name}`;
    if (seenKey.has(`${f.country}|${k}`)) throw new Error(`duplicate province key ${k}`);
    seenKey.add(`${f.country}|${k}`);
    f.key = k;
  }
  if (feats.length > 65535) throw new Error('too many provinces for a u16');

  const raw = new Uint16Array(N);
  feats.forEach((f, i) => {
    fillPolygon(f.rings, W, H, (y, x0, x1) => {
      raw.fill(i + 1, y * W + x0, y * W + x1);
    });
  });
  const provCountry = (p: number): number => (feats[p - 1] as Feat).country;

  // ---- 2. Province raster: land cells of countries with provinces; gaps by a deterministic flood fill ---------------------
  const hasProv = new Uint8Array(countryCount);
  for (const f of feats) hasProv[f.country] = 1;
  const eligible = (i: number): boolean => simLand[i] === 1 && simCountry[i] !== 0 && hasProv[(simCountry[i] as number) - 1] === 1;
  const prov = new Uint16Array(N);
  const queue = new Int32Array(N);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < N; i++) {
    const p = raw[i] as number;
    if (p !== 0 && eligible(i) && provCountry(p) === (simCountry[i] as number) - 1) {
      prov[i] = p;
      queue[qt++] = i;
    }
  }
  while (qh < qt) {
    const i = queue[qh++] as number;
    const x = i % W;
    const y = (i - x) / W;
    const p = prov[i] as number;
    // Fixed neighbour order: west, east, north, south.
    for (let d = 0; d < 4; d++) {
      let j: number;
      if (d === 0) j = y * W + ((x + W - 1) % W);
      else if (d === 1) j = y * W + ((x + 1) % W);
      else if (d === 2) j = y > 0 ? i - W : -1;
      else j = y < H - 1 ? i + W : -1;
      if (j < 0 || prov[j] !== 0 || !eligible(j)) continue;
      if ((simCountry[j] as number) !== (simCountry[i] as number)) continue;
      prov[j] = p;
      queue[qt++] = j;
    }
  }
  // Cells no flood reaches (an island with no province polygon): the nearest province centroid of the same country.
  const cellsOfProv: number[][] = Array.from({ length: feats.length + 1 }, () => []);
  for (let i = 0; i < N; i++) if (prov[i] !== 0) (cellsOfProv[prov[i] as number] as number[]).push(i);
  const centroids = cellsOfProv.map((c) => centroidOf(c));
  const provsOfCountry: number[][] = Array.from({ length: countryCount }, () => []);
  feats.forEach((f, i) => (provsOfCountry[f.country] as number[]).push(i + 1));
  for (let i = 0; i < N; i++) {
    if (prov[i] !== 0 || !eligible(i)) continue;
    const ci = (simCountry[i] as number) - 1;
    let best = 0;
    let bd = Infinity;
    for (const p of provsOfCountry[ci] as number[]) {
      const c = centroids[p] as number;
      if (c < 0) continue;
      const d = dist2(i, c);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best !== 0) {
      prov[i] = best;
      (cellsOfProv[best] as number[]).push(i);
    }
  }

  const provinces: Province[] = feats.map((f, i) => {
    const cells = cellsOfProv[i + 1] as number[];
    cells.sort((a, b) => a - b);
    return { id: i + 1, country: f.country, key: f.key, name: f.name, cells: cells.length, centroid: centroidOf(cells), tiny: cells.length <= PROVINCE_TINY_CELLS };
  });
  const provinceCount = new Uint16Array(countryCount);
  for (const p of provinces) provinceCount[p.country] = (provinceCount[p.country] as number) + 1;

  // ---- 3. Candidates ---------------------------------------------------------------------------------------------------
  const landCells = new Uint32Array(countryCount);
  for (let i = 0; i < N; i++) if (simLand[i] === 1 && simCountry[i] !== 0) landCells[(simCountry[i] as number) - 1] = (landCells[(simCountry[i] as number) - 1] as number) + 1;
  const candidate = new Uint8Array(countryCount);
  for (let c = 0; c < countryCount; c++) candidate[c] = hasProv[c] === 1 && (landCells[c] as number) >= FEDERATION_MIN_AREA_CELLS ? 1 : 0;

  // ---- 4. Sub-nations: merge the smallest provinces into their smallest neighbour ------------------------------------------
  const federationRaster = new Uint8Array(N);
  const subNations: SubNation[] = [];
  const membersByCountry: number[][] = Array.from({ length: countryCount }, () => []);
  for (let c = 0; c < countryCount; c++) {
    if (candidate[c] !== 1) continue;
    interface Group {
      provs: number[];
      cells: number;
    }
    let groups: Group[] = (provsOfCountry[c] as number[])
      .filter((p) => (provinces[p - 1] as Province).cells > 0)
      .map((p) => ({ provs: [p], cells: (provinces[p - 1] as Province).cells }));
    // Adjacency: shared cell edges between provinces of this country (east and south neighbours, wrap in x).
    const edge = new Map<number, number>();
    const key = (a: number, b: number): number => (a < b ? a * 65536 + b : b * 65536 + a);
    for (let i = 0; i < N; i++) {
      const p = prov[i] as number;
      if (p === 0 || provCountry(p) !== c) continue;
      const x = i % W;
      const e = prov[x === W - 1 ? i - W + 1 : i + 1] as number;
      const s = i + W < N ? (prov[i + W] as number) : 0;
      if (e !== 0 && e !== p && provCountry(e) === c) edge.set(key(p, e), (edge.get(key(p, e)) ?? 0) + 1);
      if (s !== 0 && s !== p && provCountry(s) === c) edge.set(key(p, s), (edge.get(key(p, s)) ?? 0) + 1);
    }
    const border = (a: Group, b: Group): number => {
      let sum = 0;
      for (const p of a.provs) for (const q of b.provs) sum += edge.get(key(p, q)) ?? 0;
      return sum;
    };
    const far = (a: Group, b: Group): number => {
      let best = Infinity;
      for (const p of a.provs) for (const q of b.provs) best = Math.min(best, dist2(provinces[p - 1]!.centroid, provinces[q - 1]!.centroid));
      return best;
    };
    const firstId = (g: Group): number => g.provs[0] as number;
    for (;;) {
      if (groups.length <= 1) break;
      let small = groups[0] as Group;
      for (const g of groups) if (g.cells < small.cells || (g.cells === small.cells && firstId(g) < firstId(small))) small = g;
      if (small.cells >= FEDERATION_MIN_PROVINCE_CELLS && groups.length <= FEDERATION_MAX_SUBNATIONS) break;
      const others = groups.filter((g) => g !== small);
      let pick: Group | null = null;
      let pickBorder = 0;
      for (const g of others) {
        const b = border(small, g);
        if (b === 0) continue;
        if (pick === null || g.cells < pick.cells || (g.cells === pick.cells && (b > pickBorder || (b === pickBorder && firstId(g) < firstId(pick))))) {
          pick = g;
          pickBorder = b;
        }
      }
      if (pick === null) {
        // No land neighbour (an island): the nearest group by province centroids, ties by the lower first id.
        let bd = Infinity;
        for (const g of others) {
          const d = far(small, g);
          if (d < bd || (d === bd && pick !== null && firstId(g) < firstId(pick))) {
            bd = d;
            pick = g;
          }
        }
      }
      const target = pick as Group;
      target.provs = [...target.provs, ...small.provs].sort((a, b) => a - b);
      target.cells += small.cells;
      groups = groups.filter((g) => g !== small);
    }
    // Names, order: biggest first (ties by the name), ids are global and follow the country order.
    const named = groups.map((g) => {
      const bySize = [...g.provs].sort((a, b) => (provinces[b - 1] as Province).cells - (provinces[a - 1] as Province).cells || a - b);
      const nm = (p: number): string => (provinces[p - 1] as Province).name;
      let name = nm(bySize[0] as number);
      if (bySize.length === 2) name = `${name} and ${nm(bySize[1] as number)}`;
      else if (bySize.length > 2) name = `${name} Region`;
      return { g, name };
    });
    named.sort((a, b) => b.g.cells - a.g.cells || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const usedNames = new Set<string>();
    for (const n of named) {
      if (usedNames.has(n.name)) n.name = `${n.name} ${(n.g.provs[0] as number).toString()}`;
      usedNames.add(n.name);
    }
    for (const { g, name } of named) {
      const id = subNations.length + 1;
      const cells: number[] = [];
      for (const p of g.provs) for (const cell of cellsOfProv[p] as number[]) cells.push(cell);
      cells.sort((a, b) => a - b);
      for (const cell of cells) federationRaster[cell] = id;
      subNations.push({ id, country: c, name, cells: cells.length, centroid: centroidOf(cells), provinces: g.provs });
      (membersByCountry[c] as number[]).push(id);
    }
  }
  if (subNations.length > 255) throw new Error(`${subNations.length} sub-nations do not fit a u8`);
  const federations: Federations = {
    width: W,
    height: H,
    countryCount,
    candidate,
    provinceCount,
    provinces,
    subNations,
    provinceRaster: prov,
    federationRaster,
    membersByCountry,
  };
  return { federations, skipped };
}

/** Text report per candidate country: sub-nation names and sizes (pasted into docs/DECISIONS.md). */
export function formatReport(f: Federations, countries: readonly CountryRef[]): string {
  const lines: string[] = [];
  for (let c = 0; c < f.countryCount; c++) {
    if (f.candidate[c] !== 1) continue;
    const cn = countries[c] as CountryRef;
    const members = f.membersByCountry[c] as number[];
    let cells = 0;
    for (const id of members) cells += (f.subNations[id - 1] as SubNation).cells;
    lines.push(`${cn.a3} ${cn.name_en}: ${cells} cells, ${f.provinceCount[c]} provinces -> ${members.length} sub-nations`);
    for (const id of members) {
      const s = f.subNations[id - 1] as SubNation;
      lines.push(`  ${String(id).padStart(3)} ${s.name} (${s.cells} cells, ${s.provinces.length} provinces)`);
    }
  }
  return lines.join('\n');
}

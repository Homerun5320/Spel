// Federations pack (M18b-1): provinces (Natural Earth admin-1) and sub-nations ("delnationer") of the large countries,
// with the binary format shared by the baker (tools/bake/federations.ts) and the loader. Pure: no DOM, no three.
// Not wired into the game yet; M18b-2 builds the match set-up from the helpers at the end of this file.
//
// Layout (little-endian). Header 20 bytes: magic "SPFD", u32 version, u16 width, u16 height, u16 countries, u16 provinces,
// u16 federations, u16 0. Then: country table (countries x 4 bytes: u8 flags bit0 = candidate, u8 0, u16 province count),
// province records (u16 country index, u8 flags bit0 = tiny, u8 0, u32 cells, u32 centroid cell or 0xFFFFFFFF,
// string key, string name), federation records (u16 country index, u16 member count, u32 cells, u32 centroid cell,
// member count x u16 province ids, string name), the province raster (u16 per cell) and the federation raster (u8 per cell).
// A string is a u8 byte length and UTF-8 bytes. Ids are 1-based; 0 in a raster means "none". Country indexes are indexes
// into meta.json "countries" (country id - 1, the id the sim country layer holds).
import type { DataLoader } from './loader';
import { SIM_HEIGHT, SIM_WIDTH } from './format';


export const FEDERATIONS_PACK = 'federations';
export const FEDERATIONS_VERSION = 1;
const MAGIC = [0x53, 0x50, 0x46, 0x44]; // "SPFD"
const NO_CELL = 0xffffffff;
const HEADER_BYTES = 20;

export interface Province {
  /** 1-based id (index + 1 in `Federations.provinces`). */
  id: number;
  /** Index into meta.json countries. */
  country: number;
  /** Short stable key: iso_3166_2 when Natural Earth has one, else the name. */
  key: string;
  name: string;
  /** Sim land cells. */
  cells: number;
  /** A cell inside the province, near its centre; -1 when the province has no cell. */
  centroid: number;
  /** Too small to be a sub-nation of its own (0 or 1 cell). */
  tiny: boolean;
}

export interface SubNation {
  /** 1-based id (index + 1 in `Federations.subNations`), the value of the federation raster. */
  id: number;
  country: number;
  name: string;
  cells: number;
  centroid: number;
  /** Province ids that make it up, ascending. */
  provinces: number[];
}

export interface Federations {
  width: number;
  height: number;
  countryCount: number;
  /** Per country index: 1 when the country is a federation candidate. */
  candidate: Uint8Array;
  /** Per country index: number of provinces in the table. */
  provinceCount: Uint16Array;
  provinces: Province[];
  subNations: SubNation[];
  /** Province id per sim cell, 0 = none (sea, or a country without provinces). */
  provinceRaster: Uint16Array;
  /** Sub-nation id per sim cell, 0 = none (sea, or a country that is not a candidate). */
  federationRaster: Uint8Array;
  /** Sub-nation ids per country index, ascending (empty for a non-candidate). */
  membersByCountry: number[][];
}

export class FederationDataError extends Error {
  constructor(message: string) {
    super(`federations pack: ${message}`);
    this.name = 'FederationDataError';
  }
}

// ---- writer (used by the baker and the tests) -------------------------------------------------------------------------

export function packFederations(f: Federations): Uint8Array {
  const enc = new TextEncoder();
  const str = (s: string): Uint8Array => {
    const b = enc.encode(s);
    if (b.length > 255) throw new Error(`string too long for the pack: ${s}`);
    return b;
  };
  let size = HEADER_BYTES + f.countryCount * 4;
  const pk = f.provinces.map((p) => [str(p.key), str(p.name)] as const);
  const sk = f.subNations.map((s) => str(s.name));
  f.provinces.forEach((_, i) => {
    size += 12 + 2 + (pk[i] as readonly Uint8Array[])[0]!.length + (pk[i] as readonly Uint8Array[])[1]!.length;
  });
  f.subNations.forEach((s, i) => {
    size += 12 + 2 * s.provinces.length + 1 + (sk[i] as Uint8Array).length;
  });
  const cellsN = f.width * f.height;
  size += cellsN * 2 + cellsN;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  const u8 = (v: number): void => {
    dv.setUint8(o, v);
    o += 1;
  };
  const u16 = (v: number): void => {
    dv.setUint16(o, v, true);
    o += 2;
  };
  const u32 = (v: number): void => {
    dv.setUint32(o, v, true);
    o += 4;
  };
  const putStr = (b: Uint8Array): void => {
    u8(b.length);
    out.set(b, o);
    o += b.length;
  };
  for (const m of MAGIC) u8(m);
  u32(FEDERATIONS_VERSION);
  u16(f.width);
  u16(f.height);
  u16(f.countryCount);
  u16(f.provinces.length);
  u16(f.subNations.length);
  u16(0);
  for (let c = 0; c < f.countryCount; c++) {
    u8(f.candidate[c] === 1 ? 1 : 0);
    u8(0);
    u16(f.provinceCount[c] as number);
  }
  f.provinces.forEach((p, i) => {
    u16(p.country);
    u8(p.tiny ? 1 : 0);
    u8(0);
    u32(p.cells);
    u32(p.centroid < 0 ? NO_CELL : p.centroid);
    putStr((pk[i] as readonly Uint8Array[])[0] as Uint8Array);
    putStr((pk[i] as readonly Uint8Array[])[1] as Uint8Array);
  });
  f.subNations.forEach((s, i) => {
    u16(s.country);
    u16(s.provinces.length);
    u32(s.cells);
    u32(s.centroid < 0 ? NO_CELL : s.centroid);
    for (const p of s.provinces) u16(p);
    putStr(sk[i] as Uint8Array);
  });
  for (let i = 0; i < cellsN; i++) u16(f.provinceRaster[i] as number);
  out.set(f.federationRaster, o);
  o += cellsN;
  if (o !== size) throw new Error(`federations pack size mismatch ${o} vs ${size}`);
  return out;
}

// ---- parser -----------------------------------------------------------------------------------------------------------

/** Parses and validates a payload. Throws `FederationDataError` on anything that is not a consistent pack. */
export function parseFederations(bytes: Uint8Array, expectCountries?: number): Federations {
  const bad = (m: string): never => {
    throw new FederationDataError(m);
  };
  if (bytes.length < HEADER_BYTES) bad(`only ${bytes.length} bytes`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) bad('bad magic');
  const version = dv.getUint32(4, true);
  if (version !== FEDERATIONS_VERSION) bad(`version ${version}, expected ${FEDERATIONS_VERSION}`);
  const width = dv.getUint16(8, true);
  const height = dv.getUint16(10, true);
  const countryCount = dv.getUint16(12, true);
  const nProv = dv.getUint16(14, true);
  const nFed = dv.getUint16(16, true);
  if (width !== SIM_WIDTH || height !== SIM_HEIGHT) bad(`grid ${width}x${height}, expected ${SIM_WIDTH}x${SIM_HEIGHT}`);
  if (expectCountries !== undefined && countryCount !== expectCountries) bad(`${countryCount} countries, expected ${expectCountries}`);
  if (nFed > 255) bad('more than 255 sub-nations');
  let o = HEADER_BYTES;
  const need = (n: number): void => {
    if (o + n > bytes.length) bad('truncated');
  };
  const dec = new TextDecoder('utf-8', { fatal: true });
  const str = (): string => {
    need(1);
    const n = bytes[o] as number;
    o += 1;
    need(n);
    let s: string;
    try {
      s = dec.decode(bytes.subarray(o, o + n));
    } catch {
      return bad('invalid UTF-8');
    }
    o += n;
    return s;
  };
  need(countryCount * 4);
  const candidate = new Uint8Array(countryCount);
  const provinceCount = new Uint16Array(countryCount);
  for (let c = 0; c < countryCount; c++) {
    const flags = dv.getUint8(o);
    if (flags > 1 || dv.getUint8(o + 1) !== 0) bad('bad country flags');
    candidate[c] = flags;
    provinceCount[c] = dv.getUint16(o + 2, true);
    o += 4;
  }
  const cellsN = width * height;
  const provinces: Province[] = [];
  const perCountry = new Uint16Array(countryCount);
  for (let i = 0; i < nProv; i++) {
    need(12);
    const country = dv.getUint16(o, true);
    const flags = dv.getUint8(o + 2);
    const cells = dv.getUint32(o + 4, true);
    const cen = dv.getUint32(o + 8, true);
    o += 12;
    if (country >= countryCount) bad(`province ${i + 1}: country ${country} out of range`);
    if (flags > 1 || dv.getUint8(o - 9) !== 0) bad(`province ${i + 1}: bad flags`);
    if (cen !== NO_CELL && cen >= cellsN) bad(`province ${i + 1}: centroid out of range`);
    if (cells > cellsN) bad(`province ${i + 1}: cells out of range`);
    const key = str();
    const name = str();
    perCountry[country] = (perCountry[country] as number) + 1;
    provinces.push({ id: i + 1, country, key, name, cells, centroid: cen === NO_CELL ? -1 : cen, tiny: flags === 1 });
  }
  for (let c = 0; c < countryCount; c++) if (perCountry[c] !== provinceCount[c]) bad(`country ${c}: province count differs from the table`);
  const subNations: SubNation[] = [];
  const membersByCountry: number[][] = Array.from({ length: countryCount }, () => []);
  for (let i = 0; i < nFed; i++) {
    need(12);
    const country = dv.getUint16(o, true);
    const n = dv.getUint16(o + 2, true);
    const cells = dv.getUint32(o + 4, true);
    const cen = dv.getUint32(o + 8, true);
    o += 12;
    if (country >= countryCount) bad(`sub-nation ${i + 1}: country out of range`);
    if (candidate[country] !== 1) bad(`sub-nation ${i + 1}: its country is not a candidate`);
    if (n === 0) bad(`sub-nation ${i + 1}: no provinces`);
    need(n * 2);
    const ps: number[] = [];
    for (let k = 0; k < n; k++) {
      const p = dv.getUint16(o, true);
      o += 2;
      const prov = provinces[p - 1];
      if (!prov || prov.country !== country) bad(`sub-nation ${i + 1}: province ${p} is not one of its country`);
      if (k > 0 && p <= (ps[k - 1] as number)) bad(`sub-nation ${i + 1}: provinces not ascending`);
      ps.push(p);
    }
    if (cen === NO_CELL || cen >= cellsN) bad(`sub-nation ${i + 1}: centroid out of range`);
    const name = str();
    subNations.push({ id: i + 1, country, name, cells, centroid: cen, provinces: ps });
    (membersByCountry[country] as number[]).push(i + 1);
  }
  need(cellsN * 3);
  if (o + cellsN * 3 !== bytes.length) bad(`${bytes.length - o - cellsN * 3} trailing bytes`);
  const provinceRaster = new Uint16Array(cellsN);
  for (let i = 0; i < cellsN; i++) {
    const v = dv.getUint16(o + i * 2, true);
    if (v > nProv) bad(`province raster value ${v} out of range at cell ${i}`);
    provinceRaster[i] = v;
  }
  o += cellsN * 2;
  const federationRaster = bytes.slice(o, o + cellsN);
  const fedCells = new Uint32Array(nFed + 1);
  for (let i = 0; i < cellsN; i++) {
    const v = federationRaster[i] as number;
    if (v > nFed) bad(`federation raster value ${v} out of range at cell ${i}`);
    fedCells[v] = (fedCells[v] as number) + 1;
  }
  for (const s of subNations) if (fedCells[s.id] !== s.cells) bad(`sub-nation ${s.id}: raster holds ${fedCells[s.id]} cells, table says ${s.cells}`);
  const provCells = new Uint32Array(nProv + 1);
  for (let i = 0; i < cellsN; i++) provCells[provinceRaster[i] as number] = (provCells[provinceRaster[i] as number] as number) + 1;
  for (const p of provinces) if (provCells[p.id] !== p.cells) bad(`province ${p.id}: raster holds ${provCells[p.id]} cells, table says ${p.cells}`);
  return { width, height, countryCount, candidate, provinceCount, provinces, subNations, provinceRaster, federationRaster, membersByCountry };
}

/** Loads the pack through the manifest loader (integrity checked there) and parses it. */
export async function loadFederations(loader: DataLoader, expectCountries?: number): Promise<Federations> {
  return parseFederations(await loader.loadPack(FEDERATIONS_PACK), expectCountries);
}

// ---- helpers for the match set-up (M18b-2) ----------------------------------------------------------------------------

/** Sub-nation id (1-based) of a sim cell, or 0 when the cell is sea or its country is not a federation candidate. */
export function federationOfCell(f: Federations, cell: number): number {
  return f.federationRaster[cell] ?? 0;
}

/** Sub-nation ids of a country index (index into meta.json countries), ascending; empty when it is not a candidate. */
export function membersOfCountry(f: Federations, countryIndex: number): readonly number[] {
  return f.membersByCountry[countryIndex] ?? [];
}

export function isFederationCandidate(f: Federations, countryIndex: number): boolean {
  return f.candidate[countryIndex] === 1;
}

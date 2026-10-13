// The pure bake pipeline: raw inputs in, pack payloads and JSON documents out. No file or network access here
// (index.ts does that), so the same function runs on real data and on the synthetic pipeline-test input.
import {
  BATHY_HEIGHT,
  BATHY_WIDTH,
  COAST_LAND_BIT,
  COAST_WATER_BIT,
  DEPTH_MAX_M,
  LAND_MAX_M,
  MIN_LAND_CODE,
  NAV_BLOCK,
  NAV_HEIGHT,
  NAV_WIDTH,
  NavFlag,
  PACK_LAYERS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  SIM_BLOCK,
  SIM_HEIGHT,
  SIM_WIDTH,
  TERRAIN_CLASS_NAMES,
  TerrainClass,
  encodeDepth,
  encodeLandHeight,
  layoutOf,
  type PackName,
} from '../../src/data/format';
import {
  COUNTRY_SEARCH_PIXELS,
  ICE_COUNTRY_A3,
  LAND_MIN_PIXELS,
  MAX_CITIES,
  MIN_PLAYABLE_CELLS,
  RUGGEDNESS_STEP_M,
  SNAP_RADIUS_CELLS,
  classifyLand,
  classifyWater,
} from './classify';
import { fillPolygon, geometryRings, paintPolygon, type Ring } from './raster';
import { cleanHeights, resampleToRender, type ClampStats } from './terrarium';

export const EARTH_RADIUS_KM = 6371.0088;

export interface GeoFeature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}
export interface GeoCollection {
  features: GeoFeature[];
}

export interface BuildInputs {
  /** Raw Terrarium heights on the 4096 x 4096 Mercator grid (modified in place by the cleaning step). */
  merc: Float32Array;
  countries: GeoCollection;
  places: GeoCollection;
  ports: GeoCollection;
  naturalEarthSha: string;
  log?: (s: string) => void;
}

export interface CountryRecord {
  id: number;
  a3: string;
  name_en: string;
  name_sv: string;
  name_long: string;
  continent: string;
  population: number;
  /** Land sim cells. */
  cells: number;
  /** Sum of the cos(lat)-weighted areas of the land sim cells (km2). */
  weightedAreaKm2: number;
  /** Cell index (y * 1024 + x) of the capital cell, or null when the country has no land cell. */
  capitalCell: number | null;
  capitalSource: 'city' | 'central' | null;
  capitalName: string | null;
  playable: boolean;
}

export interface CityRecord {
  name: string;
  lat: number;
  lon: number;
  population: number;
  cell: number;
  country: number;
  capital: boolean;
}

export interface PortRecord {
  name: string;
  lat: number;
  lon: number;
  rank: number;
  cell: number;
  country: number;
}

export interface BuiltWorld {
  packs: Record<PackName, Uint8Array>;
  meta: Record<string, unknown>;
  cities: CityRecord[];
  ports: PortRecord[];
  overrides: Record<string, unknown>;
  countries: CountryRecord[];
  stats: Record<string, unknown>;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' && v !== '' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Area in km2 of a lat/lon cell of the given size, with its centre at latitude `latDeg`. */
export function cellAreaKm2(latDeg: number, dLonDeg: number, dLatDeg: number): number {
  const k = EARTH_RADIUS_KM * (Math.PI / 180);
  return k * k * dLonDeg * dLatDeg * Math.cos((latDeg * Math.PI) / 180);
}

export function simRowLat(y: number): number {
  return 90 - ((y + 0.5) * 180) / SIM_HEIGHT;
}

/** Q15 cos(lat) per sim row, as stored in meta.json. */
export function cosQ15Rows(): number[] {
  const rows: number[] = [];
  for (let y = 0; y < SIM_HEIGHT; y++) rows.push(Math.round(Math.cos((simRowLat(y) * Math.PI) / 180) * 32768));
  return rows;
}

function layerViews(pack: PackName): { bytes: Uint8Array; u8: Record<string, Uint8Array>; i16: Record<string, Int16Array> } {
  const { layers, totalBytes } = layoutOf(pack);
  const bytes = new Uint8Array(totalBytes);
  const u8: Record<string, Uint8Array> = {};
  const i16: Record<string, Int16Array> = {};
  for (const l of layers) {
    if (l.type === 'u8') u8[l.name] = bytes.subarray(l.offset, l.offset + l.bytes);
    else i16[l.name] = new Int16Array(bytes.buffer, bytes.byteOffset + l.offset, l.bytes / 2);
  }
  return { bytes, u8, i16 };
}

/** Pixel of the render grid containing lon/lat. */
function renderPixel(lon: number, lat: number): [number, number] {
  const x = Math.min(RENDER_WIDTH - 1, Math.max(0, Math.floor(((lon + 180) / 360) * RENDER_WIDTH)));
  const y = Math.min(RENDER_HEIGHT - 1, Math.max(0, Math.floor(((90 - lat) / 180) * RENDER_HEIGHT)));
  return [x, y];
}

function simCellOf(lon: number, lat: number): [number, number] {
  const x = Math.min(SIM_WIDTH - 1, Math.max(0, Math.floor(((lon + 180) / 360) * SIM_WIDTH)));
  const y = Math.min(SIM_HEIGHT - 1, Math.max(0, Math.floor(((90 - lat) / 180) * SIM_HEIGHT)));
  return [x, y];
}

export function buildWorld(inputs: BuildInputs): BuiltWorld {
  const log = inputs.log ?? ((): void => {});
  const W = RENDER_WIDTH;
  const H = RENDER_HEIGHT;
  const stats: Record<string, unknown> = {};

  // ---- 1. Heights -----------------------------------------------------------------------------------------------------
  const clamp: ClampStats = cleanHeights(inputs.merc);
  stats.heightClean = clamp;
  log(`  heights: max before ${clamp.maxBefore.toFixed(0)} m, clamped high ${clamp.clampedHigh}, spikes replaced ${clamp.spikesReplaced}, max after ${clamp.maxAfter.toFixed(0)} m`);
  const heights = resampleToRender(inputs.merc);
  stats.syntheticPolarRows = { north: heights.syntheticRowsNorth, south: heights.syntheticRowsSouth };

  // ---- 2. Countries: ids by descending area -------------------------------------------------------------------------
  const rowWeightKm2: number[] = [];
  for (let y = 0; y < H; y++) rowWeightKm2.push(cellAreaKm2(90 - ((y + 0.5) * 180) / H, 360 / W, 180 / H));
  interface Feat {
    props: Record<string, unknown>;
    rings: Ring[];
    a3: string;
    areaKm2: number;
  }
  const feats: Feat[] = inputs.countries.features.map((f) => {
    const rings = geometryRings(f.geometry);
    let area = 0;
    fillPolygon(rings, W, H, (y, x0, x1) => {
      area += (x1 - x0) * (rowWeightKm2[y] as number);
    });
    return { props: f.properties, rings, a3: str(f.properties.ADM0_A3), areaKm2: area };
  });
  const seen = new Set<string>();
  for (const f of feats) {
    if (f.a3 === '' || seen.has(f.a3)) throw new Error(`ADM0_A3 missing or duplicated: "${f.a3}"`);
    seen.add(f.a3);
  }
  feats.sort((a, b) => b.areaKm2 - a.areaKm2 || (a.a3 < b.a3 ? -1 : a.a3 > b.a3 ? 1 : 0));
  if (feats.length > 255) throw new Error(`${feats.length} countries do not fit a u8 id`);
  const idOfA3 = new Map<string, number>();
  feats.forEach((f, i) => idOfA3.set(f.a3, i + 1));

  const render = layerViews('render');
  const countryRaster = render.u8.country as Uint8Array;
  feats.forEach((f, i) => paintPolygon(countryRaster, W, H, f.rings, i + 1));

  // ---- 3. Render pack: height, bathymetry, country ----------------------------------------------------------------------
  const heightLayer = render.u8.height as Uint8Array;
  const bathyLayer = render.u8.bathy as Uint8Array;
  // Land pixel height (>= 1 m) and sea pixel height (<= -1 m), kept as floats for the sim aggregation.
  const pixMean = heights.mean;
  const pixMax = heights.max;
  let landPixels = 0;
  for (let i = 0; i < W * H; i++) {
    if (countryRaster[i] !== 0) {
      landPixels++;
      let h = pixMean[i] as number;
      if (h < 1) h = 1;
      if (h > LAND_MAX_M) h = LAND_MAX_M;
      pixMean[i] = h;
      let m = pixMax[i] as number;
      if (m < 1) m = 1;
      if (m > LAND_MAX_M) m = LAND_MAX_M;
      pixMax[i] = m;
      heightLayer[i] = encodeLandHeight(h);
    } else {
      let h = pixMean[i] as number;
      if (h > -1) h = -1;
      if (h < -DEPTH_MAX_M) h = -DEPTH_MAX_M;
      pixMean[i] = h;
      let m = pixMax[i] as number;
      if (m > -1) m = -1;
      if (m < -DEPTH_MAX_M) m = -DEPTH_MAX_M;
      pixMax[i] = m;
      heightLayer[i] = 0;
    }
  }
  stats.renderLandPixels = landPixels;
  for (let by = 0; by < BATHY_HEIGHT; by++) {
    for (let bx = 0; bx < BATHY_WIDTH; bx++) {
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = (by * 2 + dy) * W + bx * 2 + dx;
          if (countryRaster[i] === 0) {
            sum += -(pixMean[i] as number);
            n++;
          }
        }
      }
      bathyLayer[by * BATHY_WIDTH + bx] = n === 0 ? 0 : encodeDepth(sum / n);
    }
  }

  // ---- 4. Sim pack ----------------------------------------------------------------------------------------------------
  const sim = layerViews('sim');
  const meanElev = sim.i16.meanElev as Int16Array;
  const maxElev = sim.i16.maxElev as Int16Array;
  const navMaxElev = sim.i16.navMaxElev as Int16Array;
  const landL = sim.u8.land as Uint8Array;
  const classL = sim.u8.class as Uint8Array;
  const countryL = sim.u8.country as Uint8Array;
  const coastL = sim.u8.coast as Uint8Array;
  const rugL = sim.u8.ruggedness as Uint8Array;
  const navFlags = sim.u8.navFlags as Uint8Array;
  const ataId = idOfA3.get(ICE_COUNTRY_A3) ?? -1;
  const counts = new Uint16Array(256);
  const touched: number[] = [];
  for (let sy = 0; sy < SIM_HEIGHT; sy++) {
    const lat = simRowLat(sy);
    for (let sx = 0; sx < SIM_WIDTH; sx++) {
      let land = 0;
      let landSum = 0;
      let landMax = -Infinity;
      let landMinMean = Infinity;
      let seaSum = 0;
      let seaN = 0;
      let seaMax = -Infinity;
      touched.length = 0;
      for (let dy = 0; dy < SIM_BLOCK; dy++) {
        for (let dx = 0; dx < SIM_BLOCK; dx++) {
          const i = (sy * SIM_BLOCK + dy) * W + sx * SIM_BLOCK + dx;
          const c = countryRaster[i] as number;
          const mean = pixMean[i] as number;
          const mx = pixMax[i] as number;
          if (c !== 0) {
            land++;
            landSum += mean;
            if (mx > landMax) landMax = mx;
            if (mean < landMinMean) landMinMean = mean;
            if (counts[c] === 0) touched.push(c);
            counts[c] = (counts[c] as number) + 1;
          } else {
            seaSum += mean;
            seaN++;
            if (mx > seaMax) seaMax = mx;
          }
        }
      }
      const idx = sy * SIM_WIDTH + sx;
      if (land >= LAND_MIN_PIXELS) {
        // Majority country (ties: lower id, that is the larger country).
        let best = 0;
        let bestN = 0;
        for (const c of touched) {
          const n = counts[c] as number;
          if (n > bestN || (n === bestN && c < best)) {
            best = c;
            bestN = n;
          }
        }
        const mean = Math.round(landSum / land);
        const max = Math.round(landMax);
        const range = landMax - landMinMean;
        const rug = Math.min(255, Math.round(range / RUGGEDNESS_STEP_M));
        landL[idx] = 1;
        countryL[idx] = best;
        meanElev[idx] = Math.max(1, mean);
        maxElev[idx] = Math.max(1, max);
        rugL[idx] = rug;
        classL[idx] = classifyLand({
          x: sx,
          y: sy,
          lat,
          meanElevM: meanElev[idx] as number,
          maxElevM: maxElev[idx] as number,
          ruggedness: rug,
          isAntarctica: best === ataId,
        });
      } else {
        // Water cell (a few land pixels, like a tiny island, are ignored).
        const n = seaN;
        const mean = n > 0 ? Math.round(seaSum / n) : -1;
        meanElev[idx] = Math.min(-1, mean);
        maxElev[idx] = Math.min(-1, n > 0 ? Math.round(seaMax) : -1);
        landL[idx] = 0;
        countryL[idx] = 0;
        rugL[idx] = 0;
        classL[idx] = classifyWater({ meanDepthM: -(meanElev[idx] as number) });
      }
      for (const c of touched) counts[c] = 0;
    }
  }
  // Coast flags (8-neighbourhood, longitude wraps, latitude does not).
  for (let sy = 0; sy < SIM_HEIGHT; sy++) {
    for (let sx = 0; sx < SIM_WIDTH; sx++) {
      const idx = sy * SIM_WIDTH + sx;
      const isLand = landL[idx] === 1;
      let other = false;
      for (let dy = -1; dy <= 1 && !other; dy++) {
        const ny = sy + dy;
        if (ny < 0 || ny >= SIM_HEIGHT) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (sx + dx + SIM_WIDTH) % SIM_WIDTH;
          if ((landL[ny * SIM_WIDTH + nx] === 1) !== isLand) {
            other = true;
            break;
          }
        }
      }
      coastL[idx] = other ? (isLand ? COAST_LAND_BIT : COAST_WATER_BIT) : 0;
    }
  }
  // Nav grid.
  for (let ny = 0; ny < NAV_HEIGHT; ny++) {
    for (let nx = 0; nx < NAV_WIDTH; nx++) {
      let flags = 0;
      let landN = 0;
      let mx = -32768;
      for (let dy = 0; dy < NAV_BLOCK; dy++) {
        for (let dx = 0; dx < NAV_BLOCK; dx++) {
          const i = (ny * NAV_BLOCK + dy) * SIM_WIDTH + nx * NAV_BLOCK + dx;
          if (landL[i] === 1) landN++;
          const k = classL[i] as number;
          if (k === TerrainClass.Mountain || k === TerrainClass.Peak) flags |= NavFlag.AnyRough;
          if (k === TerrainClass.Ice) flags |= NavFlag.AnyIce;
          if ((coastL[i] as number) & COAST_LAND_BIT) flags |= NavFlag.AnyCoast;
          if ((maxElev[i] as number) > mx) mx = maxElev[i] as number;
        }
      }
      if (landN > 0) flags |= NavFlag.AnyLand;
      if (landN === NAV_BLOCK * NAV_BLOCK) flags |= NavFlag.AllLand;
      navFlags[ny * NAV_WIDTH + nx] = flags;
      navMaxElev[ny * NAV_WIDTH + nx] = mx;
    }
  }

  // ---- 5. Per-country statistics ----------------------------------------------------------------------------------------
  const nCountries = feats.length;
  const cellsOf = new Array<number>(nCountries + 1).fill(0);
  const areaOf = new Array<number>(nCountries + 1).fill(0);
  const dLonSim = 360 / SIM_WIDTH;
  const dLatSim = 180 / SIM_HEIGHT;
  const rowAreaSim: number[] = [];
  for (let y = 0; y < SIM_HEIGHT; y++) rowAreaSim.push(cellAreaKm2(simRowLat(y), dLonSim, dLatSim));
  for (let sy = 0; sy < SIM_HEIGHT; sy++) {
    for (let sx = 0; sx < SIM_WIDTH; sx++) {
      const idx = sy * SIM_WIDTH + sx;
      if (landL[idx] === 1) {
        const c = countryL[idx] as number;
        cellsOf[c] = (cellsOf[c] as number) + 1;
        areaOf[c] = (areaOf[c] as number) + (rowAreaSim[sy] as number);
      }
    }
  }

  // ---- 6. Cities and capitals -----------------------------------------------------------------------------------------
  const snap = (lon: number, lat: number, accept: (idx: number) => boolean): number => {
    const [cx, cy] = simCellOf(lon, lat);
    // Position of the point in cell units, to pick the nearest candidate of a ring.
    const px = ((lon + 180) / 360) * SIM_WIDTH;
    const py = ((90 - lat) / 180) * SIM_HEIGHT;
    for (let r = 0; r <= SNAP_RADIUS_CELLS; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= SIM_HEIGHT) continue;
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = (cx + dx + SIM_WIDTH) % SIM_WIDTH;
          const idx = ny * SIM_WIDTH + nx;
          if (!accept(idx)) continue;
          const ddx = cx + dx + 0.5 - px;
          const ddy = ny + 0.5 - py;
          const d = ddx * ddx + ddy * ddy;
          if (d < bestD) {
            bestD = d;
            best = idx;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  const countryAt = (lon: number, lat: number): number => {
    const [px, py] = renderPixel(lon, lat);
    const here = countryRaster[py * W + px] as number;
    if (here !== 0) return here;
    for (let r = 1; r <= COUNTRY_SEARCH_PIXELS; r++) {
      let best = 0;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const c = countryRaster[ny * W + ((px + dx + W) % W)] as number;
          if (c !== 0 && dx * dx + dy * dy < bestD) {
            bestD = dx * dx + dy * dy;
            best = c;
          }
        }
      }
      if (best !== 0) return best;
    }
    return 0;
  };

  interface Place {
    name: string;
    lat: number;
    lon: number;
    pop: number;
    capital: boolean;
  }
  const EXCLUDED_PLACE_CLASSES = new Set(['Scientific station', 'Meteorological Station', 'Historic place']);
  const places: Place[] = [];
  for (const f of inputs.places.features) {
    const p = f.properties;
    const cls = str(p.featurecla);
    if (EXCLUDED_PLACE_CLASSES.has(cls)) continue;
    places.push({
      name: str(p.name, str(p.nameascii)),
      lat: num(p.latitude),
      lon: num(p.longitude),
      pop: num(p.pop_max),
      capital: cls === 'Admin-0 capital',
    });
  }
  const order = (a: Place, b: Place): number =>
    b.pop - a.pop || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.lat - b.lat || a.lon - b.lon;
  places.sort(order);
  const chosen = new Set<Place>();
  for (const p of places) if (p.capital) chosen.add(p);
  let big = 0;
  for (const p of places) {
    if (big >= MAX_CITIES) break;
    chosen.add(p);
    big++;
  }
  // Capitals first (largest first), then the others: a capital is never displaced by another city in the same cell.
  const ordered = places.filter((p) => chosen.has(p));
  const capitalsFirst = [...ordered.filter((p) => p.capital), ...ordered.filter((p) => !p.capital)];
  const usedCells = new Set<number>();
  const cities: CityRecord[] = [];
  let droppedCities = 0;
  let droppedCapitals = 0;
  const droppedCapitalNames: string[] = [];
  for (const p of capitalsFirst) {
    const cid = countryAt(p.lon, p.lat);
    const cell = cid === 0 ? -1 : snap(p.lon, p.lat, (i) => landL[i] === 1 && countryL[i] === cid && !usedCells.has(i));
    if (cell < 0) {
      droppedCities++;
      if (p.capital) {
        droppedCapitals++;
        droppedCapitalNames.push(`${p.name}(${cid === 0 ? 'no country' : (feats[cid - 1] as Feat).a3})`);
      }
      continue;
    }
    usedCells.add(cell);
    cities.push({
      name: p.name,
      lat: Math.round(p.lat * 1000) / 1000,
      lon: Math.round(p.lon * 1000) / 1000,
      population: p.pop,
      cell,
      country: cid,
      capital: p.capital,
    });
  }
  cities.sort((a, b) => b.population - a.population || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.cell - b.cell);
  stats.cities = { kept: cities.length, dropped: droppedCities, droppedCapitals, droppedCapitalNames };

  // Capital cell per country: largest capital city snapped into the country, else the most central land cell.
  const capitalOf = new Map<number, CityRecord>();
  for (const c of cities) {
    if (c.capital && !capitalOf.has(c.country)) capitalOf.set(c.country, c); // cities are sorted by population
  }
  const sx3 = new Float64Array(nCountries + 1);
  const sy3 = new Float64Array(nCountries + 1);
  const sz3 = new Float64Array(nCountries + 1);
  for (let sy = 0; sy < SIM_HEIGHT; sy++) {
    const lat = (simRowLat(sy) * Math.PI) / 180;
    for (let sx = 0; sx < SIM_WIDTH; sx++) {
      const idx = sy * SIM_WIDTH + sx;
      if (landL[idx] !== 1) continue;
      const c = countryL[idx] as number;
      const lon = ((-180 + (sx + 0.5) * dLonSim) * Math.PI) / 180;
      sx3[c] = (sx3[c] as number) + Math.cos(lat) * Math.cos(lon);
      sy3[c] = (sy3[c] as number) + Math.cos(lat) * Math.sin(lon);
      sz3[c] = (sz3[c] as number) + Math.sin(lat);
    }
  }
  const centralCell = new Int32Array(nCountries + 1).fill(-1);
  const centralD = new Float64Array(nCountries + 1).fill(Infinity);
  for (let sy = 0; sy < SIM_HEIGHT; sy++) {
    const lat = (simRowLat(sy) * Math.PI) / 180;
    for (let sx = 0; sx < SIM_WIDTH; sx++) {
      const idx = sy * SIM_WIDTH + sx;
      if (landL[idx] !== 1) continue;
      const c = countryL[idx] as number;
      const n = cellsOf[c] as number;
      const lon = ((-180 + (sx + 0.5) * dLonSim) * Math.PI) / 180;
      const dx = Math.cos(lat) * Math.cos(lon) - (sx3[c] as number) / n;
      const dy = Math.cos(lat) * Math.sin(lon) - (sy3[c] as number) / n;
      const dz = Math.sin(lat) - (sz3[c] as number) / n;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < (centralD[c] as number)) {
        centralD[c] = d;
        centralCell[c] = idx;
      }
    }
  }

  const countries: CountryRecord[] = feats.map((f, i) => {
    const id = i + 1;
    const nameEn = str(f.props.NAME, str(f.props.NAME_SV, f.a3));
    const nameSv = str(f.props.NAME_SV, nameEn);
    const cap = capitalOf.get(id);
    const cells = cellsOf[id] as number;
    let capitalCell: number | null = null;
    let source: 'city' | 'central' | null = null;
    if (cap) {
      capitalCell = cap.cell;
      source = 'city';
    } else if (cells > 0) {
      capitalCell = centralCell[id] as number;
      source = 'central';
    }
    return {
      id,
      a3: f.a3,
      name_en: nameEn,
      name_sv: nameSv,
      name_long: str(f.props.NAME_LONG, nameEn),
      continent: str(f.props.CONTINENT, 'Unknown'),
      population: Math.round(num(f.props.POP_EST)),
      cells,
      weightedAreaKm2: Math.round(areaOf[id] as number),
      capitalCell,
      capitalSource: source,
      capitalName: cap ? cap.name : null,
      playable: cells >= MIN_PLAYABLE_CELLS,
    };
  });

  // ---- 7. Ports -----------------------------------------------------------------------------------------------------------
  interface RawPort {
    name: string;
    lat: number;
    lon: number;
    rank: number;
  }
  const rawPorts: RawPort[] = inputs.ports.features.map((f) => {
    const coords = (f.geometry.coordinates as number[]) ?? [0, 0];
    return { name: str(f.properties.name), lon: num(coords[0]), lat: num(coords[1]), rank: num(f.properties.scalerank, 99) };
  });
  rawPorts.sort((a, b) => a.rank - b.rank || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.lat - b.lat || a.lon - b.lon);
  const usedPortCells = new Set<number>();
  const ports: PortRecord[] = [];
  let droppedPorts = 0;
  for (const p of rawPorts) {
    const cell = snap(p.lon, p.lat, (i) => landL[i] === 1 && ((coastL[i] as number) & COAST_LAND_BIT) !== 0 && classL[i] !== TerrainClass.Ice && !usedPortCells.has(i));
    if (cell < 0) {
      droppedPorts++;
      continue;
    }
    usedPortCells.add(cell);
    ports.push({
      name: p.name,
      lat: Math.round(p.lat * 1000) / 1000,
      lon: Math.round(p.lon * 1000) / 1000,
      rank: p.rank,
      cell,
      country: countryL[cell] as number,
    });
  }
  ports.sort((a, b) => a.cell - b.cell);
  stats.ports = { kept: ports.length, dropped: droppedPorts };

  // ---- 8. Overrides --------------------------------------------------------------------------------------------------------
  const contact = new Map<number, Map<number, number>>(); // micro country -> neighbour country -> touching cell pairs
  for (let sy = 0; sy < SIM_HEIGHT; sy++) {
    for (let sx = 0; sx < SIM_WIDTH; sx++) {
      const idx = sy * SIM_WIDTH + sx;
      if (landL[idx] !== 1) continue;
      const c = countryL[idx] as number;
      if ((cellsOf[c] as number) >= MIN_PLAYABLE_CELLS) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = sy + dy;
        if (ny < 0 || ny >= SIM_HEIGHT) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nIdx = ny * SIM_WIDTH + ((sx + dx + SIM_WIDTH) % SIM_WIDTH);
          const o = countryL[nIdx] as number;
          if (landL[nIdx] !== 1 || o === c || (cellsOf[o] as number) < MIN_PLAYABLE_CELLS) continue;
          const m = contact.get(c) ?? new Map<number, number>();
          m.set(o, (m.get(o) ?? 0) + 1);
          contact.set(c, m);
        }
      }
    }
  }
  const merged: Array<{ a3: string; into: string }> = [];
  const unplayable: string[] = [];
  for (const c of countries) {
    if (c.cells >= MIN_PLAYABLE_CELLS) continue;
    const m = contact.get(c.id);
    if (m && m.size > 0) {
      let into = 0;
      let intoN = -1;
      for (const [o, n] of m) {
        if (n > intoN || (n === intoN && o < into)) {
          into = o;
          intoN = n;
        }
      }
      merged.push({ a3: c.a3, into: (countries[into - 1] as CountryRecord).a3 });
    } else {
      unplayable.push(c.a3);
    }
  }
  merged.sort((a, b) => (a.a3 < b.a3 ? -1 : 1));
  unplayable.sort();
  const NEUTRAL_NAMES: Record<string, { en: string; sv: string }> = {
    ATA: { en: 'Antarctica', sv: 'Antarktis' },
    CYN: { en: 'Northern Cyprus', sv: 'Norra Cypern' },
    FLK: { en: 'Falkland Islands', sv: 'Falklandsöarna' },
    IOT: { en: 'Chagos Archipelago', sv: 'Chagosöarna' },
    ISR: { en: 'Israel', sv: 'Israel' },
    KAS: { en: 'Siachen Glacier', sv: 'Siachenglaciären' },
    KOS: { en: 'Kosovo', sv: 'Kosovo' },
    PSX: { en: 'Palestine', sv: 'Palestina' },
    SAH: { en: 'Western Sahara', sv: 'Västsahara' },
    SOL: { en: 'Somaliland', sv: 'Somaliland' },
  };
  const neutralNames: Record<string, { en: string; sv: string }> = {};
  for (const a3 of Object.keys(NEUTRAL_NAMES).sort()) {
    if (idOfA3.has(a3)) neutralNames[a3] = NEUTRAL_NAMES[a3] as { en: string; sv: string };
  }
  const overrides = {
    version: 1,
    note: 'Borders follow the Natural Earth de facto lines. Country ids in the packs are never changed; later milestones apply these lists.',
    minPlayableCells: MIN_PLAYABLE_CELLS,
    merged,
    unplayable,
    neutralNames,
  };
  for (const c of countries) {
    if (merged.some((m) => m.a3 === c.a3) || unplayable.includes(c.a3)) c.playable = false;
  }

  // ---- 9. Class shares and meta ----------------------------------------------------------------------------------------------
  const classCounts = new Array<number>(8).fill(0);
  let landCells = 0;
  let landCellsNoAntarctica = 0;
  for (let i = 0; i < SIM_WIDTH * SIM_HEIGHT; i++) {
    classCounts[classL[i] as number] = (classCounts[classL[i] as number] as number) + 1;
    if (landL[i] === 1) {
      landCells++;
      if (countryL[i] !== ataId) landCellsNoAntarctica++;
    }
  }
  const nonIceLand = landCells - (classCounts[TerrainClass.Ice] as number);
  stats.classCounts = Object.fromEntries(TERRAIN_CLASS_NAMES.map((n, i) => [n, classCounts[i]]));
  stats.landCells = landCells;
  stats.landCellsNoAntarctica = landCellsNoAntarctica;
  stats.nonIceLandCells = nonIceLand;
  stats.peakShare = (classCounts[TerrainClass.Peak] as number) / nonIceLand;
  stats.mountainShare = (classCounts[TerrainClass.Mountain] as number) / nonIceLand;

  const layerMeta = (pack: PackName): unknown[] =>
    layoutOf(pack).layers.map((l) => ({ name: l.name, type: l.type, width: l.width, height: l.height, offset: l.offset, bytes: l.bytes, description: l.description }));

  const meta = {
    version: 1,
    source: {
      naturalEarth: {
        repo: 'https://github.com/nvkelso/natural-earth-vector',
        sha: inputs.naturalEarthSha,
        files: ['ne_50m_admin_0_countries.geojson', 'ne_10m_populated_places_simple.geojson', 'ne_10m_ports.geojson'],
        licence: 'Public domain',
      },
      terrarium: {
        url: 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png',
        zoom: 4,
        tiles: 256,
        credit: 'Mapzen terrain tiles (Terrarium): USGS SRTM, NOAA ETOPO1 and others, see CREDITS.md',
      },
    },
    note: 'Stylised terrain: z4 Terrarium elevation smoothed and cleaned, not survey data.',
    encoding: {
      heightSqrt: { maxM: LAND_MAX_M, formula: 'metres = maxM * (code / 255)^2', minLandCode: MIN_LAND_CODE, seaCode: 0 },
      depthSqrt: { maxM: DEPTH_MAX_M, formula: 'metres = maxM * (code / 255)^2', minSeaCode: MIN_LAND_CODE, landCode: 0 },
      int16: 'little endian',
    },
    render: { width: RENDER_WIDTH, height: RENDER_HEIGHT, bathyWidth: BATHY_WIDTH, bathyHeight: BATHY_HEIGHT, layers: layerMeta('render') },
    sim: {
      width: SIM_WIDTH,
      height: SIM_HEIGHT,
      navWidth: NAV_WIDTH,
      navHeight: NAV_HEIGHT,
      classes: TERRAIN_CLASS_NAMES,
      layers: layerMeta('sim'),
      cosQ15: cosQ15Rows(),
      cosQ15Note: 'round(cos(lat of the row centre) * 32768) per sim row; 32768 does not fit an Int16, store as Uint16 or clamp.',
    },
    counts: {
      landCells,
      landCellsNoAntarctica,
      nonIceLandCells: nonIceLand,
      classes: Object.fromEntries(TERRAIN_CLASS_NAMES.map((n, i) => [n, classCounts[i]])),
      countries: countries.length,
      countriesWithMinCells: countries.filter((c) => c.cells >= MIN_PLAYABLE_CELLS).length,
    },
    countries,
  };

  return { packs: { render: render.bytes, sim: sim.bytes }, meta, cities, ports, overrides, countries, stats };
}

// Keep the format table referenced so a change of the layer list shows up in the typecheck of this file.
export const LAYER_NAMES = {
  render: PACK_LAYERS.render.map((l) => l.name),
  sim: PACK_LAYERS.sim.map((l) => l.name),
};

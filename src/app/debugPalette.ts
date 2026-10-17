// Colours of the debug data map (debug/data.html). Pure constants so that e2e tests can classify screenshot pixels.
import { TERRAIN_CLASS_NAMES } from '../data/format';

export type Rgb = readonly [number, number, number];

/** Class map colours, indexed by TerrainClass. */
export const CLASS_COLORS: readonly Rgb[] = [
  [10, 30, 90], // DeepSea
  [40, 100, 170], // Shallows
  [190, 200, 120], // Plains
  [40, 120, 50], // Forest
  [150, 130, 80], // Hills
  [120, 100, 100], // Mountain
  [250, 250, 250], // Peak
  [210, 235, 245], // Ice
];

export const CLASS_LEGEND: ReadonlyArray<{ name: string; color: Rgb }> = TERRAIN_CLASS_NAMES.map((name, i) => ({ name, color: CLASS_COLORS[i] as Rgb }));

export type MapMode = 'class' | 'height' | 'country';
export const MAP_MODES: readonly MapMode[] = ['class', 'height', 'country'];

/**
 * Mode from the address: the anchor `#map-class` (works in an Artifact, where ?query does not reach the page) wins over
 * `?map=class`. Anything unknown falls back to the class map.
 */
export function parseMapMode(search: string, hash: string): MapMode {
  const fromHash = /^#?map-(class|height|country)$/.exec(hash);
  if (fromHash) return fromHash[1] as MapMode;
  const fromQuery = new URLSearchParams(search).get('map');
  if (fromQuery === 'class' || fromQuery === 'height' || fromQuery === 'country') return fromQuery;
  return 'class';
}

/** Height map: sea in blues by depth, land green to brown to white by elevation. Input in metres. */
export function heightColor(elevM: number): Rgb {
  if (elevM < 0) {
    const t = Math.min(1, -elevM / 6000);
    return [Math.round(30 - 20 * t), Math.round(120 - 80 * t), Math.round(200 - 90 * t)];
  }
  const t = Math.min(1, Math.sqrt(elevM / 6000));
  if (t < 0.5) {
    const u = t / 0.5;
    return [Math.round(60 + 120 * u), Math.round(150 - 10 * u), Math.round(60 + 10 * u)];
  }
  const u = (t - 0.5) / 0.5;
  return [Math.round(180 + 70 * u), Math.round(140 + 110 * u), Math.round(70 + 180 * u)];
}

/** Country map: a stable colour per id (golden-angle hue, integer maths only for the lightness steps). */
export function countryColor(id: number): Rgb {
  if (id === 0) return [8, 16, 40];
  const hue = (id * 137.508) % 360;
  const light = 0.42 + 0.14 * ((id * 7) % 3) * 0.5;
  const c = (1 - Math.abs(2 * light - 1)) * 0.75;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

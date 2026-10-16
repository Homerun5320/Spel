// Fix-3B: the far icon's size on screen. The icon is 2 x ICON_HALF_PX pixels at most, but never wider than a third of the distance between two
// structures on screen: with the spacing of Sim-Growth (3 cells) the neighbouring badges of a crowded territory merged from about 5000 km.
// The vertex shader of the icons (src/render/shaders/structures.ts, `iconVertexShader`) repeats this formula; a test pins the two together.
import { EARTH_RADIUS_KM, ICON_HALF_PX, ICON_HALF_PX_MIN, ICON_SPACING_FRAC, ICON_SPACING_LAT_FACTOR } from './config';
import { SPACING_CELLS_BY_TYPE } from '../sim/public';

/** The closest two structures of one kind may stand (metres), on a grid `gridHeight` cells from pole to pole, at typical latitudes (the cells narrow towards the poles). */
export function iconSpacingM(gridHeight: number): number {
  let cells = Infinity;
  for (const c of SPACING_CELLS_BY_TYPE) if (c > 0 && c < cells) cells = c;
  return cells * ((Math.PI * EARTH_RADIUS_KM * 1000) / gridHeight) * ICON_SPACING_LAT_FACTOR;
}

/** Half size of an icon in pixels at camera distance `distM`; `pxPerRad` = half the drawing-buffer height times the projection scale (pixels per radian of view). */
export function iconHalfPx(distM: number, pxPerRad: number, spacingM: number): number {
  const spacingPx = (spacingM / Math.max(distM, 1)) * pxPerRad;
  return Math.min(ICON_HALF_PX, Math.max(ICON_HALF_PX_MIN, spacingPx * ICON_SPACING_FRAC));
}

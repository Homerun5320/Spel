// The input mode of the city view (Districts-2a). It sits on the input stack while the panel is open: Escape pops it (the stack does that, before the
// pause handler), a click on the globe is taken and does nothing (the panel is the focus; drag and wheel still move the camera). Pure TypeScript.
import { CITY_VIEW } from '../ui/uiConfig';
import type { InputMode } from './input';

export function createCityViewMode(target: { closed(): void }): InputMode {
  return {
    id: 'cityview',
    onPop(): void {
      target.closed();
    },
    click(): boolean {
      return true;
    },
  };
}

/** Does opening the city view fly the camera to the City? Not when it already stands within `CITY_VIEW.flyNearM` of the ground and the City is on screen. */
export function cityFlightNeeded(cameraAglM: number, cityOnScreen: boolean): boolean {
  return !(cityOnScreen && cameraAglM < CITY_VIEW.flyNearM);
}

/** Two clicks on the same structure within `CITY_VIEW.doubleClickMs` are a double click. `prevId` -1 = none. */
export function isDoubleClick(prevId: number, prevMs: number, id: number, nowMs: number): boolean {
  return prevId === id && nowMs - prevMs <= CITY_VIEW.doubleClickMs;
}

export interface CityFit {
  /** Camera height over the ground at the end of the flight (m). */
  altAglM: number;
  /** Where the camera looks, relative to the City (m, east and north at heading 0): the City then stands in the middle of the free part of the window. */
  offEastM: number;
  offNorthM: number;
}

/**
 * Fix-3B: the end of the open-city flight for a window of `width` x `height` css px whose city panel covers `panel` (a side panel on the right, or a
 * bottom sheet): the camera is high enough for the City plus its district ring (`CITY_VIEW.ringExtentM`) to fit inside `CITY_VIEW.fitMargin` of the
 * free part, and looks at a point shifted away from the panel so that the City stands in the middle of that free part. Heading 0 (east is right).
 * Pure maths on a vertical field of view `fovDeg` and the tilt from straight down.
 */
export function cityFitFlight(width: number, height: number, panel: { x: number; y: number }, fovDeg: number, tiltDeg: number): CityFit {
  const sideways = panel.x > width / 3; // a side panel; otherwise a bottom sheet
  const x0 = 0;
  const x1 = sideways ? panel.x : width;
  const y0 = Math.min(CITY_VIEW.topPx, height / 4);
  const y1 = sideways ? height : panel.y;
  const fw = Math.max(1, x1 - x0);
  const fh = Math.max(1, y1 - y0);
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const cosT = Math.cos((tiltDeg * Math.PI) / 180);
  const aspect = width / height;
  const R = CITY_VIEW.ringExtentM;
  // the share of the half window the ring may take, horizontally and vertically (the ring is foreshortened by cos(tilt) with the perspective of the near side on top)
  const needD = Math.max(R / ((fw / (width / 2)) * CITY_VIEW.fitMargin * tanHalf * aspect), (R * cosT * 1.4) / ((fh / (height / 2)) * CITY_VIEW.fitMargin * tanHalf));
  const altAglM = Math.min(CITY_VIEW.flyMaxAltM, Math.max(CITY_VIEW.flyAltM, needD * cosT));
  const D = altAglM / cosT;
  const sx = ((x0 + x1) / 2 - width / 2) / (width / 2);
  const sy = (height / 2 - (y0 + y1) / 2) / (height / 2);
  return { altAglM, offEastM: -sx * D * tanHalf * aspect, offNorthM: (-sy * D * tanHalf) / cosT };
}

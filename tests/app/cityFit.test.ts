// Fix-3B: the end of the open-city flight (`cityFitFlight`): high enough for the City plus its district ring to fit the free part of the window, and
// looking away from the panel so that the City stands in the middle of the free part.
import { describe, expect, it } from 'vitest';
import { cityFitFlight } from '../../src/app/cityViewMode';
import { CAMERA_FOV_DEG } from '../../src/render/config';
import { CITY_VIEW } from '../../src/ui/uiConfig';

const TILT = CITY_VIEW.flyTiltDeg;

describe('cityFitFlight', () => {
  it('a side panel on the right: the camera looks east of the City (the City appears left of the middle), never lower than the old altitude', () => {
    const f = cityFitFlight(960, 540, { x: 509, y: 64 }, CAMERA_FOV_DEG, TILT);
    expect(f.altAglM).toBeGreaterThanOrEqual(CITY_VIEW.flyAltM);
    expect(f.offEastM).toBeGreaterThan(0);
    expect(Math.abs(f.offNorthM)).toBeLessThan(Math.abs(f.offEastM)); // the free part is centred vertically (below the status bar only)
  });

  it('a bottom sheet: the camera looks south of the City (the City appears above the middle) and higher up than with a side panel', () => {
    const side = cityFitFlight(960, 540, { x: 509, y: 64 }, CAMERA_FOV_DEG, TILT);
    const sheet = cityFitFlight(540, 960, { x: 8, y: 318 }, CAMERA_FOV_DEG, TILT);
    expect(sheet.offNorthM).toBeLessThan(0);
    expect(Math.abs(sheet.offEastM)).toBeLessThan(1);
    expect(sheet.altAglM).toBeGreaterThan(side.altAglM);
  });

  it('a smaller free part needs a higher camera, and the altitude is capped', () => {
    const wide = cityFitFlight(1366, 768, { x: 784, y: 64 }, CAMERA_FOV_DEG, TILT);
    const tight = cityFitFlight(1366, 768, { x: 500, y: 64 }, CAMERA_FOV_DEG, TILT);
    const none = cityFitFlight(1366, 768, { x: 5, y: 64 }, CAMERA_FOV_DEG, TILT);
    expect(wide.altAglM).toBeGreaterThan(CITY_VIEW.flyAltM);
    expect(tight.altAglM).toBeGreaterThan(wide.altAglM);
    expect(none.altAglM).toBeLessThanOrEqual(CITY_VIEW.flyMaxAltM);
  });
});

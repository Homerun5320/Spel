// Fix-3B: the far icon never grows wider than a third of the on-screen spacing of two structures (a crowded territory read as a blob from 5000 km).
import { describe, expect, it } from 'vitest';
import { CAMERA_FOV_DEG, ICON_HALF_PX, ICON_HALF_PX_MIN } from '../../src/render/config';
import { iconHalfPx, iconSpacingM } from '../../src/render/iconScale';
import { iconVertexShader } from '../../src/render/shaders/structures';

const H = 540;
const PX_PER_RAD = H * 0.5 / Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
const SPACING = iconSpacingM(512);

describe('iconHalfPx', () => {
  it('the spacing is 3 cells of the 512-row grid at typical latitudes (about 76 km)', () => {
    expect(SPACING).toBeGreaterThan(70_000);
    expect(SPACING).toBeLessThan(80_000);
  });

  it('keeps the full size while the structures are far apart on screen, and shrinks to a third of the spacing beyond', () => {
    expect(iconHalfPx(1_000_000, PX_PER_RAD, SPACING)).toBe(ICON_HALF_PX);
    expect(iconHalfPx(3_000_000, PX_PER_RAD, SPACING)).toBe(ICON_HALF_PX);
    const at8000 = iconHalfPx(8_000_000, PX_PER_RAD, SPACING);
    const spacingPx = (SPACING / 8_000_000) * PX_PER_RAD;
    expect(at8000).toBeCloseTo(spacingPx / 3, 6);
    expect(at8000).toBeLessThan(ICON_HALF_PX);
  });

  it('two neighbouring icons never touch at 8000 km, and the floor holds at 15000 and 30000 km', () => {
    const spacingPx = (SPACING / 8_000_000) * PX_PER_RAD;
    expect(2 * iconHalfPx(8_000_000, PX_PER_RAD, SPACING)).toBeLessThan(spacingPx);
    expect(iconHalfPx(15_000_000, PX_PER_RAD, SPACING)).toBeGreaterThanOrEqual(ICON_HALF_PX_MIN);
    expect(iconHalfPx(30_000_000, PX_PER_RAD, SPACING)).toBe(ICON_HALF_PX_MIN);
  });

  it('is non-increasing in the distance', () => {
    let prev = Infinity;
    for (let km = 500; km <= 40000; km += 500) {
      const v = iconHalfPx(km * 1000, PX_PER_RAD, SPACING);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('the icon vertex shader uses the same uniform and clamp', () => {
    expect(iconVertexShader).toContain('uniform vec3 uIconSpacing');
    expect(iconVertexShader).toContain('clamp(uIconSpacing.x / max(distM, 1.0) * pxPerRad * uIconSpacing.y, uIconSpacing.z, uHalfPx)');
  });
});

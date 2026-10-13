// The ONE render config file: every tunable of the stylised Earth lives here (docs/CHARTER.md: no magic numbers
// elsewhere). Exaggeration and sun are constants of this file, never literals in a shader or in the app.

/** Mean Earth radius. One world unit in the render scene is one Earth radius. */
export const EARTH_RADIUS_KM = 6371;

/** Visual height exaggeration of the displaced terrain (the sim has its own, `GAMEPLAY_HEIGHT_EXAG`, later). */
export const HEIGHT_EXAGGERATION = 12;

// --- Sun -------------------------------------------------------------------------------------------------------
/** Sun declination in degrees (tilts the terminator; a fixed northern-spring value). */
export const SUN_DECLINATION_DEG = 14;
/** Longitude of the sub-solar point at fx time 0. */
export const SUN_LON_AT_T0_DEG = 20;
/** Fx seconds for one full day (the sub-solar point moves west by 360 degrees in that time). */
export const SUN_DAY_SECONDS = 1800;
/** Sun colour (linear) and the night-side ambient colour. */
export const SUN_COLOR: readonly [number, number, number] = [1.0, 0.94, 0.82];
export const AMBIENT_NIGHT: readonly [number, number, number] = [0.018, 0.026, 0.05];
export const AMBIENT_DAY: readonly [number, number, number] = [0.06, 0.08, 0.12];
/** Weight of the mesh facet normal (stylised flat shading) added to the height-field slope normal. */
export const FACET_WEIGHT = 0.5;
/** Sun colour near the horizon (twilight band of the terminator) and the width of that band in sin(elevation). */
export const SUN_COLOR_LOW: readonly [number, number, number] = [1.0, 0.52, 0.26];
export const TWILIGHT_WIDTH = 0.16;
/** Strength of the warm twilight light that spills over the terminator (0 = none). */
export const TWILIGHT_STRENGTH = 0.22;

// --- Ocean ------------------------------------------------------------------------------------------------------
/** Slope of the largest wave octave (smaller octaves fall off by 0.8 each); faded out by screen size. */
export const OCEAN_WAVE_SLOPE = 0.065;
/** Wave speed multiplier on the fx clock (the clock is frozen in test mode, so the normals are frozen too). */
export const OCEAN_WAVE_SPEED = 1.0;
/** Fresnel reflectance at normal incidence (water). */
export const OCEAN_F0 = 0.02;
/** Sun glint: broad lobe (stylised sun-glitter patch) and tight lobe (sparkles on the wave facets): strength and exponent. */
export const OCEAN_SPEC_BROAD = 0.6;
export const OCEAN_SPEC_BROAD_EXP = 45;
export const OCEAN_SPEC_TIGHT = 1.8;
export const OCEAN_SPEC_TIGHT_EXP = 900;
/** Sky colours the water reflects (linear): horizon and zenith, and the night sky. */
export const SKY_HORIZON: readonly [number, number, number] = [0.42, 0.62, 0.9];
export const SKY_ZENITH: readonly [number, number, number] = [0.07, 0.2, 0.55];
export const SKY_NIGHT: readonly [number, number, number] = [0.004, 0.007, 0.02];

// --- Atmosphere -------------------------------------------------------------------------------------------------
/** Outer radius of the atmosphere shell (Earth radii; far above the real 1.016 so the glow reads at globe scale). */
export const ATMOSPHERE_TOP = 1.07;
/** Density scale height in Earth radii (stylised, about 70 km). */
export const ATMOSPHERE_SCALE_HEIGHT = 0.011;
/** In-scatter strength and the extinction per unit of optical depth. */
export const ATMOSPHERE_STRENGTH = 2.2;
export const ATMOSPHERE_EXTINCTION = 5.0;
/** Scatter colours (linear): blue by day, orange-red near the terminator. */
export const ATMOSPHERE_COLOR: readonly [number, number, number] = [0.16, 0.42, 1.0];
export const ATMOSPHERE_DUSK: readonly [number, number, number] = [0.9, 0.3, 0.1];

// --- Stars -------------------------------------------------------------------------------------------------------
export const STAR_COUNT = 2600;
export const STAR_SEED = 20240611;
/** Point size range in pixels and the brightness exponent (larger = fewer bright stars). */
export const STAR_SIZE_MIN = 1.0;
export const STAR_SIZE_MAX = 2.6;

// --- Night lights (drawn on the CPU from cities.json into a 2048x1024 texture) ---------------------------------------
export const LIGHTS_WIDTH = 2048;
export const LIGHTS_HEIGHT = 1024;
export const LIGHTS_SEED = 7771;
/** Light colour (linear) and gain; the texture value is multiplied by both and by the night factor. */
export const LIGHTS_COLOR: readonly [number, number, number] = [1.0, 0.72, 0.36];
export const LIGHTS_GAIN = 1.5;

// --- Country borders and palette ----------------------------------------------------------------------------------
/** Share of the border line colour mixed into the land colour (weak lines). */
export const BORDER_STRENGTH = 0.34;
/** Share of the country palette colour mixed into the land albedo (a faint political tint). */
export const COUNTRY_TINT = 0.06;

// --- Camera ----------------------------------------------------------------------------------------------------
/** Vertical field of view in degrees. */
export const CAMERA_FOV_DEG = 30;
/** Zoom limits: camera distance to the focus point at sea level, in km. */
export const DIST_MIN_KM = 220;
export const DIST_MAX_KM = 42000;
/** Tilt limit in degrees from straight down (a horizon view is never allowed). */
export const TILT_MAX_DEG = 72;
/** Focus latitude limit while the user drags (setView may go to +-90). */
export const LAT_LIMIT_DEG = 88;
/** Inertia: angular velocity decays with this time constant (fx seconds). */
export const INERTIA_TAU_S = 0.45;
/** Smoothing time constant of the wheel zoom (fx seconds). */
export const ZOOM_TAU_S = 0.12;
/** Wheel: distance factor per delta pixel (exp). */
export const WHEEL_ZOOM_RATE = 0.0016;
/** Right-drag rotation speed in degrees per pixel (heading) and tilt. */
export const ROTATE_DEG_PER_PX = 0.35;
/** Largest simulation step of the camera integrator (fx seconds). */
export const CAMERA_MAX_STEP_S = 1 / 60;

/** Default view: the whole Earth framed so that it nearly fills the height of the canvas. */
export const DEFAULT_VIEW = { lat: 22, lon: 12, distKm: 21500, heading: 0, tilt: 0 } as const;

// --- Colours of the terrain classes (sRGB, 0..1), index = TerrainClass value of src/data/format.ts --------------------
export const CLASS_ALBEDO: ReadonlyArray<readonly [number, number, number]> = [
  [0.02, 0.1, 0.3], // 0 DeepSea (unused on land)
  [0.1, 0.4, 0.55], // 1 Shallows (unused on land)
  [0.52, 0.62, 0.3], // 2 Plains
  [0.17, 0.4, 0.2], // 3 Forest
  [0.55, 0.52, 0.32], // 4 Hills
  [0.5, 0.43, 0.36], // 5 Mountain
  [0.64, 0.6, 0.58], // 6 Peak
  [0.92, 0.95, 0.98], // 7 Ice
];

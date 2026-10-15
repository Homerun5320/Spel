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

// --- Polar caps ------------------------------------------------------------------------------------------------
/**
 * The elevation source stops at 85.05 degrees (Web Mercator), so in the baked rasters every row poleward of it repeats the last
 * real row: heights and depths there are radial streaks that get steeper the closer to the pole. The shading terms derived
 * from them (the detail slope normal, the water depth colour) fade out between these two |latitudes|; the water settles to
 * `POLAR_DEPTH_M`. A real fix belongs in the bake (docs/BACKLOG.md).
 */
export const POLAR_FADE_START_DEG = 84.5;
export const POLAR_FADE_END_DEG = 86.5;
export const POLAR_DEPTH_M = 2500;

// --- Country borders and palette ----------------------------------------------------------------------------------
/** Share of the border line colour mixed into the land colour (weak lines). */
export const BORDER_STRENGTH = 0.34;
/** Share of the country palette colour mixed into the land albedo (a faint political tint). */
export const COUNTRY_TINT = 0.06;

// --- Country selection (M06): the outline of the country chosen on the setup screen ------------------------------------------
/** Width in screen pixels of the bright outline and of the soft glow on both sides of it. */
export const SELECT_LINE_PX = 1.3;
export const SELECT_GLOW_PX = 6;
/** Strength of the outline (0..1), of the glow, and how much the rest of the world is dimmed while a country is selected. */
export const SELECT_LINE_STRENGTH = 0.95;
export const SELECT_GLOW_STRENGTH = 0.45;
export const SELECT_DIM = 0.3;
/** Colour of the outline and the glow (linear light). */
export const SELECT_COLOR: readonly [number, number, number] = [1.0, 0.74, 0.12];

// --- Territory (M05): ownership texture, tint and borders ---------------------------------------------------------------
/** The ownership texture is re-uploaded at most this often (FX seconds), whatever the sim speed. */
export const OWNERSHIP_MIN_UPLOAD_INTERVAL_S = 0.1;
/** Share of the owner's colour mixed into the land albedo inside a territory. */
export const OWNER_TINT = 0.6;
/** Extra tint in the band just inside a border (a soft inner glow that outlines a territory). */
export const OWNER_EDGE_GLOW = 0.22;
/** Strength of the sharp border line (0..1) and its width in screen pixels. */
export const OWNER_LINE_STRENGTH = 1;
export const OWNER_LINE_PX = 2.4;
/** Size of the ownership grid (the sim grid: one cell is 0.35 degrees); the chunk shader forms the cell position of a pixel from it. A test keeps it in step with the sim. */
export const OWNER_GRID_W = 1024;
export const OWNER_GRID_H = 512;
/** Domain warp of the cell lookup: amplitude in cells (two octaves, 4 and 2 cells wide) that makes the borders organic. */
export const OWNER_WARP_AMP = 0.7;
/**
 * Finer octaves of that warp for close views (M07a, D135): wavelengths of 1, 1/2, 1/4, ... 1/32 cell (39 km down to 1.2 km). Each octave
 * is OWNER_WARP_FINE_PERSIST times the amplitude of the one before, the first one is OWNER_WARP_FINE_AMP times OWNER_WARP_AMP. An octave
 * fades in when its wavelength is FADE_FROM to FADE_TO screen pixels long (nothing under three pixels, so it never shimmers), so the
 * orbit view pays for none of them and a border seen from 5 km up wiggles on every scale it shows. The two numbers are bounded by the
 * fold test (`tests/render/warpFold.test.ts`): a warp whose slope passes 1 turns the map over and grows islands and slivers on a border.
 */
export const OWNER_WARP_FINE_AMP = 0.3;
export const OWNER_WARP_FINE_PERSIST = 0.45;
export const OWNER_WARP_FINE_FADE_FROM = 3;
export const OWNER_WARP_FINE_FADE_TO = 8;
/** How dark the border line is: the owner's colour times this. */
export const OWNER_LINE_DARKEN = 0.3;
/**
 * Territory at night (D108). After the lighting the owner's colour is mixed into the lit land with a weight of its own times the
 * darkness of the pixel (0 by day, 1 deep in the night): the interior, the border rim (a lightened owner colour) and a halo of
 * OWNER_NIGHT_HALO_PX pixels on the unowned land just outside the border. LEVEL is the brightness (linear) of the colour at weight 1.
 */
export const OWNER_NIGHT_INTERIOR = 0.34;
export const OWNER_NIGHT_RIM = 0.9;
export const OWNER_NIGHT_HALO = 0.55;
export const OWNER_NIGHT_HALO_PX = 3;
export const OWNER_NIGHT_LEVEL = 0.62;

// --- Camera ----------------------------------------------------------------------------------------------------
/** Vertical field of view in degrees. */
export const CAMERA_FOV_DEG = 30;
/** Zoom limits: camera distance to the focus point at sea level, in km. */
export const DIST_MIN_KM = 220;
export const DIST_MAX_KM = 42000;
/**
 * Terrain-aware zoom (M07a, the chunk terrain), M08: the mouse, `setView` and every flight stop the camera this high above the displaced
 * ground under it, whatever the ground (sea level or the x12 Himalaya), and never closer than DIST_MIN_GROUND_KM to the focus point.
 * M07a had 1000 m (an accepted band of 0.8 to 1.5 km); the RTS camera of M08 comes down to 300 m (D155).
 */
export const ZOOM_MIN_AGL_M = 300;
export const DIST_MIN_GROUND_KM = 0.3;
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

// --- The RTS camera (M08, D155) -------------------------------------------------------------------------------------------------------
/**
 * The camera mix. Above `RTS_AGL_GLOBE_M` metres over the ground the camera is the globe arcball of M02 to M07 (the grab sphere is the
 * sea level, the tilt 0 to `TILT_MAX_DEG`); below `RTS_AGL_FULL_M` it is the local-tangent RTS camera (the grab surface is the ground
 * under the cursor, the tilt `RTS_TILT_MIN_DEG` to `RTS_TILT_MAX_DEG`); in between the weight is a smoothstep of the logarithm of the
 * height, so nothing changes in a step. 4000 km is where the exaggerated relief (up to 100 km) is 2.5 % of the height and the globe is
 * still the right picture; 800 km is where a country fills the screen and the relief is 12 %.
 */
export const RTS_AGL_GLOBE_M = 4_000_000;
export const RTS_AGL_FULL_M = 800_000;
/** The RTS tilt limits in degrees from straight down; the lower limit grows from 0 with the mix weight, the upper from `TILT_MAX_DEG`. */
export const RTS_TILT_MIN_DEG = 20;
export const RTS_TILT_MAX_DEG = 80;
/** A tilt outside the limits (a zoom in from straight down) is brought back at this rate, degrees per fx second. */
export const RTS_TILT_EASE_DEG_PER_S = 40;
/** The camera follows the ground (keeps the height the user chose) with this time constant, fx seconds, and stops moving under this many metres of error. */
export const RTS_FOLLOW_TAU_S = 0.25;
export const RTS_FOLLOW_EPS_M = 0.05;
/**
 * Flights with an altitude (`FlyOptions.altAglM`, D155). The camera model of a flight: ground position, height, heading, tilt. The height
 * rises to at least `FLY_ARCH_RATIO` times the distance flown (so the ground never streams past faster than the camera is high), the
 * ground position moves while it is high, and the dive down to the end height is the slow part. The flight is planned so that the log-rate
 * of the height peaks at `FLY_RHO_MAX` e-folds per second and so does the speed of the move in heights per second (2.4 per second at 60 fps
 * is 4 % of the height per frame, the acceptance asks for at most 5 %). `FLY_SHARE_ACTIVE` of the time is the rise and the dive together
 * (in proportion to their log spans), `FLY_SHARE_MOVE` the move; `src/render/flyTo.ts` `planGroundFlight` lays the windows out.
 */
export const FLY_ARCH_RATIO = 0.4;
export const FLY_RHO_MAX = 2.4;
export const FLY_SHARE_ACTIVE = 0.6;
export const FLY_SHARE_MOVE = 0.4;
/** The window of the flight in which heading and tilt turn. */
export const FLY_TURN_WINDOW: readonly [number, number] = [0.15, 0.95];
/** The highest a flight rises (metres above the ground). */
export const FLY_PEAK_MAX_M = 40_000_000;
/** The octaves of the smooth ground a flight keeps its height over while it moves (the camera's clearance always uses all of them). */
export const FLY_GROUND_OCTAVES = 3;

/** Default view: the whole Earth framed so that it nearly fills the height of the canvas. */
export const DEFAULT_VIEW = { lat: 22, lon: 12, distKm: 21500, heading: 0, tilt: 0 } as const;

// --- Terrain chunks (M07a): the quadtree of instanced chunks that replaces the fixed globe mesh -----------------------------------
/** Deepest quadtree level (level 0 = the 8 roots of 90 degrees; level L chunks are 90 / 2^L degrees: 17 is about 76 m on a side). */
export const CHUNK_MAX_LEVEL = 17;
/** A split chunk merges back only when it is this much (fraction) farther than the split distance: the LOD hysteresis band. */
export const CHUNK_HYSTERESIS = 0.25;
/**
 * Most chunk splits the quadtree may undo per frame to make room, under the chunk cap, for a clearly more urgent split elsewhere
 * (the swap needs the old split to be more than the hysteresis band less urgent). Bounds the pop-out when the camera moves fast.
 */
export const CHUNK_EVICTIONS_PER_FRAME = 4;
/** Share of the chunk cap that new splits leave free for the splits the quadtree already holds (see `QuadParams.reserve`). */
export const CHUNK_BUDGET_RESERVE = 0.08;
/**
 * Skirt depth in grid cells of the chunk's own level; it is multiplied by 2^d on an edge whose neighbour is d levels coarser (the
 * crack to cover grows with the coarse cell). Also covers the float rounding hairlines between equal-level neighbours.
 */
export const CHUNK_SKIRT_CELLS = 1.25;
/**
 * How far the skirt leans OUTWARD from its chunk (grid cells of the chunk's own level, times 2^d like the depth). A wall that only hangs
 * straight down is edge-on to a camera looking straight down, so a hairline gap between two chunks (float rounding of their separately
 * computed edge vertices) would show the background there; a wall that leans outward is seen from above and covers it.
 */
export const CHUNK_SKIRT_OUT_CELLS = 0.5;
/**
 * Where the neighbour is on the same LOD level the wall only covers float rounding hairlines, so its depth and lean are this share of
 * the full ones (a smaller wall is less to rasterise and to shade; the walls at LOD seams keep their full size).
 */
export const CHUNK_SKIRT_SAME_SHARE = 0.25;
/** Frustum culling slack: the half field of view is widened by this fraction so a chunk never pops in at the screen edge. */
export const CHUNK_FRUSTUM_SLACK = 0.06;
/** Dynamic near plane: this fraction of the camera's height above the ground, never below `CLIP_NEAR_MIN` (Earth radii). */
export const CLIP_NEAR_FRACTION = 0.1;
export const CLIP_NEAR_MIN = 2e-7;
/** Dynamic far plane: the distance to the horizon plus the distance a ray along the horizon needs to leave the atmosphere shell, plus this margin (Earth radii). */
export const CLIP_FAR_MARGIN = 0.1;
/** Hue step of the `?chunks=1` debug colours (golden ratio conjugate: neighbouring keys get well separated hues). */
export const CHUNK_HUE_STEP = 0.6180339887498949;

// --- Terrain detail (M07b): ridged noise added to the base height in the VERTEX path ---------------------------------------------
// The base is the 4096x2048 raster (10 km texels, 12x exaggerated by the shader). The detail is a sum of ridged octaves of 3D value
// noise on the unit sphere, scaled by the local relief of the raster, in RENDER metres before the exaggeration. `src/render/detail.ts`
// (TypeScript, no three) and `src/render/shaders/detail.ts` (GLSL) are the SAME maths with the same constants; `heightAt` is the TS one.
/** Seed of the integer hash (a mutation of it in TS must fail the parity test). */
export const DETAIL_SEED = 0x2f6e2b1d;
/** Lattice cells per Earth radius of octave 0 (cell = 6371 km / this = 19.5 km, about two raster texels); octave k doubles it. */
export const DETAIL_FREQ0 = 1024 / Math.PI;
/** Most octaves anywhere (level 17 chunks of 32 cells: 12). */
export const DETAIL_OCTAVES_MAX = 12;
/** Amplitude ratio between neighbouring octaves (a lattice cell halves per octave, so a ratio under 0.5 makes the slope fall towards the fine scales: the surface is steep, the exaggeration is x12). */
export const DETAIL_PERSIST = 0.42;
/** The detail height as a share of the local relief (the octave sum S has a standard deviation of about 0.3 and never leaves +-0.86; the largest amplitude that keeps the M07a quadtree tests green, D145). */
export const DETAIL_AMP = 0.2;
/** Mean of a ridged octave (r*r with r = 1 - |2n - 1|; measured 0.499 over 400 000 samples of the noise, tests/render/detail.test.ts checks it), subtracted so that the detail has no bias. */
export const DETAIL_RIDGE_MEAN = 0.5;
/** Local relief (max minus min of the base height over 3x3 raster texels) is never below this (metres). */
export const DETAIL_RELIEF_FLOOR_M = 100;
/** The factor `uMottleScale` takes when the near-view mottling is switched off: the pixel is this many times wider to it, so every octave is faded out (the first one's wavelength is 1/16 cell, the fade starts at `SHADE_MOTTLE_FADE_PX[0]` pixels). */
export const MOTTLE_OFF_SCALE = 1000;
/** The offset of the distance law when the law is switched off (the control of the pop tests): so large that the level's own octave count always binds. */
export const OCTAVE_LAW_OFF_OFFSET = 99;
/** The most octaves `Globe.setDetailBias` may take away from the tier's distance law (the node intervals of the quadtree hold for the coarse octaves less one, so this stays small). */
export const DETAIL_BIAS_MIN = -3;
/** Octaves of the first pass that only places the vertex to find its distance from the camera. */
export const DETAIL_PROBE_OCTAVES = 3;
/** The land coverage (share of land among the four texels around a point, 0.5 = the coast line) where the coast fade starts and ends. */
export const DETAIL_COAST_FADE: readonly [number, number] = [0.5, 1];
/** Land is never lower than this above sea level (metres): land keeps its sign against the sea whatever the detail does. */
export const DETAIL_LAND_MIN_M = 1;

// --- Terrain shading (M07b part B): rock, snow, forest tone, shore foam -------------------------------------------------------------
// All of it is a few multiply-adds per pixel (no octave loop, no texture fetch added): the fragment shader reads the SLOPE of its own shading
// normal (raster slope + the facet normal of the detailed mesh) and the DETAILED height of the vertex shader (`vH`, render metres, before the
// exaggeration). The shader text takes these numbers as `const`s (src/render/shaders/terrain.ts), so they cost no uniform.
/** Real slope (the tangent of the angle of the shading normal after the exaggeration is divided out, so 0.47 = 25 degrees, 0.84 = 40): grass and forest give way to bare rock between these two (and above the tree line). */
export const SHADE_ROCK_SLOPE: readonly [number, number] = [0.3, 0.75];
/** Share of bare rock at full steepness (the rest keeps a hint of the biome tone). */
export const SHADE_ROCK_STRENGTH = 0.9;
/** The tree line lies this far under the snow line (metres); vegetation fades to bare ground between `-FADE` and `+FADE` around it. */
export const SHADE_TREE_BELOW_SNOW_M = 900;
export const SHADE_TREE_FADE_M = 450;
/**
 * Snow line (metres of the DETAILED height) at three latitudes: up to 32 degrees it is the first value (the Himalaya and the Tibetan plateau at 4 500
 * to 5 400 m stay bare, the snow sits on the ridges and the high massif above about 5 400 m), by 47 degrees the second (the Alps, 2 550 m: the real line is 2 700 to 3 100 m, but the 10 km raster smooths the summits to 3 300 m at most and the Alps should keep their snow), by 62 the
 * third (the Scandes, 1 650 m); poleward of 65 degrees it falls by `POLAR_DROP` towards 85 (Svalbard, the polar sheets: near sea level). The numbers
 * between are smoothstep ramps (`SHADE_SNOW_RAMPS`). Stylised, not a climate model: the real line is 5 000 to 5 500 m in the Himalaya and
 * 2 700 to 3 100 m in the Alps, and a dry plateau like Tibet carries far less snow than its height says (the 10 km raster hides the 8 000 m peaks).
 */
export const SHADE_SNOW_LINE_M: readonly [number, number, number] = [5400, 2550, 1650];
/** |Latitude| ramps (degrees): first value to second, second value to third, and the polar drop. */
export const SHADE_SNOW_RAMPS: readonly [number, number, number, number, number, number] = [32, 47, 47, 62, 65, 85];
export const SHADE_SNOW_POLAR_DROP_M = 1500;
/** Half width of the snow edge (metres of height). */
export const SHADE_SNOW_FADE_M = 380;
/** On steep faces the snow line rises by this much (metres of height) between the two slopes: steep rock stays grey, ridges stand out. */
export const SHADE_SNOW_SHED_M = 2600;
export const SHADE_SNOW_SHED_SLOPE: readonly [number, number] = [0.45, 1.1];
/** Colours (sRGB): warm rock at low height, cool grey rock near the snow, snow. */
export const SHADE_ROCK_WARM: readonly [number, number, number] = [0.42, 0.36, 0.31];
export const SHADE_ROCK_COOL: readonly [number, number, number] = [0.36, 0.36, 0.38];
export const SHADE_SNOW_COLOR: readonly [number, number, number] = [0.88, 0.92, 0.97];
/** The Hills, Plains and Mountain tones cool and darken towards the boreal and arctic belt (smoothstep over |latitude|): west Norway is dark green-grey rock and moss, not the khaki of a dry hill. A glacier class keeps its white. */
export const SHADE_BOREAL_TINT: readonly [number, number, number] = [0.8, 0.9, 0.86];
export const SHADE_BOREAL_RAMP: readonly [number, number] = [48, 66];
/** Fine mottling of the colours (forest canopy, rock tone, a ragged snow edge): amplitude (of the colour) and, for the snow edge, of the height in metres. Faded out by pixel size, so orbit views pay nothing. */
export const SHADE_MOTTLE_COLOR = 0.26;
/** An octave of that mottling fades in between these two sizes of its wavelength in pixels (never a grain of a few pixels). */
export const SHADE_MOTTLE_FADE_PX: readonly [number, number] = [6, 16];
export const SHADE_MOTTLE_SNOW_M = 420;
/** Territory tint that keeps the terrain visible: the owner's colour is multiplied by `BASE + GAIN * luminance(terrain colour)` (clamped to [LO, HI]) instead of replacing it. */
export const OWNER_TINT_LUM: readonly [number, number, number, number] = [0.4, 1.3, 0.45, 1.55];
/** In a close view the tint is weaker so the terrain shows through: its share (1 = no change) at the closest and the pixel size in sim cells where it is back to 1 (full at FAR) and where it is at the closest value (NEAR). */
export const OWNER_TINT_CLOSE: readonly [number, number, number] = [0.72, 0.002, 0.02];
/** Shore foam: a band on the sea side of the coast line (the land coverage runs from FROM to 0.5 there), as wide as `BAND_M` metres, faded out when it is narrower than a few pixels. */
export const FOAM_FROM = 0.3;
export const FOAM_BAND_M = 1400;
export const FOAM_STRENGTH = 0.8;
export const FOAM_COLOR: readonly [number, number, number] = [0.9, 0.96, 0.98];
/** Night lights at close range: the street-light speckle is smooth value noise (lattice cells of 4.9 and 1.2 km) instead of random squares; this is the share of each octave. */
export const LIGHTS_SPECKLE_FINE = 0.55;

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

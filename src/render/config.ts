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
/**
 * The farthest the camera goes in a window at least as wide as it is high (CamFix, D158). The globe's disc then fills `tan(radius) / tan(half
 * the vertical field)` = 63 % of the half-height, which is in the 55 to 80 % the acceptance asks for. A window narrower than it is high needs
 * more (its narrowest direction is the horizontal one): `maxDistKm(aspect)` in `src/render/fit.ts` is the distance with the same fill in the
 * narrowest direction, and `DIST_ABS_MAX_KM` is the ceiling it never passes. M02 to M08 had 42 000 km for every window, which is 50 % of a
 * 16:9 window's half-height and more than 100 % of a 9:16 window's half-width.
 */
export const DIST_MAX_KM = 32000;
export const DIST_ABS_MAX_KM = 150000;
/**
 * Terrain-aware zoom (M07a, the chunk terrain), M08: the mouse, `setView` and every flight stop the camera this high above the displaced
 * ground under it, whatever the ground (sea level or the x12 Himalaya), and never closer than DIST_MIN_GROUND_KM to the focus point.
 * M07a had 1000 m (an accepted band of 0.8 to 1.5 km); the RTS camera of M08 comes down to 300 m (D155).
 */
export const ZOOM_MIN_AGL_M = 300;
export const DIST_MIN_GROUND_KM = 0.3;
/** Tilt limit in degrees from straight down (a horizon view is never allowed). */
export const TILT_MAX_DEG = 72;

// --- Fitting the globe in the window (CamFix, D158) ------------------------------------------------------------------------------------
/** The aspect ratio (width / height) the unit tests and the default arguments of the pure camera maths assume: a 16:9 window. */
export const FIT_REFERENCE_ASPECT = 16 / 9;
/** Narrower windows than this (width / height) are treated as this one: the maximum distance has a ceiling (`DIST_ABS_MAX_KM`) and 1:4 is about where it binds. */
export const FIT_ASPECT_MIN = 0.25;
/** The disc of the globe may take at most this share of the half-width and of the half-height: the free margin on every side is the rest (8 %, the acceptance asks for 5 %). */
export const FIT_FILL_SAFE = 0.92;
/**
 * The eased tilt (D158): the camera's tilt about the focus is the user's tilt as long as the distance is at most `FIT_TILT_FREE_KM` (above that
 * distance the RTS camera of M08 never works: its zoom stops at 5 000 km of height over the ground), then it is brought down to 0 with a smoothstep
 * of the logarithm of the distance, and it is 0 from the distance where the disc fills `FIT_FILL_SAFE` of the narrowest half-extent at tilt 0 (a
 * tilt there would push the far edge of the disc out of the picture: the margin is 8 % and the disc moves by its radius times sin t): from there the
 * whole globe is in the picture, centred, whatever tilt the user came with.
 */
export const FIT_TILT_FREE_KM = 8000;
/**
 * CamFix-2: the fastest the limit on the SHOWN tilt moves (degrees per second of the fx clock): M08's 2.2 degrees per frame at 60 fps. A flight that
 * the user grabs (its poses are placed untilted by the eased limit) and a quick wheel spin then slide to the eased tilt instead of jumping to it.
 */
export const FIT_TILT_RATE_DEG_S = 132;
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
 * The wheel zoom of the RTS camera is a dolly along the ray through the cursor (D157): the camera travels along that ray to the point where
 * its height over the ground is the height the notch asked for, and the ground point under the cursor stays under it. A zoom out whose goal is
 * above `RTS_ZOOM_MAX_AGL_M` (a quarter further up than the globe regime begins) is a globe zoom, not a dolly.
 */
export const RTS_ZOOM_MAX_AGL_M = 5_000_000;
/**
 * A zoom along the cursor ray that would travel more than this many times the change of height it makes goes straight up or down instead
 * (a ray 1 / 8 = 7 degrees under the horizontal travels 8 times; a cursor at the horizon or in the sky, or a slope that falls away along the
 * ray, would otherwise ask for a flight of kilometres for a change of tens of metres).
 */
export const RTS_DOLLY_MAX_TRAVEL = 8;
/** A zoom that ends short of its height (its ray turned while the tilt eased) solves the way left again at most this many times. */
export const RTS_DOLLY_MAX_FIXES = 6;
/**
 * The most a single correction of the cursor anchor or of a drag's grip may turn the rig about the planet's centre: this many times the
 * camera's distance to the point it holds (a flick of the mouse across the whole screen moves a point at range D by about D along the
 * ground), and never less than `RTS_ALIGN_MIN_M` metres of arc. A cursor ray that misses the grabbed sphere has no ground point (such a step
 * is skipped), and a step beyond the cap is cut to it: the nearest point of that sphere can be thousands of kilometres away.
 */
export const RTS_ALIGN_MAX_RANGES = 1;
/**
 * A left drag holds a ground point under the cursor, but not at the horizon: a cursor ray that meets the held surface at less than this
 * cosine to its normal (about 6 degrees above the surface) holds nothing, and the camera stays where it is until the cursor comes back (a
 * pixel there is worth more and more ground; at the horizon it is worth all of it). The weight of the RTS regime scales it, squared.
 */
export const RTS_GRIP_MIN_COS = 0.1;
export const RTS_ALIGN_MIN_M = 2000;
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

// --- Adaptive resolution (AutoTier-2, D160): the numbers of src/render/adaptive.ts ------------------------------------------
/** The drawing-buffer scale ladder (times the tier's pixel ratio); the CSS size, picking and the HUD never change with it. */
export const ADAPT_SCALES: readonly number[] = [1, 0.85, 0.72, 0.6, 0.5];
/** Frames in one measuring window (the statistic is the median of the window). */
export const ADAPT_WINDOW = 30;
/** Frames ignored after the start (and after a restart): shader compilation, the first chunk builds, the texture uploads. */
export const ADAPT_WARMUP_FRAMES = 90;
/** A window median above this (ms) counts as too slow (30 fps = 33.3 ms; the margin is the hysteresis gap below). */
export const ADAPT_DOWN_MS = 30;
/** A window median below this (ms) counts as comfortably fast (a 60 Hz display delivers 16.7 ms). */
export const ADAPT_UP_MS = 18;
/** Slow windows in a row before a step down / fast windows in a row before a step up. */
export const ADAPT_DOWN_WINDOWS = 2;
export const ADAPT_UP_WINDOWS = 4;
/** At least this much frame time (ms, summed over the frames fed in) between two changes. */
export const ADAPT_MIN_INTERVAL_MS = 2000;
/** A frame longer than this (ms) is a tab switch or a stall, not a measurement: it is not fed to the window. */
export const ADAPT_IGNORE_MS = 1000;
/** The chunk density (`Globe.setChunkDensity`, split distances times this) after the scale ladder is used up. */
export const ADAPT_DENSITY_SCALE = 0.7;

// --- Structures (M10 slice 1: the City; the registry in src/render/structureModels.ts is open for the other types) ---------------
/** Size factor of a structure by level (index = level; 0 unused): the model grows 25 % and 50 % with the upgrades. */
export const STRUCT_LEVEL_SCALE: readonly number[] = [0, 1.0, 1.25, 1.5];
/** Look-1: mid-range enlargement. A structure (and its districts) is drawn up to STRUCT_CLOSE_MUL times its true size between camera distances STRUCT_CLOSE_RISE_HI_M and 1.6 times that, rising from 1x at STRUCT_CLOSE_RISE_LO_M (a City is a 15 px blob at 30 km, too small) and easing back to 1x at STRUCT_CLOSE_FAR_M where the scale policy takes over; closer than the rise it is true size, so a City reads as a town at 3 km and as blocks at 800 m. Smoothstep shader maths, no extra draw call. */
export const STRUCT_CLOSE_MUL = 1.7; // Look-2: was 2.4 (a gentler, less massive look)
export const STRUCT_CLOSE_RISE_LO_M = 5000;
export const STRUCT_CLOSE_RISE_HI_M = 25000;
export const STRUCT_CLOSE_FAR_M = 150000;
/** The model keeps at least this share of the camera distance as its radius (the scale policy: world size grows with the distance so that a structure is visible from high up). */
export const STRUCT_SCREEN_FRAC = 0.011;
/** The most the scale policy enlarges a model beyond its true size (a structure from orbit stays a speck rather than a blob the size of a country). */
export const STRUCT_MAX_SCALE = 35; // Look-2: was 70
/** Look-2: the HARD cap of the apparent radius of any model at any camera distance and level, in multiples of its true model size (`radiusM`): the City's is 35 x 700 m = 24.5 km, well under half the spacing of two Cities (3 cells, about 117 km); the other types are capped in proportion. */
export const STRUCT_APPARENT_CAP_MUL = 35;
/** Seconds (fx clock) of the pop-in tween of a structure that appears while the page is watching. */
export const STRUCT_POP_SECONDS = 0.45;
/** While under construction the model grows from this share of its height to the full height. */
export const STRUCT_BUILD_MIN_HEIGHT = 0.3;
/** The triangle allowance of the structure layer per tier; the instance cap of a type is this divided by the triangles of its model. */
export const STRUCT_TRIANGLE_BUDGET: Record<'test' | 'low' | 'medium' | 'high', number> = { test: 15000, low: 30000, medium: 60000, high: 120000 };
/** Fix-3B: over its allowance the layer ranks the local player's structures first and then the nearest the camera, but only when the camera is lower than this (Earth radii of altitude, about 3200 km: higher up a model is under the icon threshold anyway and the cut is by id). */
export const STRUCT_RANK_NEAR_ER = 0.5;
/** Fix-3B: a ranked layer is re-ranked when the camera has moved more than this share of its altitude (never below STRUCT_RANK_MIN_ALT_ER of altitude) since the last ranking: not every frame. */
export const STRUCT_RERANK_MOVE_FRAC = 0.25;
export const STRUCT_RANK_MIN_ALT_ER = 0.005;
/** M10-3: the SAM site's radar dish turns this many radians per fx second (a slow sweep; the angle is computed in the vertex shader). */
export const STRUCT_DISH_RAD_PER_SEC = 0.9;
/** Ghost colours (placement preview), sRGB 0 to 1, and how far they pull the model's own colours. */
export const GHOST_OK_RGB: readonly [number, number, number] = [0.25, 0.95, 0.4];
export const GHOST_BAD_RGB: readonly [number, number, number] = [1.0, 0.25, 0.2];
export const GHOST_MIX = 0.55;
export const GHOST_ALPHA = 0.7;

// ---- M10-4: rings, far icons, night lights ----------------------------------------------------------------------------------------------
/** The icon takes over from the model between these two projected model radii in pixels (full model above ICON_FADE_PX_HI, full icon below ICON_FADE_PX_LO). */
export const ICON_FADE_PX_HI = 6;
export const ICON_FADE_PX_LO = 3;
/** The icon's half size on screen in pixels. */
export const ICON_HALF_PX = 5;
/** Fix-3B: far icons are never wider than this share of the on-screen distance between two structures (half size = share x spacing in pixels), and never smaller than ICON_HALF_PX_MIN pixels; `ICON_SPACING_LAT_FACTOR` narrows the grid spacing for the latitudes where most nations stand. */
export const ICON_SPACING_FRAC = 1 / 3;
export const ICON_HALF_PX_MIN = 3.5;
export const ICON_SPACING_LAT_FACTOR = 0.65;
/** Ring line half width: at least this many render metres, and at least this share of the camera distance (about 1.5 px at 540 px). */
export const RING_HALF_WIDTH_M = 25;
export const RING_HALF_WIDTH_FRAC = 0.0022;
/** Segments of a ring. */
export const RING_SEGMENTS = 96;
/** Ring colours (sRGB). */
export const SELECT_RING_RGB: readonly [number, number, number] = [1.0, 0.92, 0.35];
export const RANGE_RING_RGB: readonly [number, number, number] = [0.45, 0.85, 1.0];
/** Fix-4B: the pulsing ring round an own beachhead that is not yet ordinary land: radius in sim cells (the landing takes a 3x3 block), at most this many rings, pulse speed in radians per second, alpha range. */
export const BEACH_RING_RADIUS_CELLS = 2.2;
export const BEACH_RING_MAX = 3;
export const BEACH_RING_PULSE_RAD_PER_SEC = 4;
export const BEACH_RING_ALPHA_MIN = 0.4;
export const BEACH_RING_ALPHA_MAX = 0.95;
/** A city light is lit where the sun's elevation (dot of the surface normal and the sun) is below this value: the middle of the shader's day smoothstep (-0.10 .. 0.20). */
export const NIGHT_LIGHT_SUN_DOT = 0.05;

// ---- Districts-2b: the district layer (src/render/districts.ts) ----
/** The triangle allowance of the district layer per tier (all four models ride in one geometry, so an instance counts the sum of the four models). */
export const DISTRICT_TRIANGLE_BUDGET: Record<'test' | 'low' | 'medium' | 'high', number> = { test: 9000, low: 18000, medium: 36000, high: 72000 };
/** Size factor of a district by level (index = level; 0 unused). */
export const DISTRICT_LEVEL_SCALE: readonly number[] = [0, 1.0, 1.2, 1.4];
/**
 * The slots stand on a ring of this radius in City model units (the City's rim is at 1.0), at these angles (radians, model +x = 0); a City of level L uses the
 * first `districtSlotsOf(L)` of them (2 / 3 / 4 / 5, DISTRICT_MAX_SLOTS entries). Fixed, so a district never moves when the City levels up. Integration
 * Sim-Growth + Look-1: the five slots are the corners of a regular pentagon taken in star order (every second corner, 144 degrees apart), so that 2, 3, 4 and 5
 * slots each spread round the City (gaps 144 / 72 + 144 + 144 / 72 + 72 + 72 + 144 / 72 x 5 degrees) and neighbouring slots are 2 x 1.55 x sin 36 = 1.82 units apart.
 */
export const DISTRICT_RING_R = 1.55;
export const DISTRICT_SLOT_ANGLES: readonly number[] = [0, 1, 2, 3, 4].map((k) => (Math.PI / 4 + (k * 4 * Math.PI) / 5) % (2 * Math.PI));
/** Radius of a district model (City model units) at level 1: the unit model is multiplied by this. */
export const DISTRICT_MODEL_UNIT = 0.42;
/** A district is drawn at its true size (no scale policy). Full above DISTRICT_FADE_PX_HI projected pixels of radius, gone below DISTRICT_FADE_PX_LO. */
export const DISTRICT_FADE_PX_LO = 3;
export const DISTRICT_FADE_PX_HI = 5;

// ---- M13a-1: the helicopter layer (src/render/heliLayer.ts) ----
/** Capacity of the helicopter instance buffer: the sim table's HELI_CAPACITY (a test pins the equality). */
export const HELI_INSTANCE_CAP = 64;
/** The helicopter model is built in a unit disc; this is that unit in FACTORY units (one factory unit = 700 m at true size), so a helicopter keeps a fixed share of its Factory under the scale policy. 0.11 = 77 m. */
export const HELI_MODEL_SCALE = 0.11;
/** Metres of the unit the scale policy works in (the Factory's `radiusM`): the helicopter shares the structures' policy so the pad offset below stays beside the Factory at every zoom. */
export const HELI_POLICY_SIZE_M = 700;
/** Where a parked helicopter stands, in Factory model units: east, up (the plate top), north. A free corner of the plate beside the hall. */
export const HELI_PAD_OFFSET: readonly [number, number, number] = [0.52, 0.055, -0.5];
/** Rotor speed in radians per fx second (the angle is wrapped on the CPU, the rest is vertex-shader maths). */
export const HELI_ROTOR_RAD_PER_SEC = 24;
/** The tail rotor turns this many times faster than the main rotor. */
export const HELI_TAIL_ROTOR_MUL = 1.7;
/** Triangle ceiling of the merged model (the prompt asks for under 150). */
export const HELI_MODEL_MAX_TRIANGLES = 150;

// ---- M13c-2: the ship layer (src/render/shipLayer.ts) ----
/** Capacity of the ship instance buffer: the sim table's SHIP_CAPACITY (a test pins the equality). */
export const SHIP_INSTANCE_CAP = 32;
/** Triangle ceiling of the merged ship model (hull, deckhouse, hatches, wake strip). */
export const SHIP_MODEL_MAX_TRIANGLES = 150;
/** Metres per model unit (half the hull length) at true size: a 360 m transport, drawn larger than a real one so that it reads at 20 km. */
export const SHIP_UNIT_M = 180;
/** The smallest radius of a ship as a share of the camera distance (a few pixels at the globe view of 960x540): the scale policy never draws it smaller, and has no upper cap. */
export const SHIP_MIN_FRAC = 0.009;
/** Metres the hull stands above the sea-level sphere (the sea surface radius is 1: the ground height under a sea cell is 0 and the ship ignores it). */
export const SHIP_LIFT_M = 4;
/** How far a ship that unloads (SHIP_LAND) sinks, in model units (the hull sits half under the water). */
export const SHIP_SINK_UNITS = 0.1;

// ---- M20a-2: the front arrows (src/render/frontLayer.ts) ----
/** The arrows are fully drawn when the camera is lower than FRONT_FADE_FULL_ALT_R Earth radii above the sea-level sphere and gone from FRONT_FADE_GONE_ALT_R (the globe distance). */
export const FRONT_FADE_FULL_ALT_R = 0.35;
export const FRONT_FADE_GONE_ALT_R = 1.0;
/** An arrow is this share of the camera distance long, but never shorter than FRONT_ARROW_MIN_M metres. */
export const FRONT_ARROW_SCREEN_FRAC = 0.07;
export const FRONT_ARROW_MIN_M = 30000;
/** The pulse: radians per fx second, and the share of the alpha it swings (0.22 = between 0.78 and 1.0 of the base). */
export const FRONT_PULSE_RAD_PER_S = 5;
export const FRONT_PULSE_DEPTH = 0.22;
/** The alpha (and width) of an arrow of an attack the local player is not part of, against 1 for the own ones. */
export const FRONT_OTHER_EMPHASIS = 0.5;
/** How far the arrow floats over the ground, in metres. */
export const FRONT_LIFT_M = 60;

// ---- M13a-2: the helicopter effects (src/render/heliFx.ts), the chase camera and the far icon ----
/** The particle pool: two rings (dust, ropes and troop dots; smoke and the crash flash). Together at most HELI_FX_PARTICLES_MAX. */
export const HELI_FX_DUST_POOL = 600;
export const HELI_FX_SMOKE_POOL = 600;
export const HELI_FX_PARTICLES_MAX = HELI_FX_DUST_POOL + HELI_FX_SMOKE_POOL;
/** Shadow blobs, flags and far icons: one instance per helicopter / per beachhead row (the sim tables' sizes, pinned by a test). */
export const HELI_FX_SHADOW_CAP = HELI_INSTANCE_CAP;
export const HELI_FX_ICON_CAP = HELI_INSTANCE_CAP;
export const HELI_FX_FLAG_CAP = 64;
/** Nothing is emitted for a helicopter farther than this from the camera (metres): the particles would be a speck. */
export const HELI_FX_EMIT_MAX_M = 150000;
/** Below this height above the ground (metres) a flying helicopter blows dust up. */
export const HELI_DUST_AGL_M = 160;
/** Dust per fx second: taking off, in low flight, hovering / landing. */
export const HELI_DUST_RATE_LIFT = 38;
export const HELI_DUST_RATE_LOW = 9;
export const HELI_DUST_RATE_LAND = 55;
/** Troop drop: a dot slides down the rope every this many fx seconds; the rope itself (ROPE_DOTS dots) is refreshed every ROPE_REFRESH_S and lives a little longer. */
export const HELI_TROOP_DOT_S = 0.18;
export const HELI_ROPE_DOTS = 7;
export const HELI_ROPE_REFRESH_S = 0.25;
export const HELI_ROPE_LIFE_S = 0.32;
/** The crash: how long smoke is emitted (fx seconds), how many puffs per second, a puff's life, and the number of flash sparks. Smoke is gone about 5 s after the hit. */
export const HELI_SMOKE_EMIT_S = 3;
export const HELI_SMOKE_RATE = 22;
export const HELI_SMOKE_LIFE_S = 2;
export const HELI_FLASH_SPARKS = 16;
/** The flag: hoist time (fx seconds), height of the pole in metres at true size, and the policy size the scale works in. */
export const HELI_FLAG_HOIST_S = 1.6;
export const HELI_FLAG_POLE_M = 150;
/** The shadow blob: half size in metres at true size, the height (metres) at which it has faded away, and the peak alpha. */
export const HELI_SHADOW_HALF_M = 55;
export const HELI_SHADOW_FADE_AGL_M = 900;
export const HELI_SHADOW_ALPHA = 0.5;
/** The far icon: half size in pixels, and the camera distance (metres) above which it is not drawn (the globe view). */
export const HELI_ICON_HALF_PX = 5.5;
export const HELI_ICON_MAX_M = 4_000_000;
/** The chase camera: metres behind the helicopter, metres above it, the least height above the ground, the smoothing time constant (fx seconds) and the extra look-down in degrees. */
export const HELI_CHASE_BACK_M = 420;
export const HELI_CHASE_UP_M = 150;
export const HELI_CHASE_CLEAR_M = 70;
export const HELI_CHASE_SMOOTH_S = 0.45;
export const HELI_CHASE_LEAN_DEG = 4;

// The ONE UI config file (CLAUDE.md, M05): colours, sizes, slider steps and thresholds of the match screen. Game numbers live
// in src/sim/rules.ts, never here. Texts live in src/ui/i18n.ts.

/** Commitment slider: the share of your troops an attack commits, in percent. */
export const COMMIT_MIN_PCT = 5;
export const COMMIT_MAX_PCT = 100;
export const COMMIT_STEP_PCT = 5;
export const COMMIT_DEFAULT_PCT = 40;

/** A press that moves less than this many pixels before it is released is a click (spawn / attack); more is a drag (rotate the globe). */
export const CLICK_MOVE_PX = 6;
/** A touch held this long (fx seconds) without moving more than `CLICK_MOVE_PX` is a long press (M08 input stack; the radial menu of M20b opens on it). */
export const LONG_PRESS_S = 0.5;

/** The speeds the keys step through (pause is separate). */
export const SPEED_STEPS: readonly (1 | 2 | 4)[] = [1, 2, 4];

/** Toast lifetime in FX seconds. */
export const TOAST_SECONDS = 2.6;

/** The troop bar turns to a warning at this share of the cap. */
export const TROOP_WARNING_FRACTION = 0.8;

/** The leaderboard lists this many seats, and your own row besides when you are not among them. */
export const LEADERBOARD_ROWS = 5;
/** True: tribes (neutral extras) take part in the ranking; false (default): only the players, i.e. you and the AI nations. */
export const LEADERBOARD_INCLUDES_TRIBES = false;

/** The "click an enemy to attack" hint stays this many FX seconds after the protection ends. */
export const PLAY_HINT_SECONDS = 12;

/** The globe turns slowly behind the start screen, in degrees of longitude per FX second. */
export const START_SPIN_DEG_PER_S = 2.5;

/** Z order of the DOM layers above the canvas (the Dev panel and its button sit at 40). */
export const Z_HUD = 20;
export const Z_START_SCREEN = 30;
export const Z_SETUP = 30;

/** Sizes. The HUD is built in `em`; the root font size follows the window width between these limits (960 px -> about 16 px, 1920 px -> 22 px). */
export const HUD_FONT_MIN_PX = 14;
export const HUD_FONT_MAX_PX = 22;
export const HUD_FONT_VW = 1;
export const HUD_FONT_BIAS_PX = 6;
/** Every button and the slider are at least this many CSS pixels tall and wide (a finger is about 44). */
export const TARGET_MIN_PX = 44;
/** At or below this viewport width (or in portrait) the HUD uses the narrow layout (banner across the top, leaderboard below it). */
export const NARROW_MAX_PX = 600;

/**
 * Colours. The panels are dark and nearly opaque so that the text stays readable over snow and desert in daylight as well as
 * over the night side (`tests/ui/hudContrast.test.ts` composes the panel over white and black and states the contrast).
 */
export const UI_COLORS = {
  panel: 'rgba(8, 13, 24, 0.88)',
  panelBorder: '#3c5a8f',
  text: '#f3f7ff',
  textDim: '#b4c4e0',
  accent: '#7fd1ff',
  gold: '#ffd666',
  troops: '#8ee6b0',
  bar: '#4fb3ff',
  barWarning: '#ffb02e',
  barTrack: '#1d2c49',
  danger: '#ff8a80',
  button: '#183262',
  buttonActive: '#2a5599',
  buttonBorder: '#4d73b8',
  youRow: 'rgba(127, 209, 255, 0.18)',
  scrim: 'rgba(3, 6, 14, 0.18)',
  scrimEdge: 'rgba(3, 6, 14, 0.62)',
  card: 'rgba(8, 13, 24, 0.80)',
  field: '#0d1830',
} as const;

/** The palette entries the contrast test checks: text colour against the panel colour. */
export const CONTRAST_PAIRS: ReadonlyArray<readonly [keyof typeof UI_COLORS, keyof typeof UI_COLORS]> = [
  ['text', 'panel'],
  ['textDim', 'panel'],
  ['gold', 'panel'],
  ['troops', 'panel'],
  ['barWarning', 'panel'],
  ['danger', 'panel'],
  ['accent', 'panel'],
  ['text', 'button'],
  ['text', 'buttonActive'],
];

/** The graphics tip of the start screen (AutoTier-1): sizes in em of the start card's font, colours from UI_COLORS. */
export const GPU_TIP = {
  fontEm: 0.8,
  padEm: 0.6,
  radiusEm: 0.6,
  gapEm: 0.35,
  background: 'rgba(24, 50, 98, 0.55)',
  border: UI_COLORS.panelBorder,
  text: UI_COLORS.textDim,
} as const;

/** The pref key that remembers a closed graphics tip. */
export const GPU_TIP_PREF_KEY = 'gpuTipClosed';

/** The most characters a custom nation's name may have (the setup trims it first; an empty name is refused). */
export const CUSTOM_NAME_MAX_CHARS = 24;

/**
 * The camera flight to a country on the setup screen: the distance to the focus point is SETUP_FLY_BASE_KM plus SETUP_FLY_AREA_FACTOR times the
 * square root of the country's area in km2, between the two limits (Sweden about 3 800 km, Russia the maximum).
 */
export const SETUP_FLY_BASE_KM = 800;
export const SETUP_FLY_AREA_FACTOR = 4.5;
export const SETUP_FLY_MIN_KM = 1500;
export const SETUP_FLY_MAX_KM = 17000;
/** The flight to a start place the player chose on land (custom nation) stands this far away. */
export const SETUP_PLACE_DIST_KM = 2600;
/** The setup panel's width in em (side panel) and its share of the screen height on a narrow or portrait screen (bottom sheet). */
export const SETUP_PANEL_EM = 23;
export const SETUP_SHEET_VH = 56;
/** The most countries the list shows at once is not limited; the list scrolls inside the panel. The flag preview of the custom nation is this big (px). */
export const FLAG_PREVIEW_W = 96;
export const FLAG_PREVIEW_H = 64;
/** The small flags in the leaderboard and next to your nation's name in the HUD (CSS px; the canvas is drawn once at twice this). */
export const FLAG_ROW_W = 24;
export const FLAG_ROW_H = 16;
/** The default name of a custom nation is not a UI string but a key (see setup.nation.defaultName); the trimmed name may be at most CUSTOM_NAME_MAX_CHARS. */
/** After a match built by the setup screen starts, the camera flies to your capital and stands this far away (km). */
export const START_FLY_KM = 3600;
/** While the setup screen is open and no country is chosen, the globe is shown from this far away (km), moved out from under the panel. */
export const SETUP_IDLE_DIST_KM = 24000;

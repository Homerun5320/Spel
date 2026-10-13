// The ONE UI config file (CLAUDE.md, M05): colours, sizes, slider steps and thresholds of the match screen. Game numbers live
// in src/sim/rules.ts, never here. Texts live in src/ui/i18n.ts.

/** Commitment slider: the share of your troops an attack commits, in percent. */
export const COMMIT_MIN_PCT = 5;
export const COMMIT_MAX_PCT = 100;
export const COMMIT_STEP_PCT = 5;
export const COMMIT_DEFAULT_PCT = 40;

/** A press that moves less than this many pixels before it is released is a click (spawn / attack); more is a drag (rotate the globe). */
export const CLICK_MOVE_PX = 6;

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

/** Sizes. The HUD is built in `em`; the root font size follows the window width between these limits (960 px -> about 16 px, 1920 px -> 22 px). */
export const HUD_FONT_MIN_PX = 14;
export const HUD_FONT_MAX_PX = 22;
export const HUD_FONT_VW = 1;
export const HUD_FONT_BIAS_PX = 6;
/** Every button and the slider are at least this many CSS pixels tall and wide (a finger is about 44). */
export const TARGET_MIN_PX = 44;

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

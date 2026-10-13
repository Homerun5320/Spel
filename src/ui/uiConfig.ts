// UI constants of the match screen (colours, steps, thresholds). Game numbers live in src/sim/rules.ts, never here.

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

/** The troop bar turns to a warning at this share of the cap (Part B shows it in the HUD). */
export const TROOP_WARNING_FRACTION = 0.8;

/** Z order of the DOM layers above the canvas (the Dev panel and its button sit at 40). */
export const Z_HUD = 20;
export const Z_START_SCREEN = 30;

// The calibration bands of the solo expander (M04, D88). M09 and M12 reuse them: they are the yardstick of "how fast does one
// player grow on open land", and a change of CAPTURE_K_MILLI or BASE_COST_TROOPS has to keep a solo player inside them.
// The reference scenario is fixed: ONE player (no tribes, no opponent) spawns on the capital of the largest country with a
// playable capital (Russia, Moscow), seed 1, and the scripted expander of tools/sim/bots.ts attacks unowned land whenever it
// touches any. Land cells are sim cells of the 1024x512 world.
export interface SoloBand {
  readonly country: string;
  readonly seed: number;
  /** Land cells owned after 5 minutes. */
  readonly minute5: readonly [number, number];
  /** Land cells owned after 10 minutes. */
  readonly minute10: readonly [number, number];
}

/** The provisional band of the prompt: about 1 500 to 2 500 cells after 5 minutes and 5 000 to 8 000 after 10 (met after two tuning rounds, D88). */
export const SOLO_BAND: SoloBand = { country: 'RUS', seed: 1, minute5: [1500, 2500], minute10: [5000, 8000] };

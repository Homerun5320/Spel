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

/**
 * The band of the reference bot (the expander of tools/sim/bands.ts's scenario: attacks free land with 100 % and starts a new attack only when the
 * old one has ended); a player who cancels and relaunches does not leave it, because the depth term of the price survives a relaunch (D91).
 * History (the M04 rule: a measured curve moves the band to the measured value +-30 %, with the reason):
 *  - M04: the prompt's provisional 1 500 to 2 500 cells after 5 minutes and 5 000 to 8 000 after 10 (measured 2 428 and 5 115, D88).
 *  - Tempo pass (D142), reason "user feedback: too slow" ("Att erövra länder tar för lång tid", "Jag behövde köra 4x för att den ens skulle vara
 *    spelbart"): the conquest is 3 to 4 times as fast in game seconds. Measured with CAPTURE_K 420 and the tripled regeneration: 8 063 cells after
 *    5 minutes and 10 786 after 10 (1 591 after 1 minute, 5 196 after 3: the old 10-minute size comes after 3 minutes). The band is the measured
 *    value +-30 % (5 644 to 10 482 and 7 550 to 14 022), rounded outwards. After minute 3 the troop pool binds, hence the flatter second half.
 */
export const SOLO_BAND: SoloBand = { country: 'RUS', seed: 1, minute5: [5600, 10500], minute10: [7500, 14000] };

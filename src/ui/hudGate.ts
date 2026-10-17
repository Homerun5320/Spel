// The write gate of the HUD (M20a-lite): the HUD writes the DOM at most `minInterval` fx seconds apart (10 Hz), whatever the frame rate or the game speed. A change of the
// speed, the commitment or the language lets an update through at once (a click on a button must not wait), and so does a clock that went backwards (a restart).
// Pure: the page passes the fx clock (`src/render/clock.ts`), nothing here reads time. Test mode does not use the gate (its HUD numbers are the sim's, not interpolated).
export class HudGate {
  private speed = -1;
  private commit = -1;
  private lang = -1;
  private at = Number.NEGATIVE_INFINITY;

  constructor(private readonly minInterval: number) {}

  /** True when the HUD should write now; the call records the pass. */
  pass(speed: number, commit: number, lang: number, now: number): boolean {
    const same = speed === this.speed && commit === this.commit && lang === this.lang;
    if (same && now >= this.at && now - this.at < this.minInterval) return false;
    this.speed = speed;
    this.commit = commit;
    this.lang = lang;
    this.at = now;
    return true;
  }
}

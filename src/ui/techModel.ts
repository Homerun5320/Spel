// The pure model of the research panel (M18d-2): one cell per technology with its status, the effect line built from the TECH_FX table of rules.ts (never a number of
// its own), the running research for the top bar, and the watcher that turns a new researched tech into a toast. Nothing here knows a rule: a cell's status IS the answer
// of `validateResearch` (the check the sim runs when the intent arrives). The allocation happens when a cell list is built (the panel is open and a second, the mask or
// the language changed); the watcher and `runningResearch` allocate nothing in a quiet frame.
import {
  REJECT_NONE,
  REJECT_TECH_PREREQ,
  TECH_BRANCHES,
  TECH_COUNT,
  TECH_FX,
  TECH_FX_CHANNELS,
  TECH_PRICE_GOLD,
  TECH_STEPS,
  TECH_TICKS,
  TICK_HZ,
  researchTicksNow,
  techBranchOf,
  techPrereqOf,
  techStepOf,
  validateCancelResearch,
  validateResearch,
  type SimView,
} from '../sim/public';
import { formatClock, t, type TextKey } from './i18n';

export type TechStatus = 'done' | 'active' | 'available' | 'locked' | 'blocked';

export interface TechCell {
  readonly tech: number;
  readonly branch: number;
  readonly step: number;
  readonly status: TechStatus;
  /** The `validateResearch` answer (REJECT_NONE for a researchable tech); for a done or running tech the answer the sim would give (REJECT_TECH_DONE / REJECT_TECH_BUSY). */
  readonly reason: number;
  /** Price in SIM gold (show it through `formatGold`, which multiplies by GOLD_DISPLAY_FACTOR). */
  readonly priceGold: number;
  readonly ticks: number;
  /** Ticks left of a running research (0 otherwise), and the bar fill 0..100. */
  readonly ticksLeft: number;
  readonly progressPct: number;
  /** The Research button is enabled (the sim would take the intent now). */
  readonly canResearch: boolean;
  /** The prerequisite tech of a locked cell (-1 = none). */
  readonly prereq: number;
}

// Fix-5A2: the key lists are DERIVED from the counts of rules.ts (the keys themselves are checked by tests/ui/techKeys.test.ts), so a new tech or branch needs its text, not a
// new list. The researched set is a 31-bit mask (`1 << tech`), so more than 31 techs cannot work: the module refuses to load.
if (TECH_COUNT > 31) throw new Error(`TECH_COUNT ${TECH_COUNT} does not fit the 31-bit tech mask`);
/** The key family `prefix` + 0 .. n - 1 (the prefix ends with a dot; tests/i18n.test.ts knows these three families, tests/ui/techKeys.test.ts checks them). */
const keysOf = (prefix: string, n: number): readonly TextKey[] => Array.from({ length: n }, (_, i) => `${prefix}${i}` as TextKey);
export const TECH_NAME_KEYS: readonly TextKey[] = keysOf('tech.name.', TECH_COUNT);
export const TECH_BRANCH_KEYS: readonly TextKey[] = keysOf('tech.branch.', TECH_BRANCHES);
/** One text per effect channel of TECH_FX, with the placeholder {n}. */
export const TECH_FX_KEYS: readonly TextKey[] = keysOf('tech.fx.', TECH_FX_CHANNELS);

/** The non-zero effect channels of a tech as (channel, value) pairs, straight from TECH_FX. */
export function techEffectParts(tech: number): { channel: number; n: number }[] {
  const out: { channel: number; n: number }[] = [];
  for (let c = 0; c < TECH_FX_CHANNELS; c++) {
    const n = TECH_FX[tech * TECH_FX_CHANNELS + c] as number;
    if (n !== 0) out.push({ channel: c, n });
  }
  return out;
}

/** The one-line effect text of a tech: its non-zero channels, each through its text with the table value, joined by a middle dot. */
export function techEffectText(tech: number): string {
  return techEffectParts(tech)
    .map((p) => t(TECH_FX_KEYS[p.channel] as TextKey, { n: p.n }))
    .join(' · ');
}

export function techName(tech: number): string {
  return t(TECH_NAME_KEYS[tech] as TextKey);
}

/** The cell of one tech for `seat`. */
export function techCell(view: SimView, seat: number, tech: number): TechCell {
  const m = view.match;
  const mask = m.techMaskOfSeat(seat);
  const current = m.techCurrentOfSeat(seat);
  const reason = validateResearch(view, seat, tech);
  const done = (mask & (1 << tech)) !== 0;
  const active = current === tech;
  // M18e-1: the time the seat would get NOW (its finished Labs applied) for a tech that has not started; a running one keeps the base time for its bar (the sim fixed its end when it started)
  const ticks = active ? (TECH_TICKS[tech] as number) : researchTicksNow(view, seat, tech);
  const ticksLeft = active ? Math.max(0, (m.techDone[seat] as number) - view.tick) : 0;
  const status: TechStatus = done ? 'done' : active ? 'active' : reason === REJECT_NONE ? 'available' : reason === REJECT_TECH_PREREQ ? 'locked' : 'blocked';
  return {
    tech,
    branch: techBranchOf(tech),
    step: techStepOf(tech),
    status,
    reason,
    priceGold: TECH_PRICE_GOLD[tech] as number,
    ticks,
    ticksLeft,
    progressPct: done ? 100 : active ? Math.min(100, Math.max(0, Math.round(((ticks - ticksLeft) * 100) / ticks))) : 0,
    canResearch: reason === REJECT_NONE,
    prereq: techPrereqOf(tech),
  };
}

/** All 16 cells, index = tech (branch * 4 + step). */
export function buildTechCells(view: SimView, seat: number): TechCell[] {
  const out: TechCell[] = [];
  for (let tech = 0; tech < TECH_COUNT; tech++) out.push(techCell(view, seat, tech));
  return out;
}

/** The Cancel button: enabled when the sim would take CancelResearch now. */
export function cancelState(view: SimView, seat: number): { enabled: boolean; reason: number } {
  const reason = validateCancelResearch(view, seat);
  return { enabled: reason === REJECT_NONE, reason };
}

/** The seconds left of a research, rounded up (a countdown never shows 0:00 while time is left). */
export const techSecondsLeft = (ticks: number): number => Math.ceil(ticks / TICK_HZ);

/** The countdown text "m:ss". */
export const techClock = (ticks: number): string => formatClock(techSecondsLeft(ticks));

/** The research that runs now for the top bar: its tech and ticks left, or tech -1. Writes into `out` (no allocation). */
export interface RunningResearch {
  tech: number;
  ticksLeft: number;
}
export function runningResearch(view: SimView, seat: number, out: RunningResearch): RunningResearch {
  const m = view.match;
  const cur = m.techCurrentOfSeat(seat);
  out.tech = cur;
  out.ticksLeft = cur < 0 ? 0 : Math.max(0, (m.techDone[seat] as number) - view.tick);
  return out;
}

/**
 * Turns a new researched tech of the local seat into news (the toast). Called every frame; allocates nothing. The first look only learns the mask. A tech counts as news
 * when its bit appears in the mask (also several at once). Cancelled research never sets a bit, so it is no news.
 */
export class TechWatcher {
  private mask = 0;
  private primed = false;
  constructor(private readonly news: (tech: number) => void) {}
  update(view: SimView, seat: number): void {
    const mask = view.match.techMaskOfSeat(seat);
    if (this.primed && mask !== this.mask) {
      for (let tech = 0; tech < TECH_COUNT; tech++) if ((mask & (1 << tech)) !== 0 && (this.mask & (1 << tech)) === 0) this.news(tech);
    }
    this.mask = mask;
    this.primed = true;
  }
}

export { TECH_BRANCHES, TECH_STEPS };

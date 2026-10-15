// The win conditions of the setup screen as plain data (M18-2): the DRAFT the three switches and the presets edit, the map to and from the
// sim's `WinConfig` (the block of `MatchSetupConfig.win`), the stored form, and the one-line summary of a rule set. Pure: no DOM, no clock.
// The sim owns the rules (src/sim/win.ts); this file only chooses which of them a match gets and what they are called.
import type { RegionId } from '../data/regions';
import type { WinConfig } from '../sim/public';
import { TICK_MS, WIN_HOLD_TICKS } from '../sim/rules';
import { t } from '../ui/i18n';
import { WIN_SETUP } from '../ui/uiConfig';
import { defaultWinConfig } from './matchSetup';

export interface WinDraft {
  /** Conquer `landPct` percent of the world and hold it. */
  readonly land: boolean;
  readonly landPct: number;
  /** Last nation standing. */
  readonly last: boolean;
  /** Most points when the time is up. */
  readonly score: boolean;
  /** The time limit in minutes: one of `WIN_SETUP.minuteChoices`; 0 = the default of the area. */
  readonly minutes: number;
}

export type WinPreset = 'standard' | 'quick' | 'sandbox';
export const WIN_PRESETS: readonly WinPreset[] = ['standard', 'quick', 'sandbox'];

/** Ticks in one minute of play (the sim runs one tick per TICK_MS). */
export const TICKS_PER_MINUTE = Math.round(60000 / TICK_MS);

const PRESET_DRAFTS: Readonly<Record<WinPreset, WinDraft>> = {
  standard: { land: true, landPct: WIN_SETUP.pctDefault, last: true, score: true, minutes: 0 },
  // "Quick match": points after 8 minutes and last alive; the land rule is off.
  quick: { land: false, landPct: WIN_SETUP.pctDefault, last: true, score: true, minutes: 8 },
  sandbox: { land: false, landPct: WIN_SETUP.pctDefault, last: false, score: false, minutes: 0 },
};

export function presetDraft(p: WinPreset): WinDraft {
  return PRESET_DRAFTS[p];
}

export const DEFAULT_WIN_DRAFT: WinDraft = PRESET_DRAFTS.standard;

const same = (a: WinDraft, b: WinDraft): boolean => a.land === b.land && a.last === b.last && a.score === b.score && (!a.land || a.landPct === b.landPct) && (!a.score || a.minutes === b.minutes);

/** The preset a draft equals (a switch that is off does not care about its number), or null for a custom mix. */
export function presetOf(d: WinDraft): WinPreset | null {
  for (const p of WIN_PRESETS) if (same(d, PRESET_DRAFTS[p])) return p;
  return null;
}

/** The draft with a value pulled into its range (a land share to the slider's limits, minutes to the choices). */
export function clampWinDraft(d: WinDraft): WinDraft {
  const pct = Math.round(Math.min(WIN_SETUP.pctMax, Math.max(WIN_SETUP.pctMin, Number.isFinite(d.landPct) ? d.landPct : WIN_SETUP.pctDefault)));
  const minutes = (WIN_SETUP.minuteChoices as readonly number[]).includes(d.minutes) ? d.minutes : 0;
  return { land: d.land, landPct: pct, last: d.last, score: d.score, minutes };
}

/** Is this value a stored win draft of the current shape? */
export function isWinDraft(v: unknown): v is WinDraft {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.land === 'boolean' && typeof o.last === 'boolean' && typeof o.score === 'boolean' && typeof o.landPct === 'number' && typeof o.minutes === 'number';
}

/**
 * The `win` option of a match config for this draft: `undefined` = the defaults of the area (the draft equals "Standard"), `null` = the match never
 * ends (every switch off), else an explicit block. Numbers are clamped first, so the block is always one `validWinConfig` accepts.
 */
export function winConfigOf(draft: WinDraft, region: RegionId): WinConfig | null | undefined {
  const d = clampWinDraft(draft);
  if (!d.land && !d.last && !d.score) return null;
  if (same(d, PRESET_DRAFTS.standard)) return undefined;
  const base = defaultWinConfig(region);
  return {
    land: d.land,
    last: d.last,
    score: d.score,
    timeLimitTicks: d.minutes === 0 ? base.timeLimitTicks : d.minutes * TICKS_PER_MINUTE,
    landSharePct: d.landPct,
    holdTicks: WIN_HOLD_TICKS,
  };
}

/** The draft a stored or given config means (the reverse of `winConfigOf`; a minute count that is not a choice becomes "the default of the area"). */
export function winDraftOf(cfg: WinConfig | null | undefined, region: RegionId): WinDraft {
  if (cfg === undefined) return DEFAULT_WIN_DRAFT;
  if (cfg === null) return PRESET_DRAFTS.sandbox;
  const base = defaultWinConfig(region);
  const minutes = cfg.timeLimitTicks === base.timeLimitTicks ? 0 : cfg.timeLimitTicks / TICKS_PER_MINUTE;
  return clampWinDraft({ land: cfg.land, landPct: cfg.landSharePct, last: cfg.last, score: cfg.score, minutes });
}

/** The facts a summary needs: which switches are on and their numbers. */
export interface WinInfo {
  readonly land: boolean;
  readonly last: boolean;
  readonly score: boolean;
  readonly landSharePct: number;
  readonly holdTicks: number;
  readonly timeLimitTicks: number;
}

/** From a config block as `createMatch` gets it (absent = the area's defaults, null = never ends). */
export function winInfoOfConfig(cfg: WinConfig | null | undefined, region: RegionId): WinInfo {
  if (cfg === null) return { land: false, last: false, score: false, landSharePct: 0, holdTicks: 0, timeLimitTicks: 0 };
  const c = cfg ?? defaultWinConfig(region);
  return { land: c.land, last: c.last, score: c.score, landSharePct: c.landSharePct, holdTicks: c.holdTicks, timeLimitTicks: c.timeLimitTicks };
}

/** From the sim's `MatchView` (flags: 1 land, 2 last, 4 score; 0 = never ends). */
export function winInfoOfView(m: { readonly winFlags: number; readonly landSharePct: number; readonly holdTicks: number; readonly timeLimitTicks: number }): WinInfo {
  return { land: (m.winFlags & 1) !== 0, last: (m.winFlags & 2) !== 0, score: (m.winFlags & 4) !== 0, landSharePct: m.landSharePct, holdTicks: m.holdTicks, timeLimitTicks: m.timeLimitTicks };
}

/** Seconds of a hold and minutes of a limit as shown (whole numbers; a limit that is not a whole minute is rounded). */
const secondsOf = (ticks: number): number => Math.round((ticks * TICK_MS) / 1000);
const minutesOf = (ticks: number): number => Math.round(ticks / TICKS_PER_MINUTE);

/** One line that says how this match is won, in the UI language: "Erövra 60 % av världen ... · Sist kvar · Flest poäng efter 12 min", or the sandbox line. */
export function winSummaryText(w: WinInfo): string {
  const parts: string[] = [];
  if (w.land) parts.push(t('win.part.land', { pct: w.landSharePct, secs: secondsOf(w.holdTicks) }));
  if (w.last) parts.push(t('win.part.last'));
  if (w.score) parts.push(t('win.part.score', { min: minutesOf(w.timeLimitTicks) }));
  if (parts.length === 0) return t('win.sandbox');
  return t('win.summary', { parts: parts.join(' · ') });
}

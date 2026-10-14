// The state of the setup screen as plain data, and what it means (M06, item 1, 4, 6): the DRAFT of a match (what the player has
// chosen so far), the check that turns a draft into a `MatchSetupConfig` or the reason it cannot start yet (an i18n key), and the stored
// form of a draft (`prefs.ts`). Pure: no DOM, no clock; the screen (src/app/setupScreen.ts) only edits the draft and shows the check.
import { isRegionId, type RegionId } from '../data/regions';
import type { TextKey } from '../ui/i18n';
import { CUSTOM_NAME_MAX_CHARS } from '../ui/uiConfig';
import { countryEligibility, startCellEligibility } from './eligibility';
import { CUSTOM_COLORS, DIFFICULTIES, matchSetupConfig, type Difficulty, type MatchSetupConfig } from './matchSetup';
import type { PreparedWorld } from './matchWorld';
import { SETUP_AI_NATIONS_DEFAULT, SETUP_AI_NATIONS_MAX } from '../sim/rules';

export type SetupTab = 'real' | 'custom';

export interface SetupDraft {
  readonly tab: SetupTab;
  /** The chosen real country (0 = none yet). It may be one that cannot be played: the check says why. */
  readonly countryId: number;
  readonly name: string;
  /** 0xRRGGBB, one of CUSTOM_COLORS. */
  readonly color: number;
  readonly flagSeed: number;
  /** The chosen start cell of a custom nation (-1 = none yet). */
  readonly cell: number;
  readonly region: RegionId;
  readonly aiNations: number;
  readonly tribes: boolean;
  readonly difficulty: Difficulty;
  readonly neutral: boolean;
  /** The seed as typed (an integer, or text that is not one yet). */
  readonly seed: string;
}

export function defaultDraft(seed: number, name: string): SetupDraft {
  return {
    tab: 'real',
    countryId: 0,
    name,
    color: CUSTOM_COLORS[0] as number,
    flagSeed: 1,
    cell: -1,
    region: 'world',
    aiNations: SETUP_AI_NATIONS_DEFAULT,
    tribes: true,
    difficulty: 'normal',
    neutral: false,
    seed: String(seed),
  };
}

/** Why a draft cannot start yet (an i18n key with its numbers) or the config it makes. */
export type DraftCheck =
  | { readonly ok: true; readonly config: MatchSetupConfig; readonly key: null; readonly params: null }
  | { readonly ok: false; readonly config: null; readonly key: TextKey; readonly params: Readonly<Record<string, number>> | null };

const SEED_PATTERN = /^-?\d{1,10}$/;

/** The seed as an integer, or null when the text is not one the sim takes (a 32-bit integer). */
export function parseSeed(text: string): number | null {
  const s = text.trim();
  if (!SEED_PATTERN.test(s)) return null;
  const n = Number(s);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}

/** The trimmed name of a custom nation, or null when it is empty or too long. */
export function cleanName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, ' ');
  return n.length > 0 && n.length <= CUSTOM_NAME_MAX_CHARS ? n : null;
}

/** Can this draft start, and if not, what is missing? `debugIntents` is the test mode's switch. */
export function checkDraft(world: PreparedWorld, draft: SetupDraft, debugIntents = false): DraftCheck {
  const seed = parseSeed(draft.seed);
  if (seed === null) return { ok: false, config: null, key: 'setup.need.seed', params: null };
  const analysis = world.analyse(draft.region);
  const options = { seed, region: draft.region, aiNations: draft.aiNations, tribes: draft.tribes, difficulty: draft.difficulty, debugIntents };
  if (draft.tab === 'real') {
    if (draft.countryId === 0) return { ok: false, config: null, key: 'setup.need.country', params: null };
    const country = world.byId.get(draft.countryId);
    if (country === undefined) return { ok: false, config: null, key: 'setup.need.country', params: null };
    const e = countryEligibility(analysis, country);
    if (!e.ok) return { ok: false, config: null, key: e.key as TextKey, params: e.params };
    return { ok: true, config: matchSetupConfig({ kind: 'real', countryId: country.id }, { ...options, neutral: false }), key: null, params: null };
  }
  const name = cleanName(draft.name);
  if (name === null) return { ok: false, config: null, key: 'setup.need.name', params: null };
  if (draft.cell < 0) return { ok: false, config: null, key: 'setup.need.cell', params: null };
  const e = startCellEligibility(world, analysis, draft.cell);
  if (!e.ok) return { ok: false, config: null, key: e.key as TextKey, params: e.params };
  return { ok: true, config: matchSetupConfig({ kind: 'custom', name, color: draft.color, flagSeed: draft.flagSeed, cell: draft.cell }, { ...options, neutral: draft.neutral }), key: null, params: null };
}

// --- Stored form (prefs) --------------------------------------------------------------------------------------------------

/** What is stored: the country by its three-letter code (ids are an artefact of the bake), everything else as it is. */
export interface StoredSetup {
  readonly v: 1;
  readonly tab: SetupTab;
  readonly a3: string;
  readonly name: string;
  readonly color: number;
  readonly flagSeed: number;
  readonly cell: number;
  readonly region: RegionId;
  readonly aiNations: number;
  readonly tribes: boolean;
  readonly difficulty: Difficulty;
  readonly neutral: boolean;
  readonly seed: string;
}

export const SETUP_PREF_KEY = 'setup';

export function storedOf(draft: SetupDraft, world: PreparedWorld): StoredSetup {
  return {
    v: 1,
    tab: draft.tab,
    a3: world.byId.get(draft.countryId)?.a3 ?? '',
    name: draft.name,
    color: draft.color,
    flagSeed: draft.flagSeed,
    cell: draft.cell,
    region: draft.region,
    aiNations: draft.aiNations,
    tribes: draft.tribes,
    difficulty: draft.difficulty,
    neutral: draft.neutral,
    seed: draft.seed,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Is this value a stored setup of the current shape? (A different version, a missing field or a wrong type is refused.) */
export function isStoredSetup(v: unknown): v is StoredSetup {
  if (!isObj(v) || v.v !== 1) return false;
  return (
    (v.tab === 'real' || v.tab === 'custom') &&
    typeof v.a3 === 'string' &&
    typeof v.name === 'string' &&
    typeof v.color === 'number' &&
    typeof v.flagSeed === 'number' &&
    typeof v.cell === 'number' &&
    isRegionId(v.region) &&
    typeof v.aiNations === 'number' &&
    typeof v.tribes === 'boolean' &&
    typeof v.difficulty === 'string' &&
    typeof v.neutral === 'boolean' &&
    typeof v.seed === 'string'
  );
}

/**
 * The draft of a stored setup, with every field checked against what the game takes now (a country that no longer exists, a colour that
 * is not a swatch, a start cell outside the grid, an AI count out of range are replaced by the defaults); `base` supplies those.
 */
export function draftFromStored(stored: StoredSetup, world: PreparedWorld, base: SetupDraft): SetupDraft {
  const cells = world.width * world.height;
  const country = world.countries.find((c) => c.a3 === stored.a3);
  return {
    tab: stored.tab,
    countryId: country?.id ?? 0,
    name: cleanName(stored.name) ?? base.name,
    color: CUSTOM_COLORS.includes(stored.color) ? stored.color : base.color,
    flagSeed: Number.isInteger(stored.flagSeed) && stored.flagSeed >= -2147483648 && stored.flagSeed <= 4294967295 ? stored.flagSeed : base.flagSeed,
    cell: Number.isInteger(stored.cell) && stored.cell >= 0 && stored.cell < cells ? stored.cell : -1,
    region: stored.region,
    aiNations: Number.isInteger(stored.aiNations) && stored.aiNations >= 0 && stored.aiNations <= SETUP_AI_NATIONS_MAX ? stored.aiNations : base.aiNations,
    tribes: stored.tribes,
    difficulty: (DIFFICULTIES as readonly string[]).includes(stored.difficulty) ? (stored.difficulty as Difficulty) : base.difficulty,
    neutral: stored.neutral,
    seed: parseSeed(stored.seed) === null ? base.seed : stored.seed.trim(),
  };
}

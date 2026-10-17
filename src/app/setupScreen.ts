// The setup screen (M06, item 1 and 4): where the player chooses a real country (searchable list or a click on the globe) or makes up a
// nation (name, colour, procedural flag with a live preview, a free start place chosen by clicking land), and the options of the match
// (area, number of AI nations, tribes, difficulty, seed, "no real borders"). Plain DOM built from JS; every text goes through t() (both
// tables), every size and colour is in src/ui/uiConfig.ts. The screen holds a DRAFT (src/app/setupModel.ts) and shows what the draft
// means (`checkDraft`); it never touches the sim. The globe belongs to the page: the screen is told about clicks on it
// (`globeClick`) and asks the page to fly the camera, outline a country and mark the start place through `SetupHooks`.
import type { GlobePick } from '../render/describe';
import { federationOfCell } from '../data/federations';
import { REGION_IDS, type RegionId } from '../data/regions';
import { SETUP_AI_NATIONS_MAX, START_DISC_CELLS } from '../sim/rules';
import { cssOfHex, drawFlag, flagSpecText, makeFlagSpec } from '../ui/flag';
import { getLanguage, onLanguageChange, setLanguage, t, tn, type TextKey } from '../ui/i18n';
import { mountHudStyle } from '../ui/hudStyle';
import { CUSTOM_NAME_MAX_CHARS, FLAG_PREVIEW_H, FLAG_PREVIEW_W, SETUP_FLY_MAX_KM, SETUP_PLACE_DIST_KM, WIN_SETUP } from '../ui/uiConfig';
import { resolveClickCell } from './clickTarget';
import { countryName, searchCountries } from './countrySearch';
import { countryViews, flyDistanceKm } from './countryGeo';
import { countryEligibility, startCellEligibility } from './eligibility';
import { membersOf } from './federationSetup';
import { federationLineModel, startableSubNations } from './federationStarts';
import { CUSTOM_COLORS, DIFFICULTIES, maxAiNations, type Difficulty, type MatchSetupConfig, type SetupError } from './matchSetup';
import type { CountryInfo, PreparedWorld } from './matchWorld';
import type { CityStyle } from '../render/cityTiers';
import { otherCityStyle } from './cityStyle';
import { checkDraft, type DraftCheck, type SetupDraft, type SetupTab } from './setupModel';
import { WIN_PRESETS, clampWinDraft, presetDraft, presetOf, winConfigOf, winInfoOfConfig, winSummaryText, type WinPreset } from './winSetup';

/** What the page does for the screen. */
export interface SetupHooks {
  /** Fly the camera to a place; `shiftX` / `shiftY` keep it out from under the panel (shares of half the screen, see flyTo). */
  flyTo(lat: number, lon: number, distKm: number, shiftX: number, shiftY: number): void;
  /** Outline these country ids on the globe (an empty list clears the outline). */
  select(ids: readonly number[]): void;
  /** Mark the chosen start cell of a custom nation on the globe (null = no marker). */
  marker(cell: number | null): void;
  /** The draft changed (the page stores it in the preferences). */
  changed(draft: SetupDraft): void;
  /** Start the match. Resolves to null on success or to the error to show. */
  start(config: MatchSetupConfig, draft: SetupDraft): Promise<SetupError | null>;
  /** Leave the screen (back to the main menu). */
  back(): void;
  /** Look-1: the City style setting (a button in the header cycles it). */
  cityStyle?: { get(): CityStyle; set(style: CityStyle): void };
}

export interface SetupScreen {
  readonly root: HTMLElement;
  draft(): SetupDraft;
  /** The player clicked the globe (a pick of `Globe.pick`). */
  globeClick(pick: GlobePick): void;
  /** Flies to the current choice again (after the panel moved or the window changed). */
  refly(): void;
  /** How far the panel covers the screen, as the shares of half the width and half the height `flyTo` takes (so a place can be put into the free part). */
  panelShift(): { x: number; y: number };
  dispose(): void;
}

const REGION_KEYS: Readonly<Record<RegionId, TextKey>> = {
  world: 'setup.region.world',
  europe: 'setup.region.europe',
  eastAsia: 'setup.region.eastAsia',
  americas: 'setup.region.americas',
  africaMiddleEast: 'setup.region.africaMiddleEast',
};

const PRESET_KEYS: Readonly<Record<WinPreset, TextKey>> = {
  standard: 'win.preset.standard',
  quick: 'win.preset.quick',
  sandbox: 'win.preset.sandbox',
};

const DIFFICULTY_KEYS: Readonly<Record<Difficulty, TextKey>> = {
  easy: 'setup.difficulty.easy',
  normal: 'setup.difficulty.normal',
  hard: 'setup.difficulty.hard',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className !== '') e.className = className;
  if (testid !== undefined) e.dataset.testid = testid;
  return e;
}

/** The country ids an outline covers: the country alone (a merged territory is never outlined under a neighbour, D127). */
function outlineIds(country: CountryInfo): number[] {
  return [country.id];
}

/** The next flag seed: a fixed linear congruence, so a new flag is a pure function of the old seed (no unseeded randomness). */
export function nextFlagSeed(seed: number): number {
  return (Math.imul(seed | 0, 1664525) + 1013904223) | 0;
}

export function mountSetupScreen(parent: HTMLElement, world: PreparedWorld, initial: SetupDraft, hooks: SetupHooks, options: { debugIntents?: boolean } = {}): SetupScreen {
  let draft = initial;
  let message: { key: TextKey; params?: Record<string, string | number> } | null = null;
  let starting = false;
  let check: DraftCheck = checkDraft(world, draft, options.debugIntents === true);
  const startableCache = new Map<string, number>(); // see startableOf
  const aiMaxCache = new Map<string, number>();
  let aiMax = SETUP_AI_NATIONS_MAX;

  // --- DOM ---
  const root = el('div', 'setup-root', 'setup-screen');
  root.append(mountHudStyle(root));
  const panel = el('div', 'setup-panel', 'setup-panel');
  const head = el('div', 'setup-head');
  const title = el('h2', 'setup-title', 'setup-title');
  const headBtns = el('div', 'setup-head-btns');
  const langBtn = el('button', 'start-btn setup-btn', 'setup-language');
  langBtn.type = 'button';
  const backBtn = el('button', 'start-btn setup-btn', 'setup-back');
  backBtn.type = 'button';
  const styleBtn = el('button', 'start-btn setup-btn', 'setup-citystyle');
  styleBtn.type = 'button';
  styleBtn.hidden = hooks.cityStyle === undefined;
  headBtns.append(styleBtn, langBtn, backBtn);
  head.append(title, headBtns);

  const body = el('div', 'setup-body', 'setup-body');

  const tabs = el('div', 'setup-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabReal = el('button', 'setup-tab', 'setup-tab-real');
  const tabCustom = el('button', 'setup-tab', 'setup-tab-custom');
  for (const b of [tabReal, tabCustom]) {
    b.type = 'button';
    b.setAttribute('role', 'tab');
  }
  tabs.append(tabReal, tabCustom);

  // real country
  const realBox = el('div', 'setup-section', 'setup-real');
  const searchLabel = el('label', 'setup-label');
  const search = el('input', 'setup-input', 'setup-search');
  search.type = 'search';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.id = 'setup-search';
  searchLabel.htmlFor = 'setup-search';
  const pickHint = el('div', 'setup-hint');
  const list = el('div', 'setup-list', 'setup-list');
  list.setAttribute('role', 'listbox');
  realBox.append(searchLabel, search, pickHint, list);

  // custom nation
  const customBox = el('div', 'setup-section', 'setup-custom');
  const nameLabel = el('label', 'setup-label');
  const nameInput = el('input', 'setup-input', 'setup-name');
  nameInput.type = 'text';
  nameInput.id = 'setup-name';
  nameInput.maxLength = CUSTOM_NAME_MAX_CHARS;
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameLabel.htmlFor = 'setup-name';
  const colorLabel = el('div', 'setup-label');
  const swatches = el('div', 'setup-swatches', 'setup-colors');
  swatches.setAttribute('role', 'radiogroup');
  const swatchButtons = CUSTOM_COLORS.map((c, i) => {
    const b = el('button', 'setup-swatch', `setup-color-${i}`);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.style.background = cssOfHex(c);
    b.dataset.color = String(c);
    swatches.append(b);
    return b;
  });
  const flagLabel = el('div', 'setup-label');
  const flagRow = el('div', 'setup-flag-row');
  const flagCanvas = el('canvas', 'setup-flag', 'setup-flag');
  flagCanvas.width = FLAG_PREVIEW_W * 2;
  flagCanvas.height = FLAG_PREVIEW_H * 2;
  flagCanvas.style.width = `${FLAG_PREVIEW_W}px`;
  flagCanvas.style.height = `${FLAG_PREVIEW_H}px`;
  flagCanvas.setAttribute('role', 'img');
  const reroll = el('button', 'start-btn setup-btn', 'setup-reroll');
  reroll.type = 'button';
  flagRow.append(flagCanvas, reroll);
  const placeLabel = el('div', 'setup-label');
  const place = el('div', 'setup-place', 'setup-place');
  customBox.append(nameLabel, nameInput, colorLabel, swatches, flagLabel, flagRow, placeLabel, place);
  // The refusal of the last click on the globe (sea, a land mass that is too small, outside the area): shown in both tabs.
  const placeMsg = el('div', 'setup-message', 'setup-message');
  placeMsg.setAttribute('role', 'status');

  // options
  const optBox = el('div', 'setup-section', 'setup-options');
  const optTitle = el('div', 'setup-subtitle');
  const regionLabel = el('label', 'setup-label');
  const region = el('select', 'setup-input', 'setup-region');
  region.id = 'setup-region';
  regionLabel.htmlFor = 'setup-region';
  const aiLabel = el('label', 'setup-label');
  aiLabel.htmlFor = 'setup-ai';
  const aiRow = el('div', 'setup-ai-row');
  const ai = el('input', 'setup-range', 'setup-ai');
  ai.type = 'range';
  ai.id = 'setup-ai';
  ai.min = '0';
  ai.step = '1';
  const aiValue = el('span', 'setup-ai-value', 'setup-ai-value');
  aiRow.append(ai, aiValue);
  const tribesRow = el('label', 'setup-check');
  const tribes = el('input', '', 'setup-tribes');
  tribes.type = 'checkbox';
  const tribesText = el('span', '');
  tribesRow.append(tribes, tribesText);
  const diffLabel = el('label', 'setup-label');
  const diff = el('select', 'setup-input', 'setup-difficulty');
  diff.id = 'setup-difficulty';
  diffLabel.htmlFor = 'setup-difficulty';
  const diffNote = el('div', 'setup-hint');
  const seedLabel = el('label', 'setup-label');
  const seed = el('input', 'setup-input', 'setup-seed');
  seed.type = 'text';
  seed.inputMode = 'numeric';
  seed.id = 'setup-seed';
  seed.autocomplete = 'off';
  seedLabel.htmlFor = 'setup-seed';
  const seedHint = el('div', 'setup-hint');
  const neutralRow = el('label', 'setup-check');
  const neutral = el('input', '', 'setup-neutral');
  neutral.type = 'checkbox';
  const neutralText = el('span', '');
  neutralRow.append(neutral, neutralText);
  const neutralHint = el('div', 'setup-hint');
  // M18b-2: "Dela upp stormakter" (a checkbox; off by default) and the line that says what it does for the chosen country.
  const fedRow = el('label', 'setup-check');
  const fed = el('input', '', 'setup-federation');
  fed.type = 'checkbox';
  const fedText = el('span', '');
  fedRow.append(fed, fedText);
  const fedHint = el('div', 'setup-hint');
  const fedInfo = el('div', 'setup-hint', 'setup-federation-info');
  // The win conditions (M18-2): three presets, three switches (land share with a slider, last alive, points after a time) and a one-line summary.
  const winTitle = el('div', 'setup-subtitle', 'setup-win-title');
  const winPresets = el('div', 'setup-win-presets', 'setup-win-presets');
  winPresets.setAttribute('role', 'radiogroup');
  const presetButtons = WIN_PRESETS.map((p) => {
    const b = el('button', 'setup-tab', `setup-win-preset-${p}`);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.preset = p;
    winPresets.append(b);
    return b;
  });
  const winLandRow = el('label', 'setup-check');
  const winLand = el('input', '', 'setup-win-land');
  winLand.type = 'checkbox';
  const winLandText = el('span', '');
  winLandRow.append(winLand, winLandText);
  const winPctRow = el('div', 'setup-ai-row');
  const winPct = el('input', 'setup-range', 'setup-win-pct');
  winPct.type = 'range';
  winPct.min = String(WIN_SETUP.pctMin);
  winPct.max = String(WIN_SETUP.pctMax);
  winPct.step = String(WIN_SETUP.pctStep);
  const winPctValue = el('span', 'setup-ai-value', 'setup-win-pct-value');
  winPctRow.append(winPct, winPctValue);
  const winLastRow = el('label', 'setup-check');
  const winLast = el('input', '', 'setup-win-last');
  winLast.type = 'checkbox';
  const winLastText = el('span', '');
  winLastRow.append(winLast, winLastText);
  const winScoreRow = el('label', 'setup-check');
  const winScore = el('input', '', 'setup-win-score');
  winScore.type = 'checkbox';
  const winScoreText = el('span', '');
  winScoreRow.append(winScore, winScoreText);
  const winMinutesLabel = el('label', 'setup-label');
  winMinutesLabel.htmlFor = 'setup-win-minutes';
  const winMinutes = el('select', 'setup-input', 'setup-win-minutes');
  winMinutes.id = 'setup-win-minutes';
  const winSummary = el('div', 'setup-hint', 'setup-win-summary');
  winSummary.setAttribute('role', 'status');
  optBox.append(optTitle, regionLabel, region, aiLabel, aiRow, tribesRow, diffLabel, diff, diffNote, winTitle, winPresets, winLandRow, winPctRow, winLastRow, winScoreRow, winMinutesLabel, winMinutes, winSummary, seedLabel, seed, seedHint, neutralRow, neutralHint, fedRow, fedHint, fedInfo);

  // The neutral disclaimer is always in view (in the footer, above the status); where the lines and names come from is at the end of the body.
  const disclaimer = el('p', 'setup-disclaimer', 'setup-disclaimer');
  const sources = el('p', 'setup-sources', 'setup-sources');
  body.append(tabs, placeMsg, realBox, customBox, optBox, sources);

  const foot = el('div', 'setup-foot');
  const status = el('div', 'setup-status', 'setup-status');
  status.setAttribute('role', 'status');
  const startBtn = el('button', 'start-btn setup-start', 'setup-start');
  startBtn.type = 'button';
  foot.append(disclaimer, status, startBtn);
  panel.append(head, body, foot);
  root.append(panel);
  parent.appendChild(root);
  // The panel keeps its clicks, drags and wheel turns from the globe below (the globe's listeners sit on the canvas, a sibling, but a
  // future listener on the wrapper must not see them either).
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) panel.addEventListener(type, (e) => e.stopPropagation());

  // --- Behaviour ---
  const country = (): CountryInfo | null => (draft.countryId === 0 ? null : (world.byId.get(draft.countryId) ?? null));

  const panelShift = (): { x: number; y: number } => {
    const r = panel.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    const vw = pr.width > 0 ? pr.width : window.innerWidth;
    const vh = pr.height > 0 ? pr.height : window.innerHeight;
    if (r.width >= vw * 0.8) return { x: 0, y: Math.min(0.9, r.height / vh) }; // a bottom sheet: the place goes up
    return { x: Math.min(0.9, r.width / vw), y: 0 };
  };

  /** The shorter side of the free part of the window (what the panel leaves), as a share of the window's height. */
  const freeShare = (s: { x: number; y: number }): number => {
    const pr = parent.getBoundingClientRect();
    const vw = pr.width > 0 ? pr.width : window.innerWidth;
    const vh = pr.height > 0 ? pr.height : window.innerHeight;
    return Math.min(vw * (1 - s.x), vh * (1 - s.y)) / vh;
  };

  const flyToCountry = (c: CountryInfo): void => {
    const v = countryViews(world, draft.region).get(c.id);
    if (v === undefined) return;
    const s = panelShift();
    hooks.flyTo(v.lat, v.lon, flyDistanceKm(v.areaKm2, freeShare(s)), s.x, s.y);
  };

  const flyToCell = (cell: number): void => {
    const x = cell % world.width;
    const y = (cell - x) / world.width;
    const lat = ((world.height - 2 * y - 1) * 90) / world.height;
    const lon = ((2 * x + 1 - world.width) * 180) / world.width;
    const s = panelShift();
    hooks.flyTo(lat, lon, Math.min(SETUP_FLY_MAX_KM, SETUP_PLACE_DIST_KM / Math.max(0.3, Math.min(1, freeShare(s)))), s.x, s.y);
  };

  const apply = (patch: Partial<SetupDraft>): void => {
    draft = { ...draft, ...patch };
    refresh();
    hooks.changed(draft);
  };

  const aiKey = (): string => {
    const base = `${draft.region}|${draft.tab}|${draft.tab === 'real' ? draft.countryId : draft.cell}`;
    return base;
  };

  const updateAiMax = (): void => {
    // The whole world has far more countries than the slider's end (and building a match to count them would freeze the page for a moment
    // at every choice); a cut-out can run short, so there the real number is counted (once per area and player). A world match that still
    // runs short is refused by `createMatch` with the number that exists, and the Start handler lowers the slider to it.
    if (!check.ok || draft.region === 'world') {
      aiMax = SETUP_AI_NATIONS_MAX;
      return;
    }
    const key = aiKey();
    let m = aiMaxCache.get(key);
    if (m === undefined) {
      m = maxAiNations(world, check.config);
      aiMaxCache.set(key, m);
    }
    aiMax = m;
  };

  const listCountries = (): void => {
    const lang = getLanguage();
    const analysis = world.analyse(draft.region);
    const hits = searchCountries(world.countries, search.value, lang);
    list.textContent = '';
    if (hits.length === 0) {
      const empty = el('div', 'setup-empty', 'setup-empty');
      empty.textContent = t('setup.noMatch');
      list.append(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const { country: c } of hits) {
      const e = countryEligibility(analysis, c);
      const row = el('button', 'setup-row', 'setup-row');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.dataset.countryId = String(c.id);
      row.dataset.a3 = c.a3;
      row.dataset.ok = e.ok ? '1' : '0';
      const selected = c.id === draft.countryId;
      row.dataset.selected = selected ? '1' : '0';
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (!e.ok) row.setAttribute('aria-disabled', 'true');
      const name = el('span', 'setup-row-name');
      name.textContent = countryName(c, lang);
      const meta = el('span', 'setup-row-meta');
      meta.textContent = tn('setup.cells', 'setup.cells.one', e.cells, { cells: e.cells });
      row.append(name, meta);
      if (!e.ok && e.key !== null) {
        const why = el('span', 'setup-row-why', 'setup-row-why');
        why.textContent = t(e.key, e.params === null ? undefined : { cells: e.params.cells, need: e.params.need });
        row.append(why);
      }
      frag.append(row);
    }
    list.append(frag);
  };

  const markSelectedRow = (): void => {
    for (const row of Array.from(list.children)) {
      if (!(row instanceof HTMLElement) || row.dataset.countryId === undefined) continue;
      const selected = row.dataset.countryId === String(draft.countryId);
      row.dataset.selected = selected ? '1' : '0';
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
  };

  const drawFlagPreview = (): void => {
    const spec = makeFlagSpec(draft.flagSeed, { primary: draft.color });
    const ctx = flagCanvas.getContext('2d');
    if (ctx !== null) drawFlag(ctx, spec, flagCanvas.width, flagCanvas.height);
    flagCanvas.dataset.spec = flagSpecText(spec);
  };

  const texts = (): void => {
    title.textContent = t('setup.title');
    if (hooks.cityStyle !== undefined) {
      const cur = hooks.cityStyle.get();
      styleBtn.textContent = t('setup.cityStyle', { style: cur === 'new' ? t('setup.cityStyleNew') : t('setup.cityStyleOld') });
      styleBtn.setAttribute('data-style', cur);
    }
    langBtn.textContent = t('start.language');
    langBtn.setAttribute('aria-label', t('start.languageAria'));
    backBtn.textContent = t('setup.back');
    tabReal.textContent = t('setup.tab.real');
    tabCustom.textContent = t('setup.tab.custom');
    searchLabel.textContent = t('setup.search');
    search.placeholder = t('setup.searchPlaceholder');
    pickHint.textContent = t('setup.pickHint');
    nameLabel.textContent = t('setup.nation.name');
    colorLabel.textContent = t('setup.nation.color');
    swatchButtons.forEach((b, i) => b.setAttribute('aria-label', t('setup.nation.colorOption', { n: i + 1 })));
    flagLabel.textContent = t('setup.nation.flag');
    reroll.textContent = t('setup.nation.reroll');
    placeLabel.textContent = t('setup.nation.place');
    optTitle.textContent = t('setup.options');
    regionLabel.textContent = t('setup.region');
    region.textContent = '';
    for (const id of REGION_IDS) {
      const o = el('option', '');
      o.value = id;
      o.textContent = t(REGION_KEYS[id]);
      region.append(o);
    }
    aiLabel.textContent = t('setup.ai');
    tribesText.textContent = t('setup.tribes');
    diffLabel.textContent = t('setup.difficulty');
    diff.textContent = '';
    for (const d of DIFFICULTIES) {
      const o = el('option', '');
      o.value = d;
      o.textContent = t(DIFFICULTY_KEYS[d]);
      diff.append(o);
    }
    diffNote.textContent = t('setup.difficultyNote');
    winTitle.textContent = t('win.title');
    presetButtons.forEach((b, i) => (b.textContent = t(PRESET_KEYS[WIN_PRESETS[i] as WinPreset])));
    winLandText.textContent = t('win.land');
    winLastText.textContent = t('win.last');
    winScoreText.textContent = t('win.score');
    winMinutesLabel.textContent = t('win.minutes');
    winPct.setAttribute('aria-label', t('win.landPct'));
    winMinutes.textContent = '';
    for (const m of WIN_SETUP.minuteChoices) {
      const o = el('option', '');
      o.value = String(m);
      o.textContent = m === 0 ? t('win.minutes.auto') : t('win.minutes.n', { n: m });
      winMinutes.append(o);
    }
    seedLabel.textContent = t('setup.seed');
    seedHint.textContent = t('setup.seedHint');
    neutralText.textContent = t('setup.neutral');
    neutralHint.textContent = t('setup.neutralHint');
    fedText.textContent = t('setup.federation');
    fedHint.textContent = t('setup.federation.hint');
    disclaimer.textContent = t('setup.disclaimer');
    sources.textContent = t('setup.sources');
  };

  const showStatus = (): void => {
    let text: string;
    let kind: 'ok' | 'need' | 'bad';
    const c = country();
    if (check.ok) {
      const name = draft.tab === 'real' && c !== null ? countryName(c, getLanguage()) : draft.name.trim();
      text = t('setup.countryOk', { name, need: START_DISC_CELLS });
      kind = 'ok';
    } else if (draft.tab === 'real' && c !== null) {
      text = `${countryName(c, getLanguage())}: ${t(check.key, check.params ?? undefined)}`;
      kind = 'bad';
    } else {
      text = t(check.key, check.params ?? undefined);
      kind = check.key === 'setup.need.country' || check.key === 'setup.need.name' || check.key === 'setup.need.cell' || check.key === 'setup.need.seed' ? 'need' : 'bad';
    }
    status.textContent = text;
    status.dataset.kind = kind;
    status.dataset.key = check.ok ? '' : check.key;
  };

  function refresh(): void {
    check = checkDraft(world, draft, options.debugIntents === true);
    updateAiMax();
    // tabs
    const realTab = draft.tab === 'real';
    tabReal.setAttribute('aria-selected', realTab ? 'true' : 'false');
    tabCustom.setAttribute('aria-selected', realTab ? 'false' : 'true');
    tabReal.dataset.active = realTab ? '1' : '0';
    tabCustom.dataset.active = realTab ? '0' : '1';
    realBox.hidden = !realTab;
    customBox.hidden = realTab;
    // custom
    if (nameInput.value !== draft.name) nameInput.value = draft.name;
    swatchButtons.forEach((b, i) => {
      const on = CUSTOM_COLORS[i] === draft.color;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.dataset.active = on ? '1' : '0';
    });
    drawFlagPreview();
    if (draft.cell >= 0) {
      const x = draft.cell % world.width;
      const y = (draft.cell - x) / world.width;
      const lat = ((world.height - 2 * y - 1) * 90) / world.height;
      const lon = ((2 * x + 1 - world.width) * 180) / world.width;
      place.textContent = t('setup.nation.placeSet', { lat: lat.toFixed(1), lon: lon.toFixed(1) });
      place.dataset.cell = String(draft.cell);
      place.dataset.set = '1';
    } else {
      place.textContent = t('setup.nation.placeHint');
      place.dataset.cell = '-1';
      place.dataset.set = '0';
    }
    if (message !== null) {
      placeMsg.textContent = t(message.key, message.params);
      placeMsg.dataset.key = message.key;
      placeMsg.hidden = false;
    } else {
      placeMsg.textContent = '';
      placeMsg.dataset.key = '';
      placeMsg.hidden = true;
    }
    // options
    if (region.value !== draft.region) region.value = draft.region;
    ai.max = String(aiMax);
    if (draft.aiNations > aiMax) draft = { ...draft, aiNations: aiMax };
    if (ai.value !== String(draft.aiNations)) ai.value = String(draft.aiNations);
    aiValue.textContent = `${draft.aiNations}${check.ok && aiMax < SETUP_AI_NATIONS_MAX ? ` (${t('setup.aiMax', { n: aiMax })})` : ''}`;
    aiValue.dataset.value = String(draft.aiNations);
    ai.dataset.max = String(aiMax);
    tribes.checked = draft.tribes;
    if (diff.value !== draft.difficulty) diff.value = draft.difficulty;
    if (seed.value !== draft.seed) seed.value = draft.seed;
    const w = draft.win;
    const preset = presetOf(w);
    presetButtons.forEach((b) => {
      const on = b.dataset.preset === preset;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.dataset.active = on ? '1' : '0';
    });
    winPresets.dataset.preset = preset ?? 'custom';
    winLand.checked = w.land;
    winLast.checked = w.last;
    winScore.checked = w.score;
    winPct.disabled = !w.land;
    winPct.value = String(w.landPct);
    winPctValue.textContent = t('win.pct', { n: w.landPct });
    winPctValue.dataset.value = String(w.landPct);
    winMinutes.disabled = !w.score;
    if (winMinutes.value !== String(w.minutes)) winMinutes.value = String(w.minutes);
    winSummary.textContent = winSummaryText(winInfoOfConfig(winConfigOf(w, draft.region), draft.region));
    seed.setAttribute('aria-invalid', check.ok || check.key !== 'setup.need.seed' ? 'false' : 'true');
    neutral.disabled = realTab;
    neutral.checked = !realTab && draft.neutral;
    neutralRow.dataset.disabled = realTab ? '1' : '0';
    fed.checked = draft.federations;
    fed.disabled = world.data.federations == null;
    fedRow.dataset.disabled = fed.disabled ? '1' : '0';
    federationLine();
    markSelectedRow();
    // footer
    showStatus();
    startBtn.disabled = !check.ok || starting;
    startBtn.textContent = starting ? t('setup.starting') : t('setup.start');
    startBtn.dataset.ready = check.ok ? '1' : '0';
    panel.dataset.tab = draft.tab;
  }

  /** The line under the option: which sub-nation you play and how many AI nations the match gets at most (the exact numbers come with the build). */
  function federationLine(): void {
    const f = world.data.federations ?? null;
    const c = draft.tab === 'real' ? country() : null;
    const members = f !== null && c !== null ? membersOf(f, c) : [];
    fedInfo.hidden = !draft.federations;
    fedInfo.dataset.members = String(members.length);
    if (!draft.federations) {
      fedInfo.textContent = '';
      return;
    }
    // Only the sub-nations that can START count (createMatch keeps a country whole when fewer than two can, e.g. India).
    const startable = f === null || c === null || members.length < 2 || !check.ok ? 0 : startableOf(c.id);
    fedInfo.dataset.startable = String(startable);
    const line = federationLineModel(startable, draft.aiNations, SETUP_AI_NATIONS_MAX);
    if (line.key === 'setup.federation.none') {
      fedInfo.textContent = t('setup.federation.none');
      fedInfo.dataset.sub = '0';
      return;
    }
    fedInfo.dataset.sub = String(draft.subNation);
    fedInfo.textContent = t('setup.federation.sub', { country: countryName(c as CountryInfo, getLanguage()), members: line.members, ai: line.ai, max: SETUP_AI_NATIONS_MAX });
  }

  /** The number of startable sub-nations of a country, asked of createMatch once per country, seed and area (a build is dearer than a line of text). */
  function startableOf(countryId: number): number {
    if (!check.ok) return 0;
    const key = `${countryId}|${check.config.seed}|${check.config.region}`;
    let n = startableCache.get(key);
    if (n === undefined) {
      n = startableSubNations(world, { ...check.config, player: { kind: 'real', countryId } });
      startableCache.set(key, n);
    }
    return n;
  }

  const selectCountry = (c: CountryInfo, fly: boolean, subNation = 0): void => {
    message = null;
    apply({ countryId: c.id, tab: 'real', subNation });
    hooks.select(outlineIds(c));
    if (fly) flyToCountry(c);
    // keep the chosen row in view inside the list
    const row = Array.from(list.children).find((r) => r instanceof HTMLElement && r.dataset.countryId === String(c.id));
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  };

  const setTab = (tab: SetupTab): void => {
    if (draft.tab === tab) return;
    message = null;
    apply({ tab });
    if (tab === 'real') {
      const c = country();
      hooks.select(c === null ? [] : outlineIds(c));
      hooks.marker(null);
    } else {
      hooks.select([]);
      hooks.marker(draft.cell >= 0 ? draft.cell : null);
    }
  };

  tabReal.addEventListener('click', () => setTab('real'));
  tabCustom.addEventListener('click', () => setTab('custom'));
  search.addEventListener('input', () => {
    listCountries();
    markSelectedRow();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Enter takes the first hit, but only a country that can be played: a disabled first row (its reason is printed in it) is not chosen.
    const first = list.querySelector('[data-country-id]');
    if (first instanceof HTMLElement && first.dataset.ok === '1') {
      const c = world.byId.get(Number(first.dataset.countryId));
      if (c !== undefined) selectCountry(c, true);
    }
  });
  // Escape: the first press leaves the text field that has the focus, the next one goes back to the main menu. (The search field of type
  // "search" would clear itself on Escape; the key is ours here.) A press the Dev panel already used is not ours.
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented || !root.isConnected || starting) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) && active.type !== 'checkbox') {
      e.preventDefault();
      active.blur();
      return;
    }
    if (active instanceof HTMLElement && !root.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) return; // typing elsewhere
    e.preventDefault();
    hooks.back();
  };
  window.addEventListener('keydown', onEscape);
  list.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-country-id]') : null;
    if (!(target instanceof HTMLElement)) return;
    const c = world.byId.get(Number(target.dataset.countryId));
    if (c !== undefined) selectCountry(c, true);
  });
  nameInput.addEventListener('input', () => apply({ name: nameInput.value }));
  swatchButtons.forEach((b, i) =>
    b.addEventListener('click', () => {
      apply({ color: CUSTOM_COLORS[i] as number });
    }),
  );
  reroll.addEventListener('click', () => {
    apply({ flagSeed: nextFlagSeed(draft.flagSeed) });
    reroll.blur();
  });
  region.addEventListener('change', () => {
    message = null;
    apply({ region: region.value as RegionId });
    listCountries();
    markSelectedRow();
    const c = country();
    if (draft.tab === 'real' && c !== null) flyToCountry(c);
    hooks.marker(draft.tab === 'custom' && draft.cell >= 0 ? draft.cell : null);
  });
  ai.addEventListener('input', () => apply({ aiNations: Number(ai.value) }));
  tribes.addEventListener('change', () => apply({ tribes: tribes.checked }));
  diff.addEventListener('change', () => apply({ difficulty: diff.value as Difficulty }));
  presetButtons.forEach((b) => b.addEventListener('click', () => apply({ win: presetDraft(b.dataset.preset as WinPreset) })));
  winLand.addEventListener('change', () => apply({ win: { ...draft.win, land: winLand.checked } }));
  winLast.addEventListener('change', () => apply({ win: { ...draft.win, last: winLast.checked } }));
  winScore.addEventListener('change', () => apply({ win: { ...draft.win, score: winScore.checked } }));
  winPct.addEventListener('input', () => apply({ win: clampWinDraft({ ...draft.win, landPct: Number(winPct.value) }) }));
  winMinutes.addEventListener('change', () => apply({ win: clampWinDraft({ ...draft.win, minutes: Number(winMinutes.value) }) }));
  seed.addEventListener('input', () => apply({ seed: seed.value }));
  neutral.addEventListener('change', () => apply({ neutral: neutral.checked }));
  fed.addEventListener('change', () => apply({ federations: fed.checked, subNation: 0 }));
  langBtn.addEventListener('click', () => {
    setLanguage(getLanguage() === 'sv' ? 'en' : 'sv');
    langBtn.blur();
  });
  styleBtn.addEventListener('click', () => {
    if (hooks.cityStyle === undefined) return;
    hooks.cityStyle.set(otherCityStyle(hooks.cityStyle.get()));
    texts();
    styleBtn.blur();
  });
  backBtn.addEventListener('click', () => hooks.back());
  startBtn.addEventListener('click', () => {
    if (!check.ok || starting) return;
    const config = check.config;
    starting = true;
    refresh();
    // The page lets the button say "building" (two frames) before the synchronous build of about a quarter of a second starts.
    hooks
      .start(config, draft)
      .then((error) => {
        starting = false;
        if (error !== null) {
          if (error.code === 'notEnoughCountries' && typeof error.params.available === 'number') {
            draft = { ...draft, aiNations: Math.min(draft.aiNations, error.params.available) };
            aiMaxCache.set(aiKey(), error.params.available);
          }
          message = { key: error.key, params: { ...error.params } };
        }
        if (root.isConnected) refresh();
      })
      .catch((err: unknown) => {
        starting = false;
        message = { key: 'setup.error.start', params: { reason: err instanceof Error ? err.message : String(err) } };
        if (root.isConnected) refresh();
      });
  });

  // --- First paint ---
  texts();
  listCountries();
  refresh();
  const stopLang = onLanguageChange(() => {
    texts();
    listCountries();
    refresh();
  });
  // The initial choices reach the globe (a stored country is outlined again, a stored start place is marked).
  if (draft.tab === 'real') {
    const c = country();
    hooks.select(c === null ? [] : outlineIds(c));
  } else {
    hooks.marker(draft.cell >= 0 ? draft.cell : null);
  }

  return {
    root,
    draft: () => draft,
    globeClick(pick: GlobePick): void {
      if (starting) return;
      if (draft.tab === 'real') {
        if (pick.elevationM <= 0 || pick.countryId === 0) {
          message = { key: 'setup.click.sea' };
          refresh();
          return;
        }
        const c = world.byId.get(pick.countryId);
        if (c === undefined) {
          message = { key: 'setup.click.unknown' };
          refresh();
          return;
        }
        // A click inside a split country picks the sub-nation under the pointer.
        const f = world.data.federations ?? null;
        selectCountry(c, false, draft.federations && f !== null ? federationOfCell(f, pick.cell.index) : 0);
        return;
      }
      const analysis = world.analyse(draft.region);
      const cell = resolveClickCell(pick, analysis.terrain, world.width, world.height);
      const e = startCellEligibility(world, analysis, cell);
      if (!e.ok && e.key !== null) {
        message = { key: e.key, params: e.params === null ? undefined : { cells: e.params.cells, need: e.params.need } };
        placeMsg.dataset.reason = e.reason ?? '';
        refresh();
        return;
      }
      message = null;
      placeMsg.dataset.reason = '';
      apply({ cell });
      hooks.marker(cell);
    },
    panelShift,
    refly(): void {
      const c = country();
      if (draft.tab === 'real' && c !== null) flyToCountry(c);
      else if (draft.tab === 'custom' && draft.cell >= 0) flyToCell(draft.cell);
    },
    dispose(): void {
      stopLang();
      window.removeEventListener('keydown', onEscape);
      root.remove();
    },
  };
}

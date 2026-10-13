// i18n (CHARTER section 2, invariant 10): every player-facing string goes through `t(key, params?)`. Two tables, `sv` (the
// default language) and `en`, are edited together: `en` is typed `Record<TextKey, string>`, so a key missing from either
// table (or an extra one) does not compile, and `tests/i18n.test.ts` checks the same at run time plus the placeholders and
// that every `t('...')` literal in `src` names a real key. In test mode `setStrictI18n(true)` turns a missing key (or a
// missing placeholder value) into an exception, which the e2e tests see as a page error.
//
// Developer tools (the Dev panel, the perf overlay and its report, the debug pages) are Swedish only on purpose (D98).

export type Lang = 'sv' | 'en';
export const LANGUAGES: readonly Lang[] = ['sv', 'en'];
export const DEFAULT_LANGUAGE: Lang = 'sv';

const sv = {
  'app.title': 'Erövra jorden',
  'app.tagline': 'Välj en startplats på jordklotet, bygg ut din nation över berg och slätter och ta mark från stamfolk och AI-nationer.',
  'app.loading': 'Laddar världen...',
  'app.error': 'Kunde inte starta: {message}',

  'start.play': 'Spela',
  'start.dev': 'Dev',
  'start.devAria': 'Öppna Dev-panelen (F2)',
  'start.language': 'English',
  'start.languageAria': 'Byt språk till engelska',
  'start.helpTitle': 'Så spelar du',
  'help.click': 'Klicka på marken: först spawna, sedan anfalla fiende- eller oägd mark',
  'help.drag': 'Dra med musen: snurra globen. Mushjul: zooma',
  'help.commit': '[ och ]: insats i steg om 5 % (även - och + fungerar)',
  'help.speed': 'Mellanslag: paus. , och .: långsammare och snabbare',
  'help.dev': 'F2: Dev-panelen. F3: bildfrekvens',

  'hud.gold': 'Guld',
  'hud.goldRate': '+{rate}/s',
  'hud.troops': 'Trupper',
  'hud.cap': 'tak {cap}',
  'hud.nearCap': 'Nära taket',
  'hud.landShare': 'Landandel',
  'hud.timer': 'Tid',
  'hud.leaderboard': 'Ledartavla',
  'hud.leaderboardEmpty': 'Ingen har spawnat än',
  'hud.you': 'Du',
  'hud.nation': 'Nation {n}',
  'hud.tribe': 'Stam {n}',
  'hud.rank': '{n}.',
  'hud.percent': '{n} %',
  'hud.speedLabel': 'Hastighet',
  'hud.pause': 'Paus',
  'hud.speedValue': '{n}x',
  'hud.commit': 'Insats',
  'hud.commitTroops': '{n} trupper',
  'hud.commitAria': 'Insats i procent av trupperna',

  'phase.spawnPick': 'Välj din startplats: klicka på marken',
  'phase.spawnDone': 'Startplats vald. Väntar på att fasen tar slut',
  'phase.spawnMissed': 'Du hann inte välja startplats. Ladda om sidan för en ny match.',
  'phase.immunity': 'Skyddad en kort stund. Gör dig redo att anfalla',
  'phase.play': 'Klicka på fiende- eller oägd mark för att anfalla',
  'phase.seconds': '{s} s',
  'phase.paused': 'Pausat',

  'reject.terrain': 'Du kan inte spawna där (hav, bergstopp eller is).',
  'reject.owned': 'Någon äger redan marken där.',
  'reject.spawned': 'Du har redan spawnat.',
  'reject.phase': 'Det går inte i den här fasen.',
  'reject.immune': 'Skyddad de första sekunderna.',
  'reject.noContact': 'Du gränsar inte till den marken.',
  'reject.noTroops': 'Inga trupper att skicka.',
  'reject.self': 'Det är din egen mark.',
  'reject.notSpawned': 'Spawna först.',
  'reject.amount': 'Ogiltigt belopp.',
  'reject.pct': 'Insatsen måste vara minst 5 %.',
  'reject.other': 'Avvisat (kod {code}).',
  'toast.notConquerable': 'Det går inte att erövra (hav, bergstopp eller is).',

  'tooltip.sea': 'Hav',
  'tooltip.unknownCountry': 'Okänt land',
  'class.0': 'Djuphav',
  'class.1': 'Grunt hav',
  'class.2': 'Slätt',
  'class.3': 'Skog',
  'class.4': 'Kullar',
  'class.5': 'Berg',
  'class.6': 'Bergstopp',
  'class.7': 'Is',
} as const;

export type TextKey = keyof typeof sv;

const en: Record<TextKey, string> = {
  'app.title': 'Conquer the Earth',
  'app.tagline': 'Pick a starting place on the globe, grow your nation across mountains and plains and take land from tribes and AI nations.',
  'app.loading': 'Loading the world...',
  'app.error': 'Could not start: {message}',

  'start.play': 'Play',
  'start.dev': 'Dev',
  'start.devAria': 'Open the Dev panel (F2)',
  'start.language': 'Svenska',
  'start.languageAria': 'Switch the language to Swedish',
  'start.helpTitle': 'How to play',
  'help.click': 'Click the ground: first to spawn, then to attack enemy or unowned land',
  'help.drag': 'Drag with the mouse: rotate the globe. Mouse wheel: zoom',
  'help.commit': '[ and ]: commitment in steps of 5 % (- and + work too)',
  'help.speed': 'Space: pause. , and .: slower and faster',
  'help.dev': 'F2: the Dev panel. F3: frame rate',

  'hud.gold': 'Gold',
  'hud.goldRate': '+{rate}/s',
  'hud.troops': 'Troops',
  'hud.cap': 'cap {cap}',
  'hud.nearCap': 'Near the cap',
  'hud.landShare': 'Land share',
  'hud.timer': 'Time',
  'hud.leaderboard': 'Leaderboard',
  'hud.leaderboardEmpty': 'Nobody has spawned yet',
  'hud.you': 'You',
  'hud.nation': 'Nation {n}',
  'hud.tribe': 'Tribe {n}',
  'hud.rank': '{n}.',
  'hud.percent': '{n}%',
  'hud.speedLabel': 'Speed',
  'hud.pause': 'Pause',
  'hud.speedValue': '{n}x',
  'hud.commit': 'Commitment',
  'hud.commitTroops': '{n} troops',
  'hud.commitAria': 'Commitment as a percentage of your troops',

  'phase.spawnPick': 'Choose your starting place: click the ground',
  'phase.spawnDone': 'Starting place chosen. Waiting for the phase to end',
  'phase.spawnMissed': 'You did not choose a starting place in time. Reload the page for a new match.',
  'phase.immunity': 'Protected for a short while. Get ready to attack',
  'phase.play': 'Click enemy or unowned land to attack',
  'phase.seconds': '{s} s',
  'phase.paused': 'Paused',

  'reject.terrain': 'You cannot spawn there (sea, peak or ice).',
  'reject.owned': 'Somebody already owns that land.',
  'reject.spawned': 'You have already spawned.',
  'reject.phase': 'That is not possible in this phase.',
  'reject.immune': 'Protected for the first seconds.',
  'reject.noContact': 'You do not border that land.',
  'reject.noTroops': 'No troops to send.',
  'reject.self': 'That is your own land.',
  'reject.notSpawned': 'Spawn first.',
  'reject.amount': 'Invalid amount.',
  'reject.pct': 'The commitment must be at least 5 %.',
  'reject.other': 'Refused (code {code}).',
  'toast.notConquerable': 'That cannot be conquered (sea, peak or ice).',

  'tooltip.sea': 'Sea',
  'tooltip.unknownCountry': 'Unknown country',
  'class.0': 'Deep sea',
  'class.1': 'Shallow sea',
  'class.2': 'Plains',
  'class.3': 'Forest',
  'class.4': 'Hills',
  'class.5': 'Mountains',
  'class.6': 'Peak',
  'class.7': 'Ice',
};

/** The two tables, for the parity test and for tools. Treat as read-only. */
export const TABLES: Readonly<Record<Lang, Readonly<Record<string, string>>>> = { sv, en };

export type TextParams = Readonly<Record<string, string | number>>;

let language: Lang = DEFAULT_LANGUAGE;
let version = 0;
let strict = false;
const listeners = new Set<(lang: Lang) => void>();

export function getLanguage(): Lang {
  return language;
}

/** Increases whenever the language changes: cached texts compare it to know they must be rebuilt. */
export function languageVersion(): number {
  return version;
}

export function setLanguage(next: Lang): void {
  if (next === language) return;
  language = next;
  version++;
  for (const l of listeners) l(next);
}

/** Calls `listener` after the language changed; returns the function that stops it. */
export function onLanguageChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `lang=en` (query or hash) selects English; anything else is the default. */
export function languageOf(raw: Readonly<Record<string, string>>): Lang {
  return raw.lang === 'en' ? 'en' : raw.lang === 'sv' ? 'sv' : DEFAULT_LANGUAGE;
}

/** Test mode: a missing key or placeholder value throws instead of falling back. */
export function setStrictI18n(on: boolean): void {
  strict = on;
}

export function isStrictI18n(): boolean {
  return strict;
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/** The placeholder names of a text, in order of appearance (used by the parity test). */
export function placeholdersOf(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER), (m) => m[1] as string);
}

/**
 * The text of `key` in the current language with `{name}` filled from `params`. A missing key falls back to the other
 * language and then to the key itself; in strict mode (test mode) a key that is missing from EITHER table, or a placeholder
 * without a value, throws.
 */
export function t(key: TextKey, params?: TextParams): string {
  const own = TABLES[language][key];
  const other = TABLES[language === 'sv' ? 'en' : 'sv'][key];
  if (strict && (own === undefined || other === undefined)) {
    throw new Error(`i18n: key "${key}" is missing from the ${own === undefined ? language : language === 'sv' ? 'en' : 'sv'} table`);
  }
  const text = own ?? other ?? key;
  if (params === undefined && !strict) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const v = params?.[name];
    if (v === undefined) {
      if (strict) throw new Error(`i18n: key "${key}" needs the value {${name}}`);
      return whole;
    }
    return String(v);
  });
}

/** True when `key` exists in both tables. */
export function hasKey(key: string): key is TextKey {
  return key in sv && key in en;
}

const GROUP_SEPARATOR: Record<Lang, string> = { sv: ' ', en: ',' };
const DECIMAL_SEPARATOR: Record<Lang, string> = { sv: ',', en: '.' };

/** 1234567 -> "1 234 567" (a no-break space) in Swedish, "1,234,567" in English. Whole numbers only; negative numbers keep the sign. */
export function formatInt(n: number): string {
  const r = Math.round(n);
  const digits = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR[language]);
  return r < 0 ? `-${digits}` : digits;
}

/** `value` with `decimals` decimals and the language's decimal separator; no locale APIs, no float formatting surprises. */
export function formatFixed(value: number, decimals: number): string {
  const scale = decimals === 0 ? 1 : decimals === 1 ? 10 : decimals === 2 ? 100 : 1000;
  const scaled = Math.round(Math.abs(value) * scale);
  const whole = Math.floor(scaled / scale);
  const frac = scaled - whole * scale;
  const sign = value < 0 && scaled > 0 ? '-' : '';
  if (decimals === 0) return `${sign}${formatInt(whole)}`;
  return `${sign}${formatInt(whole)}${DECIMAL_SEPARATOR[language]}${String(frac).padStart(decimals, '0')}`;
}

/** Seconds as "m:ss" (language neutral). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

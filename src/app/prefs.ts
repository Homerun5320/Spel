// Player preferences (M06, item 6): `getPref` / `setPref` over localStorage with JSON values, a key prefix, a try/catch around every
// access and a memory fallback, so the page works when storage is blocked (a private window, blocked site data, the Claude Artifact
// sandbox, a throwing getter): a value that cannot be stored lives for the session in memory and reads back from there. All later
// code that remembers something (language, last menu choices, settings) goes through this file and never touches localStorage.
//
// Rules: values must survive JSON (numbers, strings, booleans, null, arrays and plain objects); a read that finds nothing, finds text
// that is not JSON, or finds a value the caller's check refuses returns the fallback; nothing here ever throws.

/** Every key is stored as this prefix plus the name, so the game's keys never meet another page's on the same origin. */
export const PREF_PREFIX = 'spel.';

/** The part of Web Storage the preferences use. */
export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Key names are short and plain: letters, digits, dot, dash and underscore. */
const KEY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export class Prefs {
  private readonly memory = new Map<string, string>();
  /** Writes that could not reach storage (a counter for the tests and the report). */
  fallbackWrites = 0;

  /** `getStorage` is called on every access (it may throw, return null or a storage that throws). */
  constructor(private readonly getStorage: () => PrefStorage | null) {}

  /** The stored value of `key`, or `fallback` when there is none, it is not valid JSON or `isValid` (when given) refuses it. */
  get<T>(key: string, fallback: T, isValid?: (v: unknown) => v is T): T {
    if (!KEY_PATTERN.test(key)) return fallback;
    const full = PREF_PREFIX + key;
    // A value that could not be stored is newer than anything storage still holds, so the memory is asked first.
    let text: string | null = this.memory.get(full) ?? null;
    if (text === null) {
      try {
        text = this.getStorage()?.getItem(full) ?? null;
      } catch {
        text = null;
      }
    }
    if (text === null) return fallback;
    try {
      const value: unknown = JSON.parse(text);
      if (isValid !== undefined) return isValid(value) ? value : fallback;
      return value as T;
    } catch {
      return fallback;
    }
  }

  /** Stores `value`. Returns true when it reached storage, false when only the memory has it (or the value cannot be stored at all). */
  set(key: string, value: unknown): boolean {
    if (!KEY_PATTERN.test(key)) return false;
    let text: string | undefined;
    try {
      text = JSON.stringify(value);
    } catch {
      return false; // a cycle or a BigInt
    }
    if (text === undefined) return false; // undefined, a function or a symbol
    const full = PREF_PREFIX + key;
    try {
      const storage = this.getStorage();
      if (storage !== null) {
        storage.setItem(full, text);
        this.memory.delete(full);
        return true;
      }
    } catch {
      // fall through to the memory
    }
    this.memory.set(full, text);
    this.fallbackWrites++;
    return false;
  }
}

/** Web Storage of the page, or null when there is none or merely asking for it throws (Safari private mode, blocked site data). */
function pageStorage(): PrefStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const shared = new Prefs(pageStorage);

export function getPref<T>(key: string, fallback: T, isValid?: (v: unknown) => v is T): T {
  return shared.get(key, fallback, isValid);
}

export function setPref(key: string, value: unknown): boolean {
  return shared.set(key, value);
}

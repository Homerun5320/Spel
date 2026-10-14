// Preferences (M06): JSON, a key prefix, a try/catch around every access and a memory fallback when storage throws (a blocked page).
import { describe, expect, it } from 'vitest';
import { PREF_PREFIX, Prefs, type PrefStorage, getPref, setPref } from '../../src/app/prefs';

class MemoryStorage implements PrefStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

/** A storage that throws on every call, like a blocked localStorage. */
const THROWING: PrefStorage = {
  getItem(): string | null {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem(): void {
    throw new DOMException('quota', 'QuotaExceededError');
  },
};

describe('with a working storage', () => {
  it('stores JSON under the key prefix and reads it back, with the fallback for a missing key', () => {
    const storage = new MemoryStorage();
    const p = new Prefs(() => storage);
    expect(p.get('lang', 'sv')).toBe('sv');
    expect(p.set('lang', 'en')).toBe(true);
    expect(storage.items.get(`${PREF_PREFIX}lang`)).toBe('"en"');
    expect(p.get('lang', 'sv')).toBe('en');
    p.set('menu.options', { ai: 12, tribes: true, list: [1, 2, 3], nested: { a: null } });
    expect(p.get('menu.options', null)).toEqual({ ai: 12, tribes: true, list: [1, 2, 3], nested: { a: null } });
    p.set('n', 0);
    p.set('flag', false);
    expect(p.get('n', 7)).toBe(0);
    expect(p.get('flag', true)).toBe(false);
    expect([...storage.items.keys()].every((k) => k.startsWith(PREF_PREFIX))).toBe(true);
    expect(p.fallbackWrites).toBe(0);
  });

  it('returns the fallback for text that is not JSON, and for a value the caller refuses', () => {
    const storage = new MemoryStorage();
    const p = new Prefs(() => storage);
    storage.items.set(`${PREF_PREFIX}broken`, '{not json');
    expect(p.get('broken', 5)).toBe(5);
    p.set('count', 'ten');
    const isNumber = (v: unknown): v is number => typeof v === 'number';
    expect(p.get('count', 3, isNumber)).toBe(3);
    p.set('count', 12);
    expect(p.get('count', 3, isNumber)).toBe(12);
  });

  it('refuses a key that is not plain and a value that is not JSON, without throwing', () => {
    const p = new Prefs(() => new MemoryStorage());
    for (const key of ['', 'a b', 'ä', 'x'.repeat(65), 'a/b']) {
      expect(p.set(key, 1), key).toBe(false);
      expect(p.get(key, 'fb'), key).toBe('fb');
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(p.set('cyc', cyclic)).toBe(false);
    expect(p.set('big', 10n)).toBe(false);
    expect(p.set('u', undefined)).toBe(false);
    expect(p.set('fn', () => 1)).toBe(false);
    expect(p.get('cyc', 'fb')).toBe('fb');
  });
});

describe('when storage throws (localStorage blocked)', () => {
  it('falls back to memory: a value written is read back, nothing throws, and the write says it did not persist', () => {
    const p = new Prefs(() => THROWING);
    expect(p.get('lang', 'sv')).toBe('sv');
    expect(p.set('lang', 'en')).toBe(false);
    expect(p.get('lang', 'sv')).toBe('en');
    expect(p.fallbackWrites).toBe(1);
    p.set('opts', { ai: 3 });
    expect(p.get('opts', null)).toEqual({ ai: 3 });
    p.set('lang', 'sv');
    expect(p.get('lang', 'x')).toBe('sv');
    expect(p.fallbackWrites).toBe(3);
  });

  it('also when merely asking for the storage throws, or there is none', () => {
    const asking = new Prefs(() => {
      throw new Error('SecurityError: access denied');
    });
    expect(asking.set('a', 1)).toBe(false);
    expect(asking.get('a', 0)).toBe(1);
    const none = new Prefs(() => null);
    expect(none.set('a', 2)).toBe(false);
    expect(none.get('a', 0)).toBe(2);
  });

  it('a storage that works for reads but throws on writes keeps the newest value in memory, ahead of the old stored one', () => {
    const storage = new MemoryStorage();
    storage.items.set(`${PREF_PREFIX}lang`, '"sv"');
    const p = new Prefs(() => ({ getItem: (k: string) => storage.getItem(k), setItem: THROWING.setItem }));
    expect(p.get('lang', 'x')).toBe('sv');
    expect(p.set('lang', 'en')).toBe(false);
    expect(p.get('lang', 'x')).toBe('en');
  });

  it('a storage that starts to work later takes over and drops the memory copy', () => {
    const storage = new MemoryStorage();
    let broken = true;
    const p = new Prefs(() => (broken ? THROWING : storage));
    p.set('k', 1);
    expect(p.get('k', 0)).toBe(1);
    broken = false;
    expect(p.set('k', 2)).toBe(true);
    expect(p.get('k', 0)).toBe(2);
    expect(storage.items.get(`${PREF_PREFIX}k`)).toBe('2');
  });
});

describe('the shared getPref / setPref of the page', () => {
  it('work without a localStorage (Node has none here) through the memory', () => {
    expect(getPref('m06.test', 'fb')).toBe('fb');
    setPref('m06.test', { a: 1 });
    expect(getPref('m06.test', null)).toEqual({ a: 1 });
  });
});

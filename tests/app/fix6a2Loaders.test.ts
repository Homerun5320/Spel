// Fix-6A2 [1.10]: the Bundle-diet language loaders (loadLanguage / switchLanguage / loadStartLanguage / toggleLanguage) and the Dev stand-in button with the import() path
// really running. Every test gets a FRESH copy of the i18n modules (vi.resetModules), so no table is registered yet, unlike tests/i18n.setup.ts. A failing load is a mocked
// table module whose factory throws. Mutants: the Fix-6A2 block of docs/DECISIONS.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type I18n = typeof import('../../src/ui/i18n');
type LangPref = typeof import('../../src/app/langPref');
type Prefs = typeof import('../../src/app/prefs');

const failing: { en: boolean; sv: boolean } = { en: false, sv: false };

async function fresh(): Promise<{ i18n: I18n; pref: LangPref; prefs: Prefs }> {
  vi.resetModules();
  vi.doMock('../../src/ui/i18n.en', () => {
    if (failing.en) throw new Error('en chunk lost');
    return { en: { 'x.key': 'English text' } };
  });
  vi.doMock('../../src/ui/i18n.sv', () => {
    if (failing.sv) throw new Error('sv chunk lost');
    return { sv: { 'x.key': 'Svensk text' } };
  });
  const i18n = await import('../../src/ui/i18n');
  const pref = await import('../../src/app/langPref');
  const prefs = await import('../../src/app/prefs');
  return { i18n, pref, prefs };
}

beforeEach(() => {
  failing.en = false;
  failing.sv = false;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.doUnmock('../../src/ui/i18n.en');
  vi.doUnmock('../../src/ui/i18n.sv');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('loadLanguage / switchLanguage', () => {
  it('loads a table with import() once, and a failed load can be retried (the pending promise is forgotten)', async () => {
    const { i18n } = await fresh();
    expect(i18n.isLanguageLoaded('en')).toBe(false);
    failing.en = true;
    await expect(i18n.loadLanguage('en')).rejects.toThrow();
    expect(i18n.isLanguageLoaded('en')).toBe(false);
    failing.en = false;
    await i18n.loadLanguage('en');
    expect(i18n.isLanguageLoaded('en')).toBe(true);
    expect(i18n.TABLES.en['x.key']).toBe('English text');
    expect(i18n.isLanguageLoaded('sv')).toBe(false); // the other table was never asked for
  });

  it('switchLanguage is synchronous when the table is there, and waits (language unchanged meanwhile) when it is not', async () => {
    const { i18n } = await fresh();
    i18n.registerTable('en', { 'x.key': 'E' });
    const p = i18n.switchLanguage('en');
    expect(i18n.getLanguage()).toBe('en'); // no await: it changed at once
    await p;
    i18n.registerTable('sv', { 'x.key': 'S' });
    await i18n.switchLanguage('sv');
    expect(i18n.getLanguage()).toBe('sv');

    const second = await fresh();
    const q = second.i18n.switchLanguage('en'); // not loaded
    expect(second.i18n.getLanguage()).toBe('sv');
    await q;
    expect(second.i18n.getLanguage()).toBe('en');
  });

  it('a failed switch rejects and leaves the language as it was', async () => {
    const { i18n } = await fresh();
    failing.en = true;
    await expect(i18n.switchLanguage('en')).rejects.toThrow();
    expect(i18n.getLanguage()).toBe('sv');
  });
});

describe('loadStartLanguage', () => {
  it('test mode loads BOTH tables and shows the one the address asks for', async () => {
    const { i18n, pref } = await fresh();
    const r = await pref.loadStartLanguage({ lang: 'en' }, true);
    expect(r).toEqual({ lang: 'en', failed: null });
    expect(i18n.isLanguageLoaded('sv')).toBe(true);
    expect(i18n.isLanguageLoaded('en')).toBe(true);
  });

  it('a normal start loads only the wanted table', async () => {
    const { i18n, pref } = await fresh();
    const r = await pref.loadStartLanguage({ lang: 'en' }, false);
    expect(r).toEqual({ lang: 'en', failed: null });
    expect(i18n.isLanguageLoaded('en')).toBe(true);
    expect(i18n.isLanguageLoaded('sv')).toBe(false);
  });

  it('when the wanted table is lost the OTHER language is shown and the wanted one is named as failed', async () => {
    const { i18n, pref } = await fresh();
    failing.en = true;
    const r = await pref.loadStartLanguage({ lang: 'en' }, false);
    expect(r).toEqual({ lang: 'sv', failed: 'en' });
    expect(i18n.isLanguageLoaded('sv')).toBe(true);
    const again = await fresh();
    failing.sv = true;
    failing.en = false;
    expect(await again.pref.loadStartLanguage({ lang: 'sv' }, false)).toEqual({ lang: 'en', failed: 'sv' });
  });

  it('when both are lost the error propagates (the boot error screen)', async () => {
    const { pref } = await fresh();
    failing.en = true;
    failing.sv = true;
    await expect(pref.loadStartLanguage({ lang: 'sv' }, false)).rejects.toThrow();
  });

  it('test mode never writes the preference, a normal start remembers a later change', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) });
    const a = await fresh();
    a.i18n.registerTable('sv', {});
    a.i18n.registerTable('en', {});
    const stopTest = a.pref.applyStartLanguage({}, true);
    a.i18n.setLanguage('en');
    stopTest();
    expect(a.prefs.getPref(a.pref.LANG_PREF_KEY, 'none')).toBe('none');

    const b = await fresh();
    b.i18n.registerTable('sv', {});
    b.i18n.registerTable('en', {});
    const stop = b.pref.applyStartLanguage({}, false);
    b.i18n.setLanguage('en');
    expect(b.prefs.getPref(b.pref.LANG_PREF_KEY, 'none')).toBe('en');
    stop();
    b.i18n.setLanguage('sv');
    expect(b.prefs.getPref(b.pref.LANG_PREF_KEY, 'none')).toBe('en'); // stopped: the later change is not remembered
  });
});

/** The smallest DOM the language button code touches. */
function stubDom(): { host: { children: Array<Record<string, unknown>> }; clickAnywhere: () => void } {
  // Round 25 integration: Fix-6B's notice placement asks the host for an old notice and for the start tagline; a bare stub answers "none" to both.
  const host = { children: [] as Array<Record<string, unknown>>, appendChild(c: Record<string, unknown>): void { this.children.push(c); }, querySelectorAll: (): unknown[] => [], querySelector: (): null => null };
  const handlers: Array<() => void> = [];
  vi.stubGlobal('document', {
    body: host,
    createElement: () => {
      const el: Record<string, unknown> = { dataset: {}, style: {}, attrs: {} as Record<string, string>, hidden: false, textContent: '' };
      el.setAttribute = (k: string, v: string): void => void ((el.attrs as Record<string, string>)[k] = v);
      el.removeAttribute = (k: string): void => void delete (el.attrs as Record<string, string>)[k];
      el.remove = (): void => void (host.children = host.children.filter((c) => c !== el));
      return el;
    },
  });
  vi.stubGlobal('window', { addEventListener: (_t: string, h: () => void) => void handlers.push(h) });
  return { host, clickAnywhere: () => handlers.forEach((h) => h()) };
}

function buttonStub(host: unknown): { disabled: boolean; style: { opacity: string }; attrs: Record<string, string>; setAttribute(k: string, v: string): void; removeAttribute(k: string): void; closest(): unknown } {
  const b = {
    disabled: false,
    style: { opacity: '' },
    attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string): void { this.attrs[k] = v; },
    removeAttribute(k: string): void { delete this.attrs[k]; },
    closest: () => host,
  };
  return b;
}

describe('toggleLanguage (the language button) with a minimal DOM', () => {
  it('switches at once when the table is loaded (no busy state)', async () => {
    const { i18n } = await fresh();
    i18n.registerTable('sv', {});
    i18n.registerTable('en', {});
    const sw = await import('../../src/ui/langSwitch');
    const { host } = stubDom();
    const b = buttonStub(host);
    sw.toggleLanguage(b as unknown as HTMLButtonElement);
    expect(i18n.getLanguage()).toBe('en');
    expect(b.disabled).toBe(false);
    expect(b.attrs['aria-busy']).toBeUndefined();
  });

  it('shows a busy state while the table loads, and clears it afterwards', async () => {
    const { i18n } = await fresh();
    i18n.registerTable('sv', {});
    const sw = await import('../../src/ui/langSwitch');
    const { host } = stubDom();
    const b = buttonStub(host);
    sw.toggleLanguage(b as unknown as HTMLButtonElement);
    expect(b.disabled).toBe(true);
    expect(b.attrs['aria-busy']).toBe('true');
    expect(b.style.opacity).not.toBe('');
    await vi.waitFor(() => expect(i18n.getLanguage()).toBe('en'));
    await vi.waitFor(() => expect(b.disabled).toBe(false));
    expect(b.attrs['aria-busy']).toBeUndefined();
    expect(b.style.opacity).toBe('');
  });

  it('a lost table keeps the language and shows an alert that names the language that failed to load, in the loaded language; the next click removes it', async () => {
    const { i18n } = await fresh();
    i18n.registerTable('sv', { 'app.langError': 'Visar {lang}.' });
    failing.en = true;
    const sw = await import('../../src/ui/langSwitch');
    const dom = stubDom();
    const b = buttonStub(dom.host);
    sw.toggleLanguage(b as unknown as HTMLButtonElement);
    await vi.waitFor(() => expect(dom.host.children.length).toBe(1));
    const box = dom.host.children[0] as { textContent: string; dataset: Record<string, string>; attrs: Record<string, string> };
    expect(i18n.getLanguage()).toBe('sv');
    expect(box.dataset.langError).toBe('en');
    expect(box.attrs.role).toBe('alert');
    expect(box.textContent).toBe('Visar Svenska.');
    await vi.waitFor(() => expect(b.disabled).toBe(false));
    dom.clickAnywhere();
    expect(dom.host.children.length).toBe(0);
  });
});

describe('the Dev stand-in button and the dev load error', () => {
  it('carries the attributes the panel adopts: a hidden "Dev" button with the data flag and the Swedish aria label', async () => {
    const dom = stubDom();
    void dom;
    const { createDevStandIn, devLoadError } = await import('../../src/app/debugLoad');
    const b = createDevStandIn() as unknown as { textContent: string; hidden: boolean; dataset: Record<string, string>; attrs: Record<string, string>; type: string };
    expect(b.textContent).toBe('Dev');
    expect(b.hidden).toBe(true);
    expect(b.dataset.devButton).toBe('1');
    expect(b.type).toBe('button');
    expect(b.attrs['aria-label']).toBe('Öppna Dev-panelen (F2)');
    expect(devLoadError('Dev-panelen', new Error('nope')).message).toBe('Dev-verktyget "Dev-panelen" kunde inte laddas (nope). Ladda om sidan.');
    expect(devLoadError('x', 'plain').message).toContain('(plain)');
  });
});

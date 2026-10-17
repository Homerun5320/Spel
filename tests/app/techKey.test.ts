// M18d-2: the research key. T is a listed match entry (so the `?` overlay shows it with a label in both languages), calls the page once per press, is not reserved and
// is dead behind a modal.
import { describe, expect, it } from 'vitest';
import { HotkeyRegistry, registerGameHotkeys, type HotkeyEvent } from '../../src/app/hotkeys';
import { InputStack, RESERVED_KEYS } from '../../src/app/input';
import { keysText } from '../../src/ui/helpOverlay';
import { TABLES } from '../../src/ui/i18n';

const ev = (key: string, extra: Partial<HotkeyEvent> = {}): HotkeyEvent => ({ key, ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false, ...extra });

describe('M18d-2: the research key', () => {
  it('T is listed in the help overlay, calls the page, does not repeat, is dead behind a modal, and is not one of the reserved keys', () => {
    const log: string[] = [];
    const reg = new HotkeyRegistry();
    const flags = { modal: false };
    reg.context = { matchOn: () => true, modalOpen: () => flags.modal };
    registerGameHotkeys(reg, { stack: new InputStack({ id: 'base' }), toggleOverlay: () => undefined, commit: () => undefined, togglePause: () => undefined, slower: () => undefined, faster: () => undefined, toggleHelp: () => undefined, toggleTech: () => log.push('tech') });
    const entry = reg.listed().find((d) => d.id === 'tech');
    expect(entry).toBeDefined();
    expect(entry?.keys).toEqual(['t']);
    expect(keysText(entry?.keys ?? [])).toBe('T');
    expect(RESERVED_KEYS.map((k) => k.toLowerCase())).not.toContain('t');
    expect(reg.handle(ev('t'))).toBe(true);
    expect(reg.handle(ev('T'))).toBe(true);
    expect(reg.handle(ev('t', { repeat: true }))).toBe(false);
    flags.modal = true;
    expect(reg.handle(ev('t'))).toBe(false);
    expect(log).toEqual(['tech', 'tech']);
    for (const lang of ['sv', 'en'] as const) expect((TABLES[lang] as Record<string, string>)[entry?.labelKey ?? '']?.length).toBeGreaterThan(5);
  });
});

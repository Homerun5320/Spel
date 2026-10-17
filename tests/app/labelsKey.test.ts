// Fix-5A3 (audit 4, finding 2.12): the nation-labels key N as a registry entry (like D and T) and the boundaries of compactTroops (999 / 1000, 9 999 / 10 000, 999 999 / 1 000 000,
// 9 999 999 / 10 000 000, negative and fractional input).
import { describe, expect, it } from 'vitest';
import { HotkeyRegistry, registerGameHotkeys, type HotkeyEvent } from '../../src/app/hotkeys';
import { InputStack, RESERVED_KEYS } from '../../src/app/input';
import { keysText } from '../../src/ui/helpOverlay';
import { TABLES } from '../../src/ui/i18n';
import { compactTroops } from '../../src/ui/nationLabels';

const ev = (key: string, extra: Partial<HotkeyEvent> = {}): HotkeyEvent => ({ key, ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false, ...extra });

function setup(withHandler = true) {
  const log: string[] = [];
  const reg = new HotkeyRegistry();
  const flags = { modal: false, match: true };
  reg.context = { matchOn: () => flags.match, modalOpen: () => flags.modal };
  registerGameHotkeys(reg, {
    stack: new InputStack({ id: 'base' }),
    toggleOverlay: () => undefined,
    commit: () => undefined,
    togglePause: () => undefined,
    slower: () => undefined,
    faster: () => undefined,
    toggleHelp: () => undefined,
    ...(withHandler ? { toggleLabels: () => log.push('labels') } : {}),
  });
  return { reg, log, flags };
}

describe('the nation-labels key N', () => {
  it('is a listed match entry with a label in both languages, calls the page once per press, and is not a reserved key', () => {
    const { reg, log } = setup();
    const entry = reg.listed().find((d) => d.id === 'labels');
    expect(entry).toBeDefined();
    expect(entry?.keys).toEqual(['n']);
    expect(entry?.labelKey).toBe('hotkey.labels');
    expect(entry?.scope).toBe('match');
    expect(entry?.noRepeat).toBe(true);
    expect(keysText(entry?.keys ?? [])).toBe('N');
    expect(RESERVED_KEYS.map((k) => k.toLowerCase())).not.toContain('n');
    for (const lang of ['sv', 'en'] as const) expect((TABLES[lang] as Record<string, string>)[entry?.labelKey ?? '']?.length).toBeGreaterThan(5);
    expect(reg.handle(ev('n'))).toBe(true);
    expect(reg.handle(ev('N'))).toBe(true);
    expect(reg.handle(ev('n', { repeat: true }))).toBe(false); // a held key toggles once
    expect(log).toEqual(['labels', 'labels']);
  });

  it('is dead behind a modal, outside a match and in a text field; other letters do not reach it; without a page handler it is taken and does nothing', () => {
    const { reg, log, flags } = setup();
    flags.modal = true;
    expect(reg.handle(ev('n'))).toBe(false);
    flags.modal = false;
    flags.match = false;
    expect(reg.handle(ev('n'))).toBe(false);
    flags.match = true;
    expect(reg.handle(ev('n', { typing: true }))).toBe(false);
    expect(reg.handle(ev('n', { ctrlKey: true }))).toBe(false);
    expect(reg.handle(ev('m'))).toBe(false);
    expect(log).toEqual([]);
    const bare = setup(false);
    expect(bare.reg.handle(ev('n'))).toBe(true);
    expect(bare.log).toEqual([]);
  });
});

describe('compactTroops boundaries', () => {
  it('switches at 1 000, 10 000, 1 000 000 and 10 000 000 exactly, always cutting', () => {
    expect(compactTroops(999)).toBe('999');
    expect(compactTroops(1000)).toMatch(/^1[.,]0k$/);
    expect(compactTroops(9999)).toMatch(/^9[.,]9k$/);
    expect(compactTroops(10000)).toBe('10k');
    expect(compactTroops(999999)).toBe('999k');
    expect(compactTroops(1000000)).toMatch(/^1[.,]0M$/);
    expect(compactTroops(9999999)).toMatch(/^9[.,]9M$/);
    expect(compactTroops(10000000)).toBe('10M');
    expect(compactTroops(123456789)).toBe('123M');
    expect(compactTroops(-5)).toBe('0');
    expect(compactTroops(0.9)).toBe('0');
  });
});

// The hotkey registry (M20a-lite): scopes, the reserved keys, the modal block of Fix-3B and the entries of the game.
import { describe, expect, it } from 'vitest';
import { HotkeyRegistry, registerGameHotkeys, type GameHotkeyActions, type HotkeyEvent } from '../../src/app/hotkeys';
import { InputStack, RESERVED_KEYS, type InputMode, type KeyInput } from '../../src/app/input';
import { keysText } from '../../src/ui/helpOverlay';
import { TABLES } from '../../src/ui/i18n';

const ev = (key: string, extra: Partial<HotkeyEvent> = {}): HotkeyEvent => ({ key, ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false, ...extra });

function setup(): { reg: HotkeyRegistry; log: string[]; keys: KeyInput[]; stack: InputStack; flags: { match: boolean; modal: boolean } } {
  const log: string[] = [];
  const keys: KeyInput[] = [];
  const base: InputMode = { id: 'base', key: (e) => (keys.push(e), e.key === 'f' || e.key === 'F') };
  const stack = new InputStack(base);
  const reg = new HotkeyRegistry();
  const flags = { match: true, modal: false };
  reg.context = { matchOn: () => flags.match, modalOpen: () => flags.modal };
  const actions: GameHotkeyActions = {
    stack,
    toggleOverlay: () => log.push('overlay'),
    commit: (d) => log.push(`commit${d}`),
    togglePause: () => log.push('pause'),
    slower: () => log.push('slower'),
    faster: () => log.push('faster'),
    toggleHelp: () => log.push('help'),
  };
  registerGameHotkeys(reg, actions);
  return { reg, log, keys, stack, flags };
}

describe('the registry refuses a binding that would break the reserved keys', () => {
  const def = { labelKey: 'hotkey.pause', run: () => true } as const;
  it('a match or global entry cannot take a reserved key, a stack entry can take nothing else', () => {
    const reg = new HotkeyRegistry();
    for (const k of RESERVED_KEYS) expect(() => reg.register({ ...def, id: `m-${k}`, keys: [k], scope: 'match' }), k).toThrow(/reserved/);
    expect(() => reg.register({ ...def, id: 'g', keys: ['E'], scope: 'global' })).toThrow(/reserved/);
    expect(() => reg.register({ ...def, id: 's', keys: ['x'], scope: 'stack' })).toThrow(/not a reserved key/);
  });
  it('a duplicate id or key throws, and removing an entry frees its keys', () => {
    const reg = new HotkeyRegistry();
    const off = reg.register({ ...def, id: 'a', keys: ['x'], scope: 'match' });
    expect(() => reg.register({ ...def, id: 'a', keys: ['y'], scope: 'match' })).toThrow(/twice/);
    expect(() => reg.register({ ...def, id: 'b', keys: ['X'], scope: 'match' })).toThrow(/already bound/);
    off();
    expect(() => reg.register({ ...def, id: 'b', keys: ['X'], scope: 'match' })).not.toThrow();
  });
  it('an AbortSignal removes the entries', () => {
    const reg = new HotkeyRegistry();
    const c = new AbortController();
    reg.register({ ...def, id: 'a', keys: ['x'], scope: 'match' }, c.signal);
    c.abort();
    expect(reg.entries()).toHaveLength(0);
  });
});

describe('the entries of the game', () => {
  it('every match key of the old handler still does the same', () => {
    const { reg, log } = setup();
    for (const k of ['[', '-', ']', '+', ' ', ',', '.', '?']) expect(reg.handle(ev(k)), k).toBe(true);
    expect(log).toEqual(['commit-1', 'commit-1', 'commit1', 'commit1', 'pause', 'slower', 'faster', 'help']);
  });
  it('the space bar does not repeat; ctrl and meta refuse, AltGr (ctrl + alt) passes; typing refuses', () => {
    const { reg, log } = setup();
    expect(reg.handle(ev(' ', { repeat: true }))).toBe(false);
    expect(reg.handle(ev('.', { ctrlKey: true }))).toBe(false);
    expect(reg.handle(ev('.', { metaKey: true }))).toBe(false);
    expect(reg.handle(ev('[', { ctrlKey: true, altKey: true }))).toBe(true);
    expect(reg.handle(ev(',', { typing: true }))).toBe(false);
    expect(log).toEqual(['commit-1']);
  });
  it('the reserved keys reach the stack, Escape with an empty stack is used quietly (the browser keeps its own use of it)', () => {
    const { reg, keys } = setup();
    expect(reg.handle(ev('f'))).toBe(true);
    expect(reg.handle(ev('F'))).toBe(true);
    expect(reg.handle(ev('3'))).toBe(false); // the base mode did not use it
    expect(reg.handle(ev('e'))).toBe(false);
    expect(keys.map((k) => k.key)).toEqual(['f', 'F', '3', 'e']);
    expect(reg.handle(ev('Escape'))).toBe('quiet'); // the pause handler is called, the key is not prevented
  });
  it('Escape closes a pushed mode and the key is prevented then', () => {
    const { reg, stack } = setup();
    let popped = 0;
    stack.push({ id: 'm', onPop: () => popped++ });
    expect(reg.handle(ev('Escape'))).toBe(true);
    expect(popped).toBe(1);
    expect(stack.depth).toBe(0);
  });
  it('Fix-3B: behind a modal only Escape passes; the global F-keys always work; no match = no game keys', () => {
    const { reg, log, keys, flags } = setup();
    flags.modal = true;
    for (const k of [' ', ',', '1', 'f', '?']) expect(reg.handle(ev(k)), k).toBe(false);
    expect(keys).toEqual([]);
    expect(reg.handle(ev('Escape'))).not.toBe(false);
    expect(reg.handle(ev('F3'))).toBe(true);
    flags.modal = false;
    flags.match = false;
    expect(reg.handle(ev(' '))).toBe(false);
    expect(reg.handle(ev('Escape'))).toBe(false);
    expect(reg.handle(ev('F3'))).toBe(true);
    expect(log).toEqual(['overlay', 'overlay']);
  });
  it("a stack key typed into a text field is the stack's to refuse", () => {
    const { reg, keys } = setup();
    expect(reg.handle(ev('f', { typing: true }))).toBe(false);
    expect(keys).toEqual([]); // the stack refused it before any mode saw it
  });
});

describe('M18c-2: the diplomacy key', () => {
  it('D is a listed match entry that calls the page, does not repeat, is dead behind a modal, and the help overlay lists it with its label in both languages', () => {
    const log: string[] = [];
    const reg = new HotkeyRegistry();
    const flags = { modal: false };
    reg.context = { matchOn: () => true, modalOpen: () => flags.modal };
    registerGameHotkeys(reg, { stack: new InputStack({ id: 'base' }), toggleOverlay: () => undefined, commit: () => undefined, togglePause: () => undefined, slower: () => undefined, faster: () => undefined, toggleHelp: () => undefined, toggleDiplomacy: () => log.push('diplomacy') });
    const entry = reg.listed().find((d) => d.id === 'diplomacy');
    expect(entry).toBeDefined();
    expect(entry?.keys).toEqual(['d']);
    expect(entry?.scope).toBe('match');
    expect(keysText(entry?.keys ?? [])).toBe('D');
    expect(reg.handle(ev('d'))).toBe(true);
    expect(reg.handle(ev('D'))).toBe(true);
    expect(reg.handle(ev('d', { repeat: true }))).toBe(false);
    expect(reg.handle(ev('d', { ctrlKey: true }))).toBe(false);
    flags.modal = true;
    expect(reg.handle(ev('d'))).toBe(false);
    expect(log).toEqual(['diplomacy', 'diplomacy']);
    for (const lang of ['sv', 'en'] as const) expect((TABLES[lang] as Record<string, string>)[entry?.labelKey ?? '']?.length).toBeGreaterThan(5);
  });
});

describe('the help text of the entries', () => {
  it('every listed entry has a label in both languages, and the hidden ones are exactly the reserved keys of later milestones', () => {
    const { reg } = setup();
    for (const d of reg.listed()) {
      expect(TABLES.sv[d.labelKey], d.id).toBeTruthy();
      expect(TABLES.en[d.labelKey], d.id).toBeTruthy();
    }
    expect(reg.entries().filter((d) => d.hidden === true).map((d) => d.id)).toEqual(['exposure']); // M13a-2: H (chase) is a listed key now
  });
  it('keysText prints ranges, capitals and alternatives', () => {
    expect(keysText(['1', '2', '3', '4', '5', '6'])).toBe('1-6');
    expect(keysText(['f'])).toBe('F');
    expect(keysText(['[', '-'])).toBe('[ / -');
    expect(keysText(['F3'])).toBe('F3');
  });
});

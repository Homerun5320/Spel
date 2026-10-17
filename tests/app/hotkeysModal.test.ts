// Fix-6B [3.3] / [2.6]: the keys 7, 8, 9, L and B obey the input stack like 1 to 6: a mode that swallows keys (the ? card, the T and D panels) keeps them
// from starting placement or a mode behind it, and the placement mode still ends on its own number.
import { describe, expect, it } from 'vitest';
import { HotkeyRegistry, registerGameHotkeys, type GameHotkeyActions, type HotkeyEvent } from '../../src/app/hotkeys';
import { InputStack, type InputMode } from '../../src/app/input';

const ev = (key: string): HotkeyEvent => ({ key, ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false });

function setup(): { reg: HotkeyRegistry; log: string[]; stack: InputStack } {
  const log: string[] = [];
  const stack = new InputStack({ id: 'base', key: () => false });
  const reg = new HotkeyRegistry();
  reg.context = { matchOn: () => true, modalOpen: () => false };
  const actions: GameHotkeyActions = {
    stack,
    toggleOverlay: () => {},
    commit: () => {},
    togglePause: () => {},
    slower: () => {},
    faster: () => {},
    toggleHelp: () => {},
    buildType: (n) => log.push(`build${n}`),
    deploy: () => log.push('deploy'),
    ship: () => log.push('ship'),
  };
  registerGameHotkeys(reg, actions);
  return { reg, log, stack };
}

describe('7, 8, 9, L and B behind a key-swallowing mode', () => {
  const keys = ['7', '8', '9', 'l', 'b'];
  it('act on the free map', () => {
    const { reg, log } = setup();
    for (const k of keys) expect(reg.handle(ev(k)), k).toBe(true);
    expect(log).toEqual(['build7', 'build8', 'build9', 'deploy', 'ship']);
  });
  it('do nothing while a mode that swallows keys (the ? card, the T or D panel) is on the stack, and act again when it is popped', () => {
    const { reg, log, stack } = setup();
    const swallow: InputMode = { id: 'panel', key: () => true };
    stack.push(swallow);
    for (const k of keys) reg.handle(ev(k));
    expect(log).toEqual([]);
    stack.pop();
    reg.handle(ev('9'));
    expect(log).toEqual(['build9']);
  });
  it('a placement mode keeps its own toggle: its number is the stack\'s, any other number still starts that placement', () => {
    const { reg, log, stack } = setup();
    let exited = 0;
    stack.push({ id: 'placement', key: (e) => (e.key === '7' ? (exited++, true) : false) });
    reg.handle(ev('7'));
    expect([exited, log]).toEqual([1, []]);
    reg.handle(ev('8'));
    expect(log).toEqual(['build8']);
  });
});

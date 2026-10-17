// Keyboard of the match: `[` and `]` change the commitment by one step, space pauses, `,` and `.` slow down / speed up.
// `-` and `+` are second names for `[` and `]` because on a Swedish keyboard the brackets need AltGr. A pure function from a
// key event to an action, so that it can be tested without a DOM.

export type MatchKeyAction = 'commit-down' | 'commit-up' | 'pause' | 'slower' | 'faster';

export interface KeyLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly repeat?: boolean;
  /** Tag name of the focused element, when a text field has the focus the game keys are not taken. */
  readonly targetTag?: string;
  readonly targetType?: string;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'number', 'password', 'email', 'url', 'tel']);

/** Is the key press going into a text field? */
export function typingInField(k: KeyLike): boolean {
  const tag = (k.targetTag ?? '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  return tag === 'input' && TEXT_INPUT_TYPES.has((k.targetType ?? 'text').toLowerCase());
}

/** The action of a key press, or null when it is not a game key. AltGr (reported as ctrl + alt) is allowed; a plain ctrl or meta shortcut is not. */
export function matchKeyAction(k: KeyLike): MatchKeyAction | null {
  if (k.metaKey || typingInField(k)) return null;
  if (k.ctrlKey && !k.altKey) return null;
  switch (k.key) {
    case '[':
    case '-':
      return 'commit-down';
    case ']':
    case '+':
      return 'commit-up';
    case ' ':
    case 'Spacebar':
      return k.repeat === true ? null : 'pause';
    case ',':
      return 'slower';
    case '.':
      return 'faster';
    default:
      return null;
  }
}

/** What Escape does (M18-2): close the innermost mode of the input stack, or (stack empty) open the pause menu. The stack calls this. */
export type EscapeAction = 'close-mode' | 'open-pause';
export function escapeAction(stackDepth: number): EscapeAction {
  return stackDepth > 0 ? 'close-mode' : 'open-pause';
}

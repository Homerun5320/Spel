// Which outbox events reach the page (Events-1), and what the viewer may know of them.
// Rule: everything except OUTBOX_PAINT (the diff's changed cells carry it) and OUTBOX_REJECT (the last-refusal fields carry it) is a side fact. Unknown kinds
// are forwarded as they are (kind, tick, a, b), so a new sim event flows without a change here. The one filter is the helicopter mask (M17-pre): an event
// about a helicopter (`a` = its id) of a seat that is at war with the viewer is sent only when that helicopter is visible to the viewer at the end of that
// step (src/sim/heliVisibility.ts). Own and non-hostile helicopters are always sent. A viewer-less host (tests, debug pages) sends everything.
import { atWar } from '../sim/diplomacy';
import { heliVisibilityOf } from '../sim/heliVisibility';
import {
  OUTBOX_HELI_DOWNED,
  OUTBOX_HELI_HOME,
  OUTBOX_HELI_LANDED,
  OUTBOX_HELI_LAUNCHED,
  OUTBOX_HELI_PRODUCED,
  OUTBOX_HELI_QUEUED,
  OUTBOX_HELI_RTB,
  OUTBOX_HELI_SCRAPPED,
  OUTBOX_PAINT,
  OUTBOX_REJECT,
} from '../sim/outbox';
import { HELI_CAPACITY } from '../sim/rules';
import { seatToOwner, type GameState } from '../sim/state';

/** Whether `a` of this kind is a helicopter id. */
export function isHeliEvent(kind: number): boolean {
  return (
    kind === OUTBOX_HELI_QUEUED ||
    kind === OUTBOX_HELI_PRODUCED ||
    kind === OUTBOX_HELI_SCRAPPED ||
    kind === OUTBOX_HELI_LAUNCHED ||
    kind === OUTBOX_HELI_LANDED ||
    kind === OUTBOX_HELI_DOWNED ||
    kind === OUTBOX_HELI_RTB ||
    kind === OUTBOX_HELI_HOME
  );
}

export class ViewEventFilter {
  /** The owner of every helicopter slot before the step (a slot freed in the step still tells who lost the helicopter). */
  private readonly before = new Uint16Array(HELI_CAPACITY);

  constructor(
    private readonly state: GameState,
    private readonly viewerSeat: number | null,
  ) {}

  /** Call before each step. */
  beforeStep(): void {
    if (this.viewerSeat === null) return;
    const t = this.state.helis;
    const n = Math.min(t.highWater, HELI_CAPACITY);
    for (let i = 0; i < n; i++) this.before[i] = t.owner[i] as number;
    this.before.fill(0, n);
  }

  /** Whether the event goes to the page. Call after the step that produced it. */
  accept(kind: number, a: number): boolean {
    if (kind === OUTBOX_PAINT || kind === OUTBOX_REJECT) return false;
    const seat = this.viewerSeat;
    if (seat === null || !isHeliEvent(kind) || a < 0 || a >= HELI_CAPACITY) return true;
    const now = this.state.helis.owner[a] as number;
    const was = this.before[a] as number;
    // A new helicopter is read from the table as it is now, an old one from before the step (the slot may be free or reused by now).
    const owner = kind === OUTBOX_HELI_QUEUED || kind === OUTBOX_HELI_PRODUCED ? (now !== 0 ? now : was) : was !== 0 ? was : now;
    if (owner === 0) return false;
    const me = seatToOwner(seat);
    if (owner === me || !atWar(this.state, me, owner)) return true;
    return heliVisibilityOf(this.state).sight(seat).has(a);
  }
}

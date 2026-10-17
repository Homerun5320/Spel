// A scripted "sane human" for the pace report: it plays through a SimView only, like the AI and the UI, and files its intents
// through the host like any seat. Once per second (on its own phase) it (1) expands into free land it touches with at least
// AI_MIN_CONTACT_LENGTH of contact, at most once every EXPAND_COOLDOWN_TICKS, and (2) attacks the WEAKEST neighbour it has at least
// as many troops as, at most once every WAR_COOLDOWN_TICKS, with WAR_PCT of its troops; it acts only while it holds at least
// minTroopsPct of its troop cap (a reserve for defence). Nothing is random.
// It lives in tools/: the game itself has only the real human.
import type { TickDriver } from '../../src/host/mainThreadHost';
import { AI_MIN_CONTACT_LENGTH, attackBody, PHASE_PLAY, seatToOwner, type IntentBody, type SimView } from '../../src/sim/public';

export interface HumanBotOptions {
  readonly seat: number;
  /** Percent of the troops committed to an expansion into free land. */
  readonly expandPct: number;
  /** Percent of the troops committed to an attack on a neighbour. */
  readonly warPct: number;
  /** A neighbour is attacked only when the bot has at least this many percent of ITS troops. */
  readonly warMinRatioPct: number;
  /** The bot keeps a reserve: it acts only with at least this share of its troop cap (percent), like the AI (AI_EXPAND_TROOP_PCT). */
  readonly minTroopsPct: number;
}

export const DEFAULT_HUMAN_BOT: Omit<HumanBotOptions, 'seat'> = { expandPct: 60, warPct: 60, warMinRatioPct: 150, minTroopsPct: 40 };

const PERIOD_TICKS = 10;
const PHASE_TICKS = 7;
const EXPAND_COOLDOWN_TICKS = 40;
const WAR_COOLDOWN_TICKS = 80;

export class HumanBot implements TickDriver {
  private lastExpand = -1000000;
  private readonly lastWar = new Map<number, number>();

  constructor(private readonly options: HumanBotOptions) {}

  onTick(view: SimView, submit: (body: IntentBody) => void): void {
    const o = this.options;
    if (view.phase !== PHASE_PLAY || (view.tick + PHASE_TICKS) % PERIOD_TICKS !== 0) return;
    const stats = view.stats;
    if ((stats.alive[o.seat] as number) === 0) return;
    if ((stats.troopsQt[o.seat] as number) * 100 < (stats.capQt[o.seat] as number) * o.minTroopsPct) return;
    const me = seatToOwner(o.seat);
    if (view.contactLength(me, 0) >= AI_MIN_CONTACT_LENGTH && view.tick - this.lastExpand >= EXPAND_COOLDOWN_TICKS) {
      this.lastExpand = view.tick;
      submit(attackBody(o.seat, 0, o.expandPct));
    }
    let best = -1;
    let bestTroops = 0;
    const mine = stats.troopsQt[o.seat] as number;
    for (let other = 1; other <= view.seats; other++) {
      if (other === me || (stats.alive[other - 1] as number) === 0 || view.contactLength(me, other) === 0) continue;
      const last = this.lastWar.get(other);
      if (last !== undefined && view.tick - last < WAR_COOLDOWN_TICKS) continue;
      const theirs = stats.troopsQt[other - 1] as number;
      if (best === -1 || theirs < bestTroops) {
        best = other;
        bestTroops = theirs;
      }
    }
    if (best !== -1 && mine * 100 >= bestTroops * o.warMinRatioPct) {
      this.lastWar.set(best, view.tick);
      submit(attackBody(o.seat, best, o.warPct));
    }
  }
}

/** Runs several drivers one after the other at every tick boundary. */
export class CompositeDriver implements TickDriver {
  constructor(private readonly drivers: readonly TickDriver[]) {}
  onTick(view: SimView, submit: (body: IntentBody) => void): void {
    for (const d of this.drivers) d.onTick(view, submit);
  }
}

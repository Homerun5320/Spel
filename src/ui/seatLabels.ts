// Who is who in the leaderboard and the HUD (M06): the label provider that replaces the closed keys of `seatName` (hud.you, hud.nation n,
// hud.tribe n) when a match knows its nations. A seat can be a real country (its name follows the UI language), a custom nation or an
// invented neutral one (a free name that is not translated), or have no identity (then the old numbered keys apply). A nation may
// carry a flag. Pure data in, strings out; the text of a number-only seat still goes through `t()`.
import type { FlagSpec } from './flag';
import { seatName } from './hudLogic';
import { getLanguage, t, type Lang } from './i18n';

export type SeatIdentity =
  /** A real country: the names are the ones of the setup (the overrides' neutral names applied), shown in the UI language. */
  | { readonly kind: 'country'; readonly nameEn: string; readonly nameSv: string }
  /** A name the player typed or the neutral mode invented: shown as it is in every language. */
  | { readonly kind: 'custom'; readonly name: string }
  | { readonly kind: 'invented'; readonly name: string }
  /** No identity: the numbered keys of the HUD (you, Nation n, Tribe n). */
  | { readonly kind: 'generic' };

export interface SeatLabelEntry {
  readonly identity: SeatIdentity;
  readonly flag: FlagSpec | null;
}

/** M18b-3: one federation (a split country): its seats in seat order, the country's name in both languages and ONE flag for the whole federation. */
export interface FederationLabel {
  readonly seats: readonly number[];
  readonly nameEn: string;
  readonly nameSv: string;
  readonly flag: FlagSpec;
}

export interface SeatLabels {
  /** The name of a seat in a language (default: the UI language). */
  name(seat: number, lang?: Lang): string;
  /** The flag of a seat, or null (tribes, seats without a flag). */
  flag(seat: number): FlagSpec | null;
  /** Is this the local player's seat? */
  isYou(seat: number): boolean;
  /** M18b-3: the federations of the match (empty without "Dela upp stormakter"). */
  readonly federations: readonly FederationLabel[];
  /** The index in `federations` of the federation a seat belongs to, -1 for a seat without one. */
  federationOf(seat: number): number;
  /** The name of a federation (the country's name in the UI language). */
  federationName(index: number, lang?: Lang): string;
}

/** The labels of a match: one entry per seat (a seat past the end of the list is generic). */
export function createSeatLabels(entries: readonly SeatLabelEntry[], players: number, localSeat: number, federations: readonly FederationLabel[] = []): SeatLabels {
  const fedOfSeat = new Map<number, number>();
  federations.forEach((f, i) => f.seats.forEach((s) => fedOfSeat.set(s, i)));
  return {
    federations,
    federationOf(seat: number): number {
      return fedOfSeat.get(seat) ?? -1;
    },
    federationName(index: number, lang: Lang = getLanguage()): string {
      const f = federations[index];
      return f === undefined ? '' : lang === 'sv' ? f.nameSv : f.nameEn;
    },
    name(seat: number, lang: Lang = getLanguage()): string {
      const id = entries[seat]?.identity;
      if (id !== undefined && id.kind === 'country') return lang === 'sv' ? id.nameSv : id.nameEn;
      if (id !== undefined && (id.kind === 'custom' || id.kind === 'invented')) return id.name;
      const generic = seatName(seat, players, localSeat);
      return generic.n === 0 ? t(generic.key) : t(generic.key, { n: generic.n });
    },
    flag(seat: number): FlagSpec | null {
      return entries[seat]?.flag ?? null;
    },
    isYou(seat: number): boolean {
      return seat === localSeat;
    },
  };
}

/** The name a leaderboard, win meter or result line uses for a seat's side: the federation's name for a member, else the seat's own name. */
export function sideName(labels: SeatLabels, seat: number): string {
  const f = labels.federationOf(seat);
  return f >= 0 ? labels.federationName(f) : labels.name(seat);
}

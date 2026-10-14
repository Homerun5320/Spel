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

export interface SeatLabels {
  /** The name of a seat in a language (default: the UI language). */
  name(seat: number, lang?: Lang): string;
  /** The flag of a seat, or null (tribes, seats without a flag). */
  flag(seat: number): FlagSpec | null;
  /** Is this the local player's seat? */
  isYou(seat: number): boolean;
}

/** The labels of a match: one entry per seat (a seat past the end of the list is generic). */
export function createSeatLabels(entries: readonly SeatLabelEntry[], players: number, localSeat: number): SeatLabels {
  return {
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

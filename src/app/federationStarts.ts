// How many sub-nations of a country can really start (setup text of "Dela upp stormakter", Fix-5C). A sub-nation needs a fair start (D112)
// wholly inside its own land, and only some do (India: none). Instead of a second copy of that rule this asks `createMatch` itself, the one
// function that decides, so the text cannot drift from the match. Only the least number of AI nations that a split country needs (Fix-5A2:
// `FEDERATION_MIN_AI_NATIONS`; the count does not depend on them) and no tribes are asked for; the result is pure in (world, country, seed),
// so a caller may cache it.
import { createMatch, FEDERATION_MIN_AI_NATIONS, type MatchSetupConfig } from './matchSetup';
import type { PreparedWorld } from './matchWorld';

/** The number of sub-nation seats `createMatch` gives the (real-country) config with `federations: true` (0 when it cannot be split into at least two). */
export function startableSubNations(world: PreparedWorld, config: MatchSetupConfig): number {
  if (config.player.kind !== 'real') return 0;
  const r = createMatch(world, { ...config, aiNations: FEDERATION_MIN_AI_NATIONS, humanSeat: 0, tribes: false, win: null, federations: true });
  if (!r.ok) return 0;
  let n = 0;
  for (const s of r.match.seats) if (s.subNation !== undefined) n++;
  return n;
}

/** The text of the line under the option: `none` when fewer than two sub-nations can start, else the numbers for `setup.federation.sub` (the count is `startable`). */
export function federationLineModel(startable: number, aiNations: number, aiMax: number): { readonly key: 'setup.federation.none' | 'setup.federation.sub'; readonly members: number; readonly ai: number } {
  if (startable < 2) return { key: 'setup.federation.none', members: 0, ai: 0 };
  const partners = startable - 1;
  return { key: 'setup.federation.sub', members: startable, ai: partners + Math.min(aiNations, aiMax - partners) };
}

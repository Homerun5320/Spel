# Backlog

Ideas that are NOT built in the current milestone. Add one line each.

- Darker ambient term and a visible terminator in the spike shader (cosmetic; real atmosphere comes with the stylised Earth).
- Run e2e against a production `vite build` as well as the dev server (checks the shipped bundle).
- `src/app/dataPack.ts` (M00b probe loader) duplicates `fnv1a32`, `decodeBase64` and `gunzip` from `src/data/bytes.ts`; re-export them from `src/data` once the probe page is next touched.
- Forest/Plains rule is by latitude only (Sahara shows forest patches at 12 %, Amazon is cut by the latitude bands); a rainfall-like noise layer or a coarse climate table would look better. Cosmetic.
- Polar caps beyond 85.05 degrees are synthetic (smoothed copy of the last real row); a proper polar fill or a polar stereographic tile set would remove the visible streaks in the height map.
- Joerd/Mapzen attribution page could not be reached; replace the general credit line in `CREDITS.md` with the exact source list when it is reachable.
- Debug data page: `?map=` is read once; a Dev-panel mode (M02) should register `height`/`class`/`country` and the hash grammar.

# Backlog

Ideas that are NOT built in the current milestone. Add one line each.

- Darker ambient term and a visible terminator in the spike shader (cosmetic; real atmosphere comes with the stylised Earth).
- Run e2e against a production `vite build` as well as the dev server (checks the shipped bundle).
- `src/app/dataPack.ts` (M00b probe loader) duplicates `fnv1a32`, `decodeBase64` and `gunzip` from `src/data/bytes.ts`; re-export them from `src/data` once the probe page is next touched.
- Forest/Plains rule is by latitude only (Sahara shows forest patches at 12 %, Amazon is cut by the latitude bands); a rainfall-like noise layer or a coarse climate table would look better. Cosmetic.
- Polar caps beyond 85.05 degrees are synthetic (smoothed copy of the last real row); a proper polar fill or a polar stereographic tile set would remove the visible streaks in the height map.
- Joerd/Mapzen attribution page could not be reached; replace the general credit line in `CREDITS.md` with the exact source list when it is reachable.
- Debug data page: `?map=` is read once; a Dev-panel mode (M02) should register `height`/`class`/`country` and the hash grammar.
- DECISION FOR THE USER (M04/M06): the Ice rule also turns high, cold land into unplayable Ice (latitude >= 62 and mean >= 1400 m): about 62 % of Greenland's land cells (3398 of 5460) plus a few Canada, Russia, USA and Iceland cells. The prompt only named Antarctica and latitude > 84N. Revisit if Greenland should be playable (one-line switch in `tools/bake/classify.ts`: `ICE_CAP_MIN_LAT`, `ICE_CAP_MIN_MEAN_M`).
- 25 microstate capitals (for example Singapore, Valletta, Manama) are dropped from `public/data/cities.json` because no land cell of the same country lies within 3 cells. Snap them without the same-country requirement, or keep them in an `unsnapped` list, when cities are rendered (M10).
- `public/data/meta.json` `countries[].weightedAreaKm2` (land cells, majority vote) is NOT monotone in country id: ids follow polygon area at render resolution (water inside the polygon counts). Do not assume id order equals land-area order; add a `polygonAreaKm2` field if a consumer needs the id order.
- `bake:check` is an offline check that could be added as a CI step (the workflow file was not touched in M01).

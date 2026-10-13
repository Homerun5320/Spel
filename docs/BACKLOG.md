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
- Globe look: the Sahara, Arabia and the Gobi show dark green Forest patches (the baked Forest/Plains rule is by latitude and a block hash). A coarse climate table (desert boxes) in the bake, or a shader aridity tint from a small baked climate layer, would fix the biggest eyesore of the whole-Earth view (needs a re-bake: new pack layer).
- Globe look: tune on a real GPU: `FACET_WEIGHT`, the snow line, `AMBIENT_DAY`, `HEIGHT_EXAGGERATION` (all in `src/render/config.ts` and the snow line in `src/render/shaders/terrain.ts`).
- Camera: focus on the displaced height (mountain-centred orbit and zoom) instead of the sea-level point; keep north up when the anchored zoom rotates the heading (small drift now).
- Fjords at high latitude show as thin one-pixel sea strips because the mask is 4096x2048 (about 4.6 km wide at 62 N, 9.8 km tall); the M07 detail pass or a signed-distance mask would round them.
- Limb aliasing at the test tier (MSAA off by rule); the atmosphere shell (checkpoint B) softens it.

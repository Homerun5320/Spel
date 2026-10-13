# Decisions

Newest at the bottom. Each entry: what, why.

## M00

### D1 Dependency pins
All pins from the M00 prompt were verified with `npm view <pkg>@<version> version` before installing and none changed: three 0.186.1, @types/three 0.186.0, vite 8.3.4, vitest 5.0.4, typescript 6.0.2, @types/node 22.20.5, @types/pngjs 6.0.5, playwright-core 1.56.1, pixelmatch 8.0.0, fast-check 4.10.2, eslint 10.12.0.
Versions the prompt left open (latest at the time, exact, peer ranges checked): pngjs 7.0.0, yaml 2.9.1, tsx 4.23.15, typescript-eslint 8.71.2 (peer: eslint ^10, typescript <6.1.0), @eslint/js 10.0.1 (peer eslint ^10).
Added beyond the prompt's list: `globals` 17.13.0, because the ESLint config needs node + browser globals for `scripts/**/*.mjs`.
`playwright-core` 1.56.1 matches the installed chromium-1194 (1.56.0 would too). Never upgrade it.

### D2 Spike test view
Camera on the +z axis looking at the origin, distance 4, vertical fov = 2*asin(1/4) = 28.955 degrees, so the globe (radius 1) spans exactly the image height (diameter = 540 px; measured silhouette coverage 44.1 %). +x is to the right. Sun fixed at lon -40, lat 20: direction = (cos20*sin(-40), sin20, cos20*cos(-40)) = (-0.604, 0.342, 0.720), unit length. The lit half is the LEFT image half. (The prompt printed x as -0.49; that is inconsistent with its own formula and with unit length, the formula value is used.) Background is pure black.

### D3 Smoke thresholds
distinct colours >= 50; luma std (Rec. 709 luma, all pixels, 0..255) >= 20 (measured 57.6; flat canvas 0); |luma(centre) - luma(top-left corner)| >= 40 (measured 94); mean luma left half >= 1.15 x right half over pixels with luma > 2 (measured 1.52); silhouette (pixels differing > 4 in any channel from the corner pixel) covers 20-60 % (measured 44.1 %). Synthetic empty, noise and checkerboard images are rejected by unit tests.

### D4 Console allow-list
`ALLOWED_CONSOLE_WARNINGS` in `scripts/shot.mjs` is empty: no console warning or error appeared with Chromium 141 + SwiftShader. Any future entry needs an exact-text match and a justification here. Uncaught page errors count as console errors.

### D5 Chromium launch
Switches are the explicit array from the prompt. `--no-sandbox` is not passed by us: Playwright adds it itself when `chromiumSandbox` is false (the default), and Chromium starts fine as root in the container.

### D6 Goldens
`e2e/goldens/spike-test-view.png` was produced in the cloud session. `GOLDEN_MAX_DIFF` is a FRACTION (0.002 = 0.2 %). Mismatches write `test-results/golden/<name>.actual.png` and `.diff.png`. `GOLDEN_COMPARE=warn` logs instead of failing (also for a missing golden).

### D7 CI
Goldens are authoritative in the cloud session; CI sets `GOLDEN_COMPARE=warn` because a different SwiftShader build on GitHub runners may differ slightly. Everything else fails CI. CI uses the full chromium installed by `npx playwright-core install --with-deps chromium` via `CHROMIUM_PATH`.

### D8 E2E server
e2e starts a Vite DEV server programmatically (free port, HMR off) in `e2e/globalSetup.ts` and provides its URL as `inject('baseUrl')`. The e2e project is also serial (fileParallelism false, maxWorkers 1) so only one Chromium runs at a time.

### D9 verify
`verify` = typecheck + lint + `vitest run --project unit` + `vitest run --project perf --passWithNoTests` + `vitest run --project e2e`. Measured about 15 s in the cloud; no sharding needed. `verify:fast` = typecheck + lint + unit (about 6 s).

### D10 Lint details
The Math allow-list selector bans every other `Math.*` member including constants such as `Math.PI` (use a literal). `globalThis` is banned in src/sim and src/ai (it would bypass the global bans). `crypto` / `node:crypto` imports are banned in the pure folders. Boundary rules (imports, DOM globals) apply to src/sim, src/ai and src/data; determinism rules to src/sim and src/ai only; `**/*.test.ts` is exempt from both.

### D11 Spike behaviour
In normal mode the F3 overlay is shown by default and the sun drifts 12 degrees of longitude per second; in `?test=1` the overlay is hidden and nothing moves. Extra debug/test params: `blank=1` (empty canvas for the negative test), `seed=N`, `w=`/`h=` (canvas size in test mode, used by leak tests at 320x180). Styles and the `lang` attribute are set from JS on a wrapper div, not on `<html>` / `<body>`.

### D12 Perf project
`retry: 1` is set for the perf project; `tests/perf.setup.ts` logs it and warns about every retried test. `silent: false` at the root so perfguard factors, retries and shot metrics are visible for passing tests. perfguard reference: 5 M `Math.imul`/array-write iterations, REFERENCE_MS = 5.5 (median on the authoring sandbox); the per-process calibration is a warm-up plus the median of 3 timings.

### D13 CI file location
See `docs/PROGRESS.md` ("CI workflow") for which case occurred.

### D14 Lint bypass hardening and hook install detection
Determinism lint (`eslint.config.js`, src/sim and src/ai): `Math`, `Object` and `Reflect` may only appear as the object of a member expression. Destructuring, aliasing, assigning, passing, returning or wrapping them (`const { asin } = Math`, `const M = Math`, `(0, Math).sin`, `(Math as T).sin`) fails; a plain property read such as `x.Math` is fine. Allowed Math members must be non-computed (`Math[abs]` fails even if a variable is named abs). `Object.getOwnPropertyNames`, `Object.getOwnPropertySymbols`, `Reflect.ownKeys` and any computed member access on Object / Reflect are banned next to keys / values / entries. Every bypass has a case in `tests/lint.test.ts`. The rules guard against accidents, not against deliberate evasion such as `eval` or the `Function` constructor.
SessionStart hook: a missing hidden lockfile in node_modules (npm writes it last) counts as an incomplete install and triggers `npm ci` (90 s timeout). The report field is "npm ci körd denna session" (ja / nej). After a failed or timed-out `npm ci` the hook removes node_modules so that a half-written tree never looks complete and the next session retries. `tests/hook.test.ts` runs the real script against a stub npm.

## M00b

### D15 Portable build
Vite `base: './'` and `build.assetsDir: 'assets'`, so the same files run from any folder (Artifact version folder, a static server under /x/y/, the site root). Two page entries via `build.rolldownOptions.input`: `index.html` and `probe.html`. `worker.format: 'es'` so module workers stay ES modules and import shared chunks from assets. Every chunk therefore lives in assets, which `ROOT_URL` relies on. Tests that build use `tests/helpers/buildDist.ts`, which forces `NODE_ENV=production` (vitest sets `test`, which would bake `import.meta.env.DEV = true` into the bundle; the first artifact e2e run caught exactly that).

### D16 Addresses
`src/app/paths.ts` exports `ROOT_URL` (dev: `new URL('/', self.location.href)`; build: `new URL('../', import.meta.url)`, held in a variable so Vite does not treat it as an asset reference) and `siteUrl(path)`. All runtime data fetches and all page links go through it, also inside the worker. `tests/portable.test.ts` builds the site and fails on `src="/`, `href="/`, url(/ and the string literals "/data/ and "./data/ in dist html, css and assets js; it also scans `src/` for `BASE_URL` and hand-written data paths. `src/env.d.ts` types only `import.meta.env.DEV` (tsconfig `types` stays `["node"]`). The probe link in index.html is hidden in test mode so the golden is unchanged; outside test mode its href is set with `siteUrl`.

### D17 Artifact pack (scripts/artifact-pack.mjs)
Whitelist of served extensions; a dist file with another or no extension fails the run with the list of paths (nothing is skipped silently). Dot-named files (data/.gitkeep) are not published but are reported. The only exception is a data pack named in the data manifest. ASSUMPTION for M01: the source manifest in dist is an object `{name: {file}}` (or `{name: "file"}`) with `file` relative to the data folder; `enc` defaults to raw. The rewritten manifest is `{name: {file, enc}}`, output names are `<file without .gz><container ext>` (`.png`, `.wasm` or `.b64.txt`); the original `.bin.gz` is not published. No manifest (before M01) is fine. Limits checked: 16 MB per text file, 15 MB per binary file, 511 files and 256 MB per artifact; batches have at most 250 files and 60 000 000 bytes. `--prev` ignores index.html and writes `null` only for paths missing from the new build. The files list (files.json) and checksums.txt are written beside the output but are never published. The probe folder is regenerated with `--probe` and otherwise kept, so a normal update does not delete the probe packs (and the probe page keeps working). The link check runs at the end of every pack and fails the run.

### D18 Fragment
`toFragment` masks script and style blocks and comments with private-use placeholders, removes the doctype and the html, head and body tags with `/<\/?(html|head|body)(\s[^>]*)?>/gi`, then restores the blocks. `<header>` and `</html>` inside an inline script are unit-tested. No HTML parser. `<meta>`, `<title>` and `<link>` stay in the fragment (only the wrapper tags go; the skeleton the Artifact adds supplies its own).

### D19 Artifact e2e (e2e/artifact.test.ts)
It builds into a temporary folder and packs with `--probe` there (not into the user's artifact folder, so a stale or hand-made pack can never decide the result). The server mirrors the Artifact: served from /x/y/, 404 for every extension outside the list (also planted .bin/.gz/.zip), index.html inside a minimal skeleton whose head has `<link rel="icon" href="data:,">` (the real skeleton carries the tab icon; without it Chromium requests /favicon.ico). The globe test uses `?test=1` because the server is ours; in a real Artifact the query never reaches the page and a hash grammar arrives in M02. Checks: smoke pixel rules, zero console errors, no 404; a second test loads the animated page, follows the probe link; a third checks the probe table (png, wasm, b64, worker, WebGL2, hash, search all ok).

### D20 Preview routes and results (details for the user in docs/PREVIEW.md)
| route | result | note |
|-------|--------|------|
| Artifact, user's own test page in the real view (iPhone, Claude app) | fungerade | from the user: WebGL2 on Apple GPU, 59 FPS, 262 000 triangles |
| Artifact build served like an Artifact (sub-folder, 404 for unlisted extensions) in headless Chromium | fungerade | e2e/artifact.test.ts |
| Containers png, wasm, b64 + module worker + hash/search in headless Chromium | fungerade | all three give the expected length and FNV-1a |
| Spike published as Artifact | publicerad av orchestratorn, ej bekräftad av användaren | the user answers "klotet syns" |
| Probe table in the real view | ej testat | user pastes the table; if png fails, switch to `--container=b64`, republish and record it here |
| Netlify | EJ MÖJLIG | `netlify-deploy-services-updater` (deploy-site) only accepts a siteId and has no way to send dist; `curl -sI https://api.netlify.com` answered 403 through the cloud proxy. No site was created. |
| Local `npm ci && npm run dev` | fungerade | dev server is what the e2e project uses; probe page loads in dev (worker ok, packs shown as not tested because no probe packs exist there) |
| Local guide on Windows and Mac | ej testat | written from the standard flow, not run on the user's machines |
Default container: png (proven fastest in the real view by the user's earlier test). Not chosen automatically: wasm (the server also gzips it) and b64 (about twice as slow).

## M01

### D21 Bake pipeline and sources
`npm run bake` (`tools/bake/index.ts`): fetch (cached in the gitignored `.cache/bake`), build (`tools/bake/build.ts`, pure), write `public/data/` last through temp files and renames, so a blocked host or a crash never leaves half output. Only `elevation-tiles-prod.s3.amazonaws.com` and `raw.githubusercontent.com` may be contacted (`tools/bake/fetch.ts` refuses any other host); 403/407 or four failed attempts end in a `BlockedError` that names the URL and says what is blocked. The Natural Earth commit is looked up once with `git ls-remote https://github.com/nvkelso/natural-earth-vector.git HEAD` (result `ca96624a56bd078437bca8184e78163e5039ad19`, the same as the prompt's fallback); later bakes read the SHA from the committed `public/data/meta.json` so a rebake stays reproducible even if upstream HEAD moves (`--ne-sha=` overrides). Natural Earth files: `ne_50m_admin_0_countries`, `ne_10m_populated_places_simple`, `ne_10m_ports` (geojson). Terrarium z4: 256 tiles, 18 345 644 bytes. `--synthetic` swaps in seeded noise and boxes, writes only to `.cache/bake-synthetic`, and `bake:check` rejects a `public/data/meta.json` without a real commit SHA. Node's built-in fetch worked in the sandbox without `NODE_USE_ENV_PROXY`.

### D22 Determinism and checksums
No timestamps anywhere; JSON keys sorted; countries ordered by descending area; cities by population; ports by cell. gzip level 9 (memLevel 9) with the header normalised (mtime 0, XFL 2, OS 255). `public/data/checksums.json` = `{version, packs: {name: {file, bytes, sha256, fnv1a, gzBytes, gzSha256, layers: {name: {offset, bytes, sha256, fnv1a}}}}, files: {json name: {bytes, sha256, fnv1a}}}`. `sha256` and `fnv1a` (8 hex digits) are over the UNCOMPRESSED payload and authoritative (`bake:check`, Node tests, and the browser loader checks `fnv1a`, which is pure TS and needs no secure context); `gzSha256` is informational because the deflate stream can differ between Node/zlib versions (`bake:check` prints a note, never fails on it). `public/data/manifest.json` and `public/data/checksums.json` themselves are not checksummed. Two bakes in a row gave byte-identical files (see `docs/PROGRESS.md`).

### D23 Pack layout (`src/data/format.ts`, shared by the baker and the loader)
Two packs. `render` (18 874 368 bytes raw): `height` u8 4096x2048, `bathy` u8 2048x1024, `country` u8 4096x2048. `sim` (4 816 896 bytes raw): Int16 layers first (2-byte aligned, little endian): `meanElev`, `maxElev` (1024x512), `navMaxElev` (256x128); then u8 `land`, `class`, `country`, `coast`, `ruggedness` (1024x512) and `navFlags` (256x128). Offsets are in `public/data/meta.json` (`render.layers`, `sim.layers`) and `public/data/checksums.json`. One render pack (as the prompt says) instead of one file per raster.
Sqrt coding: `metres = max * (code / 255)^2`, land max 9000 m, depth max 11000 m. Code 0 = no land / no water. The smallest code that decodes to at least 1 m is 3 ((3/255)^2 * 9000 = 1.25 m; code 2 gives 0.55 m), so `MIN_LAND_CODE = 3` for heights and depths (the prompt said "code 1"; that would decode to 0.14 m).
Terrain class numbers: DeepSea 0, Shallows 1, Plains 2, Forest 3, Hills 4, Mountain 5, Peak 6, Ice 7. `coast` bits: 1 = land cell next to water, 2 = water cell next to land (8-neighbourhood, longitude wraps). Nav grid (4 x 4 sim cells per nav cell): `navFlags` bits AnyLand 1, AllLand 2, AnyRough (Mountain or Peak) 4, AnyIce 8, AnyCoast 16, plus `navMaxElev`; the prompt did not define the nav contents, this is the minimal useful set. `meta.sim.cosQ15[row]` = round(cos(lat of the row centre) * 32768) for the 512 sim rows (value 32768 near the equator does not fit an Int16, store it as Uint16 or clamp).

### D24 Heights
Terrarium decode `R*256 + G + B/256 - 32768`. Clean on the 4096x4096 Mercator grid BEFORE any mean or max: clamp to [-11000, 9000] (2 pixels were above 9000: the 11 500 m error pixels near 72.4 N 78.8 W), then a 3x3 median (longitude wraps) replaces a pixel only when it deviates more than `SPIKE_MEDIAN_DEVIATION_M = 2000` m from the median: 65 pixels (the Baffin Island error cluster, a few Greenland and Baffin coast pixels, Pacific atoll pixels sitting in deep ocean, a few seamount tops); real peaks survive (Himalaya box max 6727 m before and after). Resampling to the 4096x2048 equirectangular grid: columns line up 1:1, rows are weighted by latitude overlap (area correct), per pixel mean and max. The 56 rows at each pole beyond the Mercator limit (85.0511 degrees) are synthetic: the nearest real row smoothed along longitude with a box of +-32 columns (`POLAR_SMOOTH_COLUMNS`); the polar streaks are visible in the height map (Antarctica interior is Ice anyway). Natural Earth polygons are authoritative for land; land pixels are forced to >= 1 m and sea pixels to <= -1 m.

### D25 Rasteriser (`tools/bake/raster.ts`)
Own scanline fill, pixel centres, half-open row interval (no double counting at vertices), all rings of a feature together under even-odd (holes and islands in lakes come out right whatever the winding). A ring with a longitude jump over 180 degrees is unwrapped and drawn three times (-360, 0, +360) clipped to the grid; edges that run along a pole (Antarctica's closing edge from +180 to -180 at -90) are not treated as jumps. The 50m Natural Earth file has no ring with a jump (already split at +-180), so the real bake never needed the unwrapping; unit tests cover it.

### D26 Thresholds (all in `tools/bake/classify.ts`)
| constant | value | why |
|----------|-------|-----|
| `SPIKE_MEDIAN_DEVIATION_M` | 2000 | prompt; removes the error pixels, keeps peaks |
| `POLAR_SMOOTH_COLUMNS` | 32 | smooth synthetic polar cap |
| `LAND_MIN_PIXELS` | 8 of 16 | land when half or more of the 4x4 pixels are inside a polygon; gave 124 869 land cells outside Antarctica (band 110k to 145k, about 126k expected), not adjusted |
| `RUGGEDNESS_STEP_M` | 12 | ruggedness byte = height range in the cell (max pixel max minus min pixel mean) / 12, clamp 255 |
| `SHALLOWS_MAX_DEPTH_M` | 200 | continental shelf edge |
| `ICE_NORTH_LAT` | 84 | prompt |
| `ICE_COUNTRY_A3` | ATA | Antarctica is Ice everywhere (prompt) |
| `ICE_CAP_MIN_LAT`, `ICE_CAP_MIN_MEAN_M` | 62, 1400 | Greenland's ice sheet (3 670 Ice cells besides Antarctica and the Arctic) |
| `PEAK_MIN_MAX_M` | 5000 | prompt start value, kept (Peak 1.13 % of non-Ice land, band 0.3 to 1.5 %) |
| `MOUNTAIN_MIN_MAX_M` | 1500 | prompt start value, kept (Mountain 12.99 % excluding Peak, band 8 to 18 %) |
| `HILLS_MIN_MAX_M`, `HILLS_MIN_RUGGEDNESS` | 700, 30 | Hills when max >= 700 m or the cell range is >= 360 m (33 588 cells, 27.7 %) |
| `FOREST_MAX_MEAN_M` | 2500 | no forest above |
| `FOREST_PERCENT_BY_LAT` | <10: 75, <25: 12, <40: 35, <60: 60, <70: 40, else 5 | biome rule by latitude (no rainfall data, so the Sahara is only thinned by the low percentage) |
| `FOREST_BLOCK`, `FOREST_BLOTCH_WEIGHT`, salts | 4, 70, 0x9e3779b1 / 0x85ebca6b | integer hash: 70 % from a hash of 4x4 cell blocks (patches), 30 % per cell; no floating point |
| `MIN_PLAYABLE_CELLS` | 8 | microstate limit (prompt) |
| `MAX_CITIES` | 600 | prompt: about 600 largest plus every capital |
| `SNAP_RADIUS_CELLS` | 3 | BFS radius for capitals, cities and ports |
| `COUNTRY_SEARCH_PIXELS` | 12 | render pixels searched when a point is just outside the 50m polygon |
Class order of tests for land: Ice, Peak, Mountain, Hills, then Forest or Plains. Water: Shallows when mean depth <= 200 m else DeepSea. Measured result: 316 497 DeepSea, 33 844 Shallows, 42 230 Plains, 28 273 Forest, 33 588 Hills, 15 740 Mountain, 1 368 Peak, 52 748 Ice cells; not DeepSea/Shallows 33.18 % of all cells, non-Ice land 23.12 %. Box maxima after cleaning: Himalaya 6727 m, Andes 6034 m, Alps 3384 m; highest cell outside the Himalaya/Karakoram box 6034 m (Andes). The prompt's "measured 6563 m" for the Himalaya was lower than the raw grid's 6727 m, so the median filter does not cut peaks.

### D27 Countries, capitals, cities, ports, overrides
Country ids 1..242 follow descending polygon area (`ADM0_A3` is unique, 242 features; Russia id 1; Antarctica is a country and has id 2); painting goes from large to small so a smaller feature wins an overlap. A sim cell's country is the majority of its land pixels (ties: lower id); water cells have 0. `public/data/meta.json` per country: id, a3, `name_en` (NE `NAME`), `name_sv` (NE `NAME_SV`, falls back to `name_en`), `name_long` (NE `NAME_LONG`, extra: `NAME` is abbreviated for some countries, for example "Dem. Rep. Congo"), continent, population (`POP_EST`), cells, `weightedAreaKm2` (sum of the cos-weighted cell areas), capital cell, capital source, playable.
Capitals: places with `featurecla == "Admin-0 capital"` (the prompt also says `adm0cap = 1`, but 3 such records have `adm0cap = 0`, for example Juba, and Hamilton has `adm0cap = 1` with featurecla "Admin-0 region capital"; the featurecla rule is used). The country comes from the country-id raster at the point (not from `ADM0_A3`: South Sudan is `SSD` in the places file and `SDS` in the countries file); if the point is just outside the 50m polygon the nearest country pixel within 12 pixels is used. The capital is snapped to the nearest land cell with the same country id by ring search up to 3 cells (Chebyshev rings, nearest centre inside the ring wins, cells already taken by another city are skipped). A country without a capital post gets its most central land cell (closest to the mean unit vector): 15 countries, among them Antarctica, Greenland (Nuuk is an "Admin-0 region capital"), Israel (Jerusalem sits in the Palestine polygon) and small islands with 1 to 13 cells; the 58 countries without any land cell have no capital cell (null). All 164 countries with >= 8 cells have a capital cell on land with their own id (tested).
Cities: the 600 largest by `pop_max` (excluding scientific stations, meteorological stations, historic places) plus every capital, snapped the same way, one city per cell (capitals first); 27 could not be snapped and were dropped (25 of them microstate capitals with no land cell). 660 kept. Ports: all 1 081 snapped to the nearest land cell with the coast bit (not Ice), one port per cell, ordered by cell: 1 006 kept. A port's country comes from the cell's country id. Ports are in `public/data/ports.json` (the prompt's list did not name a file for them).
`public/data/overrides.json`: `minPlayableCells` 8; `unplayable` (71 countries with fewer than 8 cells and no land neighbour country); `merged` (7 small countries that touch a country with >= 8 cells, merged into the neighbour with the most touching cell pairs: Brunei into Malaysia, Gambia into Senegal, Hong Kong and Siachen Glacier into China, Lebanon into Syria, Luxembourg into France, Palestine into Israel); `neutralNames` (en and sv) for the disputed or unrecognised features Antarctica, Northern Cyprus, Falkland Islands, Chagos Archipelago, Israel, Siachen Glacier, Kosovo, Palestine, Western Sahara, Somaliland. Pack ids are never changed; later milestones apply the lists. Borders are Natural Earth's de facto lines. 164 of 242 countries have >= 8 cells (the prompt expected 150 to 170).

### D28 Loader (`src/data`)
`DataLoader` takes an injected `manifestUrl` and `readBytes(url): Promise<Uint8Array>` (src/data never imports `src/app/paths.ts`; `src/app/debugData.ts` passes `siteUrl()` on `public/data/manifest.json` and a fetch based reader). Pack and JSON files are resolved relative to the manifest (`new URL(file, manifestUrl)`). For `enc: "b64"` the text is decoded to bytes first (`Uint8Array.fromBase64` if present, else a `charCodeAt` loop over `atob`, never `Uint8Array.from(atob(s), fn)`), then the gzip magic `1f 8b` is checked: without the magic the bytes are taken as the already inflated payload (a server may have decoded them). gunzip = `DecompressionStream`. The payload length and fnv1a are checked against `public/data/checksums.json` (`DataIntegrityError`); a flipped byte in the .gz fails the inflate (CRC), one in an inflated payload fails fnv1a, one in a JSON file fails fnv1a. Typed views: `RenderPack`, `SimGrid`, `WorldMeta`, `City`, `Port`, `Overrides`. The fs reader lives in `tests/helpers/dataFiles.ts` only. `src/app/dataPack.ts` (M00b, used by the probe page) is left as it was; it duplicates `fnv1a32`, `decodeBase64` and `gunzip` from `src/data/bytes.ts` (backlog).

### D29 Earlier test touched
`tests/artifactPack.test.ts`, block "data packs from data/manifest.json": the fixture copies a real build, which since M01 contains the real packs and manifest from `public/data`; the fixture now deletes `public/data/` from its copy before planting its own small pack and manifest. Without that the real `render.bin.gz` and `sim.bin.gz` would be unlisted `.bin.gz` files, which the packer correctly rejects. Nothing was weakened: the same assertions run on the same planted pack.

### D30 Debug page and preview
`debug/data.html` is a third Vite entry; the script is `../src/app/debugData.ts`. Mode: `#map-class|height|country` (wins) or `?map=...`, three buttons that rewrite the anchor with `history.replaceState`, hover line with cell, class, elevations and country. `index.html` carries `Debug: klasskarta / höjdkarta / landkarta` with relative links `./debug/data.html#map-...`; `src/app/main.ts` then rewrites the hrefs with `siteUrl()` (so they work inside an Artifact) and hides the row in `?test=1` (the spike golden is unchanged). No address in the page source starts with a slash. The class map is drawn at 1 pixel per sim cell on a 1024x512 canvas; `e2e/debugData.test.ts` classifies the canvas pixels by exact palette colour and golden-compares the page (`e2e/goldens/debug-data-class.png`). `e2e/artifact.test.ts` packs the real build with the png and the b64 container and loads `debug/data.html` through both (checksums verified in the browser).

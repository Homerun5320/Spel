# Architecture index

An INDEX of modules and public APIs. Each milestone's last step keeps it current. Read only the files listed here.

## Modules (current: M01)

| Path | Purpose | Public API |
|------|---------|------------|
| `index.html` | Bare page fragment: `<div id="root">`, hidden link to `probe.html` + module script. No attributes on html/body. | |
| `probe.html`, `src/probe.ts`, `src/probe.worker.ts` | Preview probe (full document, Vite entry): Swedish table of container tests (.png/.wasm/.txt vs expected.json), module worker, WebGL2, clipboard (click), hash and search, link back to index.html. | `data-probe-done` on body when finished |
| `src/app/paths.ts` | Site-relative addresses. ALL runtime fetches of data and all links to other pages use it. | `ROOT_URL`, `siteUrl(path)`, `joinSiteUrl(root, path)` |
| `src/app/dataPack.ts` | Pack loading: base64 decode (`Uint8Array.fromBase64` or atob loop), gunzip, manifest. | `decodeBase64`, `gunzip`, `fnv1a32`, `fetchPackBytes`, `loadManifest`, `loadPack`, types `PackManifest`, `PackEntry` |
| `scripts/artifact-pack.mjs` and `scripts/artifact-pack.d.mts` | `npm run artifact:pack`: dist to the artifact folder (fragment, whitelist, containers, batches, probe, link check). Procedure: `docs/PREVIEW.md`. | `pack(argv, opts)`, `toFragment`, `checkLinks`, `makeBatches`, `makeProbePack`, `ALLOWED_EXT`, CLI flags `--container --prev --probe --dist --out` |
| `tests/helpers/buildDist.ts` | Production Vite build into a temp folder for tests. | `buildDistTo`, `makeTmp`, `copyDir` |
| `src/data/format.ts` | Binary format of the baked packs, shared by the baker and the loader: sizes, sqrt codecs, `TerrainClass`, `NavFlag`, layer tables. Pure. | `RENDER_WIDTH`, `RENDER_HEIGHT`, `SIM_WIDTH`, `SIM_HEIGHT`, `NAV_*`, `LAND_MAX_M`, `DEPTH_MAX_M`, `MIN_LAND_CODE`, `encodeLandHeight`, `decodeLandHeight`, `encodeDepth`, `decodeDepth`, `TerrainClass`, `TERRAIN_CLASS_NAMES`, `NavFlag`, `PACK_LAYERS`, `layoutOf(pack)` |
| `src/data/bytes.ts` | Bytes helpers (pure TS). | `fnv1a32`, `hex8`, `decodeBase64`, `decodeBase64Loop`, `hasGzipMagic`, `gunzip` |
| `src/data/loader.ts` | Manifest loader with injected `readBytes`; raw and b64; gzip magic; fnv1a check against `public/data/checksums.json`. | `DataLoader` (`loadPack`, `loadJson`, `manifest`, `checksums`, `timings`), `DataIntegrityError`, types `ReadBytes`, `Manifest`, `Checksums` |
| `src/data/world.ts` | Typed views and the world loader. | `createWorldLoader(opts)` (`loadSim`, `loadRender`, `loadMeta`, `loadCities`, `loadPorts`, `loadOverrides`), `simGridView`, `renderPackView`, types `SimGrid`, `RenderPack`, `WorldMeta`, `CountryMeta`, `City`, `Port`, `Overrides` |
| `src/data/index.ts` | Barrel of the data layer. | everything above |
| `tools/bake/` | `npm run bake` / `npm run bake:check`: `tools/bake/fetch.ts` (cached downloads, allowed hosts), `tools/bake/terrarium.ts` (tiles, spike clean, resample), `tools/bake/raster.ts` (scanline polygons), `tools/bake/classify.ts` (ALL thresholds), `tools/bake/build.ts` (pure pipeline), `tools/bake/output.ts` (deterministic gzip, checksums, manifest), `tools/bake/check.ts`, `tools/bake/synthetic.ts` (pipeline test input only), `tools/bake/index.ts` (CLI). | `buildWorld`, `fillPolygon`, `paintPolygon`, `cleanHeights`, `resampleToRender`, `prepareOutput`, `writeOutput`, `checkData`, `classifyLand`, `classifyWater` |
| `public/data/` | Committed baked data (about 4.5 MB): `public/data/render.bin.gz`, `public/data/sim.bin.gz`, `public/data/manifest.json`, `public/data/checksums.json`, `public/data/meta.json`, `public/data/cities.json`, `public/data/ports.json`, `public/data/overrides.json`. Formats: `docs/DECISIONS.md` D22-D28. | |
| `debug/data.html`, `src/app/debugData.ts`, `src/app/debugPalette.ts` | Data map page (class / height / country) on a 1024x512 canvas; mode from `?map=` or `#map-...` and three buttons. | `parseMapMode`, `CLASS_COLORS`, `heightColor`, `countryColor`; hooks `window.__debugData` |
| `src/app/main.ts` | Client entry. Builds DOM from JS, starts the spike, F3 overlay, test hooks. | `window.__test` (see Test hooks) |
| `src/app/params.ts` | URL parameter parsing. | `parseParams(search): AppParams` (`test`, `blank`, `seed`, `width`, `height`), `TEST_WIDTH`, `TEST_HEIGHT` |
| `src/render/spike.ts` | M00 throwaway WebGL2 spike: sphere + GLSL ShaderMaterial sun + seeded DataTexture. The only place importing `three` besides `src/app`. | `createSpike(opts): Spike` (`render`, `resize`, `info`, `dispose`), `sunDirection(lon, lat)`, `fitFovDeg()`, `makePrng(seed)`, `makeNoiseData(seed)`, constants `TEST_SUN_LON_DEG`, `TEST_SUN_LAT_DEG`, `CAMERA_DISTANCE` |
| `scripts/shot.mjs` and `scripts/shot.d.mts` | Playwright launcher and test harness; CLI = `npm run shots`. | `launchBrowser`, `openPage`, `takeShot`, `renderAndCapture`, `analyzeImage`, `checkImageStats`, `checkShot`, `assertShotOk`, `compareGolden`, `heapDelta`, `readUsedHeap`, `startViteServer`, `guard`, `CHROMIUM_ARGS`, `THRESHOLDS`, `ALLOWED_CONSOLE_WARNINGS` |
| `tests/perfguard.ts` | CPU budget calibration. | `budgetMs(x)`, `calibrationFactor()`, `createPerfGuard(measure?)`, `measureMedianMs(fn)`, `measureP99Ms(fn)`, `percentile`, `median` |
| `tests/helpers/ciWorkflow.ts` | Finds and parses the CI workflow file. | `loadWorkflow()`, `allRunCommands(doc)` |
| `e2e/globalSetup.ts` | Starts Vite on a free port for e2e; provides `baseUrl`. | `inject('baseUrl')` |
| `.claude/session-start.sh` | SessionStart hook (one health line, exit 0). | |
| `eslint.config.js` | Flat config: boundary + determinism rules. | |
| `vitest.config.ts` | Projects `unit`, `perf`, `e2e`. | |

Empty folders reserved with `.gitkeep`: `src/sim`, `src/ai`, `src/host`, `src/ui`, `src/audio`.

## Test hooks (`?test=1`)

`window.__test` (defined in `src/app/main.ts`):
- `render()`: render one frame synchronously with the fixed test-view sun.
- `info()`: GL renderer string, WebGL2 flag, draw calls, triangles, textures, geometries, size, DPR, `firstFrameMs`, `frames`, `testMode`.

`window.__debugData` (debug/data.html, no test mode needed): `mode`, `loadMs`, `timings`, `measureLoad(n)` (n full loads, ms each), `setMode(mode)`. The page sets `body[data-ready="1"]`, `body[data-checksums="ok"]`, `body[data-map]`, `body[data-load-ms]`.

Test-mode URL params: `test=1`, `blank=1` (debug: empty canvas), `seed=N`, `w=`, `h=` (default 960x540). Later milestones list their hooks here.

## Test layout

- `tests/*.test.ts`: unit project (lint self-test, boundary test, analysis, CI file, spike maths, docs checks).
- `tests/*.perf.test.ts`: perf project.
- `e2e/*.test.ts`: e2e project (smoke, determinism, negative, heap and leak-test, artifact: the packed build served from a sub-folder like an Artifact).
- `tests/portable.test.ts`, `tests/artifactPack.test.ts`, `tests/paths.test.ts`, `tests/dataPack.test.ts`: portable build and pack checks (unit project).
- `tests/bake/*.test.ts` (rasteriser, codecs, fetch guard, synthetic pipeline), `tests/data/*.test.ts` (loader, acceptance on the committed data), `tests/data.perf.test.ts` (load budget), `tests/debugMap.test.ts`, `e2e/debugData.test.ts` (debug page, golden `debug-data-class.png`).
- Goldens: `e2e/goldens/`.

## Roadmap

See `docs/CHARTER.md` section 8. Planned modules (later): `src/sim/rules.ts`, `src/sim/view.ts`, `src/sim/public.ts`, `src/app/devpanel.ts`, `src/ui/i18n.ts`, `server/`.

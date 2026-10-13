# Architecture index

An INDEX of modules and public APIs. Each milestone's last step keeps it current. Read only the files listed here.

## Modules (current: M02 checkpoint A)

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
| `src/app/params.ts` | URL parameter parsing (the unified parser with the hash grammar comes later in M02). | `parseParams(search): AppParams` (`test`, `blank`, `seed`, `width`, `height`), `parseSceneParams(search)` (`scene` globe or spike, `quality`), `TEST_WIDTH`, `TEST_HEIGHT` |
| `src/render/spike.ts` | M00 WebGL2 spike, kept as `?scene=spike` (its golden and seed test): sphere + GLSL ShaderMaterial sun + seeded DataTexture. The only place importing `three` besides `src/app`. | `createSpike(opts): Spike` (`render`, `resize`, `info`, `dispose`), `sunDirection(lon, lat)`, `fitFovDeg()`, `makePrng(seed)`, `makeNoiseData(seed)`, constants `TEST_SUN_LON_DEG`, `TEST_SUN_LAT_DEG`, `CAMERA_DISTANCE` |
| `src/render/config.ts` | The ONE render config file: Earth radius, height exaggeration (x12), sun (declination, longitude at t0, day length, colours), camera limits and speeds, default view, class albedo table, facet weight. | constants (`HEIGHT_EXAGGERATION`, `SUN_*`, `DIST_MIN_KM`, `DIST_MAX_KM`, `TILT_MAX_DEG`, `LAT_LIMIT_DEG`, `CAMERA_FOV_DEG`, ...) |
| `src/render/clock.ts` | The fx clock: the only cosmetic clock (frozen in `?test=1`). Unit test `tests/fxClock.test.ts` lists the files that may read real time. | `fxNow()`, `advanceFx(dt)`, `setFxTime(t)` |
| `src/render/quality.ts` | Tiers test / low / medium / high (mesh size, DPR cap, MSAA). `?quality=` selects, `?test=1` forces test. | `QUALITY`, `QUALITY_TIERS`, `DEFAULT_TIER`, `resolveQuality`, `meshTriangles`, `isQualityTier` |
| `src/render/geo.ts` | Pure geometry: lat/lon to vector (+y north, lon 0 = +z, +x east), analytic east/north frame (pole safe), sim cell, sun direction from fx time. | `latLonToVec`, `vecToLatLon`, `eastAt`, `northAt`, `latLonToCell`, `wrapLon`, `sunDirectionAt`, `subsolarLonAt`, `timeForSubsolarLon`, vector helpers |
| `src/render/heightField.ts` | CPU copy of the height texture (same bytes): displaced surface radius and ray picking (shell, march, bisect). | `HeightField` (`heightM`, `surfaceRadius`, `surfacePoint`, `pick`), `raySphere`, `nearestSpherePoint` |
| `src/render/camera.ts` | Orbit / arcball camera maths (pure): grab-drag with inertia, wheel zoom anchored at the cursor, tilt and zoom limits, pole safe frame, ray and projection. Integrates on the fx clock. | `CameraRig` (`setView`, `pose`, `rayAt`, `project`, `dragStart`, `dragMove`, `dragEnd`, `zoomAt`, `rotateBy`, `update(now)`), `ViewState`, `CameraPose` |
| `src/render/views.ts` | The six canonical views of the contact sheet (earth, europe50, himalaya, andes, alps, night) and the start view / sun. | `CANONICAL_VIEWS`, `DEFAULT_START_VIEW`, `DEFAULT_START_TIME` |
| `src/render/globeMesh.ts` | Lat/lon grid of unit directions (row 0 = north, uv addresses the rasters). | `buildGlobeGeometry(cols, rows)` |
| `src/render/textures.ts` | R8 `DataTexture`s from the raw pack bytes (NoColorSpace, flipY false, unpackAlignment 1): height, bathy, country (nearest), sim class (nearest). | `makeR8Texture`, `createWorldTextures`, `textureBytes`, `disposeWorldTextures` |
| `src/render/textureProbe.ts` | Texel readback: small render-to-target pass with `texelFetch` (tests compare GPU texels with the source bytes). | `readTexels(renderer, texture, points)` |
| `src/render/shaders/common.ts`, `src/render/shaders/terrain.ts` | GLSL ES 3.00 modules: geo/texel helpers; terrain vertex (displacement from the height texture, sqrt decode) and fragment (mask-shaded coast, bathymetry water, biome B-spline, hypsometric + snow, height-field slope normal plus derivative facet normal). Ocean and atmosphere modules come with checkpoint B. | `terrainVertexShader`, `terrainFragmentShader`, `GLSL_GEO`, `GLSL_TEXELS` |
| `src/render/terrainMaterial.ts` | The terrain `ShaderMaterial` and its uniforms (testable without GL). | `createTerrainMaterial(textures, render, sim, meta)` |
| `src/render/globe.ts` | The stylised Earth: WebGLRenderer, scene, mesh, camera rig, picking, projection, texel readback, info. The only GL owner besides the spike and `textureProbe`. | `Globe` (`render`, `setView`, `pick`, `describe`, `project`, `readTexels`, `setExaggeration`, `info`, `resize`, `dispose`), types `GlobeInfo`, `GlobePick`, `WorldData` |
| `src/app/globeApp.ts` | Scene boot: loads packs through `src/data`, builds the Globe, mouse input, hover tooltip, F3 overlay, `?test=1` hooks or the frame loop (the one place that turns rAF frames into `advanceFx`). | `bootGlobe(ctx)`, types `GlobeTestHooks`, `GlobeTestInfo` |
| `src/app/tooltip.ts` | Hover tooltip text (country, class, height in metres), Swedish until the i18n tables in M05. | `tooltipText`, `formatMetres`, `countryNameMap`, `CLASS_LABEL_SV` |
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

Since M02 the default scene is the stylised Earth (`?scene=spike` is the M00 spike, which only has `render` and `info`). `window.__test` of the globe scene (`src/app/globeApp.ts`):
- `render(dt = 0)`: steps the fx clock by `dt`, then renders one frame (camera inertia, wheel zoom and the sun follow the fx clock).
- `info()`: GL renderer string, WebGL2 flag, draw calls, triangles, textures, geometries, texture MB, size, DPR, tier and mesh size, `firstFrameMs`, `frames`, `fx`.
- `setView({lat, lon, distKm, heading, tilt, time})`: camera (limits applied) and, when `time` is given, the fx clock in seconds; does not render. `view()` returns the clamped camera.
- `project(lat, lon)`: canvas pixel of the displaced surface point (`x`, `y`, `inView`, `facing`).
- `pick(x, y)`: surface pick (lat, lon, sim cell, class, country, elevation) or null; `tooltip(x, y)`: the tooltip text for that pixel.
- `advance(dt)`: steps ONLY the fx clock (M05 adds sim ticks).
- `readTexels(name, points)`: texels of `height`, `bathy`, `country` or `terrainClass` as the GPU holds them.
- `setExaggeration(x)`: height exaggeration of shader and picking (0 = flat control).
- Mouse works in test mode too (real `page.mouse` events); left drag = grab, right drag (or ctrl / shift) = heading and tilt, wheel = zoom at the cursor.

`window.__debugData` (debug/data.html, no test mode needed): `mode`, `loadMs`, `timings`, `measureLoad(n)` (n full loads, ms each), `setMode(mode)`. The page sets `body[data-ready="1"]`, `body[data-checksums="ok"]`, `body[data-map]`, `body[data-load-ms]`.

Test-mode URL params: `test=1`, `blank=1` (debug: empty canvas), `seed=N`, `w=`, `h=` (default 960x540). Later milestones list their hooks here.

## Test layout

- `tests/*.test.ts`: unit project (lint self-test, boundary test, analysis, CI file, spike maths, docs checks, `tests/fxClock.test.ts`, `tests/tooltip.test.ts`).
- `tests/render/*.test.ts` (quality, geo, clock, camera, picking on the real packs, globe mesh, shaders and uniforms, data textures); `e2e/globe.test.ts` (budgets, texel readback, six views, picking, mouse camera, tooltip, fx clock).
- `tests/*.perf.test.ts`: perf project.
- `e2e/*.test.ts`: e2e project (smoke, determinism, negative, heap and leak-test, artifact: the packed build served from a sub-folder like an Artifact).
- `tests/portable.test.ts`, `tests/artifactPack.test.ts`, `tests/paths.test.ts`, `tests/dataPack.test.ts`: portable build and pack checks (unit project).
- `tests/bake/*.test.ts` (rasteriser, codecs, fetch guard, synthetic pipeline), `tests/data/*.test.ts` (loader, acceptance on the committed data), `tests/data.perf.test.ts` (load budget), `tests/debugMap.test.ts`, `e2e/debugData.test.ts` (debug page, golden `debug-data-class.png`).
- Goldens: `e2e/goldens/`.

## Roadmap

See `docs/CHARTER.md` section 8. Planned modules (later): `src/sim/rules.ts`, `src/sim/view.ts`, `src/sim/public.ts`, `src/app/devpanel.ts`, `src/ui/i18n.ts`, `server/`.

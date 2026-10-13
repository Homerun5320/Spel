# Architecture index

An INDEX of modules and public APIs. Each milestone's last step keeps it current. Read only the files listed here.

## Modules (current: M00b)

| Path | Purpose | Public API |
|------|---------|------------|
| `index.html` | Bare page fragment: `<div id="root">`, hidden link to `probe.html` + module script. No attributes on html/body. | |
| `probe.html`, `src/probe.ts`, `src/probe.worker.ts` | Preview probe (full document, Vite entry): Swedish table of container tests (.png/.wasm/.txt vs expected.json), module worker, WebGL2, clipboard (click), hash and search, link back to index.html. | `data-probe-done` on body when finished |
| `src/app/paths.ts` | Site-relative addresses. ALL runtime fetches of data and all links to other pages use it. | `ROOT_URL`, `siteUrl(path)`, `joinSiteUrl(root, path)` |
| `src/app/dataPack.ts` | Pack loading: base64 decode (`Uint8Array.fromBase64` or atob loop), gunzip, manifest. | `decodeBase64`, `gunzip`, `fnv1a32`, `fetchPackBytes`, `loadManifest`, `loadPack`, types `PackManifest`, `PackEntry` |
| `scripts/artifact-pack.mjs` and `scripts/artifact-pack.d.mts` | `npm run artifact:pack`: dist to the artifact folder (fragment, whitelist, containers, batches, probe, link check). Procedure: `docs/PREVIEW.md`. | `pack(argv, opts)`, `toFragment`, `checkLinks`, `makeBatches`, `makeProbePack`, `ALLOWED_EXT`, CLI flags `--container --prev --probe --dist --out` |
| `tests/helpers/buildDist.ts` | Production Vite build into a temp folder for tests. | `buildDistTo`, `makeTmp`, `copyDir` |
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

Empty folders reserved with `.gitkeep`: `src/sim`, `src/ai`, `src/data`, `src/host`, `src/ui`, `src/audio`, `tools`, `public/data`.

## Test hooks (`?test=1`)

`window.__test` (defined in `src/app/main.ts`):
- `render()`: render one frame synchronously with the fixed test-view sun.
- `info()`: GL renderer string, WebGL2 flag, draw calls, triangles, textures, geometries, size, DPR, `firstFrameMs`, `frames`, `testMode`.

Test-mode URL params: `test=1`, `blank=1` (debug: empty canvas), `seed=N`, `w=`, `h=` (default 960x540). Later milestones list their hooks here.

## Test layout

- `tests/*.test.ts`: unit project (lint self-test, boundary test, analysis, CI file, spike maths, docs checks).
- `tests/*.perf.test.ts`: perf project.
- `e2e/*.test.ts`: e2e project (smoke, determinism, negative, heap and leak-test, artifact: the packed build served from a sub-folder like an Artifact).
- `tests/portable.test.ts`, `tests/artifactPack.test.ts`, `tests/paths.test.ts`, `tests/dataPack.test.ts`: portable build and pack checks (unit project).
- Goldens: `e2e/goldens/`.

## Roadmap

See `docs/CHARTER.md` section 8. Planned modules (later): `src/sim/rules.ts`, `src/sim/view.ts`, `src/sim/public.ts`, `src/app/devpanel.ts`, `src/ui/i18n.ts`, `server/`.

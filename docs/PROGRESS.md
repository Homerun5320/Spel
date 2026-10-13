# Progress

Resume: Läs CLAUDE.md och docs/PROGRESS.md, kör git log -10 och npm run verify:fast, fortsätt vid första ej avbockade punkten.

## Done

| id | merge SHA | note |
|----|-----------|------|
| M00 | (set after the squash merge) | Harness: verify, lint rules, WebGL2 spike, shot.mjs, perfguard, CI file, hook, docs. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| M00b | (set after the squash merge) | Preview path: portable build, `siteUrl`, Artifact pack script, probe page, Artifact e2e, `docs/PREVIEW.md`. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (M00 was not merged yet) |
| M01 | (set after the squash merge) | Bake world: terrain, countries, cities, ports as committed binary packs, loader, debug map page. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (M00 and M00b were NOT merged yet; they live on this branch, so the M00b precondition was treated as satisfied by the orchestrator's instruction) |

## Now

### M01 Baka riktiga världen (all items ticked; the Artifact was republished with the real data packs as version 2 and the branch is pushed; waiting for the squash merge)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7. M00 and M00b were not merged yet (they live on this branch), so the M00b precondition was treated as satisfied by the orchestrator's instruction.

GÖR
- [x] 1. `tools/bake` fetch (Terrarium z4 + Natural Earth at a pinned SHA, gitignored cache), polygon rasteriser, synthetic fallback for pipeline tests only
- [x] 2. Deterministic bake (no timestamps, sorted order, gzip 9 mtime 0), `public/data/checksums.json` (sha256 + fnv1a of payload, sha256 of .gz informational)
- [x] 3. Render pack 4096x2048 (height, country id) + bathymetry 2048x1024, spike clamp + 3x3 median
- [x] 4. Sim pack 1024x512 + nav grid 256x128 + cos(lat) Q15 rows, all thresholds in `tools/bake/classify.ts`
- [x] 5. `public/data`: manifest, meta, cities, ports, overrides, checksums
- [x] 6. `src/data` loader with typed views (injected readBytes, raw and b64, gzip magic, fnv1a, corrupt byte rejected)
- [x] 7. `npm run bake:check`, `CREDITS.md`, `docs/ASSETS.md`
- [x] 8. `debug/data.html` (class / height / country maps, `?map=` and `#map-`), link row in index.html
- [x] 9. Docs: DECISIONS (D21-D30), ARCHITECTURE index, PREVIEW update, BACKLOG

ACCEPTANS
- [x] bake twice: identical payload sha256 and identical .gz (all 8 files byte-identical, run on the same machine); `bake:check` passes offline
- [x] data tests (Sweden 643 cells and 448 476 km2, Russia largest, no land < 1 m, no sea > -1 m, box maxima Himalaya 6727 / Andes 6034 / Alps 3384 m, highest outside the Himalaya box 6034 m, Netherlands mean 12.1 m, Mountain cells in all three boxes, Peak 1.13 %, Mountain 12.99 %)
- [x] 164 of 242 countries have >= 8 cells (logged in the test and the bake); each has a capital cell on land with its own country id
- [x] `npm run build && npm run artifact:pack` on the real packs (20 files, 15.33 MB incl. 10 MB probe packs, largest file 2.6 MB); `e2e/artifact.test.ts` loads `debug/data.html` through the png and b64 containers and validates the fnv1a checksums in Chromium
- [x] total data 4 776 492 bytes (limit 6 MB gz); corrupt byte rejected (gz byte, inflated byte, JSON byte); load + parse logged: Node median 216-261 ms, Chromium median 303-340 ms (target 300 ms, asserted only against `budgetMs(1500)`)
- [x] screenshot of the debug page: not blank; not DeepSea/Shallows 33.18 % (band 30-40), non-Ice land 23.12 % (band 20-28); golden `e2e/goldens/debug-data-class.png` committed
- [x] `npm run verify` green (about 45 s)

### M00 Grundverktyg, arbetsavtal och WebGL-bevis (all items ticked; waiting for the squash merge)

GÖR
- [x] 0. Minimal CLAUDE.md + docs/PROGRESS.md, committed first
- [x] 1. Paket och verktyg (exact pins verified with `npm view`; `rm -rf node_modules && npm ci` proven, 3 s from cache)
- [x] 2. Mappskelett
- [x] 3. ESLint flat config, gränsregler, determinismförbud, lint-självtest
- [x] 4. Klient-spike (index.html, src/app/main.ts, src/render/spike.ts, ?test=1, F3)
- [x] 5. scripts/shot.mjs (+ shot.d.mts, analys, golden-regel, heapDelta)
- [x] 6. tests/perfguard.ts + perf-projekt
- [x] 7. e2e-tester (smoke, determinism, negativt) plus heapDelta self-test and a leak-test
- [x] 8. npm-scripts
- [x] 9. .github/workflows/ci.yml (+ YAML test)
- [x] 10. SessionStart-hook (`bash -n` ok; manual run: one line, exit 0)
- [x] 11. Dokument
- [x] 12. docs/CHARTER.md ordagrant
- [x] 13. Mått loggade (below)

ACCEPTANS
- [x] `npm ci && npm run verify` exits 0 from a clean install; `npm run verify:fast` exits 0
- [x] Smoke shot passes all assertions; synthetic blank/noise/checkerboard images are rejected
- [x] Two renders in one start are byte-identical; golden rule met; the blank-canvas debug param makes smoke fail
- [x] Lint self-test: planted Math.sin / Math.asin / Math.log2 / three import in src/sim fail, clean code passes
- [x] perfguard and heapDelta self-tests pass; CI file test passes
- [x] CLAUDE.md < 200 lines and holds the required rules; the user-file rule line appears exactly once in CLAUDE.md; PROGRESS.md has the resume line, Environment table and usage table
- [x] Hook script verified (`bash -n`, manual run: 1 line, exit 0)

The SessionStart hook first runs for real in the NEXT session (it is only loaded at session start).

CI workflow: `.github/workflows/ci.yml` was committed normally on the branch. Whether the push of `.github/workflows/*` is accepted is decided when the orchestrator pushes; if it is refused, the file moves to `docs/ci/ci.yml.txt` (the unit test accepts both locations) and the user adds it on GitHub by hand (see CLAUDE.md, CI rule and workflow fallback). Case that occurred (2026-10-13): the push of `.github/workflows/ci.yml` was ACCEPTED (the session token may add workflow files), so no `docs/ci/` fallback is needed. CI itself has not run yet: it starts when a pull request is marked ready for review.

### M00b Förhandsvisning (all items ticked except the Artifact publication done by the orchestrator; waiting for the squash merge)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7. Note: M00 was NOT yet squash-merged when M00b started (origin/main is still the initial commit; M00 lives on its branch and in pull request #1), so this SHA is the state before M00. The M00 precondition was treated as satisfied by the orchestrator's instruction.

GÖR
- [x] 1. Portable build: `base: './'`, `assetsDir: 'assets'`, `src/app/paths.ts` (`ROOT_URL`, `siteUrl`), absolute-address test
- [x] 2. `scripts/artifact-pack.mjs` (`npm run artifact:pack`): fragment, file whitelist, containers, files list, `--prev`, `--probe`, link check
- [x] 3. `probe.html` + `src/probe.ts` + `src/probe.worker.ts`, linked from index.html
- [x] 4. `e2e/artifact.test.ts`
- [ ] 5. Publish the spike as an Artifact (done by the orchestrator, URL goes into docs/PREVIEW.md)
- [x] 6. Update procedure (documented in docs/PREVIEW.md, steps 10-16)
- [x] 7. Other routes (Netlify, local) probed and recorded (Netlify EJ MÖJLIG)
- [x] 8. docs/PREVIEW.md (Swedish), results in docs/DECISIONS.md (D15-D20)

ACCEPTANS
- [x] docs/PREVIEW.md exists, in Swedish, names the chosen route and why, the Artifact URL, the update procedure and a result per tried route
- [x] absolute-address test passes; `npm run verify` green
- [x] `npm run artifact:pack` green; fragment unit test (incl. `<header>`); planted `.glb` / extension-less file gives exit code != 0; `--prev` writes `null`; no batch holds index.html, .bin, .gz or .zip; link check passes
- [x] `e2e/artifact.test.ts` green (globe drawn, zero console errors, no 404)
- [ ] The spike is published as an Artifact (or the local-run guide is complete); the reply ends with the question: syns klotet?

## Next

- M02 Stylised Earth, Dev panel (GATE): renders the packs; registers the debug map modes and the hash grammar in the Dev panel (see `docs/BACKLOG.md`).

## Known issues

- M01: the Joerd/Mapzen attribution page (the exact list of elevation sources behind Terrarium) could not be reached; `CREDITS.md` and `docs/ASSETS.md` carry a general line (Mapzen terrain tiles, USGS SRTM, NOAA ETOPO1 and others). Replace it when the page is reachable.
- M01: the polar caps beyond 85.05 degrees are synthetic (smoothed copy of the nearest real row); streaks are visible in the height map. Antarctica is Ice anyway.
- M01: 15 countries use a "most central cell" as capital because Natural Earth has no `Admin-0 capital` place in their polygon (Greenland, Israel, Western Sahara and small islands); 58 countries have no land cell at all (see `public/data/overrides.json`).
- M01: the Forest/Plains rule is by latitude and a hash only, so the Sahara shows a few forest cells; cosmetic (backlog).
- `docs/CHARTER.md` is verbatim from the prompt; in section 7 the "User lines" and "User's own files" bullets sit on one line (a newline is missing in the source text). Not changed because the charter must stay word for word.
- No real-GPU measurement exists; everything is SwiftShader.
- M00b: the data manifest format of M01 is assumed (name to file relative to the data folder, enc defaults to raw), see D17 in `docs/DECISIONS.md`. M01 must keep it or change the pack script.
- M00b: the Artifact URL in `docs/PREVIEW.md` is a placeholder until the orchestrator publishes; the user's "klotet syns" confirmation is pending.

## Skipped

(none)

## Environment

Preflight in the cloud sandbox:

| item | value |
|------|-------|
| Node | v22.22.0 (needs >= 22.13) |
| npm | 10.9.4 |
| Chromium | 141.0.7390.37 at /opt/pw-browsers/chromium-1194/chrome-linux/chrome (`/opt/pw-browsers/chromium` symlink; also chromium_headless_shell-1194, ffmpeg-1011) |
| PLAYWRIGHT_BROWSERS_PATH | /opt/pw-browsers |
| GL renderer (headless) | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver), WebGL 2.0 (OpenGL ES 3.0 Chromium) |
| elevation-tiles-prod.s3.amazonaws.com (terrarium/4/8/5.png) | reachable (200) |
| raw.githubusercontent.com (natural-earth-vector pinned SHA, ne_50m_admin_0_countries.geojson) | reachable (200) |
| registry.npmjs.org/three | reachable (200) |
| `git ls-remote https://github.com/nvkelso/natural-earth-vector.git HEAD` | reachable (ca96624a56bd078437bca8184e78163e5039ad19) |
| github.com / api.github.com over plain HTTP | 301 through the proxy (info only, not needed) |
| GitHub tooling | `gh` installed but GH_TOKEN reported invalid; GitHub MCP tools work (`get_me` returned the repo owner) |
| Blocked mandatory hosts | none |

## Measurements (logged, not asserted)

Cloud sandbox, SwiftShader, 960x540, DPR 1:

| measure | value |
|---------|-------|
| first frame (page start to end of first render) | about 270-330 ms warm (768 ms on the very first cold Vite start) |
| page load | about 250-310 ms |
| render call | about 24 ms |
| page screenshot | about 120-180 ms |
| draw calls / triangles / textures | 1 / 9024 / 1 |
| silhouette coverage, luma std, left/right ratio | 44.1 %, 57.6, 1.52 |
| leak-test (60 renders at 320x180) heap delta | 0.015 MB |
| `npm run verify:fast` | about 6 s |
| `npm run verify` | about 15 s |
| perfguard factor | about 0.9 (reference 5.5 ms for 5 M imul writes) |

M01 (same sandbox):

| measure | value |
|---------|-------|
| `npm run bake` (warm cache) | about 5 s; cold cache adds about 3 s for the 256 tiles (18.3 MB) and the three Natural Earth files |
| pack sizes | `render.bin.gz` 2 604 661 B (18 874 368 B raw), `sim.bin.gz` 1 924 350 B (4 816 896 B raw), all of `public/data` 4 776 492 B |
| Node load + parse (all packs + JSON, fnv1a checked) | median 216 ms (perf project), 192-261 ms (unit logs) |
| Chromium load + parse | first load about 170-190 ms, median of 5 more 303-340 ms |
| `npm run verify` | about 45 s |

## Usage

| date | after milestone | 5h % | week % | note |
|------|-----------------|------|--------|------|

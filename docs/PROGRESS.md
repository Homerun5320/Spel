# Progress

Resume: Läs CLAUDE.md och docs/PROGRESS.md, kör git log -10 och npm run verify:fast, fortsätt vid första ej avbockade punkten.

## Done

| id | merge SHA | note |
|----|-----------|------|
| M00 | (set after the squash merge) | Harness: verify, lint rules, WebGL2 spike, shot.mjs, perfguard, CI file, hook, docs. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| M00b | (set after the squash merge) | Preview path: portable build, `siteUrl`, Artifact pack script, probe page, Artifact e2e, `docs/PREVIEW.md`. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (M00 was not merged yet) |
| M01 | (set after the squash merge) | Bake world: terrain, countries, cities, ports as committed binary packs, loader, debug map page. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (M00 and M00b were NOT merged yet; they live on this branch, so the M00b precondition was treated as satisfied by the orchestrator's instruction) |
| M02 | (set after the squash merge) | Wow 1, the stylised 3D Earth (terrain, ocean, atmosphere, borders, night lights, camera, picking, Dev panel, hash grammar, goldens). GATE PASSED: the user looked at the Artifact (version 3) on a real GPU and reported 30-50 fps and a good picture (this also confirms the M00b Artifact route). Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (M00, M00b and M01 were NOT merged yet; they live on this branch) |
| M03 | (set after the squash merge) | Sim foundation: deterministic core (`src/sim`), intents and codec, serialisation and hash, host seam (`src/host`), golden hashes, sensitivity tests, worker test, `debug/sim.html`, `npm run sim:run`. No visible change; the Artifact is not republished. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (the id of the previous prompt is M02; nothing of M00 to M02 is merged, they live on this branch) |

## Now

### M04 Territorie-sim: trupper, guld, terrängmedveten erövring (no visible change; the Artifact is NOT republished) - split over two sessions: Part A (items 1-3, Spawn, owner widening) and Part B (items 4-7)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (`git ls-remote origin refs/heads/main` re-checked: still the initial commit; NOTHING of M00 to M03 is merged, it all lives on this branch and in draft pull request #1; the "M01 and M03 are merged" precondition was treated as satisfied by the orchestrator's instruction). `npm ci && npm run verify:fast` was green at the start (629 unit tests). The orchestrator owns pushing, the pull request and the Artifact; no push, no PR, no publication from the building sessions.

Units (decided in Part A, details in D71-D80 of `docs/DECISIONS.md`): a std-cell is 2x2 sim cells (distance x2, area x4, linear speed x2); troops are stored in quarter troops (QT, 4 QT = 1 troop; a Plains sim cell costs 3 QT = 0.75 troop); gold is stored in milli-gold; fractions are carried in integer remainders, never in floats.

GÖR, Part A (this session)
- [x] A0. Preflight (merge SHA recorded, verify:fast green), this checklist
- [x] A1. Owner widening (own commit): `GameState.owner`, `StateDiff.owners` / `fullOwner`, `serialize` / `hashState` and the goldens go from Uint8 to Uint16; reason in D71; `FORMAT_VERSION` 2
- [x] A2. ESLint boundary for `src/host` (heads-up 4 of the M03 audit) with a lint self-test
- [x] 1. `SimWorld` (`src/sim/world.ts`, built from plain arrays, sim does not import `src/data`), `src/sim/grid.ts` (x-wrap, 4-neighbours, `cellKm`, cos-lat weights from the committed Q15 row table, DeepSea / Shallows / Ice / Peak unplayable), Node loader for the real 1024x512 world (`tools/sim/realWorld.ts`)
- [x] 2. `src/sim/rules.ts` as the one balance file with the std-cell constants and every number of the prompt (also the conquest ones, wired in Part B); `docs/BALANCE.md` (Swedish summary at the top, one table row per constant; a test keeps rules.ts and the table in step); CLAUDE.md "Where things are"
- [x] 3. Economy (`src/sim/economy.ts`): troop cap `2000 + 120*N^0.75 + 800*cityLevels` (N^0.75 = sqrt(N)*sqrt(sqrt(N)) in Q15), regeneration `max((8 + 0.35*sqrt(T))*(1 - T/Tmax), -MAX_DECAY)` with a micro-QT remainder, gold from weighted land, start 1200 troops / 500 gold, capital disc radius 8 / `START_DISC_CELLS` 197, tribes (cap/3, regeneration x0.5), T >= 0 clamp after every deduction, land share per seat
- [x] 4a. `Spawn{seat, cell}` end to end: validation (`REJECT_*`), codec (kind 2), canonical order, `copyBody` / `withId`, step, `src/sim/spawn.ts` (K nearest contiguous unowned land cells, distance order, hash tie-break, a smaller landmass gives all its cells), state arrays `troops` / `troopFrac` / `gold` / `capital` / `rowCos`, header `players`, serialisation, hash, host, goldens re-pinned (scenario now spawns), `ENGINE_VERSION` 2
- [x] A9. Tests for all of the above (units, ratios, property tests with fast-check, real world), docs: DECISIONS D71-D80, ARCHITECTURE index, BACKLOG; `npm run verify:fast` green; Chromium golden test (`e2e/sim.test.ts`) run alone and green; committed locally

ACCEPTANS, Part A
- [x] golden hashes identical in Node and Chromium (`e2e/sim.test.ts` alone), snapshot == straight run with Spawn and the economy active
- [x] economy unit tests: no negative troops after any deduction, no division by zero (T = 0, Tmax minimum), cap monotone in N, N^0.75 close to the real power, regeneration positive below the cap / zero at the cap / negative above it and never below `-MAX_DECAY`, tribes get a third of the cap
- [x] Spawn: exactly K cells on open land, contiguous, nearest first; a small island gives all its cells; a second Spawn of the seat, a Spawn on water / Ice / Peak / an owned cell are refused; two seats spawning on the same cell in one turn: the lower (seat, id) wins
- [x] `npm run verify:fast` green

Result of Part A (this sandbox): `npm run verify:fast` green (typecheck, lint, 64 files / 751 unit tests); `e2e/sim.test.ts` (6 tests) and `e2e/artifact.test.ts` (8 tests) run alone and green: the golden hashes are identical in Node and Chromium: tick 1 `06030cb7`, 10 `75e1e727`, 100 `a06de058`, 1000 `8a99d81b`, 6000 `9bf19227` (seed 1, 128x64 fixture world, 4 seats, now with Spawn and the economy in the script); `tests/sim.perf.test.ts` green (empty step 0.8 us, 64 DebugPaints 57 us). The full `npm run verify` is NOT run (Part B ends with it). Three commits of this part after the checklist: the owner widening (D71), the `src/host` lint boundary (D72), the rest (D73-D81). Solo economy on the real world (Stockholm-like capital): 1200 troops become about 3100 after 5 minutes (cap about 3320), 500 gold about 866. Hand-over notes for Part B: see the end of this section and D73-D81 in `docs/DECISIONS.md`.

Notes for Part B (read before starting)
- Units: D73. A conquest cost per sim cell is `BASE_COST_QT_PER_SIM_CELL` (3 QT) times the terrain percent (`TERRAIN_COST_PCT`), the height factor and `(1 + d / DEPTH_COST_DIV_CELLS)`, all in fixed point; troops are QT (`deductTroops` clamps at 0 and returns what was taken); the capture RATE converts with `stdToSimCellRate` (x4) and divides by `TICK_HZ`; keep the remainder of a rate in an integer array like `troopFrac`.
- Constants for part B are already in `src/sim/rules.ts` and `docs/BALANCE.md` (`CAPTURE_K_MILLI`, `BASE_COST_TROOPS`, `D_MAX_*`, `DEPTH_COST_DIV_*`, `HEIGHT_UNIT_M`, `UPHILL_*`, `ENCLAVE_FLIP_TICKS`, `TRIBE_ATTACK_DIV`); adding a constant means a row in the table (the test fails otherwise); there are no decimal literals in `src/sim`.
- Ownership changes ONLY through `setOwner` (area, weight, stamp and the outbox stay right). The outbox cap (8192) is smaller than a 100 000-cell conquest: the host falls back to `fullOwner` (D69); the BACKLOG item about a non-lossy changed-cell list is the better answer once the real bound is known.
- Per-cell scratch: `state.scratch.mark` (all zero between uses); more per-cell work arrays belong in a derived object like `agg`, rebuilt by `assembleState`, not in the registry unless they are real game state (a hashed array needs serialisation, the registry and a sensitivity probe).
- New intent kinds: append to `INTENT_KINDS`; the places are listed in D74. Tribes are seats `>= header.players`; `isTribe(state, owner)`. `step` has the phase comment where conquest goes (between the intents and `economyTick`).
- `hash2(seed, a, b)` (in `src/sim/fixture.ts`) is the integer hash for every tie-break.
- The golden scenario (`src/sim/scenario.ts`) only paints and spawns; part B should add Attack / CancelAttack to it and re-pin (reason in DECISIONS), and `tests/sim/helpers/brokenSteps.ts` (a copy of step) must follow.
- `ENGINE_VERSION` is 2 and `FORMAT_VERSION` 3: bump both when conquest adds state (an `Attack` table is real game state: serialise it, hash it, register it).

GÖR, Part B (NEXT session; do not start before Part A is committed)
- [ ] 4. Conquest: `Attack` objects with incremental frontier lists (hash tie-break, no full scan per tick), capture speed `CAPTURE_K*sqrt(L)*2F/(F+Td)`, costs per cell in QT, mutual attacks cancel, enclave flip every 20th tick offset by hash(id), tribes attack with T/20, intents `Attack{target, pct}` and `CancelAttack` (kinds 3 and 4 appended to `INTENT_KINDS`; edits in `copyBody`, `withId`, `comparePayload`, codec `intentSize` / `putIntent` / `assertEncodable` / `Reader.intent`), `step` phase "conquest" between intents and economy, `ENGINE_VERSION` bump
- [ ] 5. `npm run sim:scenario -- --seed N --minutes 10 --players 12 --tribes 20` (territory curve per minute) and a solo scenario; bots live in `tools/`, never in `src/sim`
- [ ] 6. Calibration of `CAPTURE_K_MILLI` and `BASE_COST_TROOPS` (at most 3 rounds; solo band ca 1 500-2 500 land cells after 5 min and 5 000-8 000 after 10 min, else the measured band +-30 % with the curve in DECISIONS)
- [ ] 7. Tests: ratio tests (4:1 troops >= 1.4x, 1:4 <= 0.6x, Mountain >= 2.2x Plains, uphill dearer than downhill, no division by zero, d <= D_MAX), frontier property test (front == brute force after 1000 random steps; an enclosed enclave flips within 20 ticks), work counters (scanned cells per tick proportional to front length + changed cells), perf (`*.perf.test.ts`: tick p95 <= `budgetMs(4)` with 12 players + 20 tribes on the real world, 100 000 cells conquered in one tick median <= `budgetMs(50)`), goldens re-pinned with the reason, `npm run verify` green, DRAFT PR text (the orchestrator opens it)

ACCEPTANS, Part B (from the prompt; tick when proven)
- [ ] ratio tests at equal contact length: 4:1 troops give >= 1.4x and 1:4 <= 0.6x the capture speed at 1:1; Mountain costs the attacker >= 2.2x Plains; uphill costs more than downhill over the same cell pair; no division by zero, no negative troops, d <= D_MAX (unit tests with F = 0 and Td = 0)
- [ ] frontier property test: the front equals a brute-force recomputation after 1000 random steps; an enclave surrounded by one seat flips within 20 ticks
- [ ] work counters are the primary limit: scanned cells per tick proportional to front length + changed cells, never a full-world scan; tick cost p95 (>= 200 ticks after 50 warm-up ticks) <= `budgetMs(4)` with 12 players + 20 tribes on the real world in Node; conquering 100 000 cells in one tick, median <= `budgetMs(50)`; the times are logged (`*.perf.test.ts`)
- [ ] calibration band of a solo expander (provisional): about 1 500-2 500 land cells after 5 min and 5 000-8 000 after 10 min (or the motivated band of item 6)
- [ ] golden hashes identical in Node and Chromium; snapshot == straight run with territory active; no forbidden APIs; `npm run verify` green

### M03 Sim-grund: determinism, intents, host-söm (no visible change; the Artifact is NOT republished) - built locally, `npm run verify` green; the orchestrator pushes and opens/updates the pull request

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (still the initial commit: nothing of M00 to M02 is merged, it all lives on this branch and in draft pull request #1; the "M00 is merged" precondition was treated as satisfied by the orchestrator's instruction). `npm ci && npm run verify:fast` was green at the start (376 unit tests). The orchestrator owns pushing, the pull request and the Artifact.

GÖR
- [x] 1. `src/sim`: `src/sim/rules.ts`, `src/sim/rng.ts` (sfc32 + splitmix32, state Uint32Array(4) inside the state), `src/sim/detmath.ts` (isqrt, fixed point, Q15 sin/cos LUT generated by `tools/gen`, regenerated in a test), SoA `GameState` parameterised by (width, height), integer-hash fixture world 128x64, `seatToOwner` / `ownerToSeat`, types `Tick` and `Turn`
- [x] 2. Intents: union `Noop` / `DebugPaint`, validation, compact binary codec, order by (seat, id), `step(state, turnIntents)` applying intents scheduled at T+2, reject counter, render-only outbox outside hash and serialisation
- [x] 3. `serialize` / `deserialize` / `hash` (FNV-1a over 32-bit words, fixed order) with format version and match header; bad bytes give an error result and never throw
- [x] 4. `src/host`: `SimHost`, `MainThreadHost`, `LocalTransport`, fixed-timestep accumulator (10 Hz, pause/1x/2x/4x, cap 8 ticks per frame), no shared object references across the interface
- [x] 5. CLI `npm run sim:run -- --seed N --ticks T`
- [x] 6. `e2e/goldens/sim-hashes.json` read by the Node test and by a Playwright test of `debug/sim.html`; a `worker_threads` test against the main thread
- [x] 7. Sensitivity tests (other seed, DebugPaint, one byte flip per state array, a deliberately non-deterministic step copy must fail the golden test, the Float64 canary `src/sim/canary.ts` equal in Node and Chromium)
- [x] 8. Docs: DECISIONS, ARCHITECTURE (SimHost, intent and turn flow), this list

ACCEPTANS
- [x] golden hashes equal in Node and Chromium at all 5 tick points; the sensitivity tests pass (including that the non-deterministic copy fails)
- [x] fast-check (500 runs): same seed + intents give the same hash; snapshot at tick k + remaining intents equals a straight run; worker run equals main thread; intent order inside a turn is resolved by the id tie-break
- [x] a test that replaces Math.random and Date with throwing functions during step() passes; the lint self-test passes
- [x] codec: round trip of 10 000 random intents; malformed bytes never throw out of step()
- [x] empty-world step at 1024x512: median <= `budgetMs(1)` in Node (value logged)
- [x] `npm run verify` green

Result (this sandbox): `npm run verify` green: typecheck, lint, 587 unit (589 after the last two codec tests, `verify:fast` re-run green), 12 perf, 58 e2e (the 52 of M02 plus 5 in `e2e/sim.test.ts` plus 1 added case in `e2e/artifact.test.ts`), e2e 140 s. Golden hashes (seed 1, 128x64, 4 seats, debugIntents): tick 1 `0640c052`, 10 `f244c731`, 100 `d3f47242`, 1000 `97dd75dc`, 6000 `cdb62bcd` (changed by the fix pass below, D67), world hash `ffa491cd`, canary `50a514cc`; identical in Node, Chromium (also through MainThreadHost), a worker_threads Worker and the Artifact-style sub-folder build. Empty-world step at 1024x512: median 0.6-0.8 microseconds in Node (budget `budgetMs(0.05)` after the fix pass, D70). `npm run build` and `npm run artifact:pack` run: `debug/sim.html` is part of the build (24 files, 15.40 MB), the packer accepts it. Reproduce: `npm run sim:run -- --seed 1 --ticks 6000 --canary`.

Fix pass after the independent audit (six major findings; D67 to D70 in `docs/DECISIONS.md`)
- [x] F1. Wide-value serialisation test (owner 0..255, stamp/tick/rejects above 2^16, seeds at both ends, 255 seats) and `createState` with exactly 255 and 256 seats; six truncating mutations now fail
- [x] F2. Second seed pinned (`alt` in `e2e/goldens/sim-hashes.json`, Node and Chromium), `mapHash` and script differ between seeds
- [x] F3. Perf budgets tightened: empty step `budgetMs(0.05)`, 64 paints `budgetMs(0.2)`; a full owner scan or `owner.slice()` in `step()` fails them
- [x] F4. Golden script has same-cell conflicts (cross-seat, same-seat); adversarial variant (reversed lists, repeated (seat, id)) pinned in Node and Chromium; copies of step without sort / without dedupe fail the golden
- [x] F5. `Snapshot.resume` (id counters and scheduled turns) and `MainThreadHost.resume(snapshot)`; snapshot at k then resume equals the golden
- [x] F6. `StateDiff.fullOwner`: a frame whose outbox overflowed carries the whole owner array
- [x] `npm run verify:fast` and `npm run verify` green after the fix pass: 628 unit, 12 perf, 59 e2e (e2e 132 s). New golden hashes (seed 1): tick 1 `0640c052`, 10 `f244c731`, 100 `d3f47242`, 1000 `97dd75dc`, 6000 `cdb62bcd`; seed 2 world `af5c3682`, ticks 10/100/1000 `b92fd9fe` / `6928c8cd` / `356f584c`

### M02 Wow 1: den stiliserade 3D-jorden (GATE) - built, audited and fixed; pushed to PR #1 and published in the Artifact as version 3 (`npm run verify` green: 376 unit, 9 perf, 52 e2e); gate passed: the user reported 30-50 fps and a good picture on a real GPU; waiting for the squash merge (the real-GPU tuning of the night lights, atmosphere and glint is in `docs/BACKLOG.md`)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (still the initial commit: M00, M00b and M01 are NOT merged, they live on this branch and in draft pull request #1; the "M01 is merged" precondition was treated as satisfied by the orchestrator's instruction). `npm ci && npm run verify:fast` was green at the start (279 unit tests).

The work is split over sessions. Checkpoint A (this session): items 1, 2 without night lights, 5, 6, 7, the quality tiers of item 8, the test tier and `?test=1` hooks of item 9 with the fx clock, WITHOUT goldens. Checkpoint B (next session): item 3 (ocean, atmosphere, terminator), item 4, the rest of item 8 (`?perf=1` overlay), item 10, then last: stars, night lights, sun glitter, and only then the 6 goldens (committed ONCE) and the night / limb / glitter pixel checks. The orchestrator owns pushing, the draft PR and the Artifact publication.

GÖR, Checkpoint A
- [x] A0. Preflight (merge SHA recorded, verify:fast green), this checklist
- [x] A1. Textures (item 1): height R8 4096x2048, bathy R8 2048x1024, country (nearest, NoColorSpace, flipY false, unpackAlignment 1), sim class layer, all `DataTexture`s from the raw bytes; texel-readback helper (small render-to-target pass)
- [x] A2. Globe (item 2, no night lights): lat/lon grid, vertex displacement from the height texture (x12, sqrt decode from meta.json), derivative flat shading, hypsometric colours with snow, biome tone from the class layer, coast colour from bathymetry, coast shaded from the mask in the fragment shader
- [x] A5. Shader modules under `src/render/shaders/` (terrain now; ocean and atmosphere modules belong to B), GLSL ES 3.00 via ShaderMaterial, `gl_FragColor`, no own `out vec4`
- [x] A6. Camera (item 6): orbit with inertia, zoom anchored at the cursor, tilt limit, pole-safe up vector, zoom limits, mouse and wheel
- [x] A7. Picking (item 7): ray vs sphere refined against the displaced heights (CPU copy), lat/lon to sim cell, hover tooltip (country, terrain class, height in metres)
- [x] A8. Quality tiers test / low / medium / high in `src/render/quality.ts`; `?quality=` selects, `?test=1` forces test
- [x] A9. Test hooks `setView`, `render`, `project`, `advance`; fx clock `src/render/clock.ts` (`fxNow`, `advanceFx`, `setFxTime`) and the "no other clocks" unit test; six canonical views defined (no goldens in A)
- [x] A10. Constants in ONE config file in `src/render` (exaggeration, sun)
- [x] A11. Screenshots per shader function looked at; docs: ARCHITECTURE index, DECISIONS, this list kept current
- [x] A12. Checkpoint A: `npm run verify:fast` green, new unit and e2e tests green, committed locally

ACCEPTANS, Checkpoint A (the tests that exist after this session)
- [x] test tier: triangles <= 150k and draw calls <= 30 in the globe scene; zero console errors
- [x] 6 canonical views: not blank, pairwise different; Himalaya luma variance above a flat control (exaggeration 0)
- [x] picking: camera at 59.3N 18.1E gives Sweden at the screen centre; a ray at Everest (27.99N 86.93E) hits the right cell within 1 cell
- [x] data textures: texel readback equals the source bytes; camera matrices: no NaN, stable at the poles, zoom limits held
- [x] fx clock: frozen in test mode, stepped only by `render` / `advance` / `setView`; unit test that no other clock is created in `src`

Notes for Checkpoint B (read before starting)
- Look at `src/render/config.ts` (all tunables), `src/render/shaders/terrain.ts` (the one shader), `src/render/globe.ts` (renderer, scene, uniforms are in `src/render/terrainMaterial.ts`), `src/app/globeApp.ts` (boot, mouse, hooks) and `docs/DECISIONS.md` D31-D38.
- Ocean, atmosphere, stars, night lights and glitter are NOT started. The terrain shader paints water itself from bathymetry (no Fresnel, flat sphere normal); B3 (later files) should add the ocean and atmosphere shader modules (`src/render/shaders/ocean.ts`, `src/render/shaders/atmosphere.ts`) and either compose the ocean functions into the terrain shader or draw water in a second pass; keep the test-tier budget (<= 150k triangles, <= 30 draw calls) and update the smoke e2e `drawCalls` expectation of `e2e/smoke.test.ts` (it says exactly 1, which is true only while the globe is the only draw call; justify the change in DECISIONS).
- The default `?test=1` sun (`DEFAULT_START_TIME`, 67 degrees west of the view) is what keeps the M00 smoke threshold (left/right luma ratio 1.255 against 1.15) true; a softer terminator or an atmosphere may push it below 1.15: move the sun further west rather than loosening `THRESHOLDS`.
- The six canonical views exist in `src/render/views.ts` (`CANONICAL_VIEWS`) and are rendered and checked (non-blank, pairwise different, Himalaya relief) in `e2e/globe.test.ts`, with PNGs in `test-results/shots/view-*.png`. No goldens yet: commit them ONCE, last.
- `__test.tooltip`, `__test.readTexels` (the country texture is only uploaded when read back; B4 makes the shader sample it), `__test.setExaggeration` exist for tests. `parseSceneParams` is a stop-gap: B10 replaces it by the unified hash parser and must keep `scene` and `quality` working.
- `tests/fxClock.test.ts` has an allow-list of files that may read real time; the perf overlay (B8) belongs there with a reason, or its numbers must come from `performance` in a file added to the list.
- A scratch HTML page in the repo root (untracked, delete it afterwards) that imports the globe module through Vite is the quickest way to look at the medium and high tiers in SwiftShader; `?test=1` forces the test tier.

GÖR, Checkpoint B and the last step (second session)
- [x] B3. Ocean (animated wave normals frozen through the fx clock, Fresnel with a sky colour), atmosphere (single-scattering march: terrain haze plus the back-face additive shell), terminator (soft day factor, warm twilight band), then stars, night lights (2048x1024 light texture from `public/data/cities.json`), sun glitter (broad and tight lobe)
- [x] B4. Country borders (neighbour comparison of the id raster, sea never counts) and the palette LUT
- [x] B8. `?perf=1` / `#perf` overlay: renderer string, fps (mean and p95), renderer.info (calls, triangles, geometries, textures), texture MB, button "Kopiera rapport"
- [x] B10. Dev panel `src/app/devpanel.ts` (F2 and the corner button, visible in 390x844), `registerDevMode`, ONE parser `src/app/params.ts` with the hash grammar and `hashchange` restart, `src/ui/report.ts` `showReport(json)`, PREVIEW.md table
- [x] B-last. Goldens for the 6 views (committed once) and the night / limb / glitter / city-light pixel checks
- [x] Docs: ARCHITECTURE index and "Budgetar", PREVIEW.md, DECISIONS D39-D47, BACKLOG
- [x] `npm run verify` green (typecheck, lint, 356 unit, 9 perf, 48 e2e; an earlier version of this line said 47), `npm run build && npm run artifact:pack` run (21 files, 15.38 MB in `artifact/`, 10 MB of it the probe packs); the orchestrator pushes (PR #1 exists, no new PR) and republishes the Artifact by the procedure in `docs/PREVIEW.md`

ACCEPTANS, Checkpoint B and last step
- [x] city light pixels (Tokyo 214 against sea 24, New York 234 against 24, Stockholm 152 against 25; needs >= sea + 25), night view (mean luma 26.3 against day 105.5, ratio 4.0 > 3; 8068 pixels above 150), limb pixel 124 against space 0, glitter pixel 254.8 against sea mean 55.9
- [x] goldens by the golden rule for all 6 views (`e2e/goldens/globe-*.png`); two renders per view identical
- [x] Dev panel and report e2e (F2, `perf` toggles the overlay, `#perf` equals `?perf=1`, a hash change restarts the mode without a reload, the corner button is visible and tappable in 390x844, `showReport` with a refused clipboard shows the textarea and a working Download link)
- [x] borders: only land-against-land pixels change when the border strength goes 0 to 0.34, coast against sea never
- [x] JS bundle <= 300 KB gz (main chunk 151.4 kB gzip, all JS about 159 kB); `npm run verify` green

### M02 fix pass (after the independent audit: five small findings, nothing else)

GÖR
- [x] 1. Pole tear: the pole rows read one common height (`POLE_HEIGHT_U`, `heightLookupUv`, vertex shader and `HeightField`), the baked polar cap no longer makes radial streaks in the shading (`POLAR_FADE_*`); unit test on the real mesh and packs, e2e ring test, before / after screenshots at lat -90 and 90, distKm 2500 (looked at)
- [x] 2. Tooltip: `src/render/describe.ts` decides land or sea from the render raster, the sim grid gives class and country, with the nearest-land-cell rule at coasts; `tooltipText` never prints Hav with a positive height; `tests/tooltip.test.ts` extended (Sydney, New York, Rio, open ocean, inland, a scan of 2.1 M positions)
- [x] 3. Docs: Roadmap line of `docs/ARCHITECTURE.md`, e2e count and timing line here, Known issues and `docs/BACKLOG.md`, D48-D50
- [x] 4. Clock guard: `Date(`, `performance.timeOrigin`, `.timeStamp`, `requestIdleCallback`, `setImmediate`, CSS `transition` / `animation`, `@keyframes`, `.animate(` added to `tests/fxClock.test.ts`, with a self-test of the tokens
- [x] 5. Phone layout: the perf overlay clears the Dev button (16 px) and steps aside while the open Dev panel would cover it (`src/ui/events.ts`); e2e in 390x844 and 960x540, screenshot looked at

ACCEPTANS
- [x] `npm run verify` green after the fix pass: typecheck, lint, 376 unit, 9 perf, 52 e2e (the 48 of M02 plus 2 pole and 2 phone layout tests), 155 s; the six `e2e/goldens/globe-*.png` match with 0 px differing, no golden was updated
- [x] `npm run build && npm run artifact:pack` run (file count and size in the reply of the session); the orchestrator republishes the Artifact

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

- M04 Territory sim, PART B (conquest, scenario CLI, calibration, final tests and goldens; Part A is built and committed; read the Part B checklist and notes under Now, `docs/ARCHITECTURE.md` section "Sim flow" and D71-D81 first).

## Known issues

- M01: the Joerd/Mapzen attribution page (the exact list of elevation sources behind Terrarium) could not be reached; `CREDITS.md` and `docs/ASSETS.md` carry a general line (Mapzen terrain tiles, USGS SRTM, NOAA ETOPO1 and others). Replace it when the page is reachable.
- M01: the polar caps beyond 85.05 degrees are synthetic (smoothed copy of the nearest real row); streaks are visible in the height map. Antarctica is Ice anyway.
- M01: 15 countries use a "most central cell" as capital because Natural Earth has no `Admin-0 capital` place in their polygon (Greenland, Israel, Western Sahara and small islands); 58 countries have no land cell at all (see `public/data/overrides.json`).
- M01: the Forest/Plains rule is by latitude and a hash only, so the Sahara shows a few forest cells; cosmetic (backlog).
- `docs/CHARTER.md` is verbatim from the prompt; in section 7 the "User lines" and "User's own files" bullets sit on one line (a newline is missing in the source text). Not changed because the charter must stay word for word.
- No real-GPU measurement exists; everything is SwiftShader.
- M02 A: the whole-Earth view shows dark green Forest patches in the Sahara and Arabia (baked biome rule, see `docs/BACKLOG.md`); the north pole shows the synthetic polar streaks.
- M02 B: everything was judged in SwiftShader screenshots only (no GPU): the colours of the atmosphere (`ATMOSPHERE_*`), the glint strength (`OCEAN_SPEC_*`), the night light gain (`LIGHTS_GAIN`) and the wave size are the first things to tune on a real GPU (all in `src/render/config.ts`). The border line is stair-stepped at 10 km when zoomed to the limit (backlog).
- M02 (fixed in the fix pass): the south pole tore into several radii (dark streak along the 180 degree meridian at lat -90, distKm 2500) and the north pole showed radial spokes; see D48. What remains: the cap geometry beyond 85.05 degrees still has the radial ridges of the synthetic polar rows (backlog).
- M02: the night lights read as large saturated blobs and their brightness varies with the zoom (`LIGHTS_GAIN` in `src/render/config.ts`, footprint in `src/render/nightLights.ts`); tune on a real GPU (backlog).
- M02: dark axis-aligned Forest squares in the Sahara and Arabia and a straight Sahel latitude edge come from the M01 latitude-and-hash biome rule in `tools/bake/classify.ts` (backlog: aridity mask or sub-cell noise in the bake, or a low-frequency detail mask in the biome shader).
- M02: at `DIST_MIN_KM` 220 with `TILT_MAX_DEG` 72 the camera is below the exaggerated peaks over Everest and the picture is featureless (backlog; M08 replaces the camera).
- M02: the test-tier mesh shows a coarse diagonal facet at 500 km zoom (M07 LOD replaces it).
- M02: the coast band of one render pixel (10 km) has a surface height above 0 but is drawn partly as sea; the tooltip calls it land there (consistent with the height, D49), so the elevation printed at such a point is the mean of the land pixels around it and can be higher than the surface under the cursor (Rio: 166 m against 18 m).
- M02 B: the Dev button is hidden in `?test=1` (so goldens stay clean); `#devbtn` shows it there.
- M03: the Float64 canary is equal in Node and Chromium, but both are V8; Firefox / Safari were not available (BACKLOG).
- M03: the state hash is 32 bits (BACKLOG: second lane for lockstep desync checks in M26).
- M03: `step()` draws once from the generator every tick although M03 has no rule that needs it (it keeps the stream position in the hash from tick 1); M04 keeps the call.
- M03: the first two turns of every match are empty by construction (T + 2 input delay).
- M00b: the data manifest format of M01 is assumed (name to file relative to the data folder, enc defaults to raw), see D17 in `docs/DECISIONS.md`. M01 must keep it or change the pack script.
- M00b: confirmed in practice: the user opened the Artifact (M02, version 3) and saw the globe at 30-50 fps.

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

M02 Checkpoint A (same sandbox, test tier 256x128 mesh, 960x540, SwiftShader):

| measure | value |
|---------|-------|
| first frame (page start to end of first render, incl. loading and inflating the packs) | about 510 ms warm (1.1 s on a cold Vite start) |
| render call / page screenshot | about 40-65 ms / 120-250 ms |
| draw calls / triangles / textures / texture memory | 1 / 65 536 / 3 (4 once the country texture is read back) / 18.5 MB |
| medium tier (512x256) / high tier (1024x512) at 960x540 in the live loop | 262 144 / 1 048 576 triangles, about 9 fps / 0.5 fps in software (not asserted) |
| JS bundle main chunk | 556 kB raw, about 140 kB gzip (limit 300 kB) |
| leak test (60 renders at 320x180) | 0.03 MB |
| `npm run verify:fast` / full e2e project | about 15 s / about 60 s |

M02 Checkpoint B and last step (same sandbox, test tier 256x128 mesh, 960x540, SwiftShader):

| measure | value |
|---------|-------|
| first frame (page start to end of first render, incl. packs) | 611-644 ms (logged by smoke and globe e2e, not asserted) |
| render call / page screenshot | about 91 ms / 420 ms for the first frame in a fresh page (smoke); later renders 3-100 ms |
| draw calls / triangles / textures / texture memory | 3 (stars, globe, atmosphere shell) / 74 560 (65 536 + 9 024) / 6 / 20.5 MB |
| live loop at 960x540, tier low | about 6 fps in software (the perf report of the e2e run: mean 5.9, p95 3.0), not asserted |
| JS bundle | main chunk 582.6 kB raw, 151.4 kB gzip (limit 300 kB); all JS about 159 kB gzip |
| goldens | six `e2e/goldens/globe-*.png`, 264-422 kB each, 0 px differ on re-run |
| night lights (Tokyo / New York / Stockholm) city pixel against sea neighbour | 214 / 234 / 152 against 24 / 24 / 25 |
| night view mean luma against the same view in daylight | 26.3 against 105.5 (ratio 4.0), 8068 pixels above luma 150 |
| limb pixel against space / glitter pixel against the sea mean | 124 against 0 / 254.8 against 55.9 |
| borders | 1.09 % of the pixels change with the border switch on, all at land-land borders |
| `npm run verify` | about 2.7 min (unit 10 s, perf 2 s, e2e 137 s) |
| final scene (smoke e2e, fix pass verify) | first frame 594 ms, load 498 ms, render 100 ms, screenshot 376 ms (logged, not asserted); the globe e2e logs first frame 797 ms |
| `npm run verify` after the fix pass | 155 s (unit 11.8 s with 376 tests, perf 1.9 s with 9, e2e 132 s with 52) |

M03 (same sandbox, Node 22.22):

| measure | value |
|---------|-------|
| empty-world step at 1024x512 (median of 101) | 0.6-0.8 microseconds (budget `budgetMs(1)` about 1.0-1.1 ms) |
| step with 64 DebugPaints at 1024x512 | 49-59 microseconds |
| `hashState` / `serialize` at 1024x512 | 1.9-2.3 ms / 5.7-6.2 ms |
| golden run, 6000 ticks of 128x64 | about 7 ms |
| `npm run verify` | unit 16 s (589 tests), perf 2 s (12), e2e 140 s (58) |
| `debug/sim.html` chunk | 12.5 kB raw, 5.1 kB gzip (main chunk 584 kB raw, 152 kB gzip, +1.6 kB for the Dev panel entry) |

M04 part A (same sandbox, Node 22.22, real world, 32 seats):

| measure | value |
|---------|-------|
| load pack + `createSimWorld` / `createWorldState` | 120-130 ms / 17-31 ms |
| Spawn (197 cells) | 0.3-0.5 ms |
| `economyTick` with 32 owners / empty step with 32 owners | 8-16 us / about 8 us |
| `serialize` / `deserialize` / `hashState` | 15 ms (4.72 MB) / 23 ms / 5 ms |
| `npm run verify:fast` | about 24 s (751 unit tests) |

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

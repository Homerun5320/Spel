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
| M04 | (set after the squash merge) | Territory sim: SimWorld and grid on the real 1024x512 world, `src/sim/rules.ts` as the one balance file with std-cell units and `docs/BALANCE.md`, economy (cap, regeneration, gold, tribes), Spawn, conquest (Attack / CancelAttack, frontier bags, terrain-aware price, mutual attacks, enclaves), `npm run sim:scenario`, solo calibration (K 80 -> 103), work counters and perf tests. No visible change; the Artifact is NOT republished. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (still the initial commit; M00 to M03 live on this branch and in draft pull request #1) |
| M05 | (set after the squash merge) | Wow 2, the first playable conquest on the globe: SimView and snapshots, ownership texture, spawn phase and click-to-attack, HUD with i18n (sv, en), start screen, AI v0 (5 nations) and 20 tribes. Published in the Artifact as version 5 (version 4 was the early Part A build). GATE: the user played it and reported "Stadiga 30 fps" (steady 30 fps on a real GPU at the default medium quality) and no other complaint; M07 onwards must not regress the FPS at the default quality. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged yet) |
| M06 | (set after the squash merge) | Menu: real country or own nation with a procedural flag, fair start (exactly K = 197 cells for every nation), Skirmish regions, search in two languages, flyTo, home land and traits, prefs, createMatch. Published in the Artifact as version 6. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged yet) |
| M07a | (set after the squash merge) | Terrain LOD A (user gate): the terrain is a quadtree of instanced chunks with skirts (one draw call, hard chunk cap per tier), the territory and the selection outline on it with finer organic border warp, a terrain-aware orbit zoom down to 1 km above the ground, `#view-alps-valley` and `#view-himalaya-valley`, six contact-sheet goldens. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged; M00 to M06 live on this branch and in draft pull request #1) Published in the Artifact as version 7. |
| M07b | (set after the squash merge) | Terrain LOD B: ridged-noise detail by relief with TS and GLSL twins (heightAt, octavesForLevel, readback probe), coast rule, slope rock, snow line by height, latitude and slope, forest tone, shore foam, softer night lights, detail contact-sheet goldens. Published in the Artifact as version 9. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged yet) |
| Tempo | (set after the squash merge) | Pace pass after the user's feedback ("too slow", "needed 4x"): conquest K 123 to 420, troop regeneration about 3x, AI war grace and share cap, `npm run sim:pace` report tool, ENGINE_VERSION 6, solo band moved with the reason "user feedback: too slow". 1x now feels like the old 4x (a 197-cell disc in about 55 s, 500 cells in about 106 s at troop parity and 100 % commitment). Published in the Artifact as version 8. |
| TestSpeed | (set after the squash merge) | Infrastructure pass, no game change (D144): `npm run verify` from about 14:50 to 7:51 (7:26 to 7:53) on the 4-core sandbox (e2e project 802 s to about 390 s): `settle` test hook (one draw for n frames), shared browser context per file, sleeps replaced by conditions, live-page waits by timer, typecheck + lint + unit side by side, e2e on 3 workers, heap / leak / time tests in the serial e2e project, `scripts/verify.mjs`; LOCAL GPU MODE (`LOCAL_GPU=1`, `npm run verify:local`, `docs/LOCAL.md` in Swedish for the user's Windows PC, untested on a real GPU); test inventory script (149 cases / 918 `expect(` before, 150 / 926 after). Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged). No visible change; the Artifact is NOT republished. |
| M08 | (set after the squash merge) | RTS camera, ground queries and the performance scene (USER GATE): `src/render/transforms.ts` (cells, `groundHeightAt`, `pickGround`), the camera mix of the globe arcball and a local-tangent RTS camera, the input mode stack, flights with an altitude and the bookmarks (part A, D155); the performance scene `?scene=perf` with its report section, JSON Schema, GPU timer and refresh / cadence / capped verdict, six height goldens, `verify.mjs --shard` and per-file e2e times (part B, D156). The user plays the camera and runs `#scene-perf` on a real GPU and sends the copied report. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged yet). Published in the Artifact as version 10 (clean-clone `npm run verify` green on a69fe75, 13 min 17 s; the user's camera feedback on version 9 (globe cropped when zoomed out, camera hunting over textured mountains) is to be checked against this camera). |
| AutoTier-1 | (set after the squash merge) | The default tier follows the graphics card class (`src/render/gpuClass.ts`, D159): integrated and software cards start on `low`, capable and unknown on `medium`; a closable honest tip on the start card; the perf report gets `gpuClass` and `tierSource`. Not yet published: the orchestrator republishes the Artifact. |
| CamFix | (set after the squash merge) | User feedback on version 9 ("only the upper part of the world when zoomed out", a heavy camera over mountains): the maximum distance follows the window shape, the tilt is eased out as the distance grows so the whole globe is in view and centred in every window (`src/render/fit.ts`, D158), the mountain camera measured against v9 (M08 already followed the held height and was smoother than v9: calm over the Alps, a dive of up to 79 % at the Himalaya wall; pinned). Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged). Not yet published: the orchestrator republishes the Artifact. |
| AutoTier-2 | (set after the squash merge) | Adaptive resolution (D160): a pure regulator lowers the drawing-buffer scale in steps (1, 0.85, 0.72, 0.6, 0.5) when frames are slow, raises it when they are fast, then steps the chunk density; `#adapt-0` / `#adapt-1`, Dev panel switch, F3 line, report field `adaptive`. Published in the Artifact as version 13. |
| CamFix-2 | (set after the squash merge) | Camera fixes from the independent audit: the shown tilt is rate-limited (no pop when a flight is grabbed or on a wheel spin), a right drag keeps the stored tilt, the start view is fitted in tall windows, honest mountain wording; regression fix of the wheel zoom (shown tilt no longer clamps a stored tilt above 90). Published as version 14. |
| M09a | (set after the squash merge) | Buildings in the sim, part a: structure table (capacity 4096, free list, rebuilt cell index), Build / Upgrade / Delete intents, validateBuild in `src/sim/public.ts`, placement rules, prices and build times. No visible change (version 12). |
| M09b | (set after the squash merge) | Buildings in the sim, part b: effects of City / Factory / Port / Defense Post, trade income, conquest transfers or destroys structures, embargo flag (FORMAT_VERSION 7), AI build move, scenario economy report. Version 13. |
| M09c | (set after the squash merge) | Level effects for Factory and Port (10x income cap kept), AI economy lever (solo band factor 1.02), AI upgrades. Version 16. NOTE: ENGINE_VERSION was not bumped (audit finding, fixed in the audit-fix slice). |
| M10-1 to M10-4 | (set after the squash merge) | Buildings on the globe: snapshot structure table, one instanced layer with six procedural models (City, Factory, Port, Silo, SAM site with a turning dish, Defense Post), placement mode with ghost (keys 1 to 6), build bar, toasts, selection panel with Upgrade / Delete, range rings, night lights, far icons. Versions 14 to 16. |
| Fix-Sim | (set after the squash merge) | Audit-1 fixes in the sim, host and AI (Build refused in the spawn phase; leftovers in `docs/BACKLOG.md`). Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged; pull request #1 is a draft) |
| Fix-UI | (set after the squash merge) | Audit-1 fixes the player sees: build UI reasons, ghost, panels, toasts. Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| Polish-1 | (set after the squash merge) | Spawn phase in the build UI, night readability, selection ring on slopes, compact GPU tip, resize while zoomed out. Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| Districts-1 / 2a / 2b | (set after the squash merge) | City districts (Housing, Market, Barracks, Walls) in the sim, the city view (DOM) and the districts drawn on the city. Branch merge commits bf8fb13 and 3b912a3. Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| M18-1 | (set after the squash merge) | Match end in the sim: win rules, anti-snowball discount, elimination, statistics (ENGINE_VERSION 11, FORMAT_VERSION 9). Branch merge commit e4671cf |
| M11a | (set after the squash merge) | Mountain-aware radar LOS masks, composite coverage, exposure queries. Stop rule fired and was ACCEPTED by the owner (DECISIONS M11b point 10). Branch merge commit 73fbeee |
| M18-2 | (set after the squash merge) | Match flow UI: win conditions in the setup, pause menu on Escape, result screen, elimination and spectating. Branch merge commit aaf0b17 |
| M11b | (set after the squash merge) | Air navigation grid, `planRoute`, `scoreLz`, `debug/viewshed.html`. Branch merge commit 453905d |
| Sim-Growth | (set after the squash merge) | Denser placement per type, City levels 1 to 10, five district slots (ENGINE_VERSION 12, FORMAT_VERSION 10). Branch merge commit 916c2fb |
| Look-1 | (set after the squash merge) | Fast city view, City size close up, style Gammal / Modern, level display. Branch merge commit 7cfad4b |
| Sim-Levels2 | (set after the squash merge) | Unlimited levels (hard cap 999), one price rule (base x level), gentle level curves (`src/sim/levelCurves.ts`), ENGINE_VERSION 13, FORMAT_VERSION 11. Branch merge commit 5f49f67 |
| Look-2 | (set after the squash merge) | Saturating level bands, capped footprint, unlimited level display, visual gold inflation (`GOLD_DISPLAY_FACTOR`). Branch merge commit e544a40 |
| Integrations | (set after the squash merge) | Integration Sim-Growth + Look-1 and Integration Sim-Levels2 + Look-2: the UI and render follow the sim numbers, goldens re-pinned once after looking. HEAD 04eaba8 |
| M12a-1 | (set after the squash merge) | Helicopter and beachhead tables, ProduceHeli, the fleet cap, Los / Nav inside `step` (headless). Branch merge commit c24f0e8. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged to main; pull request #1 is a draft). |
| M20a-lite | (set after the squash merge) | Hotkey registry, help overlay `?`, command resolver, top bar with a win meter. Branch merge commit 6b1a032. Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| M12a-2 | (set after the squash merge) | LaunchHeli, RecallHeli, the flight, fuel and the return (headless). Branch merge commit 6b2ab7a. Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| M13a-1 | (set after the squash merge) | The helicopter is visible: layer, Factory build button, fleet gauge. Branch merge commit a81d4b0. Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| M12a-3 | (set after the squash merge) | The landing, the beachhead and the cut-off cluster (headless). Branch merge commit 506be54. Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| M18c-1 | (set after the squash merge) | Diplomacy in the sim and the AI: truce, alliance, embargo. Branch merge commit 198f38a. Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| M13b | (set after the squash merge) | Deploy mode, landing zone preview and route preview; merged with the round 16 sim tracks, treaty landing ban. Branch merge commit 719b212. Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| M18c-2 | (set after the squash merge) | Diplomacy panel, proposals, badges, a livelier AI negotiator (ENGINE_VERSION 18, FORMAT_VERSION 13). Branch merge commit c672abe. Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| Fix-3A1 / 3A2 / 3B / 3C | (set after the squash merge) | Audit 2 fixes: sim test holes (b3e59f4), radar reach / navigation / AI limits / MatchView (8985b22), visible render, app and UI faults (b8d8503), docs and hygiene (51e30b3). Previous merge SHA: f29121a8d1607ca169e6675b5f22a52d76c42ef7 |
| Fix-4 (pågår) | (set after the squash merge) | Audit 3 fixes, four parallel slices (4A1, 4A2, 4B, 4C: docs split into `docs/arch/`, status docs and downstream decisions); not merged yet, set when the orchestrator merges them. Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged to main; pull request #1 is a draft). |

## Now

### Fix-4C: docs that lied and were too large, downstream decisions (audit 3; docs only plus the docs test; no Chromium; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)

GÖR och ACCEPTANS:

- [x] ARCHITECTURE.md split: one short row per module (under 450 characters), full rows and the long sections moved verbatim to `docs/arch/<area>.md`; the file is about 40 kB (was 199 kB).
- [x] `tests/docs.test.ts` checks the arch files too, caps ARCHITECTURE.md (46 000 bytes, rows 450 characters) and compares the version line with the code.
- [x] CLAUDE.md Read order point 3 points at the index and `docs/arch/`.
- [x] PROGRESS.md: Done rows added, finished passes moved from Now to the end of Archive word for word, Next rewritten, version line follows the code (ENGINE 18, FORMAT 13).
- [x] DECISIONS.md: blocks "Fix-4C" and "Audit 3 downstream decisions (for M12b, M14, M17, M20b)"; BACKLOG.md: the proposed CHARTER change.
- [x] `npm run verify:fast` green (see the result in the Fix-4C block of `docs/DECISIONS.md`).

### Fix-4A1: audit 3, the helicopter, beachhead and treaty rules (headless sim, ENGINE 19; one slice in its own worktree; the orchestrator owns merging, pushing and the Artifact)
- [x] [0.0] An eliminated seat's helicopters are scrapped in the elimination tick; a landing for an eliminated owner does nothing.
- [x] [0.1] A landing that touches the owner's land makes no beachhead; a cluster with the capital cell is established.
- [x] [0.2] Tests for the neighbour guard and the page-side `validateLaunchHeli` treaty refusal.
- [x] [0.6] `REJECT_HELI_TABLE_FULL` 57 and `REJECT_HELI_BEACHHEAD_FULL` 58 (texts sv and en); comment and `BEACHHEAD_CAPACITY` fixed.
- [x] [1.10] Allied Ports trade at `TRADE_ALLIANCE_PCT` 125 %.
- [x] [1.1] to [1.4] Mutation killers (table in DECISIONS, block Fix-4A1).
- [x] ENGINE_VERSION 19 once; sim-hashes.json and match-hashes.json recomputed once. FORMAT unchanged (13).
- [x] `npm run verify:fast` (see DECISIONS Fix-4A1 for the result).

### Fix-4A2: audit 3, deserialize guards, curve pins, AI diplomacy tests (headless, no rule change, ENGINE_VERSION and FORMAT_VERSION unchanged; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)

- [x] 0.3 One test per guard of the air and diplomacy blocks (`tests/sim/fix4a2Forged.test.ts`)
- [x] 0.4 stateTick / landTick / readyTick, embargo cross check, eliminated consistency refused
- [x] 0.5 `no-occluders` for airborne helicopters without `maxElev`
- [x] 1.0 Exact level curve tables (`tests/sim/levelCurveTable.test.ts`)
- [x] 1.5 AI diplomacy tests in constructed positions (`tests/ai/diplomacyPositions.test.ts`, `tests/ai/diplomacyThresholds.test.ts`)
- [x] 1.9 Upper payback bands and the REJECT_DIPLO pin in the driver test
- [x] 0.7 (partly) diplomacy side effects (`tests/sim/fix4a2Misc.test.ts`); heli mutants wait for Fix-4A1
- [x] 2.10 `tests/helpers/saveLayout.ts` replaces the hard-coded tail arithmetic
- [x] DECISIONS "Fix-4A2" with the mutant tables, BACKLOG, ARCHITECTURE row
- [x] `npm run verify:fast` green (typecheck, lint, unit)

### Fix-4B: the beachhead is shown and explained, the deploy mode stops making garbage, the test holes of the app and UI layer (audit 3; render, app, UI and one small read view in the sim; one slice in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Previous merge SHA: nothing of this branch is merged (pull request #1 is a draft); base commit c672abe (M18c-2).
GÖR
- [x] 1. [2.1] `BeachheadView` in `SimView` (`src/sim/view.ts`, exported by `src/sim/public.ts`, pinned in `tests/ai/boundary.test.ts`), the host snapshot, signature and mirror, the pulsing ring in the existing ring mesh (no new draw call), the count-down chip in the top bar, the two toasts, `docs/PREVIEW.md` 17ao / 17as rewritten, unit tests and `e2e/beachhead.test.ts` with a picture
- [x] 2. [2.6] the deploy mode and the Factory panel stop allocating per frame (no pick under a resting camera, integer keys instead of strings, one reused model object, reused rows, no drawn list outside test mode), measured before and after in `e2e/deployAlloc.serial.test.ts`
- [x] 3. [1.6] the app layer faults (previewer, resolver, hotkeys, deploy mode): checked against HEAD, the one real fault fixed test first, the rest pinned with mutants
- [x] 4. [1.7] `tests/host/heliTransport.test.ts`: helicopter and diplomacy snapshot, signature, mirror, every pure function of `src/ui/heliInfo.ts` and `src/ui/diploReasons.ts`, both watchers
- [x] 5. [1.8] `cityFitFlight` computed by projection in `tests/app/cityFitProject.test.ts` (three window sizes and more), the vertical centring made exact
- [x] 6. [2.0] `PLAYER_FACING` in `tests/i18n.test.ts` discovers the files itself
- [x] 7. [2.5] the false gzip justification of M13b corrected in `docs/DECISIONS.md` and `docs/BACKLOG.md`
- [x] 8. Docs: DECISIONS "Fix-4B" (mutant table, allocation numbers), ARCHITECTURE row, PREVIEW 17ao / 17as, BACKLOG
ACCEPTANS
- [x] BeachheadView in SimView and host; ring with count-down and both toasts; the PREVIEW text is true
- [x] Deploy mode and Factory panel do not allocate per frame (measured before / after: +137 kB a frame over a selected Factory before, none after)
- [x] The app faults of item 3 fixed test first or shown to be right already; the helper tests of items 4 and 5 written with mutants
- [x] `PLAYER_FACING` finds files by itself
- [x] `npm run verify:fast` green; the touched e2e green (`beachhead`, `deploy`, `helis`, `cityOpenFit`, `deployAlloc.serial`)

### M12b: air defence against helicopters and raid statistics (headless sim and the scenario CLI; ENGINE 20, FORMAT 14; one slice in its own worktree; the orchestrator owns merging, pushing and the Artifact)

GÖR och ACCEPTANS:

- [x] `hostile(a, b)` (`src/sim/hostile.ts`): used by `planRoute`, `scoreLz` (`ENEMY_CITY_NEAR`), the route preview colour and the guns; one test per use that fails when it is replaced by "other seat" (`tests/sim/airDefense.test.ts`).
- [x] Defense Post: 15 dps within 12 cells, stacks, both modes; 7 s +-1 for one Post, half for two (test).
- [x] SAM: layer detection AND own mask AND range; salvo every 90 ticks, the first at once; 55 % from the splitmix32 mixer on (seed, tick, SAM id); Low never engaged behind the ridge, High 55 % +-3 over 10 000 rolls; out of range / destroyed / unfinished never fire; reverse visiting order gives equal hashes.
- [x] A shot-down helicopter: `HELI_DOWNED` with cause SAM / Post, load lost, no territory, troops after = before minus load.
- [x] Spatial hash (typed arrays) for Posts and SAM sites; `tests/airDefense.perf.test.ts`: 12 helicopters + 40 structures, median over 200 ticks after 50 warm-ups well under `budgetMs(0.5)`.
- [x] `heli-raid --fixture <alps|plains-sam|ridge-sam> --seed N` in the scenario CLI (`tools/sim/heliRaid.ts`): deterministic, a smoke test per fixture.
- [x] Scripted raids, 50 trials each, Low: alps 100 %, plains with two SAM sites 2 %, ridge 100 % (numbers in `docs/BALANCE.md` and the M12b block of `docs/DECISIONS.md`; no constant had to be tuned).
- [x] ENGINE_VERSION 20 once, FORMAT_VERSION 14 (the salvo clock `salvoTick` per structure row); sim-hashes.json and match-hashes.json recomputed once.
- [ ] Toast texts that say WHY (SAM / Post): not done, the page does not see the cause (BACKLOG "M12b").
- [x] `npm run verify:fast` green (see the M12b block of `docs/DECISIONS.md`).
### M18b-1: federations part 1 of 3, the baked provinces and sub-nations (headless tools and data; no sim, ai, render, ui or app change; previous merge SHA f29121a8d1607ca169e6675b5f22a52d76c42ef7)

- [x] Source: Natural Earth admin-1 50 m (same repo and commit as the rest of the bake), fetched through the allowed host raw.githubusercontent.com, file in `NE_FILES.admin1`.
- [x] Province raster (u16, sim grid) and province table, gaps flood-filled per country in a fixed order; tiny provinces flagged.
- [x] Candidates (`FEDERATION_MIN_AREA_CELLS`) and sub-nations (`FEDERATION_MIN_PROVINCE_CELLS`, `FEDERATION_MAX_SUBNATIONS`) with a u8 raster.
- [x] New pack `public/data/federations.bin.gz`; manifest and checksums get NEW rows, every old hash unchanged, `e2e/goldens` untouched.
- [x] `src/data/federations.ts` (pure parser, writer, `loadFederations`, `federationOfCell`, `membersOfCountry`, `isFederationCandidate`); not wired into the game.
- [x] `npm run bake` (also `-- --only=federations`), `npm run bake:check`, `npm run bake:federations` (report and `--png=`).
- [x] Tests `tests/bake/federations.test.ts` (round trip, corrupt packs, raster invariants, candidates, min size, determinism, old hashes pinned), mutants shown in DECISIONS.
- [x] Picture looked at (RUS, USA, CHN, IND, BRA); report in DECISIONS block M18b-1.
- [x] `npm run verify:fast` green (see DECISIONS M18b-1).
### M20a-2: nation labels and front arrows (host snapshot, render and UI; one slice in its own worktree; the orchestrator owns merging, pushing and the Artifact)

GÖR och ACCEPTANS:

- [x] AttackView in SimView (`SimView.fronts`, read-only, at most 16 attacks: id, attacker, target, a front cell and a direction), a host snapshot sent only when it changed (signature, refreshed every 10 ticks while an attack runs) and a ViewMirror copy; the new export in `src/sim/public.ts` and the pinned list of `tests/ai/boundary.test.ts`.
- [x] Nation labels: a pool of at most 32 DOM elements (name, troops, relation badge, owner colour), placed at the nation's centroid, faded by zoom, no overlap, never outside the screen, never behind the horizon, cleared when a nation dies; DOM written only on change.
- [x] Front arrows: one instanced draw call, at most 16 arrows, pulsing with the fx clock, own attacks brightest, faded out at globe distance.
- [x] Hotkey N (`Nationsetiketter`) in the registry, saved with getPref / setPref, default on; listed in the `?` overlay.
- [x] Tests: layout (40 candidates), arrows (count, gone when the attack ends, draw calls <= 1, no allocation), three window sizes, both languages.
- [x] Screenshots looked at (three zoom levels, arrows during an attack, both languages).
- [x] `npm run verify:fast` green; the touched e2e files green.

Result: see the block "M20a-2" at the end of `docs/DECISIONS.md`. Main-chunk gzip cap raised to 311 000 (`tests/portable.test.ts`). No golden changed (labels and arrows are off in a test page unless `labels=1`).

### M13a-2: helicopter effects, chase camera and far icon (render, app and UI; one slice in its own worktree; the orchestrator owns merging, pushing and the Artifact; previous merge SHA f29121a8d1607ca169e6675b5f22a52d76c42ef7)

GOR
- [ ] Effects layer `src/render/heliFx.ts`: shadow blob (1 draw call), particle pool (dust, ropes, smoke, flash; 1 draw call, <= 1 200 particles), beachhead flag (1 draw call); fx clock only, local seeded render RNG, no allocation per frame; test pages have it OFF unless `fx=1`.
- [ ] Far icon of an airborne helicopter (1 draw call), owner colour, fades when the model takes over.
- [ ] Chase camera: key H (stack entry `chase`), mode on the InputStack, Esc / H / drag / wheel end it, terrain clearance, toast `toast.heli.noneAirborne`; button `heli-chase` per flying row in the helicopter list.
- [ ] ETA in the list: not derivable (HeliView has no target table) -> BACKLOG.
- [ ] Tests: caps (draw calls, particles), allocation, chase, modal keys, sim hash unchanged, leak, e2e with screenshots.

ACCEPTANS
- [ ] Six effects visible on screenshots; caps held (<= 3 + 1 draw calls, <= 1 200 particles); 0 allocation per frame.
- [ ] Chase camera: clearance, ending, toast without helicopter, modal blocking.
- [ ] Sim hash unchanged by the effects; goldens unchanged (fx flag).
- [ ] Leak test green; both languages; verify:fast green; affected e2e green.

## Next

- Next slices: M12b (anti-air against helicopters and raid statistics; must follow "Audit 3 downstream decisions" in `docs/DECISIONS.md`), M13a-2 (effects, the H camera), M20a-2 (nation labels and front arrows), M18b (federations), M18d (technology), M18e (more building types and a city map), M13c (travel over land, sea and air), M14 and onwards.
- Audit 4 runs after five more pushes (audit 3 covered the pushes v22 to v26; its findings are worked through by Fix-4A1, 4A2, 4B and 4C, leftovers in `docs/BACKLOG.md`).
- Before the first CI run that matters: wire the three verify shards into `.github/workflows/ci.yml` (D156 (8)): a GitHub runner has 2 cores and `npm run verify` takes 12 minutes on 4.
- The USER GATEs of the camera (M08, CamFix) and the real-GPU tuning are the user's, see Known issues and `docs/PREVIEW.md`.

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

- M05 A: the territory look (`OWNER_*` in `src/render/config.ts`) was judged in SwiftShader screenshots at the test tier only; tint, inner glow, line width and warp are the first things to tune on a real GPU. The weak M02 country border lines still run through the middle of a territory.
- M05 A: only seat 0 acts until part C: the five AI nations and the 20 tribes do not spawn yet, so the match is empty apart from you (the leaderboard shows only you until then; a test paints the other seats to prove the ranking).
- M05 A: in the live page under software GL the frame rate is about 5 fps (the loop is unchanged); the sim cost per frame is small (see Result of Part A), the real-GPU frame rate is the user's gate.

- M05 B: judged in SwiftShader screenshots only: the HUD font and panel sizes, the colours, the start screen. The perf overlay (top left) can cover the banner during the first seconds when `#perf` is on from the start (BACKLOG). The Dev panel opens at the right and covers the leaderboard while it is open.
- M05 B: the F3 text overlay is now hidden until F3 is pressed (it used to show in the live page).
- M06 B: the leaderboard ranks by the cos-weighted land share, so a nation far from the equator starts below the others although every seat holds the same 197 cells (D124, backlog).
- M06 B: everything of the menu was judged in SwiftShader screenshots (960x540, 1920x1080, 390x844) and with a simulated phone viewport only; the feel of the flight, the font sizes of the panel and the touch behaviour need a real screen (the gate is the user's play session).
- M06 B: `npm run verify` takes about 8.5 minutes in this sandbox (unit 45 s, perf 5 s, e2e 448 s, 123 s of it `e2e/setup.test.ts`; total 8 min 33 s measured); the budget in CLAUDE.md is 8 minutes. It is at the edge, not sharded; if the e2e project grows further it must be sharded (note in D126).

- M07a part A: the golden test of `e2e/looks.test.ts` (six globe views) fails against the committed PNGs (0.4 % of the pixels on europe50, limit 0.2 %) because the default terrain is the chunk quadtree now; Part C regenerates the goldens ONCE with `UPDATE_GOLDENS=1` (D134). Everything else of `npm run verify` is green.
- M07a part A: the whole e2e project takes about 716 s in this sandbox (480 s before); the plan to shard it over CI jobs is in `docs/BACKLOG.md`.
- M07a part A: from 300 m above a coast the surface under the sea pixels next to the land is raised (a wedge of water), D133 (7) and `docs/BACKLOG.md`.
- TestSpeed (D144): `LOCAL_GPU=1` and `docs/LOCAL.md` are untested on a real GPU and on Windows (the plumbing is unit-tested). The 8-minute budget of `verify` is met with a margin of about 10 s on the 4-core sandbox at 100 % CPU; the next milestone that adds browser frames can push it over (D144 (8), BACKLOG "TestSpeed ideas not built"). One sleep stays on purpose (`e2e/globe.test.ts`: nothing renders by itself during 400 ms of wall clock).

- M11a stop rule (ACCEPTED by the owner, `docs/DECISIONS.md` M11b point 10): the measured shares stay (Himalaya 25.2 % against the 20 % cap, Plains median 21.8 % against 28.4 %); the two `it.fails` tests in `tests/sim/losReal.test.ts` stay as documentation; the finer 2048x1024 LOS grid (option C) is a BACKLOG idea. Nothing to decide.

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

PerfGate (same sandbox, node, 1024x512, 100 000 cells in one tick; D132):

| measure | before (HEAD 55960a3) | after |
|---------|-----------------------|-------|
| burst kernel, median of the per-process medians | 43.6 ms (20 runs: min 40.9, max 50.5; M04 commit 69798de: 43.5) | 34.3 ms (30 runs: min 32.2, max 39.5) |
| burst median as a share of `budgetMs(50)` (budget 55 to 150 ms) | about 80 % when the factor is 1.1 | median 58.8 %, worst 66.9 % of 30 runs; worst 65.4 % of 15 project runs |
| samples per test | 7 after 2 warm-ups | 21 after 3 warm-ups, worlds built and gc'd outside the clock |
| perf project (6 files, 18 tests) | about 8 s | about 8 s |

## Measurements CamFix (logged; the camera numbers are pinned by tests/render/mountainCalm.test.ts, the fit numbers by tests/render/fit.test.ts)

Window and distances (`src/render/fit.ts`, FOV 30 degrees vertical, `FIT_FILL_SAFE` 0.92): aspect 16:9, 21:9, 4:3 (and everything at least as wide as high): maximum distance 32 000 km (the disc fills 62.8 % of the half-height), the eased tilt is 0 from 20 247 km; 9:16: 61 198 km and 40 014 km (62.8 % of the half-width); 0.4: 88 439 km and 58 553 km; 0.25: 145 117 km (the ceiling 150 000 km does not bind above 0.25). The old 42 000 km filled 50 % of a 16:9 half-height, 88 % of a 9:16 half-width and did not fit 0.4. Before the fix at 42 000 km and 72 degrees (16:9): the centre of the disc 7.85 degrees from the middle (not 8.6), the far edge at 1.08 half-heights (cut), and the globe low in the picture; after: the lit-pixel bounding box of the real screenshots (`e2e/zoomOut.test.ts`, with the atmosphere's glow) has at least 3 % free on every side and its centre within 3 % of the middle in all 12 pictures (4 windows, tilts 0, 40, 72, headings 0, 200, 90); the disc of the maths itself (projected outline of the sphere): margin >= 5 % in 80 random windows and in all 54 combinations of window, tilt and heading at the maximum distance; the wheel runs (6 windows x 4 tilts x 3 headings = 72, from 3 000 km) end centred to 1e-15 of the half-extent with a heading change of at most 0.005 degrees and a latitude change of at most 0.004 degrees.

Per-frame change of a wheel zoom through the eased tilt (60 fps, fx steps of 1/60 s, real height field, tilt 60 to 72, from 3 000 to 26 000 km): one notch moves the camera at most 2.9 % of its distance and turns the look direction at most 2.2 degrees per frame (worst at 14 000 km); three notches at once 9.9 % and 7.6 degrees; five notches at once 16.6 % and 12.8 degrees (the zoom itself is moving the camera a sixth of its distance in its fastest frame). Zoom out to the maximum and the same number of notches back: the user's tilt within 1 degree in six window shapes.

Camera over mountains (the same script in the M08 head and in a git worktree of `ec44223` = version 9; 60 fps in fx steps; six pans of 500 px each; `hfShare` = the camera's radius slower than 1 s over the ground's, `shake` = faster than 1/6 s over the ground's, dip = the deepest the camera went under the height it holds as a share of it):

| hold | M08 fast pan (625 px/s): hfShare, shake, dip, lowest height, end | M08 steady pan (312 px/s): hfShare, shake, dip, lowest, end | v9 fast pan: lowest height, end height |
|------|------|------|------|
| Alps 0.3 km, tilt 60 | 0.90, 1.01, 0, 300 m, 300 m | 0.92, 0.84, 0, 300 m, 300 m | -2 170 m, 30 700 m |
| Alps 3 km, tilt 55 | 0.53, 0.34, 0.08, 2 760 m, 3 000 m | 0.46, 0.32, 0.06, 2 830 m, 3 000 m | -564 m, 31 600 m |
| Alps 20 km, tilt 55 | 0.62, 0.27, 0.26, 14 800 m, 20 000 m | 0.62, 0.29, 0.22, 15 700 m, 20 000 m | 17 200 m, 45 500 m |
| Himalaya 0.3 km, tilt 60 | 0.57, 0.47, 0, 300 m, 300 m | 0.63, 0.38, 0, 300 m, 300 m | 1 000 m, 75 100 m |
| Himalaya 3 km, tilt 55 | 0.57, 0.33, 0.79, 632 m, 3 000 m | 0.59, 0.28, 0.70, 888 m, 3 000 m | 1 000 m, 67 100 m |
| Himalaya 20 km, tilt 55 | 0.64, 0.29, 0.29, 14 100 m, 20 000 m | 0.56, 0.26, 0.22, 15 600 m, 20 000 m | 11 700 m, 77 700 m |

(v9 has no held height: its camera keeps its distance to the sea-level point, so the height over the ground wanders; its 1 km rows: lowest 71 m (Alps) and 368 m (Himalaya), ends 30 300 m and 66 400 m; M08 1 km: lowest 887 m and 926 m, ends 1 000 m.) The wheel (eight notches, in, in, out, out, in a lot, out a lot, out, in, with 1.5 s between): 0 extra direction reversals of the camera's radius at 1, 3 and 20 km over both places in M08 and in v9; the largest change of the height over the ground in one frame 4 to 9 % in M08 (v9 4 to 11 %); M08 ends within 0.5 % of where it started (v9 at 1 km ends at 1 380 m: its old floor of 1 000 m). The follower copies the ground fully when it is made instant (`RTS_FOLLOW_TAU_S` 1e-9): hfShare and shake 1.0, which is what the named tests kill. Look-ahead (aim at the higher of the ground here and the ground 0.25 s ahead along the camera's own motion; REJECTED, not in the code): dip Alps 3 km 0.08 to 0.015 and Himalaya 3 km 0.79 to 0.32, but shake 0.34 to 0.64 and 0.33 to 0.70, direction reversals 7 to 53 and 1 to 23, and the largest acceleration tenfold.

Costs: `e2e/zoomOut.test.ts` 33 s (7 tests, 2 to 3 s a window shape, 14 s a wheel run: the camera is at 3 000 km, where the terrain is dear in SwiftShader); `tests/render/fit.test.ts` 0.5 s, `tests/render/fitCamera.test.ts` 14 s (dominated by the real height field in the wheel runs), `tests/render/mountainCalm.test.ts` 1.4 s. The camera's per-frame cost: see the perf test of the verify run below.

## Measurements M07a part A (logged, not asserted)

Cloud sandbox, SwiftShader, test tier 960x540 unless said:

| measure | value |
|---------|-------|
| quadtree update (medium tier, 48 cameras over the six altitudes), median of 15 sweeps | 0.19 ms (p95 0.26 ms); budget `budgetMs(1)` |
| chunk terrain update (selection, comparison, refill when the selection changed) | 0.22 ms median, 0.23 ms with the refill forced every call; an unchanged camera 0.3 us |
| default orbit view, renderer.info triangles (scene incl. the 9 024 of the shell) | test: chunks 37 184 vs fixed 74 560; medium: 110 400 vs 271 168 (M05) |
| chunk frame in SwiftShader (render + readback of one pixel) | orbit 0.30 s, 900 km 0.65 s, 220 km 0.65 s; the fixed mesh 0.26, 0.40, 0.39 s |
| float32 vs float64 chunk positions, vertices within 50 km of a camera 300 m up | worst 3.7 mm over 5 964 vertices |
| skirt depth against the worst LOD mismatch (2 435 seam edges, six mountain regions) | worst 44 % of the depth |
| chunk cap, 300 random poses per tier (unit) | test 150 of 150 (capped in 33), low 100 of 100 (78), medium 300 of 300 (9), high 400 of 400 (24) |
| LOD hysteresis, 300 frames wobbling +-6 % around a ring boundary | 1 level change with, 66 without (six boundaries) |
| leak test, 60 renders at 320x180 | 0.07 MB |
| whole e2e project | 716 s (480 s before M07a): `docs/BACKLOG.md` holds the plan to shard it |
| `npm run verify:fast` | 57 s (126 files, 1414 tests), perf project 22 tests green |

## Measurements M07a part B (logged, not asserted)

Cloud sandbox, SwiftShader, test tier 960x540 unless said:

| measure | value |
|---------|-------|
| `CameraRig.update` at rest at the zoom floor over the Himalaya (the per-frame ground check), median of 15 | 0.6 us; budget `budgetMs(0.02)` (`tests/groundCamera.perf.test.ts`) |
| one wheel notch (the search for the distance of the wanted height, about 130 height reads) plus one frame of the zoom, median of 15 | 135 us; budget `budgetMs(0.6)` |
| mouse zoom floor | 1000 m above the displaced ground over the open sea, the Alps, the Himalaya and Everest at tilt 0, 40 and 72 |
| territory border at 1.5 km, worst distance from a straight line over nine rows | 0.62 px with the two-part cell position; 1.47 px with one float32 cell coordinate (limit 1.0) |
| cell position of a vertex, worst over 400 random vertices of level 9 to 17 chunks | 1.4 mm (two parts) against 1.2 m (one float32) |
| smallest Jacobian determinant of the border warp, 60 000 positions, all fine octaves on | 0.13 (M05 warp alone 0.48; the first, rougher version -3.5 = folded; limit 0.1) |
| LOD levels in the two ground views | 9 to 11, chunk count 148 to 150 of 150 (test tier) |
| contact sheets | 6 files, 1.6 MB, 0 px differ against themselves, byte-identical in one launch |
| whole e2e project (17 files, 149 tests) | 776 s in `npm run verify`; 796 s before the goldens were regenerated |

## Measurements TestSpeed (logged, not asserted)
Wall times of `npm run verify` on the 4-core, no-GPU sandbox (the stage table is printed by `scripts/verify.mjs`; logs in test-results/verify-*.log, gitignored). `slow` = lines `[guard] slow call` (a browser call over half of the 20 s hang guard): zero in every run.
| run | e2e workers | typecheck / lint / unit (side by side) | perf | e2e | e2e-serial | total |
|-----|-------------|-----------------------------------------|------|-----|------------|-------|
| HEAD, sequential | 1 | 8 s / 9 s / 64 s (one after the other) | 11 s | 802 s (778 s profiled) | (inside e2e) | about 14:50 |
| 2 workers, final suite, runs 1 to 5 | 2 | 20 s / 20 s / 61 s; 19 / 17 / 1:10; 20 / 18 / 59; 18 / 19 / 59; 18 / 17 / 57 | 10 to 11 s | 6:59, 7:01, 6:55, 6:57, 6:48 | 13, 13, 14, 13, 12 s | 8:23, 8:34, 8:18, 8:19, 8:07 |
| 3 workers, runs 1 to 3 | 3 | about 18 s / 18 s / 58 to 60 s | 10 s | 6:31, 6:25, 6:18 | 13, 13, 12 s | 7:53, 7:48, 7:39 |
| 3 workers, the three final runs (default; the last one on the committed final tree, nothing else running) | 3 | 17 / 17 / 59 s; 20 / 19 / 59 s; 17 / 17 / 56 s | 10 s | 6:29, 6:30, 6:08 | 13, 12, 12 s | 7:52, 7:51, 7:26 |
Counts of the final run: unit 136 files / 1 536 tests, perf 8 / 24, e2e 16 / 143, e2e-serial 4 / 7 (150 browser tests; HEAD had 149 in the e2e project).

## Measurements AutoTier-2 (logged, not asserted; SwiftShader, so only the SPLIT between the two costs says anything about a GPU)

One throw-away script (not committed) rendered the same view with the chunk density of each tier at 320x180, 640x360 and 960x540 (median of 7 draws, each ended by a one-pixel readback) and fitted `time = fixed + per_pixel * pixels` through the 320x180 and 960x540 points. The machine was shared with two other builders and a unit run, so the milliseconds are rough (the 640x360 points scatter by up to 30 %); the structure is clear. Static proxy (`tests/helpers/shaderCost.ts`, executed operators): chunk VERTEX shader 12 077 operators, 41 fetches, 9 transcendentals per vertex; chunk FRAGMENT shader (orbit view) 3 796 operators, 172 fetches, 176 transcendentals per pixel.

| tier chunks, view | triangles | 320x180 | 640x360 | 960x540 | fixed (per frame, vertex) | per Mpixel | fixed share at 960x540 |
|---|---|---|---|---|---|---|---|
| low, orbit | 44 864 | 213 ms | 688 | 739 | 147 ms | 1 142 ms | 20 % |
| low, Alps 35 deg | 66 624 | 362 | 829 | 1 421 | 230 | 2 296 | 16 % |
| medium, orbit | 138 048 | 341 | 624 | 1 345 | 216 | 2 177 | 16 % |
| medium, Alps | 257 856 | 697 | 1 795 | 2 986 | 411 | 4 967 | 14 % |
| high, orbit | 361 536 | 700 | 878 | 1 564 | 592 | 1 875 | 38 % |
| high, Alps | 437 568 | 908 | 1 867 | 2 966 | 650 | 4 466 | 22 % |

Reading: (1) the fixed part grows with the triangle count (about 3 ms per 1000 triangles here), the pixel part with the buffer size, and a terrain view at 35 degrees costs about twice per pixel what the orbit view does (the near view takes the whole fragment shader, the sea of the orbit view skips the class fetches). (2) On `low` (at most 66 000 triangles) the frame is PIXEL-bound at any ordinary window size: at 960x540 about 80 % of the time is per pixel, so the scale ladder removes up to 75 % of it (0.5 squared = 0.25) and the time halves or better; only below about 400x225 does the vertex part dominate. (3) On `high` the vertex part is large (22 to 38 % at 960x540, and the user's `high` run had up to 921 408 triangles in a 904x742 window at DPR 1.25, where the vertex work, about 460 000 vertices times 12 077 operators, is of the same size as the pixel work of 1.05 million pixels times 3 796): there the ladder alone is not enough and the chunk-density step (fewer chunks, fewer octaves) is the part that cuts the vertex cost. That is why the step exists and why AutoTier-1 starts such a card on `low`. (4) The ladder steps 1 -> 0.85 -> 0.72 -> 0.6 -> 0.5 cut the pixel count to 72 %, 52 %, 36 % and 25 %: ratios between neighbours of 1.38 to 1.44, which the 18 / 30 ms hysteresis gap (ratio 1.67) absorbs. A cheap change in `low` that cuts the vertex cost (`Globe.setDetailBias(-1)`, one octave fewer) would also change the picture of `low` and was left to `docs/BACKLOG.md` (it needs a look on real hardware).

## Usage

| date | after milestone | 5h % | week % | note |
|------|-----------------|------|--------|------|

## Archive

Finished passes moved out of Now by Fix-3C, text kept word for word (two ticks annotated).

### Integration Sim-Growth + Look-1: the UI and render read the ten City levels and five district slots (one session on HEAD 7cfad4b; the orchestrator owns merging, pushing and the Artifact)
- [x] 1. `structureInfo`, `cityViewModel`, `cityViewPanel`, `selectionPanel`, `src/render/structures.ts`, `src/render/rings.ts`, `src/render/cityTiers.ts` read `cityGoldMilli`, `cityTroopCap`, `maxLevelOf`, `upgradePriceGold`, `upgradeTicksOf`; five fixed district slots on a pentagon (`DISTRICT_SLOT_ANGLES`); the five failing unit tests follow the sim numbers (details in `docs/DECISIONS.md`, Integration Sim-Growth + Look-1)
- [x] 2. e2e: `cityView`, `districtsLayer`, `lookCities`, `structures` follow the new numbers and the 3-cell spacing; goldens `city-view` and `districts-layer` re-pinned once after looking, `city-old` / `city-new` unchanged
- [x] 3. Looked at the City at levels 1, 3, 5, 7, 10 in both styles (3 km, 800 m) and at the full ring of five districts: grows in five steps, the ring fits, nothing needed a render change beyond the slot angles
- Not run here: the full `npm run verify`, the Artifact pack, the pull request (the orchestrator).

### Polish-1: spawn phase in the build UI, night readability, ring on slopes, compact GPU tip, resize while zoomed out (one slice; the orchestrator owns merging)
- [x] 1. Ghost red with the phase reason (`toast.build.phase` on a click), build buttons dimmed (`data-state="waiting"`, tooltip), selection panel Upgrade / Delete dimmed (`sel.why.phase`); `e2e/polishPhase.test.ts`.
- [x] 2. Night floor and owner rim in the structure fragment shader (no draw call, no texture); looked at night and day screenshots at 150, 600 and 1500 km (models are badges from about 600 km). No pixel assert: the night-lights texture is brighter than the structure, so only a shader-source test exists (`tests/render/polish1.test.ts`).
- [x] 3. The selection ring follows the ground (`selectRingLiftsM`, per-vertex `aLift` set when the selection changes); unit test on the lifts.
- [x] 4. GPU tip is one line plus More / Less and Close; Play stays reachable at 1366x640, 1280x560, 960x540, 540x960.
- [x] 5. `CameraRig.setViewport` moves a camera at (within 2 percent of) the old maximum to the new maximum; unit and e2e (`__test.resize`).
- [ ] 6. Not done: see Polish-1 leftovers in `docs/BACKLOG.md`.

### M10a: the City on the terrain, placement mode, build bar, toasts (slice 1 of M10; one builder in its own worktree; the orchestrator owns merging, pushing, the pull request and the Artifact)

Base: 1c51073 (branch worktree-wf_65782ab4-761-1). Previous merge SHA unchanged (nothing is merged). Slice: ONLY the City, with infrastructure the other five types plug into (D-M10a-1).

- [x] 1. Snapshot: the structure table in `ViewSnapshot.structures` (copied typed arrays, sent when changed), `MirrorStructures` in `ViewMirror` (validateBuild and the price work on the mirror)
- [x] 2. Render: `STRUCTURE_MODELS` registry, `StructureLayer` (one instanced mesh per type, owner colour, level scale, groundHeightAt, globe normal, hi / lo position), City model, scale policy, pop-in, construction look
- [x] 3. Placement: key 1 / button -> input mode, ghost (green / red by `validateBuild`), click sends Build, Shift keeps the mode, Esc / right click leave it
- [x] 4. `src/ui/toast.ts` (max 3, fx clock), toast on a red click
- [x] 5. i18n sv + en, data-testid everywhere, `__test.props()`, `state().structures`
- [x] 6. Docs: ARCHITECTURE rows, Budgetar row, DECISIONS, BACKLOG
- [x] ACCEPTANS: unit `tests/host/structureSnapshot.test.ts`, `tests/app/placement.test.ts`, `tests/render/structureModels.test.ts`; e2e `e2e/structures.test.ts` (key 1 + click builds, price 400 -> 600, count +1 past the build time, ghost red with the Peak and spacing reasons, toast key, Esc, heights vs `groundHeightAt`, draw calls <= 2, close-up golden `structures-city.png`); `npm run verify:fast` green (the full `verify` is the orchestrator's)
- Not in this slice (BACKLOG): Factory, Port, Silo, SAM, Post models and keys 2 to 6, upgrade / delete / selection panel, icon-quad LOD, night lights, range rings.

### AutoTier-1: default tier by graphics card class and an honest tip (one small part; the orchestrator owns pushing, the pull request and the Artifact)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged). CamFix is Done on this branch. Adaptive resolution is AutoTier-2 (BACKLOG), not built here.

- [x] 1. GÖR and ACCEPTANS as this checklist
- [x] 2. `src/render/gpuClass.ts` (`classifyRenderer`, `readableGpuName`, the documented rule table) tested on 29 real strings (`tests/gpuClass.test.ts`)
- [x] 3. `resolveQualityChoice` / `resolveQuality`: param/dev, pref `quality`, class (integrated and software -> low), else medium; test mode untouched; the automatic tier is never written to prefs; the renderer string is read in ONE place (`readGpuStrings` in `src/render/globe.ts`)
- [x] 4. The closable graphics tip in the start card (`src/ui/gpuTip.ts`), sv and en, remembered through the pref `gpuTipClosed`, click-through; test hook `?gpu=<string>` (test mode only)
- [x] 5. Report fields `gpuClass` and `tierSource` (additive, schemaVersion stays 1) and an F3 / overlay line
- [x] 6. Tests: `tests/gpuClass.test.ts`, `e2e/gpuTip.test.ts`; i18n test green
- [x] 7. Docs: PREVIEW 5e (Swedish), ARCHITECTURE, DECISIONS D159, BACKLOG
- [x] ACCEPTANS: `npm run verify:fast` green; `npm run build` green; no golden and no earlier test changed

### CamFix: the whole globe in view when zoomed out, and a calm camera over mountains (USER GATE; one part; the orchestrator owns pushing, the pull request and the Artifact)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged, M00 to M08 live on this branch and in draft pull request #1; M08 is Done here, Artifact version 10). HEAD at start f814131. The user's feedback on version 9: "Kameran när man kör med texturerade berg var väldigt jobbig och man kan enbart se den övre delen av världen när man zoomat ut". Facts found while reproducing (D158): the prompt's screenshot script zoomout.mjs set only the Playwright viewport, so in test mode the canvas stayed 960x540 and the 9:16 / 21:9 shots are a 960x540 canvas cut by the viewport (and its mouse sat off the canvas centre): the 16:9 shots show the real fault, the 9:16 and 21:9 ones do not; the new e2e passes `w` and `h`.

GÖR
- [x] 1. This checklist
- [x] 2. `src/render/fit.ts` (pure, no three): `narrowHalfTan`, `discFill`, `fitDistKm`, `maxDistKm(aspect)`, `discExtent` (the exact four extreme points of the disc for a distance, tilt and aspect), `maxTiltForDist(distKm, aspect)` (the eased envelope, continuous, monotone), `geometricTiltLimit`; constants in `src/render/config.ts`; the margin and the fills are in D158; ARCHITECTURE row
- [x] 3. The maximum distance is `maxDistKm(aspect)` from the rig's width and height (updated by `setViewport`), used by `setView`, the update loop, the wheel, flights and everything else that clamped to `DIST_MAX_KM` (which goes away: it clashed with aspect 0.4)
- [x] 4. The shown tilt = min(the user's tilt, `maxTiltForDist`) in `pose()` and in every place that needs the camera position (picking, anchor, AGL), the user's tilt is kept (zoom out and in gives it back), a right drag that rotates the tilt at a far distance works on the shown tilt
- [x] 5. A wheel zoom straight out with the cursor at the centre keeps the heading (at most 1 degree) and the disc centred (3 %), whatever tilt and heading it came with
- [x] 6. Hunting over mountains: the scripted measurement (`tests/render/mountainCalm.test.ts`, real height field, fx steps of 1/60 s, Alps and Himalaya, drag at constant height plus wheel in and out), compared with the M07b baseline `ec44223` (git worktree) and the M08 head; numbers in Measurements; a pinning test with the two mutations ("no smoothing", "clearance removed") killed by named tests
- [x] 7. Tests: unit (`tests/render/fit.test.ts`, property tests over aspect 0.4 to 3, tilt 0 to 80, distance up to the maximum), camera (`tests/render/fitCamera.test.ts`: wheel out in six formats, tilt back, no NaN, pick round trip at far poses, per-frame change), e2e `e2e/zoomOut.test.ts` (settle, openPage, bounding box of the non-black pixels at maximum distance in 16:9, 21:9, 4:3, 9:16 with several tilts and yaws)
- [x] 8. M08's low-altitude feel unchanged (the ground tests, the bookmarks, `#view-alps-valley` pass untouched)
- [x] 9. SLUT: PROGRESS Done row "CamFix" and Measurements, DECISIONS D158, ARCHITECTURE, BACKLOG, PREVIEW (Swedish); `npm run verify` green; `npm run build && npm run artifact:pack`

ACCEPTANS
- [x] At maximum distance the whole disc is in view with at least 5 % margin on every side for aspects 0.4, 9:16, 4:3, 16:9, 21:9 and 3, tilts 0, 40 and 72, headings 0, 90 and 200 (unit test and screenshot test)
- [x] The disc fills 55 to 80 % of the narrowest half-extent at maximum distance
- [x] A wheel zoom out from 3000 km and tilt 60 gives the whole globe centred within 3 % and a yaw change of at most 1 degree
- [x] Zoom out and in gives the user's tilt back within 1 degree; no frame changes the pose more than M08's bound (true for a wheel notch: 2.9 % and 2.2 degrees per frame; a spin of five notches at once moves the shown tilt 12.8 degrees in its fastest frame, D158 (6), BACKLOG)
- [x] The pick round trip (at most 1 pixel) holds at zoomed-out poses with a tilt; M08's tests stand unchanged
- [x] The hunting measurement exists, its numbers are in Measurements below, a test pins them, and the mutations "no smoothing" and "clearance removed" are killed by named tests
- [x] `npm run verify` green; `npm run build && npm run artifact:pack` green


Result (this sandbox, SwiftShader; D158): `npm run verify` GREEN on the final tree: typecheck 23 s, lint 23 s, unit 1:26 (159 files, 1 827 tests), perf 17 s, e2e 13:04 (24 files; the machine was slower than at M08: setup 234 s and shading 220 s were 211 and 199 s then; `e2e/zoomOut.test.ts` is 64 s of test time under three workers, 33 s alone), e2e-serial 17 s, 15:03 in all: over the 8:00 rule as before (D156 (8)). No golden changed, no earlier test edited. Camera cost: update at rest with a held height 5.1 us (3 us at M08 on a faster stretch; the perfguard factor was 2.22), untouched camera 0.2 us, a wheel notch with its 30 frames 0.9 ms, a drag event 48 us: all within their budgets. The fix itself: `src/render/fit.ts` (new), `CameraRig` (`maxKm`, `shownTilt`, `freePose`), constants in `src/render/config.ts`, two test hooks. What the reproduction showed (the prompt's script clipped its 9:16 and 21:9 pictures, its formula had a sign error, and 42 000 km did fit 9:16 centred): D158 (1). The mountain answer: M08's follower already held the height and was smoother than v9 (calm over the Alps; up to 79 % dive at the Himalaya wall at 3 km); look-ahead tried and rejected (D158 (9)). Open for the user's eye: PREVIEW 17aa (the whole globe in your window shape, the tilt unwinding on the way out, the pan over the Himalaya wall).
### M08 audit pass (D157): one blocker and eleven majors of the independent audit, fixed or answered (one session; the orchestrator owns pushing, the pull request and the Artifact)

- [x] Blocker: a wheel notch at a high tilt and a low height threw the camera thousands of km (fallback to the nearest point of a missed sphere, no cap): `CameraRig.surfaceHit` (sphere above, tangent plane below, grazing and missing rays hold nothing), caps of one correction, the dolly (D157 (1), (2)); `tests/render/rtsZoom.test.ts`, `e2e/rts.test.ts`
- [x] Major: the zoom hunted, did not settle, and drifted over rugged ground: the RTS wheel is a dolly along the cursor ray solved once, ends and holds its height (D157 (2)); tests per frame on the real height field
- [x] Major: the follow of the ground and the held height after zoom and drag were unpinned (`tests/render/rtsFollow.test.ts`, four mutations killed)
- [x] Major: the waypoints of the performance scene, the first-crossing of grazing rays, pointerCancel / lost release, the globeApp glue (`__test.onContext`, `onPause`, e2e) were unpinned: tests added, mutations killed (D157 (5))
- [x] Major: the input stack could not hand clicks, context commands and long presses to modes, the resolver ran under a pushed mode, the key adapter was hard-coded to F and Escape: `click` / `context` / `longPress` / `tick` on `InputMode`, `take`, `dispatch*`, `attachDomKeys` (D157 (4))
- [x] Major: CLAUDE.md claimed a sharded CI that is not wired: the sentence now says the budget is NOT met and the matrix is not wired (D157 (6)); the task stays in Next
- [x] `npm run verify:fast` and `npm run verify` green after the pass (see the result at the end of this section), `npm run build && npm run artifact:pack`

Result of the audit pass: `npm run verify` GREEN (typecheck 26 s, lint 26 s, unit 1:28, perf 16 s, e2e 11:42, e2e-serial 16 s, 13:42 in all: still over the 8:00 rule, see D157 (6)); no golden changed. The e2e of the globe scene found two more faults of the first dolly (a zoom that eases the tilt stopped at 13 km instead of 300 m; twelve huge notches out stopped at 5 000 km): fixed and pinned in `tests/render/rtsZoom.test.ts` (D157 (2)).

### M08 RTS camera, ground picking and the performance scene (USER GATE) - parts: A (items 1 to 4 and their tests), B (item 5, the perf scene and the report), C (goldens, the verify time, finish). The orchestrator owns pushing, the pull request and the Artifact.

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged, M00 to M07b, Tempo and TestSpeed live on this branch and in draft pull request #1; the precondition "M07b is merged" is treated as satisfied because this file lists M07b as Done). `npm ci` was in place; `npm run verify:fast` was green at the start. Facts that change the prompt (read D153, D154, "Rules for layers on the terrain"): `flyTo` lives in `src/render/flyTo.ts` (D120), the pick criterion is "hit radius = `seenRadius` within 0.05 m" (D154 (5)), `groundHeightAt` works in Node through a pure factory, the camera must reach 300 m AGL (the M07a limit of 1000 m and the hook clamp of `altAglM` move), click threshold stays `CLICK_MOVE_PX` 6 (the M05 tests pin 3 to 10).

GÖR (Part A = items 1 to 4)
- [x] A1. `src/render/transforms.ts` (no three): cell <-> lat/lon <-> world with wrapX, `createGroundHeight(source)` (pure factory; the unbound module case is an explicit tested error), `groundHeightAt` = `heightAt` (same function), `pickGround(field, ray)` (adaptive march bounded by 0.5 cell + bisection)
- [x] A2. `src/app/input.ts`: the mode stack (base mode = the M05 input unchanged, push / pop, Esc pops, `setPauseHandler`, `setContextHandler` no-op defaults, the mouse mapping, reserved keys 1 to 6, E, H, F, Esc)
- [x] A3. Camera mix in `src/render/camera.ts`: globe arcball above an AGL threshold, RTS below, smooth transition; grip-pan on the ground point, zoom to the cursor, yaw, tilt 20 to 80, clearance 300 m via the ground height; Pointer Events + `touch-action: none` + two-finger pan / zoom / rotate
- [x] A4. `flyTo` extended in `src/render/flyTo.ts` (altitude, tilt, yaw, RTS mode, fx clock only); bookmarks (Alps, Himalaya, Andes, own capital) in `__test` and the Dev panel
- [x] A5. Tests of A1 to A4 (below), docs (DECISIONS, ARCHITECTURE, PROGRESS), `npm run verify:fast` green, local commit

GÖR (Part B)
- [x] B1. `?scene=perf` ("Prestandascen", `#scene-perf`): orbit -> continent -> valley -> 300 m AGL -> cruise over the Himalaya, report JSON as an additive `scene` section of the M02 schema (`schemaVersion` stays 1) with the extra fields (GPU renderer string, DPR and `devicePixelRatio`, canvas size, refresh estimate measured with empty animation-frame callbacks, cadence histogram, capped verdict, JavaScript and GPU time per frame, per phase summaries); JSON Schema + validator + test; "Kopiera rapport" = `showReport` (D156)

GÖR (Part C)
- [x] C1. Six height goldens `e2e/goldens/rts-height-orbit.png`, `rts-height-continent.png`, `rts-height-region.png`, `rts-height-30km.png`, `rts-height-valley.png`, `rts-height-300m.png` (new files, no earlier golden moved; D156 (6))
- [x] C2. The verify time: NOT back under 8 minutes (about 12:50 on the 4-core sandbox: the e2e stage sums to 33 minutes of test time over 23 files); what was built is the per-file time table of the e2e stage and `node scripts/verify.mjs --shard i/n` for CI (D156 (8)); `npm run verify` green, PREVIEW (Swedish, 17x to 17z), BACKLOG, ARCHITECTURE, `npm run build && npm run artifact:pack`

ACCEPTANS (all parts; ticked = proven by a test that can fail)
- [x] Pick round trip: 200 random screen points over orbit and three RTS heights, pick then reproject, error <= 1 px
- [x] Terrain awareness (Himalaya, tilt 60): >= 100 of 200 hits on the surface (hit radius = `seenRadius` within 0.05 m, `groundHeightAt` with the distance-law octaves equals the hit height), >= 30 of them >= 50 m from the sphere intersection
- [x] `groundHeightAt === heightAt` (the same function) and it matches the shader's height within 1 % of the local relief (the M07b readback probe)
- [x] Scripted flight orbit -> 300 m AGL on the fx clock in steps of 1/60 s: position change per frame <= 5 % of the height, direction change <= 3 degrees per frame, above the clearance in every frame; `flyTo` to 50 m AGL ends >= 300 m
- [x] Input unit tests: Esc pops the top mode and calls the pause handler only when the stack is empty; left drag keeps the ground point under the cursor within 1 px; right drag changes yaw but not the position; right click without drag gives exactly one context command with the right cell; scripted two-finger gesture gives pan / zoom / rotate
- [x] `flyTo` on the fx clock (`advanceFx` / `__test.advance`) reaches the target within epsilon at the stated time; the M06 tests are unchanged and green
- [x] Zoom floor (replaces the M07a 0.8 to 1.5 km test): mouse zoom stops >= 300 m AGL over the sea and the Himalaya; `?view=alps-valley` and `?view=himalaya-valley` still load with >= 3 LOD levels
- [x] Perf scene runs to the end in the test tier (shortened) without console errors, the report validates against the schema, all numbers finite, maxChunks >= 12 and maxTriangles >= 20k; "Kopiera rapport" shows JSON that validates (`e2e/perfScene.test.ts`; the live page's start and a mid-run report too; `tests/render/perfSceneFlight.test.ts` flies the live script at 60 fps)
- [x] 6 height goldens committed (orbit, continent, region, 30 km, valley, 300 m AGL; `e2e/rtsHeights.test.ts`)
- [x] `npm run verify` green (see the Result of Part B and C)

Result of Part A (this sandbox, SwiftShader; D155): `src/render/transforms.ts` (cells, `groundHeightAt === heightAt`, the pure factory, `pickGround`), the camera mix in `CameraRig` (`rtsMix` between 4 000 km and 800 km of height, an exact grip on the ground point, zoom and turns about ground points, tilt 20 to 80 at the camera, a kept height, the 300 m clearance as a straight lift), `src/app/input.ts` (the stack, the base mode, touch, Escape, F, the two handlers), flights with an altitude (`FlyOptions.altAglM`), bookmarks (test hook and Dev panel). Measured: the pick round trip is exact to 2e-9 px on 200 hits at each of four heights (<= 1 px asked); the terrain-awareness view (Himalaya, 20 km up, tilt 60) has 200 of 200 hits on the seen surface (radius within 2e-8 m, 100 asked) and 200 of 200 at least 50 m from the sphere (30 asked); the grip keeps the point within 3e-10 px (0.14 px at the 300 m floor); the scripted flight orbit to 300 m (14.6 s) moves at most 4.1 % of the height per frame and turns at most 0.9 degrees per frame; 240 random inputs over the Himalaya never read below 300.0 m; `groundHeightAt` matches the GLSL height within 0.017 % of the relief; `npm run verify:fast` green (149 files, 1 678 tests), the perf project green (10 files, 32 tests, `tests/rtsCamera.perf.test.ts`: 3 us per frame with a kept height, 0.2 us untouched, 35 us per left-drag event, 230 us per right-drag event), the new and the camera-related e2e files green (`e2e/rts.test.ts` 8 tests; `e2e/globe.test.ts`, `match`, `hud`, `ai`, `setup`, `devpanel`, `terrainViews`, `terrain`, `detail`, `looks`). Mutants killed (each by a named test): the grip on the sea-level sphere, no clearance, a flipped yaw, a faster flight, no arch, Escape always opening the pause menu, a sphere-only pick, the old 1000 m floor, a context command sent twice. What Part B must know: the camera and the input are in place and `window.__test` has `flyTo`, `bookmark`, `flightActive`, `cameraMix`, `holdAgl`, `pickGround`, `groundHeightAt`; the perf scene can drive the camera with `CameraFlight` (`altAglM`) on the fx clock, whose plan gives orbit to 300 m in 14.6 s at 4 % of the height per frame at 60 fps (a perf-scene frame at 30 fps moves 8 %: use fx steps of 1/60 in the shortened test run); `Globe.info()` already has the renderer string, DPR and size. The verify-time reduction (Next, first task) and the six altitude goldens are NOT done.

Result of Part B and the finish (this sandbox, SwiftShader; D156): the performance scene `?scene=perf` (`#scene-perf`, Dev panel "Prestandascen"; `src/app/perfScene.ts`): refresh probe with nothing drawn (70 empty callbacks), then orbit 21 500 km, a classic flight to 3 500 km, a ground flight to 3 km, a ground flight to 300 m and a 13 km cruise at 300 m over the edge of the Tibetan plateau (chosen from screenshots: at 28.2 N 86.8 E the camera at 300 m looks into a white wall, D156 (2)); the mouse is off until it is done. The live script at 60 fps on the real height field: 2 086 frames = 34.8 fx seconds, worst frame 4.23 % of the height, worst turn 0.40 degrees, lowest 300.0 m (`tests/render/perfSceneFlight.test.ts`). The report: the `scene` section (additive, `schemaVersion` stays 1) with frame time mean / p95 / max, maxima of triangles, draw calls and chunks, the lowest height, the canvas (CSS size, drawing buffer, DPR in use, `devicePixelRatio`), the refresh measured before the scene, the cadence histogram and the shares of frames of 1, 2, 3, 4+ refresh intervals, the capped verdict (`likely-capped` when every phase sits on the same whole multiple of the refresh), JavaScript time, GPU time from `EXT_disjoint_timer_query_webgl2` where the browser has it, one summary per phase; `PERF_REPORT_SCHEMA` with thirteen mutations rejected. Test-mode run (test tier, 320x180, fx steps of 0.34 s): 21 frames in 6.8 s wall, maxChunks 149, maxTriangles 104 384 (the orbit phase 46 chunks and 38 464 triangles), maxDrawCalls 3, the ground phase ends at 300.0 m; the live page in headless Chromium measured 59.9 Hz from 60 probe frames and drew its first scene frames without a console message. Six goldens `e2e/goldens/rts-height-*.png` (new, byte-identical twice, pairwise different). `verify` GREEN: typecheck 21 s, lint 21 s, unit 1:14 (154 files, 1 722 tests), perf 15 s (10 files, 32 tests), e2e 10:27 (23 files, 184 tests), e2e-serial 14 s (4 files, 7 tests), 12:09 in all, which is over the 8:00 rule: the e2e stage now prints its test time per file and `scripts/verify.mjs --shard i/n` exists; the CI matrix is NOT wired (D156 (8), BACKLOG). `npm run build && npm run artifact:pack` done (24 files, 15.65 MB, container png). Open for the user's eye: how the camera FEELS (zoom steps of 15 % of the height, the grip, the transition between 4 000 and 800 km, the bookmark flights at 5 to 15 s, the 300 m views over the x12 mountains) and what a real GPU says in the perf scene's report.

### M07b audit pass (D154): eight findings of the independent audit, fixed or answered with evidence (one session; the orchestrator owns pushing, the pull request and the Artifact)

- [x] A1. LOD pop: reproduced (5.30 % and 7.95 % at the two leaf-set changes), the cause is the camera (AGL stepping over 12x detailed ground moves it by kilometres), proved with a fixed camera and two tree states; `e2e/lodPop.test.ts` (fixed-camera swaps, 0.2 % path), `tests/render/lodSwap.test.ts` (the geometric pop in pixels with a level-only control); a geomorph was built, measured (no pixel benefit) and removed, numbers in D154 (1) and BACKLOG
- [x] A2. Relief rule: literal second implementation, flat land exactly 100 m, GLSL relief read back (`probeRelief`); mutants M14, M15 (TS and GLSL) killed
- [x] A3. Polar rule, southern hemisphere, antimeridian: unit and e2e (twelve regions), M24 and M41 killed
- [x] A4. Glacier rule and boreal tone: real shader statements evaluated, Greenland and boreal e2e views; S06, S13, B32 killed
- [x] A5. Height contract for M08: `seenHeightAt`, `lastSeenOctaves`, the criterion in D154 (5) and ARCHITECTURE "Rules for layers" (4)
- [x] A6. Executed fragment cost (`executedCost`), pinned: orbit +2.9 %, ground +14.5 % over M07a; PREVIEW 17w (6) reworded; `#mottle-0`
- [x] A7. Run-time levers: `setDetailBias`, `setFineDetail`, `setChunkDensity`, `setOctaveLimit`; e2e and unit tests
- [x] A8. `verify` over budget: the charter is verbatim and untouched; the plan is the first task of M08 (see Next); the numbers are in D154 (8)
- [x] No picture changed: no golden was regenerated; `npm run verify:fast` and `npm run verify` green (12:23 on this sandbox, e2e 10:40; D154 (8))

### M07b Terrain LOD B: detail height, slope / snow / forest / beach shading, goldens (USER GATE) - three sessions: Part A (items 1, 2, 3 and their tests), Part B (item 4 and the four visual debts), Part C (item 5, goldens, finish). The orchestrator owns pushing, the pull request and the Artifact.

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged, M00 to M07a, Tempo and TestSpeed live on this branch and in draft pull request #1; the precondition "M07a is merged" is treated as satisfied because this file lists M07a as Done). `npm ci` was already in place and `npm run verify:fast` was green at the start (137 files / 1549 tests). User feedback to respect: a steady 30 fps at the default medium tier on a real GPU, so the default tier must not get more expensive per pixel: the noise detail goes into the VERTEX path and the fragment shading stays cheap (Budgetar notes carry renderer.info and an instruction-count proxy before / after).

GÖR (Part A = items 1, 2, 3 and the tests below; DONE, see "Result of Part A")
- [x] A1. Relief source decided and recorded in DECISIONS (D145: derived from the height texture, 3x3 windows of the four corner texels blended, floor 100 m; the ruggedness layer saturates at 3 060 m and is a 4 x 4 window)
- [x] A2. `src/render/detail.ts` (no three import): the integer hash (Math.imul), 3D value noise on the unit sphere, ridged octaves scaled by relief, `octavesForLevel(level)`, `heightAt(lat, lon, maxOctaves?)`, the coast rule (land mask of the render raster decides the sign, detail faded to zero at the coast, D146)
- [x] A3. `src/render/shaders/detail.ts`: the SAME maths in GLSL (uint hash, same constants, same operation order) used by the chunk vertex shader; LOD-aware octaves (only octaves with wavelength >= 2 x vertex spacing; the last one fades with the DISTANCE, D147); `src/render/detailBounds.ts` widens the quadtree's node intervals by the detail
- [x] A4. `src/render/detailProbe.ts` + `__test.probeHash` / `probeHeight` / `probeVertex` / `probeNoise`: readback of the SAME GLSL functions (RGBA32F with EXT_color_buffer_float, else packed RGBA8, both tested), documented in ARCHITECTURE (D148)
- [x] A5. `HeightField` picking and the camera ground use the displaced surface with detail (consistent with the shader), `heightM` stays the data height of the tooltip (D149)
- [x] A6. Tests: hash parity, height parity, mutation, "detail is real", coast sign on 2000 cells, chunk cap / triangle ceilings / M07a lower bounds with detail on (`e2e/terrain.test.ts` green), vertex continuity between adjacent LODs, `heightAt` perf through `budgetMs`, picking consistency, no console errors (`tests/render/detail*.test.ts`, `tests/heightAt.perf.test.ts`, `e2e/detail.test.ts`)
- [x] A7. Side-by-side screenshots of the Alps, the Himalaya and Norway at 300 m, 2 km, 15 km AGL looked at; Budgetar notes (renderer.info, fragment cost proxy); DECISIONS D145 to D149, ARCHITECTURE index and probe, BACKLOG, PREVIEW `#detail-0`; `npm run verify:fast` green; local commit
- OPEN ON PURPOSE after Part A (the same arrangement as M07a part A): the three contact-sheet goldens of `e2e/terrainViews.test.ts` (`e2e/goldens/chunks-sheet-alps*.png`, `-himalaya*`, `-norway*`, 9.8 % / 7.4 % / ... of the pixels differ) fail because the terrain now has detail and the coast rule; they are regenerated ONCE in Part C with `UPDATE_GOLDENS=1` after a side-by-side look and justified in DECISIONS. All other e2e files that were run (terrain, globe, looks, detail) pass.

Result of Part A (this sandbox, SwiftShader): the hash is bit-identical on 1 000 values in both probe encodings; the height parity is within 0.018 % of the local relief on 1 000 mixed points (acceptance 1 %), the mutation (hash seed changed by one bit in TS) fails the same check on 640 points; "detail is real" 70.5 % of the Himalaya box points more than 20 m from the base (50 % needed); coast sign right on 995 land and 999 sea sim cells (6 coast cells where the 1024 grid and the 4096 raster disagree) and on 20 000 coast-line points; LOD pop 0.000 px on every seam of the uncapped views (the level-only control pops up to 5 px), 9.7 px at worst under the test tier's cap, covered by the skirts; `heightAt` 4.5 to 6 us (12 octaves); `pick` 0.4 ms per ray; quadtree update 0.4 ms (was 0.19). Orbit views have exactly the M07a triangles; near mountains the tree wants 3 to 4 times the leaves (Budgetar note). Amplitude 0.2 / persistence 0.42 (D145 (4)). What Part B must know: the only shading of the detail is the facet normal (stylised flat shading); the fragment shader is pinned by `tests/render/shaderCost.test.ts`; the sim of the chunk terrain is unchanged.

GÖR (Part B)
- [x] B1. Slope shading from the height + detail normal, snow line from height AND latitude AND slope (steep rock stays grey, the Himalaya plateau no longer a white wash), forest tone from the Forest class, soft beach foam; the M07a borders stay clearly visible over snow and rock
- [x] B2. Visual debts: night-light checkerboard smoothed at close range, territory tint lets the slope shading show through, the closest 10 km of altitude look like mountains
- [x] B3. Fragment cost stays cheap at the default tier (no multi-octave noise per pixel); instruction-count proxy before / after in the Budgetar notes
- [x] B4. Shading statistics with the fixed views of the prompt (snow view, Netherlands view, forest view, steep versus flat, beach band)

GÖR (Part C)
- [x] C1. Item 5: contact sheet of 3 heights over the Alps, the Himalaya and western Norway as new detail goldens (two renders in one launch byte-identical); changed M02 / M05 / M06 / M07a goldens regenerated once with UPDATE_GOLDENS=1 after side-by-side looks, justified in DECISIONS
- [x] C2. SLUT: PROGRESS, DECISIONS, ARCHITECTURE index, BACKLOG, PREVIEW (Swedish); `npm run verify` green; `npm run build && npm run artifact:pack`

ACCEPTANS (all parts; ticked = proven by a test that can fail)
- [x] Hash: 1000 values from the GLSL probe are bit-identical with TS
- [x] Height parity: on 1000 sampled points (mixed LOD levels; Himalaya, Alps, coast) |TS `heightAt(lat, lon, octavesForLevel(level))` minus the shader's height| <= 1 % of local relief; the mutation test (changed hash seed in TS) fails the same test; detail is real (> 20 m from the base height on >= 50 % of the Himalaya box)
- [x] Coast: on 2000 sampled land and sea cells `heightAt` has the right sign (land > 0, sea <= 0)
- [x] Shading statistics with the fixed views (snow view altAglM 15000 over 28.0 N 86.9 E tilt 55; the Netherlands view altAglM 15000 over 52.2 N 5.5 E; the forest view altAglM 8000 over 62 N 15 E with `__test.state()` showing Forest >= 60 % of the cells in view): snow pixels (light, low saturation) >= 5 % of the terrain region in the snow view and <= 0.5 % in the Netherlands view; forest green >= 20 % in the forest view; a steep view has a higher share of rock grey than a flat one; the beach band is lighter than open sea with a margin; thresholds fixed, measured first, never lowered below the requirement
- [x] Triangle ceilings and the M07a lower bounds hold with detail on (400 chunks, test tier <= 150k, high tier <= 1.5M triangles and <= 200 draw calls); ownership readback == sim owner also on snow and rock cells
- [x] Goldens: new detail goldens committed (two renders in one launch byte-identical); changed M02 / M05 / M06 / M07a goldens regenerated after a visual check and justified; no tolerance raised
- [x] No console errors; `npm run verify` green; build and pack done

Result of Part B and the finish (this sandbox, SwiftShader; D150 to D152): rock by the REAL slope (tangent over the x12 exaggeration), snow line by detailed height, latitude (5 400 / 2 550 / 1 650 m) and slope, tree line, boreal tone, shore foam, near-view mottling, a territory tint scaled by the terrain's luminance, smooth night lights, the raster height taking over from the vertex height where a cell is wider than a texel. Fixed views: snow 32.8 % (needs 5 %), Netherlands 0.00 % (at most 0.5 %), forest green 100 % with Forest class 100 %, rock grey steep 88.6 % against flat 0.0 %, the plateau at 1 500 km 3.7 % snow (M07a 26.1 %), the shore band 0.580 against 0.433 luminance, borders over snow and rock dE76 >= 19, the tint keeps 77 % of the luminance spread (M07a 50 %), the night step 0.028 (M07a 0.320). Goldens: six `chunks-sheet-*` and `globe-himalaya`, `globe-alps`, `globe-europe50`, `globe-night` regenerated once, three `detail-sheet-*` new; `globe-earth` and `globe-andes` stayed. The fragment shader has the same 19 fetches, 6 loops and 12 derivatives as M07a. What the next session must know: the thresholds and the snow-view heading (D151), the stylised snow line (D150 (3)), the real-GPU `#perf` check against `#detail-0` is the user's gate.

### TestSpeed: an infrastructure pass on HEAD 78beb97 (no game change; one part; the orchestrator owns pushing, the pull request and the Artifact)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged, everything lives on this branch and in draft pull request #1). Problem: `npm run verify` took about 14 to 15 minutes in this 4-core, no-GPU sandbox (unit about 50 s, perf about 10 s, e2e about 750 to 790 s); CLAUDE.md's budget is 8 minutes. The user also owns a desktop PC (10 cores, a real GPU) and may run the project there. Rule: no production behaviour, test assertion, tolerance, golden or budget changes; only how the tests are organised and run.

GÖR
- [x] S1. MEASURE: per-file and per-test time table of the e2e project and the 15 slowest unit files, written into D144 of `docs/DECISIONS.md`; where the time goes
- [x] S2. Test inventory script (every test name per file, before and after) and its report; the number of cases per file is equal or higher afterwards
- [x] S3. Speed up e2e without losing coverage (shared page per file where tests only read, no duplicate scene loads, sleeps replaced by waitForFunction on hook values, smaller viewports only where no golden or pixel rule needs 960x540, cached pack bytes, warm pages)
- [x] S4. Evaluate e2e parallelism (2 workers x 5 runs against sequential x 5 runs); adopt only if everything passes and the gain is real; perf, heap, leak and timing tests stay isolated and sequential; rewrite the CLAUDE.md "never concurrent with another Chromium" rule truthfully
- [x] S5. LOCAL GPU MODE: `LOCAL_GPU=1` in `scripts/shot.mjs` and the e2e fixtures (no SwiftShader flags, CHROME_PATH, golden compare warn, worker count from the CPU count, perf through perfguard), `npm run verify:local` as a node script, unit test that the default Chromium argument array is byte-identical to the committed baseline
- [x] S6. `docs/LOCAL.md` in Swedish for a non-developer on Windows; mention it in CLAUDE.md "Where things are", ARCHITECTURE and DECISIONS
- [x] S7. `npm run verify` green TWICE in a row (background + log) with the new wall times per stage; build and pack only if something user-visible changed (nothing should); local commits

ACCEPTANS
- [x] The e2e project runs measurably faster with the same or more test cases and assertions per file (inventory report: 149 cases / 918 expect() before, 150 / 926 after, nothing lost), and the five sleep-based flakes are gone (e2e project 802 s -> about 415 s)
- [x] `npm run verify` under 8 minutes on this machine: 7:51 (7:26 to 7:53 over six runs with the final configuration), margin about 10 s; the floor and what would lower it are in D144 (8)
- [x] Default Chromium arguments byte-identical without the switch (unit test `tests/localGpu.test.ts`); local mode plumbing unit-tested; what a real GPU would change is listed as untested (D144 (9), `docs/LOCAL.md` section 9)
- [x] `docs/LOCAL.md` exists, is Swedish, mentions every step the task lists
- [x] `npm run verify` green twice in a row (the three final runs: 7:52, 7:51 and 7:26; unit 136 files / 1 536 tests, perf 8 / 24, e2e 16 / 143, e2e-serial 4 / 7); nothing user-visible changed, so no build and pack and no republication

### Tempo: a balance pass on HEAD ef06bc0 after the user's feedback "Att erövra länder tar för lång tid" / "Jag behövde köra 4x för att den ens skulle vara spelbart" (USER GATE; one part; the orchestrator owns pushing, the pull request and the Artifact)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged, M00 to M07a live on this branch and in draft pull request #1). Goal (game seconds at 1x): what the user sees at 4x today becomes the normal pace at 1x (about 3 to 4 times faster conquest, free expansion AND contested fronts); 4x becomes a real fast-forward. Levers: the balance file only (`src/sim/rules.ts`), never the tick rate or the clock (later milestones' second-based timings).

GÖR
- [x] T1. Pace report tool `npm run sim:pace` (`tools/sim/pace.ts`, deterministic, headless, prints tables, unit test of its pure parts): (a) solo free-expansion curve at minutes 1, 2, 3, 5, 10; (b) contested conquest at troop parity on a real border, 100 % and 40 % commitment, seconds to own the defender's 197-cell disc and to own 500 cells of it, also against a counter-attacking bot; (c) the default Play match (you + 5 AI + 20 tribes) and a 12-AI Skirmish with a scripted sane human bot: top land share, human land share, nations alive, free land at minutes 1, 3, 6, 10, 15
- [x] T2. BASELINE recorded with the current constants (D142)
- [x] T3. Tune with at most 5 rounds (each round's constants and results in a table in D142) until the targets and guard rails hold over 5 seeds each
- [x] T4. Update everything the constants touch: `src/sim/rules.ts`, `docs/BALANCE.md` rows, the solo band in `tools/sim/bands.ts` (M04 rule: measured +-30 %, reason "user feedback: too slow") and the tests that pin it, tests that pin changed plan values (with justification), ENGINE_VERSION (and FORMAT_VERSION if the serialised state changes), goldens re-pinned ONCE at the end with UPDATE_GOLDENS=1 (PNG goldens only if a territory picture depends on the pace)
- [x] T5. Browser side: host advance cost per frame at 4x with the faster conquest, ownership texture uploads <= 10 per fx second at 4x, HUD numbers (gold/s, troop cap bar) still look right
- [x] T6. Docs: ARCHITECTURE index (the pace tool), DECISIONS D142 (baseline, rounds, final constants, band move, goldens), BALANCE rows, PREVIEW.md (Swedish: one sentence that the pace was raised after the feedback and that 4x is now a fast-forward), BACKLOG if needed
- [x] T7. `npm run verify` green TWICE in a row (background + log; 133 unit files / 1483 tests, perf 8 files / 24 tests, e2e 17 files / 149 tests, 752 s and 750 s), then `npm run build && npm run artifact:pack` (24 files, 15.59 MB, container png), local commit

Result of Tempo (this sandbox; the numbers, the five rounds and the reasoning are in D142): the pace is what the user saw at 4x. Solo RUS 1 591 / 3 343 / 5 196 / 8 063 / 10 786 cells at minutes 1 / 2 / 3 / 5 / 10 (it was 536 / 951 / 1 415 / 2 428 / 5 115: 3.3 times as fast in time); conquest at troop parity, 100 %, passive: a 197-cell disc in 55 s (it was 183), 500 cells of a country in 106 s (it was 354); 40 % with re-clicks 71 s and 123 s. Constants: `CAPTURE_K_MILLI` 123 -> 420, `REGEN_BASE_TROOPS_PER_SEC` 8 -> 24, `REGEN_SQRT_COEF_MILLI` 350 -> 1000; two AI rules (`AI_WAR_START_TICKS` 2000, `AI_WAR_MAX_SHARE_PCT` 15, with a Cancel at the cap). `ENGINE_VERSION` 6, both golden hash files re-pinned once, the solo band moved to 5 600 to 10 500 / 7 500 to 14 000 (M04 rule). `npm run sim:pace` is the tool: re-run it after any constant change. Browser side: 0.037 ms host advance per frame at 4x, 8.6 ownership uploads per fx second, HUD checked in screenshots. What the next session must know: `docs/BACKLOG.md` "Tempo pass" (no defender attrition, one 40 % click does not finish a country, the "Nära taket" warning is more frequent); the user's play session decides whether the pace is right.

ACCEPTANS
- [x] 100 % commitment at troop parity: a 197-cell start disc falls in about 45 to 90 s and 500 cells of a country in about 1.5 to 3 min (game seconds, 1x); 40 % commitment is slower but active (55 s and 106 s; 40 % with re-clicks 71 s and 123 s; one single 40 % click 217 s for the disc)
- [x] Solo free-expansion curve about 3 to 3.5 times faster in time (about 1 500 or more cells at minute 1 instead of 540), saturating where the troop pool or caps bind (RUS 1 591 at minute 1; the old 5-minute size after 1.5 minutes and the old 10-minute size after 3: 3.3 times; median of six capitals 1 331 at minute 1)
- [x] Guard rails over 5 seeds each (default Play match and 12-AI Skirmish, 1x, sane human bot): no nation above about 25 % of the land at minute 10; AI nations and tribes mostly alive after 3 minutes; a passive player is not wiped out in the first 2 minutes (worst seed: top AI nation 15 % in the Play match and 15.3 % in the Skirmish at minute 10, seeds 1 to 10; the HUMAN is not capped, see D142 (2))
- [x] Ratio tests pass unchanged (4:1 troops >= 1.4x speed, mountain >= 2.2x price, uphill dearer than downhill); the sim is deterministic with integer arithmetic only
- [x] Browser side: advance cost per frame at 4x within the existing budgets, texture uploads <= 10 per fx second at 4x, HUD sane
- [x] Goldens re-pinned once and justified; `npm run verify` green twice in a row; build and pack done

### Tempo audit fixes (one session after the audit of the tempo pass; the orchestrator owns pushing, the pull request and the Artifact)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged). Read D143 of `docs/DECISIONS.md`. No conquest or economy constant changed; the pace of D142 stands.

GÖR
- [x] F1. `SimView.attackRunning` (StateView, ViewMirror through `ViewSnapshot.attacks`), the AI cancels only attacks that still run; contact and sliver rules so the AI sends no refused intent (Skirmish seeds 1 to 12: 0 refusals)
- [x] F2. AI caps: `AI_EXPAND_MAX_SHARE_PCT` 20 (expansion cap), retaliation at the war cap, `AI_WAR_HUMAN_START_TICKS` 3600 (no war on a human before 360 s), `AI_WAR_MIN_CONTACT_LENGTH` 2; BALANCE rows, public.ts exports, pinned list
- [x] F3. Guard rails: top share at minutes 15, 20, 25, frozen-board check, passive player at minute 5; `sim:pace` plays 25 minutes, `asia` setup on request, solo income and `--prices`
- [x] F4. Tests: contested pace (POL disc and country, 40 %, counter-attacker, the five-location table), `SOLO_BAND` pin, the pace tool (country goal, re-click interval, counter-attacker, top AI share without the human, solo minute index, passive minute, locations, human bot ratio), the AI (refused Cancel, retaliation, expansion cap, human seat, sliver), driver seeds 1 to 6, mirror equals sim for `attackRunning`
- [x] F5. Docs: D143, BACKLOG carry-over for M09 to M19 (income table, M09 bullet, M12a beachhead, caps), PREVIEW 17j and 17v, ARCHITECTURE, BALANCE
- [x] F6. `npm run verify:fast`, `npm run verify` (background, log), `npm run build && npm run artifact:pack`, local commit

ACCEPTANS
- [x] No refused intent in the Skirmish seeds 1 to 6 (and none ever a `REJECT_NO_ATTACK`); the new tests fail on the old behaviour (mutation checked)
- [x] Guard rails over seeds 1 to 5 of Play, Skirmish and East Asia: all PASS (top AI share at most 20.1 % at minutes 15 to 25, passive player alive at minute 5)
- [x] The contested pace is asserted by a test that fails when it falls back to the old pace
- [ ] `npm run verify` green; build and pack done

### M07a Terrain LOD A: quadtree chunks and geometry (USER GATE) - three sessions: Part A (items 1, 2, 3, 5, 6 and their tests; DONE, see below), Part B (items 4, 7), Part C (item 8, goldens, finish). The orchestrator owns pushing, the pull request and the Artifact.

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged, M00 to M06 live on this branch and in draft pull request #1, so the precondition "M05/M06 merged" is treated as satisfied because they are Done here). Note: the prompt says flyTo is M08; it already exists (`src/render/flyTo.ts`, M06). User feedback to respect: a steady 30 fps at the default medium tier on a real GPU (M05/M06), so the default tier must not cost more triangles or per-pixel work than the fixed mesh (the numbers are in the "Chunk-terräng mot det fasta nätet" table of `docs/ARCHITECTURE.md`: 0.41x the triangles at the default orbit view, within +-9 % at the other views).

GÖR (Part A = items 1, 2, 3, 5, 6)
- [x] A1. Quadtree of instanced chunks: 8 roots (4x2, 90 deg), one shared 32x32-cell mesh (33x33 vertices; test and low tier 16x16), instance data (centre direction as high and low float32 parts, tangent basis, lat/lon extent, level, neighbour levels), LOD rings with hysteresis (merge at 1.25x the split distance), frustum and horizon culling, skirts on all four edges first; vertex morphing NOT built (skirts + hysteresis suffice, D133)
- [x] A2. Heights from the global 4096x2048 sqrt-coded height texture with the x12 exaggeration (no noise); land never changes sign against sea at coasts (never below sea level, sea exactly 0, land above it)
- [x] A3. Precision: no vertex position from absolute float32 world coordinates (chunk minus camera from hi / lo parts, half-angle offsets, `mat3(viewMatrix)`); dynamic near / far from the camera AGL; reversed depth NOT used (EXT_clip_control exists here, nothing needs it: 24-bit depth resolves < 0.5 % at every altitude)
- [x] A5. Tiers: chunk density per tier (cells, split distances) and a hard cap on chunks (150 / 100 / 300 / 400, never above 400); the old fixed mesh behind `?terrain=fixed`, the `?chunks=1` debug colouring; both registered with `registerDevMode`; hash forms `#terrain-fixed` and `#chunks`
- [x] A6. Test hooks: `__test.setView({altAglM})`, `__test.state().terrainMode` and `.terrain {chunkCount, lodLevels, triangles, drawCalls, ...}`, documented in `docs/ARCHITECTURE.md`
- [x] A7. Tests of Part A: crack detector (0 magenta pixels at the six altitudes, the detector proven on a synthetic hole and on the real renderer with the skirts off), lower bounds, float32 vs float64 precision, 1e-7 degree jitter, chunk cap under fuzzed poses (unit and browser), LOD hysteresis, quadtree perf test, headless high-tier run
- [x] A8. Budgetar rows and the chunk vs fixed table in `docs/ARCHITECTURE.md`; D133 and D134 in `docs/DECISIONS.md`; BACKLOG entries; PREVIEW rows for `#terrain-fixed`, `#chunks`, `#test_chunktier-high`; BALANCE untouched (render config only)
- [x] A9. `npm run verify:fast` green and the new e2e file green alone; local commits. Open on purpose: the golden test of `e2e/looks.test.ts` (and the golden tests of M05 / M06 that render the globe) differ from the committed PNGs because the default terrain changed; regenerated once in Part C (D134)

GÖR (Part B: items 4 and 7; DONE)
- [x] B1. Item 4 (D135: the finer warp bounded by the fold test, the two-part cell position, pixel size from the camera-relative position): the territory/border shader on the chunk material (the shared fragment module already carries it: the ownership texture, the owner palette and the selection outline are uniforms of the chunk material too; Part B has to check it close up and scale the UV domain warp so borders look organic at 300 m), the ownership texture interface unchanged
- [x] B2. Item 7 (D136, D137): terrain-aware orbit camera minimum (about 1 km AGL), zoom steps proportional to the height, `?view=alps-valley` and `?view=himalaya-valley` (`#view-alps-valley`, `#view-himalaya-valley`) via `registerDevMode` through `src/app/params.ts`, listed in `docs/PREVIEW.md`; `setViewAtAgl` in `src/render/camera.ts` is the solver for "the camera N metres above the ground", reuse it

GÖR (Part C: item 8 and the finish)
- [x] C1. Item 8 (D138, D139; six sheets, 0 px differ on the second run, all six M02 goldens rewritten once after the side-by-side look): goldens, contact sheet of 3 heights over the Alps, the Himalaya and western Norway (about 61.5 N 6 E), normal view and `?chunks=1`; the changed M02/M05/M06 goldens regenerated ONCE with `UPDATE_GOLDENS=1` after looking at old and new side by side, justified in DECISIONS
- [x] C2. SLUT (PROGRESS, DECISIONS D135 to D139, ARCHITECTURE, BACKLOG, PREVIEW 17u and the two table rows; verify and pack: see below): PROGRESS, DECISIONS, ARCHITECTURE index, BACKLOG, PREVIEW; `npm run verify` green; `npm run build && npm run artifact:pack`

ACCEPTANS (all parts; ticked = proven by a test that can fail)
- [x] Without flags `__test.state().terrainMode === 'chunks'`; with `?terrain=fixed` (and `#terrain-fixed`) it is 'fixed' (`e2e/terrain.test.ts`)
- [x] Six altitudes over the Alps via altAglM (orbit, 3000 km, 500 km, 60 km, 8 km, 300 m AGL): 0 magenta pixels in the terrain region; the detector proven by a synthetic hole (`tests/render/crackDetector.test.ts`) and on the real renderer: with the skirts off the views at 3000 km, 500 km, 60 km and 8 km (different LOD levels side by side) give 143, 167, 129 and 108 magenta pixels
- [x] Lower bounds at the three lowest altitudes: chunkCount >= 12, >= 3 distinct LOD levels, test-tier triangles >= 20k, `?chunks=1` >= 12 distinct chunk hues (and the pixel at a CPU-picked chunk centre has that chunk's hue: 36 of 37, 25 of 25, 40 of 40), >= 200 distinct colours in the terrain region (a coastal view at 300 m: the plain M02 look has 1 to 37 colours over inland ground, D133 (8)); the high tier headless: 100k to 1.5M triangles (470k to 864k), <= 200 draw calls (3); chunk count <= 400 everywhere (unit: 300 poses per tier; browser: 60 poses on the high tier, worst 398)
- [x] Jitter: camera offset 1e-7 degrees at 300 m AGL changes 0 of 518 400 pixels of the shaded view and 15 of the `?chunks=1` edge picture (limit 0.2 %; the 1e-3 degree control changes 15 %), no NaN; unit test: chunk-relative float32 vertex positions within 1 cm of float64 (worst 3.7 mm for chunks within 50 km)
- [x] Ownership: readback == sim-owner on sampled cells, including cells on both sides of at least one border giving different colours (M05's method) (`e2e/terrainViews.test.ts`: 206 cells, owners 7 | 8, pixel dE76 21.6)
- [x] Orbit camera: mouse zoom stops at 0.8 to 1.5 km AGL over sea level and over the Himalaya (`tests/render/groundZoom.test.ts`: rests at 1000 m); both `?view=` addresses load (query and hash) with no console errors and show 9 to 11 LOD levels (`e2e/terrainViews.test.ts`)
- [x] Goldens: new contact sheets committed (two renders in one launch byte-identical); changed M02/M05/M06 goldens regenerated after a visual check and justified; no tolerance raised - Part C
- [x] No console errors (every e2e test asserts an empty console); `npm run verify` green: 130 unit files (1444 tests), perf 8 files (24 tests), e2e 17 files (149 tests, 776 s); `npm run build` and `npm run artifact:pack` done (container png, 24 files, 15.59 MB)

Part A results (measured in this sandbox, SwiftShader, test tier unless said): quadtree update median 0.19 ms and chunk terrain update 0.22 to 0.23 ms per frame on the medium tier (`tests/chunkQuadtree.perf.test.ts`, budget `budgetMs(1)`); an unchanged camera costs 0.3 us; 60 renders at 320x180 retain 0.05 MB; chunk frames cost 1.4 to 1.7 times the fixed mesh in SwiftShader (0.6 against 0.4 s at 900 km). What Part B must know: see the handoff of the report and D133 / D134.

### M07a audit fixes (one session after the audit of M07a; the orchestrator owns pushing, the pull request and the Artifact)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged). Read D140 and D141 of `docs/DECISIONS.md`.

GÖR / ACCEPTANS
- [x] F1. LOD stable under a binding cap: stateful two-pass budget in `src/render/quadtree.ts` (pass A re-admits last frame's splits, drop-outs remembered; pass B with a reserve; at most four evictions per frame); tests "the LOD is stable under a binding cap" (+-1 % wobble: at most one level change under the focus in 100 frames on every tier; monotone zoom-in: merges only as evictions)
- [x] F2. The production `ChunkTerrain` under test: `src/render/quadParams.ts` shared with `tests/helpers/chunkWorld.ts`, `tests/render/chunkTerrainWiring.test.ts` (17 hand mutants killed)
- [x] F3. Antimeridian and pole views in the neighbour-level brute force (m29 killed); the peak beyond the horizon (n15 killed)
- [x] F4. E2E mutants of the shaders and of the globe wiring run by hand; survivors got targeted assertions (D141)
- [x] F5. Rules for layers on the terrain (precision of props, sim against render altitude, budget row 0) in `docs/ARCHITECTURE.md` and BACKLOG
- [x] F6. Goldens regenerated once (the Himalaya and Norway debug sheets, D141), `npm run verify` green (132 unit files / 1461 tests, perf 8 files / 24 tests, e2e 17 files / 149 tests, 885 s), `npm run build && npm run artifact:pack` done

### PerfGate: stable burst gate and a faster conquest kernel (focused stabilisation on HEAD 55960a3, no new milestone; one part; the orchestrator owns pushing and the Artifact)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged, M00 to M06 live on this branch and in draft pull request #1). Why: the M04 acceptance "100 000 cells in one tick, median <= budgetMs(50)" (`tests/conquestBurst.perf.test.ts`) swung between 42 and 65 ms on this 4-core VM against a budget of about 56-58 ms and failed on random `verify` runs. The 50 ms budget, the statistic (median) and the perfguard calibration are NOT changed.

GÖR
- [x] 1. MEASURE: the burst test alone 20 times (one process per run) and inside the whole perf project 5 times; min / median / max and the perfguard factor; bisect over 69798de, 8a29cc4, be1db76, 5f597c8, ee186f0, HEAD with git worktrees; name the change that cost the time (or show that there is none)
- [x] 2. FIX THE CAUSE: profile `advanceAttack`, optimise the hot loop with byte-identical behaviour (all golden hashes and sim tests unchanged, no ENGINE_VERSION change); target median at most 60 % of the budget on this machine
- [x] 3. ROBUST GATE without loosening it: budget `budgetMs(50)` and statistic median unchanged; more samples (at least 5 after at least 2 warm-ups), worlds built before the timed loop, GC isolated; the statistic is in the test name; 30 runs with zero failures and a worst median below 85 % of the budget
- [x] 4. The other `*.perf.test.ts`: the whole perf project 15 times; any test whose worst median exceeds 70 % of its budget is fixed the same way
- [x] 5. `npm run verify:fast` and the perf project green; DECISIONS (next free D-number) and this file carry the findings (the offending change, before and after medians)
- [x] 6. SLUT: ARCHITECTURE index, BALANCE (no constant changed, so no row), `npm run verify` green, local commit; `npm run build && npm run artifact:pack` NOT run (nothing the user can see changes, the Artifact is NOT republished)

ACCEPTANS
- [x] The cause is named with numbers (bisect table, 20 + 5 runs of the unmodified kernel)
- [x] All golden hashes (`e2e/goldens/sim-hashes.json`, `e2e/goldens/match-hashes.json`) and every sim test are unchanged; `ENGINE_VERSION` unchanged
- [x] Burst median at most 60 % of the budget on this machine (or the measured limit is stated with the evidence)
- [x] 30 runs of the burst test: zero failures, worst median below 85 % of its budget
- [x] 15 runs of the whole perf project: no test above 70 % of its budget, or it is fixed
- [x] The test keeps `budgetMs(50)`, the median, at least 5 samples after at least 2 warm-ups, and says the statistic in its name
- [x] `npm run verify` green

Result of PerfGate (this sandbox; the numbers and the reasoning are in D132):
- THE CAUSE. The M04 kernel (69798de) measures 43.5 ms TODAY on this VM, where M04 logged 28 to 37 ms; HEAD measures 43.5 to 46.5. Only be1db76 ("terrain slows the capture") added a visible step (+4 to +5 ms, 42.6 to 47.4 in 12 interleaved rounds); the exposure, home-rules and trait commits added nothing measurable. The rest of the gap is the machine: the kernel is cache-bound (about 25 cache lines per captured cell), perfguard calibrates with a compute-bound loop, so a busy neighbour slows the kernel by up to 1.65x while the factor stays at 1.1 (budget 55 ms).
- THE KERNEL. Median 43.5 -> 34.3 ms (22 % faster) with byte-identical results: `tests/sim` and `tests/host` green, every golden hash unchanged, `ENGINE_VERSION` unchanged, `sim:run` (seeds 1, 2, 5) and `sim:scenario` (12 + 20 for 3 minutes and 6 + 10) equal to the HEAD worktree. What changed: neighbours read in place, a flat-price table, locals for the attack numbers, the port mask for `portRuns`, the `queued` guard, the packed outbox, bigger first capacities, a scaled `pickIndex`.
- THE GATE. `budgetMs(50)` and the median kept; 21 samples after 3 warm-ups, worlds built and gc'd outside the clock, a 10 s cool-down before a failing median reports so that the perf project's one retry sees another stretch of the machine. 30 runs alone: 0 failures, 0 retries, medians 32.2 / 34.3 / 39.5 ms (min / median / max), worst 66.9 % of the budget, median 58.8 %. 15 runs of the whole perf project: 0 failures, 0 retries, burst worst 65.4 %; no other test above 56 % of its budget. (An earlier set of 15 project runs before the cool-down had one run that failed twice in a 10 s slow stretch.)
- `npm run verify` GREEN (typecheck, lint, 116 unit files / 1352 tests in 49 s, perf 6 files / 18 tests in 6.5 s, e2e 15 files / 127 tests in 568 s; no golden PNG or hash touched; the burst line of that run: median 35.0 ms, 61 % of a 57.2 ms budget).
- Not done on purpose: no change of the budget, the statistic or the perfguard calibration (a cache-bound second reference is in BACKLOG).

### M06fix: flaky HUD heap test, D121 wording, map identity of cut-outs, small setup UX fixes (focused follow-up after the M06 play audit, no redesign; one part; the orchestrator owns pushing and the Artifact)

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (unchanged; nothing is merged, M00 to M06 live on this branch and in draft pull request #1).

GÖR
- [x] 1. `e2e/hud.test.ts` "500 refreshes": heap check through `heapDelta` (gc, median of 3), limit 1 MB kept; real allocation fixed if gc does not remove it; 40 runs in separate processes with 0 failures; every other raw heap read in `e2e/` and `tests/` converted or justified
- [x] 2. D121 (and every doc line that repeats it) says exactly: `#seed-7` equals the M05 match only with the AI off (`ai=0`, hash 68548039 before and after M06); with the AI on it differs as D118 says
- [x] 3. Map identity: a region cut-out gets its own `mapHash`, different from the pack hash and from every other region, stable across runs; tests pin it (mutation checked); code fixed if it does not hold
- [x] 4a. Escape in the setup goes Back (blurs the search box first, Back on the second press); Enter in the search box on a disabled first row selects nothing
- [x] 4b. Plural-aware cell count key ("1 cell" never "1 celler") in both tables wherever the setup shows cells
- [x] 4c. The chosen UI language is saved with the prefs and restored on reload
- [x] 4d. A custom nation name equal to a real country or to an AI nation name of the same match is refused with a reason (sv, en) or auto-suffixed
- [x] 4e. The refusal text for a too-small land mass starts with a capital letter and a subject, sv and en
- [x] 5. BACKLOG: unfixed finds, and the verify time note (about 8.5 minutes, shard e2e into a CI job matrix when it passes 10 minutes)
- [x] 6. Docs (ARCHITECTURE index, DECISIONS, PREVIEW.md if visible behaviour changes), `npm run verify` green TWICE in a row, `npm run build && npm run artifact:pack`, local commit

Result of M06fix (this sandbox): `npm run verify` GREEN TWICE in a row (569 s and 580 s; typecheck, lint, 116 unit files / 1352 tests, perf 6 files / 18 tests, e2e 15 files / 127 tests), then `npm run build && npm run artifact:pack` (24 files, 15.55 MB, container png). The HUD heap test: 40 of 40 runs in separate processes passed, heap retained by 3000 refreshes (gc, median of 3) 14 840 to 14 864 bytes against the 1 MB limit (no HUD allocation to fix). New tests: `tests/app/mapIdentity.test.ts` (11), `tests/app/nameTaken.test.ts` (7), `tests/app/langPref.test.ts` (8), `tests/i18nPlural.test.ts` (5), `tests/rawHeap.test.ts` (2), `e2e/setupFix.test.ts` (10); mutants killed: cut-out keeps the pack hash (two variants), Enter on a disabled row, no Escape handler, singular text, lower-case reason, no language restore. Two earlier assertions changed because the TEXT they pin changed on purpose (D131 point 5). No golden moved. Nothing is pushed, no pull request opened, no Artifact published (the packed folder artifact is ready for the orchestrator).

ACCEPTANS
- [x] The HUD heap test passes 40 of 40 runs in separate processes and uses `heapDelta`
- [x] No raw heap read without gc is left in `e2e/` or `tests/` unless justified in a comment
- [x] D121 is correct and no other doc claims the unconditional "same match as before M06"
- [x] A test fails if a cut-out keeps the pack's map hash, or two regions share one
- [x] Each of 4a to 4e has a test or an e2e assertion that fails without the fix
- [x] BACKLOG has the verify-time note
- [x] `npm run verify` green twice in a row; build and pack done

### M06 Meny: riktigt land eller eget land - ALL ITEMS TICKED (Part A: sim and pure logic; Part B and the finish: menu DOM, flyTo, outline, flags in the HUD, wiring, Playwright, docs, `npm run verify`, build and pack). The orchestrator owns pushing, the pull request and the Artifact publication.

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (still the initial commit; NOTHING is merged, M00 to M05 live on this branch and in draft pull request #1; the precondition "M05 is merged" was treated as satisfied because this file lists M05 as Done, as the orchestrator instructed). `npm ci && npm run verify:fast` was green at the start (90 files / 1114 tests). The M05 user gate (the 10-minute play session) is still pending; M06 builds on M05 as it stands and keeps every M05 behaviour and test.

GÖR, Part A - DONE (this session: sim and pure logic; items 2, 3, 4, 6, 7 and the seat label provider; NO menu DOM, no flyTo, no shader highlight; nothing pushed, no PR, no Artifact)
- [x] A0. Preflight (merge SHA recorded, verify:fast green), this checklist
- [x] A1. Rules (`src/sim/rules.ts` plus `docs/BALANCE.md` rows): home-land cost percent, trait cap and mapping, minimum country cells, capital distance, AI nation default and maximum
- [x] A2. Sim state: optional home rules (`MatchConfig.homeRules`, config bit 8): country id per cell, home country per seat, port income and defence multipliers per seat; serialised and hashed ONLY when the flag is on (a match without it is byte-identical to M05); the cost rule in `advanceAttack`; caps enforced in the setter and in `deserialize`
- [x] A3. `countDisc` (dry run of the Spawn disc, the one spawn algorithm) and `src/sim/setup.ts` (pre-spawn of seats at tick 0, seat rules, trait mapping, mask overlay)
- [x] A4. Regions (`src/data/regions.ts`, lat/lon rectangles documented in one file) and the playable mask (cells outside the mask become unplayable in the match world; Spawn and Attack validate it through the sim's playable grid)
- [x] A5. Landmasses and eligibility (`src/app/landmass.ts`, `src/app/eligibility.ts`): >= 8 cells AND connected land mass of the capital >= K, reasons as i18n keys with the "X of 197" parameter, the same check for a custom start cell
- [x] A6. Flags (`src/ui/flag.ts`): seed to FlagSpec, `drawFlag(ctx, spec, w, h)`, golden hash on the spec and on the draw commands, >= 45 distinct images among 50 seeds, custom colours inside dE 10
- [x] A7. Country search (`name_en` and `name_sv`, case and diacritic tolerant) as a pure function
- [x] A8. `src/app/prefs.ts` (`getPref`, `setPref`, JSON, try/catch, memory fallback, key prefix)
- [x] A9. Match setup (`src/app/matchSetup.ts`): options as pure config, `createMatch(config)` pure and seeded with an error result for an invalid config, AI nations from a seeded order of selectable countries (capitals >= 17 cells apart, a candidate with < K start cells replaced by the next), invented names in the neutral mode, flags and names for every nation, the seat label provider (`src/ui/seatLabels.ts`)
- [x] A10. AI driver: the human seat(s) and the AI seats are parameters, each AI seat has its own random stream derived from seed + seat
- [x] A11. Tests for all of the above (the 20-country fairness check, every selectable country in a separate slower test, negatives, home-land and trait caps, prefs with throwing storage, same config + seed same hash)
- [x] A12. Docs (ARCHITECTURE, DECISIONS, BACKLOG), `npm run verify:fast` green, committed locally

Result of Part A (this sandbox): `npm run verify:fast` green (typecheck, lint, 103 unit files / 1242 tests, 54 s on this VM); the perf project (`vitest run --project perf`) green (6 files / 18 tests, the conquest and AI budgets untouched by the new cost branch); `e2e/sim.test.ts` and `e2e/ai.test.ts` run alone and green (the sim golden hashes are UNCHANGED: a match without `homeRules` is byte-identical to M05; no golden PNG touched). Nothing is pushed, no pull request opened, no Artifact published. New committed data: `e2e/goldens/match-hashes.json` (four built matches, tick 0 and tick 600). Measured: `createMatch` of a default match (13 nations, 20 tribes, 1024x512) about 100 ms in Node after the one-off `prepareWorld` (about 140 ms) and the first region analysis (about 60 ms, cached per region); 146 of 242 countries are selectable in the world (96 of them with fewer than 400 cells; 79 excluded on purpose, 78 have fewer than 8 cells, 16 a land mass below K, 1 no capital on land), Europe 41, East Asia 10, Americas 22, Africa and the Middle East 63; trait multipliers span 925 to 1100; the 50 first flag seeds give 50 distinct pictures. Mutation checks (each mutant killed by the tests named in D113 to D118): discount 100 %, cost hook removed, discount for every seat, discount on any cell, no clamp, no cap in `deserialize`, home block outside the hash, mask a no-op, no dry-run check, no capital distance, a land mass limit of 100.

Notes for Part B (read before starting; what Part A built and how to use it)
- THE ENTRY POINT. `createMatch(world, config)` (`src/app/matchSetup.ts`) returns `{ok, match}` or `{ok:false, error:{code, key, params}}` (show `t(error.key, error.params)`). `world` is a `PreparedWorld` (`prepareWorld(data)` of `src/app/matchWorld.ts`); build the `WorldData` in the page from what `src/app/globeApp.ts` already loads: `sim: {width, height, terrainClass, meanElev, cosQ15: meta.sim.cosQ15}`, `country: sim.country`, `coast: sim.coast`, `meta`, and `overrides` (`loader.loadOverrides()`, NOT loaded by `src/app/globeApp.ts` yet). `prepareWorld` and the first `analyse(region)` cost about 140 + 60 ms: do them once while the menu is open. `match.state` is a `GameState` at tick 0 with every nation and tribe already placed (K = 197 cells each), `match.seats` / `match.labels` give names and flags, `match.humanSeat`, `match.humanColor` (a custom colour, 0xRRGGBB, null for a real country), `match.region`, `match.homeRules`, `match.config` (the options, `difficulty` stored).
- WIRING. `MatchSession.create(world, options)` still builds the M05 match from a bare `SimWorldInput` (so every existing test keeps working); give it a second entry (for example `MatchSession.fromState(state, {humanSeat, ai, interpolate, driverSeed})`) that takes `match.state` and starts `new MainThreadHost(state, {speed: 1, driver: new AiDriver(seed, {humanSeats: [humanSeat]})})`. `LOCAL_SEAT` (0) is still a constant used in `MatchSession`, `src/app/globeApp.ts`, `clickTarget`, the HUD and the palette (owner 1 = you = magenta): make the local seat a field and keep seat 0 the default. A match from `createMatch` has nobody to spawn: the HUD banner, `spawnAt` and the click-to-spawn path are for the M05 flow only (`phase.spawnPick` must not show when you already hold land: `bannerState(phase, ticksLeft, spawned)` already says `spawnDone` for a spawned seat); decide the spawn phase length (the config has `spawnPhase`, default true: 20 s without attacks, then 5 s immunity).
- OWNER COLOURS. `src/render/ownerPalette.ts` maps ownerId to a colour (owner 1 is magenta, tested to be >= 25 dE76 from every other). A custom nation's chosen colour (`match.humanColor`) needs an override of entry `humanSeat + 1` in the LUT (and the dE test must cover the chosen swatches in `CUSTOM_COLORS`); for a real-country player the default magenta stays.
- HUD AND LEADERBOARD. `match.labels.name(seat)` and `.flag(seat)` replace `seatName` (`src/ui/hudLogic.ts`); draw a flag with `drawFlag(canvas2dContext, spec, w, h)` (a `FlagCanvas` is any `CanvasRenderingContext2D`); the HUD refresh must not allocate per frame, so draw each flag once into a small canvas per seat and reuse it. The labels read the UI language at call time; re-read them on `onLanguageChange`.
- THE MENU. Search: `searchCountries(prepared.countries, query, getLanguage())` (hits with `.country`, in rank order) and `countryName(country, lang)`; eligibility: `listCountries(prepared, region)` gives `{country, eligibility:{ok, key, params}}` for the list (show the reason with `t(key, params)` on a disabled row) and `startCellEligibility(prepared, prepared.analyse(region), cell)` for a custom start click (`resolveClickCell` of `src/app/match.ts` gives the cell; its `reason`/`key`/`params` go through `t()`). The slider for AI nations ends at `maxAiNations(prepared, config)`. `CUSTOM_COLORS` are the swatches, `makeFlagSpec(seed, {primary})` the custom flag (the menu may reroll `flagSeed`), `DIFFICULTIES` the three levels, `CUSTOM_NAME_MAX_CHARS` the name limit (`src/ui/uiConfig.ts`). Region names for the menu (`setup.region.*`) and every menu string are NOT in the tables yet (Part A added only the reason and error keys: `setup.reason.*`, `setup.start.terrain`, `setup.error.*`). `getPref` / `setPref` store the menu choices; the neutral mode draws no borders and no country names (the shader needs an uniform for it: `Globe.setBorderStrength(0)` exists for the lines; the tooltip names come from `countryNameMap`).
- ADDRESS / DEV PANEL. The seed field of the Dev panel (id `seed`) must feed `MatchSetupConfig.seed`; `parseParams` already reads `seed` (default 1). `?test=1` still needs the M05 standard match for the existing e2e files (`ai=0`, seed 7 script); add the new menu path next to it, do not replace it.
- GOLDENS. `e2e/goldens/match-hashes.json` has `{ticks: 600, hashes: {name: {initial, after}}}` for four configs defined in `tests/app/matchGolden.test.ts` (`sweden-default`, `custom-central-europe`, `custom-neutral`, `europe-skirmish`); the Chromium test must build the same configs through the page's own `createMatch` and compare both hashes (`window.__test.hash()` already returns the sim hash; run the AI with `new AiDriver(seed, {humanSeats: [humanSeat]})`, the config's seed). If Part B changes any rule of the sim, re-pin once and say why in DECISIONS.
- CLARIFICATIONS I TOOK (the orchestrator could not be asked): home land only in real-country matches (D113); the land mass counts playable cells only, Peak included in the exclusion (D112); Greenland is not selectable (D112); the playable mask is a terrain overlay, not a new state array (D114); `flyTo` goes in `src/render/flyTo.ts` (later, Part B); East Asia holds 10 countries so the menu must clamp the AI count.
- THE START DISC "within 2 cells of Stockholm" (Part B's Playwright check): the capital of Sweden is the city cell of Stockholm itself (meta cell 89651), and the disc is built around it, so the capital cell IS Stockholm's cell and the disc reaches at most 13 cells away (a coast stretches it); check the capital cell and that the disc holds it.

GÖR, Part B - DONE (the menu DOM and what the user sees; nothing pushed, no PR, no Artifact publication)
- [x] B1. `flyTo(lat, lon, distKm)` in `src/render/flyTo.ts` (NOT in a folder named camera as the prompt says: `src/render/camera.ts` is a file, D120), timed by `fxNow()`, unit test that the end position is reached (`tests/render/flyTo.test.ts`, 12 tests)
- [x] B2. Main menu and setup screen (DOM, `data-testid`, all strings through `t()` in sv and en): real country (search list or click on the globe), custom nation (name, colour, procedural flag with a live preview, free start click with a reason on an invalid click), match options (area, AI nations, tribes, difficulty, seed, neutral mode), the neutral disclaimer; works without any URL parameter and with localStorage blocked (D121)
- [x] B3. Outline of the chosen country (id raster, a 256-entry table, D122) and the neutral mode that draws no country lines or names (D125)
- [x] B4. Flags and country names in the leaderboard and the HUD (the label provider, D124), the Dev panel seed field is the address seed that the setup uses as its default (D121)
- [x] B5. `MatchSession.fromMatch` and `globeApp` build the match through `createMatch` (the standard M05 match stays: Play button, `?test=1` without `menu=1`); the M05 e2e files are unchanged
- [x] B6. Playwright (`e2e/setup.test.ts`, 13 tests, D126): search "Sweden", the flight with the outline (screenshot), start, the capital is Stockholm's cell, 60 s fast-forward without errors; a custom nation spawns exactly where clicked and invalid clicks show a reason; Skirmish with no cell outside the mask for 4 minutes; same hashes as Node

GÖR, finish - DONE
- [x] F1. Goldens: NOTHING re-pinned (no sim rule changed in part B; `e2e/goldens/sim-hashes.json` and `e2e/goldens/match-hashes.json` equal in Node and Chromium; no PNG golden moved). `docs/PREVIEW.md` (Swedish, section 5c) written; DECISIONS D120 to D126; ARCHITECTURE; BACKLOG; BALANCE unchanged (part B adds no sim number: the UI numbers are in `src/ui/uiConfig.ts`, the outline numbers in `src/render/config.ts`)
- [x] F2. `npm run verify` green, `npm run build && npm run artifact:pack` (the sizes are in the result below), committed locally (no push, no PR, no Artifact publication)

Result of Part B and the finish (this sandbox): `npm run verify` GREEN (typecheck, lint, 108 unit files / 1282 tests in 46 s; perf 6 files / 18 tests; e2e 14 files / 115 tests in 448 s; 8 min 33 s in all). Every golden is unchanged (`e2e/goldens/sim-hashes.json`, `e2e/goldens/match-hashes.json`, every PNG): part B changed no sim rule, so nothing was re-pinned. `npm run build && npm run artifact:pack`: 24 files, 15.55 MB (container png; the b64 container 20 files, 7.05 MB), includes `public/data/overrides.json`. Measured in Chromium (SwiftShader): `prepareWorld` plus the first country list 95 ms; `createMatch` of a default match (world, 12 AI nations, 20 tribes) 85 to 116 ms, with 600 ticks of the AI 167 ms; Start click to HUD 342 ms; the outline pixels on Sweden 0 before and 3 062 after; 5 863 pixels change when the country lines are switched off; the Europe Skirmish over 4 minutes owned 0 cells outside the mask at every minute; the four golden matches equal in Chromium and Node. Screenshots looked at (960x540, 1920x1080 and 390x844, Swedish and English): the menu, the setup (real country, disabled country, custom nation, invalid clicks, the neutral mode), the outline of Sweden, Germany, Japan and Iceland, the HUD with names and flags. The full e2e run found two things that were fixed: the flag canvases of the HUD broke the one-canvas test of `e2e/devpanel.test.ts` (they are now created only for a match with names and flags) and the fixed placeholder set of the i18n test in `e2e/hud.test.ts` (D126). No mutation check was made of the new e2e tests. Nothing is pushed, no pull request opened, no Artifact published (the orchestrator does that; the packed folder is the artifact folder, gitignored). (The audit that followed re-pinned the match goldens once, see D130.)

M06 audit fixes (after the independent audit; D127 to D130)
- [x] The two link chips of the start page are hidden while the setup is open and come back with Back (they sat on the primary button); e2e at 960x540 and 390x844 on the plain page
- [x] `homeId` is always the country's own id: a merged territory is home land of nobody and has its own outline (D127); the home block of the golden matches changed, `e2e/goldens/match-hashes.json` re-pinned once (D130)
- [x] "Fair" = equal cells, written down with the numbers (D128, BALANCE) and pinned by a characterisation test; the weighted start disc is a candidate for M09 (BACKLOG)
- [x] Docs: no backticked gitignored folder in PROGRESS (the failing fresh-checkout case) and a test that checks it without looking at the disk
- [x] Tests for the edges: K and K - 1 land masses, the capital spacing at 17 and 16 and across the antimeridian, `prepareWorld` overrides and Peak, names (whitespace, length, uniqueness), the preference key prefix, the geometry of every flag pattern and emblem (D129)
- [x] `npm run verify` GREEN after the fixes: unit 111 files / 1319 tests, perf 6 files / 18 tests, e2e 14 files / 117 tests (467 s for e2e)
- Not done on purpose: the later milestone prompts in the user's own prompt list are not edited (the rule file forbids touching it); D120 now says which module later camera work extends.

ACCEPTANS (the part that owns each item is in brackets)
- [x] [A + B] Equal start over 20 country choices: 5 with fewer than 400 own cells (land mass >= K, the first 5 in id order) and 15 seeded samples: troops, gold and start disc (exactly K cells, contiguous) identical; in a default match with 12 AI nations every seat has exactly K cells at tick 0 (tribes included, they are placed at tick 0 too) (Node: `tests/app/matchSetup.test.ts`, `tests/app/fairStartAll.test.ts`; Chromium: the Sweden test checks 13 seats of 197 cells)
- [x] [A] Negative: every country with land mass < K or < 8 cells is disabled with a reason and `createMatch` refuses it; a custom start click on a land mass that is too small is refused with a reason (also in Chromium: the island click and the disabled rows)
- [x] [A] The home-land discount applies to the owner and to home-land cells only (unit tests); the trait cap is never exceeded
- [x] [A + B] Flags: deterministic per seed (golden hash on the spec), >= 45 distinct images among 50 seeds, the custom nation's flag is drawn with >= 2 dominant colours within dE 10 of spec.colors and the emblem area differs from the background pattern (Node: `tests/ui/flag.test.ts`; Chromium: the flag preview of the setup read from real canvas pixels)
- [x] [A + B] Search: "Sverige" and "Sweden" both find Sweden; flyTo reaches its end position (unit test, fx clock)
- [x] [B] Playwright: search "Sweden", the camera flies there with the border marked (screenshot `test-results/shots/setup-sweden-1-flown.png`), start, the start disc within 2 cells of Stockholm (the capital IS Stockholm's cell), 60 s fast-forward without errors; a custom nation spawns exactly where clicked and invalid clicks show a reason
- [x] [A + B] Skirmish region: no cell outside the mask is ever owned (4 minutes in Chromium, 3000 ticks x 4 regions in Node); the page works with localStorage blocked (unit test of prefs.ts: memory fallback when storage throws, and the whole flow in Chromium with a throwing `localStorage`)
- [x] [A + B] Same config + seed gives the same initial state hash (Node and Chromium: the four golden matches at tick 0 and after 600 ticks); `npm run verify` green

### M05fix: the over-cap troop regression of the audit round (be1db76) and the flake hunt over every property test (focused follow-up, no redesign of M05)

GÖR
- [x] F1. Reproduced: Spawn(seat 1, cell 554), Spawn(seat 3, cell 0), Attack(seat 1, target 4, pct 66), 7 empty ticks on the 40x24 seed 46939 match: owner 4 ends with 4720 troops against cap 4713. be1db76 is NOT a sim regression: the identical match at 8a29cc4 shows the same 4720 against 4713, two ticks later (tick 12 instead of 10), outside the 10 turns the property runs; be1db76 only moved the capture timing (K 103 to 123, terrain debt)
- [x] F2. Root cause: the documented economy rule (D73): troops are never clamped when a seat loses land, the surplus above the lower cap decays slowly; the property "troops <= cap" was too strict. The sim is unchanged (no `ENGINE_VERSION` bump, no golden change). The property is stated exactly per tick (D111); its strict form holds for every seat without a cap fall or a refund
- [x] F3. Both counterexamples pinned as explicit `examples` of the property and in `tests/sim/overCap.test.ts` (helpers in `tests/sim/helpers/overCapMatch.ts`)
- [x] F4. Flake hunt: all 12 property files run with fresh fast-check seeds (counts below). One more real finding: a cancelled or ended attack refunds its committed troops outside the cap (1 match in about 19 000, found at 200 times the run count): same soft rule, second pinned example
- [x] F5. Other random sources: no `Math.random` / `Date.now` / unseeded shuffle in any test except deliberate ones (`tests/sim/helpers/nondeterministicStep.ts` and the hostile-globals tests, which assert that they are caught) and `e2e/heap.test.ts` (fills a throw-away array to grow the heap; no assertion depends on the values); the shuffles in `tests/sim/properties.test.ts`, `tests/sim/step.test.ts` and `tests/sim/territoryProperties.test.ts` draw from a fast-check stream (replayable from the printed seed); `tests/sim/helpers/randomMatch.ts` is a pure function of (seed, tick)
- [x] F6. Docs: DECISIONS D111, ARCHITECTURE test index
- [ ] F7. `npm run verify` green twice in a row (background, log file), then `npm run build && npm run artifact:pack`, committed locally (no push, no PR, no Artifact publication)

ACCEPTANS
- [x] The deterministic reproduction no longer fails and is pinned (`tests/sim/overCap.test.ts` and the `examples` of the property)
- [x] The property test passes on at least 30 runs per file with fresh seeds; counts and counterexamples below
- [x] Nothing weakened, rewritten or deleted in the existing tests: the one assertion that was too strict is replaced by the exact per-tick form (D111) and keeps its strict form where no cap fall or refund happened; no golden changed
- [ ] `npm run verify` green twice in a row; build and pack done

Flake hunt (fast-check picks a random seed per run; run counts multiplied through a scratch alias of `fast-check` OUTSIDE the repo, nothing committed): 12 test files with `fc.assert` (in tests/sim: codec, worker, grid, step, spawn, economy, properties, serialize, territoryProperties; in tests/render: camera, geo; in tests/host: accumulator): 30 runs each at the committed run counts (360 file runs, 0 failures); 8 runs each at 30 times the counts (all but `codec`, whose test counts its own runs: 0 failures); `properties`, `spawn`, `step`, `serialize`, `economy`, `grid` 4 runs each at 100 times; `territoryProperties` 10 runs at 200 times (1.2 million random matches per test, 0 failures after the fix). Counterexamples: (1) seed 46939, the surplus after a lost cell; (2) seed 0, the refund of a cancelled attack, found at 200 times with the first form of the corrected property.

### M05 Wow 2: första spelbara erövringen på globen (GATE, i18n) - built over THREE sessions: Part A (items 1, 2, 3, 5), Part B (items 4, 7, i18n), Part C (item 6, AI v0). The orchestrator owns pushing, the pull request and the Artifact.

Previous merge SHA (origin/main at start): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (`git ls-remote origin refs/heads/main` re-checked: still the initial commit; NOTHING of M00 to M04 is merged, it all lives on this branch and in draft pull request #1; the "M02 and M04 are merged" precondition was treated as satisfied by the orchestrator's instruction). `npm ci && npm run verify:fast` was green at the start. The staging rule of the prompt (draft PR with "AI v0 återstår") does not apply: the orchestrator runs the parts in order, so no push, no PR and no Artifact from the building sessions.

Decisions of Part A (details in D92 onwards of `docs/DECISIONS.md`): the spawn phase and the immunity are SIM rules behind a match-config flag (`spawnPhase`, golden-neutral while it is off); the owner mirror of the renderer is built from the host's diff events (zero allocation per frame), the per-seat statistics come as a small `view` event; the match is 6 players (you + 5 AI) + 20 tribes = 26 seats; the default seed is 1.

GÖR, Part A (items 1, 2, 3, 5)
- [x] A0. Preflight (merge SHA recorded, verify:fast green), this checklist
- [x] A1. Sim rules: `SPAWN_PHASE_TICKS` 200, `IMMUNITY_TICKS` 50, match composition in `src/sim/rules.ts` and `docs/BALANCE.md`; config flag `spawnPhase`; `REJECT_PHASE` (Attack in the phase, Spawn after it) and `REJECT_IMMUNE` (Attack on owned land in the immunity); tests
- [x] A2. `DebugGive{seat, gold, troops}` intent (wire kind 5), valid only under `debugIntents`; the five places of D74; tests (also: refused without debugIntents)
- [x] 1a. src/sim/view.ts: `SimView` (read-only, snapshot-bound), `SeatStats` (troops, cap, gold, gold/s, cells, weighted land share, alive), `fillSeatStats(state, out)`; src/sim/public.ts barrel (`seatToOwner`, `ownerToSeat`)
- [x] 1b. Host: the light view (stats, tick, rejects, last reject reason) rides in the diff event as `StateDiff.view`, `requestView()` (stats + full owner copy); `ViewMirror` (src/host/viewMirror.ts) applies diffs in place and implements `SimView`; snapshot growth documented in `docs/ARCHITECTURE.md`
- [x] 1c. Render adapter loop in `src/app` (60 Hz frames, `host.advance(dt)`, HUD value interpolation, speeds pause / 1x / 2x / 4x), advance cost per frame measured and logged in the browser
- [x] 2a. Ownership texture RGBA8 1024x512 (owner u16 in R+G, flags in B, reserve in A), FULL re-upload at most 10 Hz by `fxNow()`, upload counter
- [x] 2b. Owner palette LUT (ownerId to colour; own colour vs every other dE76 >= 25, unit test)
- [x] 2c. Terrain shader: territory tint, sharp organic borders (`fwidth`, integer-hash domain warp, no sin), ownership drawn only on land, coast bleed; screenshots looked at (flat, mountain, coast)
- [x] 3a. Spawn phase (20 s), click to spawn, 5 s immunity, click to attack (target = owner under the cursor), commitment 5-100 % (step 5, default 40), keys `[` `]` space `,` `.`; click vs drag threshold; HUD clicks never reach the globe
- [x] 3b. Temporary UI behind small functions that Part B replaces (src/ui/matchHud.ts, src/ui/startScreen.ts)
- [x] 5. Debug hooks: `?seed=` / `#seed-7` / `?test=1` / `#test`, `__test.advance(dt, ticks)`, `__test.state()`, `__test.give(seat, {gold, troops})`, `__test.submit(body)`, ownership upload counter, the Dev-panel seed field (id `seed`) and `./debug/sim.html` link
- [x] A9. Tests: unit (rules, intents, view, mirror, texture packing, palette), e2e for Part A (run alone); `npm run verify:fast` green; docs (ARCHITECTURE, DECISIONS); committed locally

GÖR, Part B (items 4, 7, i18n) - DONE (this session; nothing pushed, no PR, no Artifact)
- [x] 4. DOM HUD with `data-testid`: gold with income per second, troops with a cap bar and a warning at 80 % of the cap, land share in %, timer, top-5 leaderboard + you; the speed buttons, the commitment slider, the banner with the spawn-phase prompt and countdown, the toast (D99)
- [x] 4b. i18n: `src/ui/i18n.ts` (`t(key, params?)`, tables `sv` and `en`), parity unit test, test mode throws on a missing key (`__test.text`), the i18n rule in CLAUDE.md; every string of the temporary Part A UI moved into the tables, plus the hover tooltip and the loading / error texts (D98); the UI constants are in the one file `src/ui/uiConfig.ts`
- [x] 7. Start screen with a Play button and a small Dev button (first thing the user sees in the live page; a language button; test mode bypasses it) (D100)
- [x] B-last. `docs/PREVIEW.md` (Swedish): how to start, controls, seed addresses in hash form, the HUD, the Dev panel (17d to 17i); ARCHITECTURE, DECISIONS D98 to D101, BACKLOG

GÖR, Part C (item 6 and the finish) - DONE (this session; nothing pushed, no PR; `npm run build && npm run artifact:pack` run: 24 files, 15.48 MB, one batch; the orchestrator pushes and republishes)
- [x] C1. `src/sim/intents.ts` constructors, `SimView.contactLength` (StateView over the border index, ViewMirror by a lazy scan), AI constants in `src/sim/rules.ts` and `docs/BALANCE.md` (15 rows), `src/sim/public.ts` as the AI's one import (type-only intents, constructors, constants, rng functions)
- [x] C2. `src/ai`: `think(view, memory, rng) -> IntentBody[]` (seeded spawn places around the human capital, expand at >= 50 % of the cap, weakest neighbour, staggered per seat), tribes (20 at the start, slow expansion up to 600 cells)
- [x] C3. ESLint allow-list for `src/ai` plus a lint self-test, a structural scan and a TypeScript type test (`tests/ai/boundary.test.ts`, mutation-checked)
- [x] C4. Host calls the AI at tick boundaries (`TickDriver` option of `MainThreadHost`, `src/host/aiDriver.ts`), own memory and stream, intents T + 2; `MatchOptions.ai` / `?ai=0` / `#ai-0` / Dev-panel modes; `e2e/match.test.ts` and `e2e/hud.test.ts` open with `ai=0` (D105)
- [x] C5. Tests: think unit tests (mutation-checked), driver tests (replay, determinism, T + 2, nine human positions), mirror contact equals border index, perf (`budgetMs(0.5)` per seat), `e2e/ai.test.ts` (600 ticks, 6000 ticks with equal hashes in Node and Chromium, uploads at every speed)
- [x] C6. AI calibration (D104), screenshots looked at, a full simulated session at 4x through Playwright (below)
- [x] C-last. Docs (ARCHITECTURE "The AI call", DECISIONS D102 to D105, PREVIEW in Swedish 17d to 17k and two table rows, BACKLOG, BALANCE, CLAUDE.md), `npm run verify` green, build and pack

Audit round after part C (four auditors, eleven findings, all fixed; details D106 to D110 of `docs/DECISIONS.md`; nothing pushed, no PR, no Artifact)
- [x] 1. Terrain slows the capture (a Mountain front 0.39 of a Plains front per 100 ticks), `CAPTURE_K_MILLI` 123, `ENGINE_VERSION` 5, sim goldens re-pinned once (D106)
- [x] 2. HUD at 390x844: banner readable (>= 200 px wide, < 90 px tall), no overlap with the leaderboard or the Dev button, e2e (D107)
- [x] 3. Territory readable at night (emissive floor, bright rim, halo), own colour magenta instead of blue, e2e at night (D108)
- [x] 4. ESLint and structural boundary for `src/ui`, `src/render`, `src/app` (explicit exceptions `src/app/debugSim.ts`, `src/app/match.ts`), lint rows and scans (D110)
- [x] 5. `requestView()` copies pinned; 6. `textureMB` counts the ownership texture; 7. attack target and commitment pinned (pure `clickMeaning`, spy test, e2e click on enemy land); 8. `goldPerSecMilli` unit pinned; 9. `StatInterpolator` three pushes; 10. `setFromOwners` dirty flag; 11. `resolveClickCell` nearest of several; 12. `takeNewReject` filters AI refusals; 13. the AI waits 15 s for you and Spawns on consecutive ticks (D109), `AI_EXPAND_TROOP_PCT` 40
- [x] `docs/PREVIEW.md` (Swedish) updated: click your start place within 15 seconds, terrain speed, magenta colour, phone layout

ACCEPTANS (all three parts; the part that owns each item is in brackets)
- [x] [A done, B re-checks with the real HUD] Playwright `?test=1&seed=7` (`#test_seed-7` is the same match): spawn at fixed coordinates, `advance` 600 ticks, the player's land share above the start value (0.150 % to 0.293 %); HUD values equal sim values (`data-testid`, the temporary HUD; part B must keep the test green for its HUD: land share, timer, leaderboard are new); screenshots at tick 0 / 100 / 300 / 600 (`test-results/shots/match-t000.png` and so on)
- [x] [A] Negative e2e: spawn on sea, Peak or Ice is refused (state unchanged, reject counter +1); attack on own land and spawn after the phase are refused; pct 0 is refused
- [x] [A] Ownership readback equals the owner array in 200 sampled cells; upload counter <= 10 per second (fx clock) whatever the sim speed
- [x] [A] Borders: at a border cell on a Mountain cell the border pixel differs from both the own and the neighbour colour by CIE76 dE >= 15; palette has dE >= 25 between the own colour and every other palette colour (unit test)
- [x] [B] i18n: `sv` and `en` have the same keys (parity test, `tests/i18n.test.ts`); a missing key fails in test mode (`e2e/hud.test.ts`: `__test.text` throws, every key of both tables resolves in the page)
- [x] [C] 6000-tick run in the browser without console errors (with the AI on: `e2e/ai.test.ts`, also with sim hashes equal to a Node run at ticks 600, 3000, 6000); test tier <= 150k triangles (74 560, 3 draw calls); AI v0 `think` median over 200 calls after 20 warm-ups <= `budgetMs(0.5)` per seat (median 2 to 3 us, `tests/ai.perf.test.ts`); type test and lint forbid `src/ai` from importing step or state (`tests/ai/boundary.test.ts`)
- [x] [A] `__test.give` changes gold / troops only through an intent (negative test without debugIntents: `tests/sim/debugGive.test.ts`; nothing changes before T + 2: `e2e/match.test.ts`); golden sim hashes equal in Node and Chromium (`e2e/sim.test.ts`, unchanged hashes); [x] [C] `npm run verify` green

Result of Part A (this sandbox): `npm run verify:fast` green (typecheck, lint, 81 unit files / 948 tests); the perf project green (5 files / 16 tests); the whole e2e project green (11 files / 71 tests, 184 s: the 59 of M00 to M04 with every golden unchanged, plus the 12 of `e2e/match.test.ts`). `npm run verify` as a whole is NOT run (part C ends with it). Measured and logged by the tests: seed 7 script (spawn at 48.5 N 11 E, attack on unowned land at tick 255): 197 cells after the spawn (a full capital disc), 382 at tick 600, land share 0.150 % to 0.293 %, sim hash `9db19f91` (the same through `#test_seed-7`); ownership uploads 6.0 / 8.3 / 8.7 per fx second at 1x / 2x / 4x with a conquest running every tick (limit 10); border pixel on a Mountain block (cell 143, 88): dE76 25.0 to 29.3 against both the own and the neighbour colour (limit 15); own palette colour at least 32.1 dE76 from every other (limit 25), the 26 seats of a match pairwise at least 20.3; 6600 ticks in the browser without a console error, 74 560 triangles and 3 draw calls in the test tier; the host advance cost per frame at 4x with a running conquest 0.02 ms (300 frames in 6 ms, nothing drawn), in the live page under SwiftShader 3.7 ms mean / 9.1 ms p95 (software GL competing for the CPU; the perf overlay reports it as `match`: sim-steg per bildruta). Nothing is pushed, no pull request opened, no Artifact published.

Result of Part B (this sandbox): `npm run verify:fast` green (typecheck, lint, 84 unit files / 981 tests). The whole e2e project is green too: 12 files / 90 tests in 201 s (the 71 of part A with every golden unchanged, plus the 19 of `e2e/hud.test.ts`). `npm run verify` as a whole is NOT run (part C ends with it); `npm run build` works (main chunk 168 kB gzip). Measured and logged by the tests: HUD font 16 px at 960x540 and 22 px at 1920x1080; the HUD panel padding is dark over day, night and polar ice (luma at most 36 of 255) and every panel shows bright text pixels; the contrast of every text colour on its panel is 6.3 to 18.3 (limit 4.5) over white and over black; 500 refreshes of an unchanged HUD cause 0 DOM mutations (about 0.003 ms each); in the live page under software GL the HUD refresh costs 0.47 ms mean / 1.1 ms p95 per frame (`match.hudUpdateMs` of the perf report) and the sim step 0.7 ms mean at 1x. What the screenshots showed (looked at): the start screen with the globe visible behind it, the HUD at both sizes, in Swedish and English, the leaderboard with six rows, the troop warning, the phone-sized start card. Nothing is pushed, no pull request opened, no Artifact published.

Result of Part C (this sandbox): `npm run verify` green on the final tree: typecheck, lint, 88 unit files / 1038 tests, perf 6 files / 18 tests, e2e 13 files / 94 tests (about 215 s: the 90 of parts A and B with every golden unchanged, plus the 4 of `e2e/ai.test.ts`). Measured and logged by the tests: `think` working path median 2.0 to 2.9 us (p95 2.3 to 4.6 us, max 69 us) per nation seat against `budgetMs(0.5)` = 576 us; the place search (`pickSpawnCell`) median 52 to 100 us, p99 200 to 300 us; a host tick with the AI median 85 us, p95 150 us (it includes the conquest work the AI causes; the driver's own cost is `refresh` 3.2 us + `onTick` 0.6 us); ownership uploads 8.6 per fx second at 1x, 2x and 4x while the 25 AI seats conquer (limit 10); 6000 ticks in the browser with the AI: no console error, 74 560 triangles, 3 draw calls, sim hashes `b6fa4b15` (tick 600), `20d32d00` (3000), `59ea66b9` (6000) identical in Node and Chromium; `npm run build` main chunk 169.7 kB gzip; `npm run artifact:pack` 24 files, 15.48 MB. In the live page under SwiftShader at 4x (3.6 fps, so up to 8 ticks per frame): host advance cost 1.0 to 1.9 ms mean, 3.2 to 6.8 ms p95 per frame, HUD 0.2 ms; on a real GPU a frame holds 0.7 tick, so a tenth of that.

AI numbers (real world, `tools/sim` scripted human expander, D104): first contact with a tribe after 36 to 109 s, with a nation after 100 to 340 s (none in six minutes in Europe and India); a nation holds about 1 300 to 1 700 cells after 5 minutes and 2 700 to 3 800 after 10, 8 000 to 11 000 after 30; the tribes stop at about 600 cells; AI nations eat tribes. The full simulated session (seed 7, human capital in central Europe, expander script with real mouse clicks at 4x, 6000 ticks): tribe next door conquered from tick 848 to 2400 (533 to 1403 cells), then a war against Nation 5 that went back and forth (1448 to 1631 to 1504 cells), 0 rejects, no console error; at tick 6020 the cells per seat were you 1617, nations 1380 / 2124 / 1692 / 1315 / 1335, tribes 600 to 700 (four of them eaten: 78, 126, 141 and 0 cells). Screenshots looked at: start, spawned, phase end with the AI around you, the 4:00 and 10:00 views, the world view at 10:00.

Notes for part B (written by part A; DONE, kept for the record)
- The temporary UI is `src/ui/matchHud.ts` (`createMatchHud(parent, actions)`, `MatchHudModel`, `rejectText`, `NOT_CONQUERABLE_TEXT`) and `src/ui/startScreen.ts` (`mountStartScreen(parent, onPlay)`); `src/app/globeApp.ts` is the only caller (`startMatch`, `refreshHud`, `onGlobeClick`, the Play button). Replace the contents, keep the call shapes, and move every Swedish string of those two files and of `src/ui/matchHud.ts` `rejectText` into the i18n tables. The test hooks read the HUD through `data-testid` (`troops`, `gold`, `phase`, `phase-text`, `phase-seconds`, `controls`, `speed-*`, `commit`, `commit-slider`, `toast`, `start-screen`, `play`); `e2e/match.test.ts` uses them, so a new HUD either keeps those ids or changes the test in the same commit with a reason.
- Test mode has no start screen and hides the HUD (`#hud` / `?hud=1` shows it; Dev-panel mode `hud`). Keep both: the six globe goldens of M02 are taken with the HUD hidden. The HUD numbers are NOT interpolated in test mode (`MatchSession` option `interpolate`), so they equal the sim values.
- Data for the HUD: `session.view.stats` per seat (`troopsQt`, `capQt` for the cap bar and the 80 % warning (`TROOP_WARNING_FRACTION` in `src/ui/uiConfig.ts`), `goldMilli`, `goldPerSecMilli`, `cells`, `landShareQ15` (cos-weighted, 32768 = all land), `alive`), `view.phase` / `phaseTicksLeft` for the timer, `StatInterpolator` (`session.stats.value(field, seat, session.alpha())`) for smooth numbers. The top-5 leaderboard sorts `landShareQ15` over the seats. Troops are shown in whole troops (QT / 4), gold in whole gold (milli / 1000).
- The Dev panel already has the seed field (id `seed`), the `hud` toggle and the `./debug/sim.html` link; a Dev button on the start screen is the corner button of `src/app/devpanel.ts` (visible outside test mode), or open the panel by `window` key F2.
- The i18n rule goes into CLAUDE.md (under 200 lines; 103 now). Strings that already exist outside the match UI (the tooltip classes in `src/app/tooltip.ts`, the Dev panel labels, the perf overlay) are old M02 strings; the prompt says every NEW string from M05 on; decide in part B whether to move the old ones too and say so in DECISIONS.

Notes for part C (tribes, AI v0; read before starting)
- The match is 26 seats: seat 0 you, seats 1 to 5 the AI nations (`MATCH_AI_NATIONS`), seats 6 to 25 the tribes (`MATCH_TRIBES`); `src/app/match.ts` builds it with `spawnPhase` on. Nothing spawns the 25 other seats yet. Tribes must Spawn at tick 0 (the phase allows it), the AI nations during the phase; a Spawn at or after tick 200 is refused (`REJECT_PHASE`), an Attack before tick 200 too, and an Attack on owned land before tick 250 (`REJECT_IMMUNE`), so the AI must wait; tribes attack with T / `TRIBE_ATTACK_DIV` through the normal `Attack` intent.
- The host calls the AI at tick boundaries with its own memory and PRNG (not the UI's); the AI reads a `SimView`. `StateView` (src/sim/view.ts) is the zero-copy view over a live state for code in the sim's own thread (call `refresh()` after the steps of a frame); `src/sim/public.ts` already exists (barrel: `seatToOwner`, `ownerToSeat`, phases, the view types): part C adds the type-only `Intent` types and constructors and the constants of `src/sim/rules.ts` the AI reads, then the ESLint allow-list for `src/ai` and the type test.
- `MainThreadHost` takes `stepFn`, `speed`, `hashEveryTicks`; the AI driver needs a hook before each tick (it must submit intents scheduled at T + 2, so call it from `runTicks` per tick, or wrap the host). The `ViewMirror` in the page is untouched by AI intents (it follows the diffs).
- The default seed of the page is 1 (`?seed=` / `#seed-N` / the Dev panel field change it); the AI and the tribe placement must be pure functions of the seed.
- From part B: `e2e/match.test.ts` and `e2e/hud.test.ts` assume that nobody but you acts in the match (the seed 7 script cells 197 / 382 and its sim hash `9db19f91`, the leaderboard showing only you, refusal counts, the painted nations 1 to 5 of the leaderboard tests). The moment tribes and AI nations spawn and act those numbers change. Give the match an option for it (for example `?ai=0` / `#ai-0` read by the one parser, `MatchOptions.ai`, default ON in the live page and in test mode of the final gate) and make those two e2e files open with it, or change the expectations in the same commit with the reason in `docs/DECISIONS.md`; the globe goldens are taken with no match drawn beyond your own territory and must stay as they are.
- From part B: every new player-facing string needs both tables (`src/ui/i18n.ts`); test mode throws on a missing key. The leaderboard lists the five nations and their seats are 1 to 5 ("Nation N"); tribes are not listed. A text for the AI is not needed (it only emits intents). `__test.state().seats` and the HUD read the same statistics, so an AI that spawns shows up in the leaderboard by itself.

### M04 fix pass after the independent audit (no visible change; the Artifact is NOT republished; details in D91 of `docs/DECISIONS.md`)

GÖR (every audit finding at blocker or major level, re-reproduced first)
- [x] 1. Depth term that cancel + relaunch cannot reset (three findings): per-cell `state.exposure` (`attacker << 8 | depth`), serialised and hashed, `ENGINE_VERSION` 4, `FORMAT_VERSION` 5; a cancel pays the owed part of a cell rounded up; `tests/sim/relaunch.test.ts`; the solo band is the reference bot's (D88, `tools/sim/bands.ts`, `docs/BALANCE.md`)
- [x] 2. Enclave candidate rule: the merged region of the new owner's own land (blocker), the region that loses the cell (found while verifying); clause tests, a per-tick persistence property on tiny worlds, `tests/sim/enclaveMatch.test.ts` (32 fighters on the real world); D86 corrected
- [x] 3. Work gate: idle 1024x512 tick and size independence of a tick in `tests/conquest.perf.test.ts`, p50 of the 12 + 20 match; the over-budget enclave pass in `tests/sim/work.test.ts`
- [x] 4. Missing tests: economy carry over 6000 ticks against the closed-form law, cos-weighted land share, attack order fairness, phase order, pick and bucket hash inputs (10 mutants killed)
- [x] 5. M12a heads-up (BACKLOG, D91) and the pinned behaviour of beachhead-sized regions; the exemption itself is left to M12a (no data to read yet)
- [x] 6. Goldens re-pinned once at the end (reason in D91); `npm run verify:fast` and `npm run verify` green; two local commits (nothing pushed, no PR, no Artifact)

ACCEPTANS
- [x] every new test fails when the change it guards is taken out (mutation checked, see D91)
- [x] the calibration check after the changes: the reference curve 540 958 1423 1913 2423 2961 3483 4028 4591 5171 (band 1500-2500 at 5 minutes, 5000-8000 at 10), K unchanged
- [x] new golden hashes (seed 1, 128x64, 4 seats, debugIntents; ENGINE_VERSION 4, FORMAT_VERSION 5): tick 1 `427f1a65`, 10 `35101a85`, 100 `6c3b3693`, 1000 `4835eb22`, 6000 `007d6577`; seed 2 ticks 10 / 100 / 1000 `fb3f7b0e` / `3288c0ed` / `bd0c0059`; `npm run sim:run -- --seed 1 --ticks 6000`

Result (this sandbox): `npm run verify:fast` green; `npm run verify` green: typecheck, lint, 902 unit (74 files), 16 perf (5 files), 59 e2e (158 s). Measured by the tests: tick of the 12 + 20 match p50 105 us, p95 249 us (budget p95 3.6 ms); idle 1024x512 tick 1.0 us; a 64 row front costs 5.5 us on 256x128 and 5.4 us on 1024x512; 100 000 cells in one tick median 33.5 ms (budget 56.7 ms); cells scanned per changed cell 81 (bound 110). Nothing is pushed, no pull request opened, no Artifact published.

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

GÖR, Part B (second session, done)
- [x] 4. Conquest: `Attack` objects with incremental frontier bags (a pick by hash inside the shallowest depth), capture speed `CAPTURE_K*sqrt(L)*2F/(F+Td)`, costs per cell in milli-QT with the d and dh of D83, mutual attacks net (D84), enclave flip every 20th tick offset by the cell hash (D86), tribes attack with T/20, intents `Attack{seat, target, pct}` and `CancelAttack{seat, target}` (kinds 3 and 4; every place of D74's list edited), `step` phases intents, conquest, enclaves, economy; `ENGINE_VERSION` 3, `FORMAT_VERSION` 4
- [x] 5. `npm run sim:scenario -- --seed N --minutes 10 --players 12 --tribes 20` (territory per minute; `--solo` is the calibration scenario); scripted bots in `tools/sim/bots.ts`, never in `src/sim`
- [x] 6. Calibration: two rounds, `CAPTURE_K_MILLI` 80 -> 103, `BASE_COST_TROOPS` untouched (D88); the solo band of the prompt was met, so the band rule (measured +-30 %) was not needed
- [x] 7. Tests: ratio tests, frontier against brute force after 1000 random steps (three seeds), enclave clauses and the quiescence property (40 seeds in the suite, 1500 more run once), work counters, perf tests through `budgetMs`, hash coverage and hostile bytes for the new state, goldens re-pinned (D90), mutation copies of `step` without conquest and without enclaves must fail the golden

ACCEPTANS, Part B
- [x] ratio tests at equal contact length: 4:1 troops give 1.6x and 1:4 gives 0.4x the capture speed at 1:1 (needs >= 1.4 and <= 0.6; `tests/sim/conquest.test.ts`, also measured on whole attacks over a minute); Mountain costs 2.5x Plains (needs >= 2.2); uphill costs more than downhill for the same pair; F = 0 and Td = 0 give speed 0 and no NaN; troops never negative or wrapped in 1000 random steps; d never above D_MAX
- [x] frontier property test: after every one of the first 40 and then every 25th of 1000 random steps (three seeds) the frontier equals the brute-force recomputation over the whole map; the derived structures equal a rebuild; an enclave surrounded by one seat flips within 20 ticks (`tests/sim/frontier.test.ts`)
- [x] work counters are the primary limit (`tests/sim/work.test.ts`): taking c cells reads about c cells whatever the front length and the world size, an idle world reads 0, a launch reads the border (2 x the strip height), every tick of the 12 + 20 match reads under a hundredth of the map; tick cost p95 of 400 ticks after 50 warm-up ticks: 199 us against `budgetMs(4)` = 3.6 ms; 100 000 cells in one tick: median 36.7 ms against `budgetMs(50)` = 61.6 ms (`tests/conquest.perf.test.ts`, `tests/conquestBurst.perf.test.ts`)
- [x] calibration band of a solo expander: 2440 cells after 5 minutes (band 1500-2500) and 5225 after 10 (band 5000-8000) on the reference scenario (Moscow, seed 1)
- [x] golden hashes identical in Node and Chromium (`e2e/sim.test.ts`, `e2e/artifact.test.ts` inside `npm run verify`); a snapshot in the middle of a 12 + 20 match resumes into the straight run; no forbidden APIs (lint, hostile-globals golden run); `npm run verify` green

Result of Part B (this sandbox): `npm run verify` green (run twice, the second time on the final tree): typecheck, lint, 866 unit (71 files), 14 perf (5 files), 59 e2e (143 s). Golden hashes (seed 1, 128x64, 4 seats, debugIntents; ENGINE_VERSION 3, FORMAT_VERSION 4): tick 1 `7db8e4d9`, 10 `4acfc06d`, 100 `e6c5540c`, 1000 `297a1a9c`, 6000 `a8f61e4c`; seed 2 ticks 10 / 100 / 1000 `be622416` / `a5ff586a` / `44fc9086`; reproduce with `npm run sim:run -- --seed 1 --ticks 6000`. Measurements (logged by the tests, perfguard factor 0.9 to 1.2 on this noisy VM): tick of the 12 + 20 match on the real world p50 76 us, p95 199 to 225 us, p99 270 to 296 us, max 0.6 to 0.9 ms (budget p95 3.6 to 4.6 ms); 100 000 cells in one tick median 28 to 37 ms (min 22 to 33; budget 45 to 62 ms); mean cells scanned per tick 440 against 21 changed (20 per changed cell, 0.44 enclave candidates per changed cell); `npm run sim:scenario` for 10 minutes of the 12 + 20 match about 1.3 s. Solo curve (RUS, cells per minute): 540 958 1429 1926 2440 2979 3508 4068 4640 5225. The 12 + 20 match (seed 1, players fight): after 10 minutes the players hold 48 855 cells (2 834 to 6 376 each), the tribes 25 219, 38 % of the land is free (D88, D89). Nothing is pushed, no pull request opened, no Artifact published (the orchestrator owns that); `debug/sim.html` shows the new hashes.

Notes for M05 / M06 / M09 (what to build on)
- Read the state through `SimView` (M05): per owner `troops` (QT), `gold` (milli-gold), `agg.area`, `landShareQ15`, `capital`; attacks through `state.attacks.list` (attacker, target, troops, progress); contact length `state.borders.contact(a, b)`; `state.work` for diagnostics. The ownership change list for rendering is the outbox (`OUTBOX_PAINT`), with the `fullOwner` fallback when it overflows (D69).
- A new rule constant goes in `src/sim/rules.ts` AND `docs/BALANCE.md` (the test fails otherwise) and needs an `ENGINE_VERSION` bump and re-pinned goldens; the calibration test (`tests/sim/calibration.test.ts`) must stay green (`tools/sim/bands.ts`).
- Anything that changes `state.owner` must go through `setOwner` / `changeOwner`: the border index, the frontier bags and the enclave queue depend on it (a test compares them with rebuilds).
- Bots: `tools/sim/bots.ts` is a placeholder; the real AI (M05 / M16) must emit the same intents (`Attack{seat, target, pct}`, `CancelAttack`).

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
- [x] `npm run verify` green (typecheck, lint, 356 unit, 9 perf, 48 e2e; an earlier version of this line said 47), `npm run build && npm run artifact:pack` run (21 files, 15.38 MB in the gitignored Artifact pack folder, 10 MB of it the probe packs); the orchestrator pushes (PR #1 exists, no new PR) and republishes the Artifact by the procedure in `docs/PREVIEW.md`

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

### M09a: the structure table, the Build / Upgrade / Delete intents, the placement rules and the prices (items 1 to 5 of M09; no rendering, no UI)

Part M09b (effects, conquest, AI driver and AI build move, the scenario economy report) is NOT built here; the table is laid out for it (D-M09a-9).

GÖR
- [x] 1. `src/sim/structures.ts`: the SoA table (capacity 4096), the deterministic free list (`highWater` plus a recycle stack), the derived cell index and per-owner counts rebuilt on deserialize, `StructureTable`
- [x] 2. Intents `Build{type,cell}`, `Upgrade{structure}`, `Delete{structure}` (wire kinds 6 to 8), codec, validation, reason codes `REJECT_BUILD_*` / `REJECT_STRUCT_*` / `REJECT_DELETE_COOLDOWN` (21 to 38)
- [x] 3. `src/sim/public.ts`: `validateBuild` first, price helpers, the type numbers, the read-only `StructureView`; `SimView.structures` and `SimView.falloutUntilAt(cell)` (zero until M14); the sim's Build calls the same `checkBuild`; export list pinned
- [x] 4. The placement rules in `src/sim/structureRules.ts` (`checkBuild`)
- [x] 5. Prices, build times, Delete cooldown, spacing in `src/sim/rules.ts` and `docs/BALANCE.md`
- [x] Tests: `tests/sim/structures.test.ts` (one test per rule and per price rule, round trip, restored run equals straight run), `tests/ai/boundary.test.ts` (pinned list, writing through a SimView does not compile), `tests/structures.perf.test.ts`; golden scenario extended with Build / Upgrade / Delete, both golden files re-pinned once (ENGINE_VERSION 7, FORMAT_VERSION 6)

### AutoTier-2: adaptive resolution (one part; the orchestrator owns pushing, the pull request and the Artifact)

Previous merge SHA (origin/main at start): not recorded by this builder (nothing is merged; PR #1 is a draft). AutoTier-1 is Done on this branch.

- [x] 1. This checklist
- [x] 2. `src/render/adaptive.ts` (pure): median of a 30-frame window, 90 warm-up frames, two slow windows down, four fast windows up, 2 s between changes, chunk density one step down after scale 0.5; numbers in `src/render/config.ts`; D160 says which clock and why
- [x] 3. Wired in the draw loop of `src/app/globeApp.ts` (`Globe.setRenderScale`: only the buffer changes, CSS size, camera and picking do not); off in test mode and the performance scene unless `adapt=1`; `?adapt=0` / `#adapt-0` off; Dev panel switch; no allocation per frame
- [x] 4. Measurements (pixel-bound against vertex-bound, SwiftShader, low / medium / high, three sizes) in "Measurements AutoTier-2"; used for the ladder
- [x] 5. Report field `adaptive` and an F3 line (schemaVersion stays 1)
- [x] 6. Tests: `tests/render/adaptive.test.ts` (model, the four named mutants), `tests/adaptiveWiring.test.ts`, `e2e/adaptive.test.ts`
- [x] 7. Docs: PREVIEW 5e (Swedish), ARCHITECTURE, DECISIONS D160, BACKLOG
- [x] ACCEPTANS: regulator tests green and the mutants killed; converges and holds with a synthetic slow GPU, off = no change (byte-identical picture); buffer follows the scale, CSS size and picking do not; report and F3 show `adaptive`; measurements written; no golden and no earlier test changed; `npm run verify:fast` and `npm run build` green

### M09b: the effects of structures, conquest, the AI build move and the economy report (items 6 to 9 of M09; no rendering, no UI)

- [x] 6. Effects of finished structures (`src/sim/structureEffects.ts`): City cap and gold, Factory, Port and trade, the Defense Post price; SAM / Silo only the radius table
- [x] 7. Conquest: City / Factory / Port change owner one level lower (at least 1), Silo / SAM / Post are destroyed, also on an enclave flip (hook in `changeOwner`)
- [x] 8. AI: `src/ai/build.ts` (build move), `AiDriver.serialize` / `restore` (AI-state blob), public.ts exports pinned in `tests/ai/boundary.test.ts`
- [x] 9. Scenario CLI: `--ai [--no-build]` and an economy report (income gold/min, purse, structures, land) per minute
- [x] Tests: `tests/sim/structureEffects.test.ts`, `tests/ai/build.test.ts`, `tests/sim/economyScript.test.ts`, the perf test in `tests/structures.perf.test.ts`; ENGINE_VERSION 8, FORMAT_VERSION 7, both golden hash files re-pinned ONCE (D-M09b)
- [ ] NOT MET, logged: AI v0 with building reaches 0.90 of the band's upper limit after 10 minutes, not [1.0, 1.5] (D-M09b, BALANCE.md)

### CamFix-2: four measured camera faults and an honesty fix (from the independent maths review of CamFix; unit tests only)

- [x] 1. A flight that is grabbed mid-way: the shown tilt slides to the eased one at 132 degrees per second (`FIT_TILT_RATE_DEG_S`) instead of jumping
- [x] 2. The right drag far out stores the tilt by the drag's own delta (the user's tilt comes back after zoom in)
- [x] 3. The quick wheel spin: the same rate limit, no frame changes the shown tilt by more than 2.2 degrees (the pose by 2.9 %); the end value is unchanged
- [x] 4. The start view is brought into the window by `fitViewDistKm` (a tall window starts farther out; 16:9 is byte-identical)
- [x] 5. Words: the mountain camera is "calm over the Alps; dives up to 79 % at the Himalaya wall" in PROGRESS, PREVIEW, DECISIONS and the test name
- [x] ACCEPTANS: `tests/render/camFix2.test.ts` fails on the code before (16 of 25) and passes after; `npm run verify:fast` green (see the result below)

### M10-3: Silo, SAM site and Defense Post on the terrain (slice 3 of M10; own worktree; the orchestrator owns merging, pushing and the Artifact)

Base: 3d1a2bd. Slice: ONLY the three military models, buttons and keys 4 to 6. Factory and Port are slice M10-2 (another builder).

- [x] 1. Models in `STRUCTURE_MODELS`: Silo (bunker, V hatch, pad with a standing missile), SAM site (pedestal, two launcher tubes, mast with a turning dish), Defense Post (slim tower with flag in a wall ring); each at most 250 triangles, owner-coloured base
- [x] 2. The SAM dish turns in the vertex shader (one scalar uniform from the fx clock, the instance yaw is the phase)
- [x] 3. Build bar buttons 4 / 5 / 6 (sim prices, dimmed state, Silo locked until a finished own Factory), keys 4 to 6 through `InputTarget.build`, the ghost wears the model of the type, the bar wraps (landscape and portrait)
- [x] 4. i18n sv + en (`hud.build.silo|sam|post`, `*Tip`, `tooPoorOf`, `needFactory`); the `toast.build.*` keys already covered every reason these types can hit
- [x] ACCEPTANS: `tests/render/structureModelsMilitary.test.ts`; `e2e/structuresMilitary.test.ts` (key 6 + click, price 250 -> 375; key 4 red with the Factory toast; key 5 on a Mountain ridge cell builds; heights within 1 m; draw calls; dish differs one sun day apart while the Post does not; bar fits 960x540 and 540x960; golden `structures-military.png`); `npm run verify:fast` unit part green apart from machine-load timeouts (see the report)

### M09c: level effects of Factory and Port, and the AI economy target (sim and AI only, headless)

- [x] 1. Factory and Port level effects in `src/sim/rules.ts` and `src/sim/structureEffects.ts`; the 10x limit by a Port clamp and 3 boosted Cities per Factory; BALANCE.md rows
- [x] 2. AI: `AI_EXPAND_TROOP_PCT` 37, upgrade when rich (`AI_BUILD_RICH_PCT`), build / upgrade only without a foreign neighbour; solo factor 1.02 of the band (was 0.90), M09b's open item closed
- [x] 3. Both golden hash files re-pinned once; no version bump (no layout change)
- [x] Tests: `tests/sim/structureLevels.test.ts`, `tests/ai/richUpgrade.test.ts`, `tests/sim/economyScript.test.ts` (band [1.0, 1.5]); pace, driver, perf unchanged and green

### M10-4: selection panel, range rings, night lights, far icons (slice 4 of M10; own worktree; the orchestrator owns merging, pushing and the Artifact)

Base: f42fac3. Slice: the rest of the M10 prompt's items 3 and 4 that was open after M10-3.

- [x] 0. Base repair: `src/render/structureModels.ts` at the base did not compile (the merge of M10-2 and M10-3 lost the closing `return m.done(); }` of `buildPort` and left two methods called `prism`); the M10-2 one is now `column` (same geometry, so the Factory golden is unchanged)
- [x] 1. Selection: a click on an own structure (the cell or the nearest own one within one cell) selects it; panel with name, level, sim effect numbers, upgrade price, delete cooldown; Upgrade / Delete send the intents; Esc or a click on empty ground deselects; dimmed buttons with the reason as tooltip; `validateUpgrade` / `validateDelete` in `src/sim/public.ts` (the sim's own validation runs the same `checkUpgrade` / `checkDelete`)
- [x] 2. Range rings for the selected SAM (sim radius per level, +20 % on a Mountain) and Defense Post, in the same ring mesh as the selection ring (one draw call)
- [x] 3. Night lights: the City's level 1 to 3 gives 1 to 3 bulbs lit on the night side (vertex shader, no draw call), `__test.props().litLights`
- [x] 4. Far icons: an owner-coloured badge per structure (a shape per type in the fragment shader), one draw call for all types, cross-fade by the model's projected radius
- [x] 5. i18n sv + en (`sel.*`), HUD hint line in the panel
- [x] ACCEPTANS: `tests/sim/structureValidators.test.ts`, `tests/app/structureSelect.test.ts` (pure selection, ring and icon numbers), `e2e/structuresSelect.test.ts` (select, panel numbers, Upgrade, Delete and cooldown, Esc, SAM / Post ring, night lights per level, far icons, portrait and landscape layout), golden `structures-select.png`; `npm run verify:fast` (see the report for its result)

### Fix-Sim: audit 1 fixes for the sim, host and AI (headless; no visible change except that Build is refused in the spawn phase)

- [x] 1. `ENGINE_VERSION` 9 (M09c changed the rules), both golden hash files re-pinned once with `UPDATE_GOLDENS=1`, a test that a snapshot of another engine version is refused (`tests/sim/fixSim.test.ts`)
- [x] 2. Mutation holes closed, each test shown to fail on its mutant: `tests/sim/fixSim.test.ts` (coast on every side and seam, capacity / full, exact-price Upgrade, setEmbargo cache, freeing a cell, trade and Factory ties, HUD income stat), `tests/sim/structureForged.test.ts` (every deserialize guard of the structure block, a full table), `tests/host/structureSignature.test.ts`, `tests/ai/fixSim.test.ts`, GPU rows in `tests/gpuClass.test.ts`
- [x] 3. Build / Upgrade / Delete refused with `REJECT_PHASE` in the spawn phase of a match (the AI already waits there)
- [ ] Left over: see "Audit 1 leftovers (Fix-Sim)" in `docs/BACKLOG.md`

### Fix-UI: player-visible fixes of the independent audit (one slice of the audit-1 fixes; own worktree; the orchestrator owns merging, pushing and the Artifact)

Base: cf01c79. Source: the findings of audit 1 (the UI, render and test items; the sim items belong to Fix-Sim).

- [x] 1. Shift + click places several: the placement mode sets `wantsShiftClick`, the base mode then keeps a Shift + left press a click (`tests/app/placement.test.ts` with real pointer events, `e2e/fixUi.test.ts`)
- [x] 2. Build bar: full names, key and name on the first line, the price under it, three columns without a width cap (e2e at 960x540, 1366x640, 1920x1080, 540x960, sv and en: no name is cut)
- [x] 3. A click on neutral or enemy land beside an own structure is not a selection (`pickStructure(..., cellOwner)`)
- [x] 4. Panel numbers per level for Factory and Port (level tables exported from `src/sim/public.ts`), Silo says it has no function yet, SAM percent from `SAM_MOUNTAIN_PCT`, decimals and thousands in the language's format
- [x] 5. Refused Build / Upgrade / Delete: `structureRefusalKey` -> `toast.build.*` / `toast.struct.*` through `rejectKey`
- [x] 6. `#perf` is raw (`adaptiveEnabled`), 7. finished structures are exact (`vProgress < 0.999`), 8. an adaptive step is applied before the next draw, 9. two-step Delete ("Bekräfta", 3 s on the fx clock)
- [x] 10. Jitter test of the structure layer (`e2e/structuresJitter.test.ts`, with a speckle test that fails on the old shader: 128 isolated pixels against 0)
- [x] 11. Budgets: row 0 draw calls 30 -> 100, one triangle budget per layer (`tests/render/structureBudget.test.ts`)
- [x] 12. Mutant-killing tests: `tests/ui/structureInfo.test.ts`, `tests/render/adaptiveWindows.test.ts`, `tests/render/camCapRate.test.ts`, pickStructure and placement cases; `npm run verify:fast` green. NOT done: see "Audit 1 leftovers (Fix-UI)" in `docs/BACKLOG.md`.

### Districts-1: city districts in the sim (Housing, Market, Barracks, Walls), the district table, three intents, effects, conquest, AI (sim and AI only, headless; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)

Base: 00d16f3 (branch claude/ecstatic-euler-s1wm2k). Previous merge SHA (`git rev-parse origin/main`): f29121a8d1607ca169e6675b5f22a52d76c42ef7 (nothing is merged; pull request #1 is a draft). The feedback behind it: "kunna bygga mer än städer och fabriker ... en karta nästan där man kan klicka in och uppgradera städerna i". Districts-2 builds the city view in the UI on top of this.

- [x] 1. GÖR and ACCEPTANS written here first
- [x] 2. Model: `DISTRICT_SLOTS_BY_LEVEL` 2 / 3 / 4, four kinds, prices (escalation by kind, upgrade base x L), build times, all in `src/sim/rules.ts` with rows in `docs/BALANCE.md` (Market base 60 and 0.4 / 1.3 / 1.85 gold/s, not the proposed 200 and 1.5 per level: see Districts-1 point 2 in DECISIONS)
- [x] 3. State: the district table inside `StructureTable` (`districtKind`, `districtLevel`, `districtReadyTick`, `districtUpgradeReadyTick` at `id * DISTRICT_MAX_SLOTS + slot`), serialised and hashed; `ENGINE_VERSION` 10, `FORMAT_VERSION` 8; both golden hash files re-pinned (the scenario script also sends district intents from turn 13 on); old formats refused
- [x] 4. Intents `BuildDistrict` / `UpgradeDistrict` / `RemoveDistrict` (fields `structure`, `slot`, `districtKind`), codec, `validateIntent`, six new reason codes 39 to 44 plus the existing ones, `validateBuildDistrict` / `validateUpgradeDistrict` / `validateRemoveDistrict` sharing `checkBuildDistrict` / `checkUpgradeDistrict` / `checkRemoveDistrict` with the sim; the three are refused with `REJECT_PHASE` in the spawn phase; `SimView.districts` (and the page's ViewMirror through the structure snapshot)
- [x] 5. Effects in the cached effects (`src/sim/structureEffects.ts`): Market gold, Housing cap, Barracks regeneration (sum capped at 50 percent), Walls in the attacker's cell price (the larger of Walls and Post, never both); the 10-City cap test and the payback window (133 s and 327 s) are tests
- [x] 6. Conquest: the City keeps the districts that fit the new level's slots (highest slot lost first), levels drop by one (min 1), builds and upgrades stop; a destroyed City (cell freed, Delete) clears all, the id comes back clean; the enclave flip is the same path
- [x] 7. AI: Market, Barracks, Housing, Walls by slot number, then the cheapest upgrade; only when rich (what is left after the next wanted structure pays it), from 3 Cities, never an invalid intent (20 seeds), back-off `AI_DISTRICT_RETRY_TICKS` in the memory blob (`MEMORY_FIXED_WORDS` 6)
- [x] 8. The scenario CLI's economy report has a districts line per kind
- [x] 9. Tests (each shown to fail on a mutant, 15 mutants killed): `tests/sim/districts.test.ts`, `tests/sim/districtsState.test.ts`, `tests/sim/districtsReport.test.ts`, `tests/ai/districts.test.ts`, `tests/host/districtMirror.test.ts`, `tests/districts.perf.test.ts` (step with 299 districts and 300 structures: calm 30 us, recompute every step 850 us, budget budgetMs(4) = 4.5 ms)
- [x] ACCEPTANS: `npm run verify:fast` green (typecheck, lint, 190 files / 2130 tests); solo AI scenario factor 1.02 of the band (14 328 cells; 1.02 before), `tests/sim/pace.test.ts` unchanged and green; Node and worker golden hashes equal (`tests/sim/worker.test.ts`). NOT run (orchestrator): `npm run verify`, Chromium.

### Districts-2a: the city view (UI on top of Districts-1; DOM only; one builder in its own worktree; Districts-2b draws the districts on the 3D city in parallel)

Base: 9c7ce89 (branch worktree-wf_359cefa4-9ed-1). Nothing is merged to main; no push, no PR, no `npm run verify`. Wish: "ta en djupare syn på städerna, som en karta nästan där man kan klicka in och uppgradera städerna i".

- [x] 1. City view panel `src/ui/cityViewPanel.ts` (tiles 2 / 3 / 4 by City level, City level + upgrade, totals gold/s, troop cap, regeneration, walls from `districtEffect`), opened by the button "Öppna stad" (`sel-open-city`) or a double click on the selected City; input mode `src/app/cityViewMode.ts` (Esc pops it before the pause handler, globe clicks are taken); side panel on wide windows, bottom sheet on narrow ones
- [x] 2. Tiles: empty = four build buttons with price, build time, effect, dimmed with the reason as tooltip (`validateBuildDistrict`, spawn phase first); occupied = SVG icon, level, effect now / next, progress bar, Upgrade, two-step Remove (arm 3 s, "Bekräfta"); all through `buildDistrictBody` / `upgradeDistrictBody` / `removeDistrictBody`; redraw only when the numeric signature changed
- [x] 3. Toasts and tooltips for the reason codes 39 to 44 (`structureRefusalKey`, `districtWhyKey`), sv and en
- [x] 4. The camera flies to the City on open (altAglM 1500, tilt 50) unless it is within 5 km and the City is on screen
- [x] 5. Keyboard: all controls are real buttons (Tab order, Enter / Space); no number keys
- [x] Tests: `tests/ui/cityViewModel.test.ts` (unit), `e2e/cityView.test.ts` (new golden `e2e/goldens/city-view.png`)
- [ ] NOT done: see "Districts-2a leftovers" in `docs/BACKLOG.md`

### Districts-2b (render side of the districts)
- [x] The district table is read from the snapshot (`view.structures` + `view.districts`, same `structuresVersion`) by `globe.districts.setTable` (globeApp, one line).
- [x] ONE instanced layer, one draw call: `src/render/districts.ts`, `src/render/districtModels.ts`, `src/render/shaders/districts.ts`; four models (Housing, Market, Barracks, Walls) of at most 60 triangles; owner colour, level scale 1.0 / 1.2 / 1.4, fixed slots, ground height per slot, construction look and pop-in as the structures.
- [x] Distance cut (fade 3 to 5 px of radius, nothing drawn and no draw call beyond the cut) and a per-layer triangle budget (`DISTRICT_TRIANGLE_BUDGET`); Budgetar row added.
- [x] Tests: `tests/render/districtLayer.test.ts`, `e2e/districtsLayer.test.ts` (golden `districts-layer.png`).
- [ ] Not in this slice: see BACKLOG "Districts-2b leftovers".

### M18-1: the match end in the sim (win rules, anti-snowball, elimination, statistics; headless, no UI; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
- [x] 1. Win rules in `src/sim/win.ts`: land hold (timer reset on a dip), last alive, score at the time limit with the overtime curve and the tiebreak; selectable per match by `config.win`; result in hashed state; `step` stops after the end.
- [x] 2. Anti-snowball discount in `advanceAttack` (`leaderCostPct`), constants `LEADER_*` in `src/sim/rules.ts` and `src/sim/public.ts`.
- [x] 3. Elimination flag and events, capital-lost flag (the automatic start position is not needed, see D M18-1 point 12).
- [x] 4. Statistics (peak land, built, conquered, districts) in hashed, serialised state; `SimView.match` (`MatchView`) through `StateView`, the host snapshot and `ViewMirror`.
- [x] 5. ENGINE_VERSION 11, FORMAT_VERSION 9, both golden hash files re-pinned once; tests `tests/sim/win.test.ts`, `tests/host/matchEnd.test.ts` (mutants checked by hand: 14 of 14 killed after one added test).
- [x] Not in this slice: pause menu, result screen, setup controls, spectate choice, selfplay CLI (M18-2). (Done later by M18-2, ticked by Fix-3C.)


### Sim-Levels2: unlimited levels, one price rule, gentle curves (sim and AI only, headless; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Base: aa9b996. ENGINE_VERSION 13, FORMAT_VERSION 11. The render/UI track (Look-2) reads `STRUCT_LEVEL_HARD_CAP`, `maxLevelOf`, `districtMaxLevel`, the curve functions and the generated level tables from `src/sim/public.ts`.
- [x] 1. Unlimited levels: u16 level tables, hard cap 999 for every type and district kind, overflow edge tested
- [x] 2. One price rule: base x L for every structure type, the City and every district kind; upgrade time = build time of the type
- [x] 3. Gentle power: concave integer curves with asymptotes in `src/sim/levelCurves.ts`; any single structure under 15 gold/s at levels 1, 10, 100, 999. The asked payback window of the first ten steps is not reachable together with 1 and 2 (DECISIONS Sim-Levels2 point 4)
- [x] 4. Conquest keeps 75 percent of a level (districts likewise)
- [x] 5. AI: same validators, caps 10 / 3 / 3, `AI_EXPAND_TROOP_PCT` 32; solo factor 1.08, pace test green
- [x] 6. Versions bumped, both golden files re-pinned once, forged-level tests
- [x] 7. Exports at the end of `src/sim/public.ts`, pinned list updated; tests `tests/sim/levels2.test.ts` (4 mutants shown to fail), perf with 600 structures at levels up to 999
- Not run here: `npm run verify`, Chromium, the pack. Leftovers: "Sim-Levels2 leftovers" in `docs/BACKLOG.md`.


### Integration Sim-Levels2 + Look-2 (the two merged slices made to agree; one session; local commit, nothing pushed)
- [x] 1. `npx tsc --noEmit -p .` clean, the unit project green; the UI numbers follow the Sim-Levels2 curves, gold shown through ONE formatter with `GOLD_DISPLAY_FACTOR` 100 and a compact form from a million (docs/DECISIONS.md 'Integration Sim-Levels2 + Look-2')
- [x] 2. The e2e files that touch cities and structures run one at a time and pass; goldens `e2e/goldens/city-view.png` and `e2e/goldens/result-screen.png` re-pinned once after looking, every other golden unchanged
- [x] 3. Looked at the result: City, Factory, Silo at real levels 1, 5, 20, 50 and drawn levels 100 and 999 in both City styles at about 3 km and 800 m (nothing wider than the Look-2 cap); `e2e/goldFit.test.ts` keeps every gold surface inside the window at 960x540, 1366x640, 540x960 in both languages
- [x] 4. Final run: tsc, eslint on the changed files, `npm run verify:fast`; the full `npm run verify` is the orchestrator's

### M10-2: Factory and Port on the terrain (slice 2 of M10; one builder in its own worktree; the orchestrator owns merging, pushing, the pull request and the Artifact)

Base: 3d1a2bd (branch worktree-wf_18008882-291-1). Slice: ONLY the Factory (key 2) and the Port (key 3) on top of M10a.

- [x] 1. Factory and Port models as `STRUCTURE_MODELS` entries (about 140 and 120 triangles, owner-coloured base), the Port's pier turned to the sea (`seaward`)
- [x] 2. Build bar buttons 2 and 3 (price from the sim, dimmed with a reason tooltip), keys 2 and 3 through `InputTarget.build`, the ghost shows the right model, the bar wraps at 540 x 960
- [x] 3. i18n sv + en (`hud.build.factory*`, `hud.build.port*`; the `toast.build.*` keys already covered every reason)
- [x] ACCEPTANS: unit `tests/render/structureModelsFactoryPort.test.ts`; e2e `e2e/structuresFactoryPort.test.ts` (key 2 + click builds, the price goes up, key 3 inland is red with the Port reason and a toast, key 3 on a coast cell builds, the pier points to the water, heights within 1 m of `groundHeightAt`, draw calls within 10, six buttons fit 540 x 960, golden `structures-factory-port.png`); `npm run verify:fast` green; the full `verify` is the orchestrator's
- Not in this slice: Silo, SAM, Post (M10-3), upgrade / delete / selection panel, icon LOD, night lights.

### M11a: mountain-aware radar, LOS masks, composite coverage and exposure queries (headless; one builder in its own worktree; the orchestrator owns merging, pushing and the pull request). STOP RULE FIRED, see Known issues.

GÖR and ACCEPTANS:
- [x] 1. `src/sim/los` (terrain heights in game metres, the occluder weight, the per-site mask-altitude field, O(1) visibility test): `src/sim/los/terrain.ts`, `src/sim/los/mask.ts`
- [x] 2. Composite coverage per owner over all SAM sites, 64x64 tiles allocated on demand, lazy rebuild on a changed site set (a signature, no hook, no hashed state, nothing after deserialize): `src/sim/los/cache.ts`
- [x] 3. Exposure queries exported from `src/sim/public.ts`: `exposure`, `isExposed`, `fireControlExposed`, `ALT_MODE_*`, `EXPOSED_*` (pinned in `tests/ai/boundary.test.ts`)
- [x] 4. Defense Post: finished Post radius always exposes, both modes
- [x] 5. Constants in `src/sim/rules.ts` with `docs/BALANCE.md` rows (ten)
- [x] ACCEPTANS mask against the exact line: >= 85 % (87.7 to 92.1 %), ZERO mask-hidden-but-line-visible cells (eight sites), the mask hides >= 60 % of what the line hides (87 to 89 %): `tests/sim/losReal.test.ts`
- [x] (accepted by the owner, DECISIONS M11b point 10; ticked by Fix-3C) ACCEPTANS shares: Alps <= 20 % met (14.2), High >= Low met; Himalaya <= 20 % NOT met (25.2), Plains >= 2x Alps NOT met (median 21.8 against 28.4); both kept as `it.fails` tests
- [x] ACCEPTANS wall, Post, SAM outside the radius, wrap, lazy rebuild counters, <= 4 tiles at R=24, fire control: `tests/sim/los.test.ts`
- [x] ACCEPTANS performance: `tests/los.perf.test.ts` (mask R=24 <= budgetMs(0.5), R=64 <= budgetMs(2), 200 sites R=24 <= budgetMs(150), 1000 synced queries)
- [x] (covered by the Chromium fingerprint test of M11b, ticked by Fix-3C) ACCEPTANS hashes equal in Node and Chromium: pinned in Node, the Chromium run was not done (no Chromium in this slice)
- Not run here: the full `npm run verify` (the orchestrator runs it once after the merge). `npm run verify:fast` result below.

## Measurements M11a (logged by `tests/sim/losReal.test.ts`, `tests/sim/losRounds.test.ts`, `tests/los.perf.test.ts`; EXAG 8, weight 60 %, R = 24, Low = 300 m above ground)

| site | agreement with the exact line | mask hidden, line visible | mask hides of what the line hides | visible land Low | visible land High |
|------|------|------|------|------|------|
| Alps 46.5N 9.5E | 87.7 % | 0 | 87.4 % | 14.2 % | 100 % |
| Himalaya 27.7N 85.3E | 91.4 % | 0 | 89.4 % | 25.2 % | 100 % |
| Great Plains (Kansas) 38.5N 98W | 89.7 % | 0 | 88.4 % | 21.8 % | 100 % |
| Iowa | 91.6 % | 0 | - | 20.2 % | 100 % |
| Ukraine | 89.3 % | 0 | - | 37.3 % | 100 % |
| Pampas | 92.1 % | 0 | - | 57.8 % | 100 % |
| Australia | 90.8 % | 0 | - | 21.4 % | 100 % |

Plains median Low (Kansas, Iowa, Ukraine, Pampas, Australia): 21.8 %. Rounds of EXAG / weight: see D-block "M11a" in `docs/DECISIONS.md` item 6. Mask build medians in the cloud sandbox (perfguard factor about 1.1): R = 24 about 0.4 ms, R = 64 about 1.8 ms, 200 sites at R = 24 about 80 ms, 1000 synced queries on 100 sites about 1.1 ms.

### M18-2: the match flow UI (win conditions in the setup, pause menu, result screen, elimination and spectating; DOM only; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
- [x] 1. Selectable win conditions in the setup menu ("Vinstvillkor": three switches, a 40 to 80 percent slider, 5 / 8 / 12 / 20 minute choice plus "default for the area", three presets), remembered with the setup through `getPref` / `setPref`, validated by `createMatch`, summary line in the setup card and the pause menu (`src/app/winSetup.ts`).
- [x] 2. Result screen (winner, reason, table from the `MatchView`, "Spela igen", "Till menyn"); the clock stops when the match ended.
- [x] 3. Pause menu on Escape with an empty input stack (`escapeAction`), resume / restart / menu / speed / summary; the game pauses behind it.
- [x] 4. Elimination of the human: Watch / Restart / Menu panel, spectator bar; toasts for the elimination and capital loss of other nations through `src/ui/toast.ts` (cap untouched).
- [x] 5. The spawn countdown banner stays uncovered (the pause card sits below it; asserted in `e2e/matchEnd.test.ts`).
- [x] Tests: `tests/ui/matchFlow.test.ts` (unit), `e2e/matchEnd.test.ts`, golden `e2e/goldens/result-screen.png`. Leftovers: see "M18-2 leftovers" in `docs/BACKLOG.md`.

### M11b: air navigation, landing zones and the debug page (headless plus a debug page; one builder in its own worktree; the orchestrator owns merging, pushing and the pull request)
- [x] 1. Flight modes as data and the service ceiling: `src/sim/rules.ts` (sixteen constants, `docs/BALANCE.md`), blocking in `src/sim/nav/grid.ts`
- [x] 2. `src/sim/nav/grid.ts` (256x128 nav grid, labels, persistent buffers), `src/sim/nav/route.ts` (`planRoute`, weighted A*, generation stamps)
- [x] 3. `src/sim/nav/lz.ts` (`scoreLz`, reason codes in priority order); `src/sim/public.ts` and the pinned list in `tests/ai/boundary.test.ts` extended at the end
- [x] 4. `debug/viewshed.html` and `src/app/debugViewshed.ts`, Vite entry, relative Dev-panel link (`src/app/modes.ts`), `tests/viewshedPage.test.ts`, `e2e/viewshed.test.ts` (golden `e2e/goldens/debug-viewshed.png`), `e2e/viewshed.serial.test.ts` (leak-test)
- [x] ACCEPTANS Alps route within fuel, Low closed share 1.43 % (< 5), Tibet cell closed High / open Low, Peak closed in both, ridge fixture lambda 3 exposes 0 of 12, Post gives exposure in both modes, label rejection without A*, one fixture per LZ reason: `tests/sim/nav.test.ts`
- [x] ACCEPTANS performance (`tests/nav.perf.test.ts`): A* median 0.074 ms (budget 2), p99 0.54 ms (budget 20) over 200 routes; label rejection 0.7 us (budget 100 us); leak test 0.00 MB for 200 queries
- [x] ACCEPTANS fingerprint equal in Node and Chromium (`4680ed7e`)
- Not run here: the full `npm run verify`, the Artifact pack, the pull request (the orchestrator).

### Sim-Growth: denser placement and City levels 1 to 10 (balance-and-rules slice after the feedback on version 20; sim and AI only, headless; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Base: 2dd505a. ENGINE_VERSION 12, FORMAT_VERSION 10. The UI track (Look-1) reads `CITY_MAX_LEVEL`, `maxLevelOf`, `cityGoldMilli`, `cityTroopCap`, `upgradeTicksOf`, `districtSlotsOf` from `src/sim/public.ts`.
- [x] 1. Spacing per type (`SPACING_CELLS_BY_TYPE`: City, Factory, Port, Post 3, SAM 5, Silo 6); the ghost and `validateBuild` read the same rule; `tests/sim/cityLevels.test.ts`, `tests/sim/structures.test.ts`
- [x] 2. City levels 1 to 10 (gold +0.5/s and cap +250 per level, price 80 to 144, time 6 to 12 s), district slots 2/3/4/5 by level (`DISTRICT_MAX_SLOTS` 5), Market table lowered for the 10x cap; conquest keeps "level minus 1, at least 1"
- [x] 3. AI upgrades Cities step by step (same validators), fifth slot is a Market; economy band retuned (see DECISIONS Sim-Growth)
- [x] 4. Hashes: both golden files re-pinned once with `UPDATE_GOLDENS=1`; forged-blob tests for the new level range and slot layout
- [ ] 5. Leftovers: see "Sim-Growth leftovers" in `docs/BACKLOG.md`

### Look-1: look and feel after the version 20 test (fast city view, City size, City style, level display; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
- [x] 1. Fast city view: `FlyOptions.fast` (`FLY_FAST_MAX_S` 1.8 fx seconds, same phases and clearance), used by "Open city" in `src/app/globeApp.ts`; the panel opens at once; `tests/render/flyToFast.test.ts` (duration, clearance, determinism, cancel), e2e in `e2e/lookCities.test.ts`
- [x] 2. City size: a smooth enlargement of Cities and districts between about 5 and 150 km of camera distance (`STRUCT_CLOSE_*`, `closeMul` in `src/render/rings.ts`, repeated in the three vertex shaders); true size closer than 5 km (so 3 km and 800 m do not cover the screen)
- [x] 3. Style setting 'Gammal / Modern' (`src/app/cityStyle.ts`, `?citystyle=old|new`, `#citystyle-new`, setup button, Dev panel modes, `Globe.structures.setCityStyle` live) and five level bands (`src/render/cityTiers.ts`, bands per model part, shader collapse); both models at most 260 triangles with the lights
- [x] 4. Level display: the panels already read "Nivå n av max" and the upgrade tooltip names the next level (max from `STRUCT_MAX_LEVEL` in public.ts); the far icon of a City has a clockwise progress arc (lit share = level / max) instead of a digit
- [x] Tests: `tests/render/cityTiers.test.ts`, `tests/app/cityStyle.test.ts`, `tests/render/flyToFast.test.ts`, `e2e/lookCities.test.ts` (goldens `city-old.png`, `city-new.png`); goldens `structures-city`, `structures-factory-port`, `districts-layer` re-pinned once (DECISIONS Look-1). Leftovers: "Look-1 leftovers" in `docs/BACKLOG.md`.
- Not run here: the full `npm run verify`, the Artifact pack, the pull request (the orchestrator).

### Look-2: unlimited levels in the render and UI, a capped footprint, visual gold inflation (one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Base aa9b996. Parallel track Sim-Levels2 owns the sim numbers.
- [x] 1. Capped footprint and gentler look: saturating bands (1, 3, 8, 20, 50), logarithmic footprint (at most 1.3 x), taller beyond band 4, hard cap `STRUCT_APPARENT_CAP_MUL` (City 24.5 km at any distance), `STRUCT_CLOSE_MUL` 1.7, districts too; `tests/render/cityTiers.test.ts`, `e2e/look2.test.ts`
- [x] 2. Level display: "Nivå n" without max, "(högsta)" at the cap, next-level numbers in the panel, logarithmic far-icon arc
- [x] 3. Visual gold inflation `GOLD_DISPLAY_FACTOR` 10 through `formatGold` / `formatGoldRate`; `tests/ui/goldDisplay.test.ts`; Dev panel hint line
- Leftovers: "Look-2 leftovers" in `docs/BACKLOG.md`. Not run here: the full `npm run verify`, the Artifact pack.


### Finished passes moved out of Now by Fix-4C (text kept word for word)

### Fix-3C: docs that lied, test holes in app and UI, hygiene (audit 2, lens fit and mutation; headless, no Chromium; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
- [x] 1. PROGRESS.md: Done rows, finished slices moved to the Archive section, Known issues M11a, Next
- [x] 2. ARCHITECTURE.md: stale rows corrected, "Aktuella versioner" line
- [x] 3. BACKLOG.md and DECISIONS.md stale lines annotated, districts drop policy logged
- [x] 4. Win path: `winForPlay` helper in `src/app/match.ts` (one-line change in `src/app/globeApp.ts`), tests for MatchSession, checkDraft, storedOf / draftFromStored
- [x] 5. winSetup: asymmetric win flags through `winInfoOfView`
- [x] 6. citySignature fields, resultRows, MatchWatcher, winDraftOf, presetOf, spawnPhaseBlocks, cityTotals Barracks cap (mutants in DECISIONS Fix-3C)
- [x] 7. Hygiene: `UI_COLORS.field` in the district icons, `PLAYER_FACING` extended
- [x] 8. Bundle size guard in `tests/portable.test.ts`
- [x] 9. `npm run verify:fast` green (typecheck, lint, 210 unit files, 2348 tests; 3 min 08 s under load)
- Not run here: the full `npm run verify`, Chromium, the pack (the orchestrator).

### Fix-3A1: audit 2, test holes in the sim state and rules (headless, no game change; one slice; the orchestrator owns merging, pushing and the Artifact)
- [x] 1. Effects cache: tests that RemoveDistrict and a finished district upgrade (Market, Housing, Barracks) change gold, cap and Barracks percent through the public getters (`tests/sim/fix3a1State.test.ts`).
- [x] 2. Housing raises the cap the regeneration grows towards (stepped test against the same state without Housing).
- [x] 3. Win flags: all 7 combinations round trip (`tests/sim/fix3a1Match.test.ts`).
- [x] 4. Hash covers winner, reason, endTick, holdOwner, holdCount (and every other match field) on its own; `foldMatch` already folded them, so NO ENGINE_VERSION bump and no golden change.
- [x] 5. `readMatch` guards: one test per guard with a valid checksum (forged through serialize of a tampered state; byte patches for the win numbers and the flag word), plus FORMAT-1 / ENGINE-1.
- [x] 6. `src/sim/win.ts`: score per City / Factory LEVEL (level 40 and 3), draw, hold restart, hold pick, match clock at the spawn-phase edge, score limit at the exact tick.
- [x] 7. Districts: BuildDistrict / RemoveDistrict at the exact tick, conquest at readyTick, two overlapping Walls give the largest percent.
- [x] 8. Mutant table in `docs/DECISIONS.md` (Fix-3A1); sim[6] (economy script margin) in `docs/BACKLOG.md`. `npm run verify:fast` green.

### Fix-3A2: audit 2 (radar reach, navigation, AI limits, MatchView) and the M12 preparation (headless slice on HEAD 04eaba8; the orchestrator owns merging and pushing)
- [x] LZ reason codes in their own range `LZ_REASON_BASE + n` (65..72), disjoint from REJECT_* (`tests/sim/lzCodes.test.ts`); the texts wait for M12a (BACKLOG)
- [x] `Los.sync` memoised per (table, tick, counters), `Los.invalidate()`, perf case with highWater 820 and 480 queries per tick (`tests/los.perf.test.ts`)
- [x] A* heuristic is a lower bound (lattice bound with excursion), proven against Dijkstra (`tests/sim/navExact.test.ts`); nav fingerprint 4680ed7e -> abb0fadd
- [x] Nav and LZ behaviours locked with mutants (corner cut, lambda 1 vs 3, ceiling term, both OUT_OF_FUEL checks)
- [x] LOS cache behaviours locked with mutants (`tests/sim/losCache.test.ts`)
- [x] Packed MatchView and ViewMirror init locked (`tests/sim/matchViewPack.test.ts`)
- [x] AI limits as fast unit scenes (`tests/ai/limits.test.ts`)
- [x] Radar mask wording corrected to the measured numbers (rules comment, BALANCE row, DECISIONS, BACKLOG); no code or number changed
- [x] Decision "M12 preparation: Los/Nav access inside step" written (option 1 chosen), one row in ARCHITECTURE
- [x] `git diff e2e/goldens` empty; `npm run verify:fast` green (see the result line in the final report); not run: full `npm run verify`, Artifact, pull request (the orchestrator)

### Fix-3B: visible faults of audit 2 (render, app, UI; one slice in its own worktree; the orchestrator owns merging, pushing and the Artifact)
- [x] 1. Match keys and the reserved keys 1 to 6 are dead behind the pause menu, the elimination panel and the result screen (only Escape passes); `e2e/modalKeys.test.ts` (mutants shown to fail)
- [x] 2. Structure layer over its allowance: the local player's structures first, then the nearest the camera (when low enough), the rest keep the far icon; a one-time toast; `tests/render/structurePriority.test.ts`; draw calls and triangles measured (DECISIONS Fix-3B)
- [x] 3. "Oppna stad" flies high enough and looks away from the panel (`cityFitFlight`): all five districts of a level-9 City inside the free window in 960x540, 1366x768 and 540x960 (`e2e/cityOpenFit.test.ts`)
- [x] 4. Escape (closing the view any way) cancels the open-city flight (same e2e file)
- [x] 5. Layout: setup header buttons wrap under the title, spectator bar below the leaderboard on narrow windows (`e2e/fixLayout.test.ts`, looked at in three sizes)
- [x] 6. Far icons: half size at most a third of the on-screen structure spacing (`src/render/iconScale.ts`, `tests/render/iconScale.test.ts`, looked at 3000, 8000 and 15000 km in `e2e/farIcons.test.ts`)
- [x] 7. Draw-call ceilings: per-layer sum <= 16 in `tests/budgets.test.ts`, 10 for the city scene in `e2e/cityOpenFit.test.ts` (measured 7)
- [x] 8. Unlocked Look-1 / Polish-1 formulas pinned with mutants (`tests/render/lookFormulas.test.ts`, `tests/app/inputShift.test.ts`, `tests/render/flyToFastDuration.test.ts`)
- [x] 9. `__test.give` above DEBUG_GIVE_MAX throws with the reason (e2e in `e2e/modalKeys.test.ts`)
- Not run here: the full `npm run verify`, the Artifact pack, the pull request (the orchestrator). Leftovers: "Fix-3B" in `docs/BACKLOG.md`.

### M12a-1: helicopters in the sim, part 1 of 3 (Los/Nav inside step, the helicopter and beachhead tables, ProduceHeli, the fleet cap; headless sim; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Previous merge SHA (origin/main; nothing of this branch is merged, pull request #1 is a draft): f29121a8d1607ca169e6675b5f22a52d76c42ef7.
- [x] 1. GÖR and ACCEPTANS written here first
- [x] 2. Los/Nav inside `step`: optional `maxElev` in `SimWorldInput` / `SimWorld` (not in `mapHash`), a lazy, never hashed, never serialised Los/Nav on `GameState.env`, dropped by `deserialize`; `exposureOf` / `planRouteOf` / `scoreLzOf` take a state; a clear error when `maxElev` is missing
- [x] 3. Helicopter table (SoA, 64) and beachhead table (64) designed for all of M12a, serialised and hashed; ENGINE_VERSION and FORMAT_VERSION bumped once, both golden hash files re-pinned once, identical in Node and worker
- [x] 4. `ProduceHeli{factory}` with codec and reason codes (NOT_OWNER, NO_FACTORY, FACTORY_BUILDING, QUEUE_BUSY, FLEET_CAP, NO_GOLD, REJECT_PHASE); 200 gold, 12 s, fleet cap 2 + sum of Factory levels (max 12, a helicopter in production counts); ONE implementation shared with `validateProduceHeli` (pinned in `tests/ai/boundary.test.ts`); SimView read access (`helis`, `fleetCapOf`, `fleetCountOf`)
- [x] 5. Outbox events (HeliQueued, HeliProduced; the rest declared); a Factory conquered or destroyed scraps its helicopters and its queued production (provisional)
- [x] 6. Reject texts (the ProduceHeli codes and the eight LZ codes 65..72), sv and en
- [x] 7. Tests: every reason code, price and time tick-exact, fleet cap, free list and reused id, round trip and snapshot equals straight run with helicopters, Los/Nav access, conquest, goldens in Node and worker, perf (12 helicopters, 300 structures, 12 players)
- [x] 8. Docs (DECISIONS M12a-1 with its mutant table and the hooks for part 2, ARCHITECTURE, BALANCE, BACKLOG) and `npm run verify:fast` green (typecheck, lint, 226 unit files, 2484 tests + 2 expected fail; 2 min 32 s). Perf (alone): heli.perf, sim.perf, structures.perf, ai.perf green.
- Not run here: the full `npm run verify`, Chromium, the pack, a pull request (the orchestrator).
### M18c-1: diplomacy in the sim and the AI (truce, alliance, embargo; headless; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Previous merge SHA (origin/main): f29121a8d1607ca169e6675b5f22a52d76c42ef7; nothing of this branch is merged (pull request #1 is a draft); base commit a81d4b0.
GÖR
- [x] 1. GÖR and ACCEPTANS written here first
- [x] 2. Model: relation per seat pair (war / truce 2400 ticks / alliance), proposal table (32, 600 ticks), betrayal cooldown, embargo owner; in state, serialize and hash (FORMAT and ENGINE raised once, goldens recomputed once)
- [x] 3. Intents ProposeTreaty, AcceptTreaty, DeclineTreaty, BreakTreaty, ImposeEmbargo, LiftEmbargo (wire kinds 15 to 20, reason codes 80 to 93), ONE shared check each behind validate*, exports pinned, SimView.diplomacy
- [x] 4. Rules: no Attack between treaty parties, running attacks cancelled, truce expires tick-exactly, Break gives war + cooldown + statistics, alliance trade, embargo trade, elimination clears
- [x] 5. Statistics in MatchView (treaties made, broken, active relations)
- [x] 6. AI: replies after a delay, proposes, breaks an alliance as a leader, never an invalid intent; memory in the AI blob
- [x] 7. Texts sv and en for the new reasons; tests; docs; `npm run verify:fast`
ACCEPTANS
- [x] Every intent and reason code tested, one shared implementation, exports pinned
- [x] Attack ban between treaty parties and cancelled running attacks tested; expiry tick-exact
- [x] Betrayal: cooldown, statistics; embargo and alliance trade act in the economy
- [x] Serialisation, hash, goldens in Node and worker; goldens recomputed once
- [x] The AI replies and proposes by the rules, never an invalid intent over 20 seeds; solo script and pace test inside their bands
- [x] `npm run verify:fast` green

- Result: `npm run verify:fast` green (typecheck, lint, 238 unit files, 2625 tests; 2 min 02 s); perf alone (sim, ai, conquest) green; `npm run sim:scenario -- --solo` unchanged (10 786 cells at minute 10); the full `npm run verify`, Chromium, the pack and the pull request are the orchestrator's. The orchestrator sets the final ENGINE_VERSION / FORMAT_VERSION and regenerates `e2e/goldens/sim-hashes.json` and `e2e/goldens/match-hashes.json` when the two sim tracks are merged (here ENGINE 16, FORMAT 13). Details, measured AI behaviour and the moved test bounds in `docs/DECISIONS.md` "M18c-1".

### M20a-lite: hotkey registry, help overlay `?`, command resolver, top bar with a win meter (UI and app; src/sim untouched; one slice in its own worktree; the orchestrator owns merging, pushing and the Artifact)
GÖR
- [x] 1. `src/app/hotkeys.ts`: `registerHotkey`-style registry (`HotkeyRegistry.register`), every game key moved in (F focus, 1 to 6, Escape via the input stack, space / `,` / `.` / `[` / `]` / `-` / `+`, F3, F2, `?`); the Fix-3B modal block and `RESERVED_KEYS` kept
- [x] 2. Grep test: no `keydown` listener outside `src/app/input.ts`, `src/app/hotkeys.ts` and the documented exceptions (`tests/app/hotkeyGrep.test.ts`, mutant included)
- [x] 3. Help overlay `?` (`src/ui/helpOverlay.ts`) generated from the registry, sv and en, Escape through the input stack
- [x] 4. `src/app/commandResolver.ts`: rule table (build on own ground, selected structure against another cell, attack), `registerCommandRule` for M13b / M15b; the selection mode gets `context(cmd)`
- [x] 5. Top bar: gold with income, troops with cap bar and 80 % warning, land %, timer, win meter and hold count-down (`src/ui/winMeter.ts`), 10 Hz write gate (`src/ui/hudGate.ts`)
ACCEPTANS
- [x] The registry owns every game key; the grep test goes red for a new listener (`tests/app/hotkeys.test.ts`, `tests/app/hotkeyGrep.test.ts`)
- [x] `?` overlay == registry both ways (`e2e/m20aLite.test.ts`); the modal tests of Fix-3Bs `e2e/modalKeys.test.ts` stay green
- [x] Resolver table test for every rule and the invalid targets, `context(cmd)` of the selection mode (`tests/app/commandResolver.test.ts`); e2e for the right click (placement mode leaves without an intent, selected structure goes to the resolver)
- [x] Top bar: values equal the sim, 0 DOM mutations at rest, no overlap at 960x540, 1366x640 and 540x960 with the longest strings, win meter follows the MatchView (`tests/ui/topBar.test.ts`, `e2e/m20aLite.test.ts`)
- [x] Screenshots of `?` and the top bar looked at in both languages
- [x] `npm run verify:fast` green; the touched e2e files green. Not run here: the full `npm run verify`, the Artifact pack, the pull request (the orchestrator).
### M13a-1: the helicopter is visible (render and UI; src/sim untouched; one slice in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Previous merge SHA (origin/main): f29121a8d1607ca169e6675b5f22a52d76c42ef7
GÖR
- [x] 1. `src/render/heliModel.ts` + `src/render/heliLayer.ts` + `src/render/shaders/helis.ts`: one merged model (under 150 triangles, per-vertex part id), the rotor spins in the vertex shader from the fx clock, ONE instanced draw (capacity 64), owner colour per instance, every non-empty HeliView row except under-production drawn
- [x] 2. Build button in the Factory selection panel (price, queue, fleet gauge, dimmed with the reason), toasts for produced and scrapped
- [x] 3. HUD line "Helikoptrar n/tak" with a data-testid
- [x] 4. Budget row (1 draw call) in the table and `tests/budgets.test.ts`; leak test if needed
- [x] 5. Test hook `__test.helis()`
ACCEPTANS
- [x] Build button works end to end (e2e: after the build time the helicopter stands at the Factory)
- [x] Every state is drawn, position == sim position within 0.5 cell (unit test)
- [x] The rotor alone changes pixels (e2e)
- [x] 1 draw call measured, instances <= 64, no console errors
- [x] Screenshots at 3 km and 800 m, day and night, looked at
- [x] `npm run verify:fast` green; touched e2e green
- Looked at: `test-results/shots/helis-3km-day.png`, `helis-800m-day.png`, `helis-3km-night.png`, `helis-800m-night.png`, `helis-panel.png` (written by `e2e/helis.test.ts`). Not run here: the full `npm run verify`, the Artifact pack, a pull request (the orchestrator). `e2e/helis.test.ts`, `e2e/m20aLite.test.ts`, `e2e/structuresSelect.test.ts`, `e2e/hud.test.ts` green.

### M12a-2: helicopters in the sim, part 2 of 3 (LaunchHeli, the flight, fuel, RecallHeli, the return; headless sim; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Previous merge SHA: nothing of this branch is merged (pull request #1 is a draft); base commit 6b1a032.
GÖR
- [x] 1. GÖR and ACCEPTANS written here first
- [x] 2. Intents `LaunchHeli` (wire kind 13) and `RecallHeli` (kind 14) with codec, reason codes 51 to 54, texts sv and en, ONE shared check (`checkLaunchHeli` / `checkRecallHeli`) behind `validateLaunchHeli` / `validateRecallHeli`, exports pinned
- [x] 3. The flight in `heliPhase` (`src/sim/heliFlight.ts`): Pad, TakeOff 20, Cruise, Approach, Hover 30, placeholder, RTB, Pad; Downed; fixed point, wrapX, terrain following, fuel, Recall, home Factory lost
- [x] 4. The landing placeholder (HELI_LANDED, no conquest, no troops created or lost) and the exact replacement point for part 3
- [x] 5. ENGINE_VERSION once, goldens recomputed once, Node equals worker
- [x] 6. Tests (each reason code, tick-exact TakeOff/Hover, property test over Alps / Himalaya / Andes in both modes, fuel, Recall, home lost, round trip, snapshot equals straight run, perf with 12 airborne, SimView.helis transfer measured)
- [x] 7. Docs and `npm run verify:fast` green
ACCEPTANS
- [x] LaunchHeli / RecallHeli: every reason code, one shared implementation, exports pinned
- [x] Flight: clearance, Peak, NaN, liveness, speed cap, fuel, Recall, home lost: property and unit tests
- [x] Landing placeholder documented with the exact replacement point; no troops created or lost
- [x] ENGINE raised once, goldens recomputed once, Node == worker; round trip and snapshot == straight run with helicopters airborne
- [x] Perf: median <= budgetMs(0.5) per tick with 12 airborne; the SimView.helis transfer measured
- [x] `npm run verify:fast` green

- Result: `npm run verify:fast` green (typecheck, lint, 233 unit files, 2545+ tests; 2 min 58 s); perf alone: heliFlight.perf, heli.perf, sim.perf green (flight phase of 12 airborne 25.8 us on a quiet run); the full `npm run verify`, Chromium, the pack and the pull request are the orchestrator's. Details, mutant table, measured flight times and the hooks for part 3 and M13 in `docs/DECISIONS.md` "M12a-2".
### M12a-3: helicopters in the sim, part 3 of 3 (the landing, the beachhead, the cut-off cluster; headless sim; one builder in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Previous merge SHA (origin/main; nothing of this branch is merged, pull request #1 is a draft): f29121a8d1607ca169e6675b5f22a52d76c42ef7; base commit a81d4b0.
GÖR
- [x] 1. GÖR and ACCEPTANS written here first
- [x] 2. Landing (replaces the placeholder): HELI_UNLOAD 10 ticks, LZ cell then N,E,S,W,NE,SE,SW,NW at the Attack cell price (x2 enemy), 1 to 9 cells, a failed landing loses the load, the rest of the load is an Attack from the beachhead, beachhead table row, `landingBlockedBy` hook
- [x] 3. Cut-off cluster: every 10 ticks a bounded BFS (80 cells), established at 80 cells or a City (post freed), else neutral exactly 450 ticks after the landing; the cluster counts for no troop cap, regeneration or gold land while cut off (cached); two beachheads that grow together merge; the enclave rule does not flip a cut-off cluster
- [x] 4. Outbox: BEACHHEAD_FORMED, BEACHHEAD_REVERTED, HELI_LANDED (cells or failed); elimination with only a beachhead left
- [x] 5. Tests (reasons, 1 to 9 cells, failed landing, order, tick-exact revert, no revert at 80 cells or a City, no economy from the cluster, date line, round trip, snapshot == straight run, property test over many landings, Node == worker golden), perf
- [x] 6. Docs and `npm run verify:fast`
ACCEPTANS
- [x] Landing, beachhead 1 to 9 cells, failed landing, order, troop audit (no troops from nothing)
- [x] Cut-off cluster tick-exact 45 s; an established cluster does not revert; no economy from the cluster meanwhile
- [x] Elimination with only a beachhead left tested
- [x] Round trip, snapshot == straight run, golden Node == worker
- [x] Perf within budgetMs(0.5)
- [x] `npm run verify:fast` green
- Result: `npm run verify:fast` green (typecheck, lint, unit tests 2 min 35 s); perf alone: heliLanding.perf (tick with 12 airborne and 4 beachheads 34 us, four searches 11 us), heliFlight.perf, heli.perf green. The full `npm run verify`, Chromium, the pack and the pull request are the orchestrator's. Details, mutant table and the Alps text replay in `docs/DECISIONS.md` "M12a-3".
### M13b: deploy mode, landing zone preview and route preview (render, UI, app; src/sim untouched; one slice in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Previous merge SHA: nothing of this branch is merged (pull request #1 is a draft); base commit a81d4b0.
GÖR
- [x] 1. GÖR and ACCEPTANS written here first
- [x] 2. `src/app/launchPreview.ts`: `previewLaunch` (the verdict IS `validateLaunchHeli`), `LaunchPreviewer` (one query out, stale answers dropped, 5 Hz, answers as Promises)
- [x] 3. Deploy mode (`src/app/deployMode.ts`, an input mode; Escape pops), `src/ui/deployBox.ts` in the Factory panel (button, troop slider 1..600, Low / High, verdict, flight time and fuel, Cancel), live marker and route (`src/render/deployLayer.ts`, 3 draw calls)
- [x] 4. Key L (registry) and the resolver rule `factory-deploy` (a right click with a Factory selected opens the mode)
- [x] 5. Helicopter list with Recall in the Factory panel; toasts for landed and shot down (`MissionWatcher`), sv and en
- [ ] 6. Beachhead ring: NOT done here (the beachhead table is not in `SimView` in this branch), see BACKLOG "M13b-2"
- [ ] 7. Exposure plan view (key E): NOT done (time), see BACKLOG "M13b-2"
ACCEPTANS
- [x] Parity: `previewLaunch` / `validateLaunchHeli` equal the real LaunchHeli intent for 35 cells and every reason code, BAD_TROOPS, NO_PAD, NOT_OWNER, NO_FACTORY (`tests/app/launchPreview.test.ts`), NO_GOLD for the production check
- [x] Async and throttle with a delayed fake query (`tests/app/launchPreview.test.ts`)
- [x] Playwright flow (`e2e/deploy.test.ts`): green and red marker, route, 300 troops, Low, launch, flight, landing toast, Escape, refused zone sends nothing (the beachhead-ownership step is `it.skip` until M12a-3 is merged)
- [x] Draw calls: route 2 + marker 1, layer on/off by `renderer.info` (3 measured, with the helicopter layer 4); no console errors; leak test `e2e/deployLeak.serial.test.ts` (320x180, 60 renders, heap delta 0.09 MB, geometries and textures unchanged)
- [x] Screenshots looked at: `test-results/shots/deploy-red.png`, `deploy-green.png`, `deploy-route-tilted.png`, `deploy-flying.png`, `deploy-landed.png` (the beachhead picture waits for M12a-3)
- [x] `npm run verify:fast` green (typecheck, lint, 237 unit files, 2579 tests + 2 expected fail; 1 min 50 s); touched e2e green: deploy, deployLeak.serial, m20aLite, structuresSelect, structures, helis, modalKeys, hud, fixLayout, fixUi
- Not run here: the full `npm run verify`, the Artifact pack, a pull request (the orchestrator). The beachhead step of `e2e/deploy.test.ts` is `it.skip` until M12a-3 is merged.

### M18c-2: diplomacy in the interface and a livelier AI negotiator (UI, app and the AI temperament; one slice in its own worktree; the orchestrator owns merging, pushing and the Artifact)
Previous merge SHA: nothing of this branch is merged (pull request #1 is a draft); base commit 719b212.
GÖR
- [x] 1. GÖR and ACCEPTANS written here first
- [x] 2. AI temperament: truce answer, alliance threshold, truce proposal to the most frequent attacker; ENGINE 18, goldens recomputed once; measured in `tools/sim/diploMeasure.ts`
- [x] 3. Pure model `src/ui/diploModel.ts` (rows, button states from validate*, confirm step) and the panel `src/ui/diploPanel.ts` (key D in the registry, a top bar button, Escape closes)
- [x] 4. Incoming proposal cards (at most 3, countdown, Accept / Decline), toasts for new proposals and for the AI's answers (accepted, declined, expired), a "n proposals" signal in the top bar
- [x] 5. Relation badges in the leaderboard and the panel rows; the result screen rows "Treaties made" / "Treaties broken"; an attack click on a treaty party gives a toast and sends no intent
- [x] 6. Tests: model units, e2e flow, three window sizes without overlap in both languages, 0 DOM mutations at rest, D in the `?` overlay; mutants shown
- [x] 7. Docs (DECISIONS M18c-2, ARCHITECTURE, BALANCE, PREVIEW, BACKLOG M18c-3) and `npm run verify:fast`
ACCEPTANS
- [x] Panel: every button is decided by validate*; confirm step on Break; own cooldown shown
- [x] Incoming proposals can be accepted and declined; a toast for the AI's answer, also decline and expiry
- [x] Badges in the leaderboard; the result screen shows the treaty statistics
- [x] Attack click on a treaty party: an understandable toast and no needless intent
- [x] AI temperament: measured acceptance rates logged, ENGINE raised once, goldens recomputed once, pace test inside its band
- [x] Three window sizes without overlap, both languages; 0 DOM mutations at rest; D in the `?` overlay
- [x] `npm run verify:fast` green; the touched e2e green

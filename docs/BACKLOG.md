# Backlog

Ideas that are NOT built in the current milestone. Add one line each.

- Darker ambient term and a visible terminator in the spike shader (cosmetic; real atmosphere comes with the stylised Earth).
- Run e2e against a production `vite build` as well as the dev server (checks the shipped bundle).
- `src/app/dataPack.ts` (M00b probe loader) duplicates `fnv1a32`, `decodeBase64` and `gunzip` from `src/data/bytes.ts`; re-export them from `src/data` once the probe page is next touched.
- Forest/Plains rule is by latitude only (Sahara shows forest patches at 12 %, Amazon is cut by the latitude bands); a rainfall-like noise layer or a coarse climate table would look better. Cosmetic.
- Polar caps beyond 85.05 degrees are synthetic (smoothed copy of the last real row); a proper polar fill or a polar stereographic tile set would remove the visible streaks in the height map. Since the M02 fix pass the shader fades the slope shading and the sea depth colour out in the cap (`POLAR_FADE_*` in `src/render/config.ts`) and the pole itself has one height, but the cap GEOMETRY still has the radial ridges (visible from a tilted camera at the south pole): fix it in the bake (blend the cap to its longitude mean).
- Joerd/Mapzen attribution page could not be reached; replace the general credit line in `CREDITS.md` with the exact source list when it is reachable.
- Debug data page: `?map=` is read once (M02 added links to the three maps in the Dev panel; the page itself still reads its own `#map-...` only at load).
- DECISION FOR THE USER (M04/M06): the Ice rule also turns high, cold land into unplayable Ice (latitude >= 62 and mean >= 1400 m): about 62 % of Greenland's land cells (3398 of 5460) plus a few Canada, Russia, USA and Iceland cells. The prompt only named Antarctica and latitude > 84N. Revisit if Greenland should be playable (one-line switch in `tools/bake/classify.ts`: `ICE_CAP_MIN_LAT`, `ICE_CAP_MIN_MEAN_M`).
- 25 microstate capitals (for example Singapore, Valletta, Manama) are dropped from `public/data/cities.json` because no land cell of the same country lies within 3 cells. Snap them without the same-country requirement, or keep them in an `unsnapped` list, when cities are rendered (M10).
- `public/data/meta.json` `countries[].weightedAreaKm2` (land cells, majority vote) is NOT monotone in country id: ids follow polygon area at render resolution (water inside the polygon counts). Do not assume id order equals land-area order; add a `polygonAreaKm2` field if a consumer needs the id order.
- `bake:check` is an offline check that could be added as a CI step (the workflow file was not touched in M01).
- Globe look: the Sahara, Arabia and the Gobi show dark green Forest patches (the baked Forest/Plains rule is by latitude and a block hash). A coarse climate table (desert boxes) in the bake, or a shader aridity tint from a small baked climate layer, would fix the biggest eyesore of the whole-Earth view (needs a re-bake: new pack layer). The patches are dark axis-aligned squares (the `FOREST_BLOCK` blotch hash) and the Forest/Plains boundary is a straight latitude edge along the Sahel (`FOREST_PERCENT_BY_LAT` in `tools/bake/classify.ts`): besides the climate table, an aridity mask or sub-cell noise in the bake, or a low-frequency detail mask in the biome shader, would break the squares and the edge.
- Globe look: tune on a real GPU: `FACET_WEIGHT`, the snow line, `AMBIENT_DAY`, `HEIGHT_EXAGGERATION` (all in `src/render/config.ts` and the snow line in `src/render/shaders/terrain.ts`).
- Camera: focus on the displaced height (mountain-centred orbit and zoom) instead of the sea-level point; keep north up when the anchored zoom rotates the heading (small drift now).
- Fjords at high latitude show as thin one-pixel sea strips because the mask is 4096x2048 (about 4.6 km wide at 62 N, 9.8 km tall); the M07 detail pass or a signed-distance mask would round them.
- Limb aliasing at the test tier (MSAA off by rule); the atmosphere shell (checkpoint B) softens it.
- Borders: the id raster is nearest-sampled, so the line is stair-stepped at 10 km when zoomed in; a signed-distance id raster (or the M07 detail pass) would give smooth lines. Border line width follows the pixel (about 1.4 px), not the zoom.
- Night lights: city blobs are Gaussians with speckle; a real light layer (roads, regions without a city in `public/data/cities.json`) would need a baked layer. Clouds, aurora and city glow on the sea are not done.
- Ocean: the waves are a phase-warped sum of plane waves (cheap and deterministic); foam at coasts, a depth-based shore wave and a screen-space reflection of the globe's own limb are ideas. Real-GPU tuning of `OCEAN_*` and `ATMOSPHERE_*` in `src/render/config.ts` is part of the user's check.
- Atmosphere: the shell is a sphere at 1.07 Earth radii; a thinner shell with a higher density factor would look closer to the real 1.016 and cost fill rate near the limb.
- Dev panel: modes with a value (`?view=`, `?scenario=`) need a small text field; today a mode has fixed params. The debug map pages are linked from the panel (class, height, country); the `?map=` of that page is not a mode of the globe page.
- Perf overlay: fps and p95 come from the last 600 frames; a graph of the frame time and the GPU timer query extension (when available) are ideas for M24a.
- Night lights read as large saturated blobs and their brightness varies with zoom: tune `LIGHTS_GAIN` (`src/render/config.ts`) and the blob footprint and speckle fade in `src/render/nightLights.ts` / the terrain shader on a real GPU.
- Camera: at `DIST_MIN_KM` 220 with `TILT_MAX_DEG` 72 the camera is below the exaggerated peaks over Everest and the picture is featureless; raise `DIST_MIN_KM` or scale the tilt limit with the distance (M08 replaces the camera anyway).
- The test-tier mesh (256x128) shows a coarse diagonal facet at 500 km zoom; the M07 LOD replaces it.
- M03: the state hash is 32 bits. For lockstep desync detection (M26) add a second lane (another seed of the same fold) or a 64-bit pair; only the hash function and the files that print it change.
- M03: no replay protection across turns: a seat's intent ids are only unique inside a turn. A per-seat "highest id seen" array in the state (hashed) would let the server refuse resent intents; decide in M26.
- M03: replays and lockstep need the host to take TURNS from outside (`scheduleTurn(turn, intents)` next to `submitIntent`, plus an option to stall the accumulator until the turn is there) and to record executed turns with `encodeTurn`; the pending map and the codec are ready for it.
- M03: M05 will want a light snapshot (ownership array only) next to the full serialised one; `Snapshot.bytes` needs a full `deserialize` today (about 6 ms and 4 MB of copies at 1024x512).
- M03: `TICKS_PER_TURN` (a turn of several ticks, 200-300 ms of network turns) is not modelled; `Turn` and `Tick` are the same number. Add the constant to `src/sim/rules.ts` and let `step` run the intents on the first tick of a turn when lockstep needs it.
- M03: the cross-engine claim of the canary rests on V8 in Node and in Chromium; run it in Firefox and Safari when a machine with them is available.
- M03: the first two turns of a match are always empty (input delay); a UI that wants instant feedback must predict locally, not by waiting for the sim.
- M03 fix pass: the full-owner resync of an overflowing outbox (D69) is a safety net. Once M04 knows how many cells a step can change, give the sim a dedicated non-lossy changed-cell list (filled by `step()` on owner writes, outside the hash) and let the host drain that instead of the outbox, so a big conquest costs a delta and not a 4 MB array.
- M03 fix pass: the host resume part (D68) is not inside `serialize()` bytes. M24a / M26 need to store a `Snapshot` as one unit (a small container: `bytes` plus a codec for `HostResume`) when it must survive a restart outside memory.
- Heads-up for M04 (from the M03 audit): (1) `owner` is `Uint8` in `GameState` and `StateDiff.owners`, but M04 and M05 need 16-bit owner ids (tribes get ids after the players): widen `owner` to `Uint16Array` together with `StateDiff.owners`, `serialize`/`hashState` and the goldens in one commit and justify the golden change in `docs/DECISIONS.md`. (2) Keep `Noop` and `DebugPaint` when adding `Spawn`/`Attack`: the golden scenario, the sensitivity tests and `debug/sim.html` depend on `DebugPaint` under `config.debugIntents`. (3) A new intent kind needs edits in `copyBody`, `withId`, `compareIntents`/`comparePayload` (a kind without a case compares equal and falls back to arrival order) and in `intentSize`, `putIntent`, `assertEncodable` and `Reader.intent` of `src/sim/codec.ts`; only the decoder is checked by the compiler, so extend the codec round-trip and the order-independence property tests for the new kind. (4) `src/host` runs inside the M24a Worker but has no ESLint boundary yet: add it to `BOUNDARY_FILES` in `eslint.config.js` (no `three`, DOM, `render`, `ui`, `audio`, `app`). (5) `TICK_MS`, `MAX_TICKS_PER_FRAME` and `INTENT_DELAY_TURNS` sit in `src/sim/rules.ts` next to game rules: only the sim-affecting ones may force an `ENGINE_VERSION` bump.
- M04 A (done): items (1) owner width and (4) the `src/host` ESLint boundary of the heads-up above are done (D71, D72); (3) was followed for Spawn (D74); (2) holds; (5): `TICK_MS`, `MAX_TICKS_PER_FRAME`, `INTENT_DELAY_TURNS` and `MAX_INTENTS_PER_TURN` are still in `src/sim/rules.ts`, only the sim-affecting ones force an `ENGINE_VERSION` bump.
- M04 A: the host diff carries ownership only. M05's HUD needs per-owner troops, gold, cells, land share and cap: add a small stats record next to the diff (or read it through `SimView`), not a second path around the host.
- M04 A: `MAX_SEATS` is 255 because an intent carries the seat in one byte (D71). More owners (many tribes) need a varint seat in the codec and a new `FORMAT_VERSION`.
- M04 A: the capital disc is read in SIM cells (radius 8, 197 cells, D75); the converted reading (radius 16, 797 cells) is two constants in `src/sim/rules.ts` plus re-pinned goldens, if the start empire should be larger.
- M04 A: own choices that the user may want to tune after playing: `MAX_DECAY_TROOPS_PER_SEC` 40, `GOLD_PER_STD_CELL_MILLI_PER_SEC` 50, `HEIGHT_UNIT_M` 16 (all in `docs/BALANCE.md`, source "eget val").
- M04 A: gold keeps a floor (less than one milli-gold lost per tick, 0.3 % at the start disc); an exact remainder like `troopFrac` would be easy to add if gold ever has to be exact.
- M04 A: a seat that loses all its cells keeps its troops frozen (the economy skips owners without cells); elimination rules (zero the troops, free the capital) belong to M18.

- M04 B: a defender loses no troops when it loses a cell (it only slows the attack through `Td`, D83); a loss proportional to its troops per cell (`T / area`, no terrain term: the plan's "försvararen förlorar ingen terrängterm" hints at a defender loss) would make wiping a seat out cheaper and is one line in `advanceAttack`; decide after M05 playtests.
- M04 B: an attack ends when the cell it picked is dearer than its pool (a random Mountain cell can end an attack that could still pay for Plains cells next to it). A "skip the dear cells and try another pick" rule, or a minimum pool, would use the troops better; the leftover goes home either way.
- M04 B: an enclosed region larger than `ENCLAVE_MAX_CELLS` (64 cells) never flips by itself; an attack can still take it at the normal price. A bigger cap costs work (each failed fill reads up to the cap); a smarter test (fill from the smaller side) would allow it.
- M04 B: `CancelAttack` names one target; a "cancel all my attacks" form (target 255 or a flag) is not in the wire format yet.
- M04 B: the scripted bots in `tools/sim/bots.ts` are placeholders for the scenario runner and the calibration (expander, fighter); the real AI is M05 / M16. The solo band depends on their policy only through re-launching after an attack ends.
- M04 B: a burst of 100 000 changed cells in a tick overflows the render outbox (8192 events); the host falls back to `fullOwner` (D69). A dedicated non-lossy changed-cell list is still the better answer once M05 renders ownership.
- M04 B: a seat that has lost all its cells keeps its troops and its attacks end (no elimination rule yet, M18). `Attack` from a seat without land is refused (`REJECT_NOT_SPAWNED`).
- M04 B: dh takes the HIGHEST attacker neighbour as the source (the attack comes in from its best side); the mean of the attacker neighbours, or the cell the frontier entry was found from, are alternatives with the same cost.
- M04 B: tests that need an all-land 1024x512 world must pass `rowCos` (a uniform small weight): the real cos table would make the playable weights exceed 2^32 (the `Grid` refuses); see `tests/helpers/burstWorld.ts`.
- Heads-up for M12a (from the M04 audit, D91): `ENCLAVE_MAX_CELLS` is 64 and any region of that size or less that ONE other player surrounds flips to that player for free within 20 ticks. A helicopter beachhead of 1 to 9 cells behind enemy lines is such a region and would be gone in a second or two, which breaks the landing, the 45 s revert logic, the 'expands per normal rules' acceptance and M17's air assault; M12a's 'established' threshold of 80 cells is above the cap, so only clusters that M12a calls 'not established' survive today. Before M12a: add an exemption (a flag array in the state, or a lookup into the beachhead table) that makes `checkRegion` (`src/sim/enclaves.ts`) treat a region that holds an exempt cell as open; say in the M12a prompt that beachheads are exempt, state the cap against the threshold, and expect an `ENGINE_VERSION` bump, re-pinned goldens and edits to the quiescence tests (`tests/sim/frontier.test.ts`, `tests/sim/enclaveMatch.test.ts`). `tests/sim/frontier.test.ts` pins today's behaviour (1, 9 and 64 cells flip, 65 stay). M12a must also say which depth its landing writes into `state.exposure` (0, or a bounded breadth-first search to `D_MAX_CELLS`), because `captureCostMilliQt(cls, dh, depth)` prices a cell by the depth the attack gives it.
- M04 fix pass: since D91 the depth term of the price lives in `state.exposure` and cannot be reset by cancel + relaunch. M05, M16 and M19 must not treat 'cancel and relaunch' as a way to lower the price (it is not one; `tests/sim/relaunch.test.ts` pins it). Open: a cell exposed by two attackers keeps the record of the last one, so the other starts it at depth 0 after a relaunch; an exact per-attacker depth would need one record per (attacker, cell).
- M04 fix pass: the enclave candidate rule queues about 1.8 candidates per changed cell (D91, was 1.1). If the pass ever shows up in a profile: a fill that gives up at the size cap could remember the region (a per-region id array, derived) so that the other candidates of the same region in the same pass stop at once; the marks of one pass already share `MARK_OPEN`.

- M05 A: the weak M02 country border lines still run through the middle of a territory (they are drawn before the territory); they could fade out where an owner covers the land. Real GPU: tint, glow, line width and warp (`OWNER_*` in `src/render/config.ts`) were judged in SwiftShader only.
- M05 A: no way to cancel an attack from the UI (`CancelAttack` exists in the sim); a second click on the same enemy adds troops. A "cancel" key or button, and a list of running attacks with their progress, belong to the HUD of M20.
- M05 A: the spawn phase always lasts 20 s; "ends when every player has spawned" would need a sim rule (a flag in the state), not a UI shortcut.
- M05 A: the click target uses the sim cell; at coasts the nearest playable cell within one cell is meant (`resolveClickCell`). A finer rule (the render raster's land pixel) would need the country raster of the render pack.
- M05 A: the temporary HUD and start screen were replaced in part B (done); the debug link row and the probe link are hidden once the match starts (D100).
- M05 A: the host builds `number[]` lists per frame that ran ticks (diff cells and owners) and clones them per listener; a pooled typed buffer would avoid that garbage if a real-GPU measurement ever shows frame spikes (the cost per frame is logged in the perf report).
- M05 B: the developer tools (Dev panel, perf overlay and report, report modal, debug pages, the two link chips of the start page) are Swedish only (D98); M23a (settings and completion) can translate them through the same tables.
- M05 B: with `#perf` on from the start, the wide perf overlay (top left) can cover the banner of the spawn phase for the first seconds; the banner hides itself 12 s after the immunity. A cleaner fix is to let the perf overlay step aside like it does for the Dev panel (or give it a collapsed mode).
- M05 B: a player who does not spawn within 20 s is told so and has to reload the page; a "new match" button belongs to the match flow of M18. Also open: remember the chosen language (localStorage) between visits.
- M05 B: the status panel grows by one line while the "Nära taket" warning shows (it sits at the bottom, so the panel grows upward); reserving the line would keep the layout still, at the price of an empty row most of the time.
- M05 B: nations are called "Nation N" and tribes "Stam N" until M06 gives them real or custom names and flags; the neutral tribes are left out of the leaderboard (`LEADERBOARD_INCLUDES_TRIBES` in `src/ui/uiConfig.ts`).
- M05 B: the HUD sizes (font between 14 and 22 px by window width, 44 px targets) were judged in SwiftShader screenshots at 960x540 and 1920x1080 only; tune on a real GPU and a real screen. A phone layout is not designed (the start card fits 390x844, the HUD panels would crowd each other).
- M05 C: a refusal in the host's view is not attributed to a seat (`OUTBOX_REJECT` carries `b = 0`): the HUD toast shows a refusal only when it happened at a tick at which one of YOUR intents was due, but an AI intent refused at that same tick would be shown as yours. Rare (seed 7, 20 minutes: one AI intent of about 320 was refused, a lost race with the input delay). Putting the seat into `b` of the reject event (it is render-only, not hashed) would make the attribution exact.
- M05 C: the AI's memory and random stream are not in `HostResume` (D103): a snapshot of a match with the AI resumes into a different match than the straight run. M24b (save / load) must serialise `AiDriver` (memories: seat, release, retryAt, attempts, `lastAttack`; the 4-word stream) and resume it with the host.
- M05 C: AI v0 has no defence logic, no cancel, no naval or air play and ignores terrain (it attacks the weakest neighbour whatever the border looks like); it waits for half of its cap, so it expands about half as fast as a player who attacks continuously. M16 (AI Director v1) replaces it; the per-seat budget `budgetMs(0.5)` is met by a factor of 100 (median 1 to 3 us), so M16 has room.
- M05 C: tribes are placed around the human capital (D104) with a fixed reach of 90 cells and stop at 600 cells. After the player has swallowed the neighbouring tribes there is nothing to fight for a while; a "tribes respawn" or "wandering tribes" rule, and tribe names, belong to M18 (match flow) and M06.
- M05 C: the AI nations never come for a human who is not their weakest neighbour; a nation next to the human but stronger than a tribe on its other side attacks the tribe first. That is what "the weakest neighbour" means, but it makes the early game quiet. Real-GPU playtest: if the nations feel passive, raise `AI_EXPAND_COMMIT_PCT` / lower `AI_WAR_MIN_RATIO_PCT` (BALANCE.md) before touching the code.
- M05 C: `?ai=0` / `#ai-0` is a debug and test option (an empty match); there is no menu entry for it (M06 / M23a).
- M06 A: Greenland (capital cell is Ice in the 39 km grid) cannot be chosen; a rule that moves the capital to the nearest playable cell of the same country would make it selectable (its 2 062 playable cells are a coastal strip). Decide with the user after playing.
- M06 A: the trait multipliers are mapped from two map statistics only (coast share, mountain share); population, area and the number of neighbours are other candidates. M09 reads `home.portMilli` for the port income; M16 can read `config.difficulty` (stored, unused).
- M06 A: East Asia offers only 10 selectable countries, so the default of 12 AI nations does not fit there (the menu must clamp to `maxAiNations`); a wider rectangle (Southeast Asia, the Indian subcontinent) would add nations but is no longer East Asia.
- M06 A: AI nations in a custom-nation match have no home land (D113); if the user wants the home discount for the AI nations of a real-country match to be visible in the HUD, the label provider could carry the trait numbers.
- M06 A: the AI memory and its per-seat streams are still not part of `HostResume` (as in M05); with per-seat streams a save/load (M24b) stores `aiSeatSeed` and the stream state per seat.

- M06 B (D128): the start is fair in CELLS, not in income: weigh the weighted start disc (a Spawn that claims cells until their cos weight sums to K) against living with it BEFORE M09 builds cities and gold on the income. See D128.
- M06 B: the leaderboard ranks by the cos-weighted land share, so at tick 0 every seat holds exactly 197 cells but a nation at 60 N shows 0.11 % against 0.22 % in the tropics and starts last. A ranking by cells (or an area share that treats equal discs as equal) would read as fairer; the M05 ranking was left as it is.
- M06 B: the AI nations take seeded countries from the whole selectable pool (a match with 12 AI nations scatters them over the world, so your first neighbours are tribes). An option "AI nations near me" (the nearest selectable countries first) would make a shorter, harder start; the capital-distance rule (17 cells) already allows it.
- M06 B: the colour of a custom nation is one of six swatches (D123) so that the territory is readable on the globe. A free colour picker could offer any colour whose dE76 to the sea and land colours is large enough, with the palette replacement of `buildOwnerPalette(own)` already in place.
- M06 B: the setup list has no keyboard navigation beyond Tab, Enter in the search box and Escape (M06fix; no arrow keys), and it does not offer "only selectable countries". Both are small additions.
- M06 B: the difficulty is stored in the config and in the preferences and nothing reads it until M16. The spawn phase of 20 s stays in a match from the setup (everyone is placed at tick 0, so it is only a wait before attacks): a shorter phase for a placed match is a one-constant change in `src/sim/rules.ts` if it feels long.
- M06 B: the setup panel hides the bottom of the globe on a phone held upright (it is a bottom sheet of 56 % of the height); the flight puts the country in the free part, but a collapse handle would let the player see the whole globe. Judge on a real phone.
- M06 B: a country the player clicks on the globe while the tab Custom nation is open is not looked up (only the start cell counts); a "use this country's capital" shortcut for a custom nation is not built.

- M06fix: `npm run verify` took about 8.5 minutes at the end of M06 and 569 and 580 seconds (about 9.5 minutes) at the end of M06fix (unit 47 s, perf, e2e about 480 s), over the 8 minute budget of CLAUDE.md. No change to the verify script now; CI should shard e2e into a job matrix (files split over jobs, each its own Chromium) once the whole run passes 10 minutes, and `docs/DECISIONS.md` must say so when it does.
- M06fix: the plural of other counted nouns in the setup is not handled: "Det finns bara 1 lämpliga länder för 1 AI-nationer" (`setup.error.notEnoughCountries`), and "AI-nationer {n}" in the options. `tn` exists now; the two-form rule fits Swedish and English only (a third language needs a real plural-rule table, a CLDR-free one of our own).
- M06fix: a custom nation's name is checked against the real country names only (English and Swedish). The invented AI names of the neutral mode skip the custom name, and in a real-country match the AI nations ARE real countries, so no AI name can clash; a name that equals a tribe label (if a later milestone names tribes) must be added to the check.
- M06fix: Escape in the setup leaves a text field first and goes back at the second press; the range slider and the select also count as fields (they blur at the first Escape), a checkbox or a button does not (Escape goes back at once). A dialog layer for later screens (settings, M23a) should own Escape through one stack instead of each screen listening on the window.
- M06fix: the language preference is stored on the first button press only; a player who never presses it keeps whatever the browser defaults give (Swedish). A first-visit guess from `navigator.language` is not made (it is not a pure function of the address and would differ between machines in a screenshot).
- M06fix: `RegionAnalysis.mapHash` is one more pass over 524 288 cells inside the analysis of a region, which costs 40 to 60 ms in Node on the first use (measured at M06fix) and is cached in the prepared world; an analysis must never run per frame.
- PerfGate (D132): `perfguard` calibrates once per process with a compute-bound loop, but the conquest kernel is cache-bound; when the VM is busy the kernel slows by 1.65x while the factor stays at 1.1. A second reference that is cache-bound (a pass over a few MB with random strides) and used for the cache-bound budgets (`tests/conquestBurst.perf.test.ts`, the 12 + 20 tick) would track this. Not done: the prompt forbade changing the calibration.
- PerfGate (D132): the capture loop touches about 25 cache lines of 12 per-cell arrays (`owner`, `playable`, `elevation`, `terrain`, `stamp` (Uint32, 2 MB), `exposure`, `diff`, `listed`, `queued`, ...) per cell; skipping the `stamp` store alone is worth 4 ms of 34. A layout that packs the derived per-cell bytes (`diff`, `queued`, `listed`, `playable`) into one Uint32 per cell, or a Uint16 `stamp`, would cut the misses; both change many files and the state format, so they are a milestone of their own if the burst ever needs to be much faster.

- M07a A: the surface under the sea pixels next to a coast is raised (the vertex height is the filtered land code, the coast line is decided per fragment), so from 300 m up a coast shows a wedge of water rising toward the land. A flat water plane needs the vertex shader to take the sea decision of the fragment shader (land mask >= 0.5, land-only mean height) and picking to follow it (`HeightField.heightM` in `src/render/heightField.ts`); M07b with `heightAt` and its GLSL parity, or M08 with the ground picking against chunks, is the place.
- M07a A: the seam between two LOD levels is a vertical wall (the skirt) hidden in the shaded picture and visible in `?chunks=1`; the LOD change itself pops. Stitching (the finer chunk takes the height interpolated from the coarser neighbour on a shared edge, the neighbour levels are already in the instance data) or vertex morphing removes both, if the user dislikes the pop in the playtest.
- M07a A: a polar chunk is a 90 degree wide lat / lon rectangle, so its cells near the pole are slivers (60 : 1 at 89 degrees) and `tests/render/quadtree.test.ts` shows the pole costs as many chunks as any other place; a cube-sphere or polar cap patch would avoid it. Not needed while the poles are unplayable ice.
- M07a A: the instances are drawn finest level first, which is nearly front to back; a real distance sort of the (at most 400) instances would be exact. SwiftShader shows no difference between the orders, so measure on the real GPU first (`#perf` shows the terrain line: chunks, levels, triangles, capped).
- M07a A: `chunkDeepK` (the split distance of the finest levels) is small on purpose: the raster has no detail below a texel. M07b adds ridged-noise detail and needs the deep levels to reach the ground (a 300 m camera now gets cells of about 5 m at the nearest chunk, 16 px at the nadir); raise `chunkDeepK` or `CHUNK_MAX_LEVEL` there and re-measure the chunk counts (`tests/chunkQuadtree.perf.test.ts`, `__test.state().terrain`).
- M07a A: reversed depth is not built (the prompt allows it only with EXT_clip_control, and 24 bits are enough with the dynamic near / far). If a later layer needs a far larger depth range (a 300 m camera with a planet-sized far plane), three's `reversedDepthBuffer` option is the switch.

## M07a part B (added by the session)
- Country border lines (M02, 4096 x 2048 id raster, nearest) and the selection outline stay a staircase of 10 km texels up close (the territory border is smooth from 5 km down to 1 km: D135). A warped lookup (the same fine octaves in raster texels) or a distance field per border would fix it; M07b.
- Territory colour reads as a flat wash close up because the terrain has no detail below a 10 km texel until M07b; the finer border warp is the only structure at 1 to 5 km. Revisit the tint strength (`OWNER_TINT`) and the inner glow once M07b detail exists.
- The fine warp is bounded by the fold test (`tests/render/warpFold.test.ts`: Jacobian determinant >= 0.1): amplitude 0.3, persistence 0.45. A rougher, more fractal border needs a warp whose slope is limited another way (a curl-noise or a flow field instead of a displacement).
- Precision below 300 m above the ground: the territory position is millimetre exact (two parts), but `uv` for the raster lookups (land mask, class, country id) still comes from a float32 direction good to 0.4 m; the coast line and the faint country lines stagger at about that scale. M08's ground camera (1 m above the ground) needs the same two-part position for them.
- Himalaya and the Tibetan plateau are one white wash (snow from `heightM` over the snow line plus the lit snow term); the snow line and its shading belong to M07b ("snögräns").
- Zoom steps: the wheel notch is a share of the camera's height above the ground; a touchpad pinch / trackpad gives many small deltas and takes the same path. M08 (RTS camera) replaces the orbit zoom; keep `distForAgl` for its ground-follow.
- `?view=` pages: the first right-drag only tilts down (the tilt limit 72 is below the view's 85 to 87); M08 decides the real camera limits.
- The Dev panel lists 20 modes now; group them (terrain, views, quality) when it passes about 25.

## M07a audit fixes (added by the audit session)
- Props and precision (ARCHITECTURE "Rules for layers that sit on the terrain", rule 1): M10 (structures), M12/M13a (helicopters, shadow blobs, dust) and M15a (missiles) must place their instances relative to a float64 region origin that is re-based when the camera moves more than about 20 km, with offsets in the instance matrices. Their prompts (not edited here: the user's prompt list is not read by sessions) need one sentence saying so, and each layer repeats the 1e-7 degree jitter test with the layer on.
- Sim altitude against render altitude (rule 2): `renderRadius = groundRadius + (altGame - EXAG_sim * meanSim(cell))`. M08's `transforms.ts` (later) states it, M13a tests that a helicopter stays above `groundHeightAt` along a real Alps route. The alternative (set `HEIGHT_EXAGGERATION` from `GAMEPLAY_HEIGHT_EXAG` after M11a fixes it) regenerates the globe goldens once and is the user's call.
- Budget row 0 (rule 3): M10 raises the pinned 30 draw calls to 100 explicitly and may lower the test tier's `chunkMax` to 100.
- LOD under a binding cap (`CHUNK_EVICTIONS_PER_FRAME`, `CHUNK_BUDGET_RESERVE` in `src/render/config.ts`): a zoom-in with a binding cap (test, low and high tiers) still merges far chunks to make room near the focus, up to four per frame; the only way to have none is a cap above what the view wants, i.e. a higher tier. Vertex morphing (see M07a A above) would hide those merges too.

## Tempo pass (added by the session, D142)
- NO DEFENDER ATTRITION: a conquest costs the attacker troops and the defender nothing (only his cap falls with his land), so whoever wins a fight keeps winning; the bimodal Skirmish results of the scripted human (33 to 80 % of Europe or eaten) come from that. The AI is held by `AI_WAR_MAX_SHARE_PCT` (15 %) and a war grace of 200 s; a real fix is a price term that grows with the DEFENDER's troops per cell (the "defender influence" lever) or casualties for the defender. Needs a new constant, a change in `src/sim/conquest.ts` and a new calibration; decide with a play test of the faster pace first.
- A single 40 % click cannot take a whole 500-cell country (480 troops against about 750 needed); the player clicks again (the pace report counts re-clicks). If the playtest finds it irritating: a "keep attacking" toggle that re-commits the share each second, or a default commitment of 50 to 60 % (`src/ui/uiConfig.ts`).
- Fronts between two equal counter-attacking nations stall (the mutual-attack rule, D85: both forces cancel). The report shows it (">900"). Not changed.
- The HUD warning "Nära taket" (80 % of the cap) appears sooner now that the troops refill three times as fast; if it nags, raise its threshold in `src/ui/uiConfig.ts` (a UI change, no balance).
- The tribes are mostly eaten by minute 6 to 10 once the AI wars start at 200 s; if the playtest wants tribes to stay as obstacles, lower the nations' appetite for them (target the weakest NATION first, or `AI_WAR_MIN_RATIO_PCT` per target kind) instead of the constants of this pass.
- The pace report's human is a script; the real test is the user's play session on a real GPU (both speeds). Re-run `npm run sim:pace` after any constant change and put the table in the DECISIONS entry.

## Tempo pass audit: carry into M09 to M14 and M16 to M19 (added by the audit-fix session, D143)
The prompts of these milestones are not in the repository (the user's prompt list is not read by sessions); the sessions that build them must read this section. All figures are game seconds at 1x with the D142 constants; `npm run sim:pace` prints the income table.
- INCOME IS 2.3 TO 3.6 TIMES AS HIGH AT THE SAME MINUTE (land arrives 3.3 times sooner and gold follows land). Solo RUS gold per second at the end of minutes 1 / 2 / 3 / 5 / 10: 11 / 24 / 36 / 58 / 80 (before the pass 2.5 / 5.2 / 8.3 / 15.2 / 33.9 by the audit's measurement); gold in all after 10 minutes with nothing bought: 30 252 (10 988 before). Earliest affordable minute (nothing else bought) for Factory + Silo + Fission (2.4 k): 2.3 (it was 4.3); Factory + Silo + L2 upgrade + Fusion (7.0 k): 4.2 (it was 7.9). A Fusion every 45 s silo cooldown costs 78 gold/s, which this pace reaches at minute 10 (duty 100 %, it was 43 %); a City (+1.5 gold/s, +800 cap) is about 2 % of income at that point.
  - M09, M12a, M14: every gold price and every gold-priced timing is judged against THIS table. Start values to try: Silo, the Silo upgrade, SAM and the missile prices about 2.5 times the planned ones (sustained-duty parity 78/34 = 2.3, earliest-time parity about 3); leave City, Port, Factory and Post alone (the 500 start gold covers them and "an AI City within 120 s" must hold). The builders print "earliest affordable minute" per path with `npm run sim:pace -- --part solo --prices <gold,...>`.
  - M12a heli cargo 600 is about 20 s of pool-bound regeneration now (24 + sqrt(T) per second), it was about 60 s.
- M09 acceptance bullet (b), "AI v0 with building after 10 minutes lands in [100 %, 150 %] of the band's upper bound": the upper bound is now 14 000 cells, i.e. 14 000 to 21 000, which is 1.30 to 1.95 times the build-free reference (10 786), and buildings move land by single-digit percent only (forcing `cityLevels()` to 6 / 12 / 24 from tick 0 gave +3.8 / +6.7 / +9.5 % at minute 10; at the old pace exactly 0). The bullet was unreachable before the pass too. Rewrite it as: with AI v0 building, 10-minute land is at least 100 % of the build-free reference (SOLO_BAND, `sim:pace` solo, 10 786) and at most 125 %; the troop cap at minute 10 is at least +20 % and the gold income per minute at least +10 % against the build-free run; the measured factor goes into `docs/BALANCE.md`. It is a regression and sanity check, not a growth target.
- M12a item 4 (beachhead "established if >= 80 cells or a City, otherwise reverts after exactly 450 ticks"): the 80 cells / 45 s pair was calibrated against the old conquest speed; at troop parity (1200 against 1200), 100 %, a passive defender and a 1 to 5 cell start contact the time to take 80 cells is now 21 to 34 s (median 25 s), it was 67 to 111 s (always longer than the window). With the speed proportional to 2F/(F + Td) the window is met when the defender's troops are below about 2.6 times the cargo. Make `BEACHHEAD_ESTABLISH_CELLS` and `BEACHHEAD_REVERT_TICKS` constants of `src/sim/rules.ts` and choose the cell threshold with a ratio test, not by feel: cargo 600 against a defender holding 3 x cargo reverts at tick 450; against one holding 1 x cargo it establishes before tick 300 (start value about 240 cells = 80 x 3.3, the BFS bound raised to match; keep 45 s, PREVIEW and the acceptance quote it; keep the City clause).
- M16 (AI v1 replaces `src/ai/think.ts`): do not port `AI_WAR_MAX_SHARE_PCT`, `AI_EXPAND_MAX_SHARE_PCT` and `AI_WAR_HUMAN_START_TICKS` as constants. They are the temporary guard rails of AI v0. Port them, if at all, as data per difficulty (a `warShareCapPct` such as Easy 15, Medium 25, Hard and Impossible 100) and delete them in M18 when gang-up and anti-snowball exist; `AI_WAR_START_TICKS` becomes data per difficulty and personality (a rusher earlier). Remember what they prevent: without the war cap the 12-nation Skirmish is eaten by one AI within 12 minutes (the audit measured the top share first above 25 % at minute 6 to 7, above 40 % at minute 7 to 11, and 60 % or more by minute 12 in 7 of 10 seeds).
- M17 and M18: with the cap on, no AI-only match ever passes 17 %, so `LEADER_LAND_PCT_MID` 25 / HIGH 40 (gang-up, anti-snowball x0.85 / x0.7) never fire between AIs. Test them with the cap off.
- M19: the goal ">= 70 % decisive" (fallback 50 %) is unreachable with the cap on; run the AI-only decisive-rate measurement with the cap off. Expect about 60 to 70 % decisive at the 12-minute Skirmish limit; if it falls short the first family to try is `TIME_LIMIT_SKIRMISH_TICKS` 7200 -> 9000 (and the M20b gate text "ca 12 min" must follow). Redefine the pace guard rail for M16 and later as "no AI nation above 25 % before minute 5", not "at minute 10". Move the windows of M19 to the new pace: first AI heli raid at minute 4 to 8 and first nuke at minute 6 to 10 in Skirmish (8 to 12 and later stays valid for World); add `earliestRaidTick` and `earliestNukeTick` to the AI data file.
- STATE OF THE BOARD with the D143 rules (kept on purpose until M16): after minute 20 the board can freeze at 14 to 56 % free land (nations at the war cap start no war, tribes stop at 600 cells, the AI crosses no sea). A passive human is safe for six minutes (`AI_WAR_HUMAN_START_TICKS`) and can then lose everything in two to three minutes in a 12-nation Skirmish (4 of 12 seeds are dead at minute 8 to 9, the others survive 30 minutes); the cliff is stated in PREVIEW 17v. A scripted sane human beats the capped AI in East Asia (64 % at minute 15): the missing defender attrition is the cause (see "Tempo pass" above); the capped nation does answer an attack (mutual attacks of D85), which holds the aggressor's troops back one for one and no more.

## TestSpeed ideas not built (D144)
Everything here would shorten `verify` further; each needs a per-test reset contract or touches what the tests prove, so none was built in the infrastructure pass.
- A PAGE POOL: restart a test page by changing the address hash (`#test_seed-7_ai-0`, the scene restarts without a reload: 0.2 s against about 0.9 s for a fresh `goto`) instead of opening a new page per test. Saves about 0.7 s for each of the roughly 150 page opens, but every test must leave no `window` global, init script, route, console listener or stored preference behind; needs a reset contract and a per-file opt-in.
- ONE BROWSER SERVER for all files (`chromium.launchServer` in the global setup, `connect` in `launchBrowser`): TRIED in D144 and rejected: the e2e project took 476 s instead of 415 s (every call goes through the server process) and `download.path()` is not available on a connected browser (the Dev panel Download test reads it). Not worth another try without a reason.
- RECORD SCREENSHOTS: several dozen screenshots in the e2e files (the `shot()` helpers) are only written for a human to look at (`setup-*.png`, `hud-*.png`, ...). A SwiftShader frame costs 0.55 s at 960x540, so an `E2E_SHOTS=0` switch (default on) would let a quick local run skip them.
- A CHEAPER FRAME IN THE TEST TIER: the fragment shader of the terrain costs about 1 microsecond per pixel under SwiftShader (0.04 s fixed, 0.2 s at 480x270, 0.55 s at 960x540). Any saving there also speeds up every golden test; the goldens must be re-pinned when the picture changes.
- Share the vite build of `tests/artifactPack.test.ts`, `tests/portable.test.ts` and `e2e/artifact.test.ts` (each builds the site into its own temporary folder).

## From M07b part A (terrain detail)
- Chunk demand near mountains: the detailed terrain is steep, so the quadtree asks for 3 to 4 times the leaves of M07a within 5 km of the ground over the Alps and the Himalaya (424 against 130 at 1 km, test tier, cap lifted; at the medium tier the cap of 300 binds at 2 km). If the GPU shows the vertex path or the triangle count as the limit, options in order: lower `DETAIL_AMP`, take less of the finer octaves' range in `DetailBounds` (`slackTight`), a lower `chunkDeepK` for the deepest levels, a coarser grid for the finest levels (the vertex count of a chunk is fixed at 33 x 33).
- A geomorph for chunks that are coarser than their distance (a binding cap): the pop at their seams (up to 9.7 px at the test tier, covered by the skirts) could be removed by limiting the octaves of the vertices on an edge to the coarse neighbour's level and blending inwards over a few rows (`aNeigh` has the levels).
- The facet normal is the only shading of the detail in part A (stylised flat shading, the M02 look). Part B shades from the analytic gradient of the octave sum; if that is not enough on a real GPU consider a vertex-stage normal (central differences of `detVertexHeight`).
- `describeAt` still decides "land" from the filtered raster (the 5 km ramp of the old coast) while the mesh and the picking now use the coverage rule; the tooltip can say "land" 5 km out at sea. Align it with `coverage >= 0.5` (a tooltip change with its own tests).
- `src/render/quadtree.ts` `KeySet` uses a multiply-and-shift hash of the same shape that cost `DetailBounds` a factor 5 (the bits of a product depend only on the lower bits of its factors, so its slot depends mostly on the row). It works with linear probing; whether its probe chains are long was NOT measured. Measure before touching it.
- The detail is a vertex-only cost in the default tier and the fragment shader is untouched except for one multiplication; the real-GPU check is `#perf` against `#detail-0` (same view without octaves) on the user's PC.

## From M07b part B (shading)
- Per-pixel detail normals: the detail is shaded by the flat facet normal of the displaced mesh (the stylised look). A vertex-stage normal or the analytic gradient of the octave sum (`detSample` exposes it) would give smooth shading on steep slopes at a vertex cost, for the high tier only. On a real GPU first check `#perf` against `#detail-0`.
- The snow line is a stylised three-point curve, not a climate model (D150 (3)): no aspect (north faces keep snow longer), no precipitation. If the playtest wants snow-covered Alps from orbit, lower the 47 degree value.
- Real trees and rocks are geometry and out of scope (M10 and later layers); the forest is a colour with a mottled canopy.
- Vegetation could follow the ruggedness / humidity of the bake, not only the sim class (a dry plateau next to a green one reads the same today).
- The night-light speckle only has two octaves; a procedural street grid near big cities would need more data than 10 km squares.

## From the M07b audit pass (D154)
- GEOMORPH, measured and not built: a per-vertex morph of every odd vertex of a leaf towards its parent's surface (the mean of the two parent vertices that bracket it, NW-SE diagonal for odd-odd) between 0.65 and 0.92 of the parent's split distance was built and removed: it moved the picture by less than the swap itself (0.61 % against 0.34 % of the pixels at the worst fixed-camera A/B), costs 1.5 more height evaluations per odd vertex, and cannot be exact where a chunk is large against its split distance (deepK 1.8 sides: the far side of a parent that a merge brings back would already be morphing). If a real GPU shows a visible shimmer when zooming: the geometric pop is 2.1 % of the vertices over a pixel (medium, worst 10 px, `tests/render/lodSwap.test.ts`); a PER-CHUNK morph factor from the node's own distance (the quadtree has it) with the edge rows of the chunk kept unmorphed (so neighbours never disagree, and the skirt covers the rest) is the next thing to try, in `src/render/chunkTerrain.ts` (a per-frame instance attribute) and `src/render/shaders/chunk.ts`.
- M08 FIRST TASK, verify time (D154 (8)): `npm run verify` is over its 8 minutes; scan the shading tests with every 12th pixel, render each detail contact sheet once and compare 320x180 tiles, remove duplicate scene loads, give `scripts/verify.mjs` a `--shard i/n` pass-through, read the per-file times of the e2e summary first. Each of these changes a threshold or a golden: state it in DECISIONS.
- M24a (quality regulator): the levers exist (`Globe.setDetailBias`, `setFineDetail`, `setChunkDensity`; D154 (7)); a tier change does not have to rebuild the Globe. Decide whether `low` should start with the mottling off and one octave fewer (the test tier must keep both on: the goldens and the shading statistics are measured with them).
- The test tier's 16-cell chunks pop more than the medium tier's (up to 20 % of the vertices of a leaf about to merge over a pixel, worst 22.6 px over the Himalaya at 15 km); nothing asserts it, the goldens are made there.
- A pop test that follows the ground (the audit's `altAglM` stepping) measures the camera, not the chunks: over 12x exaggerated detailed ground one 0.2 % step moves the camera by kilometres. Any later camera test that steps an altitude AGL must use a path in space (`distKm`) or compare two tree states at one pose (`setChunkDensity`).

## From M08 part A (RTS camera, transforms, input stack)
- The rig still stores its pose as a focus on the sea-level sphere, a distance, a heading and a tilt (D155 (2)); the RTS operations work on the pose and rebuild that state. A camera that stores its pose (position, look direction, no roll) natively would remove the representation limits that D155 (3) works around (the tilt measured at the camera, the dip cap over very high ground, a look direction above the horizon having no focus).
- Edge scrolling and the keyboard camera (WASD / arrows) are not built: the prompt names only the mouse and two fingers; the reserved keys of the stack are 1 to 6, E, H, F, Escape.
- Inertia of the grip: the release fling of M05 is kept in the RTS regime (the same `INERTIA_TAU_S`); an RTS game may want none at low height, or a fling that stops at the ground-following height; judge on the real GPU.
- The flight from orbit to 300 m takes 14.6 s (the log-rate of the height is bounded, D155 (7)); `F` from a country view takes 5 to 8 s. A "skip" (a second press jumps to the end) or a quicker profile with a tolerated 8 % per frame is the first knob if it feels slow.
- The bookmark heights (50, 90, 60 km) are a first guess looked at in SwiftShader screenshots; the Alps / Himalaya / Andes views are for the user's eye.
- The hold height follows the ground with a time constant (0.25 s) and the grip is re-aligned after it: over a cliff the camera rises with a visible lag. A look-ahead (a height from the ground a second ahead of the camera) would remove it.
- Two-finger gestures are tested with synthetic events only; no touch device was available (the Dev panel is reachable by the corner button on a phone).
- A right-drag tilt moves the camera on a circle about the ground point at the centre of the screen, so its height changes with the tilt (a camera at 80 degrees sits low, at 20 high); a "tilt about the camera" variant is the other common RTS feel.

## From M08 part B (performance scene, goldens)
- The perf scene's cruise phase moves 13 km at 300 m in about 5 s (2.4 heights per second, 4.2 % of the height per frame at 60 fps): fast for a camera, fine as a streaming stress. A slower cruise (a longer `FLY_RHO_MAX` for that flight) would be nicer to watch; judge it when the user has seen the scene.
- The scene cannot tell a cap from a GPU that is exactly twice too slow in every phase; `gpuMs` (the timer query) does, but only where the browser offers `EXT_disjoint_timer_query_webgl2`. If the user's report says `gpuMs.available` false and `likely-capped`, the next step is a second probe with a flat scene (no terrain) in the same page: a frame that costs nothing and still lasts two refresh intervals is a cap.
- The scene turns the mouse off while it runs. A Pause / Esc to abort it is not built (Esc is reserved for the input stack); reload with a different hash to leave.
- Close views of the terrain (M07b, seen in the M08 screenshots at 3 km and 300 m): the flat facet shading shows saw-tooth edges where two facets meet at a steep angle (Alps, 3 km, tilt 70), the 300 m ground is streaky ("hair") from the mottling and the ridged octaves, and the class texture's 10 km tiles show as blocks between 100 and 30 km. The per-pixel normal from the analytic gradient of the octave sum (the M07b part B backlog entry) would soften the first two; the third wants the class texture filtered by a noise-warped lookup.
- At 300 m over the massif of Everest and Makalu the 12x exaggeration makes the picture a white wall (the camera is against a 78 degree slope). The perf scene and the goldens use the edge of the plateau (30.0 N 90.0 E). A relief exaggeration that fades with the camera height (12 above 50 km, 4 at 300 m) would help the player but changes every height consumer (picking, `groundHeightAt`, buildings, the sim's altitudes): decide it with M10 and M12.
- `Globe.sync()` makes the test-mode scene honest under SwiftShader (the frame includes the drawing) but a frame costs 300 ms at 320x180 in the test tier; a smaller default size or fewer frames would make `e2e/perfScene.test.ts` (17 s alone) cheaper.

- CI shards (D156 (8)): `.github/workflows/ci.yml` runs `npm run verify` in one job (`timeout-minutes` 20) and a 2-core runner needs about 20 minutes for it. A matrix of three jobs running `node scripts/verify.mjs --shard ${{ matrix.shard }}/3` (and `tests/ci.test.ts` updated to pin it) brings each under 8. Not done in M08 because a push of `.github/workflows/*` is often refused (CLAUDE.md) and the orchestrator owns the push.
- Page load per e2e test: every `openPage` loads the world and compiles the shaders again (about 2 s under SwiftShader, 100 to 250 opens per `verify`); the e2e server is the Vite dev server (about 150 module requests per page). Serving a `vite build` of the app (the artifact tests already build one) would shorten each load; it changes what the e2e tests run against, so decide it with the verify budget.
- M08 audit (D157): (a) `RTS_GRIP_MIN_COS` and `RTS_ALIGN_MAX_RANGES` are first numbers chosen from the sweeps in `tests/render/rtsZoom.test.ts`; if the grip feels stuck near the horizon or the zoom feels short against a valley wall (the 'vertical' fallback of the dolly), they are the knobs. (b) M20a's "no keydown listener outside input.ts and hotkeys.ts" test has to name `src/app/globeApp.ts` (F3 and the match keys), `src/app/main.ts`, `src/app/devpanel.ts` and `src/app/setupScreen.ts`. (c) A pushed mode that wants the M05 click as well as its own calls `stack.base.click?.(x, y, e)` (D157 (4)).

- M08 final verify (two test holes found by mutation, the shipped code is correct): (a) the pick march step in `src/render/heightField.ts` (`clear / (1 + PICK_SLOPE)`, a mutation to `clear` passes all 1764 unit tests): no test builds a thin ridge that a fixed step of about 1.9 km would skip under a low ray and asserts the pick hits it; (b) the 300 m floor during a grip drag (`liftToClearance` in `src/render/camera.ts`) is not pinned by a unit test, because the settle step after the drag masks it: a test should assert the height over the ground after each pointer move over a ridge, not only after settling.
- M08 user feedback on version 9 that version 10 did not fix (CamFix pass): the zoomed-out globe is cropped and off-centre with a tilt, and the maximum distance does not depend on the window aspect (the disc does not fit in 9:16 even at tilt 0). DONE in the CamFix pass (D158); the claim about 9:16 at tilt 0 was wrong (it fitted with 12 % to spare; the tilt was the fault).

## From CamFix (the whole globe in view, the eased tilt, the mountain measurement; D158)
- The start view (`DEFAULT_VIEW`, 21 500 km) is a globe larger than the window in a tall window (aspect under about 0.8): start at `max(DEFAULT_VIEW.distKm, fitDistKm(aspect, 0.85))` once the first resize has happened. Not done: it touches the start screen's pictures and the M05 / M06 goldens only in non-16:9 windows, which no golden uses, but the user plays on a desktop.
- The shown tilt is a function of the distance, so a quick spin of the wheel (five notches at once) unwinds a 60 degree tilt in a fraction of a second (12.8 degrees in the fastest frame at 60 fps, 25 at 30 fps). A rate limit on the shown tilt would calm that, but it makes the pose depend on the history (every hook that sets a view would need a reset, and `cameraPositionFor` would no longer be a function of the view); judge it on the real GPU first.
- A flight that ENDS far out (above 8 000 km) at a high tilt shows that tilt until the user's first input (`freePose`, D158 (5)), which then eases it: a pop of the size of the difference. Nothing ends like that today; a future "show the whole globe" flight should end at tilt 0 or call `setView`.
- The camera at 300 m over mountains still copies 57 to 92 % of the terrain's roughness (the 300 m clearance is a hard rule and the low-altitude feel was not to change): a spatial low-pass of the ground for the follower would calm it but moves the height at rest off the held height by the difference between the smooth and the real ground; it needs a decision about what "hold 300 m" means (over the real ground: then the camera must follow the upper envelope).
- The Himalaya wall: a fast pan toward the massif at 3 km height lets the camera sink to 21 % of the held height (the first-order follower lags a slope of 4.7 by slope x speed x 0.25 s). A look-ahead (aim at the higher of the ground here and the ground 0.25 s ahead) was built and measured: the dip fell to 32 % but the shake share rose from 0.33 to 0.70 and the direction reversals from 1 to 23 (the velocity estimate and the maximum of two rough samples are noise); rejected. A look-ahead on the SMOOTH ground (3 octaves) or a faster rise than fall (the tests of `tests/render/rtsFollow.test.ts` pin the symmetric step, so that is a decision, not a fix) are the next things to try.
- Windows narrower than 0.25 or wider than 4 are clamped to those aspects in `src/render/fit.ts`; the disc does not fit at the maximum distance in a narrower window (the ceiling `DIST_ABS_MAX_KM` 150 000 km binds there).
- The prompt's e2e wish ("count the bounding box of the non-black screenshot") is done with a lit-pixel bounding box that includes the atmosphere's glow, so the picture is asked for 3 % margin where the disc is asked 5 % (the glow is about 2 % of the half-extent); a pixel-exact disc outline would need the atmosphere off (`?`-switch) in the test.

### AutoTier-1

- Adaptive resolution (a run-time pixel ratio regulator that also corrects a wrong class guess) is AutoTier-2.
- A more exact card database (device ids, per-model tiers, a "known bad driver" list) instead of the regular expressions of `src/render/gpuClass.ts`.
- A Dev-panel / settings choice that stores the tier in the pref `quality` (the pref is read already, nothing writes it).
- The tip card makes the start screen scroll at 960x540; a one-line tip or a separate corner badge would avoid it.

### M09a

- A `validateUpgrade` / `validateDelete` in `src/sim/public.ts` for the UI (the rules exist as `checkUpgrade` / `checkDelete`; only `validateBuild` is exported in part A).
- Structure rows in the M10 snapshot so a `ViewMirror` shows the real table (today it is empty).
- The AI never builds yet (M09b); the effects (City income and cap, Factory, Port trade, Post, SAM / Silo radius) and conquest of structures are M09b.
- Spacing is a linear scan of the live slots (about 300 in a normal match); a per-cell grid index would only pay off with thousands.

### AutoTier-2

- A more exact card database for the starting tier (device ids, per-model scales) now that the regulator corrects a wrong class guess at run time; and a stored last-good scale per machine (pref) so that the first seconds of a session do not start at 1.0 on a card that always ends at 0.6.
- More scales (a finer ladder between 0.5 and 1, a floor below 0.5) and a scale per axis; the buffer is scaled uniformly today.
- Measure on real Intel UHD hardware: the ladder and the 30 / 18 ms limits are derived from SwiftShader proxies and the one number the user measured (68.8 ms at 904x742, DPR 1.25, `high`); the user's `#scene-perf` and `#scene-perf_adapt-1` reports are the data.
- The regulator reads the GPU timer when the browser has it (a slow CPU cannot be helped by fewer pixels) and the animation-frame interval otherwise; a combined rule (CPU time from the draw call, GPU time from the timer) could tell a CPU-bound frame from a GPU-bound one on browsers without the timer.
- The sky shell, the stars and the border lines are drawn at the buffer's resolution and look slightly softer at 0.5; a crisp overlay pass (borders drawn at full resolution) would need a second render target.
- A cheap vertex cut in `low`: `Globe.setDetailBias(-1)` (one detail octave fewer) removes part of the 12 077 operators per vertex, but it changes the picture of `low`; look at it on real hardware first (the measurement is in PROGRESS "Measurements AutoTier-2").

### M09b

- The economy target (AI v0 with building in [1.0, 1.5] of the band's upper limit) needs a lever outside the build move: the AI commits 70 % of its troops at 40 % of the cap and the front speed limits the land, so extra troop cap barely moves it (D-M09b 10). Candidates: a lower `AI_EXPAND_TROOP_PCT` once Cities exist, or a gold-to-troops sink.
- Factory and Port levels have no effect (they pay flat), so an Upgrade of them is a waste of gold; either give them a level effect within the 10x limit or refuse the Upgrade.
- The AI builds no SAM or Silo until M14 gives them an effect; the AI places buildings by random sampling in a window around the capital, not by value (coast, front line, mountains for SAM).
- `ViewMirror` still shows an empty structure table (M10), so a UI that wants "can I afford this" must wait for it.
- The Defense Post scan is O(structures) per attack per tick when the target owns a Post; a per-owner Post list would remove it if profiling ever shows it.

## From CamFix-2
- `PERF_ORBIT_KM` (21 500 km) and the `earth` canonical view are not run through `fitViewDistKm`: in a tall window they are cut. Only the live start view is fitted. (The perf scene host needs the window's aspect.)
- The Himalaya wall dive (79 % at 3 km, fast pan) stays: the follower's lag over a steep slope; a look-ahead was tried and made the camera shiver (D158 (9)).
- The last step of a long wheel dolly (14 notches from 4 000 km over open sea) lands a hair under the sea-level sphere: `viewFromPose` reads the camera from the far side (distance 11 000 km, tilt 150) and the dolly flies out and back before it settles at 300 m (before and after CamFix-2; the CamFix-2 regression only made it end wrong). A guard in `stepDolly` (never let a finishing step end under `ZOOM_MIN_AGL_M`) would make the zoom direct.


## From M10a (slice 1: the City)
- Factory, Port, Silo, SAM and Defense Post models (one `STRUCTURE_MODELS` entry each, the key 2 to 6 binding follows the entry), the SAM dish's rotation, the Silo hatch, the Port's pier and crane.
- Upgrade, delete and the selection panel (level, upgrade price, delete cooldown), the range ring on hover (SAM radius, the provisional Silo ring `SILO_PREVIEW_RANGE_CELLS`).
- Icon-quad LOD at long distances (one instanced mesh) so that the instance cap can follow the original 500 of the test tier; night lights from city levels.
- The ghost goes red on a cell the player already sent a Build for in the same frame batch (the table is updated one diff later); Shift + click on one cell twice sends two intents and the sim refuses the second (a toast shows that).
- The distant look: the City is a 10 px speck from 1 500 km with its pale rim as the only contrast on the owner's own colour; a flag or an outline would read better. No atmosphere haze is applied to structures.
- `buildProgress` is drawn as height growth and a stipple; a scaffold or crane silhouette would say more.

## From M10-2 (slice 2: Factory and Port)
- The Factory hall is partly hidden behind its chimneys from some angles (the yaw is pseudo-random): a larger hall or a fixed front would read better. The Port's pier is only about 0.45 of the model radius long over the water; a ship beside it would sell the coast.
- The seaward test treats `groundHeightAt <= 0` as sea; a low coastal flat at exactly 0 m counts as sea. A coast direction from the sim's terrain class (water neighbours) would be exact but is not in the snapshot.
- The ghost of a Port could show a small arrow or the coast cells that are valid.
## From M10-3 (slice 3: Silo, SAM site, Defense Post)
- The Silo's missile is cut by the top of the close-up crop in the golden sheet; a taller crop or a lower pitch would show it whole.
- The Silo and SAM have no range ring yet (SAM radius from the sim, the provisional Silo ring), no launch or firing animation (M14), no night lights.
- The Defense Post wall ring and the Silo pad are decoration; a level-dependent look (a second tower at level 3) would make an upgrade visible.
- A heavier test of the dish at orbit distances: from far away the scale policy makes all three types the same speck; the icon LOD is what would tell them apart.

## M09c
- A City upgrade pays back in 533 s (800 gold for 1.5 gold/s, plus 800 cap); Factory and Port upgrades about 300 s. Either lower `BUILD_BASE_GOLD` x level for Cities or raise the City gain per level if upgrading Cities should compete.
- The AI never upgrades Posts, SAMs or Silos, and builds no SAM / Silo before M14.
- `think` still races on a Spawn-time Attack with no contact (REJECT_NO_CONTACT, one in Skirmish seed 3 at some gate values): the driver test with zero refusals is sensitive to every AI number. A guard in `think` (re-check the contact length two ticks ahead is impossible, so skip contacts of one cell) would remove the chaos.
- The Factory bonus slot rule (3 Cities per Factory) is not shown anywhere in the UI.


## M10-4
- The Silo range ring (the provisional `SILO_PREVIEW_RANGE_CELLS`) and the hover ring of the prompt are not built; only the selected SAM and Defense Post draw a ring.
- Clicking an ENEMY structure does not select it (it attacks the cell as before); an info panel for other owners' buildings would need its own rules.
- A right click does not deselect (Escape and a click on empty ground do).
- The icon badges have no night dimming and no hover tooltip; at the globe's limb they can sit half behind the horizon.
- The City lights are floating diamonds; lamp posts or window quads would read better close up.
- The selection panel shows no owner name (own structures only) and no per-level preview of the next level's numbers.

## Audit 1 leftovers (Fix-Sim)

- AI price check at emission versus execution 2 ticks later: REJECT_BUILD_GOLD about twice in 10 000 intents. A one-structure margin in `buildMove` pushed the AI below the economy band (`tests/sim/economyScript.test.ts`, `tests/ai/driver.test.ts`); to do it, re-tune `AI_BUILD_RICH_PCT` / the band together and apply AI intents at T+2 in `tools/sim/scenario.ts`.
- The placement ghost (`validateBuild` / `checkBuild`) knows no match phase: it can be green in the spawn phase where the sim now answers REJECT_PHASE. Give `BuildSource` a phase or let Fix-UI grey the build bar in the spawn phase. (DONE in Polish-1: red ghost with the phase reason, dimmed buttons. Annotated by Fix-3C.)
- `deserialize`: check that a structure's owner equals `owner[cell]` and that the embargo matrix is symmetric (Z05 / Z07 of the audit were dead code or unforgeable through `serialize`).
- AI mutants left (all documented minor or equivalent): A11 (tie between a City upgrade and the next City: the rich path upgrades anyway), A12 (cheaperUpgrade border test), A18 / A19 (gold exactly equal to the price), A33 (the `build:false` option of `AiDriver`), A34 (an AI blob with trailing words is accepted), R04 / R05 (perf report fallbacks 'unknown').
- A landlocked nation wants a Port for ever, so it never builds a Defense Post (sequence City, City, Factory, City, City, Factory, ...). Decide whether a Post may pre-empt a Port that has no place.
- Not in this slice (other tracks or later): the finding list items on adaptive.ts, camera.ts, the UI pure functions, placement / pickStructure mutants, `rejectKey` for the structure codes, budgets row 0, the jitter test.
- A guard test for the engine version: hash all `UPPER_SNAKE` constants of the sim part of `src/sim/rules.ts` and pin the digest next to `ENGINE_VERSION`, so a rule change fails until both are updated (suggested by the audit, not built).

## Audit 1 leftovers (Fix-UI)

Not done in the Fix-UI slice (the sim, host and AI findings belong to Fix-Sim):
- The structure layer's drop policy prefers nobody: past the triangle budget the highest ids vanish, also the player's own. Prefer the local owner and structures near the camera; a one-time warning when `dropped > 0`.
- Structure layer cost scales with the whole table (`rebuild` places every structure on each table change, `seawardYaw` samples 24 points per Port): cache `place` / `seawardYaw` per (id, cell, type); skip the placement re-pick when pointer and camera are still.
- Icon size and the model / icon cross-fade are in drawing-buffer pixels, not CSS pixels (the adaptive scale changes them).
- (DONE in Polish-1: night floor and owner rim, ring lifts. Annotated by Fix-3C.) Night side readability of structures (owner glow 0.05 only); the selection ring cut by steep slopes (draw it without depth test or lift it by the slope).
- The adaptive step before the draw has no automated test (the loop does not run in test mode); the interval fallback on a 30 Hz display settles at scale 0.5; `AdaptiveConfig.statistic` and `densityStep` are mutant switches in production code.
- (GPU tip below the fold and the resize crop below: DONE in Polish-1, annotated by Fix-3C.) GPU tip below the fold at 1366x640, hardware-acceleration advice for the software class, a help line for building on the start card, the F3 overlay width.
- The window resize from landscape to portrait while zoomed out leaves the globe cropped (camera `setViewport`); a long press in the placement mode does nothing (`longPress` returns false, the comment says it leaves the mode).
- `buildBar` / `selectionPanel` DOM states have no unit tests (no DOM setup in the unit project); the pure functions behind them are tested. `hudLogic` / `structureInfo` mutants of boundary kind (exact equality) are left. Mutants U07-style of the host mirror and `cloneStructures` aliasing (V10, V11), L01 / L04 / L05 / L11 / L12 of the placement mode, `tiltCapAt` smoothstep flatness (F10), GPU class rows WARP / lavapipe / Mesa offscreen are left.
- The docs lag of PROGRESS Done rows and stale BACKLOG lines (the audit's docs finding) is left to the orchestrator.

## Districts-1 (ideas and leftovers)

- AI: "Walls first when it lost a cell recently" (the memory has no loss tracking); kinds by need instead of by slot number (Barracks when at war, Housing when the cap binds); districts in border Cities (skipped: they change hands).
- Districts-2 (UI): the city view with the slots, the build / upgrade / remove buttons using `validate*District`, the effect lines from `districtEffect`, `toast.*` and `reject.*` texts for the codes 39 to 44 (`rejectKey` in `src/ui/hudLogic.ts` has none), district marks on the City model.
- A Factory bonus on Market gold would need a new cap table (the cap test counts the City with its bonus, so it would break at Market level 3).
- `RemoveDistrict` shares the 30 s Delete cooldown; a separate shorter one may feel better when a player rearranges a City.
- Missiles and the air milestones may want Walls / Housing effects against blasts (M14); `previewBlast` is not district aware.
- `collectWalls` scans the structure table per attack tick (like `collectPosts`); a per-owner cache next to `effHousingQt` would make it O(walls) if a match ever holds thousands of Cities.



## Polish-1 leftovers

- A pixel-level night readability test (the night-lights texture is brighter than the structures, so a contrast metric does not discriminate); only the shader source is pinned.
- The six types at 150 to 1500 km were checked for four of them in screenshots (the Port needs a coast cell in the test match); a coast scene would cover it.
- Ring lifts are sampled at the true-size radius only; a ring widened by the scale policy at mid distance uses the same lifts.
- Fix-UI low-priority items (6) were not worked through beyond what Fix-UI already did.
- The tip still sits below the Play button on a 560 px window (the card scrolls); Play itself is always reachable.

## Districts-2a leftovers

- A pointer drag across the tiles / drag-and-drop of districts between slots (not in the sim either).
- Keyboard focus ring order on the tile itself (tiles are groups; their buttons are the tab stops). A roving tabindex per tile is possible if the user wants arrow keys.
- The city view for ENEMY or ally Cities (read-only look at their districts) is not built; only own Cities open.
- The spawn-phase dimming of the build buttons is only unit-tested (a City cannot exist in the spawn phase of a normal match).
- A small-map look (isometric tiles, district icons drawn on the tiles) is simpler than wished: icons are flat SVG; Districts-2b draws the districts on the 3D city.
- The totals show finished districts only; a "when finished" preview of running builds is not shown.
- A toast when a district intent is refused is wired through the existing reject path; the dimmed buttons make most refusals impossible, so the toasts are only seen on races (gold spent in the same turn).

## Districts-2b leftovers
- Walls model reads weaker than the other three from afar (the arc is short); a longer arc or a pale slab would help. Housing and the City's own blocks look alike.
- A far icon for districts (a small pip on the City's icon per built district) was not built; they simply vanish beyond about 60 km camera distance.
- An upgrade look (a scaffold or stipple while a district upgrades, from `districtUpgradeReadyTick`).
- Per-tier budget of 9 000 / 18 000 / 36 000 / 72 000 triangles is a first guess; measure on the school laptop with `#perf`.
- Barracks flag and Market awning do not animate (a wind sway on the fx clock would be one uniform).

## M18-1
- Selfplay CLI (`--matches N --mode skirmish --ai-only`) and the 40 / 200 match distribution runs belong to M18-2 / M19; the AI does not know the win conditions yet (it never plays for the 60 percent, it only stops when the match ends).
- AI gang-up rule (M17) must read `LEADER_LAND_PCT_MID` and `LEADER_LAND_PCT_HIGH` from the sim barrel `src/sim/public.ts`.
- Nukes fired and helicopters lost statistics (columns added when those systems exist).
- The automatic start position for a human who did not choose is not needed while `createMatch` places everybody at tick 0; if a "choose your start" mode returns, it needs a seeded sim rule at the end of the spawn phase.
- Allies or pacts sharing a win, a draw by mutual agreement, a "no winner" screen for `WIN_REASON_NONE` (everybody eliminated at once).
- Outbox events (`OUTBOX_ELIMINATED`, `OUTBOX_CAPITAL_LOST`, `OUTBOX_MATCH_END`) do not cross the host seam as events; the page reads the flags in `SimView.match` and detects the transitions (capital lost / eliminated) by comparing two frames.


## M11a leftovers
- (DECIDED: the owner accepted the measured numbers, DECISIONS M11b point 10; the two `it.fails` stay. Annotated by Fix-3C.) Old text: the owner's decision on the stop rule (A, B or C), then re-pin `tests/sim/losReal.test.ts` and turn the two `it.fails` into plain tests.
- The Node-versus-Chromium equality of the result hashes (an e2e that builds the masks of the three fixtures in the page and compares the three hashes with the pinned ones). The page needs the SIM pack's mean and max layers; `tools/sim/losWorld.ts` is the Node loader, the browser loader belongs to M11b.
- M11b: the nav grid, the flight-mode table, the debug page, the service ceiling that reads `ALT_HIGH_AGL_M`, and a `Los` built by the host (worker or page) from `simGridView(...)` with `createLosTerrain`.
- Fire control of a Silo or of a radar structure type: `Los.sync` knows only SAM sites (type 5) and Posts; a radar type needs one line in `sync`.
- Sub-cell accuracy: a second pass that tries the exact half-cell line for the cells where the two estimates differ by more than the slack, if the slack should shrink.
- A mask per OWNER-wide union exists (composite); a "who sees this cell" listing for several enemy seats is a loop over seats, not a structure.

## M18-2 leftovers
- (DONE in 2dd505a: the plain Play match gets `defaultWinConfig('world')` outside test mode; Fix-3C moved the choice to `winForPlay` in `src/app/match.ts` and tested it. Annotated by Fix-3C.) Old text: the standard "Play" match had no win block, so it never ended.
- In-place restart and "to menu" without a page reload (needs a teardown of the structure layers, input modes and panels of a session).
- The in-game win-progress bar (leader, share, hold seconds) from `MatchView.leaderSeat / holdSeat / holdTicksLeft / requiredPct` belongs to M20a; the panels here do not show it.
- The result table has no flags (the HUD has); sorting by a column; a "copy result" button.
- Selfplay CLI (`--matches N --mode skirmish --ai-only`) was not part of this slice.
- Pause-menu volume / graphics settings; keyboard focus ring for the result rows.

## M11b leftovers and ideas
- IDEA (owner decision on the M11a stop rule): the finer-grid option C, a mask built on the 2048x1024 grid only for LOS, would separate a valley floor from its ridge. Not built; the measured behaviour is accepted.
- The A* works on the nav grid and the route is the polyline of nav cell centres; a smoothing pass (string pulling that keeps the exposure cost) is not built.
- A service-ceiling check per sim cell for the start and the goal (they are cells of a nav block whose mean may be closed while the sim cell itself is low) is not built: such a query is NO_ROUTE.
- The debug page does not draw the land labels or the nav grid; `Nav.landReachable` has no user yet (M12a, the AI).
- Leftovers of the slice: none in the list of the prompt; the Artifact preview was not republished (orchestrator).

- M18-2 follow-up (orchestrator): the plain Play match (MatchSession.create) now gets defaultWinConfig('world') outside ?test=1, so it ends like the setup matches; test mode matches never end (`options.win` absent).

## Sim-Growth leftovers
- DONE in the integration pass (`docs/DECISIONS.md`, Integration Sim-Growth + Look-1): the UI and render now read the sim functions. The old note: the UI still hard-coded `CITY_GOLD_MILLI_PER_SEC_PER_LEVEL * level`, `CAP_CITY_LEVEL_TROOPS * level`, `STRUCT_MAX_LEVEL` for a City and slot counts 2/3/4 in `src/ui/structureInfo.ts`, `src/ui/cityViewModel.ts`, `src/ui/cityViewPanel.ts`, `src/ui/selectionPanel.ts` and `src/render/districts.ts` (the Look-1 track owns them): they must read `cityGoldMilli`, `cityTroopCap`, `maxLevelOf`, `upgradePriceGold`, `districtSlotsOf` and `DISTRICT_MAX_SLOTS`. The tests `tests/ui/structureInfo.test.ts`, `tests/ui/cityViewModel.test.ts`, `tests/app/structureSelect.test.ts`, `tests/render/districtLayer.test.ts` and `e2e/structuresSelect.test.ts`, `e2e/cityView.test.ts` pin those old numbers and follow that change.
- `SCORE_CITY_LEVEL_POINTS` (25 per City level) now lets a level 10 City score 250: revisit once real matches show Cities at level 10 (the win test pins 25).
- Conquest keeps "level minus 1, at least 1" for every level (decided; "minus 2 above level 6" would make a level 10 City worth rebuilding less, not tried).
- The AI only upgrades a City to level 1 + 2 * (its Cities); a smarter payback-based rule (upgrade versus new City) is not built.
- The Silo spacing (6 cells) and the SAM spacing (5) are guesses until M14 gives them a job.
- The attack race of the AI (REJECT_NO_CONTACT, one in about 12 Skirmish matches at some tunings) is unchanged by this slice but shows when the AI trajectory shifts: see Sim-Growth in `docs/DECISIONS.md`.

## Look-1 leftovers
- A level number as a digit on the far City icon (the arc is the stand-in); the build bar could show "Nivå 1 / max" for the City it builds.
- The hamlet (level 1) looks bare at 800 m: a small well or a first tower in band 0.
- At the top level two Cities 3 cells apart touch at about 3500 km camera distance (1.5x level scale); a cap on the policy radius by the spacing would fix it.
- The e2e pixel diffs of old vs new and of level 1 vs 3 include the territory change over time; a masked diff around the City would be sharper.
- A setting for the Dev panel that switches the style without changing the address.

## Sim-Levels2 leftovers
- Payback: with the price base x L for every type and gentle curves (level 10 about 1.7 times level 1) the payback of an upgrade is 1 000 to 100 000 s (a Factory to level 2: 1 600 s; see the logged `[payback]` lines of `tests/sim/structureLevels.test.ts`). The asked window of 60 s to 6 minutes for the first ten steps cannot hold together with that price and that gentleness (a City level 2 costs 800 gold and gives 0.375 gold/s). Knobs if the user wants upgrades to feel better early: raise `CITY_GOLD_EXTRA_MILLI` and the other `*_EXTRA_*` constants in `src/sim/rules.ts`, lower `LEVEL_SAT_K` (faster early gain), or give upgrades a lower base than a new structure (a separate `UPGRADE_BASE_GOLD` table).
- (Done in the integration) The UI read the old reference level `DISTRICT_MAX_LEVEL` for the "top level" of a district; `src/ui/cityViewModel.ts` and `src/ui/cityViewPanel.ts` now ask `districtMaxLevel()`.
- `SCORE_CITY_LEVEL_POINTS` (25 per City level) and `SCORE_FACTORY_LEVEL_POINTS` now let a level 999 City add 25 000 points to the score win; cap the counted level (for example at 10) or make the points concave if the score win matters.
- The AI stops at `AI_CITY_LEVEL_CAP` 10 and `AI_STRUCT_LEVEL_CAP` / `AI_DISTRICT_LEVEL_CAP` 3: a smarter AI could buy levels by payback.
- Conquest keeps 75 percent of a level; a level 999 City falls to 749 in one capture. A gentler loss at very high levels (for example a flat cap of 25 levels) is an option.

## Look-2 leftovers
- Polar overlap: the cap (24.5 km radius) is fixed in metres, but cells shrink east-west with cos(lat); two Cities 3 cells apart touch from about 65 degrees of latitude. A latitude-aware cap would fix it.
- Extra towers beyond the last band (a second City geometry with more instances up to a triangle budget); Look-2 only makes the model taller.
- (Done in the integration) The effect lines of Factory and Port read the generated tables of `src/sim/levelCurves.ts` (the same functions, levels 1 to 999); `tests/ui/structureInfo.test.ts` pins them against the curve functions.
- District upgrade time is not shown (the district upgrade has no separate time in the tile model).
- A latency check of `sel.fxNext` text length on a phone-width panel.

## Fix-3A1
- Economy script margin (audit 2 sim[6]): `tests/sim/economyScript.test.ts` (b) passes on the pinned seed 1 with 1.1 % margin (14160 of 14000); seeds 4, 5, 6 give 0.937 / 0.988 / 0.992. Any balance nudge breaks seed 1. To do (needs a balance decision): assert the median factor over seeds 1 to 5 and keep the single seed as a log line. Not changed here.
- Property test "effects cache of the live state equals a fresh recompute / restored copy" at every tick of a scripted run (audit f15), in the unit project.
- `match.districts` statistic against an independent recount (next to the peak / conquered / built recount in `tests/sim/win.test.ts`); the doc comment of `districtSlotsOf` still says "level outside 1..3".
## Fix-3A2 leftovers
- The eight landing-zone texts (`lz.water` .. `lz.noRoute`, sv and en) and their mapping from `LZ_REASON_BASE + n` in `rejectKey` / the launch toast: M12a adds them with the LaunchHeli UI (`src/ui` was off limits in Fix-3A2; until then 65..72 read "Avvisat (kod N)").
- Radar mask (M11a alternative C): a finer mask grid or a distance-proportional slack would remove the measured 47 false-hidden cells in 17 of 300 random sites (5.7 % of sites, 0.006 % of cells); the owner accepted the numbers, revisit when SAM engagement (M12b / M14) shows a missed shot.
- Still unlocked in `scoreLz` / nav: the score weights (spread coefficient, floor 1), the `>=` boundaries (spread 200 m, 3500 m, exactly HELI_FUEL_CELLS), ENEMY_CITY_NEAR before TOO_HIGH, an enemy City across the date line, A* tie handling, and `landReachable` / `landLabel` (no caller: test it or remove it).
- The A* weight 1.3 still lets a route be 16 percent dearer than the optimum (measured worst, real grid); `AIR_ROUTE_WEIGHT_PCT` 115 would halve that for a few percent more expansions.
- `Los.invalidate()` exists for hand edits inside one tick; if M12 ever edits the structure table in two places per tick, give the table a version counter instead of the (highWater, liveCount) pair.
## Fix-3B leftovers
- feel[5] districts in the modern style, camera changes and more quality tiers stay out of scope (as the prompt said).
- Pure formulas of Look-1 still unpinned: the `closeMul` fall-off start, `districtRadiusM` level and City-level factors, the district cut distance's `STRUCT_CLOSE_MUL`, `cityBand` / `levelScale` clamping outside the range.
- The modelled-structure priority ranks by the camera position only; ranking by what is on screen (frustum, horizon) would be fairer.
- Cluster icons beyond the icon switch distance (one icon per 2x2 cells with a count) would make 15000 km views of a big territory readable; the radius cap only keeps them from merging.
- The open-city flight keeps heading 0; a heading chosen so that the district ring's largest extent faces the free part would need less altitude.
- When the camera stands within `flyNearM` of the ground and the City is on screen, opening the city view still starts no flight, so the five districts may be partly off screen or under the panel.

- Far icons: the shader limits the half size by the smallest possible spacing (3 cells), so a LONE structure shrinks too (floor 3.5 px). A per-icon nearest-neighbour spacing computed at rebuild would keep lone icons at 5 px and shrink only the crowded ones.
## Fix-3C
- Districts drop policy (Districts-2b): when the district layer is over its instance budget the highest structure ids drop first, also the player's own. Prefer the local owner and districts near the camera, and warn once when `dropped > 0` (same idea as the structure layer's drop policy under "Audit 1 leftovers (Fix-UI)").
- Bundle size: lazy-load the city view panel (`src/ui/cityViewPanel.ts`, `src/ui/cityViewModel.ts`) and the match panels (`src/ui/matchPanels.ts`, `src/ui/matchFlow.ts`) with dynamic `import()` so the main chunk shrinks (it was 265.6 kB gz at audit 2); test hooks such as `forceEliminated` could move to a test-only chunk. The size guard in `tests/portable.test.ts` then gets a lower cap.
- `cityTotals` sums the Barracks percent per City; the sim caps the owner-wide sum at `BARRACKS_REGEN_PCT_MAX` (see DECISIONS Fix-3C for what the panel does now).
- `STRUCT_LEVEL_SCALE` in `src/render/config.ts` is unused; remove it together with its pin in `tests/render/structureModels.test.ts` (a test edit, left for a pass that may touch tests).
- `docs/PREVIEW.md` has no text for the match flow (Vinstvillkor, pause menu, result screen, elimination) and says "2, 3 eller 4" district slots (now 2 to 5 over ten levels); Swedish file, not done in Fix-3C.

## M12a-1
- Part 2 must add `maxElev: world.sim.maxElev` to the two `sim:` field lists in `src/app/globeApp.ts` (only `src/app` was off limits in M12a-1); without it a live match throws `MissingOccluderError` at its first Los / Nav question.
- The fleet cap counts only FINISHED Factories (an unfinished one adds nothing) and a seat that loses a Factory keeps its helicopters over the cap. Both are provisional (DECISIONS M12a-1); M19 may prefer "scrap the oldest over the cap" or counting the building Factory.
- A Factory lost to conquest scraps only the queued and parked helicopters. What happens to an airborne one whose home Factory is gone belongs to part 2 (RTB to the nearest own Factory, scrapped when there is none).
- The queue is one helicopter per Factory and a refused order gives no queue of orders. A multi-order queue (several in a row, paid one by one) is an idea for M19 balance.
- `SimView.helis` is a full copy of the 64-slot table sent when its signature changes; positions will change every tick once helicopters fly (part 2), so the page then gets a table per frame. If that shows in the perf report, send only the airborne rows or interpolate from launch data.
- The AI does not order or fly helicopters (M17).
- No UI for ordering a helicopter yet (button, hotkey, fleet counter): M13. The refusal texts exist already (`toast.heli.*`, `toast.lz.*`).
- Helicopter and beachhead tables in a saved game: part 3 may want a "cluster" table of its own; the beachhead rows keep seed, owner, land tick and status, the cluster cells are found by search from the seed.

## M20a-2
- Pooled nation labels (name and troops, at most 32, fade by zoom, no overlap, none outside the screen) and front arrows for active attacks (at most 16): need the host snapshot to carry the active attacks (id, ownerId, target owner, front corners) as typed-array copies; `src/sim` stays untouched (M20a part 2).
- The attack slider is the existing commitment slider as it is; the leaderboard shows the top 5 and you.
- Wire the primary trigger through the resolver too (`resolveCommand('primary', ...)`): today the placement mode and the selection mode answer their own left clicks (D157) and the base click is `onGlobeClick`; the table already models them and the unit tests pin the rows. Then `onGlobeClick`, `trySelectStructure` and the selection mode's `click` can shrink to one call.
- `registerCommandRule` for M13b (Factory selected + right click on land => LaunchHeli) and M15b (Silo selected => target mode): add the two command kinds to `Command` and a `case` each in `runContext` (`src/app/globeApp.ts`).
- The help overlay does not rebuild when the language changes while it is open (it does on the next open); the E and H entries are hidden until M13.
- Touch: the `?` overlay has no button, only the key (M20b adds the radial menu and a touch route).
- The win meter shows the land condition only; a score or last-standing match shows no meter (the timer stays). A "time left" row for the score condition (`MatchView.timeLeftTicks`) is a one-liner when wanted.
- Layout: the selection panel could sit beside the build bar now that the status panel left the bottom; the banner, the paused badge and the spectator bar are tied to the `TOPBAR` constants, not measured at run time.

## M12a-2
- Fuel is checked ONE WAY at launch (`scoreLz`: route at most `HELI_FUEL_CELLS`); the way home can be longer (the return is planned from the zone, 1 of 42 flights of the quick run ran dry on a 83-cell route). A round-trip check (`2 * route`) or a "one-way raid" mark in the UI is a balance call for M19 / M13.
- A recalled or returning helicopter has no re-route when its target Factory is lost in flight except at arrival (nearest remaining, else scrapped); a re-plan at the moment of loss would save the flight time.
- A helicopter that cannot be planned home (its cell is closed to the nav grid) flies the straight line; the altitude floor clears the ground but the line can cross a Peak cell. A fix is a "nearest open nav cell" start for `planRoute`.
- Hovering and lifting cost no fuel; a small hover fuel cost would make waiting over the zone a choice.
- The golden scenario contains refused launches and one accepted launch (seed 1, tick 5998): the fixture world has few valid zones. A dedicated flight scenario (fixed Factory and zone) would pin more of the flight in the hash.
- A troop count returned to a seat that is over its cap decays like any other surplus; no special handling.
- UI: the launch needs a zone picker with `validateLaunchHeli` (M13b), a recall button and a fuel bar; the hover and the way home are visible in `SimView.helis` (`state`, `alt`, `load`, `fuel`).
## M13a-1 leftovers (-> "M13a-2")
- Effects: rotor wash and dust on the pad, a shadow blob on the ground, a smoke trail for a downed helicopter, a tilt in the turn (the vertex shader has the yaw only).
- The H chase camera (key H is reserved), the cinematic scenario slice (a launch, a flight over mountains, a landing), the fleet list with a click-to-select helicopter.
- A far icon / dot for helicopters at orbit zoom (the layer shares the structures' scale cap and is a few pixels from 3000 km).
- Interpolate the position between snapshots with the fx clock (today it hops tick to tick; invisible for a parked one, visible for a fast flight at 800 m). The layer already keeps the last position per slot for the heading.
- The pad corner assumes level 1 of the Factory model (a high-level Factory model grows round it); read the Factory level into the layer if a level-10 plate ever reaches the corner.
- A leak test (320x180, 60 renders, heapDelta) was not added: the layer creates one geometry, one material and four instanced buffers once and nothing per frame or per table change; `Globe.dispose` frees them.
- `HeliLayer` takes the altitude above ground as `alt - GAMEPLAY_HEIGHT_EXAG * meanElev(cell)`; if M12a-2 defines `alt` differently for flight, change that one line (`aglM` in `rebuild`).

## M18c-1 leftovers (-> "M18c-2" and later)
- The interface (M18c-2): the nation panel with Propose truce / Propose alliance / Break / Embargo buttons, incoming proposals with Accept / Decline and a countdown (`SimView.diplomacy.proposalCount` and `proposalFrom` / `proposalTo` / `proposalTreaty` / `proposalLeft`), relation badges on the leaderboard and the nations (`relation(a, b)`, `truceTicksLeft`), a toast when a proposal arrives, a truce or an alliance ends or a treaty is broken, and the result screen rows (`match.treaties`, `match.betrayals`, `match.relations`). Nothing of this is in the UI yet; the six intents are only reachable through `submitIntent`.
- Shared victory for an alliance (today the win conditions stay individual: an ally of the leader can win or lose alone, DECISIONS "M18c-1" 6), shared vision and shared troops, trade between allies beyond the same-owner rate, chat, tributes, declarations of war with notice, third-party guarantees.
- Lifting an embargo by an accepted proposal (the prompt mentioned it): today only the seat that put the embargo on can lift it (`LiftEmbargo`), and two embargoes need two lifts. A third treaty kind (TREATY_OPEN_TRADE) would be one more value of `treaty` and one more case in `enterTreaty`.
- A truce that is about to run out could warn both sides (a `SimView` field already gives `truceTicksLeft`); a "renew" shortcut that proposes again.
- The AI does not use the embargo, never proposes a truce to a human seat on its own initiative beyond the weak-AI rule, and does not answer a proposal from a seat it is at war with in a special way (it treats a truce as a way out of a losing war only through the two rules of DECISIONS "M18c-1" 7). A negotiating AI with demands (a truce only for land or gold) is a later idea.
- The proposal table is per directed pair (A to B and B to A can both be open); an auto-accept when both ask for the same treaty at once was not built (the second proposal is refused as PENDING only in the same direction).
- `atWar(state, ownerA, ownerB)` in `src/sim/diplomacy.ts` is the question the helicopter landing must ask before it takes a cell on a treaty party's land (the landing of M12a-3 is the helicopter track's; a landing on a treaty party's land should be refused like an Attack, with `REJECT_DIPLO_TREATY_BOUND`).

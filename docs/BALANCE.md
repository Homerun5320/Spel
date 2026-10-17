# Balans (BALANCE)

**Sammanfattning (svenska).** Alla spelsiffror ligger i en enda fil, `src/sim/rules.ts`, och varje konstant har en rad i tabellen nedan (ett test kontrollerar att filen och tabellen stämmer överens). Siffrorna är otestade startvärden: de flesta kommer från planen ("plan"), några är egna val ("eget val") och märkta som sådana. Planens regler är skrivna för ett 512x256-rutnät; spelet kör 1024x512, så en std-cell är 2x2 simceller (avstånd x2, areor x4, hastigheter x2). Trupper räknas i kvartstruppar (4 = 1 trupp) och guld i tusendels guld, så att inga flyttal behövs. Erövringen (M04 del B) använder samma tabell: fångsthastigheten `CAPTURE_K_MILLI` är kalibrerad mot en ensam expanderare på riktiga världen (80 i planen, 103 efter två justeringsvarv, 123 sedan terrängen började bromsa erövringen (berg tar 2,5 gånger så lång tid som slätt, D106), och 420 efter spelarens återkoppling "att erövra länder tar för lång tid" (tempopasset, D142; trupp-återhämtningen är samtidigt tredubblad, 24 + 1,0 sqrt(T) i stället för 8 + 0,35 sqrt(T), och AI-nationerna börjar krig först efter 200 s och slutar ta mer land vid 15 % av världen): ca 8 060 celler efter 5 minuter och ca 10 790 efter 10, mot 2 430 och 5 100 före passet; bandet står i `tools/sim/bands.ts` och gäller referensboten, som startar om sin attack först när trupperna är slut, inte en spelare som avbryter och startar om hela tiden), kostnaden per cell är terrängens procent gånger uppförsbacke gånger (1 + djup/40), där djupet följer cellen (`exposure`) och därför inte kan nollställas genom att avbryta och starta om, och enklaver upp till 64 celler byter ägare gratis. Förändrar du ett värde: räkna upp `ENGINE_VERSION`, uppdatera raden här och kör testerna (golden-hasharna ändras).

Below, everything is in English. See `docs/DECISIONS.md` D73 to D80 for how the units were chosen and D82 to D88 for the conquest (what d and dh mean, the calibration rounds).

## How to read the table

- **Value** is the exact value exported by `src/sim/rules.ts` (integers only; fractions are integers with a named scale such as `_MILLI` = thousandths or `_PCT` = hundredths).
- **Source** is `plan` (the number comes from the milestone prompt, possibly converted to sim units or to an integer scale) or `eget val` (our own choice; the plan gave no number or only a hint). A constant marked "Derived" is a pure function of others in the table.
- The conquest constants (M04 part B) are wired in `src/sim/conquest.ts`, `src/sim/enclaves.ts` and `src/sim/territory.ts`; how they combine is in `docs/DECISIONS.md` D82 to D91.
- Constants named `_STD` are in std-cell units, the others in sim units.


## Time and turns (M03)

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `TICK_HZ` | 10 | ticks per second | plan | Simulation rate; 1 tick = 0.1 s. |
| `TICK_MS` | 100 | ms per tick | plan | Derived: 1000 / TICK_HZ. |
| `INTENT_DELAY_TURNS` | 2 | turns | plan | An intent submitted at tick T runs at T + 2. |
| `MAX_INTENTS_PER_TURN` | 4096 | intents | eget val | A larger turn is refused as a whole. |
| `MAX_TICKS_PER_FRAME` | 8 | ticks | eget val | The host drops the surplus of a stalled frame. |

## Diplomacy (M18c-1)

Truces, alliances, proposals and the AI's answers (`src/sim/diplomacy.ts`, `src/ai/diplomacy.ts`). The numbers are the prompt's (source `plan`) or our own (`eget val`); provisional until the first playtest, see the M18c-1 block of `docs/DECISIONS.md`.

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `TRUCE_TICKS` | 2400 | ticks | plan | M18c-1: a truce lasts 4 minutes from the tick it was accepted, then it is war again (a new proposal can renew it). An alliance has no end. |
| `PROPOSAL_TTL_TICKS` | 600 | ticks | plan | M18c-1: an open proposal can be accepted or declined for 60 s. |
| `PROPOSAL_CAPACITY` | 32 | proposals | plan | M18c-1: the proposal table is full at this many open proposals (ProposeTreaty then gives REJECT_DIPLO_FULL). |
| `TREATY_BREAK_COOLDOWN_TICKS` | 1800 | ticks | plan | M18c-1: after BreakTreaty the breaker may not propose a treaty for 3 minutes. A truce that runs out costs nothing. |
| `DIPLOMACY_REPLY_MIN_TICKS` | 30 | ticks | plan | M18c-1: the AI answers a proposal after this many ticks at the earliest (3 s). |
| `DIPLOMACY_REPLY_MAX_TICKS` | 60 | ticks | plan | M18c-1: and after this many at the latest (6 s); the delay is drawn from the AI's own stream. |
| `AI_TRUCE_ACCEPT_WARS` | 2 | parties | plan | M18c-1: the AI accepts a truce when an attack runs between it and at least this many other players (either way). |
| `AI_ALLY_PROPOSER_MAX_PCT` | 25 | percent of land | plan | M18c-1: the AI accepts an alliance only from a proposer holding at most this share. |
| `AI_ALLY_LEADER_MIN_PCT` | 25 | percent of land | plan | M18c-1: and only while a leader above this share is at war with both (30 in M18c-1, 25 since M18c-2, ENGINE 18). |
| `AI_GRUDGE_TICKS` | 3000 | ticks | plan | M18c-1: the AI makes no treaty with a seat that broke one against it in the last 5 minutes. |
| `AI_WEAK_MEDIAN_PCT` | 50 | percent of the median share | plan | M18c-1: an AI below this share of the median land share of the living players proposes a truce to the strongest neighbour that attacked it. |
| `AI_PROPOSE_COOLDOWN_TICKS` | 600 | ticks | plan | M18c-1: at most one proposal per AI per 60 s. |
| `AI_LEADER_PCT` | 40 | percent of land | plan | M18c-1: the AIs propose an alliance against a leader above this share; an AI that gets above it itself breaks its alliances. |
| `AI_TRUCE_OTHER_WARS` | 1 | parties | plan | M18c-2: the AI accepts a truce when it is at war with at least this many players OTHER than the proposer and the proposer is not the leader. |
| `AI_TRUCE_MEDIAN_PCT` | 100 | percent of the median share | plan | M18c-2: the AI accepts a truce when its land share is below this percent of the median share of the living players. |
| `AI_TRUCE_MIN_HITS` | 2 | think rounds | plan | M18c-2: an AI proposes a truce (when weak or fighting on two fronts) to the seat whose attacks it has seen in the most think rounds, once that is at least this many. |

## Units (M04)

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `STD_CELL_SIDE` | 2 | sim cells per std-cell side | plan | Distances: std times 2. |
| `STD_CELL_AREA` | 4 | sim cells per std-cell | plan | Derived: STD_CELL_SIDE squared. Areas and AREA RATES (captured cells per second): std times 4. |
| `QT_PER_TROOP` | 4 | quarter troops per troop | plan | Troops are stored in quarter troops, so a Plains sim cell (a quarter of a std-cell) costs 3 QT = 0.75 troop with no rounding. |
| `MILLI_GOLD_PER_GOLD` | 1000 | milli-gold per gold | eget val | Gold is stored in milli-gold. |
| `MICRO_QT_PER_QT` | 1000000 | micro-QT per QT | eget val | Scale of the troop regeneration remainder carried between ticks. |
| `WEIGHT_ONE` | 32768 | Q15 one | plan | The cos(lat) cell weight at the equator in the committed row table. |
| `SQRT_MILLI_PER_QT` | 250000 | scale | eget val | Derived: 1000000 / QT_PER_TROOP; sqrt(T troops) * 1000 = isqrt(T in QT * this). |

## The planet

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `EARTH_EQUATOR_M` | 40075017 | m | eget val | Equator length (WGS84); only for cellKm. |
| `EARTH_POLE_TO_POLE_M` | 20003931 | m | eget val | Pole to pole along a meridian (WGS84); only for cellKm. |

## Terrain

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `TERRAIN_COST_PCT` | [0, 0, 100, 130, 160, 250, 0, 0] | % of a Plains cell, by class (DeepSea, Shallows, Plains, Forest, Hills, Mountain, Peak, Ice) | plan | 0 = unplayable and impassable (sea, Shallows, Peak, Ice). Cost multipliers 1.0 / 1.3 / 1.6 / 2.5 are used by the conquest twice (D106): the PRICE of a cell in troops, and its SPEED (a cell of class c takes this percent of a Plains cell's capture progress, so a Mountain front is 2.5 times slower than a Plains front, Hills 1.6, Forest 1.3); the zeros decide which cells can be owned. |

## Start, troops and gold (M04 part A)

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `START_TROOPS` | 1200 | troops | plan | Clamped to the cap. |
| `START_GOLD` | 500 | gold | plan |  |
| `START_DISC_RADIUS_CELLS` | 8 | sim cells | plan | Read as SIM cells (D75). In std-cells it would be 16. |
| `START_DISC_CELLS` | 197 | sim cells | plan | Integer points with dx^2 + dy^2 <= 64; a test recounts it. Cells a Spawn claims. "Fair" means this many CELLS for every seat; income, cap and land share are area-weighted, so the same disc is worth less at high latitude (about 1.2 gold/s at 60 N against 2.0 in Japan, D128). |
| `CAP_BASE_TROOPS` | 2000 | troops | plan | Troop cap = 2000 + 120 * N^0.75 + 800 * cityLevels. |
| `CAP_N_COEF_TROOPS` | 120 | troops | plan | N = owned area in std-cells (cos-weighted). |
| `CAP_CITY_LEVEL_TROOPS` | 800 | troops per city level | plan | Cities arrive in M09; the level count is 0 until then. |
| `REGEN_BASE_TROOPS_PER_SEC` | 24 | troops per second | eget val | Regeneration = max((24 + 1.0 * sqrt(T)) * (1 - T / Tmax), -MAX_DECAY). The plan's value was 8 (8 + 0.35 sqrt(T)); the tempo pass (D142, user feedback: too slow) tripled it so that the troop pool keeps up with a conquest 3 to 4 times as fast (with 8 a solo expander at 4 times the capture speed was bound by its pool from the second minute: 4 333 cells after 10 minutes, no better than before). |
| `REGEN_SQRT_COEF_MILLI` | 1000 | thousandths | eget val | 1.0 (the plan's 0.35, tripled with the base by the tempo pass, D142). |
| `MAX_DECAY_TROOPS_PER_SEC` | 40 | troops per second | eget val | The plan names MAX_DECAY without a number. |
| `GOLD_PER_STD_CELL_MILLI_PER_SEC` | 50 | milli-gold per second per std-cell | eget val | 0.05 gold per second per std-cell of weighted land; 500 start gold is about 200 s of the income of a start disc. |
| `TRIBE_CAP_DIV` | 3 | divisor | plan | Tribe troop cap = player cap / 3. |
| `TRIBE_REGEN_PCT` | 50 | % | plan | Tribe regeneration x 0.5. |
| `TRIBE_ATTACK_DIV` | 20 | divisor | plan | A tribe attacks with T / 20 (conquest, part B). |
| `START_TROOPS_QT` | 4800 | QT | plan | Derived: START_TROOPS * QT_PER_TROOP. |
| `START_GOLD_MILLI` | 500000 | milli-gold | plan | Derived: START_GOLD * MILLI_GOLD_PER_GOLD. |
| `CAP_BASE_QT` | 8000 | QT | plan | Derived. |
| `CAP_N_COEF_QT` | 480 | QT | plan | Derived. |
| `CAP_CITY_LEVEL_QT` | 3200 | QT per city level | plan | Derived. |
| `MAX_DECAY_MICRO_QT_PER_TICK` | 16000000 | micro-QT per tick | eget val | Derived: MAX_DECAY_TROOPS_PER_SEC * MICRO_QT_PER_QT * QT_PER_TROOP / TICK_HZ (= 16 QT = 4 troops per tick). |

## Conquest (M04 part B; the plan's starting values, calibrated where marked)

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `CAPTURE_K_MILLI` | 420 | thousandths | eget val | Capture speed = K * sqrt(L) * 2F / (F + Td) in std-cells per second. The plan's start value was 80 (0.08); the solo calibration (D88) moved it to 103, terrain slowing the capture (D106) to 123 (0.123), and the tempo pass (D142, user feedback: "conquering countries takes too long" and "I needed 4x to make it playable") to 420 (0.42, outside the plan's 0.06 to 0.15 on purpose): at troop parity a 197-cell disc now falls in about 55 s of game time at 100 % commitment (it was 183 s) and 500 cells of a country in about 106 s (it was 354 s); a solo expander has 1 591 cells after 1 minute (536 before), 8 063 after 5 and 10 786 after 10. The product with the other factors stays below 2^53 up to K = 1000 (conquest.ts). |
| `BASE_COST_TROOPS` | 3 | troops per std-cell | plan | Before terrain, height and depth multipliers. |
| `BASE_COST_QT_PER_SIM_CELL` | 3 | QT per sim cell | plan | Derived: BASE_COST_TROOPS * QT_PER_TROOP / STD_CELL_AREA. |
| `D_MAX_STD` | 40 | std-cells | plan | Depth limit of the defender term (the plan says: proposal 40). |
| `DEPTH_COST_DIV_STD` | 20 | std-cells | plan | Cost factor (1 + d / 20). |
| `D_MAX_CELLS` | 80 | sim cells | plan | Derived: D_MAX_STD * STD_CELL_SIDE. |
| `DEPTH_COST_DIV_CELLS` | 40 | sim cells | plan | Derived: DEPTH_COST_DIV_STD * STD_CELL_SIDE. |
| `HEIGHT_UNIT_M` | 16 | m per height unit | eget val | The unit of dh in the uphill factor (D76). |
| `UPHILL_PER_STEP_MILLI` | 250 | thousandths | plan | Uphill factor 1 + 0.25 * dh / 32. |
| `UPHILL_STEP_UNITS` | 32 | height units | plan |  |
| `UPHILL_MAX_PCT` | 200 | % | plan | Uphill factor capped at x2; downhill is 1. |
| `ENCLAVE_FLIP_TICKS` | 20 | ticks | plan | Enclave flip every 20th tick, offset by hash(id): the enclave candidates are spread over 20 buckets by a hash of the cell and a tick checks the bucket `tick % 20` (D86). |
| `MICRO_CELLS_PER_CELL` | 1000000 | micro-cells per cell | eget val | Unit of the capture progress an attack carries from tick to tick. |
| `PROGRESS_DEBT_MAX` | 1000000000 | micro-cells | eget val | The most terrain debt an attack can owe (progress goes negative after a slow cell, D106): 1000 cells' worth; also the range check of deserialize. |
| `MILLI_QT_PER_QT` | 1000 | milli-QT per QT | eget val | Unit of the price of one cell; the unpaid part of a QT is carried in the attack. |
| `BASE_COST_MILLI_QT_PER_SIM_CELL` | 3000 | milli-QT per sim cell | plan | Derived: BASE_COST_QT_PER_SIM_CELL * MILLI_QT_PER_QT. |
| `CAPTURE_SQRT_SCALE` | 500000 | scale | eget val | Derived: 10^6 / STD_CELL_SIDE; sqrt(L in std-cells) * 1000 = isqrt(L in sim cells * this). |
| `CAPTURE_RATIO_TWO` | 2000000 | millionths | plan | The troop ratio 2F / (F + Td) is kept in millionths (2.0 is the value against unowned land). |
| `ENCLAVE_MAX_CELLS` | 64 | sim cells | eget val | A region larger than this is never treated as an enclave (16 std-cells; bounds the work of a failed fill). |
| `ENCLAVE_PASS_BUDGET_CELLS` | 4096 | cells per tick | eget val | Cells one enclave pass may visit; the rest of its batch waits for the next pass of its bucket. |
| `FRONT_COMPACT_MIN` | 256 | heap entries | eget val | An attack's frontier (and an owner's boundary list) is purged of stale entries when it reaches this size (then at twice its purged size). |

## Match flow (M05)

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `SPAWN_PHASE_TICKS` | 200 | ticks | plan | 20 s. Enforced by the sim when the match config has `spawnPhase`: Attack is refused during the phase, Spawn after it (D92). |
| `IMMUNITY_TICKS` | 50 | ticks | plan | 5 s after the phase: an Attack on owned land is refused; an Attack on unowned land (target 0) is allowed. |
| `MATCH_AI_NATIONS` | 5 | nations | plan | Standard match: you + 5 AI nations (AI v0, part C). |
| `MATCH_TRIBES` | 20 | tribes | plan | Standard match: 20 tribes at the start (part C). |

## AI v0 (M05 part C)

The AI only emits intents (`src/ai`, read through `src/sim/public.ts`); these values do not touch `step`, so they needed no `ENGINE_VERSION` bump (D104).

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `AI_THINK_PERIOD_TICKS` | 10 | ticks | eget val | One thought per seat per second. |
| `AI_THINK_STAGGER_TICKS` | 3 | ticks per seat | eget val | Seat s thinks when (tick + s * 3) is a multiple of the period, so the seats do not all think on one tick. |
| `AI_ANCHOR_SEAT` | 0 | seat | eget val | The seat the AI places its capitals around: the human's. |
| `AI_SPAWN_WAIT_TICKS` | 150 | ticks | eget val | The AI seats wait for the human's Spawn so that the world fills in around the player (D104); if the human has not spawned by tick 150 (15 s of the 20 s phase, D109) they go ahead with places spread over the whole map. The last seat (slot 24) is down at tick 150 + 24 + 2 = 176, with room for a few retries before the phase ends at tick 200. |
| `AI_SPAWN_SPACING_TICKS` | 1 | ticks | eget val | From the release the AI seats Spawn one by one, the nations first, this far apart. A Spawn runs 2 ticks after it was sent, so the driver (`src/host/aiDriver.ts`) hands every seat the list of Spawns still in flight and `pickSpawnCell` keeps its clearance from them (D109): seats may Spawn on consecutive ticks and still never meet. 25 seats take 24 ticks. |
| `AI_SPAWN_RETRY_TICKS` | 6 | ticks | eget val | A Spawn runs 2 ticks after it was sent; if the capital is still missing after this many, another place is tried. |
| `AI_NATION_CLEARANCE_CELLS` | 28 | sim cells | eget val | A nation's capital is at least this far from every owned cell (about 1100 km at the equator). |
| `AI_TRIBE_CLEARANCE_CELLS` | 14 | sim cells | eget val | The same for a tribe. |
| `AI_NATION_REACH_CELLS` | 90 | sim cells | eget val | A nation's capital is at most this far from the human's (a square, x wrapping; about 3500 km at the equator). Measured with a scripted human expander: first contact with a nation after 2 to 6 minutes, with a tribe after about a minute (D104). |
| `AI_TRIBE_REACH_CELLS` | 90 | sim cells | eget val | The same for a tribe. |
| `AI_SPAWN_TRIES` | 400 | places | eget val | Random places tried for one Spawn; the clearance is halved after every quarter of them, and the second half ignores the reach. |
| `AI_EXPAND_TROOP_PCT` | 32 | % of the cap | eget val | An AI seat expands when its troops are at least this share of the cap. The plan said 50; with the slower capture in rough terrain (D106) 40 keeps the nations' growth where D104 measured it (mean about 1 250 cells after 5 minutes, the weakest of eight seeds above 690). M09c: 37 (was 40) lets an AI with Cities act earlier; it is what brings the solo AI with building into the economy target (see "M09c" below); 25 broke the human-share floor of tests/sim/pace.test.ts, 33 and 30 the refused-intent test of the driver. Sim-Growth: 37 -> 36 (tuning round 2, with `AI_CITY_UPGRADE_LEVELS_PER_CITY`; solo band factor 1.01). Sim-Levels2: 36 -> 32 (the weaker level curves and the dearer City upgrades, base x L, took away the cheap upgrade income; tuning: 36 gave factor 0.95, 34 0.99, 33 0.9985, 32 1.08 on the solo band; the pace test is green). |
| `AI_EXPAND_COMMIT_PCT` | 70 | % of troops | eget val | Share of its troops a nation commits to an Attack on unowned land. |
| `AI_WAR_COMMIT_PCT` | 50 | % of troops | eget val | Share of its troops a nation commits to an Attack on a neighbour. |
| `AI_WAR_MIN_RATIO_PCT` | 130 | % | eget val | A nation attacks a neighbour only with at least 1.3 times its troops. |
| `AI_WAR_START_TICKS` | 2000 | ticks | eget val | No AI nation attacks a neighbour before this tick (200 s: 3 minutes 20 seconds into the match, 25 s after the spawn phase and immunity are over and the land grab is on). Tempo pass (D142): with a conquest 3 to 4 times as fast the nations would otherwise eat the tribes and a passive player within the first two minutes. Expansion into unowned land is not held back. |
| `AI_WAR_MAX_SHARE_PCT` | 15 | % of all land | eget val | An AI nation that owns this share of all playable land (cos-weighted, as the HUD shows it) starts no war and calls off the ones it has. Tempo pass (D142): without it one nation ate a 12-nation Skirmish in Europe (57 % to 90 % after 10 minutes); with it the biggest AI nation holds 15 to 21 %. The human is not capped. |
| `AI_EXPAND_MAX_SHARE_PCT` | 20 | % of all land | eget val | An AI nation that owns this share of all playable land (cos-weighted) expands into no more unowned land and calls off a running expansion. D143: with only the war cap (`AI_WAR_MAX_SHARE_PCT`) a nation ran on through free land to 26 to 29 % after 15 to 25 minutes. A nation at the war cap answers a neighbour that attacks it (retaliation), so a capped nation is not a free prize. |
| `AI_WAR_HUMAN_START_TICKS` | 3600 | ticks | eget val | No AI nation STARTS a war on a human seat before this tick (360 s). D143: all nations started their wars at tick 2000 (`AI_WAR_START_TICKS`) and a player who stood still in a 12-AI Skirmish was dead 25 to 170 s later. A human who attacks is answered at once. |
| `AI_WAR_MIN_CONTACT_LENGTH` | 2 | sim cells | eget val | A nation starts a war on a neighbour only with at least this much contact: a single cell of contact is gone before the intent runs 2 ticks later (or the target is eaten by another nation) and the sim refuses it. D143: the Skirmish seeds 4, 6 and 12 sent such an Attack; with 2 the seeds 1 to 12 send none. |
| `AI_MIN_CONTACT_LENGTH` | 4 | sim cell adjacencies | eget val | An AI seat expands into unowned land only when its contact length with it is at least this (D109; a war needs any contact). A sliver of one or two cells is usually gone, taken by the seat's own running attack or by another seat, by the time the intent runs 2 ticks later, and the sim then refuses it (REJECT_NO_CONTACT); with the minimum the match of seed 7 runs 6000 ticks without a refusal. |
| `AI_ATTACK_COOLDOWN_TICKS` | 40 | ticks | eget val | A seat does not attack the same target again within 4 s (a second Attack adds troops to the first). |
| `AI_TRIBE_COOLDOWN_TICKS` | 100 | ticks | eget val | The same for a tribe's expansion (10 s). |
| `AI_TRIBE_MAX_CELLS` | 600 | sim cells | eget val | A tribe stops expanding at this size (three times its capital disc). |

## Match setup, the fair start and the home land (M06)

The home-land and trait rules live in the sim and apply only to a match whose config has `homeRules` (a match of a real country; D112 to D118). The setup constants are read by the match setup in `src/app`.

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `SETUP_MIN_COUNTRY_CELLS` | 8 | sim cells | plan | A country is selectable only with at least this many cells of its own (the same number as `minPlayableCells` of `public/data/overrides.json`). |
| `SETUP_CAPITAL_MIN_DISTANCE_CELLS` | 17 | sim cells | plan | Capitals of two nations at the start are at least this far apart (Euclidean, x wrapping): two discs of radius 8 never touch. |
| `SETUP_AI_NATIONS_DEFAULT` | 12 | nations | plan | AI nations of a new match. |
| `SETUP_AI_NATIONS_MAX` | 24 | nations | eget val | The options allow at most this many (you + 24 + 20 tribes = 45 seats). |
| `FEDERATION_MIN_AI_NATIONS` | 1 | nations | eget val | Fix-5A2: a split country ("Dela upp stormakter") needs at least this many AI nations, otherwise every player seat is one federation and `last alive` ends the match 20 s in. |
| `HOME_COST_PCT` | 50 | % of the price | plan | A cell of the owner's OWN home country costs the owner half to conquer; nobody else gets it and no other cell does. |
| `TRAIT_CAP_MILLI` | 100 | thousandths | plan | A trait multiplier stays within 1000 +- 100 (the +-10 % cap); the setter clamps and `deserialize` refuses anything outside. |
| `TRAIT_NEUTRAL_MILLI` | 1000 | thousandths | plan | The neutral multiplier (x1). |
| `TRAIT_COAST_MID_PERMILLE` | 150 | thousandths of land cells | eget val | Coast share at which the port income multiplier is x1 (the median country has 85, the 90th percentile 434). |
| `TRAIT_COAST_GAIN_PCT` | 50 | % | eget val | Multiplier thousandths per thousandth of coast share: a share 200 above the middle (350) reaches the cap, a landlocked country gets x0.925. |
| `TRAIT_MOUNTAIN_MID_PERMILLE` | 150 | thousandths of land cells | eget val | Mountain (and Peak) share at which the defence multiplier is x1 (the median country has 54, the 90th percentile 542). |
| `TRAIT_MOUNTAIN_GAIN_PCT` | 50 | % | eget val | Multiplier thousandths per thousandth of mountain share. A defence multiplier above 1000 makes an attacker pay more for the nation's land; a flat country gets x0.925, a share of 350 or more the cap x1.1. |


## Structures (M09 part A)

The structure table, the prices and the placement numbers. The base prices and times are PROVISIONAL (the M09a block of docs/DECISIONS.md). Arrays are indexed by structure type 1..6 = City, Factory, Port, Silo, SAM, Post (index 0 is unused).

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `STRUCT_CAPACITY` | 4096 | slots | plan | Slots of the structure table; ids 0..4095. A structural limit. |
| `STRUCT_MAX_LEVEL` | 3 | level | plan | Sim-Levels2: LEGACY visual reference level of Factory, Port, Silo, SAM and Post (models reach full size here). NOT a limit any more: `maxLevelOf(type)` is `STRUCT_LEVEL_HARD_CAP` for every type. |
| `STRUCT_LEVEL_HARD_CAP` | 999 | level | eget val | Sim-Levels2: the practical top level of EVERY structure type and district kind (`maxLevelOf(type)`, `districtMaxLevel()`); u16 in the tables. The dearest upgrade, Silo base 1000 x 999, is 999 000 000 milli, inside Int32 and the Uint32 purse. |
| `LEVEL_CONQUEST_KEEP_PCT` | 75 | percent | eget val | Sim-Levels2: a conquered City, Factory, Port or district keeps this percent of its level, rounded down, at least 1 (`levelAfterConquest`): 1, 2, 4, 10, 100, 999 become 1, 1, 3, 7, 75, 749. |
| `BUILD_BASE_GOLD` | [0, 400, 500, 400, 1000, 600, 250, 700, 600, 250] | gold | plan | Base price per type (City 400, Factory 500, Port 400, Silo 1000, SAM 600, Post 250); provisional. An upgrade to level L costs base * L, no escalation. |
| `BUILD_TICKS` | [0, 150, 200, 120, 250, 200, 80, 220, 180, 100] | ticks | plan | Build time per type: City 15 s, Factory 20 s, Port 12 s, Silo 25 s, SAM 20 s, Post 8 s. An upgrade takes the same time (own choice). |
| `PRICE_ESCALATION_ONE_HALVES` | 2 | halves | plan | 1.0 in halves; price = base * min(12, 2 + n) / 2, so the n-th extra structure costs 0.5 base more. |
| `PRICE_ESCALATION_MAX_HALVES` | 12 | halves | plan | The escalation stops at x6. |
| `DELETE_COOLDOWN_TICKS` | 300 | ticks | plan | A seat may Delete once per 30 s. |
| `SPACING_CELLS_BY_TYPE` | [0, 3, 3, 3, 6, 5, 3, 6, 4, 3] | sim cells | eget val | Sim-Growth: minimum distance between two structures of the same type (City, Factory, Port, Silo, SAM, Post; Euclidean, x wrapping; closer than this is refused). A cell is about 39 km, so this is towns, not countries (was 16 for every type, which left room for one or two of each type on a start nation's 197 cells). Silo and SAM are wider because their reach is. |
| `SPACING_SCOPE` | 0 | scope | plan | 0 = same type any owner, 1 = same type same owner, 2 = any type. M19 may change it. |

## Structure effects and the AI build move (M09 part B)

Gold effects are in milli-gold per second (the economy turns them into milli-gold per tick, floored). Only finished structures count. PROVISIONAL (the M09b block of docs/DECISIONS.md). (M09c: the Factory and the Port now grow with their level too, see the M09c section below; the numbers in this block are their level 1.) Worst single structure: a Port with 3 partners at 120 cells or more of other owners, 2 + 3 * 3.3 = 11.9 gold/s (13.09 with the +10 % trait), against the limit of 10 level-1 Cities = 15 gold/s.

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `CITY_GOLD_MILLI_PER_SEC_PER_LEVEL` | 1500 | milli-gold/s | plan | A level 1 City pays 1.5 gold/s and lifts the troop cap by `CAP_CITY_LEVEL_TROOPS`. A level-1 City costs 400 and pays back in 4.4 minutes. Higher levels follow the concave curve of `LEVEL_SAT_K` and `CITY_GOLD_EXTRA_MILLI` (`cityGoldMilli(level)`). The upgrade to level L costs `BUILD_BASE_GOLD` x L like every other type. |
| `CITY_MAX_LEVEL` | 10 | level | eget val | Sim-Levels2: LEGACY visual reference level of a City; not a limit any more (`maxLevelOf(STRUCT_CITY)` is `STRUCT_LEVEL_HARD_CAP`). |
| `LEVEL_SAT_K` | 3 | levels | eget val | Sim-Levels2: shape of every level curve, value(L) = base + floor(extra x sat(L) / 1000), sat(L) = 1000 x (L - 1) / (L - 1 + K): level 10 gets 75 percent of the extra, level 100 97 percent, level 999 99.7 percent, never all (`src/sim/levelCurves.ts`). |
| `CITY_GOLD_EXTRA_MILLI` | 1500 | milli-gold/s | eget val | Sim-Levels2: a City gains up to this above the level 1 value of 1.5 gold/s (asymptote 3.0; level 10 pays 2.625). |
| `CITY_TROOP_EXTRA_TROOPS` | 1600 | troops | eget val | Sim-Levels2: a City adds up to this many troops to the cap above `CAP_CITY_LEVEL_TROOPS` (asymptote 2400; level 10 adds 2000). |
| `AI_CITY_UPGRADE_LEVELS_PER_CITY` | 5 | levels per City | eget val | Sim-Growth: the AI upgrades a City to at most level 1 + (Cities it owns) * this (5). Without the limit the cheap City upgrades (80 to 144 gold) starve the building of new Cities (tuning round 1: factor 0.95, below the band; round 2 chose 5 per City with `AI_EXPAND_TROOP_PCT` 36: factor 1.01; the AI is a chaotic system, so the value was picked from a sweep of 20 combinations by the band, the driver tests and the pace test). |
| `AI_CITY_LEVEL_CAP` | 10 | level | eget val | Sim-Levels2: the AI lets a City rise to at most this level (it pays the same base x L as the human); the human can go on to `STRUCT_LEVEL_HARD_CAP`. |
| `AI_STRUCT_LEVEL_CAP` | 3 | level | eget val | Sim-Levels2: the AI lets a Factory or Port rise to at most this level. |
| `AI_DISTRICT_LEVEL_CAP` | 3 | level | eget val | Sim-Levels2: the AI lets a district rise to at most this level. |
| `FACTORY_GOLD_MILLI_PER_SEC` | 2000 | milli-gold/s | plan | A Factory pays 2 gold/s, flat. |
| `FACTORY_GOLD_EXTRA_MILLI` | 2000 | milli-gold/s | eget val | Sim-Levels2: extra own gold of a Factory at the asymptote (4 gold/s in all). |
| `FACTORY_CITY_BONUS_EXTRA_PCT` | 10 | percent | eget val | Sim-Levels2: extra City bonus of a Factory at the asymptote (25 to 35 percent). |
| `FACTORY_RADIUS_EXTRA_CELLS` | 4 | sim cells | eget val | Sim-Levels2: extra reach of a Factory at the asymptote (20 to 24 cells). |
| `FACTORY_CITY_BONUS_PCT` | 25 | percent | plan | The owner's Cities within FACTORY_RADIUS_CELLS of a finished Factory pay 25 % more; Factories do not stack. |
| `FACTORY_RADIUS_CELLS` | 20 | sim cells | plan | Reach of the Factory bonus (Euclidean, x wrapping). |
| `PORT_GOLD_MILLI_PER_SEC` | 2000 | milli-gold/s | plan | A Port pays 2 gold/s before trade, flat; the owner's port trait (+-10 %) multiplies the whole Port income. |
| `PORT_GOLD_EXTRA_MILLI` | 2000 | milli-gold/s | eget val | Sim-Levels2: extra own gold of a Port at the asymptote (4 gold/s in all, before trade and the `PORT_INCOME_MAX_MILLI_PER_SEC` clamp). |
| `PORT_TRADE_EXTRA_PCT` | 20 | percent | eget val | Sim-Levels2: extra share of its trade value a Port earns at the asymptote (100 to 120 percent). |
| `TRADE_MAX_PARTNERS` | 3 | ports | plan | Each Port trades with its 3 nearest partner Ports (the lowest id on a tie). |
| `TRADE_MIN_DIST_CELLS` | 40 | sim cells | plan | A partner must be at least this far away. |
| `TRADE_BASE_MILLI` | 1500 | milli-gold/s | plan | Trade value per Port of a pair = 1.5 * (1 + min(d, 120) / 100) gold/s. |
| `TRADE_DIST_CAP_CELLS` | 120 | sim cells | plan | The distance stops counting here (500 cells pay the same as 120); at most 3.3 gold/s per Port of a pair. |
| `TRADE_SAME_OWNER_PCT` | 50 | percent | plan | A pair with the same owner trades at half; under embargo at 0. |
| `TRADE_ALLIANCE_PCT` | 125 | percent | plan | Fix-4A1: a pair of ALLIED owners trades at 125 % of the open rate (an alliance must not pay less than a war); the cap of 13 gold/s per Port (`PORT_INCOME_MAX_MILLI_PER_SEC`) still holds. |
| `POST_RADIUS_CELLS` | 12 | sim cells | plan | A finished Defense Post makes the attacker's cell price x2.5 for cells of its owner within this distance. |
| `POST_COST_NUM` | 5 | ratio | plan | The Post multiplier 5 / 2 = 2.5 (numerator); the price is floored once. |
| `POST_COST_DEN` | 2 | ratio | plan | The denominator of the Post multiplier. |
| `SAM_MOUNTAIN_PCT` | 120 | percent | plan | A SAM or Silo on a Mountain cell reaches 20 % further. |
| `SAM_RADIUS_BASE_CELLS` | 24 | sim cells | plan | SAM / Silo radius on flat ground at level 1 (was the first entry of the old table). Nothing reads it before M14. |
| `SAM_RADIUS_EXTRA_CELLS` | 8 | sim cells | eget val | Sim-Levels2: extra SAM / Silo radius at the asymptote (24 to 32 cells). |
| `AI_BUILD_CITIES_PER_FACTORY` | 2 | cities | eget val | The AI builds a Factory for every 2 Cities (the build ratio). |
| `AI_BUILD_CITY_TROOP_PCT` | 0 | percent | eget val | Troop gate of a new City: 0 = none. A gate of 50 % (or 20 %) never opened while the AI spent its troops on a long attack, and a City is paid in gold, not troops (tuning round 1). |
| `AI_BUILD_WINDOW_CELLS` | 56 | sim cells | eget val | The AI looks for a build place in a square of this half-width around its capital. |
| `AI_BUILD_TRIES` | 24 | places | eget val | Random places tried per think (a Port gets four times as many). |
| `AI_BUILD_RETRY_TICKS` | 50 | ticks | eget val | After a think without a place the AI does not look again for 5 s. |
| `AI_BUILD_CITIES_PER_PORT` | 3 | cities | eget val | From the second City on, one Port per 3 Cities. |
| `AI_BUILD_CITIES_PER_POST` | 4 | cities | eget val | From the fourth City on, one Defense Post per 4 Cities. |

Economy script result (M09b, `npm run sim:scenario -- --solo --ai`, Russia, seed 1, 10 minutes): the build-free scripted expander is unchanged (the M04 band); AI v0 without building has 12 791 land cells, AI v0 with building 12 568 (factor 0.90 of the band's upper limit 14 000, below the asked [1.0, 1.5]). Buildings add troop cap and gold, but in the solo scenario land is limited by the speed of the front, not by troops, so no build ratio or price moved it: the deviation is logged in D-M09b of docs/DECISIONS.md and the interval of tests/sim/economyScript.test.ts is the measured value +-30 %.

## Level effects of Factory and Port, and the AI economy tuning (M09c)

Index = level 1 to 3. Upgrade prices are base * level (Factory 1000 / 1500, Port 800 / 1200). The gains put each upgrade's payback at 280 to 340 seconds in the reference settings of tests/sim/structureLevels.test.ts (a Factory with three level-2 Cities in reach; a Port with one partner at 100 cells), against 267 seconds for a new level-1 City (a City upgrade, 800 gold for 1.5 gold/s, is 533 seconds and is left as it was). The limit of 10 level-1 Cities (15 gold/s) holds in the new worst cases: a level-3 Port with three far partners is clamped to 13 gold/s (14.3 with the +10 % trait); a level-3 Factory is 8.5 plus the bonus of at most 3 level-3 Cities, 3 * 1.575 = 4.7, 13.2 gold/s.

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `FACTORY_BONUS_MAX_CITIES` | 3 | cities | eget val | A Factory boosts at most 3 Cities (the lowest ids first; a City takes the best Factory in reach that still has a free slot). Keeps the Factory under the 10x limit. |
| `PORT_INCOME_MAX_MILLI_PER_SEC` | 13000 | milli-gold/s | eget val | One Port (own gold plus trade, before the +-10 % trait) never pays more: 13 gold/s, 14.3 with the trait, under the 15 of the limit. |
| `AI_BUILD_RICH_PCT` | 100 | percent | eget val | When the purse is at least this percent of the next wanted structure's price and pays an upgrade, the AI upgrades its lowest finished City, then Factory, then Port (an interior one: no foreign neighbour) instead of building. |
| `DISTRICT_MAX_SLOTS` | 5 | slots | eget val | Districts-1, Sim-Growth: the row length of the district table (the slots of a level 9 to 10 City), a structural limit. |
| `DISTRICT_MAX_LEVEL` | 3 | level | eget val | Sim-Levels2: LEGACY visual reference level of a district; districts rise to `STRUCT_LEVEL_HARD_CAP`. |
| `HOUSING_TROOPS_BASE` | 400 | troops | eget val | A finished level 1 Housing district raises the owner's troop cap by this (Sim-Levels2: the old per-level step is a curve now). |
| `HOUSING_TROOPS_EXTRA` | 800 | troops | eget val | Sim-Levels2: extra Housing cap at the asymptote (towards 1200 troops). |
| `MARKET_GOLD_MILLI_BASE` | 300 | milli-gold/s | eget val | Gold of a finished level 1 Market (0.3 gold/s, unchanged). The worst single City (asymptote City, five asymptote Markets, a Factory at the asymptote, +10 percent trait) stays under the 15 gold/s of ten level 1 Cities (`tests/sim/levels2.test.ts`). |
| `MARKET_GOLD_EXTRA_MILLI` | 300 | milli-gold/s | eget val | Sim-Levels2: extra Market gold at the asymptote (towards 0.6 gold/s). |
| `BARRACKS_REGEN_PCT_BASE` | 5 | percent | eget val | Percent a finished level 1 Barracks adds to the owner's (positive) troop regeneration; the sum of all stays under `BARRACKS_REGEN_PCT_MAX`. |
| `BARRACKS_REGEN_EXTRA_PCT` | 10 | percent | eget val | Sim-Levels2: extra Barracks percent at the asymptote (towards 15). |
| `WALLS_COST_PCT_BASE` | 150 | percent | eget val | A finished level 1 Walls district multiplies the attacker's cell price on its City's cell and the cells within `DISTRICT_WALLS_RADIUS_CELLS`; it does not stack with a Defense Post (the larger percent applies). |
| `WALLS_COST_EXTRA_PCT` | 50 | percent | eget val | Sim-Levels2: extra Walls percent at the asymptote (150 to 200). |
| `DISTRICT_SLOTS_BY_LEVEL` | [0, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5] | slots | eget val | Sim-Growth: district slots of a City by its finished level (2 at levels 1 to 2, 3 at 3 to 5, 4 at 6 to 8, 5 at 9 to 10); `districtSlotsOf(level)`. |
| `DISTRICT_BASE_GOLD` | [0, 150, 40, 250, 300] | gold | eget val | Base price per kind (Housing, Market, Barracks, Walls). The n-th district of a kind costs base * min(12, 2 + n) / 2 (the structure escalation); an upgrade to level L costs base * L. Market is cheap because its gain is capped by the 10-City limit (Sim-Growth: 60 -> 40 with the lower Market table, so both upgrades still pay back in 90 s to 6 minutes). |
| `DISTRICT_BUILD_TICKS` | [0, 80, 100, 120, 120] | ticks | eget val | Build and upgrade time per kind: Housing 8 s, Market 10 s, Barracks 12 s, Walls 12 s. |
| `BARRACKS_REGEN_PCT_MAX` | 50 | percent | eget val | All Barracks of one owner together add at most this. |
| `DISTRICT_WALLS_RADIUS_CELLS` | 2 | cells | eget val | Reach of the Walls round the City (Euclidean, x wrapping). |
| `AI_DISTRICT_RETRY_TICKS` | 100 | ticks | eget val | After a think that found no district to build or upgrade the AI does not look again for this long (10 s). |
| `AI_DISTRICT_MIN_CITIES` | 3 | cities | eget val | The AI builds districts only once it owns this many Cities (tuning round 1 of Districts-1: with 1 the solo land fell to 0.93 of the band, with 3 it is 1.02 as before). |
| `GAMEPLAY_HEIGHT_EXAG` | 8 | factor | plan | M11a. Heights in the line-of-sight maths are game metres: the real height of ground and ridges times this (allowed 6 to 10). An aircraft's altitude above ground (ALT_*_AGL_M) and the antenna are not exaggerated, so a ridge hides a low aircraft that is far lower than the ridge in real life. Measured in docs/PROGRESS.md "Measurements M11a". |
| `OCCLUDER_MAX_WEIGHT_PCT` | 60 | percent | plan | M11a. The effective occluder height of a cell is mean + this percent of (max - mean), times the exaggeration (allowed 20 to 60). An integer percent so that the maths stays integer; the prompt's 0.6. |
| `SITE_ANTENNA_M` | 30 | game metres | plan | M11a. A SAM or radar antenna above its ground cell, not exaggerated. |
| `ALT_LOW_AGL_M` | 300 | metres | plan | M11a. Altitude above ground of the Low flight mode, not exaggerated. Low is hidden by ridges. |
| `ALT_HIGH_AGL_M` | 3000 | metres | plan | M11a. Altitude above ground of the High flight mode, not exaggerated. High ignores the mask (visible anywhere in range: fast but visible); the number is read by M11b's service ceiling. |
| `LOS_TILE_CELLS` | 64 | cells | plan | M11a. Side of a composite coverage tile; only tiles a site touches are allocated (a site of R=24 touches at most 4). |
| `LOS_MASK_UNIT_GM` | 2 | game metres | plan | M11a. One step of a Uint16 mask value, rounded down so the error favours the radar. |
| `LOS_RAY_OVERSAMPLE` | 2 | rays per perimeter cell | eget val | M11a. Rays of a mask go to this many targets per cell of the box perimeter. 1 left 3 cells on the seven measured sites hidden by the mask but visible by the exact line (with the slack below); 2 left none. |
| `LOS_RAY_OVERSAMPLE_MAX_RADIUS` | 40 | cells | eget val | M11a. Masks of a larger radius use one ray per perimeter cell, which keeps a R=64 mask under the 2 ms budget (the ring estimate carries the accuracy there). SAM radii are at most 34. |
| `LOS_MASK_SLACK_GM` | 48 | game metres | eget val | M11a. Every mask value is lowered by this before it is rounded down, so the discretisation errs mostly in the radar's favour, NOT always: 24 left 1 false-hidden cell on the seven sites, 48 left 0 there (about 6 real metres at the exaggeration of 8), but the audit of 300 random real-world sites (Low) found 47 of 786376 cells hidden by the mask yet seen by the exact line, in 17 of 300 sites (5.7 %). Accepted by the M11a owner decision; a finer grid is alternative C in BACKLOG. |

Economy script result (M09c, Russia, seed 1, 10 minutes, `npm run sim:scenario -- --solo --ai`): AI v0 with building has 14 274 land cells, factor 1.02 of the band's upper limit 14 000, inside the asked [1.0, 1.5] (M09b: 0.90). Income per minute 12 236 gold at minute 10. The levers that moved it, measured one at a time on the M09b state (land at minute 10): troop gate 40 -> 33: 13 897; upgrade when rich alone: 13 060; both at 36: 14 543, at 37: 14 274. The combined run was chaotic in the other tests: at 36, 35 and 38 the driver test with zero refused Skirmish intents hit one refusal (a Spawn-time Attack with no contact, a race older than this slice), at 25 the pace floor (29.6 against 30); 37 passes everything with a human share of 40.6 % (43.2 % before M09c). The build-free expander is unchanged (the M04 band, no change to it).

## Match end, anti-snowball and score (M18-1)

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `WIN_LAND_SHARE_PCT` | 60 | percent of all playable weighted land | plan | Condition (a): the share to hold (default of `config.win.landSharePct`). |
| `WIN_HOLD_TICKS` | 300 | ticks | plan | Condition (a): consecutive ticks the share must be held (30 s); a dip below the requirement resets the timer. |
| `TIME_LIMIT_SKIRMISH_TICKS` | 7200 | ticks | plan | Condition (c): time limit of a Skirmish, counted from the end of the spawn phase (12 min). |
| `TIME_LIMIT_WORLD_TICKS` | 15000 | ticks | plan | Condition (c): time limit of a World match (25 min). |
| `OVERTIME_START_MINUTE` | 20 | minutes | plan | The land requirement starts to fall after this minute of play (60 percent up to minute 21, 59 from there). |
| `OVERTIME_STEP_PCT` | 1 | percentage points per whole minute | plan | Fall of the requirement per whole minute after `OVERTIME_START_MINUTE`. |
| `OVERTIME_MIN_PCT` | 1 | percent | eget val | The overtime curve never asks for less than this (structural floor). |
| `SCORE_CITY_LEVEL_POINTS` | 25 | points per finished City level | plan | Score = land (weighted std-cells) + 25 per City level + 10 per Factory level. |
| `SCORE_FACTORY_LEVEL_POINTS` | 10 | points per finished Factory level | plan | See above. |
| `LEADER_LAND_PCT_MID` | 25 | percent of weighted land | plan | Anti-snowball: a nation holding STRICTLY more than this is cheaper to attack (also read by the AI gang-up rule later). |
| `LEADER_LAND_PCT_HIGH` | 40 | percent of weighted land | plan | Anti-snowball: the second, stronger threshold (strictly greater). |
| `LEADER_COST_PCT_MID` | 85 | percent of the cell price | plan | The attacker's price against a target above `LEADER_LAND_PCT_MID` (x0.85). |
| `LEADER_COST_PCT_HIGH` | 70 | percent of the cell price | plan | The attacker's price against a target above `LEADER_LAND_PCT_HIGH` (x0.7); replaces the mid discount, never stacks. |

## M11b: air navigation (src/sim/nav)

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `NAV_BLOCK_CELLS` | 4 | sim cells per nav cell side | plan | The 256x128 nav grid of the 1024x512 world (a nav cell is 16 sim cells). |
| `AIR_MODE_AGL_M` | [300, 3000] | real metres above ground, [Low, High] | plan | The flight-mode table (indexed by the LOS altitude mode); the same numbers as `ALT_LOW_AGL_M` and `ALT_HIGH_AGL_M` of M11a. |
| `AIR_MODE_SPEED_MILLICELLS_S` | [2100, 3000] | thousandths of a sim cell per second, [Low, High] | plan | Low (NOE, masked) 2.1 and High (visible) 3 cells per second: a 60-cell flight takes 28.6 s and 20 s. Time-compressed game values. |
| `HELI_FUEL_CELLS` | 180 | sim cells of flown distance | plan | Fuel of a helicopter; a route longer than this is OUT_OF_FUEL. |
| `SERVICE_CEILING_M` | 6000 | real metres | plan | A nav cell is closed to a mode when real mean height + real AGL is above this, and always when it holds a Peak sim cell. |
| `AIR_ROUTE_WEIGHT_PCT` | 130 | percent | plan | Heuristic weight of the weighted A* (1.3). |
| `AIR_EXPOSURE_LAMBDA` | 3 | steps | plan | An exposed nav cell (radar-seen or inside a Post radius) costs this many extra steps' worth of km. |
| `AIR_CLIMB_COST_PCT_PER_KM_M` | 25 | percent of the step km per 1000 m of height difference | eget val | Slope term of the route cost: routes prefer valleys over crossing ridges. |
| `AIR_CEILING_COST_PCT` | 50 | percent of the step km | eget val | Ceiling term: added within `AIR_CEILING_MARGIN_M` of the service ceiling. |
| `AIR_CEILING_MARGIN_M` | 1000 | real metres | eget val | See above. |
| `LZ_REASON_BASE` | 64 | code offset | plan | Landing-zone refusals are 65..72 (LZ_REASON_BASE + 1..8), disjoint from the REJECT_* codes 1..44 of the intents. |
| `LZ_MAX_ELEV_M` | 3500 | real metres | plan | A landing zone above this mean height is TOO_HIGH. |
| `LZ_STEEP_SPREAD_M` | 200 | real metres | plan | A landing zone whose 3x3 sim cells differ by more than this in real mean height is STEEP. |
| `LZ_ENEMY_CITY_CELLS` | 2 | sim cells (Euclidean) | plan | A landing zone within this distance of an enemy city is refused (3 cells away is fine). |
| `LZ_SCORE_BASE` | 1000 | points | eget val | Score of a perfectly flat, unexposed landing zone. |
| `LZ_SCORE_SPREAD_PER_M` | 2 | points per metre of 3x3 spread | eget val | Flatter is better. |
| `LZ_SCORE_EXPOSED_PER_CELL` | 60 | points per exposed nav cell of the approach | eget val | A less exposed approach is better; the score never falls below 1 for a valid zone. |
| `HELI_CAPACITY` | 64 | slots | eget val | M12a-1: slots of the helicopter table; a structural limit, never reached (the fleet cap is 12). |
| `BEACHHEAD_CAPACITY` | 64 | slots | eget val | M12a-1: slots of the beachhead table (part 3 fills it). |
| `HELI_ROUTE_CAPACITY` | 64 | waypoints | eget val | M12a-1: waypoints one helicopter stores for its route (part 2). |
| `HELI_PRICE_GOLD` | 200 | gold | plan | M12a-1: price of one helicopter, taken when ProduceHeli is applied. |
| `HELI_BUILD_TICKS` | 120 | ticks | plan | M12a-1: production time, 12 s, one at a time per Factory. |
| `HELI_FLEET_BASE` | 2 | helicopters | plan | M12a-1: fleet cap = this + the sum of the levels of the finished Factories. |
| `HELI_FLEET_MAX` | 12 | helicopters | plan | M12a-1: the hard top of the fleet cap (a helicopter under production counts). |
| `HELI_MAX_TROOPS` | 600 | troops | plan | M12a-1: most troops one helicopter carries (part 2). |
| `HELI_HP_TENTHS` | 1000 | tenths of HP | plan | M12a-1: hit points of a helicopter, 100.0 HP stored in tenths. |
| `HELI_FUEL_MAX_Q8` | 46080 | Q8 sim cells | eget val | M12a-1: a full tank, HELI_FUEL_CELLS * 256. |
| `HELI_TAKEOFF_TICKS` | 20 | ticks | eget val | M12a-2: a helicopter lifts off for 2 s before it cruises (the altitude climbs to the floor of its cell). |
| `HELI_HOVER_TICKS` | 30 | ticks | plan | M12a-2: it hovers 3 s over the landing zone; part 3 unloads after that. |
| `HELI_DOWNED_TICKS` | 50 | ticks | plan | M12a-2: a downed helicopter stays 5 s in the table, then it is removed. |
| `HELI_CLEARANCE_GAME_M` | 100 | game metres | eget val | M12a-2: clearance above the occluder height of the cell: alt = max(EXAG * mean + AGL, occluder + this). Over the Alps this lifts the Low flight 328 to 5552 m (game metres, mean 2711) above EXAG * mean + 300 at the ridge pass (DECISIONS M12a-2). |
| `HELI_VERT_GM_PER_CELL` | 4000 | game metres per cell flown | eget val | M12a-2: the most the altitude changes per cell flown (the floor above wins when the ground is steeper). |
| `HELI_LOOKAHEAD_CELLS` | 4 | cells | plan | M12a-2: terrain-following look-ahead along the heading. |
| `HELI_APPROACH_CELLS` | 5 | cells | eget val | M12a-2: a helicopter on the last leg is APPROACHING within this distance of the landing zone. |
| `HELI_UNLOAD_TICKS` | 10 | ticks | plan | M12a-3: a helicopter sets down and unloads for 1 s; the cells are taken in the last step. |
| `BEACHHEAD_LANDING_CELLS` | 9 | cells | plan | M12a-3: a landing takes the zone and its eight neighbours at most (N, E, S, W, NE, SE, SW, NW). |
| `BEACHHEAD_ESTABLISH_CELLS` | 80 | cells | plan | M12a-3: a cut-off cluster is established when the search from its seed reaches this many cells (the search is bounded by it) or meets a City. |
| `BEACHHEAD_CHECK_TICKS` | 10 | ticks | plan | M12a-3: the cluster of a beachhead is searched every 10 ticks after the landing. |
| `BEACHHEAD_REVERT_TICKS` | 450 | ticks | plan | M12a-3: a cut-off beachhead that is not established returns to neutral exactly 45 s after its landing. |
| `LANDING_ENEMY_COST_PCT` | 200 | percent | plan | M12a-3: a landing cell that belongs to somebody else costs twice the plain cell price (the Attack price at depth 0 on level ground, terrain, home trait, Post and Walls included). |
| `POST_AA_RADIUS_CELLS` | 12 | sim cells | plan | M12b: a finished Defense Post hurts every hostile helicopter within this distance, in both flight modes. It is `POST_RADIUS_CELLS` (no new number). |
| `POST_AA_DPS` | 15 | HP/s | plan | M12b: damage of ONE Defense Post to a helicopter (100 HP); Posts stack. One Post fells a helicopter in 6.7 s, two in 3.3 s. |
| `POST_AA_TENTHS_PER_TICK` | 15 | tenths of HP per tick | plan | M12b: derived, `POST_AA_DPS` x 10 / `TICK_HZ`, the unit the helicopter table counts in (`HELI_HP_TENTHS` 1000). |
| `SAM_SALVO_PERIOD_TICKS` | 90 | ticks | plan | M12b: a SAM site fires one salvo every 9 s; the first salvo goes as soon as a visible hostile helicopter is in reach. |
| `SAM_HIT_PCT` | 55 | percent | plan | M12b: chance that one salvo brings a helicopter down (a hit is a kill). Flat in the level: a higher SAM level reaches further (`SAM_RADIUS_BASE_CELLS` curve), it does not hit harder. |
| `TECH_COUNT` | 16 | techs | eget val | M18d-1: the research tree has 16 techs (TECH_BRANCHES x TECH_STEPS). Tech index = branch * 4 + (step - 1). |
| `TECH_BRANCHES` | 4 | branches | eget val | M18d-1: ECONOMY 0, LAND 1, AIR 2, DEFENCE 3. |
| `TECH_STEPS` | 4 | steps | eget val | M18d-1: four steps per branch; step n needs step n - 1 of the same branch. |
| `TECH_PRICE_GOLD` | [350, 550, 800, 1100, 350, 550, 800, 1100, 350, 550, 800, 1100, 350, 550, 800, 1100] | gold, by tech | eget val | M18d-1: 350, 550, 800, 1100 for steps 1 to 4 of every branch, taken when the research STARTS (no refund on cancel). A mid-game City pays about 2 to 2.5 gold/s, so a step costs roughly 3 to 7 minutes of ONE City; a whole branch costs 2800 gold, all 16 techs 11200. Provisional. |
| `TECH_TICKS` | [600, 900, 1200, 1500, 600, 900, 1200, 1500, 600, 900, 1200, 1500, 600, 900, 1200, 1500] | ticks, by tech | eget val | M18d-1: 600, 900, 1200, 1500 ticks (1.0, 1.5, 2.0, 2.5 minutes) for steps 1 to 4. One research per seat at a time, so one branch takes 9 minutes and all 16 techs 28 minutes: a 10-minute match never gets the whole tree. Provisional. |
| `TECH_FX_CHANNELS` | 12 | channels | eget val | M18d-1: the columns of TECH_FX: 0 gold %, 1 upgrade price discount %, 2 attacker cell price discount %, 3 troop regeneration %, 4 troop cap %, 5 helicopter load %, 6 helicopter speed %, 7 helicopter fuel %, 8 extra helicopters in the fleet cap, 9 SAM hit chance (percentage points), 10 Walls and Defense Post strength %, 11 SAM salvo period reduction %. |
| `TECH_FX` | [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0, 15, 5, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 1, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 17] | per tech x channel | eget val | M18d-1: what each tech gives, 12 values per tech (row = tech, column = channel, flat). ECONOMY: Trade Routes gold 5; Canal Works upgrade 5; Banking gold 7; Exchange gold 8 and upgrade 10. LAND: Road Network cost 4; Field Kitchens regeneration 5 and cap 5; Conscription cap 10 and cost 5; Combined Arms cost 6 and regeneration 10. AIR: Rotor Blades speed 5 and load 10; Auxiliary Tanks fuel 10 and fleet 1; Heavy Lift load 15, speed 5 and fuel 15; Air Command fleet 1, speed 5 and SAM hit 10. DEFENCE: Palisades Walls/Post 5; Fire Control salvo 8; Fortification Walls/Post 10; Integrated Defence Walls/Post 10 and salvo 17. The sums of the four steps equal TECH_FX_CAP exactly. |
| `TECH_FX_CAP` | [20, 15, 15, 15, 15, 25, 15, 25, 2, 10, 25, 25] | per channel | eget val | M18d-1: the most a channel can give however many techs: gold 20, upgrade 15, cell price 15, regeneration 15, troop cap 15, helicopter load 25, speed 15, fuel 25, fleet +2, SAM hit +10 points, Walls/Post 25, salvo 25. The global 15 gold/s per structure ceiling and the 10x rule still hold (a Port is cut at PORT_INCOME_MAX_MILLI_PER_SEC after the +20 %). |
| `AI_TECH_GOLD_RESERVE` | 300 | gold | eget val | M18d-1: a nation starts a research only when this much gold is left after the price. |
| `AI_TECH_PERIOD_TICKS` | 100 | ticks | eget val | M18d-1: a nation looks at research once per 100 ticks (staggered by seat): its back-off. |
| `AI_TECH_START_TICKS` | 1500 | ticks | eget val | M18d-1: no AI research before tick 1500 (2.5 minutes): expansion first. |

## M18e-1: Airfield, Lab and Plant (structure types 7, 8, 9)

Three new structure types in the same table, with the same Build / Upgrade / Delete intents. The entries of `BUILD_BASE_GOLD`, `BUILD_TICKS` and `SPACING_CELLS_BY_TYPE` above carry their index 7 (Airfield), 8 (Lab) and 9 (Plant): Airfield 700 gold / 22 s / 6 cells apart, Lab 600 gold / 18 s / 4 cells, Plant 250 gold / 10 s / 3 cells. Prices escalate like the others (x1.5 for the second, up to x6) and an upgrade to level L costs base * L. No technology gate yet (BACKLOG). A conquered Airfield, Lab or Plant is destroyed, like a Silo, SAM or Post.

| Constant | Value | Unit | Source | Note |
|---|---|---|---|---|
| `STRUCT_TYPE_COUNT` | 9 | types | eget val | M18e-1: structure types 1 to 9; a Build with another type fails the shape check (STRUCT_TYPE_SLOTS = 10 is the length of the per-type arrays). |
| `MAX_PER_OWNER_BY_TYPE` | [0, 0, 0, 0, 0, 0, 0, 3, 3, 6] | structures, by type | eget val | M18e-1: the most structures of a type one owner may have (0 = no limit): Airfield 3, Lab 3, Plant 6 (an unfinished one counts). The 4th Airfield is refused with REJECT_BUILD_MAX_COUNT (118). |
| `HELI_FLEET_PER_AIRFIELD_LEVEL` | 1 | helicopters | eget val | M18e-1: each level of each FINISHED Airfield adds one helicopter to the fleet cap (an Airfield at level 3 = +3). |
| `HELI_FLEET_AIRFIELD_MAX` | 6 | helicopters | eget val | M18e-1: all Airfields together add at most 6, on top of the cap of 12 that the base 2 and the Factories give (so at most 18, and 20 with the AIR techs' 2). |
| `AIRFIELD_HELI_TIME_PCT_PER_LEVEL` | 5 | percent | eget val | M18e-1: each level of each finished Airfield shortens the production of a helicopter, in every Factory of the owner, by 5 percent of 120 ticks (rounded down: level 1 = 114 ticks, level 2 = 108). |
| `AIRFIELD_HELI_TIME_MAX_PCT` | 40 | percent | eget val | M18e-1: the cap of that shortening (72 ticks, 7.2 s). |
| `LAB_RESEARCH_PCT_PER_LEVEL` | 5 | percent | eget val | M18e-1: each level of each finished Lab shortens a research that STARTS now by 5 percent (level 1: 600 -> 570 ticks). The end tick is fixed when the research starts; Labs stack. |
| `LAB_RESEARCH_MAX_PCT` | 40 | percent | eget val | M18e-1: the cap of the shortening (the first tech 600 -> 360 ticks, the last 1500 -> 900). |
| `PLANT_GOLD_MILLI_BASE` | 800 | milli-gold/s | eget val | M18e-1: a finished level 1 Plant pays 0.8 gold/s for 250 gold: a payback of 312 s against 267 s for a level 1 City (400 gold, 1.5 gold/s). The economy techs' gold percent applies to it like to a City. |
| `PLANT_GOLD_EXTRA_MILLI` | 800 | milli-gold/s | eget val | M18e-1: the extra at the asymptote of the usual level curve (1.6 gold/s in all; level 2 = 1.0). One Plant never nears the 15 gold/s of ten level 1 Cities, and the six a player may own pay at most 9.6 gold/s together (`tests/sim/m18e1.test.ts`). |
| `PLANT_NEAR_CELLS` | 8 | sim cells | eget val | M18e-1: a Plant may only be built within 8 cells (Euclidean, x wrapping, edge included) of a City or Port of the same owner, finished or not; otherwise REJECT_BUILD_NO_NEIGHBOUR (119). |
| `AI_BUILD_CITIES_PER_PLANT` | 4 | cities | eget val | M18e-1: the AI buys a Plant per 4 Cities it owns (the first at 4 Cities), only from the gold left after its next wanted structure, so it never delays a City. |
| `AI_BUILD_CITIES_PER_LAB` | 6 | cities | eget val | M18e-1: and a Lab per 6 Cities (the first at 6), at most the 3 the rules allow. The AI builds no Airfield (it uses no helicopters before M17). |
| `AI_BUILD_EXTRA_START_TICKS` | 3000 | ticks | eget val | M18e-1: no AI Plant or Lab before 5 minutes (expansion first; its research starts at tick 1500). |
| `SHIP_CAPACITY` | 32 | slots | eget val | M13c-1: slots of the ship table (all seats together); a structural limit. Eight owners can fill it at the fleet cap of 4. |
| `SHIP_ROUTE_CAPACITY` | 48 | waypoints | plan | M13c-1: the most waypoints of one route after the string-pull; a longer route is refused as REJECT_SHIP_NO_ROUTE. |
| `SHIP_FLEET_MAX` | 4 | ships | eget val | M13c-1: ships one owner may have at a time; a docked ship that is cooling down still counts. |
| `SHIP_COOLDOWN_TICKS` | 300 | ticks | eget val | M13c-1: after the ship has docked its Port is blocked for 30 s (REJECT_SHIP_COOLDOWN), then the row goes away. |
| `SHIP_MIN_TROOPS` | 20 | troops | eget val | M13c-1: the fewest troops a ship carries (a ship is a raid, not a hop). |
| `SHIP_MAX_TROOPS` | 1200 | troops | eget val | M13c-1: the most troops one ship carries: twice a helicopter (600), but only after a long, slow crossing. |
| `SHIP_LAUNCH_GOLD` | 100 | gold | eget val | M13c-1: the fee of a departure, taken with the troops (half the price of a helicopter, which stays in the fleet). |
| `SHIP_LAND_REACH_CELLS` | 2 | sim cells | eget val | M13c-1: the landing cell must have a water cell within 2 cells (Chebyshev, x wrapping); the ship stops on such a cell. |
| `SHIP_ROUTE_MAX_CELLS` | 16384 | cells | eget val | M13c-1: the route search expands at most this many water cells; more and the launch is refused as NO_ROUTE. About 100 cells of open sea cost 3000 expansions, a 300-cell crossing round a wall 6000. |
| `SHIP_CELLS_PER_TICK_Q` | 32 | Q8 cells/tick | eget val | M13c-1: 32/256 = 0.125 cells per tick = 1.25 cells per second, 60 percent of a Low helicopter (2.1): a 46-cell crossing takes 368 ticks (37 s). |
| `SHIP_LAND_TICKS` | 20 | ticks | eget val | M13c-1: a ship unloads for 2 s before the cells are taken (a helicopter 1 s). |
| `SHIP_REASON_BASE` | 120 | code offset | eget val | M13c-1: the refusals of LaunchShip are 121..133 (SHIP_REASON_BASE + 1..13), above every other REJECT_* code (the last older one is 119). |
| `MISSILE_CAPACITY` | 64 | slots | eget val | M14a: slots of the missile table (all seats together); a structural limit. |
| `MISSILE_BASE_GOLD` | [300, 900, 3500] | gold, by class (Tactical, Fission, Fusion) | plan | M14a: the price of the first launch of a class; later launches by the same seat cost more (MISSILE_PRICE_STEP_PCT). |
| `MISSILE_PRICE_STEP_PCT` | 25 | % of the base per earlier launch | plan | M14a: price = base x (100 + 25 n) / 100 in whole milli-gold, n = earlier launches of that class by the seat. |
| `MISSILE_COOLDOWN_TICKS` | 450 | ticks | plan | M14a: a Silo launches once per 45 s (kept in the salvoTick word of the Silo row). |
| `MISSILE_RANGE_ANGLE` | [5120, 15360, 0] | angle units (65536 = a turn), by class; 0 = unlimited | plan | M14a: 80 and 240 reference cells of 64 units (a 1024-cell equator); compared as a chord length against a table, no asin. |
| `MISSILE_SPEED_ANGLE_PER_TICK` | [128, 192, 192] | angle units/tick, by class | plan | M14a: 20 reference cells/s for the cruise missile, 30 for the ballistic ones (provisional, M19 tunes). Flight time = ceil(arc / speed). |
| `MISSILE_R_IN_KM` | [157, 235, 704] | km, by class | plan | M14a: the plan's inner radii 4, 6 and 18 cells x 39.1 km (an equator cell), rounded. |
| `MISSILE_R_OUT_KM` | [313, 626, 1174] | km, by class | plan | M14a: the plan's outer radii 8, 16 and 30 cells x 39.1 km, rounded. |
| `MISSILE_FUSION_SILO_LEVEL` | 2 | Silo level | plan | M14a: a Fusion missile needs a Silo of level 2 or more (REJECT_MISSILE_NEED_SILO_L2). |
| `MISSILE_OUTER_HIT_PCT` | 50 | % | plan | M14a: chance that a building in the outer ring is hit (a stateless hash roll of match seed, tick, missile and cell). |
| `MISSILE_TROOP_LOSS_CAP_PCT` | 60 | % of the owner's troops | plan | M14a: an owner never loses more than this share of its troops to one blast. |
| `MISSILE_TROOP_LOSS_FACTOR` | 3 | factor | plan | M14a: loss = min(60 % x T, 3 x T x cellsHit / N), N = the owner's cells before the blast. |
| `FALLOUT_TICKS` | 1800 | ticks | plan | M14a: the fallout of the inner disc lasts 180 s from the tick of the blast; no building, 1.5 x the conquest price. |
| `FALLOUT_COST_PCT` | 150 | % of the usual price | plan | M14a: conquering a fallout cell costs 1.5 x. |
| `MISSILE_MAX_FLIGHT_TICKS` | 200 | ticks | eget val | M14a: the longest flight a state may hold (a guard of deserialize); half the globe at 192 units/tick is 171. |
| `MISSILE_REASON_BASE` | 140 | code offset | eget val | M14a: the refusals of LaunchMissile are 141..151 (MISSILE_REASON_BASE + 1..11), above the ship block (121..133). |

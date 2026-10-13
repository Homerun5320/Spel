# Balans (BALANCE)

**Sammanfattning (svenska).** Alla spelsiffror ligger i en enda fil, `src/sim/rules.ts`, och varje konstant har en rad i tabellen nedan (ett test kontrollerar att filen och tabellen stämmer överens). Siffrorna är otestade startvärden: de flesta kommer från planen ("plan"), några är egna val ("eget val") och märkta som sådana. Planens regler är skrivna för ett 512x256-rutnät; spelet kör 1024x512, så en std-cell är 2x2 simceller (avstånd x2, areor x4, hastigheter x2). Trupper räknas i kvartstruppar (4 = 1 trupp) och guld i tusendels guld, så att inga flyttal behövs. Förändrar du ett värde: räkna upp `ENGINE_VERSION`, uppdatera raden här och kör testerna.

Below, everything is in English. See `docs/DECISIONS.md` D73 to D80 for how the units were chosen.

## How to read the table

- **Value** is the exact value exported by `src/sim/rules.ts` (integers only; fractions are integers with a named scale such as `_MILLI` = thousandths or `_PCT` = hundredths).
- **Source** is `plan` (the number comes from the milestone prompt, possibly converted to sim units or to an integer scale) or `eget val` (our own choice; the plan gave no number or only a hint). A constant marked "Derived" is a pure function of others in the table.
- A constant of part B (conquest) is already in the file so that the table is complete; it has no effect on the game until the conquest is wired in.
- Constants named `_STD` are in std-cell units, the others in sim units.


## Time and turns (M03)

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `TICK_HZ` | 10 | ticks per second | plan | Simulation rate; 1 tick = 0.1 s. |
| `TICK_MS` | 100 | ms per tick | plan | Derived: 1000 / TICK_HZ. |
| `INTENT_DELAY_TURNS` | 2 | turns | plan | An intent submitted at tick T runs at T + 2. |
| `MAX_INTENTS_PER_TURN` | 4096 | intents | eget val | A larger turn is refused as a whole. |
| `MAX_TICKS_PER_FRAME` | 8 | ticks | eget val | The host drops the surplus of a stalled frame. |

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
| `TERRAIN_COST_PCT` | [0, 0, 100, 130, 160, 250, 0, 0] | % of a Plains cell, by class (DeepSea, Shallows, Plains, Forest, Hills, Mountain, Peak, Ice) | plan | 0 = unplayable and impassable (sea, Shallows, Peak, Ice). Cost multipliers 1.0 / 1.3 / 1.6 / 2.5 are used by the conquest (part B); the zeros already decide which cells can be owned. |

## Start, troops and gold (M04 part A)

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `START_TROOPS` | 1200 | troops | plan | Clamped to the cap. |
| `START_GOLD` | 500 | gold | plan |  |
| `START_DISC_RADIUS_CELLS` | 8 | sim cells | plan | Read as SIM cells (D75). In std-cells it would be 16. |
| `START_DISC_CELLS` | 197 | sim cells | plan | Integer points with dx^2 + dy^2 <= 64; a test recounts it. Cells a Spawn claims. |
| `CAP_BASE_TROOPS` | 2000 | troops | plan | Troop cap = 2000 + 120 * N^0.75 + 800 * cityLevels. |
| `CAP_N_COEF_TROOPS` | 120 | troops | plan | N = owned area in std-cells (cos-weighted). |
| `CAP_CITY_LEVEL_TROOPS` | 800 | troops per city level | plan | Cities arrive in M09; the level count is 0 until then. |
| `REGEN_BASE_TROOPS_PER_SEC` | 8 | troops per second | plan | Regeneration = max((8 + 0.35 * sqrt(T)) * (1 - T / Tmax), -MAX_DECAY). |
| `REGEN_SQRT_COEF_MILLI` | 350 | thousandths | plan | 0.35. |
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

## Conquest (wired in M04 part B; the plan's starting values, to be calibrated)

| Constant | Value | Unit | Source | Note |
|----------|-------|------|--------|------|
| `CAPTURE_K_MILLI` | 80 | thousandths | plan | Capture speed = K * sqrt(L) * 2F / (F + Td) in std-cells per second; K = 0.08 (0.06 to 0.15 expected). |
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
| `ENCLAVE_FLIP_TICKS` | 20 | ticks | plan | Enclave flip every 20th tick, offset by hash(id). |

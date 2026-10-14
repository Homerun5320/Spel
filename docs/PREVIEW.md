# Förhandsvisning: så ser du spelet

Den här filen är på svenska och skriven för dig som inte är utvecklare. Claude-sessionen i molnet har ingen skärm, så du tittar på spelet själv. Det finns två vägar. Väg 1 (Artifact) är den du använder i första hand. Väg 2 (lokalt på din dator) är reserven.

## 1. Vald väg och skäl

1. **Väg 1, Claude Artifact (vald).** Spelet läggs som en privat sida i ditt Claude-konto. Den är privat tills du själv delar den. Du slipper installera något, och sidan kan öppnas på både dator och telefon.
   - Skäl: du har redan kört en testsida i den riktiga vyn på en iPhone i Claude-appen. Den gav WebGL2 på Apple GPU och 59 FPS med 262 000 trianglar. Det är bevisat, inte antaget.
   - Begränsningar (de är kända och har lösningar): inga adressparametrar (`?x=y`), men ett ankare (`#x`) går fram; inga nedladdningar; inget onlinespel; vissa filtyper (till exempel `.bin`, `.gz`, `.zip`) kan inte läggas upp, så spelets datapaket packas om automatiskt till en tillåten filtyp.
2. **Väg 2, lokalt (`npm run dev`).** Spelet körs på din egen dator. Kräver installation (steg i avsnitt 8). Fungerar med alla `?x=y`-adresser, nedladdningar och (senare) onlinespel.
3. **Netlify (ej vald, EJ MÖJLIG just nu).** Se resultattabellen i avsnitt 9.

## 2. Artifact-länken

4. Artifact-URL: **https://claude.ai/artifact/H4jqcMBvTMi7udLais5btV**
5. Sidan är privat. Bara du, inloggad på ditt Claude-konto, kan öppna den. Dela den inte om du inte vill att andra ska se spelet.

## 3. Så öppnar du länken

6. Dator: klicka på länken ovan (eller kopiera den till webbläsaren). Du ska vara inloggad på claude.ai med samma konto.
7. Telefon: öppna länken i Claude-appen (så visades din testsida) eller i telefonens webbläsare där du är inloggad på claude.ai. Fullskärmsläge finns inte på iPhone, spelet fyller sidan i stället.
8. Efter varje uppdatering: ladda om fliken (dra ned på telefonen, F5 på dator), annars ser du den gamla versionen.
9. Det första du ser är startskärmen (från M05): en ruta över det långsamt roterande klotet med titeln "Erövra jorden", en stor knapp **Spela**, fem rader om hur du styr, en knapp för språk (English / Svenska) och en liten knapp **Dev**. Tryck på Spela (eller Enter). Därefter ser du jorden som ett stiliserat 3D-klot på stjärnhimmel: berg med relief, hav, atmosfär, svaga landgränser och nattljus, och spelets HUD (avsnitt 5b). Uppe till höger finns den runda knappen "Dev". På startskärmen syns också två små länkar nere i hörnen ("Debug: klasskarta ..." och "Testsida (probe)"); de försvinner när matchen börjar och finns i stället i Dev-panelen. Mus: dra för att snurra, scrolla för att zooma (zoomen fäster vid markören), högerdrag eller Ctrl/Skift-drag lutar och vrider, håll markören över marken för land, terräng och höjd (på det språk du valt).

## 4. Uppdateringsproceduren (Claude kör den, du behöver inte göra något)

Claude kör den i slutet av varje milestone som ändrar något du kan se. Rena milestones utan synlig förändring (till exempel de som bara ändrar beräkningar i bakgrunden) publicerar inte om.

10. Bygg och packa: `npm run build && npm run artifact:pack`. Resultatet hamnar i mappen `artifact` (den finns inte i git).
11. Läs Artifacten: Artifact-verktyget med action `read` och URL:en i avsnitt 2. Det måste göras innan en uppdatering.
12. Lista de publicerade filerna: Artifact-verktyget med action `list`, scope `files` och samma URL. Spara sökvägarna i en textfil, en per rad (till exempel `artifact-prev.txt` i sessionens arbetsmapp, inte i repot).
13. Packa om med listan: `npm run artifact:pack -- --prev=artifact-prev.txt`. Sökvägar som fanns förut men inte längre finns får värdet `null` i sista batchen, så de tas bort från sidan. Skriptet skriver antal filer, batcher och MB.
14. Publicera: Artifact-verktyget med `url` (samma som ovan), `file_path` = `artifact/index.html` och `files` = första batchen ur `artifact/files.json`. Finns fler batcher: publicera igen med samma `url`, samma `file_path` och nästa batch som `files`, tills alla batcher är publicerade. `index.html` ligger aldrig i en batch, den publiceras alltid som `file_path`.
15. Kontrollera utan att läsa genererade filer i sin helhet (minifierad JavaScript och datapaket läses inte rakt av): `ls -l artifact`, `head -c 200` på `artifact/index.html` och checksummorna (`cd artifact && sha256sum -c checksums.txt`). Vill man jämföra mot det publicerade kan Artifact-verktyget med action `read` och `path` hämta en publicerad fil, och dess sha256 jämförs med raden i `checksums.txt`.
16. Berätta länken för dig och att du måste ladda om fliken.

Första publiceringen (gjordes för förhandsvisningsspiken) är samma sak utan `url`: `file_path` `artifact/index.html`, `files` = första batchen, samt `icon`. Packa då med `npm run artifact:pack -- --probe`, så att testsidans paket (cirka 3 MB var) följer med. Testpaketen ligger kvar i mappen `artifact/probe` vid senare packningar utan `--probe`.

Datacontainer: standard är `.png` (rå gzip-data under filändelsen .png, snabbast). Visar probe-tabellen att `.png` inte fungerar i den riktiga vyn, byt till `npm run artifact:pack -- --container=b64`, publicera om och anteckna det i `docs/DECISIONS.md`.

## 5. Tabell: `?x=y` blir `#x-y`

I en Artifact når inte adressparametrar (`?x=y`) sidan, men ett rent ankare (`#...`) gör det. Därför skrivs varje adress med `?` också i ankarform. Sedan M02 läser spelet ankaret (en enda parser läser både `?` och `#`).

**Grammatiken** (bara tecknen A–Z a–z 0–9 - . _ ~ får förekomma i ankaret):
- en token är `nyckel` eller `nyckel-värde`; den delas vid det FÖRSTA bindestrecket, så värdet får innehålla fler bindestreck;
- flera tokens skiljs med understreck `_`;
- en `nyckel` utan värde betyder `nyckel=1`;
- finns samma nyckel både i `?` och i `#` vinner ankaret;
- appen lyssnar på ankarbyte (`hashchange`) och startar om läget utan att ladda om sidan.

Exempel: `#perf` = `?perf=1`; `#scene-perf` = `?scene=perf`; `#scenario-slice_sam-1` = `?scenario=slice&sam=1`; `#view-alps-valley` = `?view=alps-valley`; `#seed-7` = `?seed=7`.

Lägen som finns registrerade i Dev-panelen (F2 eller hörnknappen) just nu:

| Lokalt (dator) | I en Artifact (länken + ankare) | Anmärkning |
|----------------|----------------------------------|------------|
| `?perf=1` | `#perf` | prestandaöverlägg: renderer, fps (medel och p95), anrop, trianglar, texturminne, knappen "Kopiera rapport". Avslås med `#perf-0` eller via Dev-panelen |
| `?test=1` | `#test` (även `#test-1`) | testläge (fast bild, ingen animation, Dev-knappen dold) |
| `?scene=spike` | `#scene-spike` | M00-spiken i stället för jorden; `#scene-globe` är jorden |
| `?quality=low` / `medium` / `high` | `#quality-low` / `#quality-medium` / `#quality-high` | kvalitetsnivå (hög ger cirka 1 miljon trianglar) |
| `?terrain=fixed` | `#terrain-fixed` | M07a: det gamla fasta globnätet (M02) i stället för chunk-trädet; `#terrain-chunks` (eller ingen nyckel) är chunk-trädet, standard. Jämför gärna: samma vy, två lägen |
| `?chunks=1` | `#chunks` | M07a: varje chunk i sin egen färg med mörk kant, så att man ser chunkens storlek och LOD-nivåer när man flyger ner mot marken. Avslås med `#chunks-0` eller via Dev-panelen (Visa chunkens färger och kanter) |
| `?view=alps-valley` | `#view-alps-valley` | M07a: startar 2 km över marken i Alperna (46,5 N 8,0 E), blickande söderut mot horisonten och havet. Funkar också med andra lägen: `#view-alps-valley_perf`. Dev-panelen (F2): "Vy: Alpdal, 2 km över marken" |
| `?view=himalaya-valley` | `#view-himalaya-valley` | M07a: startar 2 km över marken i Himalaya (28,2 N 86,8 E), blickande norrut mot bergskedjan. Dev-panelen (F2): "Vy: Himalayadal, 2 km över marken" |
| `?test=1&chunktier=high` | `#test_chunktier-high` | bara för tester: testläget (fast bild, MSAA av, DPR 1) men med chunk-tätheten från kvalitetsnivån hög; så körs hög nivå headless |
| `?seed=7` | `#seed-7` | matchens seed: samma seed ger exakt samma match (standard är 1). Dev-panelen har också ett seed-fält (skriv ett heltal, tryck Starta) |
| `?ai=0` | `#ai-0` | stänger av AI-nationerna och stammarna (en tom match där bara du agerar; `#ai-1` eller ingen nyckel = på, standard). Finns också i Dev-panelen som "AI och stammar av" och "AI och stammar på" |
| `?lang=en` | `#lang-en` | engelska i spelet (`#lang-sv` är svenska, standard). Språkknappen på startskärmen gör samma sak utan omladdning |
| `?test=1&seed=7` | `#test_seed-7` | samma match som `?test=1&seed=7` (testläge, fast bild, ingen startskärm); `#test_hud_seed-7` visar också HUD:en och `#test_ai-0_seed-7` är samma utan AI |
| `?test=1&hud=1&seed=7` | `#test_hud_seed-7` | testläge med HUD synlig (i testläge är HUD dold så att bilderna förblir rena; ingen startskärm, matchen finns direkt) |
| `?test=1&menu=1&hud=1` | `#test_menu_hud` | testläge med menyerna (startskärmen och uppsättningsskärmen) i stället för att matchen startar direkt; det är så testerna kör menyn. På den vanliga sidan behövs ingen parameter: menyn är det första du ser |
| `?map=class` (debugkartan) | `#map-class` | klassernas karta på debugsidan; även `#map-height` (höjd) och `#map-country` (länder) |
| `?test=1&perf=1` | `#test_perf` | flera lägen: tokens skiljs med `_` |
| `?devbtn=1` | `#devbtn` | visar Dev-knappen också i testläge (där den annars är dold) |

17. Lägen i en Artifact nås alltså med länken + `#läge` (till exempel `https://claude.ai/artifact/H4jqcMBvTMi7udLais5btV#perf`) eller via Dev-panelen: F2 på dator, den runda knappen "Dev" uppe till höger på telefon (den syns också på datorn). Panelen skriver ankaret åt dig och laddar om sidan; den rör aldrig adressparametrarna efter `?`. Länken till datakartan i panelen är relativ (`./debug/data.html`).
17a. Datakartan (M01): `debug/data.html` ritar den bakade världen. I en Artifact: länken i avsnitt 2 och längst ned till vänster på startsidan raden "Debug: klasskarta / höjdkarta / landkarta" (tre relativa länkar). Lokalt: `http://localhost:5173/debug/data.html?map=class` (eller `?map=height`, `?map=country`) eller ankaret `#map-class`, `#map-height`, `#map-country`. Sidan har också tre knappar (Klasskarta, Höjdkarta, Landkarta). Datapaketen (cirka 4,5 MB) packas som vanligt av `npm run artifact:pack`; i en Artifact blir de `.png`-filer (standard) eller `.b64.txt` med `--container=b64`.
17b. Rapporter: knappen "Kopiera rapport" öppnar en ruta med rapporten som text. Försök kopiera sker direkt; nekas det (eller är Ladda ner blockerat i en Artifact) markerar du texten i rutan ("Markera allt") och kopierar den för hand.
17c. Simuleringens hashar (M03): `debug/sim.html` kör den skriptade simulationen i webbläsaren och visar hasharna vid tick 1, 10, 100, 1000 och 6000 (både direkt och via MainThreadHost) samt flyttalskanariefågelns hash; de ska vara lika med `e2e/goldens/sim-hashes.json`. Lokalt: `http://localhost:5173/debug/sim.html` (valfritt `?seed=2&ticks=1000` eller ankaret `#seed-2_ticks-1000`). Länken finns också i Dev-panelen (F2) som `./debug/sim.html`. Inget syns i spelet självt i M03.

### 5b. Så spelar du (M05)

17d. **Starta.** Öppna länken (avsnitt 2) och tryck **Spela** på startskärmen. Vill du ha en bestämd match: länken + `#seed-7` (lokalt `?seed=7`), eller skriv seed i Dev-panelens seed-fält (F2, fältet "Seed", Starta). Samma seed ger samma match varje gång. Vill du ha engelska: `#lang-en` eller språkknappen på startskärmen. Flera lägen i ett ankare skiljs med `_`, till exempel `#seed-7_perf`.
17e. **Spawn-fasen (20 sekunder).** Så fort du har valt plats fylls världen på runt dig: först fem AI-nationer (de syns i ledartavlan som Nation 1 till 5, var och en med sin färg), sedan tjugo stammar (matta, dova färger, inte i ledartavlan). De dyker upp en i taget, en ny varje tiondels sekund, och alla är på plats cirka 3 sekunder efter ditt klick. **Klicka på din startplats inom de första 15 sekunderna**: väntar du längre placeras AI-länderna över hela kartan i stället för runt dig, och då kan du spela tio minuter utan att möta någon (startskärmens hjälprad påminner om det). Rutan överst säger "Välj din startplats: klicka på marken" och räknar ned. Klicka (ett kort klick, utan att dra) på land: din nation startar där med en rund startyta. Går det inte (hav, bergstopp, is) säger en liten ruta nere i mitten varför. Hinner du inte välja startplats får du inte vara med i den matchen (ladda om sidan). Därefter har du fem sekunders skydd (andra kan inte anfalla dig, och du kan inte anfalla ägd mark).
17f. **Erövra.** Klicka på fiende- eller oägd mark som gränsar till din: trupper går dit och marken tas över i takt med terrängen: berg är både dyra och långsamma (en bergsruta tar 2,5 gånger så lång tid som en slättruta, kullar 1,6 och skog 1,3), så Alperna och Himalaya bromsar fronten tydligt medan slätten går fort. Ett klick på havet, en bergstopp eller is visar ett meddelande; ett klick på din egen mark gör ingenting. Dra med musen snurrar klotet; det räknas som ett klick bara om musen rört sig under 6 pixlar.
17g. **Reglage och tangenter.** Nere till höger: hastighet (Paus, 1x, 2x, 4x) och **Insats**, andelen av dina trupper som varje anfall skickar (5 till 100 procent, steg om 5, standard 40). Tangenter: `[` och `]` ändrar insatsen (på ett svenskt tangentbord fungerar också `-` och `+`, eftersom hakparenteserna kräver AltGr), mellanslag pausar och fortsätter, `,` och `.` går ett steg långsammare och snabbare, F2 öppnar Dev-panelen, F3 visar renderer och bildfrekvens. `#perf` visar prestandaöverlägget med knappen "Kopiera rapport" (där finns också tiden för simuleringssteg och HUD per bildruta).
17h. **HUD.** Nere till vänster: **Guld** med inkomst per sekund, **Trupper** med takstapel (stapeln blir orange och texten "Nära taket" visas från 80 procent av taket; trupper över taket sjunker), **Landandel** i procent av världens land, och **Tid** sedan matchstart. Uppe till höger: **Ledartavlan** med de fem största nationerna och din egen rad (är du bland de fem syns inga extra rader). Stammarna (neutrala) är inte med i tavlan. Panelerna är mörka så att texten går att läsa över både snö och natt. På en telefon som hålls upprätt (smal skärm) ligger fasrutan med nedräkningen över hela översta raden, ledartavlan under den och Dev-knappen till höger.
17i. **Dev-knappen och Dev-panelen.** På startskärmen finns en liten Dev-knapp (och den runda hörnknappen uppe till höger finns hela tiden). Panelen listar alla lägen, seed-fältet, `HUD i testläge`, språk, `./debug/sim.html` (simuleringens hashar) och `./debug/data.html`.
17j. **Motståndare (AI v0 och stammar).** *AI-nationerna* (fem) väntar tills de har minst hälften av sitt trupptak och attackerar då: först den svagaste granne de har minst 1,3 gånger fler trupper än, annars oägd mark som gränsar till dem; de anfaller aldrig under spawn-fasen eller de fem skyddssekunderna. De tänker en gång per sekund var, förskjutet så att inte alla agerar på samma tick. *Stammarna* (tjugo) växer långsamt tills de har cirka 600 rutor och stannar sedan; de angriper aldrig en annan nation men försvarar sig, och AI-nationerna äter upp dem när de får chansen. En stam är det första du möter (cirka en minut efter spawn om du expanderar hela tiden), en AI-nation oftast efter två till sex minuter. Allt är en funktion av seed: samma seed och samma klick ger samma match i Chrome och i Node (testat).
17k. **Vad du ska titta på under cirka 10 minuter (gate M05).** (1) Spawn och attack: klicka ut en startplats, vänta på de fem skyddssekunderna, klicka på stammarna runt dig och på en AI-nation. (2) Tydliga gränser, även på berg (Alperna, Himalaya) och vid kusten, och att din färg (magenta, med en ljus kant på nattsidan) går att skilja från alla andras och från hav och land, både på dagsidan och i mörkret (vrid klotet så att Europa hamnar på natten och titta efter din kant). (3) Bromsar Alperna och Himalaya erövringen? (berg tar 2,5 gånger så lång tid som slätt och kostar lika mycket mer trupper; jämför fronten över Polens slätt med fronten över Alperna). (4) Tempot vid 1x, 2x och 4x (`,` och `.`). (5) Är HUD:en läsbar? (6) FPS: F3 visar bildfrekvens, `#perf` (Dev-panelen: Prestanda) visar också "match: sim-steg per bildruta" och knappen Kopiera rapport. Rapportera gärna om något AI-land verkar växa för fort eller för långsamt, och om stammarna är för svåra eller för lätta.

### 5c. Så väljer du land (M06)

17l. **Två knappar på startskärmen.** **Spela** startar en snabbmatch precis som förut (du klickar ut en startplats var du vill). **Välj land och inställningar** öppnar uppsättningsskärmen: en panel till vänster (på en telefon som hålls upprätt ett fält längst ned), medan jordklotet ligger kvar bakom och går att klicka på. Inget i menyn kräver någon adressparameter, så den fungerar i Artifact-länken som den är.
17m. **Riktigt land.** Fliken *Riktigt land*: skriv i sökrutan (svenska eller engelska, stora eller små bokstäver, med eller utan prickar: "sverige", "Sweden" och "aland" hittar alla sitt land) eller **klicka på ett land på globen**. Kameran flyger dit och landets gräns ritas med en gul linje (resten av världen dämpas). Länder som inte kan väljas står kvar i listan med skälet i rött, till exempel "Landmassan är för liten för en rättvis start: 154 av 197 celler." (Island) eller "Landet har för få celler för en rättvis start: 1 av 8 celler." (Åland, raden säger "1 cell"); du kan titta på dem men inte starta med dem. Alla nationer börjar med lika många trupper och lika mycket guld och en startskiva på exakt 197 celler runt huvudstaden, även över grannlandets mark; resten av ditt eget lands mark är hemland och kostar hälften så mycket för dig att ta (bara för dig, bara det landet).
17n. **Eget land.** Fliken *Eget land*: skriv ett namn, välj en av sex färger (färgerna är valda så att din mark syns tydligt på globen: inget blått, grönt eller brunt), titta på flaggan (knappen *Ny flagga* slumpar en ny, helt utan bilder: mönster, två färger och en symbol ritas upp) och **klicka på land på globen** där du vill börja. En ring visar var. Klickar du på hav, is, en liten ö (under 197 celler) eller utanför det valda området står skälet direkt under flikarna. Du spawnar exakt på den ruta du valde. Namnet får inte vara ett riktigt lands namn (svenska eller engelska, stora eller små bokstäver): då står skälet i statusraden och Starta förblir avstängd.
17o. **Matchalternativ.** *Område*: hela världen eller ett utsnitt (Europa, Östasien, Amerika, Afrika och Mellanöstern); ingen ruta utanför utsnittet kan någonsin ägas. *AI-nationer*: standard 12, reglaget slutar där det inte finns fler lämpliga länder (Östasien: 9). *Stamfolk* av eller på. *Svårighetsgrad* sparas (AI:n använder den först i en senare version). *Seed*: samma val och samma seed ger exakt samma start (fältet börjar på seed i adressen, `#seed-12`, annars på det du använde sist). *Inga riktiga gränser*: bara för eget land; inga landsgränser och inga landsnamn ritas och AI-nationerna får påhittade namn.
17p. **Under spelet.** Din flagga och ditt namn står överst i panelen nere till vänster, och ledartavlan visar varje nations flagga och namn (landsnamn på valt språk). Alla nationer är på plats från början, så spawnfasen är bara 20 sekunders väntan (och 5 sekunders skydd) innan anfall tillåts; texten säger det. Ledartavlan rangordnar efter landandel (yta), så en nation långt norrut ligger lägre än en vid ekvatorn trots lika många celler.
17q. **Minne och tangenter.** Dina val sparas i webbläsaren (nyckeln `spel.setup`) och finns kvar nästa gång, och det språk du valt med språkknappen också (nyckeln `spel.lang`; en adress med `#lang-en` eller `#lang-sv` gäller före det sparade språket och sparas inte). **Escape** i uppsättningsskärmen lämnar först textfältet du skriver i och går vid nästa tryck tillbaka till startskärmen. **Enter** i sökrutan väljer första träffen, men inte om den är avstängd; är lagringen blockerad (privat fönster, Artifact-sandlåda) fungerar allt ändå, valen gäller då bara tills du laddar om sidan.
17r. **Politik.** Gränser och namn följer Natural Earths faktiska linjer; omstridda områden har neutrala namn (`public/data/overrides.json`). Uppsättningsskärmen visar en kort friskrivning: stiliserad, fiktiv karta, inga politiska ståndpunkter. Fullständig kredit kommer i M23.
17s. **Vad du ska titta på (M06).** (1) Sök "Sverige", klicka på raden: kameran flyger dit och gränsen lyser; klicka på Island i listan (avstängd, skälet står där). (2) Klicka på ett land på globen i stället. (3) Starta: din startskiva ligger på Stockholm, alla har 197 celler, ledartavlan har flaggor. (4) Eget land: prova ett klick på havet, på Antarktis och på en liten ö; sedan en giltig plats; starta och se att du hamnar exakt där. (5) Välj Europa som område och spela några minuter: inget blir ditt utanför Europa. (6) Slå på "Inga riktiga gränser". (7) Ladda om sidan: valen finns kvar.
17t. **Terrängen som chunk-träd (M07a, del A).** Jorden ritas nu som ett träd av små rutnät (chunks) som blir finare nära kameran och grövre långt bort, i stället för ett enda fast nät. Det syns knappt på avstånd (samma bild som förut, lite skarpare berg), men går att undersöka: **`#chunks`** (Dev-panelen: "Visa chunkens färger och kanter") ger varje chunk en egen färg med mörk kant, så du ser hur nätet delas upp när du zoomar och lutar kameran; **`#terrain-fixed`** (Dev-panelen: "Terräng: gamla fasta nätet") ger det gamla nätet från M02 att jämföra med, och `#terrain-chunks` eller ingen nyckel är chunk-trädet igen. `#perf` (eller F3) visar en terrängrad: antal chunks, vilka nivåer, trianglar och om taket för antalet chunks stoppade fler delningar. Närmare än cirka 220 km över marken kom man inte med musen i del A; det går sedan del B (punkt 17u); testlägets krok `altAglM` går dit för testerna. Standardkvaliteten (medel) ritar högst 300 chunks (cirka 690 000 trianglar), i vanliga vyer ungefär lika många trianglar som det gamla nätet (271 000) och i den första vyn en dryg tredjedel.
17u. **Marknära kamera och territoriet på chunk-terrängen (M07a, del B).** Du kan nu zooma med musens hjul ända ned till cirka 1 km över marken (över hav och över Himalaya, där terrängen är tolv gånger överdriven och toppar står 100 km upp). Stegen blir mindre ju närmare marken du är, och kameran stannar 1 km över marken i stället för att gå igenom ett berg. Två färdiga vyer startar 2 km över marken, tiltade mot horisonten: **`#view-alps-valley`** (Alperna, du ser söderut mot havet) och **`#view-himalaya-valley`** (Himalaya, du ser norrut mot bergskedjan); adressen är länken till sidan följd av ankaret, till exempel `...#view-alps-valley`. Når du inte ändra adressen: tryck **F2** (eller knappen "Dev" i hörnet), välj "Vy: Alpdal, 2 km över marken" eller "Vy: Himalayadal, 2 km över marken"; sidan skriver ankaret åt dig. Högerdrag lutar kameran bara nedåt från dessa vyer (den uppåtlutning du startar med är högre än den vanliga gränsen 72 grader). Det finns ännu ingen finare detalj än ungefär 10 km per ruta (kommer i M07b), så marken nära är mjuka, plattskuggade sluttningar och horisonten och bergskedjorna är bilden; Himalaya ligger på Tibets snöplatå och är därför vitt. **Territoriet** (din färg och gränslinjerna) ritas nu också på chunk-terrängen och har fått finare slingor: en gräns du ser från 5 km upp slingrar sig på flera skalor i stället för att vara en rät linje med räta hörn, och linjen är en jämn kurva ända ned till 1 km. Prova: starta en match (Play, välj ett land, Start), erövra lite mark, zooma sedan ned mot din gräns med hjulet och titta på linjen. Jämför gärna med `#terrain-fixed` (den gamla globen). **Vad du ska titta på:** (1) `#view-alps-valley` och `#view-himalaya-valley`: ren horisont, inga sprickor eller hål i marken, inga ryck när du rör musen. (2) `#chunks` ovanpå (`#view-alps-valley_chunks`): chunkens färger, de små nära dig och stora långt bort. (3) Hjulet ned mot marken i valfri vy, och sedan ut igen. (4) En egen match: din gräns från 100 km och från 5 km upp.

## 6. Det som inte fungerar i en Artifact

18. **Ladda ner-knappar fungerar inte** (nedladdningar från sidan är blockerade). Rapporter visas i stället i en textruta som du kan markera och kopiera. Knappen "Kopiera rapport" fungerar (urklipp går bara efter ett klick).
19. **Onlinespel kräver en riktig webbadress.** WebSocket och anrop till andra servrar är blockerade i en Artifact. Den valfria multiplayerdelen (M26a och framåt) går därför bara att prova lokalt eller på en egen webbplats.
20. Fullskärm (Fullscreen API) finns inte på iPhone.

## 7. Det som fungerar i en Artifact (bevisat av dig, plus våra egna tester)

21. Moduler, modul-Workers från egna filer, relativ `fetch`, `DecompressionStream`, `localStorage` och IndexedDB. Fil-containrar: rå gzip under `.png` (3 MB på cirka 0,5 s), rå under `.wasm`, base64 i `.txt` (ungefär dubbelt så långsamt).

## 8. Lokal körning, steg för steg (Windows och Mac)

Gör det här en gång:

22. Installera **Node.js 22 LTS** från nodejs.org (välj version 22, minst 22.13; i "Downloads" finns äldre versioner under "Previous releases" om sidan föreslår en nyare). Windows: kör .msi-filen. Mac: kör .pkg-filen. Starta om terminalen efteråt.
23. Kontrollera: öppna en terminal (Windows: "Kommandotolken" eller PowerShell; Mac: "Terminal") och skriv `node -v`. Det ska visa `v22.` följt av siffror.
24. Installera **GitHub Desktop** från desktop.github.com och logga in med ditt GitHub-konto.
25. I GitHub Desktop: File, Clone repository, fliken "GitHub.com", välj **Homerun5320/Spel**, välj en mapp på datorn, tryck Clone.
26. Kontrollera att grenen "main" är vald (Current Branch uppe i mitten). Vill du titta på en gren som ännu inte är mergad väljer du den i stället.
27. Öppna en terminal i projektmappen: i GitHub Desktop, Repository, "Open in Command Prompt" (Windows) eller "Open in Terminal" (Mac).
28. Skriv `npm ci` och tryck Enter. Det tar en till två minuter första gången. (Klagar PowerShell på att skript inte får köras: använd Kommandotolken i stället.)
29. Skriv `npm run dev` och tryck Enter. Terminalen visar en rad som `Local: http://localhost:5173/`. Öppna den adressen i webbläsaren. Är porten en annan, använd adressen som terminalen visar.
30. Testsidan finns på `http://localhost:5173/probe.html`. Lägen skrivs som vanliga adressparametrar, till exempel `http://localhost:5173/?test=1`. F3 visar en liten rad med grafikinfo.
31. Stoppa genom att trycka Ctrl+C i terminalen.

Uppdatera till senaste versionen:

32. GitHub Desktop: "Fetch origin", sedan "Pull origin".
33. Har filen `package-lock.json` ändrats (GitHub Desktop visar den bland ändringarna) kör du `npm ci` igen. Annars räcker det att starta om med `npm run dev`.

## 9. Resultat per prövad väg

| Väg | Resultat | Kommentar |
|-----|----------|-----------|
| Artifact: testsida i riktiga vyn (iPhone, Claude-appen) | fungerade | WebGL2 på Apple GPU, 59 FPS, 262 000 trianglar (din körning) |
| Artifact: bygget packat och serverat som en Artifact (sub-mapp, 404 för otillåtna filtyper) i Chromium | fungerade | klotet ritas, noll konsolfel, inga 404; testet är `e2e/artifact.test.ts` |
| Artifact: probe-containrar `.png`, `.wasm`, `.txt` (base64), modul-Worker, hash och search, i Chromium mot lokal server | fungerade | alla tre gav rätt längd och kontrollsumma |
| Artifact: spiken publicerad | publicerad, **ej bekräftad av dig** | länken står i avsnitt 2; du svarar "klotet syns" när du har öppnat den |
| Artifact: probe-tabellen i den riktiga vyn | ej testat | du öppnar probe-sidan och klistrar in tabellen |
| Netlify | EJ MÖJLIG | verktyget `netlify-deploy-services-updater` (operation deploy-site) tar i dag bara ett `siteId`, det finns inget sätt att skicka mappen `dist`; `curl -sI https://api.netlify.com` svarade 403 genom molnets proxy. Ingen sajt skapades och ingen länk utlovas. |
| Lokalt: `npm ci && npm run dev` | fungerade | utvecklingsservern startar och e2e-testerna kör mot den i molnet; probe-sidan laddas i dev |
| Lokalt: guiden på Windows och Mac | ej testat | stegen följer standardflödet men har inte körts på dina datorer |

Alla resultat finns också i `docs/DECISIONS.md`.

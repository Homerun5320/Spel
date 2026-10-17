# Bygg ditt 3D-krigsspel — promptlista

Det här är en lista med färdiga prompter som tar dig från ett tomt repo till ett eget 3D-krigsspel i webbläsaren. Spelet är en glob där berg faktiskt spelar roll: de bromsar arméer, skymmer radar och bestämmer var en helikopter kan flyga lågt genom en dal och släppa av trupper bakom fiendens linjer. Du spelar som ett riktigt land eller som ett eget påhittat land med egen flagga, bygger stad, fabrik, hamn, missilsilo och luftvärn (SAM), och möter AI-motståndare i fyra svårighetsgrader.

**Kort svar:** ungefär 112 timmars Claude-arbete för ett färdigt enspelarspel (36 prompts) och ungefär 21 fullt använda 5-timmarsfönster på Max 20x (rimligt spann 14–50), cirka 4 veckor med ett fönster per vardag. Tre valfria onlineprompts lägger på cirka 10 timmar. Detaljer och osäkerhet: se "Hur lång tid tar det". **Börja här:** M00 och M00b är redan byggda (se Status nedan); fortsätt med M01 (rubriken "Del 1") i en ny session.

**Status (2026-10-13):** M00 (grundverktyg) och M00b (Artifact-förhandsvisning) är redan byggda av Claude och ligger i PR #1 tillsammans med den här listan. Allt är testat och granskat av en oberoende granskare (219 enhetstester, 8 prestandatester och 14 webbläsartester är gröna). Det ger dig tre saker att göra nu: (1) öppna Artifacten https://claude.ai/artifact/H4jqcMBvTMi7udLais5btV och svara "klotet syns" (eller beskriv vad du ser); (2) merga PR #1 enligt stegen under "Så använder du listan"; (3) kör M01 i en ny session. Kör inte M00 och M00b igen. Första mätpunkterna: M00 och M00b tog ungefär 15–20 minuters körtid och cirka 0,3 miljoner tokens var, mot uppskattade 2,1 h och 1,2 h. Två mätpunkter räcker inte för att ändra uppskattningen, men siffrorna är sannolikt försiktiga.

Listan har **39 prompts**: 36 för enspelarspelet (M00 till och med M25b) och 3 valfria för onlinespel (M26a, M26b, M27). De hör till 28 milestones (M00–M27); en milestone med bokstav, till exempel M07a och M07b, är delad i två prompts som körs i ordning. Varje prompt klistrar du in i en ny Claude Code-session i molnet. Efter de flesta steg har du något körbart att titta på. Några steg (M03, M04, M09, M11a, M12a, M12b, M14) är regler och mätningar som Claude bara visar som utdrag i sitt svar; M11b ger en debugsida.

Några ord används genomgående:

- **Milestone** = ett delmål (M00–M27). **Prompt** = ett färdigt textblock du klistrar in i en ny session.
- **Gate** = en kontrollpunkt där du själv måste titta eller lyssna, eftersom Claude inte kan avgöra det i molnet. Det finns 12 gates i enspelarspelet och 1 i onlinedelen.
- **Förhandsvisning** = det sätt du ser spelet på (se "Så ser du spelet").
- **PR** (pull request) = ett förslag på ändringar som Claude lämnar in och du godkänner genom att slå ihop (merga) det.
- **Fackord i texterna:** headless = utan fönster, i molnet; sim = spelets regelmotor; LOD = detaljnivå som ökar när du zoomar in; tier = kvalitetsnivå; brohuvud = område som helikoptertrupper erövrar bakom linjen; CI = automatiska tester; Worker = bakgrundstråd; slice och Skirmish = namn på testscenario och spelläge.

Tiderna i listan är **agenttimmar**: hur länge Claude arbetar. De är inte din egen tid och inte ett mått på usage. Din egen tid per steg är ungefär 10–30 minuter (granska, slå ihop, testa); vid en gate något mer.

## Det här får du, och det här får du inte

- Alla länder startar lika stora, för rättvisans skull. Landet ger namn, flagga, ett hemland där erövring är billigare och några små egenskaper (högst ±10 %). Sverige och Ryssland har alltså samma utgångsläge.
- Hamnar ger inkomst; pyntade handelsfartyg ingår bara om M21 tier 3 hinns med. Du styr inga fartyg och det finns ingen sjöstrid; helikoptrar är sättet att ta sig över vatten.
- Trupper är siffror och färgade områden. Du ser inga enskilda soldater, utom eventuellt några pyntmarscherande figurer vid fronten om M21 tier 3 hinns med.
- Allt är procedurellt: inga bilder, 3D-modeller eller ljudfiler. Terrängen är riktig men stiliserad och ärligt märkt så.

## Det här behöver du

1. Ett Claude-konto med en plan som ger Claude Code på webben, och repot Homerun5320/Spel kopplat. Ser du inte repot i listan: Claude-appen, Inställningar, Connectors/GitHub, installera Claude-appen på repot Homerun5320/Spel. Nätverksfrågor tas upp av M00.
2. En dator med mus, tangentbord och en vanlig webbläsare (Chrome, Edge eller Firefox) för alla gates, helst med riktigt grafikkort. Spelet styrs mest med mus och tangenter (till exempel 1–6, F, E, H, mellanslag). Telefon och surfplatta räcker för att titta och köra tester, men gates och styrning kräver mus och tangentbord; tvåfingerskamera från M08, touch-layout från M20b.
3. Ett GitHub-konto där du kan trycka "Merge".
4. Tålamod: spelet är ofärdigt på vägen (se "Ärliga förbehåll").
5. Så startar du en session: öppna Claude-appen, välj Code, tryck Ny session, välj repot Homerun5320/Spel och basgrenen main, klistra in prompten och skicka. Sessionen är klar när Claude skriver ett svar som slutar med en länk till en PR (draft).
6. Valfritt: spara den här listan som `PROMPTLISTA.md` i repots rot. På github.com/Homerun5320/Spel: Add file, Upload files, dra in PROMPTLISTA.md, Commit directly to main. Gör det före M00. Det är helt valfritt; prompterna fungerar utan, och sessionerna är instruerade att inte läsa filen.

## Så använder du listan

1. **En prompt = en NY session.** Starta en helt ny Claude Code-session i molnet mot repot Homerun5320/Spel för varje prompt och klistra in hela kodblocket under "Klistra in i en ny session". Sessionen ser repot (men är instruerad att inte läsa PROMPTLISTA.md) och din prompt, inte den här listan. Varje prompt börjar med en förkontroll och stoppar om det som står under Kräver inte är mergat.
2. **Slå ihop (merga) innan du går vidare.** Claude pushar till en egen gren och öppnar en PR som är markerad Draft (utkast). Ett utkast kan inte slås ihop. Skriv i SAMMA session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main." Eller gör det själv på GitHub: öppna PR-länken i Claudes svar, tryck Ready for review, vänta på den gröna bocken (CI = automatiska tester; de startar först när PR:en är markerad redo), tryck Squash and merge och sedan Confirm. Kan Claude inte merga (saknar behörighet) gör du det själv. Vägrar GitHub utkast-PR (privat repo på gratisplan) öppnar Claude en vanlig PR och säger det på första raden i svaret; hoppa då över Ready for review och gå direkt till Squash and merge (CI körs ändå). Starta nästa prompt först när det är gjort.
   **2b. Går något fel.** Blir bocken röd, eller säger Claude att något misslyckades: skriv i SAMMA session "Läs felloggen från CI, rätta det som är rött och pusha igen". Är sessionen slut: starta en ny session med mallen Buggrapport och skriv PR-numret. Visar GitHub en mergekonflikt: skriv "Lös mergekonflikten med main" i en session på den grenen. Merga aldrig en röd PR.
3. **Gå uppifrån och ner.** Följ ordningen; prompterna bygger på varandra och raden Kräver i tabellen överst i varje prompt visar vad som måste vara mergat. Undantag: M26a, M26b och M27 är valfria och körs bara efter M25b. Vad som annars kan hoppas över står i Kapa-listan.
4. **Gates.** Ja = du måste titta/lyssna själv. Skicka alltid de siffror gaten ber om (perf-JSON och FPS i M02, M05, M08, M24a). Annars räcker det att svara "ok". Feedback-mallen använder du bara när något är fel. Nej = du får gärna titta men behöver inte rapportera. Ordning vid en gate: merga PR:en, testa, svara "ok" eller skicka feedback i en NY session med mallen "Feedback efter en gate" (under Mallar i den här listan), merga fix-PR:en, gå vidare (M00b är undantaget: där svarar du "klotet syns" i samma session innan du mergar). Små saker (P3 = smakfrågor och sånt som kan vänta) behöver inte blockera. Renderersträng = texten som visar vilket grafikkort webbläsaren använder (syns i F3-överlägget, eller i rapporten du kopierar från Dev-panelen; på laptop kan F-tangenterna kräva att du håller ned Fn); FPS = bildrutor per sekund.
5. **Om en session avbryts mitt i** (usage-gräns, timeout, full kontext): starta en NY session och klistra in mallen "Återuppta en avbruten session" och, direkt under den, SAMMA prompt som avbröts. Den nya sessionen börjar på en ny gren och har inte det ocommittade arbetet; mallen hämtar det som Claude hunnit pusha.
6. **Modellval.** Välj modell i modellväljaren innan du skickar första meddelandet: Sonnet 5.5 som standard, Opus 5.5 bara för M07a, M07b, M11a, M11b, M12a och M12b (och svår felsökning). Har din app en inställning för tankenivå (effort) använder du Medium för Sonnet och Hög för Opus; saknas den, strunta i det. Går en session snett: starta en ny i stället för att rätta mer än två gånger.
7. **Kör aldrig två sessioner samtidigt.** Parallella sessioner äter usage snabbare och ger konflikter eftersom alla ändrar samma filer (PROGRESS.md, rules.ts, package.json).
8. **Håll varje session fokuserad.** Be inte om extra saker ("passa på att…"). Be i stället Claude lägga idén i docs/BACKLOG.md.
9. **Usage-rad.** Om din app visar användning (kommandot /usage finns kanske inte i molnsessioner; annars claude.ai → Inställningar → Användning), skriv en rad före prompten: `Usage efter M05: 5h 40 %, vecka 12 %`. Claude för in den i docs/PROGRESS.md. Du kan stapla flera sådana rader (Usage, Hoppat över, Endast tier 1–2, Kapa djupet) i valfri ordning; de gäller så länge de står före texten "Du bygger milestone". Kan du inte läsa av siffrorna: hoppa över. Siffrorna efter M00 och M01 visar hur många milestones som ryms per 5-timmarsfönster.
10. **Om en server är blockerad.** Säger M00 eller M01 att ett nätverksanrop nekas: skriv "Läs miljödokumentationen om nätverk och berätta exakt vad jag ska ändra i miljöinställningarna". Du ändrar nätverksåtkomsten för miljön i inställningarna för Claude Code i molnet (tillåt de nämnda värdarna eller välj bredare åtkomst). Ändringen gäller bara NYA sessioner; starta därför om prompten i en ny session.
11. **Fler mallar.** Använd Buggrapport när något är trasigt. Kör Hälsokoll (en kort städ-session) efter M10, M19 och M24b. Feedback efter en gate använder du efter varje gate.

## Ärliga förbehåll

- **Claude kan titta på mjukvarurenderade skärmdumpar och se tydliga fel**, men kan inte avgöra om det ser bra ut eller går snabbt på riktig GPU, kan inte höra ljud och inte känna styrning. Därför finns gates där du tittar och lyssnar; det är där smaken avgörs.
- **Skärmdumparna är mjukvarurenderade** (SwiftShader). De bevisar att något ritas rätt, inte att det är snyggt eller snabbt.
- **Prestanda på riktig GPU är okänd** tills du kör Dev-panelen (F2) eller `?perf=1` (Artifact: `#perf`) vid gaterna. Budgetar mäts i trianglar och draw calls, inte millisekunder.
- **Det du spelar under vägen är ofärdigt.** Texterna finns på svenska och engelska från M05, men spelet är tyst tills M22, har ingen tutorial förrän M23b och ingen sparfunktion förrän M24b. Därför ger Claude dig en kort "Så spelar du"-lista med styrningen efter varje prompt du kan spela.
- **Balanssiffrorna är otestade startvärden** tills M19. Helikoptrar och kärnvapen kan vara för starka eller för svaga.
- **Riktiga landsgränser är politiskt känsliga och datan är stiliserad.** Små stater försvinner i upplösningen, omstridda områden får neutrala namn, och det finns ett läge utan riktiga gränser.
- **Usage-gränser är osäkra.** Anthropic publicerar inga exakta siffror per plan, och veckogränsen kan slå till före 5-timmarsfönstren. Pro-plan räcker troligen inte hela vägen.
- **Planen kommer att vara fel på vissa ställen.** Uppskattningarna kan avvika med en faktor 2 åt vardera hållet; osäkrast är M02, M07a–M07b och M11a–M13b. Använd Kapa-listan i stället för att tvinga igenom allt.
- **Vissa sessioner kan kräva Opus.** M07a, M07b, M11a, M11b, M12a och M12b är utpekade, och hårdnackade renderingsbuggar kan också kräva det.

## Så ser du spelet

Repot Homerun5320/Spel är **privat**, och GitHub Pages kräver betalplan för privata repon. Listan kan därför inte lova att en GitHub-länk fungerar. Du har bett om att få testa spelet i en **Claude Artifact**, och därför är det första väg. Efter M00 (grundverktyg) tar M00b, en kort egen prompt och en gate, reda på vad som fungerar i din miljö och skriver ner det i `docs/PREVIEW.md` (på svenska, med numrerade steg). Före M00b finns ingen förhandsvisning. Vägarna prövas i ordning:

- **(a) Claude Artifact (förstahandsval):** spelet publiceras som en Artifact med flera filer. Den är privat: bara du kan öppna länken tills du själv delar den. Claude uppdaterar samma Artifact efter varje milestone som ändrar något du kan se (rena regelmilestones som M03, M04, M09, M11a, M12a, M12b och M14 publicerar inte om). Verktygets regler formar bygget, och M00b avgör och dokumenterar detaljerna: sidan publiceras som ett fragment; vissa filtyper (till exempel `.bin` och `.gz`) accepteras inte, så spelets datapack läggs i en tillåten behållare; adressparametrar som `?perf=1` når inte sidan, så du lägger i stället `#perf` sist i länken eller använder Dev-panelen; Ladda ner-knappar fungerar inte; och onlinespel (M26a–M27) går inte att provspela i en Artifact eftersom anrop till andra servrar är blockerade.
- **(b) Netlify** via Netlify-kopplingen, om den är ansluten: en statisk sajt som deployas om efter varje milestone. OBS: en Netlify-sajt kan öppnas av alla som har länken, även om repot är privat; Claude frågar dig innan den skapas. Gratisplanen är kreditbaserad. Det kan visa sig omöjligt att göra detta från en molnsession (verktyget kanske inte kan ta emot själva bygget); då säger M00b det rakt ut och lovar ingen länk.
- **(c) Lokalt:** du kör `npm ci` och `npm run dev` på din egen dator och öppnar adressen som terminalen visar. Du behöver då Node 22; PREVIEW.md får steg för Windows och Mac.

**Testat och bekräftat:** en testsida körde på din iPhone i Claude-appen: WebGL2 på Apple GPU, 59 bildrutor per sekund med 262 000 trianglar, filhämtning, Worker och lagring fungerar, och rå binärdata under filändelsen `.png` är den snabbaste behållaren för spelets världsdata. Det som återstår att bevisa är själva spelbygget (M00b). Testsidan finns kvar: https://claude.ai/artifact/Sak7LBsMhaEcSK53vShwEr

M00b avgör vilken väg som blir din, och du bekräftar att du ser klotet. M01 kräver att M00b är klar. Några gates ber dig slå på lägen som `?perf=1` (i en Artifact skriver du `#perf` sist i länken). Från M02 finns en Dev-panel (tangent F2 och en liten knapp i ett hörn av skärmen) med knappar för alla sådana lägen, så du slipper redigera adressen. Alla "Kopiera rapport"-knappar visar rapporten i en markerbar textruta (nedladdningsknappen kan vara overksam i en Artifact). Delningsbar länk: Netlify = alla med länken; Artifact = bara om du själv delar det; lokalt = ingen. M25a förklarar vad som gäller för din väg.

## Översikt

| ID | Titel | Du ser efteråt | Insats (h, trolig) | Gate |
|---|---|---|---:|---|
| M00 | Grundverktyg, arbetsavtal och WebGL-bevis | Verktyg och arbetsregler på plats; klotet du kan titta på kommer först i M00b. | 2,1 | Nej |
| M00b | Förhandsvisning: hitta en väg där du kan se spelet | Du får en Artifact-länk (eller en lokal guide) där ett roterande klot syns, plus en svensk förhandsvisningsguide. | 1,2 | Ja |
| M01 | Baka riktiga världen: terräng, länder, städer, hamnar | En debugsida som visar jorden som klass-, höjd- och landkarta med kontinenter du känner igen. | 3,6 | Nej |
| M02 | Wow 1: den stiliserade 3D-jorden | En snurrbar, solbelyst 3D-jord med riktiga berg, hav, atmosfär och nattljus; hovra för att se land och höjd. | 5,3 | Ja |
| M03 | Sim-grund: determinism, intents, host-söm | Inget visuellt: Claude visar att simuleringen ger exakt samma kontrollsumma (hash) i Node och webbläsare. | 2,5 | Nej |
| M04 | Territorie-sim: trupper, guld, terrängmedveten erövring | Inget visuellt än: en loggutskrift i Claudes svar över en 10-minuters världserövring. | 3,6 | Nej |
| M05 | Wow 2: första spelbara erövringen på globen | Du klickar på globen och din färg flyter över land mot AI-nationer och stamfolk, långsammare i bergen. | 4,9 | Ja |
| M06 | Meny: riktigt land eller eget land | Startskärm: sök ett riktigt land (Sverige/Sweden) eller skapa ett eget med flagga, välj region och motståndare. | 3,4 | Nej |
| M07a | Terräng-LOD A: quadtree-chunks och geometri | Terrängen ritas i bitar som blir finare ju närmare du kommer, utan sprickor; din gräns löper över den. | 2,7 | Nej |
| M07b | Terräng-LOD B: detaljer, snö, skog och strand | Zooma ner i en bergsdal med åsar, snö, skog och strand medan din gräns löper över terrängen. | 2,7 | Nej |
| M08 | RTS-kamera, markpicking och prestandascen | Mjuk RTS-kamera från planetvy ner i en dal, exakta klick på marken och en scen som mäter bildhastigheten. | 4,1 | Ja |
| M09 | Byggnader i simen: stad, fabrik, hamn, silo, SAM och försvarspost | Inget nytt på skärmen; AI-nationerna bygger städer och fabriker och blir rikare (mätresultat i Claudes svar). | 3,4 | Nej |
| M10 | Byggnadsmodeller, byggfält och markering | Du bygger stad, fabrik, hamn, silo, SAM och försvarspost på 3D-terrängen och ser ekonomin växa. | 4,1 | Nej |
| M11a | Bergmedveten radar: täckningsfält och exponering (headless) | Inget i webbläsaren; Claude visar mätningar av hur berg döljer radar (debugsidan kommer i M11b). | 2,7 | Nej |
| M11b | Luftnavigering: rutter, landningsplatser och debugsida (headless) | Debugsida: klicka ut en SAM och se täckningen med hål bakom bergen, samt en rutt som kryper längs dalar. | 2,7 | Nej |
| M12a | Helikoptrar i simen: enheter, flygning och landning | Inget i webbläsaren; helikopterns regler (flyga, landa, ta mark) bevisas i tester. | 2,3 | Nej |
| M12b | Luftvärn mot helikoptrar och räd-statistik i simen | Claude visar en textreplay: en helikopter landsätter trupper över en bergskedja, en annan skjuts ner av SAM. | 1,8 | Nej |
| M13a | Wow 3a: helikoptern på skärmen — modell, effekter och kamera | Helikoptrar med snurrande rotor på 3D-terrängen, damm och skuggor, medåkningskamera (H) och ?scenario=slice. | 3,4 | Nej |
| M13b | Wow 3b: deploy-läge, landningsvisning och exponeringsvy | Huvudfunktionen: flyg en helikopter genom en dal, se SAM:ens döda vinklar och landsätt trupper bakom fronten. | 3,4 | Ja |
| M14 | Missiler, nukes och SAM-avskjutning i simen | Inget nytt på skärmen; missiler, nukes och SAM-avskjutning bevisas i tester. | 4,1 | Nej |
| M15a | Missil- och nukeeffekter: partiklar, bågar och efterbehandling | En effektscen (Dev-panel F2): missil som bågnar över planeten, SAM-försök, chockvåg, svampmoln och nedfall. | 3,2 | Nej |
| M15b | Målläge för nukes: siktesringar, hotpil och kommandon | Välj en silo, sikta med ringar för sprängradie och SAM-hot, skjut, och se en kantpil mot inkommande missiler. | 1,8 | Ja |
| M16 | AI-regissör v1: ekonomi, expansion, aggression, svårighetsgrader | Motståndare som bygger, expanderar och anfaller i olika stilar, från Easy till Impossible. | 4,5 | Nej |
| M17 | AI-specialiteter: luftlandsättning, nukes och luftvärn | En Hard-AI som överraskar med helikopterlandning bakom din linje eller nuke mot huvudstaden, och bygger SAM som svar. | 3,4 | Nej |
| M18 | Matchflöde: vinstvillkor, anti-snowball, resultat | Matcher som slutar med seger- eller förlustskärm, pausmeny och en skenande ledare som AI:erna går ihop mot. | 3,2 | Nej |
| M19 | Balansverktyg och justeringspass | Bättre tempo: luftlandsättningar runt minut 8–12, nukes senare, ingen dominant öppning, plus en balansrapport. | 3,8 | Nej |
| M20a | HUD, hotkeys och kommandon | Riktigt HUD: topprad, topplista, nationsetiketter, frontpilar, ?-hjälp med alla genvägar och högerklickskommandon. | 2,6 | Nej |
| M20b | Minimap, larm, taktisk vy och touch | Minimap, larm med kantindikatorer, en platt taktisk vy och grundläggande touch; här spelar du en hel match. | 2,1 | Ja |
| M21 | Visuell finish och liv i världen | Nattstäder, kustskum, krusningar vid erövring och filmisk fly-in; handelsfartyg och mer pynt om tiden räcker. | 5,5 | Ja |
| M22 | Procedurellt ljud | Rotorpuls, missilljud, SAM-vissling, explosioner och ambient musik som spänns upp vid fara. | 4,1 | Ja |
| M23a | Svenska, inställningar, krediter och hjälp | Svenska/engelska i menyn, inställningssida, kreditskärm och en hjälpsida om terrängens betydelse. | 2,3 | Nej |
| M23b | Tutorial | En guidad tutorial i sex steg som slutar med din första helikopterlandsättning; kan hoppas över. | 1,6 | Nej |
| M24a | Prestanda: Worker-sim, kvalitetsnivåer och perf-rapport | Jämnare spel, automatisk kvalitetsnivå (Auto/Låg/Medel/Hög) och en kopierbar prestandarapport. | 3,9 | Ja |
| M24b | Spara/ladda och webbläsartester | Fortsätt-knapp som återupptar matchen, export/import av sparfiler och automatiska tester i flera webbläsare. | 3,1 | Ja |
| M25a | Release-förberedelse: bygge, budgetar, deploy och README | Produktionsbygge enligt din förhandsvisningsväg, felskärmar och README; Claude berättar vem som kan öppna spelet. | 1,4 | Nej |
| M25b | Granskning och v1.0 | Granskat v1.0 med granskningsrapport; du spelar en hel match innan versionen märks som klar. | 1,2 | Ja |
| M26a | VALFRITT: multiplayer-grund — transport, relä och headless-server | Inget att spela än: onlinegrunden (transport, relä, server-sim) bevisas i tester. | 3,2 | Nej |
| M26b | VALFRITT: multiplayer — lobby och AI på servern | En lobbyskärm som bara fungerar mot ett relä; du har inget att prova förrän M27. | 2,1 | Nej |
| M27 | VALFRITT: resync, återanslutning, AI-övertag och serverdeploy | Vänner hoppar in och ut ur en match och en frånkopplad spelare ersätts av AI; du deployar servern själv. | 4,7 | Ja |

Naturliga stopp, med ackumulerad trolig insats (agenttimmar, och 5-timmarsfönster på Max 20x):

- **Se visionen:** efter M02 (~12,2 h, ~2 fönster) har du en snurrbar 3D-jord med berg. Ingen spelbarhet än.
- **Spelbar erövring:** efter M05 (~23,2 h, ~4 fönster) klickar du på globen och erövrar land mot AI och stammar.
- **Landval och byggande:** efter M10 (~43,6 h, ~8 fönster) har du landval, 3D-terräng i närbild och alla byggnader. Bra läge för en Hälsokoll.
- **Helikopterfunktionen:** efter M13b (~59,9 h, ~11 fönster) flyger du helikopter genom bergsdalar och släpper trupper. Det är spelets signaturfunktion.
- **Kärnvapen:** efter M15b (~69 h, ~13 fönster) kan du sikta och skjuta kärnvapen med effekter. AI-motståndarna är ännu enkla.
- **Ett funktionellt komplett enspelarspel:** efter M20b (~88,6 h, ~17 fönster) finns smart AI, matchflöde, balansering och ett riktigt gränssnitt. Ljud, tutorial och sparfunktion återstår.
- **v1.0:** efter M25b (~111,7 h, ~21 fönster) är spelet polerat med svenska, ljud, tutorial och spara/ladda. Delningsbar länk: Netlify = alla med länken; Artifact = bara om du själv delar det; lokalt = ingen.
- **Valfritt, onlinespel:** efter M27 (~121,7 h, ~23 fönster) kan du spela mot en vän över nätet.

## Hur lång tid tar det — och hur många maxade 5-timmarsfönster?

**Kort svar:** räkna med **ungefär 112 timmars Claude-arbete** för ett färdigt enspelarspel (v1.0, 36 prompts) och **ungefär 21 fullt använda 5-timmarsfönster på Max 20x** (rimligt spann 14–50). Det blir **cirka 4 veckor** om du kör ett fönster per vardag (spann 3–10 veckor; två fönster per dag halverar ungefär tiden om veckogränsen tillåter det). Valfritt onlinespel (3 prompts) lägger på cirka 10 timmar och cirka 2 fönster.

Så här är siffrorna framtagna: tre oberoende genomgångar räknade på listans utkast (före uppdelningen av de tunga promptsen i a/b-delar; timmarna är därefter fördelade på delarna) med olika metoder (uppifrån-och-ner per prompt, jämförelse med publicerade erfarenheter, och en "varför blev vi försenade"-analys med Monte Carlo). Tabellen visar **medianen** av deras optimistiska, troliga och pessimistiska värden. Det allra första, grova överslaget var klart för lågt: alla tre metoderna landade högre.

| | Optimistiskt | **Troligt** | Pessimistiskt |
|---|---|---|---|
| Claude-arbete, v1.0 (M00–M25b) | ~68 h | **~112 h** | ~194 h |
| Tillägg: valfritt online (M26a–M27) | +6 h | **+10 h** | +17 h |
| Maxade 5h-fönster, **Max 20x** | ~14 | **~21** | ~50 |
| Maxade 5h-fönster, Max 5x | ~18 | **~50** | ~200 |
| Maxade 5h-fönster, Pro | hundratals | **hundratals** | — (inte realistiskt) |
| Kalendertid vid ett fönster per vardag | ~3 v | **~4 v** | ~10 v |

**Vad "maxat 5-timmarsfönster" betyder här:** ett löpande 5-timmarsfönster där du förbrukar hela din kvot (du slår i taket). Det är ett mått på *förbrukning*, inte på att Claude arbetar i fem klocktimmar.

### Så ska du läsa siffrorna (ärligt)

- **Fönstersiffran är den osäkraste.** Anthropic publicerar inga exakta kvoter per plan. De tre metodernas troliga värden var 7, 21 och 42 fönster på Max 20x, så spridningen är en faktor sex (tabellens optimistiska 14 är medianen av de tre optimistiska värdena). Medianen 21 är en bra planeringssiffra, men räkna med att verkligheten kan hamna var som helst mellan 14 och 50.
- **Första mätpunkter (M00 och M00b är byggda):** körtid ca 15–20 minuter och cirka 0,3 miljoner tokens per milestone, mot uppskattade 2,1 h och 1,2 h. Två mätpunkter räcker inte för att ändra siffrorna, men tyder på att Claude-timmarna är försiktiga. Räkna om efter M01 och M02.
- **Du kalibrerar själv redan efter M00–M01.** Efter de första prompterna har Claude arbetat cirka 7 timmar (enligt kalkylen cirka 1,3 fönster). Skriv in din användningsprocent (se "Så använder du listan") och jämför: ligger du under planen tar resten färre fönster, ligger du över bör du räkna om och kapa tidigare.
- **Veckogränsen kan bita före 5-timmarsgränsen.** Planerar du många fönster per vecka är det den som troligast sätter takten (därför ~3 / ~4 / ~10 veckor i tabellen).
- **Max 5x och Pro:** på Max 5x räknar du med cirka 2–4 gånger så många fönster som på Max 20x (tabellens ~50 är en grov gissning), och på Pro är det i praktiken inte genomförbart att nå hela vägen. Välj då tidigare stopp (se "Naturliga stopp").
- **Dina egna timmar är något annat än Claudes timmar.** Räkna med 10–30 minuter per prompt för att starta, granska, merga och testa, och längre vid gates.
- **Tunga prompts kostar mer:** M07a, M07b och M11a–M12b körs på Opus och drar fönster snabbare än resten (M08–M10 körs på Sonnet). Kör aldrig två sessioner parallellt — det bränner kvoten fortare och ger mergekonflikter.
- **Det mesta av osäkerheten ligger i det du inte kan se i förväg:** hur många varv det tar att få skuggor, terräng-LOD och kamera att se bra ut när Claude bara kan titta på mjukvarurenderade skärmdumpar (M02, M07a–M08, M11a–M13b), och hur mycket balansjustering som behövs (M19).

## Kapa-listan

Om tid eller usage tar slut, kapa hela prompts i denna ordning:

1. M26a, M26b och M27 (onlinespel; spelet är komplett utan dem).
2. Tier 3 i M21. M21 är indelad i tier 1–3; Claude loggar ogjort tier-3-arbete i docs/BACKLOG.md om tiden tar slut. Vill du stoppa direkt, skriv "Endast tier 1–2" som rad före prompten.
3. M20b (minimap, larm, taktisk vy, touch). Hjälpöverlägget "?" från M20a är då den minsta introduktionen. Touch och minimap saknas då. Spela ändå en match mot Medium och en mot Hard efter M20a och rapportera med mallen Feedback efter en gate.
4. M23b (tutorial). Kapa den sist av alla: ett spel med helikoptrar, kärnvapen och många tangenter behöver en introduktion.
5. Djupet i M19 (balansering): skriv "Kapa djupet: högst ett justeringspass" som rad före prompten.

Hoppar du över M20b skriver du `Hoppat över: M20b` som rad före prompten i M21, M22 och M23a (M21 och M23a kräver M20b; M22 använder larmnivån från M20b och skriver annars en minimal ersättning). Claude noterar det i docs/PROGRESS.md under Skipped, och M22 och M23a läser det även därifrån. Ingen annan prompt kräver M23b eller onlinedelen, så där behövs ingen rad. Raderna (Usage, Hoppat över, Endast tier 1–2, Kapa djupet) kan stå staplade i valfri ordning, så länge de står före texten "Du bygger milestone".

Kapa **aldrig** M11a–M13b (helikopter-mekaniken, spelets signatur), M18 (spelet behöver ett slut), M21 som helhet, M22, M23a eller verify-systemet. M24a kräver M21, M22 och M23a.

## Börja här

M00 och M00b är redan byggda (se Status överst). Gå till **M01** (efter referensavsnitten nedan) och klistra in prompten i en ny session, sedan M02 och så vidare i ordning. Referensavsnitten Beslut, Ingår inte och Mallar behöver du först senare.

## Referens: beslut som redan är tagna

Standardvägar är redan valda åt dig. Du kan **överrösta vilket som helst**; säg det till Claude i början av en ny session, innan prompten.

| Beslut | Val | Alternativ | Ompröva när |
|---|---|---|---|
| Renderingsmotor | three.js 0.186.1 med WebGLRenderer och handskrivna GLSL-shaders, paketerat med Vite | Babylon.js, PlayCanvas, CesiumJS, three WebGPURenderer/TSL | WebGPU är standard överallt och fungerar i molnets Chromium |
| Världsmodell | Glob från ett lat/lon-rutnät, kostnader i km (`cellKm(lat)`) | Platt 3D-diorama, kubsfär/ikosfär | Spel nära polerna känns orättvist och viktningen räcker inte |
| Simupplösning | 1024x512 sim-rutnät (ca 39 km/ruta), 4096x2048 för rendering | 512x256 (snabbare, men bergspass blir mindre än en ruta), 2048x1024 | Bergens radarskuggor stämmer dåligt med verkligheten (mäts i M11a) eller simen blir för långsam |
| Uppdelning av prompts | 39 prompts; tio tunga milestones är delade i a/b så att varje session hinner klart, och förhandsvisningen har fått en egen kort prompt (M00b) | Färre, större prompts | En session hinner regelbundet inte klart: dela fler |
| Multiplayer | Enspelare mot AI i v1.0; valfri lockstep i M26a, M26b och M27 | Ingen multiplayer; server-auktoritativ; Colyseus/PartyKit | Efter M25b om du vill spela med vänner |
| Allianser, chatt, diplomati | Bortvalt i v1 (AI går ihop mot den som leder över 40 %) | Fyraminuterspakter, förrädarmärkning, embargo (ca +2 h) | Efter M19 om matcherna blir för mycket allas krig mot alla |
| Sjökrig | Hamnar ger inkomst och handel med pyntade fartyg; helikoptrar korsar vatten | Transportbåtar och krigsfartyg | Efter v1.0 om öbanor känns för helikopterberoende |
| Markstrid | Abstrakt territorieflöde, pyntade soldater vid fronten | Enskilda soldater och fordon | Aldrig för v1 |
| Rättvisa mellan riktiga länder | Lika startkärna för alla plus 0,5x erövringskostnad på resten av det egna landet; små egenskaper max ±10 % | Äg hela landet från start; bara egna nationer | M19 visar att landvalet avgör matcherna (över 60 % skillnad) |
| Terrängtrohet | Riktig relief bakad i låg upplösning plus procedurellt brus nära; ärligt märkt "stiliserad" | Regionala högupplösta tiles; valfritt 8192x4096-paket | Provspel visar att verkliga dalar spelar större roll än nedladdningsstorlek |
| Förhandsvisning och hosting | Privat repo, så GitHub Pages förutsätts inte. M00b väljer i den här ordningen: Claude Artifact (ditt önskemål), annars Netlify, annars lokalt (se "Så ser du spelet"). Valfritt relä: Fly.io | Cloudflare Pages, Hetzner, GitHub Pages om repot görs publikt | Du gör repot publikt, trafiken växer eller multiplayer ska bli publik. Kolla alltid aktuella priser |
| Språk | Claude svarar på svenska; kod, kommentarer och docs på engelska (förhandsvisningsguiden, serverguiden och README på svenska). Spelets UI på svenska och engelska från M05, kompletterat och verifierat i M23a | Engelska överallt | Fler utvecklare ansluter eller du vill annat |
| Gates | 13 stycken: M00b, M02, M05, M08, M13b, M15b, M20b, M21, M22, M24a, M24b, M25b, M27. M20b är en hel spelad match mot Medium och en mot Hard | Fler eller färre | Du vill granska oftare |
| Verktygsversioner | TypeScript 6.0.2, Vite 8.3.4, Vitest 5.0.4, playwright-core 1.56.x, exakta pins (M00 kontrollerar dem på nytt) | TypeScript 7.0.2, monorepo, Playwright 1.64 | Först i en egen uppgraderingssession efter v1.0, aldrig mitt i en milestone |
| Modell per session | Sonnet 5.5; Opus 5.5 bara för M07a/b, M11a/b, M12a/b och svår felsökning; en session i taget | Opus för allt; parallella sessioner | Efter usage-kalibreringen i M00–M01 om fönstren visar sig billiga |
| Var simen körs | Huvudtråden bakom ett worker-redo gränssnitt till M24a, sedan Web Worker | Worker från början; server-auktoritativt | Tick-tiden blir för lång på din dator tidigare |

**Så ändrar du ett beslut.** Skriv till Claude, helst i början av sessionen, till exempel: *"Ändra beslutet om hosting: jag har gjort repot publikt, så använd GitHub Pages i stället för Artifact. Uppdatera docs/DECISIONS.md och docs/PREVIEW.md."* Eller: *"Jag vill ha allianser i v1. Lägg det som en egen milestone i docs/BACKLOG.md och säg vad det kostar i timmar innan du gör något."* Claude noterar ändringen i docs/DECISIONS.md så att senare sessioner känner till den.

## Referens: ingår inte i v1

- Inga WebGPU/TSL, Cesium, Babylon eller PlayCanvas. Ingen streamad satellitdata: höjder är bakade och närdetaljen är stiliserat procedurellt brus (sägs ärligt i krediterna).
- Inget är kopierat från OpenFront.io eller något annat spel: ingen kod, inga namn, kartor eller tillgångar. Genren är bara inspiration.
- Inga konstfiler: inga bilder, 3D-modeller, texturer, ljudfiler eller typsnittsfiler. Allt är procedurellt, utom bakad höjd- och landdata.
- Inga allianser, pakter, embargo, chatt eller emojis. Inga repriser eller kartredigerare (de hamnar i BACKLOG.md).
- Inga krigsfartyg, sjöstrid, transportbåtar, tåg, MIRV, dimma över slagfältet (fog of war), väder, förstörbar terräng, fysikmotor eller enskilda markförband.
- Ingen sfärisk simulering; Antarktis och yttersta Arktis är inte spelbara. Ingen platt 2D-kartvy förutom minimap och taktisk vy.
- Inga konton, matchmaking, ledartavlor eller telemetri. Onlinespel (M26a–M27) går bara via delad rumslänk, och en riktig match med en vän kräver M27. Onlinespel kan inte provspelas i en Artifact (den blockerar anrop till andra servrar); klienten måste ligga på en riktig webbadress.
- Ingen full mobilpolering; touch fungerar i bästa mån. Inga garantier för prestanda på riktig GPU från molnsessionerna.

Efter v1: allianser, sjökrig, repriser, kartredigerare, regionala högupplösta tiles, WebGPU-uppgradering. Allt sådant läggs som egna milestones.

## Mallar

Mallarna klistrar du in i en NY session, precis som en milestone-prompt. Fyll i hakparenteserna.

### Återuppta en avbruten session

Klistra in mallen och direkt under den SAMMA milestone-prompt som avbröts (den innehåller GÖR och ACCEPTANS som mallen behöver).

```text
Du återupptar en avbruten session i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

Milestone som var igång: [FYLL I, t.ex. M07a, eller skriv "vet inte"].

Under den här texten har jag klistrat in den ORIGINELLA milestone-prompten. Använd dess GÖR och ACCEPTANS som checklista.

1. Saknas CLAUDE.md eller docs/CHARTER.md var det M00 som avbröts. Leta först efter en gammal M00-gren (`git branch -r`). Finns den: hämta den enligt steg 2 och fortsätt M00-prompten vid första ofärdiga punkten. Finns ingen: kör M00-prompten från början.
2. Du står på en NY gren från main och har inte den avbrutna sessionens ocommittade arbete. Hitta den avbrutna milestonens öppna draft-PR eller gren (GitHub-verktygen, eller `git branch -r` och `git log origin/<gren>`). Kör `git fetch origin <gammal-gren>` och `git merge --ff-only FETCH_HEAD`. Går det inte (main har gått framåt): kör `git merge --no-edit FETCH_HEAD`; använd `git reset --hard FETCH_HEAD` bara om `git merge-base --is-ancestor origin/main FETCH_HEAD` är sant. Pusha till din egen tilldelade gren, öppna en NY draft-PR med texten "Ersätter #N" och be mig stänga #N. Finns ingen gammal gren eller PR, börja om från prompten nedanför.
3. Läs CLAUDE.md, docs/CHARTER.md, Now och Next i docs/PROGRESS.md samt docs/ARCHITECTURE.md. Kör `npm ci && npm run verify:fast` och rapportera kort vad som är grönt eller rött.
4. Sammanfatta i fem rader vad som är klart och vad som återstår. Bocka av GÖR och ACCEPTANS som checklista under Now i docs/PROGRESS.md och fortsätt vid första ofärdiga punkten. Gör INTE om arbete som redan är klart och grönt.
5. Fortsätt och avsluta enligt CLAUDE.md och prompten nedanför: uppdatera PROGRESS.md, öppna draft-PR:en och svara på svenska med vad som gjorts och exakt vad jag ska testa.
```

### Feedback efter en gate

Använd den här mallen i en NY session efter att du testat. Merga milestonens PR först. Är allt bra behöver du ingen feedback.

```text
Du ska hantera min feedback efter en gate i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

Milestone jag testade: [t.ex. M05]
Hur jag körde det (förhandsvisningsväg enligt docs/PREVIEW.md, webbläsare, dator/telefon, grafikkort om jag vet): [FYLL I]

Hur det kändes (styrning, tempo, kamera, läsbarhet, ljud):
[FYLL I]

Bildfel och visuella problem (var i världen, vilken zoomnivå, vad såg fel ut):
[FYLL I, gärna med skärmdump]

Prestanda: jag körde Dev-panelen (F2) eller `?perf=1` (Artifact: `#perf`) och/eller perf-scenen (om milestonen har en). Klistra in rapporten (JSON) här:
[KLISTRA IN JSON]
Uppskattad FPS med mina ord: [FYLL I]

Instruktioner till Claude:
1. Läs CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md och docs/BACKLOG.md. Kontrollera att milestonen är mergad i main.
2. Omvandla min feedback till en prioriterad lista: P1 = blockerar spel eller ger fel/krasch, P2 = tydligt störande, P3 = smakfrågor/senare. Visa listan.
3. Ställ högst 3 frågor, och bara om svaren ändrar vad du gör. Annars: gör rimliga antaganden och skriv dem i docs/DECISIONS.md.
4. Åtgärda P1 och P2 inom ett litet område. Inga nya funktioner och ingen refaktorering utöver det som krävs. P3 och idéer läggs i docs/BACKLOG.md.
5. Ändra siffror bara i src/sim/rules.ts och nämn varför. Är prestandan dålig: sänk det som är dyrast på riktig GPU (kvalitetsnivåer, trianglar, partiklar) före allt annat. Försvaga aldrig ett test. Referensbilder (goldens) uppdateras bara med motivering; lätta aldrig på en tolerans i tysthet.
6. Håll `npm run verify` grönt. Committa och pusha vid varje grönt delmål.
7. Uppdatera docs/PROGRESS.md (inklusive mina prestandasiffror och renderersträngen i usage-loggen), öppna en draft-PR och svara på svenska med vad som är fixat, vad som sköts upp och exakt vad jag ska titta på igen.
```

### Buggrapport

Använd den när något är trasigt, mellan eller efter milestones.

```text
Jag har hittat en bugg i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

Vad hände: [FYLL I]
Vad jag förväntade mig: [FYLL I]
Så återskapar jag buggen: [FYLL I: steg, ev. ?seed= eller ?scenario=, eller vilket läge i Dev-panelen]
Milestone/version (docs/PROGRESS.md eller git-tagg): [FYLL I]
Konsolfel eller skärmdump: [KLISTRA IN]

Läs CLAUDE.md, docs/CHARTER.md och docs/PROGRESS.md. Skriv först ett test eller en Playwright-sekvens som återskapar buggen och bekräfta att den är röd. Hitta rotorsaken, fixa minimalt, bekräfta att testet blir grönt och att `npm run verify` är grönt. Lägg inte till funktioner. Öppna en draft-PR och svara på svenska med orsak, fix och vad jag ska testa.
```

### Hälsokoll mellan milestones

Kör den efter M10, M19 och M24b, eller när något känns skört. Den lägger inga nya funktioner till.

```text
Gör en hälsokoll av repot för 3D-krigsspelet. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska. Inga nya funktioner.

1. Läs CLAUDE.md, docs/CHARTER.md och Now/Next i docs/PROGRESS.md. Kontrollera att main är uppdaterad och att senaste milestone är mergad.
2. Kör `npm ci` och `npm run verify`. Rapportera allt som är rött eller långsamt.
3. Sök efter `TODO`, `FIXME`, `skip`/`only` i tester och uppenbart död kod. Lista, åtgärda det triviala, lägg resten i docs/BACKLOG.md.
4. Kontrollera docs-drift: stämmer docs/ARCHITECTURE.md, docs/BALANCE.md (om den finns) och CLAUDE.md (under 200 rader) med koden? Rätta avvikelser.
5. Kontrollera bundle-storlek och datapaket mot budgetarna i CHARTER/ARCHITECTURE och att exakta versioner i package.json inte har glidit.
6. Kontrollera att dependency-reglerna (sim/ai/data importerar inte three eller DOM; ai importerar bara SimView och src/sim/public.ts) och determinism-lint fortfarande gäller.
7. Uppdatera docs/PROGRESS.md, öppna en draft-PR och svara på svenska med en kort lägesrapport och eventuella rekommendationer.
```

# Del 1 — Fundament och första spelbara (M00–M06)

Här lägger Claude grunden: verktyg och arbetsregler, en förhandsvisning du kan öppna, den riktiga världen som data, den första 3D-jorden, simmotorn och din första spelbara erövring. Gates: M00b, M02 och M05.

## M00 — Grundverktyg, arbetsavtal och WebGL-bevis

| | |
|---|---|
| **Kräver** | Inget (tomt repo, bara `.gitattributes` och användarens `PROMPTLISTA.md`) |
| **Beräknad insats** | ~2,1 h agentarbete (1,2–4,0 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Ett repo där `npm run verify` bevisar ett upplyst, roterande skuggat klot (Claude rapporterar mått från en headless skärmdump), en grön CI-körning efter att du markerat PR:en som redo, och de skriftliga arbetsreglerna. Själva klotet öppnar du i webbläsaren först efter M00b. |

**Status: KLAR.** Byggd av Claude i PR #1 och granskad. Kör inte om. Prompten är kvar för referens (alla ändringar under bygget står i docs/DECISIONS.md).

**Klistra in i en ny session:** Den här prompten är medvetet mycket längre än de andra (ca 33 000 tecken, mest charterns text). Klistra in allt via kopieringsknappen på kodblocket; appen kan visa det som en bilaga, och det är normalt.

```text
Du bygger milestone M00 (Grundverktyg, arbetsavtal och WebGL-bevis) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
Repot är i princip tomt. Kör `ls -la`, `git log --oneline` och läs `.gitattributes`. CLAUDE.md saknas; den skapar du i steg 0.

FÖRKONTROLL
Det finns ingen tidigare milestone. Kontrollera att repot är tomt förutom `.gitattributes`, .git och `PROMPTLISTA.md` i roten (användarens promptlista: rör den inte, flytta den inte, referera inte till den någonstans utom i den ena regelraden i CLAUDE.md (och charterns avsnitt 7) som säger att den inte ska läsas); annars stanna och berätta vad som finns (gäller inte vid återupptagning med mallen 'Återuppta en avbruten session': hoppa då över tomhetskontrollen). Kontrollera sedan miljön och skriv resultatet som tabellen "Environment" i docs/PROGRESS.md:
- `node --version` (ska vara 22.13 eller senare), `npm --version`, och Chromium: `ls -l /opt/pw-browsers/` och kör `/opt/pw-browsers/chromium-1194/chrome-linux/chrome --version` (finns den inte: `find /opt/pw-browsers -name chrome -type f`; väntat Chromium 141, men lita inte på det).
- Nätverk, OBLIGATORISKA värdar: `curl -sI` mot https://elevation-tiles-prod.s3.amazonaws.com/terrarium/4/8/5.png, https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_admin_0_countries.geojson och https://registry.npmjs.org/three, samt `git ls-remote https://github.com/nvkelso/natural-earth-vector.git HEAD`. Tolka svaret så: 200/301/404 = nåbar; anslutningsfel, status 000 eller 403 från proxyn = blockerad. api.github.com och github.com över HTTP svarar 400 genom proxyn: det är väntat och OK, behövs inte, och rapporteras bara som info.
- Har du GitHub-verktyg eller `gh` med inloggning (behövs för PR)?
Är en OBLIGATORISK värd blockerad: berätta på svenska vilken, och att jag måste ändra miljöns nätverksinställningar (gäller bara NYA sessioner) INNAN jag mergar M00.

MÅL
Gör det tomma repot verifierbart innan någon spelkod finns: `npm run verify` ska bevisa typkontroll, lint, tester och en headless WebGL2-skärmdump av ett upplyst klot. Skriftliga regler ska hålla ca 40 separata sessioner konsekventa och återupptagbara. Clean-room: genren är inspirerad av territoriespel i stil med OpenFront.io, men INGEN kod, inga namn, kartor, varumärken eller assets kopieras därifrån eller från något annat spel.

GÖR
0. Först av allt (M00 måste kunna återupptas): skriv en minimal CLAUDE.md (språkregeln, clean-room, WIP-regeln) och docs/PROGRESS.md med GÖR och ACCEPTANS som bockbar checklista under Now; committa och pusha. Committa och pusha sedan efter punkt 1–3, 4–8 och 9–13. Skriv de långa dokumenten (11–12) sist, men pusha före dem. Punkt 11 utökar den minimala CLAUDE.md.
1. Paket och verktyg. package.json (private, type module, `engines.node >=22.13.0`), `.nvmrc` med 22, `.gitignore` (node_modules, dist, .cache, test-results, .claude/hook.log; e2e/goldens/ får INTE ignoreras), strikt tsconfig (strict, noUncheckedIndexedAccess, moduleResolution Bundler, lib med DOM, `"types": ["node"]` eftersom TypeScript 6 annars inte hittar Node-typer), committad package-lock.json. EXAKTA pinnar utan ^ eller ~; kör `npm view <paket>@<version> version` för varje pinne INNAN installation: three 0.186.1, @types/three 0.186.0, vite 8.3.4, vitest 5.0.4, typescript 6.0.2, @types/node 22.20.5, @types/pngjs 6.0.5, playwright-core 1.56.1 (1.56.0 och 1.56.1 matchar den installerade chromium-1194; 1.55.x och 1.57+ vill ha andra Chromium-revisioner som inte finns), pixelmatch 8.0.0, pngjs, yaml (YAML-tolk för CI-filtester), fast-check 4.10.2, tsx, eslint 10.12.0, typescript-eslint, @eslint/js (de fem sista i exakta versioner från `npm view`, kompatibla med eslint 10 och TS 6). vitest.config importerar `defineConfig` från `vitest/config`; eslint.config använder `defineConfig` från `eslint/config` (inte det föråldrade `tseslint.config()`). Ändrad pinne: skriv varför i docs/DECISIONS.md. Bevisa med `rm -rf node_modules && npm ci`.
2. Mappskelett: src/{sim,ai,data,host,render,ui,audio,app}, tools, tests, public/data, e2e, scripts, docs, .claude (tomma mappar med .gitkeep).
3. ESLint flat config. Gränsregler: src/sim, src/ai och src/data får inte importera `three`, render, ui, audio eller app och inte använda DOM-globaler (window, document, navigator, localStorage, requestAnimationFrame). Determinismförbud i src/sim och src/ai: Math.random, Date, performance, crypto, Intl, toFixed, localeCompare, operatorerna `**` och `**=`, samt iteration över objektnycklar (for...in, Object.keys/values/entries). Av Math är bara exakt avrundade funktioner tillåtna (abs, min, max, floor, ceil, round, trunc, sign, sqrt, imul, fround, clz32): selektorn `MemberExpression[object.name='Math']:not([property.name=/^(abs|min|max|floor|ceil|round|trunc|sign|sqrt|imul|fround|clz32)$/])` ger fel. Reglerna gäller källfilerna i src/sim, src/ai och src/data men INTE `**/*.test.ts`: alla tester ligger i `tests/` (tests/sim, tests/ai, `*.perf.test.ts`) eller `e2e/`, aldrig bredvid källfilerna (vitest-include: tests/**/*.test.ts, tools/**/*.test.ts). I eslint.config: globals (node + browser) för scripts/**/*.mjs; stäng av no-explicit-any och no-unused-vars för tests/** och e2e/**. Lint-självtest i vitest via ESLint-API:ts `lintText` med låtsas-sökvägar som `src/sim/fixture.ts`: Math.sin, Math.asin, Math.log2 eller `three`-import där MÅSTE ge fel, ren kod ska passera.
4. Klient-spike: `index.html` (med `<link rel="icon" href="data:,">` så att favicon inte ger 404-konsolfel; inga attribut på `<html>` och `<body>`, de försvinner när M00b gör sidan till ett Artifact-fragment: sätt klasser och språk från JS eller på en egen wrapper-div) + `src/app/main.ts` + `src/render/spike.ts`: en sfär med egen GLSL ShaderMaterial (en sol, rörlig), en liten DataTexture från en seedad PRNG, WebGL2. Shaderregel för three r186: skriv till `gl_FragColor` och deklarera aldrig egna `out vec4`, annars kompilerar fragment-shadern inte. Läget `?test=1`: ingen requestAnimationFrame-loop, fast seed, DPR 1, 960x540, MSAA av, preserveDrawingBuffer, `window.__test = { render(), info() }` (fler hooks listas i docs/ARCHITECTURE.md av respektive milestone). F3 växlar ett DOM-överlägg med GL renderer-sträng (WEBGL_debug_renderer_info), fps och renderer.info (anrop, trianglar, texturer); dolt som standard i testläget. Spikens testvy är fast: kamera på z-axeln, klotets diameter = bildhöjden (täckning ca 44–47 %), solen fast vid lon -40 grader och lat 20 grader. Kameran står på +z och tittar mot origo, +x är åt höger; solriktningen är normalize(cos20°·sin(−40°), sin20°, cos20°·cos(−40°)) = (−0,49; 0,34; 0,72), så den soluppvända halvan är VÄNSTRA bildhalvan. Skriv värdena i DECISIONS.md.
5. `scripts/shot.mjs`: Playwright-launcher (playwright-core) med executablePath och `args` som en explicit ARRAY: `['--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-angle=swiftshader','--force-color-profile=srgb','--js-flags=--expose-gc','--enable-precise-memory-info']`. `--enable-precise-memory-info` är en Chrome-switch och MÅSTE vara ett eget argument, aldrig inuti `--js-flags`: annars ignoreras den, usedJSHeapSize kvantiseras och heapDelta ger 0. (`--no-sandbox` bara om det krävs, och notera det.) Sökväg: env CHROMIUM_PATH, annars `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` om den finns, annars `chromium.executablePath()` (miljön sätter PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers). Skriv `scripts/shot.d.mts` med typer för de exporterade funktionerna. Assertioner: WebGL2-kontext + loggad renderer-sträng; >= 50 distinkta färger och luminans-std över en dokumenterad tröskel; strukturkrav: pixeln i bildmitten skiljer >= 40 i luma från ett hörn, medelluma(vänster bildhalva) >= 1,15 × medelluma(höger), mätt över pixlar med luma > 2; klotets siluett täcker 20–60 % av bilden; noll console-fel och noll console-varningar (en känd ofarlig SwiftShader-varning får vitlistas, exakt, på ett ställe, motiverad i DECISIONS.md). Analysfunktionen enhetstestas med syntetiska bilder: tom canvas, brus och rutmönster MÅSTE underkännas. Enda hårda tidsgräns: en hängvakt på 20 s (tider loggas enligt punkt 13). Golden-regel: två renderingar i samma browserstart är byte-identiska; rendering mot committad golden använder pixelmatch threshold 0.1 och <= 0,2 % avvikande pixlar (env GOLDEN_MAX_DIFF). Uppdatera goldens bara med `UPDATE_GOLDENS=1`; saknas en golden fallerar testet med texten "kör UPDATE_GOLDENS=1 och committa e2e/goldens/*.png". Golden-PNG:erna är testfixturer och undantagna från "inga binära spelassets". Starta Vite programmatiskt i en vitest globalSetup på ledig port. Exportera även `heapDelta(page, fn)` (gc() före/efter, median av 3) och testa den: ett kvarhållet 20 MB-fält ger delta inom +/-25 %, ingen allokering ger < 1 MB, och `usedJSHeapSize` är inte en multipel av 1 000 000. Läckertester (alla heapDelta-/minnesmätningar i senare milestones) renderar i viewport 320x180 över 60 render-anrop (3 omgångar x 20), tröskel 5 MB, median av 3, taggade `leak-test` i e2e-skalet.
6. `tests/perfguard.ts`: mäter en fast referensarbetsbörda (ca 5 M Math.imul/array-skrivningar) en gång per process och exporterar `budgetMs(x) = x * calibrationFactor` (faktorn klampas till [0.5, 4] och loggas). Alla CPU-budgetassertioner använder den; enhetstesta klampningen med en injicerad mätning, i `tests/perfguard.perf.test.ts` (perf-projektet måste ha minst ett test redan i M00). CPU-budgettester heter `*.perf.test.ts` och ligger i ett eget vitest-projekt (pool forks, fileParallelism false, maxWorkers 1). vitest.config.ts använder `test.projects` med tre inline-projekt unit, perf, e2e; testTimeout unit 30 000, perf 120 000, e2e 60 000, hookTimeout 60 000. Varje perf-assert använder medianen av minst 5 mätningar efter 2 uppvärmningar; ett p99-krav gäller bara där det står uttryckligen och då över minst 200 prover; `retry: 1` är tillåtet bara i perf-projektet och loggas; varje budget anger sin statistik (median eller p99).
7. e2e-tester (vitest): smoke (alla assertioner), determinism (samma vy två gånger identisk; mot golden enligt golden-regeln) och negativt test (en avsiktligt tom canvas via en debugparameter MÅSTE få smoke att fallera).
8. Scripts: dev, build, preview, typecheck, lint, test (= `vitest run --project unit`), shots, `verify:fast` (typecheck + lint + `vitest run --project unit`, mål <= 60 s, inre loopen) och `verify` (separata anrop `vitest run --project unit && vitest run --project perf --passWithNoTests && vitest run --project e2e`, aldrig ett blankt `vitest run`; e2e med goldens; sekventiellt och aldrig samtidigt med Chromium; budget <= 8 min; växer den över det: dela upp e2e i shards och skriv det i DECISIONS.md). `verify` är enda definitionen av klart. Kommandon som kan ta över 2 min körs med run_in_background och en loggfil.
9. `.github/workflows/ci.yml`: Node 22, `npm ci`, `npx playwright-core install --with-deps chromium`, `npm run verify`, ladda upp skärmdumpar/diffbilder vid fel. CI loggar Chromium-version och renderersträng; shot.mjs använder samma FULLA chromium-binär i CI som i molnet (inte headless-shell): efter installationssteget `echo "CHROMIUM_PATH=$(node -e "import('playwright-core').then(m=>console.log(m.chromium.executablePath()))")" >> "$GITHUB_ENV"`. Goldens är auktoritativa i molnsessionens `verify`; i CI körs golden-jämförelsen med `GOLDEN_COMPARE=warn` (actual/diff laddas upp som artifacts, steget fallerar inte) medan allt annat fallerar CI som vanligt; skriv beslutet i DECISIONS.md. Triggers: `pull_request` med types [opened, reopened, synchronize, ready_for_review], `workflow_dispatch` och `push` till main; jobbet har `if: github.event.pull_request.draft == false || github.event_name != 'pull_request'`; `concurrency` per ref med cancel-in-progress. Ett enhetstest parsar filen med `yaml` (`.github/workflows/ci.yml` eller `docs/ci/ci.yml.txt`, den som finns) och kräver dessa nycklar; senare milestones återanvänder samma hjälpare. Nekas push av `.github/workflows/*` (token saknar ofta `workflow`-behörighet): ta bort filen ur den opushade committen (`git reset --soft HEAD~1`, eller `git rm --cached .github/workflows/ci.yml` och `git commit --amend`), flytta den till `docs/ci/ci.yml.txt`, committa om och pusha igen; pusha aldrig en commit med `.github/workflows/*` efter ett nekande. Berätta exakt hur jag lägger den på plats på GitHub (se SLUT). Skriv i PROGRESS.md vilket fall som inträffade.
10. SessionStart-hook (`.claude/settings.json` + litet skript): avslutar alltid med exit 0, skriver exakt EN rad hälsorapport (Node-version, Chromium ja/nej + sökväg, `npm ci` gjord), kör `npm ci --prefer-offline --no-audit --no-fund` bara om node_modules saknas eller package-lock.json är nyare, timeout 90 s, loggar fel i .claude/hook.log. Verifiera med `bash -n` och en manuell körning (1 rad, exit 0). Notera i PROGRESS.md att hooken först körs skarpt i nästa session.
11. Dokument (engelska, utom det som anges). CLAUDE.md (UNDER 200 rader) med: kommandon och verify-nivåerna; invarianter och clean-room-regeln; "svara användaren på svenska, kod/docs/commits på engelska" och undantagen (docs/PREVIEW.md, docs/SERVER.md, README.md och sammanfattningen överst i docs/BALANCE.md skrivs på svenska); läsordning: docs/CHARTER.md, Now/Next i docs/PROGRESS.md, sedan docs/ARCHITECTURE.md (ett INDEX över moduler och publika API:er som varje milestones SLUT håller aktuellt) och bara de källfiler indexet pekar på, aldrig hela kataloger; arbetsregler: skriv GÖR och ACCEPTANS som en bockbar checklista under "Now" i PROGRESS.md och bocka av, committa+pusha WIP vid varje grönt delmål, aldrig försvaga eller skriva om ett test, ingen refaktorering utanför leveranserna, ändra inte tidigare milestones tester, toleranser eller goldens annat än där din ändring bevisligen orsakar skillnaden (motivera i DECISIONS.md), idéer till docs/BACKLOG.md i stället för att bygga dem; tidsregeln (perfguard, heapDelta, aldrig SwiftShader-väggklocka, aldrig en hårdkodad ms-gräns utan perfguard); golden-regeln (goldens är auktoritativa i molnets `verify`; CI kör `GOLDEN_COMPARE=warn`; lätta aldrig tolerans tyst); testplaceringen, perf-regeln och leak-testreglerna ordagrant som i punkt 3, 5 och 6; CI-regeln och workflow-fallbacken (faller CI efter att användaren markerat PR:en redo: läs jobbloggen med get_job_logs, rätta, pusha, vänta på ny körning; merga aldrig röd CI); PR- och merge-flödet (alltid DRAFT-PR; en draft kan inte mergas; användaren ber SAMMA session "Markera PR:en som redo, vänta på grön CI och squash-merga den till main", eller på GitHub (Ready for review, grön bock, Squash and merge); vägrar GitHub draft-PR (privat repo på gratisplan): öppna en vanlig PR och säg det på första raden i svaret, användaren går då direkt till Squash and merge; inga taggar eller SHA från grenen; kan du inte öppna PR: pusha och ge `https://github.com/Homerun5320/Spel/compare/main...<gren>?expand=1`); "PROMPTLISTA.md i repots rot är användarens egen promptlista: läs den inte, ändra den inte, referera inte till den"; varje svar efter något spelbart eller synligt innehåller en kort "Så spelar du"-ruta (5–10 rader: vad man klickar på, tangenter hittills) och exakta adresser i den form docs/PREVIEW.md anger för vald väg (Artifact: länken + `#läge`, t.ex. `#perf`; lokalt/Netlify: `?param=värde`) och alltid hur samma läge nås via Dev-panelen (F2); användarrader-regeln: "Om någon av mina inledande rader (de som står före texten 'Du bygger milestone') är `Usage efter Mxx: 5h NN %, vecka NN %`, lägg in den i usage-tabellen i docs/PROGRESS.md; är den `Hoppat över: Mxx`, notera det under Skipped i docs/PROGRESS.md och räkna kravet som uppfyllt (delar som beror på det hoppas över och noteras i docs/DECISIONS.md); är den `Endast tier 1–2`, stanna i M21 efter tier 2 och logga tier 3 i docs/BACKLOG.md; är den `Kapa djupet: högst ett justeringspass`, gäller det M19. Raderna kan ligga staplade i valfri ordning."; compact-instruktion som listar vad som ska behållas; SwiftShader-miljön; pekare till docs/. Övriga docs: docs/ARCHITECTURE.md, docs/PROGRESS.md (Done / Now / Next / Known issues / Skipped; milestonetabell med kolumnerna id, merge-SHA, anteckning; Environment; usage-tabell med datum, efter milestone, 5h-%, vecko-%, anteckning; resume-raden "Läs CLAUDE.md och docs/PROGRESS.md, kör git log -10 och npm run verify:fast, fortsätt vid första ej avbockade punkten."), docs/PROMPT_TEMPLATE.md (promptskelettet med de svenska sektionsrubrikerna LÄS FÖRST / FÖRKONTROLL / MÅL / GÖR / REGLER, TAL OCH GRÄNSSNITT / UTANFÖR OMFATTNING / ARBETSSÄTT / ACCEPTANS / SLUT), docs/BACKLOG.md, docs/DECISIONS.md, docs/ASSETS.md, README.md (kort, svenska + engelska) och en STUB docs/PREVIEW.md på svenska med bara "Väg ej vald än; kör M00b." Dokumenten får bara nämna filer som finns eller skapas nu, UTOM docs/CHARTER.md (ordagrant; ändra inte dess text) och roadmap-/planavsnitt, som får nämna framtida filer märkta "later"; CLAUDE.md får även nämna docs/SERVER.md, docs/BALANCE.md, docs/ART.md och CREDITS.md om de märks "(later)".
12. Skapa docs/CHARTER.md. Innehållet är ordagrant texten mellan raderna `<<<CHARTER_BEGIN` och `CHARTER_END>>>` (utan de två raderna):
<<<CHARTER_BEGIN
# Project charter

The constitution of the project. Every session reads it (via `CLAUDE.md`) before touching code. If a milestone prompt contradicts it, stop and ask the user.

## 1. One-liner and wishlist

An original 3D browser war-strategy game on a stylised globe. The player controls a real country or an invented one, expands over terrain where mountains change cost, visibility and flight, builds city / factory / port / missile silo / SAM site / defense post, flies helicopters through valleys to drop troops behind enemy lines, and fights AI nations. Single-player first; optional lockstep multiplayer last.

Wishlist: play as any real country or a custom nation with its own flag; far more fun to look at than the 2D predecessor; mountains matter (movement cost, radar shadows, helicopter routes); helicopters fly over terrain and drop troops; a way to look at the game after every milestone (`docs/PREVIEW.md`; M00b decides how).

## 2. Hard invariants

1. **Clean room.** Genre inspiration only (OpenFront.io-style territory play). No code, names, maps, branding or assets from it or any other game. All formulas and numbers are our own.
2. **Determinism.** `src/sim` and `src/ai` are pure and deterministic: no `Math.random`, `Date`, `performance`, `crypto`, `Intl`, `toFixed`, `localeCompare`, no `**`, no object-key iteration; of `Math` only exactly-rounded functions (abs, min, max, floor, ceil, round, trunc, sign, sqrt, imul, fround, clz32) are allowed (ESLint allow-list; asin, log2 etc. fail). Use sfc32/splitmix32 (PRNG state inside serialised state), integer `isqrt`, a Q15 sin/cos LUT, sqrt-only powers, the committed cos(lat) row table. ESLint enforces all of the above in `src/sim` and `src/ai` only; tests live in `tests/` and `e2e/` (never next to sources) and are exempt. Sim state is typed arrays and plain integers.
3. **Purity boundary.** `src/sim`, `src/ai`, `src/data` never import `three`, the DOM, `render`, `ui` or `audio` (ESLint import rules plus a test).
4. **One balance file.** Every tunable lives in `src/sim/rules.ts` (exports UPPER_SNAKE_CASE) and is tabulated in `docs/BALANCE.md` (from M04). No magic numbers elsewhere. Tests use ratios and bands.
5. **Intents only.** Everything that changes game state is a serialisable Intent; UI and AI emit intents and never mutate state. `step(state, turn)` applies intents scheduled at T+2. Visual effects read a render-only outbox, never the sim hash. `ownerId = seat + 1` (0 = unowned): intents use `seat`, ownership arrays and textures use `ownerId`.
6. **Read-only views.** UI and AI read the sim only through `SimView` (`src/sim/view.ts`, M05) and the pure helpers in the barrel `src/sim/public.ts` (`validateBuild`, later `validateHeliLaunch`, `validateMissileLaunch`, `planRoute`, `scoreLz`, `previewBlast`, `previewThreat`, `exposure`). `src/ai` may import ONLY `SimView` and `src/sim/public.ts` (ESLint allow-list plus type test), never `step`, state mutators or writable arrays. Snapshots are typed-array copies, never sim references. `SimHost.query(kind, args): Promise<QueryResult>` (M13b) is the request/response channel.
7. **Zero art assets.** Shader-generated terrain, ocean, atmosphere, stars; procedural low-poly instanced models, vector flags, WebAudio; system font stack. The only downloaded data is baked Terrarium elevation and Natural Earth, committed with checksums and credited.
8. **WebGL2 baseline** with `WebGLRenderer` and hand-written GLSL `ShaderMaterial`. No WebGPURenderer/TSL, Cesium, Babylon, PlayCanvas, UI framework, SharedArrayBuffer or monorepo.
9. **Exact pins.** No `^` or `~`; committed lockfile; never upgrade a dependency mid-milestone.
10. **i18n sv + en.** From M05 every UI string goes through `t(key, params?)` in `src/ui/i18n.ts` with tables `sv` (default) and `en`, both updated in the same commit; in test mode a key missing from either fails. Country names come from `name_en` / `name_sv` (meta.json); search matches both; show the UI language.

## 3. Tech stack

TypeScript 6.0.2 strict (tsconfig `"types": ["node"]`), ES modules, Node 22, single npm package. three@0.186.1, @types/three@0.186.0, Vite 8.3.4, Vitest 5.0.4, fast-check, pixelmatch, pngjs, @types/node 22.20.5, @types/pngjs 6.0.5, tsx, ESLint flat config (`defineConfig` from `eslint/config`), playwright-core 1.56.x. Vanilla TS + DOM UI. M00 re-checks each pin with `npm view` and records changes in `docs/DECISIONS.md`. Post-processing only via EffectComposer on the high tier. Quality tiers: test / low / medium / high. The sim runs on the main thread behind a worker-ready `SimHost` until M24a. `src/host/aiDriver.ts` (M09) runs the AI in the sim's thread with its own serialisable PRNG stream.

## 4. Repo layout

`CLAUDE.md` (under 200 lines); `docs/`: M00 creates CHARTER, ARCHITECTURE (module and API index), PROGRESS, PROMPT_TEMPLATE, BACKLOG, DECISIONS, ASSETS, PREVIEW (stub; M00b finalises); later CREDITS.md (M01, root), BALANCE (M04), ART (M21), SERVER (M27); `README.md`; `tools/` bake, balance, gen; `public/data/` committed `.bin.gz` packs, `manifest.json`, meta/overrides/checksums; `src/sim`; `src/ai`; `src/data`; `src/host`; `src/render`; `src/ui` (i18n, toast, report); `src/audio`; `src/app` (devpanel, input, `paths.ts`, `params.ts`); `server/` (M26a+); `e2e/`; `tests/` (tests/sim, tests/ai, `*.perf.test.ts`, `perfguard.ts`); `scripts/shot.mjs`, `scripts/artifact-pack.mjs`; `artifact/` (generated, gitignored); `.github/workflows/`; `.claude/` (settings, SessionStart hook).

## 5. World and grid model

Equirectangular lat/lon master grid, baked offline by a deterministic Node tool from Terrarium z4 (AWS S3) and Natural Earth 50m/10m (raw.githubusercontent, pinned commit SHA).

- **Render pack** 4096x2048: u8 sqrt-coded height, bathymetry 2048x1024, country-id raster.
- **Sim pack** 1024x512 (about 39 km/cell at the equator, about 126k land cells excluding Antarctica): terrain class (DeepSea, Shallows, Plains, Forest, Hills, Mountain, Peak, Ice), mean/max elevation, ruggedness, country id, coast flag. `GameState` is parameterised by (width, height). **Nav grid** 256x128.
- Costs are km-aware (`cellKm(lat)`, cos-lat weights). Antarctica and lat above 84N are unplayable Ice.
- Gameplay height is decoupled from real metres: x6-10 exaggeration (`GAMEPLAY_HEIGHT_EXAG`) for classes, line of sight and occluders; the service ceiling applies to real altitude.
- Rules are written in std-cells (2x2 sim cells): ported from a 512x256 design via `rules.ts` (distances x2, areas x4, speeds x2).
- Packs load raw (fetch + DecompressionStream) and are never decoded as images. All packs load through `data/manifest.json` (`{name: {file, enc: raw|b64}}`), so an Artifact build can serve the same bytes under an allowed extension (.txt base64, or .png/.wasm raw; chosen in M00b). Ownership texture RGBA8 1024x512, re-uploaded at 10 Hz or less when dirty.

## 6. Verification environment

Cloud container: headless Chromium 141 with software WebGL (SwiftShader), no GPU, no audio hardware, restricted network (reachable: npm registry, raw.githubusercontent.com, S3, `git ls-remote`; blocked: CDNs, github.com web/API, cdn.playwright.dev). Bundle everything; M00 preflights the hosts.

- playwright-core 1.56.x with `executablePath` `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and Chromium `args` passed as an explicit ARRAY: `['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--force-color-profile=srgb', '--js-flags=--expose-gc', '--enable-precise-memory-info']`. `--enable-precise-memory-info` is a Chrome switch, not a V8 flag: it must be its own argument (inside `--js-flags` it is ignored and `usedJSHeapSize` is quantised, so `heapDelta` returns 0); the `heapDelta` self-test also asserts `usedJSHeapSize` is not a multiple of 1 000 000. Never upgrade Playwright.
- CI uses the same FULL chromium binary as the cloud (install `chromium` with playwright-core and set `CHROMIUM_PATH`; not headless-shell) and logs the Chromium version and renderer string.
- Test tier: at most 150k triangles, MSAA off, DPR 1, 960x540. `?test=1` = deterministic mode (no rAF, seeded) with `window.__test` hooks that milestones define and ARCHITECTURE.md lists.
- Screenshot tests assert a WebGL2 context, pixel statistics (blank canvas fails) and zero console errors.
- **Never assert SwiftShader wall-clock.** CPU budgets use `tests/perfguard.ts` (`budgetMs(x)`, factor clamped to [0.5, 4], logged); heap asserts use `heapDelta(page, fn)`; GPU load via `renderer.info` counters. shot.mjs logs times with a 20 s hang guard only.
- **Perf tests:** CPU-budget tests are named `*.perf.test.ts` and live in their own vitest project (pool forks, fileParallelism false, maxWorkers 1); `verify` runs unit, then perf, then e2e, never concurrently with Chromium. Each assert uses the median of >= 5 measurements after 2 warm-ups; a p99 requirement applies only where stated, over >= 200 samples; `retry: 1` only in the perf project and logged; each budget states its statistic.
- **Leak tests:** all heapDelta/memory checks render in a 320x180 viewport over 60 render calls (3 rounds x 20), threshold 5 MB, median of 3, tagged leak-test in the e2e shell.
- **Goldens:** two renders in one launch are byte-identical; vs committed golden: pixelmatch threshold 0.1, at most 0.2 % differing pixels (`GOLDEN_MAX_DIFF`). Goldens are authoritative in the cloud session's `verify`; in CI the golden comparison runs with `GOLDEN_COMPARE=warn` (actual/diff uploaded as artifacts, step does not fail) while everything else fails CI normally. Never loosen a tolerance silently.
- **verify tiers:** `verify:fast` = typecheck + lint + vitest unit (<= 60 s, inner loop); `verify` = also perf + e2e + goldens (<= 8 min, shard if it grows); `verify:balance` (M19) is separate. Foreground commands time out at 2 min (max 10): long jobs use run_in_background with a log file.

## 7. Working rules for every session

- Chat in Swedish; code, comments, docs, commits in English. Swedish docs: PREVIEW.md, SERVER.md, top of BALANCE.md; README bilingual.
- **Read order:** `CLAUDE.md`, this charter, Now/Next in `docs/PROGRESS.md`, `docs/ARCHITECTURE.md`; then only the source files it points to. Each milestone's last step updates ARCHITECTURE.md.
- **Precondition:** required milestones must be merged into main (PROGRESS.md, `git log`); otherwise stop and tell the user. Record `git rev-parse origin/main` as the previous merge SHA in PROGRESS.md. Tag only after merge on main (v1.0.0 in M25b) if pushing tags works; never cite SHAs from branch commits.
- First write GÖR and ACCEPTANS as a tickable checklist under Now in PROGRESS.md. Small steps, `npm run verify:fast` often, `npm run verify` before finishing, commit and push WIP at every green checkpoint. If context or usage runs low, commit and write Now/Next.
- No refactoring outside deliverables. Do not change earlier milestones' tests, tolerances or goldens unless your change provably causes the difference (justify in DECISIONS.md). Never weaken or delete a test. Ideas go to BACKLOG.md.
- **Merge flow:** open a DRAFT pull request; a draft cannot be merged. The user asks the same session to mark it ready, wait for green CI and squash-merge, or does it on GitHub. CI triggers: `pull_request` (opened, reopened, synchronize, ready_for_review), `workflow_dispatch`, push to main; skip drafts; concurrency per ref with cancel-in-progress. If GitHub refuses draft PRs (private repo on a free plan), open an ordinary PR and say so on the first line of the reply; the user then skips "Ready for review" (CI still runs). If CI fails after the PR was marked ready: read the job log (`get_job_logs`), fix, push, wait for a new run; never merge red CI. If pushing `.github/workflows/*` is rejected (token lacks `workflow`), commit it as `docs/ci/<name>.yml.txt`, push the rest and tell the user how to add it on GitHub (M00 then has no CI: the user squash-merges without waiting, then adds ci.yml on main via GitHub and runs it under Actions).
- **Resume:** a resume session is new, on a new branch, without the interrupted WIP: it fetches the old branch, fast-forwards (or merges), pushes to its own branch, opens a new draft PR "Ersätter #N" and asks the user to close #N. If CLAUDE.md or this charter is missing, M00 was interrupted: look for an old M00 branch (`git branch -r`) and continue the M00 prompt at the first unfinished item, else rerun M00 from the start. M00 itself is resumable: it first writes a minimal CLAUDE.md and PROGRESS.md and pushes at each checkpoint.
- **User lines:** if any of the user's opening lines (those before the text "Du bygger milestone") is `Usage efter Mxx: 5h NN %, vecka NN %`, it goes into the usage table in PROGRESS.md. `Hoppat över: Mxx` is recorded under Skipped and that requirement counts as met. `Endast tier 1–2` and `Kapa djupet: högst ett justeringspass` are honoured by M21 and M19. Lines may be stacked.- **User's own files:** `PROMPTLISTA.md` in the repo root is the user's own prompt list: never read or change it, and mention it nowhere except in this one rule.
- **Dev panel and reports:** every `?` mode is registered in `src/app/devpanel.ts` (F2) via `registerDevMode`; "Kopiera rapport" buttons use `showReport(json)` (selectable textarea + Download, clipboard tried first). Downloads are inert in an Artifact; the textarea is the fallback. Every address with ?key=value that a reply gives the user is also given in hash form (#key-value; grammar in docs/PREVIEW.md); gates never depend on a query string.
- **Artifact preview facts:** index.html is published as a fragment (no doctype/html/head/body); only served file types (no .bin/.gz/.zip); `?params` do not reach the page but a `#token` does; page-initiated downloads are blocked; no outbound network or WebSocket (no online play); update from any session = read the Artifact, list its files, publish with `url` and a files map that null-removes stale paths (procedure in docs/PREVIEW.md).
- End: update PROGRESS.md (Done / Now / Next / Known issues / usage log), open a DRAFT PR, reply in Swedish with what was done, what deviated, exactly what the user should test, and a short "Så spelar du" control list after every playable milestone.
- **Done = `npm run verify` green** plus the acceptance list. Subjective checks and real-GPU FPS are user gates (Dev panel or `?perf=1`); list what to look at.

## 8. Roadmap (39 prompts: 36 single-player, 3 optional)

M00 Harness; M00b Preview path (GATE); M01 Bake world; M02 Stylised Earth, Dev panel (GATE); M03 Sim foundation; M04 Territory sim; M05 First playable conquest, i18n (GATE); M06 Menu: real or custom nation; M07a Terrain LOD A: quadtree chunks; M07b Terrain LOD B: detail; M08 RTS camera, ground picking, perf scene (GATE); M09 Structures sim; M10 Structure models, build fields, selection; M11a Mountain-aware radar and exposure (headless); M11b Air navigation (headless); M12a Helicopters in the sim; M12b SAM vs helicopters, raid stats; M13a Helicopter on screen; M13b Deploy mode, exposure view (GATE); M14 Missiles, nukes, SAM interception; M15a Missile/nuke VFX, post-processing; M15b Nuke targeting mode (GATE); M16 AI Director v1; M17 AI specials: air assault, nukes, SAM cover; M18 Match flow; M19 Balance harness and tuning; M20a HUD, hotkeys, commands; M20b Minimap, alerts, tactical view (GATE: full Skirmish playtest); M21 Visual finish, tiers 1-3 (GATE); M22 Procedural audio (GATE); M23a Swedish/English completion, settings, credits, help; M23b Tutorial; M24a Worker sim, quality tiers, perf report (GATE); M24b Save/load, browser tests (GATE); M25a Release prep; M25b Review and v1.0 (GATE). Optional, only after M25b: M26a Multiplayer foundation; M26b Lobby and AI on the server; M27 Resync, reconnect, AI takeover, server deploy (GATE).

## 9. Cut line

If time or usage runs out, cut whole prompts in this order: 1. M26a, M26b, M27. 2. M21 tier 3. 3. M20b (the "?" help overlay from M20a is the minimum onboarding). 4. M23b (last to cut; the user needs onboarding). 5. M19 balance depth. Skipping M20b needs the user's `Hoppat över: M20b` line in M21, M22 and M23a (recorded under Skipped in PROGRESS.md; later prompts also read it there). Never skip M11a-M13b (signature feature), M18 (the game needs an ending), M21 as a whole, M22, M23a or the verify harness.
CHARTER_END>>>
(Slut på charterinnehållet. Allt efter den här raden är åter instruktion till dig.)
13. Logga i PROGRESS.md (inte assertat): första bildruta, tid per skärmdump, trianglar, renderer-sträng, tid för `verify:fast` och `verify`.

REGLER, TAL OCH GRÄNSSNITT
- Engelska identifierare. three importeras bara under src/render och src/app.
- Testlägeskontraktet i punkt 4 (`?test=1`) gäller.
- Inga CDN-länkar, inga binära spelassets, inga hemligheter i repot.

UTANFÖR OMFATTNING
All spelkod, sim, jorddata, riktig terräng, shaders utöver spiken, ljud, multiplayer, UI-ramverk. Valet av förhandsvisningsväg (docs/PREVIEW.md) görs i M00b. Jorddata kommer i M01.

ARBETSSÄTT
Följ steg 0 (CLAUDE.md-reglerna gäller först när filen finns): kort plan först, små steg, `npm run verify:fast` ofta, `npm run verify` före PR.

ACCEPTANS
- `npm ci && npm run verify` avslutar med 0 från ren klon; `npm run verify:fast` avslutar med 0.
- Smoke-skärmdump klarar alla assertioner i punkt 5; de syntetiska tomma/brus/rutmönster-bilderna underkänns.
- Två renderingar i samma start är byte-identiska; mot golden gäller golden-regeln; en avsiktligt tom canvas får smoke att fallera.
- Lint-självtest: ett planterat Math.sin, Math.asin, Math.log2 eller `three`-import i src/sim fallerar, ren kod passerar.
- perfguard- och heapDelta-testen passerar (självtestet enligt punkt 5); CI-filtestet passerar (eller fallbacken har använts och är dokumenterad).
- CLAUDE.md < 200 rader (`wc -l`) och innehåller språkregeln, clean-room-regeln, merge-flödet, usage-regeln och tidsregeln, PROMPTLISTA-regeln (`grep -n PROMPTLISTA CLAUDE.md` ger exakt en rad) och regeln om 'Så spelar du'-rutan; PROGRESS.md innehåller resume-raden, Environment-tabellen och usage-tabellen.
- Hook-skriptet verifierat enligt punkt 10.

SLUT
Enligt CLAUDE.md: uppdatera PROGRESS.md, DECISIONS.md och ARCHITECTURE.md och öppna en DRAFT-PR mot main (fallback: compare-länken). Svara sedan på svenska: vad som gjorts, vad som avvek, Environment-tabellen (särskilt blockerade värdar), om workflow-filen kunde pushas, mått från skärmdumpen, och exakt vad jag ska göra härnäst. Kunde workflow-filen inte pushas finns ingen CI för M00: säg då att jag ska be "Squash-merga utan att vänta på CI" (verify körde grönt i sessionen) och ge stegen för att efteråt lägga in ci.yml på main via GitHub (Add file, Create new file, `.github/workflows/ci.yml`, klistra in) och köra den under Actions, Run workflow. Vägrade GitHub draft-PR: säg det på första raden.
```

**Efteråt gör du:**
- Merga PR:en så här: be SAMMA session "Markera PR:en som redo, vänta på grön CI och squash-merga den till main" (eller öppna PR-länken på GitHub, tryck Ready for review, vänta på den gröna bocken, Squash and merge, Confirm). Om Claude sa att workflow-filen inte kunde pushas finns ingen CI för M00: be "Squash-merga utan att vänta på CI" och lägg sedan in ci.yml på main via GitHub (Add file, Create new file, `.github/workflows/ci.yml`) och kör den under Actions, Run workflow. Vägrade GitHub draft-PR står det på första raden i svaret: hoppa då över Ready for review.
- Var någon värd blockerad: ändra miljöns nätverksinställningar innan du går vidare (gäller bara nya sessioner).
- Starta M00b först efter mergen. Om din app visar usage kan du skriva `Usage efter M00: 5h NN %, vecka NN %` som första rad i nästa prompt.

## M00b — Förhandsvisning: hitta en väg där du kan se spelet

| | |
|---|---|
| **Kräver** | M00 mergad |
| **Beräknad insats** | ~1,2 h agentarbete (0,8–2,2 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — öppna länken (eller följ stegen) som Claude skriver i svaret och svara "klotet syns" i samma session innan du mergar; docs/PREVIEW.md hamnar i main först efter mergen (syns inget: mallen "Feedback efter en gate" i en ny session) |
| **Du ser efteråt** | Ett roterande klot i en privat Artifact (eller en guide för att köra det på din egen dator) och en svensk guide, docs/PREVIEW.md, som förklarar hur du öppnar och uppdaterar förhandsvisningen efter varje milestone. |

**Status: KLAR, väntar på din bekräftelse.** Byggd i PR #1 och publicerad som Artifact: https://claude.ai/artifact/H4jqcMBvTMi7udLais5btV. Svara "klotet syns" i en session eller beskriv vad du ser. Kör inte om.

**Klistra in i en ny session:**

```text
Du bygger milestone M00b (Förhandsvisning: hitta en väg där du kan se spelet) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska (undantag: docs/PREVIEW.md skrivs på svenska).

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md, docs/PREVIEW.md (stubben), package.json och vite-konfigurationen.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M00 är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M00 i milestonetabellen i docs/PROGRESS.md.

MÅL
Jag är inte utvecklare och ditt moln har ingen skärm. Jag vill i första hand testa spelet i en Claude Artifact (privat tills jag delar den). Gör det möjligt att se spelet där, bygg verktygen som uppdaterar Artifacten efter varje milestone och skriv en guide jag kan följa. Lova ingen länk du inte har bevisat.

BEVISADE FAKTA OM ARTIFACT (verktygets regler, plus en testsida som jag körde i den riktiga vyn på en iPhone i Claude-appen: WebGL2 på Apple GPU, 59 FPS med 262 000 trianglar)
- Sidan lindas in i ett skelett vid publicering: publicera index.html som ett FRAGMENT (inga doctype/html/head/body-taggar). En extra sida som probe.html serveras UTAN skelett och ska vara ett fullständigt dokument. Övriga filer publiceras bredvid via `files` och hämtas med relativa adresser; de ligger under en versionsmapp (t.ex. /_f/<id>/), så inga absoluta `/`-adresser.
- Serverade filtyper: .html .css .js .mjs .wasm .json .map .geojson .webmanifest .txt .md .csv .xml .svg .png .jpg .jpeg .gif .webp .avif .ico .woff .woff2 .ttf .otf .mp3 .wav .ogg .mp4 .webm .pdf. Filer som .bin, .gz och .zip avvisas, så spelets `.bin.gz`-pack kan inte publiceras som de är.
- Datacontainrar, bevisade i den riktiga vyn: rå gzip-binärdata under ändelsen `.png` (levereras oförändrad och är snabbast: 3 MB på ca 0,5 s), rå under `.wasm` (fungerar, men servern gzippar dessutom) och base64-text i `.txt` (fungerar, ca dubbelt så långsamt). Standard är `.png`.
- Gränser: 16 MB per sida eller textfil, 15 MB per binärfil, högst 255 filer och 64 MB per publicering; en artifact rymmer högst 511 filer och 256 MB.
- Adressparametrar som `?perf=1` når inte sidan, men ett rent ankare gör det: länken + `#perf` (bara tecknen A–Z a–z 0–9 - . _ ~).
- Nedladdningar från sidan är blockerade; urklipp fungerar bara i en klickhanterare; Fullscreen API saknas på iPhone; WebSocket och anrop till andra servrar är blockerade (inget onlinespel i en Artifact). Moduler, modul-Workers från egna filer, relativ fetch, DecompressionStream, localStorage och IndexedDB fungerar.

GÖR
1. Portabelt bygge. Vite `base: './'` och `build.assetsDir: 'assets'` (skriv i docs/DECISIONS.md). `src/app/paths.ts` exporterar `ROOT_URL` (i dev `new URL('/', self.location.href).href`, i bygget `new URL('../', import.meta.url).href`, eftersom alla chunkar ligger i assets/) och `siteUrl(path)`. ALL körtidshämtning av data/ och alla adresser till andra sidor går via `siteUrl()`, även i en Worker; aldrig `./data/...`, `import.meta.env.BASE_URL + ...` eller `/data/...`. Index.html får inga attribut på `<html>` och `<body>` (de försvinner i fragmentet). Test: läs dist/**/*.html, dist/**/*.css och dist/assets/*.js och underkänn `src="/`, `href="/`, `url(/` samt stränglitteralerna `"/data/` och `"./data/`.
2. `scripts/artifact-pack.mjs` (`npm run artifact:pack`) med utdata i `artifact/` (lägg `artifact/` i .gitignore; ett test kräver raden):
   (i) `index.html` som fragment: maskera `<script>`/`<style>`-block och kommentarer med platshållare, ta bort `<!doctype ...>` och taggarna html, head och body med regexpen `/<\/?(html|head|body)(\s[^>]*)?>/gi` (INTE `[^>]*` direkt efter namnet: det träffar `<header>`), återställ blocken. Ingen HTML-parser. Enhetstest med `<header>` och med `</html>` i en sträng i ett inline-skript.
   (ii) alla filer från dist/ med tillåten ändelse och inget punktnamn. Allt annat som inte är ett datapack i `data/manifest.json` (okänd eller ingen ändelse, .gz, .bin, .glb) ska få scriptet att avsluta med fel och lista sökvägarna; hoppa aldrig över en fil tyst. Filer som `_headers`, `.nojekyll` och `CNAME` får inte ligga i public/.
   (iii) datapack i vald container (`--container=png|wasm|b64`, standard png) med omskrivet `data/manifest.json` (`{namn: {file, enc: "raw"|"b64"}}`). Före M01 finns inget manifest: scriptet ska ändå fungera. I spelet avkodas b64 med `Uint8Array.fromBase64` om den finns, annars med en for-loop över atob-strängen (aldrig `Uint8Array.from(atob(s), fn)`: åtta gånger långsammare).
   (iv) `files.json`: en LISTA av batcher, varje batch en karta `{"<publicerad sökväg>": "artifact/<sökväg>"}` (källsökvägar relativa repo-roten; index.html ingår inte, den publiceras som `file_path`); högst 250 filer och 60 MB per batch. `--prev=<fil>` (en publicerad sökväg per rad) lägger `null` för borttagna sökvägar i sista batchen. Skriv antal filer, batcher och MB.
   (v) `--probe`: skriver deterministiska (seedad PRNG) testpack om ca 3 MB gzippade i `artifact/probe/` som `pack.png`, `pack.wasm`, `pack.b64.txt` och `expected.json {len, fnv1a}`; de ligger inte i public/ eller dist/ och committas inte.
3. `probe.html` (Vite-ingång i repo-roten, src/probe.ts; ett fullständigt dokument) med svensk tabell: de tre containrarna mot expected.json, modul-Worker via `new Worker(new URL('./probe.worker.ts', import.meta.url), {type:'module'})`, urklipp, `location.hash` och `location.search`, relativ länk tillbaka till index.html. Länka den från index.html.
4. `e2e/artifact.test.ts`: en statisk server över artifact/ som svarar 404 för varje ändelse utanför listan, lägger index.html i ett minimalt skelett (doctype, html, head med charset, body, fragmentet) och serverar från en undermapp som /x/y/. Playwright laddar sidan: klotet ritas (samma pixelkrav som smoke), noll konsolfel, inga 404.
5. Publicera spiken som Artifact enligt proceduren i punkt 6 och spara Artifact-URL:en i docs/PREVIEW.md. Du kan inte se sidan själv: be mig öppna den, svara "klotet syns" i den här sessionen och gärna klistra in tabellen från probe.html. Visar tabellen att png-containern inte fungerar i den riktiga vyn: byt till `--container=b64`, publicera om och skriv det i docs/DECISIONS.md.
6. Uppdateringsprocedur (Claude kör den i varje milestones SLUT som ändrar något jag kan se; rena headless-milestones publicerar inte om): (1) `npm run build && npm run artifact:pack`; (2) Artifact-verktyget action read på URL:en i docs/PREVIEW.md; (3) action list med scope files på samma URL, spara sökvägarna i en textfil, en per rad; (4) `npm run artifact:pack -- --prev=<den filen>`; (5) publicera med `url`, `file_path` artifact/index.html och `files` = första batchen ur files.json, och för varje ytterligare batch publicera igen med samma `url`; (6) genererade filer (minifierad JS, datapack) läses inte i sin helhet: kontrollera med `ls -l`, `head -c 200` och checksummorna; (7) berätta länken och att jag behöver ladda om fliken.
7. Övriga vägar, högst ca 10 minuter totalt. Netlify: läs schemat för verktyget `netlify-deploy-services-updater` (operation `deploy-site`; i dag tar den bara ett siteId). Finns ingen väg att skicka dist/ och `curl -sI https://api.netlify.com` inte svarar, eller finns inget Netlify-verktyg: markera EJ MÖJLIG och lova ingen länk. Går det: fråga mig innan du skapar sajten och varna att en Netlify-sajt kan vara öppen för alla med länken. Lokalt: `npm ci && npm run dev`. Saknas Artifact-verktyget eller fallerar publiceringen: markera Artifact EJ MÖJLIG i docs/DECISIONS.md och välj nästa väg utan att fråga.
8. Skriv docs/PREVIEW.md på SVENSKA för en icke-utvecklare, med numrerade steg: vald väg och skäl; Artifact-URL; hur länken öppnas (även på telefon); uppdateringsproceduren ovan; en tabell "?x=y blir #x-y" (grammatiken införs i M02) och att lägen i en Artifact nås med länken + `#läge` eller via Dev-panelen (F2 på dator, hörnknappen på telefon); att Ladda ner-knappar inte fungerar i en Artifact; att onlinespel kräver en riktig webbadress; och för lokal körning en steg-för-steg för Windows och Mac (Node 22 LTS, GitHub Desktop, klona Homerun5320/Spel, `npm ci`, `npm run dev`; uppdatera = Pull och `npm ci` om package-lock ändrats). Skriv alla resultat (fungerade / fungerade inte / ej testat) i docs/DECISIONS.md.

REGLER, TAL OCH GRÄNSSNITT
- Inga hemligheter eller tokens i repot. Skapa inga publika sajter utan att fråga mig först. Lägg `npm run artifact:pack` i CLAUDE.md:s kommandolista.

UTANFÖR OMFATTNING
All spelkod och alla nya spelfunktioner; jorddata (M01); Dev-panelen och hash-parsern (M02).

ARBETSSÄTT
Enligt CLAUDE.md. Det här är en sondering och ett verktygssteg, inte en byggfas.

ACCEPTANS
- docs/PREVIEW.md finns, är på svenska och nämner vald väg och skäl, Artifact-URL:en, uppdateringsproceduren och resultat för varje prövad väg.
- Testet mot absoluta adresser passerar; `npm run verify` är grönt.
- `npm run artifact:pack` är grönt: fragmentet saknar doctype/html/head/body-taggar (enhetstest, inklusive `<header>`); en planterad fil som `dist/assets/x.glb` eller utan ändelse ger exit-kod != 0; `--prev` skriver `null` för en sökväg som saknas; ingen batch innehåller index.html, .bin, .gz eller .zip; en länkkontroll läser artifact/index.html, artifact/**/*.css och strängarna `new URL("...", import.meta.url)` i artifact/**/*.js och kräver att varje relativ målfil finns i artifact/.
- `e2e/artifact.test.ts` är grönt (klotet ritas, noll konsolfel, inga 404).
- Spiken är publicerad som Artifact (eller guiden för lokal körning är komplett), och svaret slutar med frågan: syns klotet?

SLUT
Enligt CLAUDE.md, men utan taggar. Öppna en DRAFT-PR. Svara på svenska: vilken väg som gäller, exakt hur jag öppnar den, vad som inte fungerade, och be mig svara "klotet syns" (och gärna klistra in tabellen från probe.html) innan jag mergar.
```

**Efteråt gör du:**
- Öppna länken (eller följ stegen) som Claude skriver i svaret; docs/PREVIEW.md hamnar i main först när du mergat. Svara "klotet syns" i SAMMA session innan du mergar; syns inget, använd mallen "Feedback efter en gate" (under Mallar i den här listan) i en ny session.
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main"). Gå sedan vidare till M01.

## M01 — Baka riktiga världen: terräng, länder, städer, hamnar

| | |
|---|---|
| **Kräver** | M00b mergad |
| **Beräknad insats** | ~3,6 h agentarbete (2,3–5,8 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | En debug-sida som visar jorden som klasskarta, höjdkarta och landskarta, med kontinenter du känner igen. |

**Klistra in i en ny session:**

```text
Du bygger milestone M01 (Baka riktiga världen: terräng, länder, städer, hamnar) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md (särskilt avsnittet om världsmodellen), docs/PROGRESS.md, docs/ARCHITECTURE.md, docs/ASSETS.md, docs/PREVIEW.md.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M00b är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M00b i milestonetabellen i docs/PROGRESS.md. Kontrollera att `curl -sI https://elevation-tiles-prod.s3.amazonaws.com/terrarium/4/8/5.png` och `curl -sI https://raw.githubusercontent.com/` svarar.

MÅL
Producera små committade binärpaket för rendering och för sim-rutnätet 1024x512, så att ingen senare session beror på blockerade nätverksvärdar. Detta är datagrunden för hela spelet.

GÖR
1. `tools/bake` (Node + tsx + pngjs, egen scanline-rasterare för polygoner med hål, even-odd och antimeridianen). Hämta Terrarium z4 (256 tiles, ca 18 MB) från `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/4/{x}/{y}.png`, höjd = R*256 + G + B/256 - 32768 m, samt Natural Earth 50m admin_0_countries, 10m populated_places_simple och 10m ports från `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/<SHA>/geojson/`. Slå upp SHA en gång med `git ls-remote https://github.com/nvkelso/natural-earth-vector.git HEAD` (github.com över HTTP/API är blockerat); misslyckas det, använd ca96624a56bd078437bca8184e78163e5039ad19 (verifierad 2026-10-13). Skriv SHA i meta.json och CREDITS.md. Under bakningen är bara S3-värden och raw.githubusercontent.com tillåtna. Cache i gitignorerad mapp. Blockerat: avbryt med tydligt fel utan halva utdata och berätta vad som är blockerat. Ett syntetiskt brusfallback får bara testa pipelinen och aldrig committas som riktiga packs.
2. Deterministisk bakning: inga tidsstämplar, sorterad ordning, gzip nivå 9 med mtime 0. `checksums.json` lagrar per fil sha256 av den OKOMPRIMERADE nyttolasten (auktoritativ; används av bake:check och Node-test), fnv1a-32 av nyttolasten (för webbladdaren) och sha256 av .gz (bara informativt, eftersom gzip-bytes kan skilja mellan Node-patchversioner).
3. RENDER-pack 4096x2048 (equirectangular): u8 sqrt-kodad medelhöjd (land), bathymetry 2048x1024 (u8 sqrt-kodat djup), country-id-raster (id efter fallande area, u8). Natural Earths polygonmask är auktoritativ för land; tvinga höjd >= 1 m på land och <= -1 m till havs. Kodningskonstanter: land max 9000 m, djup max 11000 m, i meta.json; varje landpixel avkodas till >= 1 m och havskoden är 0. Terrarium har två felpixlar på 11 500 m vid ca 72,4N 78,8W: klampa land till <= 9000 m och avlägsna isolerade spikar med ett 3x3-medianfilter (byt en pixel mot medianen bara när den avviker mer än 2000 m från den, så att riktiga toppar överlever) INNAN max/medel beräknas. Tiles är Web Mercator (ca +/-85,05 grader): fyll polerna syntetiskt.
4. SIM-pack 1024x512 (ca 39 km/cell): landmask, terrängklass (DeepSea, Shallows, Plains, Forest, Hills, Mountain, Peak, Ice) från medel- och maxhöjd + ruggedness + en deterministisk biomregel (latitud, höjd, heltals-hash; inga floder), Int16 medel- och maxhöjd, u8 ruggedness-lager (även i meta.json och checksums), majority-vote country-id, kustflagga. Antarktis och lat > 84N är Ice (ospelbart). Härled också ett 256x128 nav-rutnät och en cos(lat)-radtabell (Q15-heltal per rad, i meta.json). Alla trösklar i EN fil (tools/bake/classify.ts) och i DECISIONS.md. Terrarium z4 jämnar ut toppar (uppmätt: Himalaya-boxen 6563 m, Anderna 6034 m, Alperna 3358 m), så trösklarna väljs för att nå målen. Uppmätta startvärden: Peak = max >= 5000 m (1,0 % av non-Ice-land), Mountain = 1500 m <= max < 5000 m (ca 14,7 %, räknat EXKLUSIVE Peak). Banden är Peak [0,3–1,5 %] och Mountain [8–18 %] av landceller (exkl. Ice); justera tröskeln bara om ett band annars bryts.
5. `public/data/`: `cities.json` (ca 600 största + huvudstäder), hamnar snappade till kustceller, `meta.json` (id till ADM0_A3, `name_en` och `name_sv` från NAME och NAME_SV, med en som fallback, befolkning, kontinent, huvudstadscell, viktad area, cellantal), `overrides.json` (mikrostater under 8 celler ospelbara/sammanslagna, neutrala namn för omstridda områden; Natural Earths de facto-linjer gäller) och `checksums.json`. Para huvudstad med land via punkt-i-polygon (country-id-rastret), inte via ADM0_A3-sträng; använd `featurecla == "Admin-0 capital"` (adm0cap=1). Snappa varje huvudstad till närmaste landcell med samma country-id (BFS högst 3 celler); länder utan sådan post får sin mest centrala landcell. Hamnar saknar landfält: härled land från country-id vid den snappade kustcellen.
6. `src/data`: laddare med typade vyer. ALLA datapack laddas via `public/data/manifest.json` (`{namn: {file, enc: "raw"|"b64"}}`; bake-verktyget skriver det; standardbygget pekar på `.bin.gz` rått, ett Artifact-bygge (`npm run artifact:pack`, M00b) på en annan behållare; `enc: "b64"` är base64-text som avkodas till bytes före gzip-magic-kontrollen). Manifestets adress kommer från `siteUrl("data/manifest.json")` (src/app/paths.ts från M00b; även från debug-sidor och Workers); packfilerna löses relativt manifestet (`new URL(file, manifestUrl)`). src/data importerar aldrig paths.ts: manifestadressen och `readBytes` injiceras från src/app. b64 avkodas med `Uint8Array.fromBase64` om den finns, annars med en vanlig for-loop över atob-strängen (charCodeAt), aldrig `Uint8Array.from(atob(s), fn)` (åtta gånger långsammare). Ett enhetstest laddar samma pack via `raw` och `b64` och får identiska bytes. Laddaren tar en injicerad `readBytes(path): Promise<Uint8Array>`; fetch + DecompressionStream i webbläsaren; fs-varianten ligger bara i tests/tools och importeras aldrig från src/data. Kolla gzip-magic 1f 8b innan du avkomprimerar (servern kan ha gjort det). Validera fnv1a med ren TS (fungerar utan secure context). En korrupt byte ska avvisas.
7. `npm run bake:check` verifierar committade filer utan nätverk. `CREDITS.md` och `docs/ASSETS.md`: Mapzen/USGS SRTM, NOAA ETOPO1, Natural Earth och en ärlig rad om att terrängen är stiliserad. Joerd-attributionssidan når du inte: skriv en generell källrad och notera luckan i Known issues.
8. `debug/data.html` (Vite flersidigt) som ritar klass-, höjd- och landskarta på canvas. Läget väljs med `?map=class|height|country` ELLER ankaret `#map-class`, `#map-height`, `#map-country` (hash-grammatiken i M02 punkt 10) OCH med tre knappar på sidan. Tills Dev-panelen finns (M02) har index.html en länkrad "Debug: klasskarta / höjdkarta / landkarta" med RELATIVA länkar (`./debug/data.html#map-class` osv.). Absoluta adresser som `/debug/...` är förbjudna överallt (också Dev-panelens länkar i M02).

REGLER, TAL OCH GRÄNSSNITT
- Total committad data <= 6 MB gz. Packs laddas råa, aldrig via PNG eller ImageBitmap.
- Landceller exkl. Antarktis i [110k, 145k] (ca 126k väntas; justera EN gång och skriv varför).
- Rutnätet är lat/lon: cellbredden i km beror på latituden; bakningen är km-medveten (cos-lat-viktad area).
- Ingen kod från andra spel. Natural Earth är public domain, Terrarium kräver attribution.

UTANFÖR OMFATTNING
Rendering av jorden i 3D (M02), simens regler och paketladdning i sim (M03–M04), floder, flaggor, menyer, streaming av tiles, nya externa datakällor.

ARBETSSÄTT
Enligt CLAUDE.md. Kör bakningen i bakgrunden med loggfil. Stoppregel: nås inte maxkoderna nedan efter korrekt avkodning, stanna och rapportera de uppmätta värdena; försvaga inte testet.

ACCEPTANS
- `npm run bake` två gånger ger identiska nyttolaster (sha256 av okomprimerat) och identiska .gz på samma maskin; `npm run bake:check` passerar utan nätverk.
- Tester på committad data: Sverige cos-viktad area inom 8 % av 450 000 km2 (ca 650 celler); Ryssland är störst; ingen landcell < 1 m och ingen havscell > -1 m; maxhöjdskoden avkodas till >= 6000 m i Himalaya-boxen (lat 26..36, lon 75..95), >= 5500 m i Andes-boxen (lat -40..10, lon -80..-60; uppmätt 6034 m) och >= 3000 m i Alp-boxen (lat 44..48, lon 5..15; uppmätt 3358 m); inget cellmax > 8900 m utanför Himalaya/Karakoram-boxen (lat 26..40, lon 60..105); Nederländernas medelhöjd < 100 m (medelhöjdslagret); Himalaya-, Alp- och Andes-boxar innehåller Mountain-celler; Peak-andel 0,3–1,5 % och Mountain-andel (exklusive Peak) 8–18 % av non-Ice-landceller.
- Loggat antal länder med >= 8 celler (ca 150–170 väntas, overifierat); varje sådant land har en huvudstadscell med landmask 1 och country-id lika med landets id.
- `npm run build && npm run artifact:pack` på de riktiga packen: varje fil i files.json < 15 MB, summan < 64 MB, och `e2e/artifact.test.ts` (från M00b) laddar debug/data.html och validerar checksummorna via vald behållare (raw och b64).
- Totalt <= 6 MB gz; en korrupt byte avvisas av laddaren; laddning + parsning loggas i Node och Chromium (mål 300 ms; median av 5 laddningar <= `budgetMs(1500)`).
- Playwright-skärmdump av debug-sidan: icke-blank; andel pixlar som inte är DeepSea/Shallows (Ice inräknat) i klasskartan i [30 %, 40 %] (uppmätt ca 33 %); andel non-Ice land i [20 %, 28 %]; golden committad enligt golden-regeln; `npm run verify` grönt.

SLUT
Enligt CLAUDE.md (PROGRESS.md, DECISIONS.md med alla trösklar och kodningskonstanter, ARCHITECTURE.md-indexet). Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjorts, vad som avvek, uppmätta box-maxima och klassandelar, och exakt hur jag öppnar debug-sidan: länkraden på startsidan (Artifact) eller `?map=class|height|country` / `#map-class|height|country`.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- Öppna debug-sidan via länkraden "Debug: klasskarta / höjdkarta / landkarta" på startsidan (eller `?map=...` / `#map-...` enligt docs/PREVIEW.md) och kolla att kontinenterna känns igen i alla tre kartorna.
- Om din app visar usage: skriv `Usage efter M01: 5h NN %, vecka NN %` som första rad i M02-prompten. Jämför med planen (cirka 7 h Claude-arbete ≈ 1,3 fönster).

## M02 — Wow 1: den stiliserade 3D-jorden

| | |
|---|---|
| **Kräver** | M01 mergad |
| **Beräknad insats** | ~5,3 h agentarbete (3–10 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — gate: öppna spelet på en dator med riktig GPU, titta på jordens stil, tryck F2 (Dev-panelen) och kopiera perf-rapporten; skicka alltid perf-JSON och FPS (stilen rätt eller fel räcker med "ok"; mallen "Feedback efter en gate" bara när något är fel) |
| **Du ser efteråt** | En roterande, solbelyst jord med riktiga berg, hav, atmosfär och nattljus som du kan snurra, zooma och hovra över för att se land, terrängklass och höjd, plus en Dev-panel (F2) och en perf-rapport du kan kopiera. |

**Klistra in i en ny session:**

```text
Du bygger milestone M02 (Wow 1: den stiliserade 3D-jorden) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md, docs/PREVIEW.md, src/data (laddarna från M01) och public/data/meta.json.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M01 är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M01 i milestonetabellen i docs/PROGRESS.md.

MÅL
Få en vacker, nolltillgångs-3D-jord på skärmen tidigt så att jag ser den visuella riktningen: riktiga berg, hav, atmosfär, gränser, nattljus och en mjuk kamera. Detta är den första gaten som kräver riktig GPU: jag tittar på den.

GÖR
Checkpoint A: punkt 1, 2 (utan nattljus), 5, 6, 7 och kvalitetsnivåerna ur punkt 8; test-tier och `?test=1`-krokarna ur punkt 9 (inklusive fx-klockan) UTAN goldens; öppna DRAFT-PR när `verify:fast` är grönt. Checkpoint B: punkt 3 (hav, atmosfär, terminator), 4, resten av 8 och 10. Sist: stjärnor, nattljus, solglitter, och först därefter de 6 goldens (committas EN gång) och natt-/limb-/glitterpixlarna. Är A inte grönt efter ca 2,5 timmars arbete (eller vid tydlig kontextbrist): flytta nattljus, stjärnor och glitter, med deras acceptans, till docs/BACKLOG.md och säg det. B får aldrig skäras bort.
1. Texturer: höjd (R8, 4096x2048), bathymetry, country-id (nearest, NoColorSpace, flipY false, unpackAlignment 1) och sim-paketets klasslager som DataTextures direkt från råa bytes.
2. Glob: lat/lon-nät med vertex-shader-förskjutning från höjdtexturen (ca x12; avkoda sqrt-kodningen från meta.json), derivata-baserad flat shading (dFdx/dFdy), hypsometrisk färgskala med snö, biomton från klasslagret, kustfärg från bathymetry. Kusten skuggas från masken i fragment-shadern så att grovt nät inte ger fel kustlinjer (M07 ersätter nätet med LOD).
3. Hav: Fresnel, solglitter, animerade normaler (frysta i testläget). Atmosfär: baksides-additivt skal. Stjärnor: seedade punkter. Sol med dag/natt-terminator. Nattljus från cities.json (t.ex. en 1024x512 ljustextur ritad på CPU).
4. Länder: svaga gränser från id-rastret med fwidth och grannjämförelse (inte kust mot hav), färgpalett som LUT.
5. Shaderkod i moduler under `src/render/shaders/` (terrain, ocean, atmosphere). ShaderMaterial i three r186: skriv till `gl_FragColor`, deklarera inga egna `out vec4`.
6. Kamera: orbit/arcball med tröghet, zoom förankrad vid markören, tiltgräns, polsäker up-vektor, zoomgränser. Mus och scrollhjul nu; touch kommer i M08.
7. Picking: stråle mot sfär, förfinad mot förskjutna höjder (CPU-kopia av höjddatan), lat/lon till sim-cell (x = golv((lon+180)/360*1024), y = golv((90-lat)/180*512)). Hover-tooltip: land, terrängklass, höjd i meter.
8. Kvalitetsnivåer test/low/medium/high i `src/render/quality.ts` (test = 256x128-nät; high <= ca 1 M trianglar). `?quality=` väljer, `?test=1` tvingar test. `?perf=1` (Artifact: `#perf`): överlägg med renderer-sträng, fps (medel och p95), renderer.info (anrop, trianglar, geometrier, texturer), texturminne i MB och en knapp "Kopiera rapport".
9. `window.__test.setView({lat, lon, distKm, heading, tilt, time})` och render(); skapa även `__test.project(lat, lon)` (skärmkoordinater) och `__test.advance(dt)` (stegar bara fx-klockan; M05 utökar advance med sim-ticks). Fx-klockan: `src/render/clock.ts` exporterar `fxNow()`, `advanceFx(dt)` och `setFxTime(t)`; i `?test=1` stegas den bara av `__test.render/advance/setView`; ALLT kosmetiskt (flyTo, ägar-uppladdningsstrypning, toasts, kamerafärder, fx, tutorialens ledtråd, autosave-timer) läser den, och inga andra klockor skapas i senare milestones (enhetstest). Kontaktblad med 6 kanoniska vyer och goldens: hela jorden, Europa med 50 graders lutning, Himalaya, Anderna, Alperna, nattsidan.
10. Dev-panel och rapporthjälp. `src/app/devpanel.ts` (öppnas med F2 och en liten knapp i hörnet; knappen ska synas och gå att trycka på en telefon, där F2 inte finns) med `registerDevMode({id, label, run})`; registrera `?perf=1`-läget och den RELATIVA länken `./debug/data.html` (aldrig `/debug/...`). Varje senare ?-läge (perf, scene, scenario, view, debugsidor, seed) registreras där så att jag aldrig behöver ändra adressfältet. Appen läser `location.search` och `location.hash` genom EN parser, `src/app/params.ts`. Hash-grammatik (bara tecknen A–Z a–z 0–9 - . _ ~): token = `nyckel` eller `nyckel-värde` (delas vid FÖRSTA bindestrecket), tokens skiljs med `_`; `nyckel` utan värde betyder `nyckel=1`. Alltså `#perf` = `?perf=1`, `#scene-perf` = `?scene=perf`, `#scenario-slice_sam-1` = `?scenario=slice&sam=1`, `#view-alps-valley` = `?view=alps-valley`, `#seed-7` = `?seed=7`. Finns nyckeln i båda vinner hash. Appen lyssnar på `hashchange` och startar om läget (annars måste användaren ladda om). Dev-panelens `run` sätter `location.hash` och laddar om, aldrig `location.search`. Enhetstest: parsern ger identiskt resultat för varje registrerat ?-läge. Anledningen: en Artifact-länk kan inte bära `?parametrar`, men ett ankare når sidan. Uppdatera tabellen "?x=y blir #x-y" i docs/PREVIEW.md (skapad i M00b) med grammatiken och de registrerade lägena. `src/ui/report.ts` med `showReport(json)`: visar JSON i en markerbar textarea med en Ladda ner-knapp (kan vara overksam i en Artifact: textrutan är den riktiga reservvägen) och försöker `navigator.clipboard` först (anropet måste ske inne i klickhanteraren); alla "Kopiera rapport"-knappar använder den. Perf-JSON har ett `schemaVersion`-fält (M08 och M24a utökar den, ingen andra knapp).

REGLER, TAL OCH GRÄNSSNITT
- Endast WebGL2, handskriven GLSL ES 3.00 via ShaderMaterial; inga nya paket.
- Testläget är deterministiskt: tid fryst, ingen rAF, DPR 1, 960x540. Packs laddas råa utan färgkonvertering.
- Överdrift och sol är konstanter i EN config-fil i src/render.

UTANFÖR OMFATTNING
Quadtree/LOD (M07), RTS-kamera och touch (M08), ägandeöverlägg (M05), byggnader, enheter, sim, UI utöver hover, perf och Dev-panel, post-processing, ljud.

ARBETSSÄTT
Enligt CLAUDE.md. Ta en skärmdump per shader-funktion (ingen GPU). Ingen SwiftShader-tid assertas: skärmdumpstid och första bildruta loggas i PROGRESS.md, hängvakt 20 s.

ACCEPTANS
- Testnivå: renderer.info trianglar <= 150k och draw calls <= 30 (gäller bara glob-scenen); noll console-fel.
- Alla 6 vyer är icke-blanka, parvis olika och mot goldens enligt golden-regeln (två renderingar identiska, pixelmatch threshold 0.1, <= 0,2 % avvikande pixlar); luminansvariansen i Himalaya-vyn ligger över en tröskel jämfört med en platt kontroll (överdrift 0).
- Pixelkrav i testläget: för var och en av städerna Tokyo, New York och Stockholm: `setView` centrerad på staden med distKm 2500 och `time` satt så att staden ligger på nattsidan; luman vid stadens projicerade pixel (`__test.project`) är >= havsgrannens luma + 25. Den kanoniska nattsidovyn kräver bara att nattsidans medelluma < dagsidans / 3 och att minst 20 ljuspixlar > 150 finns. En limb-pixel (yttersta ringen) på solsidan är >= 10 luma ljusare än rymdbakgrunden; en glitterpixel är ljusare än havets medelvärde på solreflektionssidan.
- Picking: kamera centrerad på 59,3N 18,1E ger Sverige i skärmmitten; en stråle mot Mount Everests koordinater (27,99N 86,93E) ger rätt cell inom 1 cell.
- Datatexturer: texel-readback (liten render-till-target-pass) lika med källbyten; kameramatte: inga NaN, stabilt vid polerna, zoomgränser hålls.
- Dev-panelen: F2 öppnar den, `perf`-läget växlar överlägget (e2e); `#perf` ger samma läge som `?perf=1` (e2e), ändrad hash startar om läget utan omladdning, och hörnknappen syns i en 390x844-viewport. `showReport` med avvisad clipboard visar JSON i textarean och en fungerande Ladda ner-länk (e2e).
- JS-bundle <= 300 KB gz (data utanför); växer den: rapportera, urvattna inte budgeten. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md. Skapa i docs/ARCHITECTURE.md avsnittet "Budgetar": en tabell lager / test-tier trianglar / test-tier draw calls (start: glob <= 150k trianglar, <= 30 anrop). Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska med vad som gjorts, vad som avvek, en "Så spelar du"-ruta (mus: snurra, zooma, hovra; F2; F3) och exakt hur jag öppnar sidan och perf-läget (Artifact: länken + `#perf`; lokalt/Netlify: `?perf=1`; alltid också via F2 eller hörnknappen). Lista vad jag ska titta på på min GPU: (1) reliefen när jag zoomar mot Himalaya och Alperna, (2) nattsidan med stadsljus, (3) hover-tooltip, (4) atmosfär och hav, (5) öppna perf-läget, tryck Kopiera rapport och ge mig JSON-rapporten.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- Öppna spelet på en dator med riktig GPU enligt docs/PREVIEW.md. Snurra jorden, zooma till Himalaya och Alperna, titta på nattsidan, hovra över länder, tryck F2 (eller hörnknappen) och öppna perf-läget (Artifact: `#perf`).
- Skicka alltid JSON-rapporten och FPS (i en ny session, tillsammans med "ok" om stilen känns rätt). Om Claude skrev att nattljus/stjärnor/glitter flyttats till BACKLOG saknas de med flit (nattstäder kommer i M21). Det är inget fel; gå vidare.
- Fel eller stört? Använd mallen "Feedback efter en gate" (under Mallar i den här listan) i en ny session, merga fixen och först därefter nästa milestone. Smakfrågor kan vänta till BACKLOG.

## M03 — Sim-grund: determinism, intents, host-söm

| | |
|---|---|
| **Kräver** | M00 mergad |
| **Beräknad insats** | ~2,5 h agentarbete (1,5–4,2 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Inget visuellt: Claude visar i svaret att simuleringen ger exakt samma kontrollsumma (hash) i Node och i webbläsaren. |

**Klistra in i en ny session:**

```text
Du bygger milestone M03 (Sim-grund: determinism, intents, host-söm) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md (invarianterna), docs/PROGRESS.md, docs/ARCHITECTURE.md, eslint.config.js (determinismförbuden), scripts/shot.mjs och tests/perfguard.ts.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M00 är mergad i main (M03 beror bara på M00, men listan följs i ordning så M01 och M02 är normalt också klara); annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för föregående prompt (nämn dess id) i milestonetabellen i docs/PROGRESS.md.

MÅL
Bygg det rena simskelettet så att determinism, serialisering, intents och host-sömmen är bevisade innan några spelregler finns. Allt senare (strider, AI, multiplayer) vilar på detta.

GÖR
1. `src/sim`: `rng.ts` (sfc32 seedad via splitmix32; tillståndet är en Uint32Array(4) INUTI det serialiserade speltillståndet), `detmath.ts` (heltals-isqrt, fixpunktshjälpare, Q15 sin/cos-LUT som genereras av `tools/gen`, committas och regenereras i ett test), SoA-`GameState` som är PARAMETRISERAT med (width, height). Goldens använder en syntetisk fixturvärld 128x64 byggd med heltals-hash-brus (Math.imul, inga floats); prestandatestet bygger ett tomt 1024x512-tillstånd. Säten är 0-baserade; `ownerId = seat + 1` (0 = oägd); EN hjälpare `seatToOwner/ownerToSeat` i src/sim/state.ts, inga andra omvandlingar. Typerna Tick och Turn.
2. Intents: diskriminerad union med validering och kompakt binär codec. Definiera bara `Noop` och `DebugPaint{seat, cell}` (giltig bara om matchkonfigen har debugIntents; M04 ersätter dem med Spawn/Attack). Varje intent har ett id; ordning inom en turn avgörs av (seat, id). `step(state, turnIntents)` tillämpar intents schemalagda för T+2. Ogiltiga intents blir no-ops och ökar en reject-räknare. Ett render-only outbox som INTE ingår i hash eller serialisering.
3. `serialize/deserialize/hash` (FNV-1a över 32-bitarsord av alla tillståndsarrayer i fast ordning) med formatversion och matchhuvud `{engineVersion, mapHash, seed, config, seats}`. Felaktiga bytes ger ett felresultat, aldrig ett kast ut ur step().
4. `src/host`: `SimHost`-gränssnitt (submitIntent, subscribe för snapshots/diffs, setSpeed), `MainThreadHost`, `LocalTransport` och en fixed-timestep-ackumulator (10 Hz, pause/1x/2x/4x, tak 8 ticks per frame). Worker-redo: inga delade objektreferenser över gränssnittet (kopiera data).
5. CLI: `npm run sim:run -- --seed N --ticks T` skriver hash vid ticks 1/10/100/1000/6000 och slutligen.
6. Golden-hashar vid tick 1/10/100/1000/6000 i EN committad fil (e2e/goldens/sim-hashes.json) som både Node-testet och ett Playwright-test läser. Chromium-testet laddar en liten `debug/sim.html` (relativ adress, aldrig `/debug/...`) som kör simen och exponerar hasharna. Ett test startar `worker_threads` och jämför mot huvudtrådskörning.
7. Känslighetstester så att en stubb inte klarar sig: annan seed ger annan hash vid tick 10/100/1000; en DebugPaint av en cell ändrar hashen; att vända en byte i varje tillståndsarray ändrar hashen (ett negativt test per array); en medvetet icke-deterministisk kopia av step (läser Math.random i en test-only-modul) MÅSTE få golden-testet att fallera; och en Float64-kanariekärna (sqrt/mul/div-loop över 1e5 värden, `src/sim/canary.ts`) vars hash är lika i Node och Chromium, som bevis för den korsmotorväg senare milestones räknar med.

REGLER, TAL OCH GRÄNSSNITT
- src/sim: ren TypeScript, inga DOM, three, Date, Math.random eller andra förbjudna API:er (lint). Tillstånd är typade arrayer eller vanliga heltal. `tools/gen` utanför får använda Math.sin/cos för att generera LUT:en.
- Tick-takt 10 Hz. Inga spelregler. Alla framtida konstanter hör hemma i src/sim/rules.ts; skapa filen med bara tick-takt och turn-schemaläggning, med UPPER_SNAKE_CASE-exporter.
- Intents får aldrig mutera tillstånd utanför step().

UTANFÖR OMFATTNING
Territorium, trupper, guld, strid och världsladdning från packs (M04), UI/rendering (M05), Web Worker i webbläsaren (M24a), nätverk (M26), AI.

ARBETSSÄTT
Enligt CLAUDE.md. Tidsgränser i tester via `budgetMs` (tests/perfguard.ts) i `*.perf.test.ts`.

ACCEPTANS
- Golden-hashar lika i Node och i Chromium vid alla 5 tickpunkter; känslighetstesten i punkt 7 passerar (inklusive att den icke-deterministiska kopian fallerar).
- fast-check (500 körningar): samma seed + intents ger samma hash; snapshot vid tick k + återstående intents == rak körning; worker-körning == huvudtråd; intentordning inom en turn löses med id-tie-break.
- Ett test som ersätter Math.random och Date med funktioner som kastar under step() passerar; lint-självtestet passerar.
- Codec: round-trip för 10 000 slumpade intents; felformade bytes kastar aldrig ut ur step().
- Tomt världssteg på 1024x512: median <= `budgetMs(1)` i Node (mätvärdet loggas).
- `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; skriv i DECISIONS.md t.ex. LUT-storlek och Noop/DebugPaint, och i ARCHITECTURE.md SimHost samt intent- och turn-flödet. Öppna en DRAFT-PR. Inget användarsynligt ändras: publicera inte om Artifacten, skriv bara "ingen ny publicering" i svaret. Svara på svenska: vad som gjorts, vad som avvek och exakt vilka kommandon och hashar jag kan jämföra.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- Du behöver inte testa något visuellt. Vill du se beviset: be Claude i en ny session köra `npm run sim:run -- --seed 7 --ticks 6000` och jämföra med webbläsartestet.

## M04 — Territorie-sim: trupper, guld, terrängmedveten erövring

| | |
|---|---|
| **Kräver** | M01 och M03 mergade |
| **Beräknad insats** | ~3,6 h agentarbete (2,1–6,1 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | En loggutskrift i Claudes svar över en 10-minuters världserövring med territoriekurvor per minut. Det syns på skärmen först i M05. |

**Klistra in i en ny session:**

```text
Du bygger milestone M04 (Territorie-sim: trupper, guld, terrängmedveten erövring) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md (invarianterna och världsmodellen), docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet, src/sim (rng, detmath, state, intents, step, hash, serialize, rules.ts), src/host, src/data samt public/data/meta.json.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M01 och M03 är mergade i main (listan följs i ordning, så M02 är normalt också klar); annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M03 i milestonetabellen i docs/PROGRESS.md.

MÅL
Ett headless, deterministiskt erövringsspel på den riktiga 1024x512-världen där berg och sluttningar ändrar kostnaden. Siffrorna är otestade startvärden; därför styrs allt av en enda balansfil och ratio-tester i stället för magiska tal.

GÖR
1. Simvärld: ladda sim-paketet (via src/data; i Node via fs-varianten, sim importerar inte src/data) och bygg `SimWorld` i src/sim; världen skickas in. `grid.ts`: x-wrap, 4-grannar, `cellKm(lat)` och cos-lat-cellvikter från den committade radtabellen (Q15). Hav-, Shallows-, DeepSea-, Ice- och Peak-celler är ospelbara/ofarbara. GameState är redan parametriserat med (width, height) från M03; här används 1024x512.
2. `src/sim/rules.ts` är den enda balansfilen (UPPER_SNAKE_CASE), med en std-cell-omvandlare: regelverket är portat från en 512x256-design, en std-cell = 2x2 simceller (avstånd x2, areor x4, hastigheter x2). Skapa `docs/BALANCE.md` med en tabell över varje konstant (namn, värde, enhet, källa "plan" eller "eget val").
3. Ekonomi (per sekund, tick = 0,1 s, heltal/fixpunkt eller Float64 med bara + - * / sqrt): trupptak = 2000 + 120*N^0,75 + 800*stadsnivåer, N = ägd area i std-cells (cos-viktad), N^0,75 = sqrt(N)*sqrt(sqrt(N)); återhämtning = max((8 + 0,35*sqrt(T))*(1 - T/Tmax), -MAX_DECAY) per sekund; guld från viktad mark (bas så att 500 startguld räcker en stund); start 1200 trupper, 500 guld; huvudstadsskiva med radie 8 celler. Spawn tar de K närmaste sammanhängande oägda landcellerna (K = START_DISC_CELLS = 197, heltalspunkter i radie-8-skivan) i avståndsordning med hash-tie-break; en mindre landmassa ger alla sina celler. Klampa T >= 0 efter varje avdrag.
4. Erövring: `Attack`-objekt med inkrementella frontlistor (hash-tie-break, ingen fullskanning per tick). ENHETER: formlerna gäller per STD-cell (2x2 simceller). Per simcell är kostnaden en fjärdedel: lagra trupptal och kostnader i kvartstruppar (heltal, fixpunkt för multiplikatorerna, ingen ceil till hela trupper per cell), så att en Plains-cell kostar ca 0,75 trupper. Fångsthastigheten är i celler per SEKUND i std-cell-enhet och omräknas till simceller x4 (och per tick /10). Fångsthastighet = CAPTURE_K*sqrt(L)*2F/(F+Td), startvärde 0,08 (en enkel analytisk modell antyder 0,08–0,09; verkliga kontinenter och berg ger lägre värden, så räkna med 0,06–0,15), där L = kontaktlängd mot målet i celler, F = angriparens insatta trupper, Td = försvararens trupper; är F + Td == 0 är hastigheten 0. Kostnad per std-cell = BASE_COST (3) * terrängMult * högMark * (1 + d/20); terrängMult Plains 1,0 / Forest 1,3 / Hills 1,6 / Mountain 2,5 / Peak oframkomlig; uppförsbacke = 1 + 0,25*dh/32 med tak x2, nedförsbacke 1,0; försvararen förlorar ingen terrängterm. d = hur djupt målcellen ligger i försvararens område (0 vid fronten), begränsat till D_MAX (förslag 40); dh i en dokumenterad höjdenhet via en konstant i rules.ts; välj den billigaste inkrementella definitionen och skriv beslutet i DECISIONS.md. Ömsesidiga attacker avbryter varandra. Enklavsflipp var 20:e tick, förskjuten med hash(id). Stammar (bots): trupptak/3, återhämtning x0,5, attack med T/20. Landandel per säte. Intents: Spawn{seat,cell}, Attack{target,pct} (target = ownerId, 0 = oägd mark; pct av nuvarande trupper), CancelAttack; de ersätter Noop/DebugPaint som huvudintents (behåll fixturvärlden för M03-testerna).
5. Headless scenario-CLI: `npm run sim:scenario -- --seed N --minutes 10 --players 12 --tribes 20` skriver territoriekurvor per minut, samt ett solo-scenario för kalibrering. Skript-botar ligger i tools/, inte i src/sim.
6. Kalibrering: justera CAPTURE_K och BASE_COST i rules.ts tills solo-banden håller. Högst 3 justeringsvarv. Når du inte banden: skriv den uppmätta kurvan i DECISIONS.md och sätt bandet till uppmätt värde +/-30 % (den enda tillåtna bandändringen, med motivering). M09 och M12 återanvänder det (ev. justerade) bandet.
7. Tester: golden-hashar uppdateras (skäl i DECISIONS.md), ratio-tester, frontier-invarianter, arbetsräknare.

REGLER, TAL OCH GRÄNSSNITT
- Alla konstanter i rules.ts, inget annat ställe. Tester använder förhållanden och band.
- Allt på determinismlistan är förbjudet i src/sim. Inga Map/Set med nyckelordning som påverkar utfall; hash-tie-break i stället. Allt tillstånd är typade arrayer och heltal; PRNG-tillstånd i serialiserat tillstånd.
- Säten och ägare: seat är 0-baserad, `ownerId = seat + 1`, stammar får ownerId P+1..P+T (Uint16), 0 = oägd. Intents använder seat, ägararrayer använder ownerId; bara hjälparen från M03.

UTANFÖR OMFATTNING
Byggnader och stadsnivåer (M09; stadsnivåer = 0 tills vidare), rendering och UI (M05), AI (M05, M16), helikoptrar, missiler, hemlandsrabatt och egenskaper (M06), segervillkor (M18).

ARBETSSÄTT
Enligt CLAUDE.md. Stämmer inte siffrorna: justera rules.ts, inte testet (förutom bandregeln i punkt 6). Kör scenariot i bakgrunden.

ACCEPTANS
- Ratio-tester vid lika kontaktlängd: 4:1 trupper ger >= 1,4x och 1:4 <= 0,6x fångsthastigheten vid 1:1; Mountain kostar angriparen >= 2,2x Plains; uppförsbacke kostar mer än nedförsbacke över samma cellpar; ingen division med noll, inga negativa trupper, d <= D_MAX (enhetstester med F = 0 och Td = 0).
- Frontier-egenskapstest: fronten == brute-force-omräkning efter 1000 slumpade steg; en enklav omsluten av en spelare flippar inom 20 ticks.
- Arbetsräknare är primär gräns: skannade celler per tick är proportionella mot frontlängd + ändrade celler och aldrig en fullskanning av världen. Tick-kostnad p95 (över >= 200 ticks efter 50 uppvärmningsticks) <= `budgetMs(4)` med 12 spelare + 20 stammar på riktiga världen i Node; en erövring av 100 000 celler i en tick, median <= `budgetMs(50)`; tiderna loggas (`*.perf.test.ts`).
- Kalibreringsband för en solo-expanderare (provisoriskt): ca 1 500–2 500 landceller efter 5 min och 5 000–8 000 efter 10 min (eller det motiverade bandet enligt punkt 6).
- Golden-hashar identiska i Node och Chromium; snapshot == rak körning med territorium aktivt; inga förbjudna API:er; `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; skriv i DECISIONS.md tolkningen av d, dh, enheterna och kalibreringsvarven, och uppdatera docs/BALANCE.md. Inget nytt syns på skärmen. Öppna en DRAFT-PR. Svara på svenska: vad som gjorts, vad som avvek, scenario-loggen i korthet, uppmätta solo-siffror och exakt vad jag kan testa.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- Det finns inget att se på skärmen än. Vill du se territoriekurvan: be Claude i en ny session köra `npm run sim:scenario -- --seed 7 --minutes 10`. Siffrorna finjusteras först i M19.

## M05 — Wow 2: första spelbara erövringen på globen

| | |
|---|---|
| **Kräver** | M02 och M04 mergade |
| **Beräknad insats** | ~4,9 h agentarbete (3–9,6 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — gate: spela ca 10 minuter på en riktig GPU och skicka alltid FPS (via F3 eller perf-läget: Artifact `#perf`, eller F2); hur det känns (tempo, läsbarhet av gränser, hur berg bromsar) räcker med "ok", mallen "Feedback efter en gate" bara när något är fel |
| **Du ser efteråt** | Du klickar på 3D-planeten och ser din färg flyta över land, långsammare i Alperna och Himalaya, medan AI-nationer och stamfolk (små neutrala bot-nationer) växer runt dig. |

**Klistra in i en ny session:**

```text
Du bygger milestone M05 (Wow 2: första spelbara erövringen på globen) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md, docs/BALANCE.md och, via indexet, src/host, src/sim (intents, step, rules.ts), src/render (globe, shaders, camera, picking, quality), src/app/devpanel.ts, src/ui/report.ts och src/data.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M02 och M04 är mergade i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M04 i milestonetabellen i docs/PROGRESS.md.

MÅL
Koppla ihop sim och renderare så att jag kan spawna, se min nation sprida sig över 3D-terräng och runt berg, och slåss mot stamfolk och en enkel AI. Detta är spelbarhetsgaten: jag spelar ca 10 minuter på en riktig GPU.

GÖR
Ordning: (1) punkt 1–3 gröna med tester; (2) punkt 4 och 7 (HUD, startskärm); (3) punkt 6 (AI v0). Är (1) och (2) inte gröna efter ca 2,5 timmars arbete (eller vid tydlig kontextbrist): committa, öppna DRAFT-PR med det som är klart, skriv "AI v0 återstår" i Now/Next och säg att jag ska köra en resume-session med den här prompten för att slutföra AI v0. Då skriver du först i PR-beskrivningen och i svaret texten MERGA INTE; gate-testet görs efter resume-sessionen.
1. Renderadapter som läser SimHost-snapshots (60 Hz-loop, interpolation av HUD-värden) och hastigheter pause/1x/2x/4x. Snapshot bär en kopia av ägararrayen (när den ändrats) och per-säte-statistik (trupper, tak, guld, guld/s, celler, viktad landandel, levande); bara typed-array-kopior, aldrig referenser till sim. Skapa `src/sim/view.ts` med `SimView`: en skrivskyddad, snapshot-bunden vy (bredd, höjd, tick, ägararray, klasslager, per-säte-statistik) som UI och AI läser. Dokumentera snapshot-tillväxten i ARCHITECTURE.md.
2. Ownership-textur RGBA8 1024x512 (owner u16 i R+G, flaggor i B, reserv i A), HELT omuppladdad högst 10 Hz när den är smutsig (strypningen läser fx-klockan, src/render/clock.ts från M02, så att testläget styr tiden; skapa ingen egen klocka), palett-LUT. Territorietint och skarpa gränser i terrängshadern med fwidth och en UV-domain-warp (sin-fritt heltalsbrus i GLSL) så att gränserna ser organiska ut; ägande ritas bara där höjdtexturen är land.
3. Spawn-fas 20 s (200 ticks): klicka på giltig mark för att spawna; 5 s immunitet efter fasen. Därefter: klicka på fiende- eller oägd mark för att anfalla (Attack med target = ägaren där du klickade). Insatsreglage 5–100 % (steg 5, standard 40) och tangenterna `[` och `]`. Mellanslag = paus, `,` och `.` = långsammare/snabbare.
4. DOM-HUD med data-testid: guld med +/s, trupper med takstapel och varning vid 80 % av taket, landandel i %, timer, topp-5-ledartavla + du. (Flytande nationsetiketter hör till M20.) i18n: `src/ui/i18n.ts` exporterar `t(key, params?)` med två tabeller, `sv` (standardspråk) och `en`; varje ny sträng läggs i BÅDA i samma commit; testläget fallerar på en nyckel som saknas i någon av dem; ett paritetsenhetstest. Lägg i18n-regeln i CLAUDE.md.
5. Debug-hooks: `?seed=` och `?test=1` (hash-formerna `#seed-7` och `#test` ger samma resultat via parsern i M02) med `__test.advance(n)` (utöka M02:s advance med sim-ticks), `__test.state()`, `__test.project(lat,lon)` (finns från M02; används för klick) och `__test.give(seat, {gold, troops})`, som skickar ett test-only `DebugGive`-intent (giltigt bara när matchkonfigen har debugIntents; muterar aldrig tillstånd direkt; M09 utökar det med byggnader). Räknare för ownership-uppladdningar. Registrera seed-fältet (id "seed") och den relativa länken `./debug/sim.html` i Dev-panelen.
6. 20 stamfolk vid start. AI v0 i `src/ai` för 5 nationer: ren funktion `think(view: SimView, memory, rng) -> Intent[]`; spawnar under spawn-fasen på seedade giltiga platser; expanderar när trupper >= 50 % av taket; anfaller den svagaste grannen; tänker förskjutet per säte. `src/sim/public.ts` skapas som barrel för rena skrivskyddade hjälpare (`seatToOwner`, `ownerToSeat`); src/ai får importera ENDAST `SimView` och `src/sim/public.ts` (ESLint-allowlist + typtest; aldrig step, mutatorer eller skrivbara arrayer). `src/sim/public.ts` re-exporterar även (type-only) Intent-typerna och Intent-konstruktorerna samt de rules.ts-konstanter AI:n läser; src/ai importerar aldrig src/sim/rules.ts direkt. Värden anropar AI:n vid tickgränser med eget minne och egen PRNG (inte UI), intents schemalagda T+2 (M09 flyttar detta till `src/host/aiDriver.ts`).
7. Startskärm med en Play-knapp och en liten Dev-knapp.

REGLER, TAL OCH GRÄNSSNITT
- UI och AI emitterar bara intents; UI muterar aldrig sim-state; sim importerar inte three, DOM eller render.
- Ownership-textur RGBA8 (three:s updateRanges antar RGBA); full omuppladdning ca 2 MB, <= 10 Hz oavsett simhastighet.
- Nya balansvärden i src/sim/rules.ts; UI-konstanter (färger, reglagesteg) i en UI-config.

UTANFÖR OMFATTNING
Meny för riktiga länder/egna nationer och flaggor (M06), byggnader (M09–M10), LOD och RTS-kamera (M07–M08), nationsetiketter och minimap (M20), helikoptrar, missiler, segervillkor (M18), ljud, spara/ladda, diplomati.

ARBETSSÄTT
Enligt CLAUDE.md. Ta en skärmdump per delmål.

ACCEPTANS
- Playwright (`?test=1&seed=7`; `#test_seed-7` ger samma match): spawn vid fasta koordinater, `advance` 600 ticks, spelarens landandel över startvärdet; HUD-värden lika med sim-värden (data-testid); skärmdumpar vid tick 0/100/300/600.
- Negativa e2e: spawn på hav, Peak eller Ice avvisas (state oförändrad, reject-räknaren +1); attack på egen mark och spawn efter fasen avvisas; pct 0 avvisas.
- Ownership-readback lika med ägararrayen i 200 samplade celler; uppladdningsräknaren <= 10 per sekund (fx-klockan) oavsett simhastighet.
- Gränser: vid en gränscell på en Mountain-cell skiljer sig gränspixelns färg från både egen och grannens färg med CIE76 dE >= 15; paletten har dE >= 25 mellan egen färg och varje grannpalettfärg (enhetstest).
- i18n: sv och en har samma nycklar (paritetstest); en saknad nyckel i testläget fallerar.
- 6000-tick-körning i webbläsaren utan console-fel; testnivå <= 150k trianglar; AI v0:s think, median över 200 anrop efter 20 uppvärmningar, <= `budgetMs(0,5)` per säte (loggat, `*.perf.test.ts`); typtest/lint som förbjuder src/ai att importera step eller state.
- `__test.give` ändrar guld/trupper bara via intent (negativt test utan debugIntents). Golden sim-hashar lika i Node och Chromium; `npm run verify` grönt.

SLUT
Enligt CLAUDE.md (ARCHITECTURE.md: snapshot-gränssnittet, SimView, public.ts, AI-anropet). Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska med vad som gjorts, vad som avvek, en "Så spelar du"-ruta (klicka för att spawna, klicka på mark för att anfalla, `[` `]`, mellanslag, `,` `.`, F2, F3) och exakta adresser, bland annat hur jag startar med seed 7 (Artifact: länken + `#seed-7`; lokalt/Netlify: `?seed=7`; alltid också via Dev-panelens seed-fält). Lista vad jag ska titta på under ca 10 minuter: (1) spawn och attack, (2) tydliga gränser även på berg och vid kusten, (3) bromsar Alperna och Himalaya, (4) tempot vid 1x/2x/4x, (5) läsbar HUD, (6) FPS via F3 och perf-läget (Kopiera rapport).
```

**Efteråt gör du:**
- Står det MERGA INTE i PR:en eller i Claudes svar: merga inte. Starta mallen "Återuppta en avbruten session" + M05-prompten i en NY session, och merga först när AI v0 är klar.
- Annars: merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- Öppna spelet enligt docs/PREVIEW.md på en dator med riktig GPU, klicka Play, spawna och spela ca 10 minuter. Prova alla tre hastigheterna, attackera stamfolk och en AI-nation och gå mot ett bergsområde.
- FPS hittar du med F3 eller perf-läget (Artifact: länken + `#perf`, eller F2). Skicka alltid FPS i en NY session (tillsammans med "ok" om tempot och gränserna kändes rätt).
- Fel eller stört? Använd mallen "Feedback efter en gate" (under Mallar i den här listan) i en ny session, merga fixen och först därefter M06. Smakfrågor kan vänta till BACKLOG.

## M06 — Meny: riktigt land eller eget land

| | |
|---|---|
| **Kräver** | M05 mergad |
| **Beräknad insats** | ~3,4 h agentarbete (2–5,8 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | En riktig startskärm: sök Sverige eller Sweden, Japan eller din egen påhittade nation med egen flagga, välj värld eller region och antal motståndare, och spela. |

**Klistra in i en ny session:**

```text
Du bygger milestone M06 (Meny: riktigt land eller eget land) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md, docs/BALANCE.md och, via indexet, public/data/meta.json och overrides.json, src/sim (rules.ts, intents, state, view), src/ai, src/render (camera, picking), src/ui (i18n) och src/app.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M05 är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M05 i milestonetabellen i docs/PROGRESS.md.

MÅL
Låt mig välja hur jag spelar: ett riktigt land eller en påhittad nation med egen flagga, med rättvisa starter och AI-motståndare som tar andra länder.

GÖR
1. Huvudmeny och uppsättningsskärm (DOM). Riktigt land: sökbar lista ELLER klick på globen (picking ger land-id). Sökrutan matchar både `name_en` och `name_sv` (skiftlägesokänsligt, diakritiktolerant); visa namnet på valt UI-språk. Kameran flyger dit med `flyTo(lat, lon, distKm)` i `src/render/camera/flyTo.ts` (tidsstyrd av fx-klockan, src/render/clock.ts från M02; enhetstest att slutposition nås; M08 utökar samma funktion) och landets gräns markeras (id-rastret i shadern). Eget land: namn, färg, procedurell flagga (mönster x 2 färger x ca 12 vektor-emblem ritade på canvas), fritt val av startplats genom klick på giltig mark; ogiltiga klick visar en orsak via t().
2. Flaggor: ren funktion seed -> FlagSpec (mönster, två färger, emblem) plus `drawFlag(ctx, spec, w, h)`. Golden-hash på spec/ritkommandon, inte på rastret. Samma generator ger AI-nationernas flaggor; flaggor syns i ledartavlan och HUD.
3. RÄTTVIS START, en regel: varje nation börjar med samma trupper, guld och en startskiva på exakt K = START_DISC_CELLS (197) celler, de K närmaste oägda landcellerna som hänger ihop med huvudstaden (distansordning, hash-tie-break), även över grannländers mark. Ett land är valbart bara om dess antal celler är >= 8 OCH huvudstadens sammanhängande landmassa (4-grannar över land, Ice undantaget) har >= K celler; annars visas det avstängt med skälet via t() ("för liten landmassa för en rättvis start: X av 197 celler"). Samma skäl gäller för ett eget lands startklick. Resten av ett valt riktigt lands egna celler (country-id lika med landets) blir förmarkerat hemland som kostar x0,5 att erövra för sin ägare (bara ägaren, bara hemlandsceller, inte grannmark i skivan); implementeras i simens kostnadsregel med ett hemlands-landsid per säte. Karaktärsdrag från kartstatistik, begränsade till +/-10 %: kustandel -> hamninkomst (lagras som multiplikator per säte i speltillståndet; M09 använder den), bergsandel -> försvar (påverkar angriparens kostnad mot nationen). Mapping och tak i rules.ts.
4. Matchalternativ: Värld eller Skirmish-utsnitt (Europa, Östasien, Amerika, Afrika/Mellanöstern) via spelbara masker (lat/lon-rektanglar dokumenterade i en fil, snittade med land utan Antarktis), antal AI-nationer (standard 12), stamfolk av/på, svårighetsgrad (lagras; används från M16), seed och läget "inga riktiga gränser" (neutralt: inga landsgränser eller landsnamn ritas, AI-nationer får påhittade namn, ingen hemlandsrabatt). Seed-fältet finns redan i Dev-panelen (M05, id "seed"); koppla det till matchalternativen i stället för att registrera ett nytt.
5. Politisk känslighet: gränser och namn från Natural Earths de facto-linjer via overrides.json (omstridda områden med neutrala namn); visa en kort, neutral ansvarsfriskrivning på uppsättningsskärmen ("stiliserad, fiktiv karta, inga politiska ståndpunkter"); full kredit i M23.
6. AI-nationer tar andra valbara riktiga länder (seedat urval): huvudstäderna måste ligga minst 17 celler isär; får en AI-nation färre än K startceller dras nästa kandidat i den seedade ordningen. De får flaggor och namn. Skapa `src/app/prefs.ts` (`getPref`, `setPref`; JSON, try/catch, minnesreserv, nyckelprefix) och spara valen via den; all senare kod använder den (sidan måste fungera när localStorage är blockerat).
7. Seedad uppsättning: samma konfig + seed ger samma initiala tillstånd (`createMatch(config)` är ren; ogiltig konfig ger ett felresultat). Ingen oseedad slump.

REGLER, TAL OCH GRÄNSSNITT
- UI mutar inte sim; allt går via intents och matchkonfig. Sim importerar inte DOM/three.
- Spelbar-mask: ingen cell utanför masken får någonsin ägas (spawn och attack validerar).
- Egenskapstaket +/-10 % överskrids aldrig; hemlandsrabatten 0,5 gäller bara ägaren och bara hemlandsceller.
- Alla strängar via t() i BÅDA tabellerna (sv och en). Konstanter i rules.ts eller UI-config.

UTANFÖR OMFATTNING
Byggnader och hamnar som ekonomi (M09), AI-svårighetens beteende (M16), segervillkor (M18), fullständig översättningskontroll, krediter och inställningar (M23a), RTS-kamera (M08), allianser, chatt.

ARBETSSÄTT
Enligt CLAUDE.md. Välj testländer ur meta.json, inte hårdkodade namn.

ACCEPTANS
- Lika start över 20 landval: 5 med färre än 400 egna celler (men landmassa >= K, t.ex. de 5 första i id-ordning) och 15 seedat samplade: trupper, guld och startskiva (exakt K celler, sammanhängande) identiska; i en default-match med 12 AI-nationer har varje säte exakt K celler vid tick 0.
- Negativt: varje land med landmassa < K eller < 8 celler är avstängt med ett skäl, och `createMatch` vägrar det; eget startklick på en för liten landmassa avvisas med skäl.
- Hemlandsrabatten gäller bara ägaren och bara hemlandsceller (enhetstester); egenskapstak aldrig överskridna.
- Flaggor: deterministiska per seed (golden hash på spec); >= 45 distinkta bilder bland 50 seeds; eget lands flagga ritas med >= 2 dominerande färger som matchar spec.colors inom dE 10 och emblemområdet skiljer sig från bakgrundsmönstret.
- Sök: "Sverige" och "Sweden" hittar båda Sverige; flyTo når sin slutposition (enhetstest, fx-klockan).
- Playwright: sök "Sweden", kameran flyger dit med markerad gräns (skärmdump), starta, startskivan inom 2 celler från Stockholm, 60 s snabbspolning utan fel; eget land spawnar exakt där jag klickat och ogiltiga klick visar en orsak.
- Skirmish-utsnitt: ingen cell utanför masken ägs någonsin; sidan fungerar med localStorage blockerat (enhetstest av prefs.ts: minnesreserv när lagring kastar).
- Samma konfig + seed ger samma initiala tillståndshash (Node och Chromium); `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; skriv i DECISIONS.md den rättvisa startregeln, masker, egenskapsmappning och neutralläget, och uppdatera BALANCE.md. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjorts, vad som avvek, en "Så spelar du"-ruta för menyn och exakt vad jag ska testa.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- Öppna förhandsvisningen (docs/PREVIEW.md), sök "Sverige" eller "Sweden", starta och kolla att kameran flyger dit och att din färg växer från Stockholm. Prova sedan "Eget land" med egen flagga och en Skirmish-region.
- Hittar du fel eller något som känns konstigt: använd mallen Buggrapport eller "Feedback efter en gate" i en ny session.

# Del 2 — Terräng, byggnader och helikoptrar (M07a–M13b)

Nu blir bergen på riktigt: terräng i närbild, RTS-kamera, byggnader och spelets signaturfunktion, helikoptrar som flyger genom dalar under radarn och släpper trupper. Gates: M08 och M13b (huvudfunktionen).

## M07a — Terräng-LOD A: quadtree-chunks och geometri

| | |
|---|---|
| **Kräver** | M05 mergad |
| **Beräknad insats** | ~2,7 h agentarbete (1,6–4,6 h) |
| **Modell / effort** | Opus 5.5, high |
| **Din gate** | Nej |
| **Du ser efteråt** | Terrängen ritas som chunks som blir finare ju närmare du kommer, utan sprickor, och din gräns löper fortfarande över den. Du kan zooma med musen ner till ca 1 km över marken och öppna `?view=alps-valley` eller `?view=himalaya-valley` (Artifact: `#view-alps-valley` eller `#view-himalaya-valley` efter länken; finns också under F2 i Dev-panelen). Åsar, snö och skog kommer först i M07b. |

**Klistra in i en ny session:**

```text
Du bygger milestone M07a (Terräng-LOD A: quadtree-chunks och geometri) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md.
- Renderkoden från M02 (globmesh, src/render/shaders/, kvalitetstiers, orbitkamera, picking, `registerDevMode` i src/app/devpanel.ts, `__test.setView`) och M05 (ownership-textur, territory/border-shader, render-adapter).
- scripts/shot.mjs och befintliga e2e-specar (återanvänd hjälparna).

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log --oneline -15` att M05 är mergad i main (M06 ska normalt också vara det); annars stanna och berätta för mig. Anteckna `git rev-parse origin/main` som merge-SHA för M06 i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det rött, stanna och rapportera.

MÅL
Första halvan av spelets största renderingsrisk: ersätt den fasta globmeshen med en quadtree av instancerade chunks som är sprickfria, precisa och billiga ner till 300 m över marken (AGL). Bygg skirts först. Inga nya npm-paket.

GÖR
1. Quadtree: 8 rötter (4x2, 90x90 grader). Varje chunk är ett delat nät på 32x32 rutor (33x33 vertex; test-tier 16x16 rutor), ritat instancerat. Instansdata: kamerarelativ chunk-origin, tangentbas, lat/lon-utsträckning, nivå, grannnivåer. LOD med avståndsringar och hysteres (merge först vid större avstånd än split), frustum- och horisontculling, skirts på alla kanter. Vertex-morphing är valfritt: bara om skirts + hysteres inte räcker.
2. Höjd: den globala 4096x2048-höjdtexturen med samma sqrt-avkodning och ca x12 överdrift som M02, ännu utan brus. Land får aldrig byta tecken mot hav vid kusten.
3. Precision: chunk-origins räknas i float64 på CPU och dras av kamerapositionen; ingen vertexposition räknas ur absoluta float32-världskoordinater. Dynamiska near/far från kamerans AGL; reversed depth bara om EXT_clip_control finns.
4. Territory/border: porta M05:s shader till chunk-materialet och skala UV-domain-warp så att gränser ser organiska ut även nära. Gränssnittet mot ownership-texturen ändras inte.
5. Tiers: chunk-täthet per tier och hård triangelbudget via max chunkantal. Gamla fasta meshen kvar bakom `?terrain=fixed`; debugläge `?chunks=1` med deterministisk färg per chunk. Registrera båda med `registerDevMode`.
6. Testkrokar (bara med ?test=1): utöka `__test.setView` med `altAglM` (meter över marken) som går förbi användarens zoomgräns och tilt-clamp, och justera near/far. `__test.state()` får `terrainMode` ('chunks' eller 'fixed') och `terrain` med chunkCount, lodLevels (distinkta nivåer i bild), triangles, drawCalls. Dokumentera i ARCHITECTURE.md.
7. Användarens orbitkamera: sänk minsta avstånd så att man kan zooma med musen ner till ca 1 km över marken (terrängmedvetet minimum; zoomsteg proportionella mot höjden). Lägg till `?view=alps-valley` (ca 46,5 N 8,0 E) och `?view=himalaya-valley` (ca 28,2 N 86,8 E): start ca 2 km över marken, tiltad mot horisonten. Registrera dem med `registerDevMode`. Full RTS-kamera kommer i M08.
8. Goldens: contact sheet med 3 höjder över Alperna, Himalaya och västra Norges kust (ca 61,5 N 6 E), dels normal vy, dels `?chunks=1`.

REGLER, TAL OCH GRÄNSSNITT
- Max 400 chunks på alla höjder; test-tier <=150k trianglar; high-tier <=1,5M trianglar och <=200 draw calls.
- Orbitkamera och picking från M02 fungerar fortfarande.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel. Terrängen är "stiliserad"; skriv det ärligt i docs.

UTANFÖR OMFATTNING
M07b äger: ridged-noise-detalj, TS `heightAt` med GLSL-paritet, slope-berg, snögräns, skogston, strandskum och detaljgoldens. M08: RTS-kamera, markpicking mot chunks, flyTo. Byggnader, helikoptrar, fler dataset, WebGPU, nytt ocean, HUD, nya bakes.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning, med commit vid varje grön checkpoint: skirts + enkel LOD, precision, territory-porten, tiers och debug, orbitkamera och `?view=`, sist goldens.

ACCEPTANS (automatiska tester; alla ska kunna misslyckas)
- Utan flaggor är `__test.state().terrainMode === 'chunks'`; med `?terrain=fixed` är det 'fixed'.
- Sex höjder över Alperna via altAglM: omloppsbana, 3000 km, 500 km, 60 km, 8 km, 300 m AGL. Crack-test: magenta clear colour, 0 magentapixlar inom terrängregionen (planetsiluetten minus några pixlars marginal). Detektorn bevisas: enhetstest på en syntetisk bild med ett magentahål ska larma, och med skirts avstängda via debugflagga ska en vy med olika LOD-nivåer bredvid varandra ge >0 magentapixlar (finns ingen sådan vy: notera i DECISIONS.md och lita på enhetstestet).
- Undre gränser (en solid sfär klarar dem inte): vid de tre lägsta höjderna chunkCount >=12, >=3 distinkta LOD-nivåer, test-tier trianglar >=20k (justera avståndsringarna, inte gränsen), `?chunks=1` visar >=12 distinkta chunkfärger, terrängregionen har >=200 distinkta färger. High-tier körs en gång headless: 100k–1,5M trianglar, <=200 draw calls. Chunkantal <=400 överallt.
- Jitter: kameraoffset 1e-7 grader (ca 1 cm) på 300 m AGL ändrar <0,2 % av pixlarna och ger inga NaN. Enhetstest: chunk-relativa vertexpositioner i float32 avviker <1 cm från float64-referensen för chunks inom 50 km från kameran.
- Ägande: readback == sim-owner på samplade celler, inklusive celler på båda sidor om minst en gräns som ger olika färger (samma metod som M05:s ägartest).
- Orbitkameran: musstyrd zoom stannar på 0,8–1,5 km AGL över både havsnivå och Himalaya (enhetstest; M08 ersätter det avsiktligt med ett RTS-kameratest). Båda `?view=` laddar utan console errors och visar >=3 LOD-nivåer.
- Goldens: nya contact sheets committade (två renders i samma launch byte-identiska). Ändrade M02-, M05- och M06-goldens regenereras med UPDATE_GOLDENS=1 efter visuell kontroll av contact sheet; motivera i DECISIONS.md. Inga toleranser ökas.
- Inga console errors. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md (PROGRESS, DECISIONS, ARCHITECTURE-index, BACKLOG; uppdatera förhandsvisningen enligt docs/PREVIEW.md; öppna en DRAFT-PR). Svara sedan på svenska: vad som gjordes, vad som avvek, de två `?view=`-adresserna (Artifact: `#view-alps-valley` och `#view-himalaya-valley`; och hur jag når dem via F2 om adressen inte kan ändras) och exakt vad jag ska titta på.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main"), starta sedan nästa prompt.
- Titta gärna: öppna förhandsvisningen, välj `alps-valley` eller `himalaya-valley` (adressen eller F2) och zooma med musen. Leta efter hål, sprickor eller flimmer; hittar du något, använd mallen Buggrapport.

---

## M07b — Terräng-LOD B: detaljer, snö, skog och strand

| | |
|---|---|
| **Kräver** | M07a mergad |
| **Beräknad insats** | ~2,7 h agentarbete (1,6–4,6 h) |
| **Modell / effort** | Opus 5.5, high |
| **Din gate** | Nej |
| **Du ser efteråt** | Du zoomar från omloppsbana ner i en bergsdal med detaljerade åsar, bergsbranter, snö, skog och strand, och din gräns löper fortfarande över terrängen. |

**Klistra in i en ny session:**

```text
Du bygger milestone M07b (Terräng-LOD B: detaljer, snö, skog och strand) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md.
- Chunk-koden och testhjälparna från M07a (quadtree, chunk-material, `__test.setView` med `altAglM`, `__test.state().terrain`, crack- och goldentesterna) samt shader-modulerna i src/render/shaders/.
- SIM-packets meta.json (finns ett ruggedness-lager?) och scripts/shot.mjs.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log --oneline -15` att M07a är mergad i main; annars stanna och berätta för mig. Anteckna `git rev-parse origin/main` som merge-SHA för M07a i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det rött, stanna och rapportera.

MÅL
Andra halvan av terrängen: LOD-medveten brusdetalj med bevisad paritet mellan TS och shader, samt slope-, snö-, skog- och strandshading, så att terrängen ser ut som berg på 300 m över marken (AGL). Geometrin, skirts och territory-shadern är redan klara i M07a. Inga nya npm-paket.

GÖR
1. Detaljhöjd: ridged-noise ovanpå höjdtexturen, skalad med relief. Relief kommer från ruggedness-lagret (u8) i SIM-packet som liten R8-textur om det finns, annars härleds den i shadern ur höjdtexturens lokala min/max; notera valet i DECISIONS.md. Detaljen tonas ut mot kusten (land byter aldrig tecken mot hav). LOD-medveten: bara oktaver med våglängd >= 2x vertexavståndet; tona den sista oktaven mot nästa nivå för mindre pop.
2. Brus: samma sin-fria heltals-hash i GLSL (uint) och TS (Math.imul), samma konstanter. Exportera `heightAt(lat, lon, maxOctaves?)` (standard: finaste nivån) och `octavesForLevel(level)` i en fil utan three-import. M08 återanvänder `heightAt` som `groundHeightAt`, så ändra inte signaturen utan att dokumentera det.
3. Readback-probe (debugkrok): kör SAMMA GLSL-höjdfunktion för givna lat/lon och läser tillbaka med readPixels (RGBA32F om EXT_color_buffer_float finns, annars packad RGBA8). Dokumentera i ARCHITECTURE.md.
4. Shading: bergsbrant mot gräs via slope (normal från höjd + detalj), snögräns som beror på höjd och latitud (Himalaya snöar högre upp än Alperna), skogston ur Forest-klassen, mjukt strandskum. Gränserna från M07a ska synas tydligt även över snö och berg.
5. Goldens: contact sheet med 3 höjder över Alperna, Himalaya och västra Norges kust.

REGLER, TAL OCH GRÄNSSNITT
- Triangeltaken från M07a gäller oförändrade (max 400 chunks, test-tier <=150k, high-tier <=1,5M trianglar och <=200 draw calls) och M07a:s undre gränser ska fortfarande hållas.
- Lokal relief = max minus min av bashöjden i 3x3 texlar, med golv på 100 m.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel. Terrängen är "stiliserad"; det ska stå ärligt i docs.

UTANFÖR OMFATTNING
Geometri, skirts, LOD-val och orbitkamera är M07a. RTS-kamera och flyTo är M08. Träd/objekt som geometri, fler dataset, WebGPU, nytt ocean, HUD, nya bakes.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: hash + probe + höjdparitet först, sedan shading, sist goldens. Ingen tidsassert.

ACCEPTANS (alla ska kunna misslyckas)
- Hash: 1000 värden från GLSL-proben är bitidentiska med TS.
- Höjdparitet: på 1000 samplade punkter (blandade LOD-nivåer; Himalaya, Alperna, kust) är |TS `heightAt(lat, lon, octavesForLevel(nivå))` minus shaderns höjd| <= 1 % av lokal relief. Mutationstest: ändrad hash-seed i TS ska ge fel i samma test. Detaljen är verklig: i Himalaya-boxen avviker `heightAt` mer än 20 m från bashöjden på >=50 % av punkterna.
- Kust: på 2000 samplade land- och havsceller har `heightAt` rätt tecken (land >0, hav <=0).
- Shading-statistik med fasta vyer: snövyn = altAglM 15000 över 28,0 N 86,9 E, tilt 55; Nederländerna-vyn = altAglM 15000 över 52,2 N 5,5 E; skogsvyn = altAglM 8000 över 62 N 15 E (kontrollera med `__test.state()` att Forest-klass är >=60 % av cellerna i vyn). Andelen snöpixlar (ljusa, lågmättade) är >=5 % av terrängregionen i snövyn och <=0,5 % i Nederländerna-vyn; andelen skogsgröna pixlar är >=20 % i skogsvyn; en brant vy har högre andel berggrå pixlar än en flat; strandbandet är ljusare än öppet hav med marginal. Trösklarna är fasta; vill du ändra dem, motivera i DECISIONS.md. Mät först, men sätt dem inte lägre än kraven.
- Triangeltak och undre gränser från M07a hålls med detaljen på. Ägande readback == sim-owner även på snö- och bergsceller.
- Goldens: nya detaljgoldens committade (två renders i samma launch byte-identiska). Goldens från M02, M05, M06 och M07a som ändras av shadingen regenereras med UPDATE_GOLDENS=1 efter visuell kontroll; motivera i DECISIONS.md. Inga toleranser ökas.
- Inga console errors. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md (PROGRESS, DECISIONS, ARCHITECTURE-index, BACKLOG; uppdatera förhandsvisningen enligt docs/PREVIEW.md; öppna en DRAFT-PR). Svara sedan på svenska: vad som gjordes, vad som avvek och exakt vad jag ska titta på (`?view=alps-valley`, `?view=himalaya-valley`; Artifact: `#view-alps-valley`, `#view-himalaya-valley`).
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main"), starta sedan nästa prompt.
- Titta gärna: öppna `alps-valley` eller `himalaya-valley`, zooma ut till omloppsbana och in igen. Är något fult, flimrigt eller har hål: använd mallen Buggrapport.

---

## M08 — RTS-kamera, markpicking och prestandascen

| | |
|---|---|
| **Kräver** | M07b mergad |
| **Beräknad insats** | ~4,1 h agentarbete (2,3–7,9 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — öppna förhandsvisningen på din riktiga dator, testa kameran i några minuter, kör prestandascenen (`?scene=perf`; Artifact: `#scene-perf`; eller F2 och Prestandascen) och rapportera i en NY session med mallen "Feedback efter en gate" (under Mallar i den här listan): JSON-rapporten plus två meningar om hur kameran känns. |
| **Du ser efteråt** | En mjuk kamera som glider från planetvy ner till en dal, klick på marken som träffar exakt, och en scen som mäter bildhastigheten på din hårdvara. |

**Klistra in i en ny session:**

```text
Du bygger milestone M08 (RTS-kamera, markpicking och prestandascen) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md.
- Terrängkoden från M07a/b (`heightAt`, chunks, readback-proben), orbitkameran och picking från M02, `flyTo` i src/render/camera/flyTo.ts (M06), input-koden från M05, ?perf=1-överlägget med rapportschemat, src/ui/report.ts (`showReport`) och Dev-panelen (`registerDevMode`).

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log --oneline -15` att M07b är mergad i main; annars stanna och berätta för mig. Anteckna `git rev-parse origin/main` som merge-SHA för M07b i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det rött, stanna och rapportera.

MÅL
En behaglig lågflygande kamera, exakta markfrågor delade av render, sim-nära kod och UI, ett input-/lägesstack som alla senare lägen använder, och en skriptad flygning jag kan köra på riktig GPU. Inga nya npm-paket.

GÖR
1. Lägesstack i `src/app/input.ts`: ett stack av lägen. Basläget tar över M05:s befintliga input utan beteendeändring. Senare lägen (placering, deploy, chase-kamera, målläge, paus) pushar på stacken. Esc poppar översta läget; pausmenyn (M18) öppnas bara när stacken är tom (exportera `setPauseHandler(fn)`, tills vidare no-op). Musmappning: vänsterdrag (>4 px) = grip-pan, höger- eller mellandrag = yaw/tilt, högerklick utan drag = kontextkommando (exportera `setContextHandler(fn)`, M20a kopplar sin resolver hit; tills vidare no-op), hjul = zoom mot muspekaren, vänsterklick utan drag = befintlig M05-åtgärd. Reserverade tangenter: 1-6 byggfält, E exponeringsvy, H chase-kamera, F fokus på egen huvudstad, Esc.
2. Kameramix: globe-arcball över en höjdtröskel, lokal-tangent-RTS-kamera under den, med mjuk övergång (välj trösklar, notera i DECISIONS.md). RTS: grip-pan på markpunkten under muspekaren, zoom mot muspekaren, yaw, tilt 20-80 grader, terrängfrigång >=300 m över marken via `groundHeightAt`. Pointer Events, `touch-action: none`, tvåfingers pan/zoom/rotate. M07a:s enhetstest för orbitkamerans zoomgräns (0,8–1,5 km AGL) ersätts av ett test av RTS-kameran: musstyrd zoom stannar >=300 m AGL över hav och Himalaya. Detta är en avsedd ändring; motivera i docs/DECISIONS.md. M07a:s `?view=alps-valley` och `?view=himalaya-valley` ska fortfarande laddas och visa >=3 LOD-nivåer.
3. Transforms-modul, rent TS utan three-import (src/render/transforms.ts): cell <-> lat/lon <-> världskoordinater (GameState är parameteriserat med width/height, wrapX). `pickGround(ray)`: marsch med 0,5 cells steg över höjdfältet + bisection. `groundHeightAt(lat, lon)` är M07b:s `heightAt` (samma funktion, ingen kopia).
4. `flyTo`: utöka den befintliga funktionen i src/render/camera/flyTo.ts med valfri höjd/tilt/yaw och RTS-läge; all tid läses från fx-klockan (src/render/clock.ts, M02), skapa ingen annan klocka. Ingen andra implementation; M06:s anrop och enhetstest ska fungera oförändrade. Bokmärken (Alperna, Himalaya, Anderna, egen huvudstad) via `window.__test` och Dev-panelen.
5. Prestandascen `?scene=perf` (registrerad i Dev-panelen som "Prestandascen"): omloppsbana -> kontinent -> dal -> 300 m AGL över Himalaya. Rapport-JSON: medel och p95 frame time, max trianglar, draw calls och chunks, renderersträng, tier, DPR, varaktighet. Utöka M02:s befintliga rapportschema i stället för ett nytt; JSON-schema + test. Knappen "Kopiera rapport" använder `showReport(json)`.

REGLER, TAL OCH GRÄNSSNITT
- Sim-koden importerar ingenting härifrån; sim använder egna höjder från SIM-packet.
- Kameran hamnar aldrig under terrängfrigången. Övergången globe -> tangent får inte "poppa".
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Byggnader (M09-M10), helikoptrar och chase-kamera (M13), pausmenyn (M18), kontextresolvern, full HUD, minimap och tactical view (M20), mobilpolish. Kamerakänslan bedömer jag.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: transforms + pick, lägesstack, kameramix, flyTo, sist perf-scenen. Ingen tidsassert på SwiftShader; perf-scenens siffror loggar du bara.

ACCEPTANS (alla ska kunna misslyckas)
- Pick round-trip: 200 slumpade skärmpunkter över omloppsbana och tre RTS-höjder, pick sedan reprojektion, fel <=1 pixel. Terrängmedvetenhet (en ren sfärpick klarar round-trip men inte detta): i en Himalaya-vy med tilt 60 grader ligger >=100 av 200 träffar på ytan, |träffhöjd minus `groundHeightAt`| <=2 m, och >=30 av dem avviker >=50 m från sfärens skärning.
- `groundHeightAt === heightAt` (samma funktion) och matchar shaderns höjd inom M07:s tolerans (1 % av lokal relief) via readback-proben från M07b.
- Scriptad flygning omloppsbana -> 300 m AGL med fx-klockan i steg om 1/60 s: positionsskillnad mellan frames <=5 % av höjden, riktningsändring <=3 grader per frame, kameran över terrängfrigången i varje frame. Negativ: `flyTo` mot 50 m AGL slutar ändå >=300 m.
- Input-enhetstester: Esc poppar översta läget och anropar pausehandlern bara när stacken är tom; vänsterdrag håller markpunkten under pekaren inom 1 px; högerdrag ändrar yaw men inte läge; högerklick utan drag ger exakt ett kontextkommando med rätt cell; scriptad tvåfingers-gest (syntetiska pointer events) ger pan/zoom/rotate.
- `flyTo` med fx-klockan (`advanceFx`/`__test.advance`) når målet inom epsilon på angiven tid; M06:s test är oförändrade och gröna.
- Perf-scenen körs färdigt i test-tier (förkortad) utan console errors; rapporten validerar mot schemat, alla tal är ändliga, maxChunks >=12 och maxTriangles >=20k (bevisar att flygningen kom ner). "Kopiera rapport" visar JSON som validerar.
- 6 höjd-goldens committade (omloppsbana, kontinent, region, dal, 30 km, 300 m AGL).
- `npm run verify` grönt.

SLUT
Enligt CLAUDE.md (PROGRESS, DECISIONS, ARCHITECTURE-index med transforms- och input-API, BACKLOG; uppdatera förhandsvisningen enligt docs/PREVIEW.md; öppna en DRAFT-PR). Svara sedan på svenska: vad som gjordes, vad som avvek, en kort "Så spelar du"-lista med kamerastyrningen, exakt hur jag öppnar prestandascenen (med `?scene=perf` på adressen, i Artifact `#scene-perf` efter länken, och via F2 om adressen inte kan ändras i vald förhandsvisningsväg), hur jag kopierar rapporten och vilka kamerasituationer jag ska känna efter i.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main"). Öppna förhandsvisningen på din riktiga dator (inte telefon om möjligt).
- Flyg runt i 3 minuter: dra för att panorera, högerdra för att vrida, rulla för att zooma, zooma ner till en dal, tryck F. Notera om något känns segt, hoppigt eller svårt.
- Starta prestandascenen enligt Claudes anvisning, vänta tills den är klar, tryck "Kopiera rapport" (eller markera texten och kopiera) och skicka JSON-rapporten plus din upplevelse i en NY session med mallen "Feedback efter en gate".
- Allt bra? Gå vidare. Fel eller stört? Skicka feedback i en ny session, merga fixen, och först därefter nästa milestone. P3 (smak) kan vänta till BACKLOG.

---

## M09 — Byggnader i simen: stad, fabrik, hamn, silo, SAM och försvarspost

| | |
|---|---|
| **Kräver** | M06 mergad |
| **Beräknad insats** | ~3,4 h agentarbete (2–5,2 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Inget nytt på skärmen, men AI-nationerna bygger städer och fabriker och blir rikare; ett mätresultat i Claudes svar visar ekonomin. |

**Klistra in i en ny session:**

```text
Du bygger milestone M09 (Byggnader i simen: stad, fabrik, hamn, silo, SAM och försvarspost) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md, docs/BALANCE.md.
- src/sim/rules.ts, src/sim/view.ts (`SimView`), src/sim/public.ts (från M05), intents/codec, ekonomi- och erövringskoden från M04, AI v0 (ARCHITECTURE.md säger var), scenario-CLI:t, M06:s lagrade drag-multiplikator för hamninkomst.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log --oneline -15` att M06 är mergad i main (M08 ska normalt också vara det); annars stanna och berätta för mig. Anteckna `git rev-parse origin/main` som merge-SHA för M08 i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det rött, stanna och rapportera.

MÅL
Hela byggnadsuppsättningen som rena, deterministiska regler med terrängbegränsningar, stigande priser och kopplad ekonomi, plus API-gränsen för AI och UI. Ingen rendering. Inga nya npm-paket.

GÖR
1. Strukturtabell i SoA-typed arrays (kapacitet 4096, deterministisk free-list): typ, ownerId (0 = fri plats), cell, nivå 1-3, byggstart/klar-tick, uppgraderingsstatus. Härlett cell->id-index hashas/serialiseras inte utan byggs om vid deserialize (testa likvärdighet). Avstånd i sim-celler med wrapX, utan cos-lat-vikt.
2. Intents Build{type,cell}, Upgrade{id}, Delete{id} (intents bär seat): codec, validering, reason codes (enum).
3. `src/sim/public.ts` (skapades i M05; UTÖKA den, ta inte bort befintliga exporter som `seatToOwner`/`ownerToSeat`): barrel av rena skrivskyddade hjälpfunktioner för AI och UI. Lägg till `validateBuild(view, seat, type, cell)` först. Utöka `SimView` med skrivskyddad åtkomst till strukturtabellen och lagret `FALLOUT_UNTIL` (noll tills M14). Simmens egen Build-validering anropar samma funktion (en implementation).
4. Regler: cellen ägs av spelaren; spacing 16 celler mellan strukturer av SAMMA typ (konstant `SPACING_SCOPE` så M19 kan ändra); Port bara kustcell; inget på Peak; Mountain tillåter bara SAM, Post, Silo; Hills ej Port; Forest ej Silo; fallout blockerar; Silo kräver en färdig egen Factory.
5. Pris = base * min(6, 1 + 0.5 * antal_ägda_av_typen), heltalsaritmetik (base*min(12, 2+n)/2). Provisoriska bas: City 400, Factory 500, Port 400, Silo 1000, SAM 600, Post 250 (rules.ts + BALANCE.md). Uppgradering till nivå L kostar base*L utan eskalering. Byggtider: City 15 s, Factory 20 s, Port 12 s, Silo 25 s, SAM 20 s, Post 8 s (tick = 0,1 s). Delete har 30 s cooldown per spelare.
6. Effekter (bara färdiga strukturer): City +800 trupptak och +1,5 guld/s per nivå (mata M04:s cityLevels-term); Factory +2 guld/s och +25 % guld på ägarens städer inom 20 celler (staplar inte); Defense Post: angriparens cellkostnad x2,5 inom `POST_RADIUS_CELLS` = 12 (heltal 5/2 i M04:s kvarts-trupp-format, in i M04:s kostnadsfunktion). Port: +2 guld/s plus handel mot upp till 3 närmaste partner (närmast först, lägst id vid lika) på >=40 celler: 1,5*(1+min(dist,120)/100) guld/s per hamn i paret (max 3,3 per par), halverat om samma ägare, noll vid embargo-flagga; hamninkomsten multipliceras med M06:s drag-multiplikator, klampad till +/-10 %. Cachea paren, räkna om bara vid ändring. SAM-radie R(L) = 22 - 60/(L+5) std-celler x2 till sim-celler (tabell per nivå i rules.ts), +20 % om SAM:en står på Mountain; Silo lagrar samma radiefaktor för M14. Inga andra SAM/Silo-effekter förrän M14.
7. Erövring: City/Factory/Port byter ägare med nivå-1 (minst 1); Silo/SAM/Post förstörs. Gäller även enclave-flip.
8. AI: skapa `src/ai/` (ligger AI v0 någon annanstans: flytta den dit utan beteendeändring) och `src/host/aiDriver.ts`. Hosten anropar drivern var `AI_THINK_INTERVAL_TICKS` tick, förskjutet per seat. Drivern äger AI-minnet och en egen PRNG-ström (seed + seat, separat från simmens) som serialiseras som ett eget AI-state-blob (M24b sparar det) och körs i simens tråd. UI anropar aldrig AI. `src/ai` får importera ENDAST `SimView` och `src/sim/public.ts` (ESLint-allowlist + typtest), aldrig `step`, mutatorer eller skrivbara arrayer. AI v0 bygger City och Factory efter förhållande (t.ex. 1 Factory per 2 Cities; ny City när guld räcker och trupper >=50 % av taket), sökning i ett fönster kring huvudstaden, <=0,5 ms per think.
9. Scenario-CLI: ekonomirapport (guld/min, strukturer, landceller).

REGLER, TAL OCH GRÄNSSNITT
- Alla tal bara i src/sim/rules.ts (och BALANCE.md). Alla exports UPPER_SNAKE_CASE med enhetssuffix (_M, _CELLS, _TICKS, _PCT). Följ M04:s talformat för guld.
- Sim förblir ren: lint-förbuden gäller (ingen Math.random/Date/trig/pow, ingen objekt-nyckeliteration). Allt via Intent-objekt.
- Avstånd är sim-celler (1024x512) utom SAM/Silo-formeln (std-celler, x2).
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Rendering, modeller, byggfält och snapshot-utökning (M10), LOS/radar/navigation (M11), helikoptrar (M12), missiler, nukes och fallout-logik (M14), allianser och embargo-diplomati (flaggan finns, inget sätter den), sjöfart, AI-strategi utöver bygg (M16-M17).

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: tabell, intents och `public.ts`, regler och priser, effekter, erövring, aiDriver, ekonomirapport. Tidsbudgetar via `budgetMs()` (tests/perfguard.ts).

ACCEPTANS (alla ska kunna misslyckas)
- Ett enhetstest per regel med sin reason code: prisstegring, spacing, kust-Port, bergsmängden (Mountain tillåter bara SAM/Post/Silo), Silo utan Factory avvisas, SAM-räckvidd +20 % på berg, Post-multiplikator inom och utanför 12 celler.
- Handelsinkomst matchar formeln inom 1 % i ett tvåhamnsscenario, är halverad för samma ägare och noll under embargo. Distans 500 celler ger samma värde som 120 (taket fungerar). Drag-multiplikatorn +10 % ger +10 % och klampas vid större värden.
- Ingen enskild struktur ger mer än 10x en nivå-1-Citys inkomst (15 guld/s): värsta fallet (3 partner på >=120 celler, olika ägare) <=13 guld/s utan drag-multiplikator och <=15 med +10 %.
- Ekonomiskript: (a) den byggfria solo-expandern ligger fortfarande i M04:s kalibreringsband (regression; använd det ev. uppdaterade bandet); (b) i solo-scenariot (inga andra säten, inga stammar, samma seed som M04-kalibreringen) har AI v0 med byggande efter 10 min landceller i [100 %, 150 %] av bandets övre gräns; högst 2 justeringsvarv av AI v0:s byggförhållande och rules.ts-priserna; nås det inte: logga den uppmätta faktorn i docs/BALANCE.md och sätt intervallet till uppmätt +/-30 % (samma regel som M04). Dessutom är inkomsten per minut monoton, en City betalar sig på >=3 min, och faktorn mot bandet loggas i BALANCE.md.
- AI-gräns: ESLint-fixture som importerar `step` från src/ai underkänns av lint; typtest att skrivning via `SimView` inte kompilerar. AI-state round-trip: serialisera vid tick 1000, återställ och fortsätt, hash vid tick 2000 == rak körning.
- Tick-kostnad (`*.perf.test.ts` i perf-projektet): median över 200 ticks efter 50 uppvärmningsticks <= `budgetMs(4)` med 12 spelare och ca 300 strukturer.
- Golden hashes och snapshot-equals-straight-run utökade och identiska i Node och Chromium. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md (PROGRESS, DECISIONS med särskilt de provisoriska priserna och tolkningen av spacing, ARCHITECTURE-index med `public.ts` och aiDriver, BALANCE.md, BACKLOG; öppna en DRAFT-PR). Svara sedan på svenska: vad som gjordes, vad som avvek och ekonomirapporten i korthet.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main"). Du behöver inte testa något; det mesta är regler.
- Vill du se något: skriv i en ny session "Kör ekonomisimuleringen från M09 och visa resultatet i en tabell." Annars hoppar du över det.

---

## M10 — Byggnadsmodeller, byggfält och markering

| | |
|---|---|
| **Kräver** | M08 och M09 mergade |
| **Beräknad insats** | ~4,1 h agentarbete (2,3–7,9 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Du bygger städer, fabriker, hamnar, silos, SAM-ställningar och försvarsposter på 3D-terrängen och ser ekonomin växa. |

**Klistra in i en ny session:**

```text
Du bygger milestone M10 (Byggnadsmodeller, byggfält och markering) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md.
- `src/sim/public.ts` (`validateBuild`, reason codes, priser, byggtider) och strukturkoden i src/sim från M09; transforms och `groundHeightAt`, lägesstacken `src/app/input.ts` från M08; HUD-koden, `t()` i src/ui/i18n.ts och snapshot/render-adaptern från M05; scripts/shot.mjs.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log --oneline -15` att M09 (och M08) är mergade i main; annars stanna och berätta för mig. Anteckna `git rev-parse origin/main` som merge-SHA för M09 i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det rött, stanna och rapportera.

MÅL
Se och placera City, Factory, Port, Silo, SAM och Defense Post på 3D-terrängen. All logik (giltighet, pris) kommer från sim-funktionerna i M09; UI och render duplicerar inga regler. Inga nya npm-paket.

GÖR
1. Snapshot: utöka host-snapshotet med strukturtabellen (id, type, ownerId, cell, level, buildProgress) som kopierade typed arrays, aldrig simreferenser. Render-adaptern och UI läser bara snapshotet. Utöka den snapshot-bundna `SimView` så att `validateBuild` och prisfunktionen fungerar på den (lägg `buildPrice(view, seat, type)` i public.ts om M09 saknar den; fallout finns i snapshotet först i M15a och räknas som noll tills dess). Dokumentera i ARCHITECTURE.md.
2. Procedurella lågpoly-modeller (ingen asset-fil): stadskluster, fabrik med skorsten, hamn med brygga och kran, silo med lucka, SAM med roterande skål, post med torn. En InstancedMesh per typ med per-instans ägarfärg och nivåskala (1,0 / 1,25 / 1,5), placerad via `groundHeightAt`, orienterad mot globens normal. Tydliga siluetter och ägarfärgad bas.
3. Skalpolicy: världsstorleken begränsas av kameraavståndet så att byggnader syns från hög höjd; instancerade ikonquads på långt avstånd; pop-in-tween; "under konstruktion"-look (skalad/transparent efter `buildProgress`); nattsidans emissiva ljus från stadsnivåer (nivå 1-3 ger fler ljus). Kosmetiska tidsvärden från fx-klockan (src/render/clock.ts, M02), aldrig sim-RNG.
4. Byggfält längst ner (1=City, 2=Factory, 3=Port, 4=Silo, 5=SAM, 6=Post). Att välja en typ pushar ett placeringsläge på lägesstacken: Esc eller högerklick poppar det, Shift+klick placerar flera. Eskalerat pris från sim, nedtonad knapp med orsak i tooltip. Placeringsspöke på markpekaren (`pickGround`), grönt/rött med reason från `validateBuild`; klick på rött spöke visar en toast. Markeringspanel (nivå, uppgradera med pris, riv med cooldown). Räckviddsring vid hover: SAM från sim-radien (inkl. +20 % på berg); Silo får en provisorisk ring från konstanten `SILO_PREVIEW_RANGE_CELLS = 80` i rules.ts (byts mot riktiga data i M14).
5. `src/ui/toast.ts` (ny): `showToast(key, params?, kind)` med t()-nycklar, max 3 synliga samtidigt (det enda taket; M18 ändrar det inte), försvinner efter en tid från fx-klockan. M13b, M18 och M20b återanvänder den; tester kontrollerar i18n-nyckeln, inte texten.
6. Alla strängar via `t()` och läggs i BÅDE sv- och en-tabellen i samma commit; varje UI-element får data-testid. Exponera `window.__test.props()` med instansantal per typ och antal tända nattljus.

REGLER, TAL OCH GRÄNSSNITT
- UI skickar bara intents (Build/Upgrade/Delete); den muterar aldrig sim. Sim validerar om, så spöket är bara vägledning.
- Strukturer lägger till högst 10 draw calls totalt (6 modellmeshar, 1 ikonquad-mesh, 1 spöke, 1 ring, 1 reserv för byggfasen); test-tier tak 500 instanser. Lägg raden "structures: <=10 draw calls" i tabellen Budgetar i docs/ARCHITECTURE.md.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Helikopter-/missilemodeller och deploy-läge (M13, M15), full HUD, minimap och radialmeny (M20), ljud (M22), skuggor, animationer utöver SAM-skålens rotation, städer som växer visuellt per ruta.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: snapshot-tabellen, en modelltyp i taget med screenshot per typ, byggfält + spöke, toast, sist natt och ikon-LOD. Ändras ett befintligt golden av dina modeller: regenerera med UPDATE_GOLDENS=1 efter visuell kontroll och motivera i DECISIONS.md, utan att öka någon tolerans.

ACCEPTANS (alla ska kunna misslyckas)
- Snapshot: strukturtabellen i snapshotet == simmens tabell; muteras snapshotets arrays ändras varken sim eller dess hash.
- Närbilds-screenshot med alla 6 typer, golden-diff inom tolerans. Samplat test: varje instans Y motsvarar `groundHeightAt` inom 1 m efter överdrift. `__test.props()` instansantal per typ == antalet i `__test.state()`.
- renderer.info: strukturer lägger till <=10 draw calls; vid 600 försökta instanser i test-tier är taket 500.
- Playwright (?test=1): tangent 1 + klick på egen mark bygger en City; priset i fältet är 400, efter bygget 600; avancera förbi byggtiden (15 s), strukturantal +1 och nattljus finns (`__test.props()` och pixelkontroll i en nattvy). Spöket är grönt på giltig cell och rött med rätt reason code på en Peak-cell och vid ett Port-försök inåt landet; klick på rött spöke visar toast med rätt i18n-nyckel. Esc i placeringsläget poppar läget utan att anropa pausehandlern.
- Parity-test: ett nyckelnamn saknat i sv eller en underkänner i testläge. Inga console errors. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md (PROGRESS, DECISIONS, ARCHITECTURE-index med snapshot-tillägget, props-API, toast och Budgetar-raden, BACKLOG; uppdatera förhandsvisningen enligt docs/PREVIEW.md; öppna en DRAFT-PR). Svara sedan på svenska: vad som gjordes, vad som avvek, en kort "Så spelar du"-lista (bygga, uppgradera, riva) och exakt vad jag ska testa.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main") och öppna förhandsvisningen enligt docs/PREVIEW.md.
- Starta en match, tryck 1 och klicka på din mark för att bygga en stad; prova 3 (hamn) inåt landet och se att spöket blir rött med en förklaring. Zooma ut och in: syns byggnaderna och har de rimliga storlekar?
- Är något fult eller svårt att se: beskriv det med mallen Buggrapport. Kör gärna Hälsokoll nu (rekommenderas efter M10).

## M11a — Bergmedveten radar: täckningsfält och exponering (headless)

| | |
|---|---|
| **Kräver** | M09 mergad |
| **Beräknad insats** | ~2,7 h agentarbete (1,6–5,1 h) |
| **Modell / effort** | Opus 5.5, high |
| **Din gate** | Nej |
| **Du ser efteråt** | Inget i webbläsaren än (debugsidan kommer i M11b). Claude redovisar uppmätta siffror: hur stor del av landet en lågflygande helikopter syns på i Alperna, i Himalaya och på slätten. |

**Klistra in i en ny session:**

```text
Du bygger milestone M11a (Bergmedveten radar: täckningsfält och exponering (headless)) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: rules.ts, grid.ts (cellKm), strukturkoden från M09 (SAM, Defense Post), höjdlagren i SIM-paketet (src/data) och tests/perfguard.ts.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M09 är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Skriv `git rev-parse origin/main` som merge-SHA för föregående prompt (nämn dess id) i milestone-tabellen i docs/PROGRESS.md.

MÅL
Bevisa på riktig data att åsar döljer lågflygare från radar: masker, komposit och frågor, mätta mot exakt siktlinje (LOS). Navigering och debugsida görs i M11b. Rent, deterministiskt sim-kod; inga nya npm-paket.

GÖR
1. `src/sim/los`. Effektiv ockluderarhöjd = mean + `OCCLUDER_MAX_WEIGHT` * (max - mean), gånger `GAMEPLAY_HEIGHT_EXAG`. Startvärden EXAG 8 (tillåtet 6-10) och vikt 0,6 (tillåtet 0,2-0,6). Enhet: LOS och ockluderarhöjd räknas i spelmeter (EXAG * verklig höjd); en helikopters höjd = EXAG * mean + AGL (AGL oöverdrivet: `ALT_LOW_AGL_M` 300, `ALT_HIGH_AGL_M` 3000); antennhöjd `SITE_ANTENNA_M` 30.
2. Mask-altitude-fält per site: strålar från siten mot omkretsen av en (2R+1)^2-ruta (wrapX); en cell är synlig om målhöjden >= mask[cell] (Uint16, enhet 2 spelmeter, avrunda NEDÅT så att felet blir generöst mot radarn; O(1)-test plus avstånd <= R). Celler som flera strålar når: ta minsta masken; fyll luckor från grannar. Horisontella avstånd i km via cellKm; höjder i spelmeter. Lazy rebuild vid build/destroy (dirty-flagga, ingen per-tick-kostnad).
3. Komposit per seat (minsta mask över de sites som har cellen inom radien) i 64x64-tiles; bara berörda tiles allokeras. Frågor: detection (union över ägarens sites) och fire-control (en sites egen mask + räckvidd). Exponera som läsfunktioner via SimView och `exposure(view, seat, cell, mode)` i `src/sim/public.ts`. Cachen är härledd, ligger utanför tillståndshashen och byggs om efter load.
4. Synlighet per läge: Low synlig om höjd >= mask; High ignorerar masken (synlig inom räckvidd: "snabb men synlig").
5. Sites: färdiga SAM (radie R(L) från M09, +20 % på berg) plus `addSite(seat, cell, radius)` för tester. Defense Post: fiendehelikoptrar inom Post-radien (`POST_RADIUS_CELLS` = 12; återanvänd M09:s konstant, skapa den bara om den saknas) räknas alltid som exponerade (båda lägen).
6. Exakt LOS med halvcellssteg är ENDAST testorakel i testfilerna (inte exporterat från sim) och använder samma avståndsmått och höjder.

REGLER, TAL OCH GRÄNSSNITT
- Alla tal i rules.ts (UPPER_SNAKE_CASE med enhetssuffix). Sim förblir ren (lint-förbuden gäller).
- STOPPREGEL: nås inte kraven nedan efter justering av EXAG (6-10) och OCCLUDER_MAX_WEIGHT (0,2-0,6), högst 4 mätvarv (logga varje varv i DECISIONS.md): STANNA. Bygg inte vidare och skriv ingen M11b-kod. Ändra aldrig gridet, oraklet eller kraven på egen hand. Allt mäts på det riktiga 39 km-gridet. När du stannar: skriv de uppmätta talen och dessa tre färdiga alternativ under Known issues i docs/PROGRESS.md OCH i slutsvaret, och rekommendera ett:
  A: behåll noll-fel-kravet men sänk överensstämmelsen 85 % → 78 % och Plains-kravet → 12 %.
  B: höj OCCLUDER_MAX_WEIGHT över 0,6 upp till 0,8.
  C: bygg masken på 2048x1024-nätet bara för LOS (kräver nytt beslut om rutnätet).
- BESLUT: slutar den här prompten med en rad "Beslut: A", "Beslut: B" eller "Beslut: C" (följd av tidigare uppmätta siffror) gäller stoppregeln redan som utlöst och ägaren har valt: stanna inte, utan genomför det alternativet, logga valet och de nya måtten i docs/DECISIONS.md och slutför M11a (inklusive acceptanskraven, ändrade enligt alternativet). Den raden ger dig lov att ändra just det alternativets tal; inget annat.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Nav-grid, A*, rutter, LZ-poäng, flyglägestabellen, servicetak och debugsidan (M11b), helikopterenheter (M12a), 3D-visning (M13), missiler (M14), AI-användning (M17).

ARBETSSÄTT
Enligt CLAUDE.md. Mask + orakel + syntetiska fixtures först, sedan komposit, sedan mätningarna.

ACCEPTANS (automatiska tester på de riktiga paketen)
- Mask mot exakt LOS, Low, på 3 fixtures (Alperna runt 46,5N 9,5E, Himalaya runt 27,7N 85,3E, Great Plains runt 38,5N 98W): >= 85 % överensstämmelse OCH NOLL celler "dolda av masken men synliga enligt exakt LOS". Dessutom döljer masken >= 60 % av de celler som exakt LOS döljer (Alperna, Himalaya; loggas), så att en mask som alltid säger "synlig" inte klarar testet.
- Synlig andel av landceller inom R=24, Low: Alp- och Himalaya-siten <= 20 %; Plains >= 2x Alp-värdet och >= 15 %, mätt på minst 5 Plains-sites (Kansas, Iowa, Ukraina, Pampas, Australien) med medianen rapporterad; High >= Low på varje fixture.
- Syntetisk vägg (platt karta, en 3000 m hög rad): celler bakom väggen dolda för Low men synliga för High; celler vid sidan synliga. Ett Defense Post-skiva ger exponerade celler i båda lägen; en SAM utanför radien ger ingen.
- Wrap-test: en site nära x=0 ger samma synliga antal som motsvarande site på en cirkulärt förskjuten karta.
- Prestanda i `*.perf.test.ts` med `budgetMs()` (median av minst 5 mätningar efter 2 uppvärmningar): mask R=24 <= budgetMs(0,5), R=64 <= budgetMs(2), 200 sites vid R=24 <= budgetMs(150). Lazy rebuild: ingen ombyggnad utan ändring (räknare); en site vid R=24 allokerar <= 4 komposit-tiles.
- Resultat-hashar (masker, komposit, synliga andelar) lika i Node och Chromium. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: los-API, `exposure`-helpern och cache-ägandet. DECISIONS.md: uppmätta värden, vald EXAG och vikt, enhetsval, varje mätvarv. Öppna en DRAFT-PR. Svara på svenska: vad som gjorts, de uppmätta siffrorna (överensstämmelse, enkelsidiga fel, synliga andelar per site, Plains-medianen), vad som avvek, och om stoppregeln utlöstes (då även A/B/C ovan med din rekommendation och att jag ska starta en ny session med mallen, hela M11a-prompten och en sista rad "Beslut: A|B|C").
```

**Efteråt gör du:**
- Läs Claudes uppmätta siffror. Nådde den kraven: be samma session "Markera PR:en som redo, vänta på grön CI och squash-merga den till main".
- Utlöstes stoppregeln: merga INTE och gå inte vidare till M11b. Starta en NY session och klistra in (1) mallen "Återuppta en avbruten session", (2) direkt under den hela M11a-prompten, (3) längst ner en rad "Beslut: A" (eller B/C; osäker? välj A) och Claudes uppmätta siffror. Sessionen genomför valet, loggar det i docs/DECISIONS.md och slutför M11a.

---

## M11b — Luftnavigering: rutter, landningsplatser och debugsida (headless)

| | |
|---|---|
| **Kräver** | M11a mergad |
| **Beräknad insats** | ~2,7 h agentarbete (1,6–5,1 h) |
| **Modell / effort** | Opus 5.5, high |
| **Din gate** | Nej |
| **Du ser efteråt** | En debugsida där du klickar ut en SAM och ser täckningen med hål bakom bergen, samt en helikopterrutt som kryper längs dalar. |

**Klistra in i en ny session:**

```text
Du bygger milestone M11b (Luftnavigering: rutter, landningsplatser och debugsida (headless)) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: src/sim/rules.ts, src/sim/los och `exposure` i src/sim/public.ts från M11a, höjdlagren och 256x128 nav-gridet i SIM-paketet (src/data), hur debug/data.html från M01 är registrerad i Vite, Dev-panelens `registerDevMode` (M02), tests/perfguard.ts.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M11a är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M11a i milestonetabellen i docs/PROGRESS.md.

MÅL
Bygg luftnavigeringen ovanpå radarlagret: rutter som kryper längs dalar, landningsplatser (LZ) med tydliga avvisningsorsaker och en debugsida där jag ser det på riktig karta. Rent sim-kod plus debugsidan; inga nya npm-paket.

GÖR
1. Flyglägen som data i rules.ts: High (`HELI_SPEED_HIGH_CELLS_S` 3, `ALT_HIGH_AGL_M`, synlig) och Low/NOE (`HELI_SPEED_LOW_CELLS_S` 2,1, `ALT_LOW_AGL_M`, maskad), `HELI_FUEL_CELLS` 180. AGL-värdena (300/3000) kommer från M11a; inga nya AGL-konstanter. Det är tidskomprimerade spelvärden: ett 60-cellers flygpass ska ta ca 20-30 s. Servicetak `SERVICE_CEILING_M` 6000 gäller VERKLIG höjd: en nav-cell är blockerad om verklig medelhöjd + verklig AGL (300 resp. 3000) > 6000, och alltid om någon av dess 16 sim-celler är Peak. LOS och ockluderarhöjd använder fortsatt EXAG * höjd. Följd, avsiktlig: Low är passerbart nästan överallt utom Peak; High blockeras där medelhöjden > 3000 m (Tibet, Anderna, delar av Klippiga bergen). Skriv det i DECISIONS.md.
2. `src/sim/nav`: 256x128 nav-grid; vägd A* (vikt 1,3, 8 grannar, wrapX, ingen hörnklippning; kostnad = km + slope/tak-term + `AIR_EXPOSURE_LAMBDA` (3) * exponerad(nav-cell), där exponerad = radar-synlig eller inom Post-radie, utvärderad i navcellens lägsta sim-cell vid Low). Persistenta buffertar med generation stamps. Connected-component-etiketter för land och för luft (per läge) ger O(1)-nåbarhet. `planRoute(view, seat, from, to, mode)` -> {waypoints, fuelCells, etaTicks (10 ticks/s), exposedCells} eller reason NO_ROUTE.
3. `scoreLz(view, seat, cell, from, mode)` med reason codes i prioritetsordning: WATER, PEAK, TERRAIN_CLASS (Plains eller Hills; Forest avvisas), STEEP (3x3 spridning av verklig medelhöjd > 200 m), ENEMY_CITY_NEAR (inom 2 celler från fiendestad), TOO_HIGH (medelhöjd > `LZ_MAX_ELEV_M` 3500), OUT_OF_FUEL (rutt > `HELI_FUEL_CELLS`), NO_ROUTE. Poäng: planare och mindre exponerad inflygning är högre. Exportera `planRoute` och `scoreLz` i src/sim/public.ts.
4. debug/viewshed.html (Canvas2D; registrerad i Vite på samma sätt som debug/data.html, ingår i `npm run build`). Dev-panelen (M02) får en RELATIV länk `./debug/viewshed.html` via `registerDevMode`; absoluta adresser som /debug/... är förbjudna (hämtningar av data går via `siteUrl()` från src/app/paths.ts, M00b). Sidan nås alltså från Dev-panelen (F2 eller hörnknappen) utan att skriva någon adress. Förinställda regioner (Alperna, Himalaya, Great Plains; närmaste lämpliga cell) med panorering; klick placerar SAM (radieslider 8-64, standard 24); High/Low-växel; täckning med hål; rutt A till B färgad efter exponering jämte den raka rutten; LZ-giltighet med reason vid hover; rutt-stats.

REGLER, TAL OCH GRÄNSSNITT
- Alla tal i rules.ts (UPPER_SNAKE_CASE med enhetssuffix). Sim förblir ren. Radier och flygavstånd i cell-enheter med wrapX.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Mask, komposit och exposure-frågor (gjorda i M11a), helikopterenheter och FSM (M12a), 3D-visning och deploy-UI (M13), missiler (M14), AI-användning (M17).

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: flyglägen och tak, A*, etiketter, LZ, sist debugsidan.

ACCEPTANS (riktiga paket plus syntetiska fixtures)
- Alp-fixturen: `planRoute` Low från ca 48,1N 11,6E till Po-slätten ca 45,2N 9,5E returnerar en rutt över åsen med fuelCells <= 180. Andel luft-ogenomträngliga landceller i Low < 5 %; hitta PROGRAMMATISKT (inte hårdkodat) en cell med verklig medelhöjd >= 3000 m och klass skild från Peak i Tibet-boxen (lat 26..36, lon 75..95); den är blockerad i High och passerbar i Low (finns ingen: använd Anderna eller Klippiga bergen och skriv det i DECISIONS.md); en Peak-cell är blockerad i båda.
- Den exponeringsvägda rutten (lambda 3) har <= 50 % av den raka ruttens (lambda 0) exponerade celler på åsfixturen. En Post-skiva på rutten ger exponerade celler i båda lägen.
- Prestanda i `*.perf.test.ts` med `budgetMs()`: A* median <= budgetMs(2) och p99 <= budgetMs(20) över 200 seedade färdiga rutter (p99 kräver >= 200 prover); onåbart mål via etiketter <= budgetMs(0,1) per fråga (median över 1000). Allokeringstest (taggat leak-test): kör 200 `planRoute`-frågor i debug/viewshed.html (relativ adress) via page.evaluate och mät med `heapDelta(page, fn)`; tillväxten < 5 MB (i Node mäts bara tid). Negativt: en syntetisk Peak-vägg tvärs hela kartan ger NO_ROUTE via etiketterna utan att A* körs (räknare).
- LZ: en fixture per reason code (WATER, PEAK, TERRAIN_CLASS, STEEP, ENEMY_CITY_NEAR, TOO_HIGH, OUT_OF_FUEL, NO_ROUTE; syntetiska där riktiga data inte räcker); en cell som är både WATER och PEAK ger WATER (prioritet); en stad 2 celler bort avvisas, 3 celler bort godkänns; en giltig LZ ger poäng > 0.
- Resultat-hashar lika i Node och Chromium; debugsidans screenshot-golden; sidan ingår i `npm run build`. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: nav/LZ-API, flyglägestabellen och public.ts-tillägg. Uppdatera förhandsvisningen enligt docs/PREVIEW.md så att debug/viewshed.html går att öppna via länken i Dev-panelen. Öppna en DRAFT-PR. Svara på svenska: vad som gjorts, uppmätta tider, vad som avvek, hur stor andel av Tibet-boxens landceller som är Peak (så att jag kan bedöma om Peak-tröskeln i M01 är rimlig) och vad jag ska prova på debugsidan.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- Öppna förhandsvisningen (docs/PREVIEW.md), tryck F2 (eller hörnknappen) och klicka på länken till viewshed-debugsidan i Dev-panelen, välj Alperna, klicka ut en SAM och växla Low/High: täckningen ska ha hål bakom bergen i Low men vara full i High. Dra en rutt: den ska följa dalar, inte gå rakt.

---

## M12a — Helikoptrar i simen: enheter, flygning och landning

| | |
|---|---|
| **Kräver** | M09 och M11b mergade |
| **Beräknad insats** | ~2,3 h agentarbete (1,5–4,4 h) |
| **Modell / effort** | Opus 5.5, high |
| **Din gate** | Nej |
| **Du ser efteråt** | Inget i webbläsaren. Claude visar i svaret testresultat och en textreplay där helikoptrar produceras, flyger över berg, landsätter trupper och ger ett brohuvud som återgår efter 45 sekunder om det är avskuret. |

**Klistra in i en ny session:**

```text
Du bygger milestone M12a (Helikoptrar i simen: enheter, flygning och landning) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: rules.ts, `planRoute`, `scoreLz` och lägestabellen från M11b, erövringskoden från M04 (cellkostnad, Attack), strukturkoden från M09, detmath (isqrt), hash/serialize/codec från M03 och outboxen.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M11b (och M09) är mergade i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M11b i milestonetabellen i docs/PROGRESS.md.

MÅL
Signaturmekaniken som deterministiska regler, första halvan: bygg helikoptrar i Factory, flyg terrängmedvetna rutter, landsätt trupper på en LZ bakom fiendens linje och hantera brohuvudet. Luftvärn, CLI och räd-statistik görs i M12b. Ingen rendering; inga nya npm-paket.

GÖR
1. Helikoptertabell (SoA, kapacitet 64, ingår i serialisering och hash). Produktion i Factory: 200 guld, 12 s, en åt gången per fabrik. Flottans tak = 2 + summan av fabrikernas nivåer (max 12; en helikopter under produktion räknas). Last upp till 600 trupper, dras från spelarens trupper vid start. Hastighet, AGL, bränsle (`HELI_FUEL_CELLS` 180, minskar med flugen sträcka, fylls vid landning på egen Factory) från M11b:s lägestabell. Dessa hastigheter är tidskomprimerade spelvärden: ett 9-cellers hopp tar ca 3-4 s och en 60-cellers räd ca 20-30 s. 100 HP (lagras i tiondelar).
2. Kinematisk FSM: Pad, TakeOff (20 ticks), Cruise, Approach, Hover (3 s), Land/Unload (10 ticks), RTB (till närmaste egna Factory; saknas den skrotas helikoptern; en återkallad last återgår till ägaren vid landning), Downed (kvar 50 ticks, sedan borttagen). Slut på bränsle ger Downed. Fixed-point (Q8-cellkoordinater, ingen trig; riktning via isqrt), wrapX. Terrängföljning med 4-samples lookahead; en vertikal-ändringsgräns per flugen cell; säkerhetsgolvet (mark + frigång) vinner alltid. Definiera `HELI_CLEARANCE_GAME_M` i rules.ts. Flygande höjd alt = max(EXAG * mean + AGL för läget, ockluderarhöjd(cell) + `HELI_CLEARANCE_GAME_M`); M12b:s synlighetsfrågor använder just denna alt. Skriv det i DECISIONS.md och redovisa hur mycket högre alt blir än EXAG * mean + 300 över Alperna, mätt vid ruttens åspassage. Peak-celler och servicetak kan aldrig beträdas.
3. Intents ProduceHeli{factory}, LaunchHeli{factory, lzCell, troops 1-600, altMode}, RecallHeli{heli} med codec (`seat`) och reason codes: NOT_OWNER, NO_FACTORY, QUEUE_BUSY, FLEET_CAP, NO_GOLD, NO_PAD_HELI, BAD_TROOPS, LZ_INVALID + orsak från `scoreLz` (samma funktion som UI använder), NO_ROUTE. Rutten kommer från `planRoute` vid start och lagras i helikoptern.
4. Landning: LZ-cellen erövras till vanlig cellkostnad (M04:s funktion; x2 om fiendeägd), därefter grannceller i fast ordning N,E,S,W,NE,SE,SW,NW tills lasten inte räcker. Brohuvud ("beachhead") på 1-9 celler; kan inte ens LZ-cellen tas misslyckas landningen och lasten går förlorad. Resten av lasten blir ett vanligt Attack från brohuvudet. Brohuvudspost i tabell (ägare, fröcell, landningstick, status, kapacitet 64). Avskuret kluster: var 10:e tick bounded BFS (max 80 celler) från fröcellen; "etablerat" om >= 80 celler eller innehåller en City; annars återgår cellerna till neutral exakt 450 ticks (45 s) efter landningen, och klustrets celler räknas under tiden inte i trupptak, regen eller guldland.
5. Händelser till outbox: HeliProduced, HeliLaunched, HeliLanded, BeachheadFormed, BeachheadReverted, HeliDowned{orsak fuel} (sam/post läggs till i M12b). AI v0 ignorerar helikoptrar.

REGLER, TAL OCH GRÄNSSNITT
- Alla tal i rules.ts + BALANCE.md. Sim förblir ren (ingen trig/pow/Math.random/Date). Allt via Intent-objekt. Avstånd i cell-enheter med wrapX.
- Tider, kapaciteter och bränsleregler utöver planens tal (TakeOff/Unload-ticks, skrotning, 64-tabeller, brohuvudets ordning, att kluster som återgår blir neutrala) är provisoriska val: lista dem i DECISIONS.md.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Defense Post och SAM mot helikoptrar, HeliDowned av sam/post, `heli-raid`-CLI:t, SAM-fixtures och räd-statistik (M12b), rendering och UI (M13), missiler (M14), AI-användning (M17), balans (M19).

ARBETSSÄTT
Enligt CLAUDE.md. Tabell + FSM, sedan intents, sedan landning och kluster. Testerna använder en fixture-hjälpare i tests/, inte CLI:t.

ACCEPTANS
- Egenskapstest, 100 färdiga flygningar (seedad PRNG, planRoute lyckas) över Alperna, Himalaya och Anderna, båda lägena: höjd alltid >= ockluderarhöjd + `HELI_CLEARANCE_GAME_M`, aldrig i en Peak-cell, inga NaN/oändligheter.
- Liveness: av de 100 flygningarna når >= 95 % Landed inom 2x ETA; maxavståndet från start är >= 80 % av ruttlängden; medelhastigheten är inom +/-10 % av rules.ts för läget; ingen tick flyttar helikoptern mer än 1,05x hastigheten (en teleporterande eller stillastående stub fallerar). Flygtid för en typisk 60-cellers räd >= 15 s.
- LZ: vatten, brant, Peak, Forest, fiendestad-nära och för långt bränsle avvisas med rätt reason; en godkänd LZ ger ett brohuvud på 1-9 celler som expanderar enligt vanliga regler; en LZ vars cell inte kan erövras ger misslyckad landning och förlorad last.
- Avskuret kluster återgår vid 45 s +/- 1 tick (tick-exakt); återgår INTE med >= 80 celler eller en City; inget trupptak/regen/guldland från klustret under tiden. Flottans tak hålls (FLEET_CAP vid försök över taket); NO_GOLD, QUEUE_BUSY och RecallHeli har varsitt test.
- Kostnad i `*.perf.test.ts`: median över 200 ticks (efter 50 uppvärmningsticks) <= budgetMs(0,5) per tick med 12 helikoptrar i luften.
- Golden hash och serialisering (round-trip) med helikoptrar i luften lika med rak körning, identiska i Node och Chromium. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: intents, händelser, helikopter-API och rules-konstanter. Öppna en DRAFT-PR. Svara på svenska: vad som gjorts, vad som avvek, de uppmätta flygtiderna, kostnaden per tick och en kort textreplay (tick, tillstånd, position) av en landsättning över Alperna.
```

**Efteråt gör du:**
- Läs Claudes redovisning och merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main"). Inget att prova i webbläsaren än.

---

## M12b — Luftvärn mot helikoptrar och räd-statistik i simen

| | |
|---|---|
| **Kräver** | M12a mergad |
| **Beräknad insats** | ~1,8 h agentarbete (1,3–3,6 h) |
| **Modell / effort** | Opus 5.5, high |
| **Din gate** | Nej |
| **Du ser efteråt** | Claude visar en textreplay i svaret där en helikopter flyger över en bergskedja, landsätter trupper bakom fronten och en annan skjuts ner av en SAM. |

**Klistra in i en ny session:**

```text
Du bygger milestone M12b (Luftvärn mot helikoptrar och räd-statistik i simen) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: helikopter-API:t, FSM och outbox-händelser från M12a, los/`exposure` från M11a, strukturkoden från M09 (SAM, Defense Post), splitmix32-mixern, scenario-CLI:t, tests/perfguard.ts.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M12a är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M12a i milestonetabellen i docs/PROGRESS.md.

MÅL
Andra halvan av helikoptermekaniken: luftvärn som kan skjuta ner helikoptrar (och som bergen kan dölja dem för), en CLI-replay och räd-statistik som visar att mekaniken är rimligt balanserad. Ingen rendering; inga nya npm-paket.

GÖR
1. Defense Post: skadar alla fiendehelikoptrar inom `POST_AA_RADIUS_CELLS` (= `POST_RADIUS_CELLS` = 12, ingen ny siffra) med `POST_AA_DPS` (15 dps = 1,5 HP/tick, staplar mellan poster), oavsett läge.
2. SAM engagerar bara SYNLIGA helikoptrar: lagets detection OCH sitens egen mask (fire-control) OCH räckvidd (High synlig inom räckvidd, Low bara över masken, enligt M11a). Salva var 90:e tick (`SAM_SALVO_PERIOD_TICKS`), första salvan så fort ett mål är giltigt; träff `SAM_HIT_PCT` 55 med slumptal ur splitmix32-mixern på (matchseed, tick, samId), utan tillståndsbaserad PRNG så att iterationsordningen inte spelar roll; träff = nedskjuten. Spatial hash (typed arrays) för SAM/Post. En nedskjuten helikopter förlorar hela lasten och skapar inget territorium. Händelsen HeliDowned får orsak sam/post.
3. `heli-raid --fixture <alps|plains-sam|ridge-sam> --seed N` i scenario-CLI:t: skriver tick, tillstånd, position, höjd, exponering och händelser. Fixtures: `alps` (riktig karta, ingen SAM), `plains-sam` (slätt med två SAM nivå 1 som båda täcker LZ:n och 80 % av de sista 12 cellerna), `ridge-sam` (syntetisk karta: SAM bakom en ås, en dal som döljer Low-inflygningen).
4. Skriptade räder (seedade, loggade): läge Low mot oförsvarat mål (alps), Low över slätten i plains-sam, Low via dalen i ridge-sam; 50 försök vardera. Lyckad räd = BeachheadFormed (>= 1 cell erövrad; ett avskuret brohuvud återgår medvetet efter 45 s, så det mäts inte här).

REGLER, TAL OCH GRÄNSSNITT
- Alla tal i rules.ts + BALANCE.md (UPPER_SNAKE_CASE med enhetssuffix). Sim förblir ren. Allt via Intent-objekt.
- M19:s mål "AI-räder 25-55 %" mäts på AI-räder i fulla matcher och ersätter inte dessa skriptade gränser.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
SAM-avskjutning av missiler och nukes (M14), rendering och UI (M13), AI-användning av helikoptrar (M17), balansjustering (M19), ljud.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: Post, sedan SAM och spatial hash, sedan CLI och fixtures, sist statistiken.

ACCEPTANS
- Fixture "SAM bakom ås" (syntetisk): Low engageras aldrig; High engageras med 55 % per salva (10 000 seedade slumpslag inom +/-3 %); en SAM utanför räckvidden eller med förstörd struktur skjuter aldrig. Samma resultat med SAM-listan i omvänd ordning (hash lika).
- En Defense Post fäller en High på 7 +/- 1 s; två poster fäller den på ca hälften av tiden (staplas); en Post skadar även Low. En nedskjuten helikopter skapar inget territorium och lasten är förlorad (trupptalet oförändrat).
- Flygningar i SAM-fixtures slutar i Landed eller Downed inom 2x ETA (liveness som i M12a).
- Kostnad i `*.perf.test.ts`: median över 200 ticks (efter 50 uppvärmningsticks) <= budgetMs(0,5) per tick med 12 helikoptrar + 40 luftvärnsstrukturer.
- Skriptade räder (50 försök, resultat loggade): >= 80 % lyckas mot oförsvarat mål, <= 30 % över slätten med två SAM nivå 1, och minst +30 procentenheter högre via dalen i ridge-sam än över slätten. `heli-raid`-körning med samma seed två gånger ger identisk utskrift; en körning per fixture ingår som smoke-test.
- Golden hash och serialisering med SAM-engagemang och nedskjutning lika med rak körning, identiska i Node och Chromium. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: luftvärnsregler, HeliDowned-orsaker, CLI och fixtures; BALANCE.md: raid-siffrorna. Öppna en DRAFT-PR. Svara på svenska: vad som gjorts, vad som avvek, raid-statistiken och utdraget från `heli-raid`-replayen över en bergskedja (landning) och från en nedskjutning.
```

**Efteråt gör du:**
- Läs replayen och raid-siffrorna i Claudes svar och merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main"). Inget att prova i webbläsaren än: helikoptrarna syns först i M13a.
- Känns resultatet orimligt (nästan alla räder lyckas, eller ingen)? Notera det; finjusteringen sker i M19, men säg till om det är grovt fel.

---

## M13a — Wow 3a: helikoptern på skärmen — modell, effekter och kamera

| | |
|---|---|
| **Kräver** | M08, M10 och M12b mergade |
| **Beräknad insats** | ~3,4 h agentarbete (1,9–6 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Helikoptrar med snurrande rotor på 3D-terrängen, damm och skuggor, en medåkningskamera (tryck H) och ett scenario (`?scenario=slice`, i Artifact `#scenario-slice`) med Claudes skärmbilder av en landsättning över Alperna. Deploy-knappen kommer i M13b. |

**Klistra in i en ny session:**

```text
Du bygger milestone M13a (Wow 3a: helikoptern på skärmen — modell, effekter och kamera) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: helikopter-API, intents och outbox-händelser från M12a/M12b; props/instancing-mönstret och src/ui/toast.ts från M10; kameran, input-modestacken, `pickGround` och `groundHeightAt` från M08; SimHost och snapshot-gränssnittet i src/host; ownership-shadern; fx-klockan (src/render/clock.ts, M02); `window.__test`; scripts/shot.mjs (`heapDelta`).

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M12b (och M10, M08) är mergade i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M12b i milestonetabellen i docs/PROGRESS.md.

MÅL
Få helikoptern på skärmen: en läsbar, billig modell, effekter, medåkningskamera och ett scenario att visa det i. Deploy-läge, LZ-markör, rutt, exponeringsvy och SAM-varianten görs i M13b (där också min gate ligger). Inga nya npm-paket.

GÖR
1. Procedurell modell (ingen asset-fil): kropp, stjärtbom, huvud- och stjärtrotor i EN sammanslagen geometri med ett per-vertex del-id; rotorn snurrar i vertex shadern från en tid-uniform (ingen CPU per instans); EN InstancedMesh (tak 64) med per-instans ägarfärg. Lutning/bankning från hastighet (render-only, utjämnad med fx-klockan).
2. Effekter, drivna av outbox-händelserna och fx-klockan (src/render/clock.ts, M02; skapa ingen ny klocka; aldrig sim-RNG): rotorwash-damm nära marken, skuggblob på `groundHeightAt`, trupputsläpp (rep/prickar under Hover), landningsputs, flagghissning i ägarfärg på LZ:n, rök och krasch vid nedskjutning. Draw-call-budget: helikopter 1, skugga 1, damm/partiklar 1, rep + flagga 1.
3. Snapshot-utökning (typed-array-kopior, aldrig sim-referenser): helicopters (id, owner, x, y, alt, hp, cargo, state) och beachheads (owner, fröcell, landningstick, status). Rendern interpolerar mellan snapshots. Dokumentera i ARCHITECTURE.md.
4. Medåkningskamera: `H` väljer nästa egna helikopter och åker med (mode stack; Esc poppar), med terrängfrigång via M08:s sampling. Helikopterlista i HUD (HP, last, ETA, tillstånd) och varningen via toast.ts med i18n-nyckeln `heli.lost` (definieras här i sv och en; M10:s tak på 3 synliga toasts gäller). Alla strängar via t() i BÅDA tabellerna (sv och en); data-testid på allt.
5. `?scenario=slice` (hash-formen `#scenario-slice` ger samma läge via parsern i src/app/params.ts, M02; registrerat i Dev-panelen): `scenarioId` i matchheadern (standard 0 = normal, 1 = slice; hashar för befintliga seeds ska vara oförändrade). Scenarier ligger i en tabell `src/sim/scenarios.ts` (skapas här); nya scenarier läggs till som tabellrader utan regeländring, och `git diff src/sim` får förutom läsfunktioner bara visa den filen och headerfältet. Spelaren får en klar Factory och två helikoptrar; fienden ligger bergsomringad. Välj positioner så att den planerade Low-rutten är >= 60 celler och korsar Alperna (förslag: spelaren runt 63N 10E, Trondheim-trakten, välj en Hills-cell för Factory, och fienden i Campania runt 41N 14,5E, ca 64 celler rakt; verifiera med `planRoute` och justera). `&sam=1` (hash: `#scenario-slice_sam-1`) görs i M13b.
6. Nya testkrokar (bara med `?test=1`; dokumentera i ARCHITECTURE.md): `__test.submit(intent)` som lägger ett vanligt intent i hostens kö och `__test.helis()` som returnerar renderade instansers lat, lon och alt.

REGLER, TAL OCH GRÄNSSNITT
- UI skickar bara intents. Test-tier-tak: helikopterinstanser 64, partiklar 2 000, högst 14 draw calls för helikopterlagret (M13b lägger till rutt och LZ-markör inom samma tak). Lagrets draw calls = `renderer.info.render.calls` med lagret på minus med lagret av (setVisible false) i samma vy; skillnaden mäts.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Deploy-läge, LZ-markör, rutt-polyline, exponeringsvy, async `query()` och SAM-variant (M13b); missiler och bloom (M15); AI-helikoptrar (M17); full HUD och minimap (M20); ljud (M22).

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: modell, sedan flygning i render, sedan effekter, snapshot, kamera och sist scenario och e2e. Ta en screenshot per steg.

ACCEPTANS
- Playwright "Alps drop" (fast seed, slice): starta Low-flygningen med intentet LaunchHeli via `__test.submit` (deploy-UI finns ännu inte) över åsen; screenshots vid start, mitt i dalen, landning och brohuvud; brohuvudcellerna syns i ownership-texturen och helikopterinstansen är borttagen efteråt. Flygtiden i slice är >= 15 s (>= 150 ticks mellan TakeOff och Landed). Kort test: bygg Factory med M10:s UI, ProduceHeli via `__test.submit`, helikoptern dyker upp efter 12 s.
- Renderad position (`__test.helis()`) == simposition inom 0,5 cell i varje samplad frame (>= 100 samplingar, via snapshot); chase-kameran är över terrängfrigången under hela flygningen.
- Rotorn: ändrad tid-uniform ensam ger olika pixlar i rotorområdet på en stillastående helikopter. HeliDowned-händelse ger röksprites som sedan försvinner.
- Renderingen ändrar inte simen: simhashen efter e2e-flödet är lika med en rak headless-körning. Snapshot-arrayerna är kopior (en ändring påverkar inte simen).
- Taken hålls (instanser <= 64, partiklar <= 2 000, lagrets draw calls <= 14 mätt som ovan). Läckagetest (taggat leak-test, körs i e2e-skalet): canvas 320x180 (setViewport) över 60 renderanrop (3 omgångar x 20); `renderer.info.memory` geometries/textures oförändrade och `heapDelta` < 5 MB, medianen av 3. Inga console errors. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: snapshot-utökningen, scenarioId och helikopterlagret, samt raden för helikopterlagret (<= 14 draw calls totalt) i tabellen "Budgetar". Uppdatera förhandsvisningen enligt docs/PREVIEW.md (hur man öppnar slice). Öppna en DRAFT-PR. Svara på svenska: vad som gjorts, vad som avvek, och en kort "Så tittar du"-ruta (öppna slice via F2 eller med adressen i rätt form enligt docs/PREVIEW.md, Artifact: länken + `#scenario-slice`; tryck H för att åka med) och skärmbilderna.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- Titta på helikoptern: öppna förhandsvisningen (docs/PREVIEW.md), starta `slice` via F2 (Artifact: lägg `#scenario-slice` efter länken) och tryck H. Helikoptern kan ännu inte skickas iväg från skärmen, det kommer i M13b.

---

## M13b — Wow 3b: deploy-läge, landningsvisning och exponeringsvy

| | |
|---|---|
| **Kräver** | M13a mergad |
| **Beräknad insats** | ~3,4 h agentarbete (1,9–6 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — spela slice-scenariot (`?scenario=slice`, i Artifact `#scenario-slice`, eller via Dev-panelen F2) i ca 10 minuter på din riktiga dator, följ Claudes lista över vad du ska titta på, och rapportera upplevelsen och siffrorna från `?perf=1` (Artifact: `#perf`, eller F2) (renderersträng och FPS) med mallen "Feedback efter en gate" |
| **Du ser efteråt** | Huvudfunktionen: en helikopter som hugger genom en bergsdal, SAM-stationer med döda vinklar i plan-vyn, och trupper som landar bakom fiendens linje. |

**Klistra in i en ny session:**

```text
Du bygger milestone M13b (Wow 3b: deploy-läge, landningsvisning och exponeringsvy) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: helikopterlagret, snapshot-utökningen och slice-scenariot från M13a; `previewLaunch`-underlaget (`planRoute`, `scoreLz`, `exposure`) från M11; intents och reason codes från M12a; markeringspanelen och src/ui/toast.ts från M10; input-modestacken och `pickGround` från M08; SimHost i src/host; terrängshadern; `window.__test`; scripts/shot.mjs.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M13a är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M13a i milestonetabellen i docs/PROGRESS.md.

MÅL
Gör luftlandsättningen spelbar och läsbar: flyg lågt genom ett pass, landsätt trupper bakom fiendens linje och se exakt varför det lyckas eller misslyckas. Spelets huvudfunktion och min gate. Inga nya npm-paket.

GÖR
1. `SimHost.query(kind, args): Promise<QueryResult>`: gränssnittet är asynkront (MainThreadHost löser direkt, men som Promise; WorkerHost kommer i M24a). UI-lagret tillåter högst en utestående fråga per kind och slänger inaktuella svar. Kinds: `previewLaunch{factory, lzCell, troops, mode}` (UI skickar sliderns värde, standard 1) -> {giltig, reason, rutt, ETA, bränsleceller, exponerade celler}, implementerad som tunn wrapper över en ren `validateHeliLaunch(view, seat, factory, lzCell, troops, mode)` som exporteras från src/sim/public.ts och som simens egen LaunchHeli-validering anropar (AI i M17 använder samma funktion); `exposureField{seat, mode}` -> R8-fält 1024x512 från samma mask-fält som reglerna använder (fiendens detection + Post-skivor). Inga sim-regler ändras (`git diff src/sim` visar bara läsfunktioner och den utbrutna `validateHeliLaunch`, ingen beteendeändring). Dokumentera i ARCHITECTURE.md.
2. Deploy-läge (mode stack; Esc poppar): klicka Factory, sedan "Deploy Helicopter" med trupp-slider (1-600) och High/Low-växel. Hover visar levande LZ-markör (grön/röd + reason-sträng via t()), rutt-polyline färgad efter exponering (grön dold till röd exponerad; ritas två gånger: ljust med djuptest och dämpat utan djuptest så att den syns genom berg), ETA och bränslering. Högerklick = LaunchHeli från vald Factory med sliderns trupper; ogiltig LZ ger toast med orsaken.
3. Plan-vy för exponering (tangent `E`): heat-map från exposureField, ritad i terrängshadern som uniform-textur (max 2 Hz uppdatering; strypningen läser fx-klockan, src/render/clock.ts, M02; 0 extra draw calls).
4. `&sam=1` på slice: en fiende-SAM på High-rutten. Registrera varianten också som kryssruta "Fiende-SAM" (eget Dev-läge "Slice + SAM" via `registerDevMode`) i Dev-panelens slice-läge, så att den nås utan att ändra adressen (via F2). Hash-formen är `#scenario-slice_sam-1` (samma som `?scenario=slice&sam=1`, via parsern i src/app/params.ts); enhetstestet jämför parserns resultat för båda formerna.

REGLER, TAL OCH GRÄNSSNITT
- UI skickar bara intents; ingen regelduplicering (LZ-giltighet kommer från simen via query). Alla strängar via t() i BÅDA tabellerna (sv och en); data-testid på allt.
- Draw calls för helikopterlagret totalt <= 14 i test-tier (M13a:s 4 + rutt 2 + LZ-markör 1 + exponering 0), mätt som skillnaden i `renderer.info.render.calls` med lagret på/av (setVisible false) i samma vy (samma metod som M13a). Lägg helikopterlagrets rad (<= 14 draw calls totalt) i tabellen "Budgetar" i ARCHITECTURE.md.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Modell, effekter, chase-kamera, snapshot-utökning och slice-scenariot (gjorda i M13a); missiler, nukes och bloom (M15); AI-helikoptrar (M17); full HUD, minimap och radialmeny (M20); ljud (M22); balans (M19).

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: query, sedan deploy och LZ-förhandsvisning, sedan rutt, sedan exponeringsvy, sist SAM-varianten och e2e. Ta en screenshot per steg.

ACCEPTANS
- Paritet: för >= 30 LZ-celler (minst en per reason code) ger `previewLaunch` (och `validateHeliLaunch` direkt) samma giltighet och reason som ett riktigt LaunchHeli-intent; samma `troops` skickas till previewLaunch, till validateHeliLaunch och till LaunchHeli-intentet (testa även BAD_TROOPS och NO_GOLD). Förhandsvisningen visar rätt reason för vatten, brant och fiendestad-nära, och grönt för en giltig LZ (screenshots).
- Asynk: enhetstest med fördröjd fejk-host: högst en utestående fråga per kind, inaktuella svar slängs, MainThreadHost returnerar en Promise.
- exposureField: placera en SAM nivå 1 (via `&sam=1`:s ställning eller en testfixtur) på en Alp-cell med verklig medelhöjd >= 1500 m; för Low är den lysande arean <= 50 % av radie-R-skivan, och High-fältet >= Low-fältet cell för cell; överlägget skiljer sig från utan överlägg (>= 1 % av pixlarna, medan två renderingar utan överlägg är identiska).
- Playwright deploy-flöde (fast seed, slice): klicka Factory, Deploy, slider 300 och Low, hovra giltig LZ, högerklicka; trupperna dras med 300, helikoptern flyger, landar, brohuvudceller syns i ownership-texturen och instansen tas bort. Rutten ritas i 2 draw calls; ruttpixlar syns där rutten ligger bakom åsen. Esc stänger deploy-läget utan att annat öppnas.
- `?scenario=slice&sam=1` (och `#scenario-slice_sam-1`, samma resultat): en High-helikopter skjuts ner, toast med i18n-nyckeln `heli.lost` (M13a; kontrollera nyckeln, inte texten), inget brohuvud; samma start med Low via dalen landar (om inte: justera SAM-placeringen i scenariot, inte testet).
- Läckagetest (taggat leak-test, e2e-skalet) med förhandsvisning aktiv: canvas 320x180 över 60 renderanrop (3 omgångar x 20); `renderer.info.memory` oförändrad och `heapDelta` < 5 MB, medianen av 3. Inga console errors. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: query-gränssnittet (kinds, throttling, att M24a:s WorkerHost vidarebefordrar) och deploy-läget. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska med: vad som gjordes, vad som avvek, och en numrerad GATE-lista över exakt vad jag ska titta på och prova: öppna slice (Artifact: länken + `#scenario-slice`; lokalt `?scenario=slice`; eller via F2); klicka Factory och Deploy; hovra över vatten, brant mark och nära fiendestaden och läs orsakerna; växla High/Low och jämför rutterna; tryck E för exponeringsvy; skicka en Low-helikopter över åsen, åk med med H och se landningen; slå på Fiende-SAM i F2-panelen (eller öppna `#scenario-slice_sam-1`, lokalt `&sam=1`) och skicka en High-helikopter; öppna `#perf` (lokalt `?perf=1`, eller F2) och läs av renderersträng och FPS. Avsluta med vad jag ska klistra tillbaka.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main") och öppna förhandsvisningen enligt docs/PREVIEW.md på din riktiga dator.
- Gå igenom Claudes numrerade GATE-lista med slice-scenariot (`?scenario=slice`, i Artifact `#scenario-slice`): flyg Low över åsen och åk med (H), titta på landningen, slå på Fiende-SAM i F2-panelen (eller öppna `#scenario-slice_sam-1`; lokalt `&sam=1` på adressen) och se den bli nedskjuten, tryck E för att se SAM:ens döda vinklar.
- Läs av `?perf=1` (Artifact: `#perf`, eller F2) (renderersträng och FPS) och rapportera i en NY session med mallen "Feedback efter en gate" (under Mallar i den här listan): renderersträngen, FPS i dalen och vid landningen, vad som kändes bra eller fel (läsbarhet av rutten, kameran, utseendet), gärna skärmbilder.
- Allt bra? Gå vidare. Fel eller stört? Skicka feedback i en ny session, merga fixen och först därefter M14. P3 (smak) kan vänta till BACKLOG.

# Del 3 — Missiler, AI och matchflöde (M14–M19)

Missiler, nukes och luftvärn, motståndare som tänker själva, matchslut och ett balanspass. Gate: M15b (hur nukes ser ut och känns).

## M14 — Missiler, nukes och SAM-avskjutning i simen

| | |
|---|---|
| **Kräver** | M09, M11b och M12b mergade |
| **Beräknad insats** | ~4,1 h agentarbete (2,6–6,4 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Inget nytt på skärmen. Claude visar i svaret en textreplay där missiler skjuts upp, fångas av SAM eller slår ned och lämnar nedfall. |

**Klistra in i en ny session:**

```text
Du bygger milestone M14 (Missiler, nukes och SAM-avskjutning i simen) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (öppna bara de källfiler den pekar på).
- Särskilt: strukturkoden och `validateBuild` från M09 (Silo/SAM-stubbar, nedfallsstubben), src/sim/public.ts, los-API:t från M11 (detection, fire-control), SAM-engagemang och outbox-händelser från M12 (stateless slumptal på splitmix32-mixern), detmath (isqrt, Q15-LUT), grid.ts (cellKm), M04:s ägarbytesfunktion (frontier-invarianterna), scenario-CLI:t.

FÖRKONTROLL
Kolla i docs/PROGRESS.md och `git log` att M09 och M11b är mergade i main (M12b ska också finnas enligt listordningen). Om inte: stanna och berätta för mig. Skriv `git rev-parse origin/main` som merge-SHA för föregående prompt i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det inte grönt, stanna.

MÅL
Långdistansspelet som ren, deterministisk och statistiskt testad sim-kod: tre robotklasser från Silos, fysisk SAM-avlyssning, sprängverkan och nedfall (fallout). Ingen rendering (M15a). Inga nya npm-paket.

GÖR
1. Intent `LaunchMissile{silo, class, targetCell}` (klasserna Tactical, Fission, Fusion) med codec, validering och reason codes (NOT_OWNER, SILO_NOT_READY, COOLDOWN, OUT_OF_RANGE, NEED_SILO_L2, NO_GOLD, TARGET_NOT_LAND). Guld dras vid uppskjutning. Exportera `validateMissileLaunch(...)` (missiler; helikopterns validator heter `validateHeliLaunch`, M13b), `previewBlast` och `previewThreat` som rena, skrivskyddade funktioner via src/sim/public.ts (UI och AI återanvänder dem; inga regler dupliceras).
2. Missiltabell i SoA (kapacitet 64, deterministisk free-list), hashad och serialiserad. Bana: normaliserad lerp mellan start- och målets enhetsvektorer (fixed-point, normalisering med isqrt, cell till vektor via Q15-LUT, ingen trig). Räckvidd jämförs som kordlängd mot förberäknade heltalskonstanter (ingen asin). Flygtid = bågavstånd / fart; fart (provisoriskt, i rules.ts): Tactical 20, Fission och Fusion 30 celler/s. Uppskjutningsvarning: outbox-händelse med ETA till ägaren av målcellen.
3. Detonation: radier lagras i km i rules.ts och omvandlas med cellKm(lat) per rad (heltalsmatte, wrapX, polära rader kapas). Inre skiva: celler blir neutrala via samma ägarbytesfunktion som erövring (frontier-invarianterna ska hålla), byggnader förstörs, nedfall sätts. Yttre ring: 50 % hash-slag per byggnad (stateless, nyckel match/tick/missil/cell), byggnadsnivå -1 (nivå 1 förstörs). Truppförlust per drabbad ägare = min(0,6*T, 3*(T/N)*cellsHit) (heltal; N = ägarens cellantal, cellsHit = ägda celler inom yttre radien). Nedfall: lagret `FALLOUT_UNTIL` (per cell; om M09 skapade en stubb med annat namn, ge den detta namn) = detonationstick + 1800 (180 s), x1,5 erövringskostnad, inget guld, inga byggnader. Tactical är bara mot byggnader: inga cellbyten, inget nedfall, ingen truppförlust. Radierna i km = planens celltal (redan i sim-celler) x ekvatorns cellKm, avrundat; skriv valet i DECISIONS.md.
4. SAM-avlyssning: en fysisk interceptor per inkommande stridsspets och SAM, fart 60 celler/s (6 per tick). Vid avfyrning räknar SAM:en med heltalsiteration över kommande ticks ut var och när interceptorn når stridsspetsen; hinner den inte före nedslag avfyras ingen. Utfallet slumpas vid avfyrning (stateless mixer på matchseed, tick, samId, missil-id; p = 75/60/40 % mot Tactical/Fission/Fusion) men tillämpas först vid mötestick. Flera SAM staplar som 1-prod(1-p) genom oberoende slag. Radie R(L) = 22 - 60/(L+5) std-celler (omräknad till sim-celler som i M09), +20 % på berg, 9 s omladdning. Tactical (cruise) flyger terrängföljande på låg höjd och kan bara engageras när M11:s detection OCH SAM:ens egen mask OCH räckvidd släpper igenom den (samma regel som Low-helikopter i M12); Fission och Fusion är ballistiska och alltid synliga inom radien. Spatial hash för SAM/missiler.
5. Outbox-händelser (render-only): MissileLaunched, MissileWarning, InterceptorLaunched (med mötestick, mötesposition, utfall), Intercepted, Detonated (klass, mittcell, radier), BuildingDestroyed. `previewBlast(cell, class)` -> antal celler/byggnader/ägare; `previewThreat(path)` -> SAM-täckning längs banan.
6. Hook för att nuka en allierad: bara fältet `targetOwnerIsAlly` (alltid false, inga pakter i v1).
7. Scenario-CLI:t: `missiles --fixture <ridge-cruise|plain-cruise|sam-stack|fusion-silo> --seed N` och en integrationsreplay (helikopterräd + nuke + SAM) som skriver ut tick, händelser och slutlig hash.

REGLER, TAL OCH GRÄNSSNITT
- Alla tal i src/sim/rules.ts (UPPER_SNAKE_CASE med enhetssuffix, t.ex. `MISSILE_COOLDOWN_TICKS`) och i BALANCE.md-tabellen: 1 uppskjutning per 45 s (450 ticks) per Silo; pris +25 % per tidigare uppskjutning av klassen för samma spelare (pris = bas x (1 + 0,25 x antal), heltal).
  - Tactical Cruise: 300 guld, räckvidd 80 celler, terrängföljande och åsmaskad, r_in 4 / r_out 8.
  - Fission: 900 guld, räckvidd 240 celler, ballistisk, r_in 6 / r_out 16.
  - Fusion: 3500 guld, kräver Silo nivå 2, obegränsad räckvidd, r_in 18 / r_out 30.
- Sim förblir ren: lint-förbuden gäller (ingen Math.random/Date/trig/pow/exp/log, inga objektnyckel-loopar); allt via Intent-objekt; inget i sim läser rendering.
- Fart, tabellkapacitet, Tactical-"endast byggnader" och prisformeln är provisoriska tolkningar: lista dem i DECISIONS.md. Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Alla visuella effekter (M15a), målläge och UI (M15b), AI-användning av missiler (M17), balansjustering (M19), ljud (M22), pakter/allianser, MIRV, warships, förstörbar terräng.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: tabell + bana, detonation, SAM, sist CLI och statistik.

ACCEPTANS
- Blastarea: summan av cellytor (`cellKm_x(rad)*cellKm_y`) för blastcellerna ligger inom 1,5 % av sfärisk kalottarea 2*pi*R^2*(1-cos(r/R)) (R=6371 km) vid ekvatorn, 45N och 60N, för Fusion r_in/r_out och Fission r_out; för skivor under 1000 celler högst en cellrings avvikelse (dokumentera i DECISIONS.md). Ingen jämförelse mot pi*r^2 delat med en enda rads cellarea.
- Nedfall upphör exakt 1800 ticks efter detonationen; truppförlust aldrig över 0,6*T; Tactical ändrar inga cellägare och sätter inget nedfall. En syntetisk blast över 100k celler tar högst `budgetMs(50)` (median, tests/perfguard.ts).
- Pk Monte-Carlo, 10 000 seedade försök: 75/60/40 % +/-2 %; två överlappande SAM matchar 1-prod(1-p) inom +/-2 %.
- Cruise bakom åsfixturen kan inte engageras men engageras över slätt; ballistiska alltid synliga; utanför räckvidd och Fusion utan Silo nivå 2 avvisas med rätt kod; prisstegring +25 % per uppskjutning verifierad.
- Integrationsreplayen ger identiska hashar i Node och Chromium; state-serialisering med missiler i luften == rak körning; tick-CPU <= `budgetMs(4)` (median) med 20 missiler i luften.
- Frontier-invarianterna från M04 håller efter nedslag; golden hashes regenererade med orsak i DECISIONS.md; `npm run verify` grönt.

SLUT
Enligt CLAUDE.md: uppdatera docs/PROGRESS.md, DECISIONS.md, BALANCE.md (nya konstanter) och ARCHITECTURE.md (intent, outbox-händelser, public.ts-funktioner). Förhandsvisningen ändras inte. Öppna en DRAFT-PR. Svara sedan på svenska: vad som gjordes, vad som avvek, utdraget från integrationsreplayen och exakt vad jag kan titta på.
```

**Efteråt gör du:**
- Be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main" (eller gör det på GitHub enligt Så använder du listan) innan du startar M15a.
- Det finns inget att se på skärmen än. Vill du se beviset, skriv i en ny session: "Kör missiles-scenariot med fixturen ridge-cruise och visa utskriften på svenska." (Hoppa över om du inte är nyfiken.)

## M15a — Missil- och nukeeffekter: partiklar, bågar och efterbehandling

| | |
|---|---|
| **Kräver** | M13b och M14 mergade |
| **Beräknad insats** | ~3,2 h agentarbete (2,1–5,2 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | En effekt-scen (Dev-panelen, F2) med en scriptad uppskjutning: missilen bågnar över planeten, SAM försöker skjuta ner den och detonationen ger chockvåg, svampmoln, nedfallsglöd och bloom. |

**Klistra in i en ny session:**

```text
Du bygger milestone M15a (Missil- och nukeeffekter: partiklar, bågar och efterbehandling) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (öppna bara de källfiler den pekar på).
- Särskilt: M14:s outbox-händelser och FALLOUT_UNTIL-lagret, helikopter-VFX och SimHost-snapshoten från M13, ownership-texturen och terräng-/territorieshadern (flags-kanalen, M05/M07), kamera, `groundHeightAt` (M08), src/render/quality, scripts/shot.mjs (inklusive `heapDelta`), src/app/devpanel.ts. `src/render/post` finns inte än: den skapas här.

FÖRKONTROLL
Kolla i docs/PROGRESS.md och `git log` att M13b och M14 är mergade i main. Om inte: stanna och berätta för mig. Skriv `git rev-parse origin/main` som merge-SHA för föregående prompt i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det inte grönt, stanna.

MÅL
Få förstörelse och försvar att se ut och kännas bra utan en enda asset-fil: robotbanor, SAM-interceptorer, detonationer med chockvåg och svampmoln, nedfallsglöd och efterbehandling (bloom). Allt drivs av outbox-händelser och fx-klockan (src/render/clock.ts, M02: återanvänd den, skapa ingen ny), aldrig av sim-slumptal. Inga nya npm-paket (EffectComposer, UnrealBloomPass och SMAAPass kommer från three själv).

GÖR
1. Snapshot-utökning (bara kopierade typed arrays, aldrig referenser till sim-data): missiler och interceptorer (id, klass, ägare, start- och målcell, uppskjutningstick, mötestick, mötesposition, utfall, tillstånd) samt lagret `FALLOUT_UNTIL` (eller en dirty-cell-lista). Dokumentera tillägget i ARCHITECTURE.md.
2. `src/render/fx/fx.config.ts` (alla parametrar) och statslösa GPU-partikelsystem (instanserade quads/Points styrda av tid + seed i shadern): robotspår, SAM-rök, gnistor, svampmoln som stack av billboards, chockvågsring på terrängen (gärna uniformer i terrängshadern, max 8 samtidiga), blixt och skräp. API:t exponerar `cpuBytes()`. Kosmetisk slump seedas från händelse-id, aldrig från sim-PRNG. ESLint-regel på `src/render/fx/update*.ts` förbjuder `new` samt objekt- och array-literaler i per-frame-vägen.
3. Robotbanor längs storcirkeln med slerp och parabolisk toppunkt (apex proportionell mot banlängden för ballistiska; Tactical följer marken via `groundHeightAt` + låg höjd). Markprojektionen ska överensstämma med simpositionen. Interceptor med proportional navigation mot det i förväg avgjorda mötet (InterceptorLaunched): vid lyckad avlyssning försvinner stridsspetsen på brännpunktsframen med en brisanssprängning; vid miss fortsätter den.
4. Nedfallsglöd och kratertoning via ownership-texturens flags-kanal (sätts från snapshot; får inte kollidera med befintliga flaggor). Screen-shake-tjänst (amplitud x en skalfaktor som M21 senare kan sätta till 0) och en kill-cam-växel.
5. `src/render/post`: EffectComposer med UnrealBloomPass + SMAAPass, aktivt bara på high-tier; av i test-tier men tvingat på i fx-scenen `?test=1&scene=fx` (fast kamera över Alperna, scriptad uppskjutning och detonation, `__test.fx.setTime(t)`, `__test.fx.stats()`). Registrera scenen som `?scene=fx` i Dev-panelen (registerDevMode) med en knapp som slår bloom på/av. Alla effekter går på fx-klockan.
6. Fotosensitivitet (konstanter i fx.config.ts): blixt högst 150 ms toppduration, högst 3 blixtar per sekund globalt, ingen helskärmsblinkning.

REGLER, TAL OCH GRÄNSSNITT
- Partikeltak aldrig över 20 000 på någon tier (förslag: test 2 000, low 5 000, medium 12 000, high 20 000; skriv valet i DECISIONS.md). Extra draw calls för alla missil-/fx-system <= 15; lägg fx-lagret som en rad i tabellen "Budgetar" i docs/ARCHITECTURE.md (fx-lager: test-tier-trianglar enligt ditt val, <= 15 draw calls).
- Sim ändras inte: `git diff src/sim` ska vara tomt eller bara läsfunktioner. Sim-hashen får inte påverkas av VFX. Inga UI-strängar i det här steget.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Målläge, panel, siktesringar, kantpil, genvägar, query-former och 'nuke'-scenariot (M15b). Ljud (M22), reduced-motion och cinematiska kameror (M21), minimap och varningssystem (M20), AI-användning (M17), balans (M19), fler sim-regler.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: snapshot och config, banor, detonation, sist composer. En screenshot per effekt.

ACCEPTANS
- Detonationsgoldens vid t=0, 0,5, 1, 2 och 5 s skiljer sig parvis åt, två renderingar i samma webbläsarstart är byte-identiska, och mot committad golden gäller pixelmatch-tröskel 0,1 och <= 0,2 % avvikande pixlar. Fyra storheter är monotona (assertera i fx-scenen): blixtytan (andel pixlar med luma > 240) toppar före 0,5 s och avtar, ringradien växer till 2 s, molnets topphöjd växer till 5 s, glödytan avtar efter 2 s.
- Fotosensitivitet: med 10 samtidiga detonationer ger `fx.stats()` blixtar/s <= 3, längsta blixt <= 150 ms och max andel skärmpixlar med luma > 240 under en blixt <= 25 %.
- Partikeltaket följs; `cpuBytes()` är 0 och konstant över de 60 renderanropen; ESLint-regeln slår till på en medvetet felaktig fixtur; extra draw calls <= 15; läckagetest (taggat leak-test, körs i e2e-skalet) med upprepade uppskjutningar: viewport 320x180 över 60 renderanrop (3 omgångar x 20), `heapDelta` < 5 MB, medianen av 3 (heap och renderer.info.memory beror inte på upplösningen).
- Snapshoten innehåller missiler, interceptorer och FALLOUT_UNTIL som kopior (ändring i simen efter snapshoten ändrar den inte). När simen säger "intercepted" är stridsspetsens entitet borta efter brisansframen (testkrok). Composer på mot av skiljer sig över en tröskel i fx-scenen.
- Renderad robotposition i markplan == simposition inom 0,5 cell i samplade frames. Fusion-sprängningens celler når ownership-texturen inom 10 Hz-strypningen utan frame-stall.
- Sim-hashen är oförändrad med/utan VFX. Instans-/draw-call-tak och test-tier <= 150k trianglar hålls; `npm run verify` grönt.

SLUT
Enligt CLAUDE.md: uppdatera docs/PROGRESS.md, DECISIONS.md och ARCHITECTURE.md (fx-system, fx.config.ts, snapshot-tillägget, Dev-läget `?scene=fx`, fx-raden i "Budgetar"). Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara sedan på svenska: vad som gjordes, vad som avvek, mätvärden och hur jag öppnar fx-scenen via Dev-panelen (och som adress, Artifact: `#scene-fx`).
```

**Efteråt gör du:**
- Be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main" (eller gör det på GitHub) innan du startar M15b.
- Vill du titta redan nu: öppna förhandsvisningen, tryck F2 (Artifact: `#scene-fx`) och välj fx-scenen. Det riktiga omdömet om utseendet gör du vid gaten i M15b.

## M15b — Målläge för nukes: siktesringar, hotpil och kommandon

| | |
|---|---|
| **Kräver** | M15a mergad |
| **Beräknad insats** | ~1,8 h agentarbete (1,1–2,8 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — du spelar nuke-scenariot på riktig GPU (Silo i bergen, välj mål, skjut), tittar på bågen, SAM-försöken, chockvåg, svampmoln, nedfallsglöd, bloom på/av och om något blinkar obehagligt, och rapporterar med mallen "Feedback efter en gate" (under Mallar i den här listan) |
| **Du ser efteråt** | Du väljer en Silo, pekar ut ett mål med siktesringar för sprängradie och SAM-hot, skjuter, och ser en kantpil när en missil är på väg mot dig. |

**Klistra in i en ny session:**

```text
Du bygger milestone M15b (Målläge för nukes: siktesringar, hotpil och kommandon) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (öppna bara de källfiler den pekar på).
- Särskilt: M14:s intents, reason codes och public.ts-funktioner (`validateMissileLaunch`, `previewBlast`, `previewThreat`), `src/sim/scenarios.ts` (M13a), SimHost.query (M13b), src/app/input.ts (modestacken, M08), markeringspanelen och src/ui/toast.ts (M10), `?scenario=slice` (M13) som förebild, fx-scenen från M15a, src/ui/i18n.ts.

FÖRKONTROLL
Kolla i docs/PROGRESS.md och `git log` att M15a är mergad i main. Om inte: stanna och berätta för mig. Skriv `git rev-parse origin/main` som merge-SHA för föregående prompt i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det inte grönt, stanna.

MÅL
Ett användbart målläge för missiler på toppen av M14 (sim) och M15a (effekter): panel, siktesringar för räckvidd, sprängradie och SAM-hot, bekräftelse och inkommande-varning. Sista delen av M15; efter den är det din tur att bedöma utseendet (gate).

GÖR
1. Lägg till query-kinds `previewBlast`, `previewThreat` och `validateMissileLaunch` i SimHost.query() (asynkront gränssnitt från M13b; UI strypt till en utestående förfrågan per kind och släpper inaktuella svar). Frågorna anropar bara public.ts-funktionerna; inga regler dupliceras.
2. Målläge: markera en Silo, panel i markeringspanelen med robotklass, pris inklusive +25 %-stegringen, grå-ut med orsak (för lite guld, cooldown 45 s, Fusion kräver Silo nivå 2, utom räckvidd) och "Välj mål". Ta bort den provisoriska `SILO_PREVIEW_RANGE_CELLS` (M10): hover-ringen och målläget läser räckvidden per klass ur rules.ts (Tactical 80, Fission 240, Fusion obegränsad: visa då ingen ring förrän ett skott är valt). Målläget är ett läge på mode-stacken i src/app/input.ts (Esc avbryter det, inget intent skickas). Under målval visas siktesringar: räckviddsring på terrängen, sprängradie (r_in och r_out som skivor, via `previewBlast`), SAM-hot längs banan (via `previewThreat`) och bekräftelse med klick som skickar `LaunchMissile`.
3. Inkommande missil mot dig: kantpil på skärmen med ETA-nedräkning (enkel DOM-pil med data-testid; M20b integrerar den i varningssystemet).
4. Alla nya strängar via `t()` och läggs i både `sv` och `en` i samma commit.
5. Registrera tangentbordsgenvägar på samma ställe som befintliga och lista dem i docs/PROGRESS.md så att M20a kan ta med dem i hjälpöverlägget.
6. Dev-läget/scenariot `?scenario=nuke` (hashformen `#scenario-nuke` ger samma läge; registerDevMode, på samma sätt som slice) som en ny rad i `src/sim/scenarios.ts` (scenarioId 2 = nuke; inga regeländringar): en Silo nivå 2 på en bergssluttning med guld, ett tätt fiendekluster inom Fission-räckvidd och fiende-SAM. Playwright-scenario "nuke" kör det (skjut, SAM försöker, detonation).

REGLER, TAL OCH GRÄNSSNITT
- UI skickar bara intents och läser sim via SimHost.query(). Sim ändras inte: `git diff src/sim` får visa bara `src/sim/scenarios.ts` (nuke-raden). Sim-hashen får inte påverkas av VFX.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Partiklar, bågar, efterbehandling, snapshot-utökning (M15a, klart). Fullt varningssystem och minimap (M20b), hjälpöverlägg (M20a), pausmeny (M18), ljud (M22), AI-användning (M17).

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: query-former, panel och grå-ut, siktesringar, kantpil, scenario och Playwright.

ACCEPTANS
- Varje grå-ut-orsak visas när den gäller; en grå-ut-knapp som klickas skickar inget intent (kontrollera att intent-kön förblir tom).
- `previewBlast` före skott == faktiskt utfall efter detonationen (celler och byggnader per ägare) i en fixtur utan SAM. `previewThreat` ger täckning > 0 för en bana genom en SAM-radie och exakt 0 för en bana utanför alla.
- 100 snabba förfrågningar ger aldrig fler än en utestående per kind och inaktuella svar kastas; query-svaret == direkt public.ts-anrop.
- Esc i målläget avbryter bara målläget (ingen pausmeny, inget intent). Kantpilen visas bara för missiler som siktar mot dig och dess ETA minskar.
- Playwright "nuke" slutför med noll console errors: målcellerna blir neutrala med nedfall, minst en SAM-händelse inträffade, sim-hashen identisk med och utan VFX. `npm run verify` grönt.

SLUT
Enligt CLAUDE.md: uppdatera docs/PROGRESS.md (inklusive genvägslistan), DECISIONS.md och ARCHITECTURE.md (query-formerna, scenariot). Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara sedan på svenska med en kort lista "Så spelar du" (kontroller för nuke-läget) och en numrerad lista över vad jag bör titta på på min GPU: nuke från en bergssilo via `?scenario=nuke` (Artifact: `#scenario-nuke`; eller Dev-panelen, F2), SAM som lyckas och missar, chockvåg, moln, nedfallsglöd, målläge, kantpil, bloom på/av, obehagliga blinkningar.
```

**Efteråt gör du:**
- Merga PR:en (se Så använder du listan), öppna förhandsvisningen, tryck F2 (Artifact: `#scenario-nuke`) och starta nuke-scenariot. Skjut en Tactical och en Fission och titta på banan, SAM-försöken och explosionen. Titta särskilt på om bloom, moln och blixtar känns bra eller obehagliga.
- Skicka din rapport i en NY session med mallen "Feedback efter en gate" (under Mallar i den här listan); hoppa över om allt var bra.
- Merga eventuell fix-PR innan du startar M16.

## M16 — AI-regissör v1: ekonomi, expansion, aggression, svårighetsgrader

| | |
|---|---|
| **Kräver** | M06 och M09 mergade |
| **Beräknad insats** | ~4,5 h agentarbete (2,6–8,4 h); hård gräns för tuning, se ARBETSSÄTT |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Motståndare som bygger städer, hamnar, fabriker och luftvärn, expanderar och anfaller dig i olika stilar, från Easy till Impossible. |

**Klistra in i en ny session:**

```text
Du bygger milestone M16 (AI-regissör v1: ekonomi, expansion, aggression, svårighetsgrader) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (öppna bara de källfiler den pekar på).
- Särskilt: AI v0 i src/ai och src/host/aiDriver.ts (M09), `SimView` (src/sim/view.ts) och src/sim/public.ts, matchheadern och svårighetsfältet från M06, scenario-CLI:t, lint-reglerna för src/ai, hur Skirmish-crops/masker laddas.

FÖRKONTROLL
Kolla i docs/PROGRESS.md och `git log` att M06 och M09 är mergade i main (M15b enligt listordningen). Om inte: stanna och berätta för mig. Skriv `git rev-parse origin/main` som merge-SHA för föregående prompt i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det inte grönt, stanna.

MÅL
Motståndare som spelar efter samma regler genom intents, i fyra svårighetsgrader (Easy, Medium, Hard, Impossible) och inom en liten CPU-budget. Ersätter AI v0. Helikoptrar, missiler och nukes hör till M17: här använder AI:n dem inte. Verklig tuning görs i M19.

GÖR
1. src/ai: en ren funktion (SimView, minne, egen PRNG) -> Intent[], anropad av `aiDriver` (M09) vid varje säts tänkeintervall (staggerat per säte). AI-minnet och PRNG:n serialiseras som en separat AI-state-blob. src/ai får importera ENDAST (a) den skrivskyddade typen `SimView` och (b) de rena skrivskyddade hjälpfunktionerna i src/sim/public.ts (nu `validateBuild`; senare tillkommer fler). Aldrig `step`, state-mutatorer eller skrivbara arrayer. Tvinga det med en ESLint-allow-list (no-restricted-imports) och ett typtest, plus ett test där en fixturfil som importerar `step` får lintfel. Ingen läsning av dold information utöver vad spelaren själv kan se.
2. Perception var 20–30 tick per säte, förskjuten med hash(säte) % period, på en 64x32 regiongraf med hot och inflytande (gränsgrannar, egna/fiendens trupper, avstånd).
3. Utility-poängsättning med responskurvor över handlingar: expandera, anfalla, bygga, vänta.
4. Ekonomiplanerare efter förhållande strukturer per stad: Port 0,75 (om kust), Factory 0,5, SAM 0,15 / 0,2 / 0,25 / 0,3 för Easy / Medium / Hard / Impossible. Städer först (en City inom 120 s). Platser väljs i ett begränsat fönster runt egna celler via `validateBuild`.
5. Expansion: trigga vid 50–60 % av trupptaket och spara 30–40 % reserv (värden som data inom intervallen per personlighet/svårighet). Aggressionspoäng = svaghet * närhet * belöning - fara, med tröskel på styrkeförhållande. Attack-intents väljer procent via reserven.
6. Personligheter (builder, rusher, turtle, nuker) som viktdata, valda med AI:ns egen PRNG. Nuker får bara vikter nu; beteendet kommer i M17.
7. Svårighet = per-säte-handikapp i matchheadern (gäller bara AI-säten, aldrig människan): trupptak x0,5 / 0,75 / 1,0 / 1,25, regen x0,9 / 0,95 / 1,0 / 1,05, tänkeintervall 16 / 10 / 6 / 4 s (160 / 100 / 60 / 40 ticks, läses per säte av aiDriver; `AI_THINK_INTERVAL_TICKS` från M09 tas bort eller blir bara värdet för AI v0-tester), chans för bortkastad handling 20 / 10 / 5 / 0 %. Saknar sim per-säte-multiplikatorer: lägg dem minimalt i rules.ts/state och hash:a dem. Inget fusk utöver dessa.
8. Beslutslogg: de tre högsta utility-värdena per tänkande, via `window.__test` och i headless-CLI. Ersätt AI v0 överallt.
9. `npm run ai:selfplay -- --ai 8 --minutes 15 --seed N` och `--a hard --b easy --seeds 20` (head-to-head med worker_threads, sidor/startplatser växlade) som skriver ut slutställning, hash, intents/avvisade och tänkekostnad.

REGLER, TAL OCH GRÄNSSNITT
- Alla AI-tal i en datafil under src/ai (personligheter, svårigheter) eller (för sim-konstanter) via re-export i src/sim/public.ts (UPPER_SNAKE_CASE); inga magiska tal i logiken. Sim och AI förblir rena: lint-förbuden gäller (ingen Math.random/Date/trig/pow, inga objektnyckel-loopar, ingen DOM). AI:n har egen seedad PRNG i minnet.
- En AI som skickar ogiltiga intents räknas som ett fel: förvalidera med sims validatorer innan intent skickas.
- Selfplay- och smoke-körningarna (`ai:selfplay`, 8 AI x 15 min, 20 head-to-head) är CLI-skript som körs med run_in_background och ingår INTE i `npm run verify`; verify får bara en 2-matchers smoke (<= 60 s). M19 äger regressionen 12 matcher x 2400 ticks.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Helikopter-, missil-, nuke- och SAM-täckningsbeteende utöver att bygga SAM efter ratio (M17), vinstvillkor och gang-up på ledaren (M17/M18), balansjustering (M19), diplomati/allianser, fusk, GOAP.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: perception, utility och ekonomi, aggression, sist svårighet och självspel. Tidsgräns: skriv starttiden (`date -u`) under Now i docs/PROGRESS.md i början och kolla `date -u` före varje delmål; stanna när 3 timmar gått eller efter 40 verify-körningar, vilket som inträffar först. Det som är kvar går till docs/BACKLOG.md.

ACCEPTANS
- (CLI-skript via ai:selfplay, run_in_background, inte i verify; verify kör samma kontroll på 2 seeds x 3 min) Över 20 seeds: AI bygger en City inom 120 s i >= 95 % av säten; inget säte står stilla > 60 s medan det har råd med en giltig handling; <= 5 % av intents avvisas av sim.
- Kostnad (Node, med `budgetMs` ur tests/perfguard.ts): tänkekostnad p95 <= `budgetMs(1)` per säte med 12 AI-säten; median-tickkostnad (>=5 mätningar efter 2 uppvärmningar) <= `budgetMs(1)` ms i en 6-säten Skirmish-crop-match; total tick p95 <= `budgetMs(4)`; en match med 8 AI på 15 minuter körs headless på <= `budgetMs(60 000)` ms (kör längre jobb med run_in_background och loggfil).
- Hard slår Easy i >= 70 % av 20 seedade head-to-head-matcher i Skirmish (CLI-körning, worker_threads, i bakgrunden; inte i verify).
- Importregeln: lint och typtest bevisar att src/ai bara når SimView och public.ts (fixturen med `step`-import fångas). AI-state-blobben serialiseras och återställs till samma intents som utan paus. Samma seed ger samma slutliga hash; en felande seed återskapar felet exakt.
- Golden hashes regenererade med orsak; snapshot-equals-straight-run och determinism-tester gröna; `npm run verify` grönt.

SLUT
Enligt CLAUDE.md: uppdatera docs/PROGRESS.md, DECISIONS.md, ARCHITECTURE.md (AI-gränssnitt, importregel, handikapp) och BALANCE.md (AI-parametrar). Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara sedan på svenska: vad som gjordes, vad som avvek, mätvärdena (tänkekostnad, Hard mot Easy, byggtid för första City) och en kort "Så spelar du mot de fyra nivåerna".
```

**Efteråt gör du:**
- Merga PR:en (se Så använder du listan) innan du startar M17.
- Öppna förhandsvisningen, starta en match mot Easy och sedan en mot Hard och se skillnaden i tempo och byggande; titta i leaderboarden på hur snabbt de växer.

## M17 — AI-specialiteter: luftlandsättning, nukes och luftvärn

| | |
|---|---|
| **Kräver** | M12b, M14 och M16 mergade |
| **Beräknad insats** | ~3,4 h agentarbete (2–6,3 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | En Hard-AI som överraskar med en helikopterlandning bakom din linje eller en nuke mot din huvudstad, och som bygger SAM som svar på dina. |

**Klistra in i en ny session:**

```text
Du bygger milestone M17 (AI-specialiteter: luftlandsättning, nukes och luftvärn) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (öppna bara de källfiler den pekar på).
- Särskilt: AI-koden från M16 (perception, utility, personligheter, svårighet, beslutslogg, `ai:selfplay`, importregeln), src/sim/public.ts (`validateBuild`, `validateHeliLaunch` (M13b), `validateMissileLaunch` (M14), `planRoute`, `scoreLz`, `exposure`, `previewBlast`, `previewThreat`), scenariofixtures från M11/M12/M14.

FÖRKONTROLL
Kolla i docs/PROGRESS.md och `git log` att M12b, M14 och M16 är mergade i main. Om inte: stanna och berätta för mig. Skriv `git rev-parse origin/main` som merge-SHA för föregående prompt i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det inte grönt, stanna.

MÅL
Få AI:n att använda helikoptrar, missiler och luftvärn förnuftigt, utan att vara frustrerande eller tandlös. Allt som intents; ingen informationsfusk (AI ser fiendens helikoptrar bara om lagets detection gör det).

GÖR
1. AI:n når helpers synkront: `scoreLz`, `planRoute`, `exposure`, `previewBlast`, `previewThreat`, `validateHeliLaunch` och `validateMissileLaunch` anropas som rena funktioner via src/sim/public.ts på SimView, aldrig via den asynkrona SimHost.query() (den är bara för UI). Saknas någon i public.ts: lägg bara till en re-export av den rena, skrivskyddade funktionen (inga regeländringar) och visa `git diff src/sim` i sammanfattningen. Importregeln från M16 gäller oförändrad.
2. Operationer som små handskrivna FSM:er (inte GOAP) med tydligt tillstånd i AI-minnet (AI-state-blobben från M16):
   - AirAssault: välj LZ bakom en höjdrygg med exponeringsfältet och `scoreLz`, ladda trupper, planera smygrutt (Low), skicka `LaunchHeli`, släpp, dra tillbaka/RTB.
   - NukeStrike: se till att en Silo finns (kräver Factory), välj ett tätt målkluster (hög summa stadsnivåer inom r_out-skivan via `previewBlast`), skjut. AI:n använder Tactical och Fission; Fusion lämnas till BACKLOG.md.
   - AirDefense: SAM/Defense Post-täckning för värdefulla platser efter ratio per stad (SAM 0,15 / 0,2 / 0,25 / 0,3 per svårighet från M16; stadsnivå-viktad kö).
   - Motreaktion mot helikoptrar: när fiendehelikopter detekteras nära egna städer, bygg Defense Posts nära de hotade städerna.
3. Grindar och tak: nukes från Medium, helikoptrar från Hard (Easy gör aldrig något av det). Spam-tak (provisoriska, i AI-datafilen och DECISIONS.md): högst en helikopterräd i luften per säte, minsta intervall mellan räder, högst N nukes per match och säte (ökande med svårighet), max två Silos per AI-säte. Raidstorlek = `raidTroops` i datafilen.
4. Gang-up: lägg `LEADER_LAND_PCT_HIGH = 40` och `LEADER_LAND_PCT_MID = 25` i rules.ts. AI föredrar ledaren som mål när någon har över `LEADER_LAND_PCT_HIGH` av den viktade marken. M18 återanvänder båda konstanterna för anti-snowball; skapa inga dubbletter.
5. Scenariofixtures: bergsomringat mål, ö-mål, tätt stadskluster (bygg på befintliga fixturer eller lägg till i samma mapp).

REGLER, TAL OCH GRÄNSSNITT
- Samma regler som människan: inga handikapp utöver M16:s multiplikatorer. Förvalidera intents med sims validatorer. Tänkekostnad <= 1 ms per säte även med specialiteterna (staggerat, avbrytbart arbete, bundet fönster).
- Sim och AI förblir rena (lint-förbuden gäller). Sim ändras inte annat än re-exporter av läsfunktioner.
- Vinstvillkor kommer i M18: "matchen slutar" betyder här tidsgränsen (Skirmish 12 min = 7200 ticks).
- Smoke-körningen (12 matcher x 7200 ticks) och spam-takstestet över 20 seeds är CLI-skript med run_in_background och ingår INTE i `npm run verify`; verify får bara en 2-matchers smoke (<= 60 s). M19 äger regressionen 12 matcher x 2400 ticks.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Vinstvillkor, anti-snowball-multiplikatorer och resultatskärm (M18), balansjustering (M19), HUD (M20a/b), Fusion-missiler och MIRV, diplomati, gemensamma operationer mellan AI-säten.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: AirDefense (enklast), AirAssault, NukeStrike, sist grindar och smoke-körning. Smoke-körningen går med run_in_background och loggfil.

ACCEPTANS
- Scenariotester: på det bergsomringade målet landar en Hard-AI:s helikopterräd minst `raidTroops` trupper; AI:s nuke väljer ett tätt kluster; SAM-täckningen når konfigurerat förhållande per stad senast minut 10.
- Grindar: Easy skickar aldrig nuke eller helikopter; spam-taken håller över 20 seeds (4 AI-säten, 6 minuter, worker_threads).
- Smoke-körning, 12 matcher i Skirmish-crop med blandade svårigheter (Easy till Impossible): 100 % körs till tidsgränsen utan undantag och utan desync (två körningar av samma seed ger samma slutliga hash).
- Positiva frekvenser i samma smoke-körning (så att en AI som aldrig gör något inte klarar testet): Hard/Impossible-säten skickar helikopterräder i >= 3 av 12 matcher och nuke-slag i >= 3 av 12; Medium-säten skickar >= 1 nuke i >= 2 av 12. Antalen loggas.
- Importregeln håller (lint + typtest från M16). Tänkekostnad p95 <= `budgetMs(1)` per säte och >= 95 % giltiga intents; total tick p95 <= `budgetMs(4)`.
- Golden hashes regenererade med orsak; `npm run verify` grönt.

SLUT
Enligt CLAUDE.md: uppdatera docs/PROGRESS.md, DECISIONS.md (särskilt spam-taken), ARCHITECTURE.md (operationer, AI-minne, public.ts) och BALANCE.md. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara sedan på svenska: vad som gjordes, vad som avvek, hur ofta räder och nukes förekom i smoke-körningen, `git diff src/sim` och hur jag ser dem i spelet.
```

**Efteråt gör du:**
- Merga PR:en (se Så använder du listan) innan du startar M18.
- Spela mot Hard (Skirmish-region med bergskedjor, t.ex. Europa) i 10–15 minuter och se om AI:n landsätter trupper bakom din linje, bygger SAM mot dina helikoptrar eller nukar ett tätt kluster. Det är medvetet att det inte händer varje match.

## M18 — Matchflöde: vinstvillkor, anti-snowball, resultat

| | |
|---|---|
| **Kräver** | M17 mergad |
| **Beräknad insats** | ~3,2 h agentarbete (2,1–5 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Matcher som slutar med en seger- eller förlustskärm med tabell och statistik, en pausmeny, och en skenande ledare som AI-nationerna går samman mot. |

**Klistra in i en ny session:**

```text
Du bygger milestone M18 (Matchflöde: vinstvillkor, anti-snowball, resultat) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (öppna bara de källfiler den pekar på).
- Särskilt: erövringskoden och cellkostnadsfunktionen (M04), land-share-spårningen, strukturnivåer (M09), outbox-händelser (M12–M14), matchheadern och konfigen (M06: World/Skirmish, spawnfas), src/ui/toast.ts (M10), src/app/input.ts (modestacken, M08), startskärmen och menyn, `ai:selfplay` (M16), `LEADER_LAND_PCT_HIGH`/`LEADER_LAND_PCT_MID` i rules.ts (M17), `window.__test`.

FÖRKONTROLL
Kolla i docs/PROGRESS.md och `git log` att M17 är mergad i main och att de två LEADER_LAND_PCT-konstanterna finns i rules.ts (annars: stanna och berätta). Skriv `git rev-parse origin/main` som merge-SHA för föregående prompt i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det inte grönt, stanna.

MÅL
Gör sandlådan till matcher med början, mitt och slut: tre vinstvillkor, en tidsgräns med övertid, anti-snowball, eliminering, pausmeny och resultatskärm. Reglerna bor i sim; UI läser bara.

GÖR
1. Vinst (i sim, `src/sim/win`): (a) håll >= `WIN_LAND_SHARE` (60 %) av den viktade marken i `WIN_HOLD_TICKS` (300 ticks sammanhängande = 30 s; timern nollställs om andelen sjunker under kravet); (b) sist levande; (c) högst poäng vid tidsgränsen `TIME_LIMIT_SKIRMISH_TICKS` (7200 = 12 min) eller `TIME_LIMIT_WORLD_TICKS` (15000 = 25 min). Poäng = land + 25 * summa stadsnivåer + 10 * summa fabriksnivåer, med land i viktade std-celler (heltal; samma enhet som 60 %-regeln). Tiebreak: högre land, därefter lägre säte-id. Nämnaren för 60 % är all spelbar viktad mark (Skirmish-crops: inom masken, inklusive stammar och neutral mark). Övertid: kravet sjunker `OVERTIME_STEP_PCT` (1) procentenhet per hel minut efter minut 20 (60 % till minut 21, 59 % därefter osv.); eftersom Skirmish slutar vid 12 min gäller övertiden i praktiken World, testa kurvan som ren funktion och notera det i DECISIONS.md. Tidsgränsen räknas från att spawnfasen slutar. Alla fem konstanter i rules.ts: M19 gör dem justerbara.
2. Anti-snowball: attackerande nation får kostnadsmultiplikator x0,85 när målet håller över `LEADER_LAND_PCT_MID` (25 %) av den viktade marken och x0,7 över `LEADER_LAND_PCT_HIGH` (40 %) (strikt större än; inte staplade, den högre nivån ersätter). Multiplikatorn gäller kostnaden för attacker MOT en nation över tröskeln (stammar och neutral mark påverkas inte); skriv tolkningen i DECISIONS.md. Verifiera och testa att AI:ns gang-up-regel (M17) läser samma konstant; duplicera inte.
3. Eliminering: en nation är eliminerad när den inte äger några celler (förlust av huvudstaden ger bara en händelse/varning). Elimineras människan: val mellan Titta på (spectate, AI-matchen fortsätter, hastighet 1x/2x/4x), Starta om och Meny. Spawnfasens slutform: 20 s med 5 s immunitet, synlig nedräkning; den som inte valt plats får en seedad automatisk startplats.
4. Statistik i sim (hashas och serialiseras): topp-land per säte, avfyrade nukes, förlorade helikoptrar, byggda strukturer, erövrade celler.
5. UI: pausmeny (återuppta, starta om, till menyn, hastighet), resultatskärm (tabell med plats, nation, land %, poäng, topp-land, nukes, förlorade helikoptrar; vinstvillkoret som text; Spela igen), händelselogg och toasts via den befintliga `src/ui/toast.ts` (max 3 synliga, M10:s tak, ändra inte; tidsutlöpande, data-testid; skapa ingen ny). Esc via mode-stacken i src/app/input.ts: Esc stänger det innersta aktiva läget (målläge, deploy, placering, chase-kamera, markering) och öppnar pausmenyn bara när stacken är tom. Win-progress som läsfunktion (ledare, andel, sekunder kvar på hålltimern) för M20a:s HUD. Alla strängar via `t()` i både sv och en.
6. Utöka `ai:selfplay` med `--matches N --mode skirmish --ai-only` (worker_threads) som skriver ut hur varje match slutade och loggar väggtid och antal kärnor.

REGLER, TAL OCH GRÄNSSNITT
- Alla tal i src/sim/rules.ts (UPPER_SNAKE_CASE) + BALANCE.md. Sim förblir ren (lint-förbuden gäller; ingen trig/pow/Math.random/Date). UI skickar bara intents.
- Tolkningar du måste välja (poängenhet, övertidens stegning, eliminering, auto-spawn): dokumentera i DECISIONS.md.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Full HUD med vinstframsteg-stapel, minimap och alerts (M20a/b), balans och uppmätta matchlängder (M19), alliansvinst/pakter, replays, omatchning online, ljud/stingers (M22), kameraeffekter (M21).

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: vinstregler och tester, anti-snowball, eliminering och statistik, sist UI. Matchkörningen går med run_in_background och loggfil.

ACCEPTANS
- Regeltester: hålltimern på 300 ticks nollställs vid dipp under kravet; sist levande; poängtiebreak; övertidskurvan (60 % till minut 21, sedan 1 poäng/min); anti-snowball-multiplikatorn tillämpas exakt över 25 % och 40 % och inte vid exakt 25,0 %/40,0 %.
- `npm run ai:selfplay -- --matches 40 --mode skirmish --ai-only` (CLI-körning i bakgrunden med loggfil, inte i `npm run verify`): alla 40 matcher slutar med ett av de tre villkoren inom tidsgränsen, 0 hängda matcher; fördelningen mellan de tre villkoren, väggtid och antal kärnor loggas. (De 200 matcherna körs i M19.)
- Playwright: en snabbspolad scriptad match når resultatskärmen med statistik lika med sim-state, noll console errors; eliminering visar valet Titta på / Starta om / Meny; med ett aktivt läge på mode-stacken öppnar Esc inte pausmenyn, med tom stack gör den det.
- Snapshot- och determinismtester utökade och gröna i Node och Chromium; golden hashes regenererade med orsak; `npm run verify` grönt.

SLUT
Enligt CLAUDE.md: uppdatera docs/PROGRESS.md, DECISIONS.md, ARCHITECTURE.md (win-API, statistik, UI-flöde, Esc-regeln) och BALANCE.md. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara sedan på svenska: vad som gjordes, vad som avvek, hur de 40 matcherna slutade (fördelning mellan de tre villkoren), en kort "Så spelar du" (pausmeny, resultatskärm) och exakt vad jag ska testa.
```

**Efteråt gör du:**
- Merga PR:en (se Så använder du listan) innan du startar M19.
- Öppna förhandsvisningen, starta en Skirmish-match och snabbspola (4x) eller spela tills den slutar. Se resultatskärmen, prova Esc-menyn och att bli eliminerad (låt en större AI ta dig).

## M19 — Balansverktyg och justeringspass

| | |
|---|---|
| **Kräver** | M18 mergad |
| **Beräknad insats** | ~3,8 h agentarbete (2,5–7 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Bättre tempo i matcherna: luftlandsättningar runt minut 8–12, nukes senare, ingen dominant öppning, samt en läsbar balansrapport i docs/BALANCE.md. |

**Klistra in i en ny session:**

```text
Du bygger milestone M19 (Balansverktyg och justeringspass) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (öppna bara de källfiler den pekar på).
- Särskilt: docs/BALANCE.md, src/sim/rules.ts (inklusive vinstkonstanterna från M18), `ai:selfplay` (M16, M18), AI-datafilerna (personligheter, svårigheter, spam-tak), helikopter-raid-CLI:t från M12 och missil-CLI:t från M14, M04:s kalibreringsband och M12:s raid-band i testerna, mekanismen för golden hashes, tests/perfguard.ts.

FÖRKONTROLL
Kolla i docs/PROGRESS.md och `git log` att M18 är mergad i main. Om inte: stanna och berätta för mig. Om någon av mina inledande rader (de som står före texten "Du bygger milestone") är `Kapa djupet: högst ett justeringspass`, gör högst ETT justeringspass (inte två) och skriv det i docs/DECISIONS.md. Skriv `git rev-parse origin/main` som merge-SHA för föregående prompt i milestone-tabellen i docs/PROGRESS.md. Kör `npm ci && npm run verify:fast`; är det inte grönt, stanna. Kör `node -e "console.log(require('os').availableParallelism())"` och anteckna antal kärnor i docs/PROGRESS.md.

MÅL
Ersätt gissade tal med uppmätta genom headless Monte-Carlo-matcher AI mot AI. Mät först (baslinje), ändra sedan i högst två justeringspass, en familj av tal åt gången, och logga varje ändring med uppmätt effekt. Inga nya npm-paket.

GÖR
1. Mät först ms/tick för en 12-säten Skirmish-crop-match och rapportera det.
2. `tools/balance`: worker_threads-körare (återanvänd M18:s matchkörare). `npm run balance -- --matches N` kör N seedade Skirmish-crop-matcher fördelade över tillgängliga kärnor; `npm run verify:balance` är en separat, tung körning av 200 matcher (plus öppningsmatcherna nedan) som körs med run_in_background och loggfil och INTE ingår i `npm run verify`. `--world 20` kör 20 World-matcher separat (får ta längre tid; logga tiden). Samma seeds ger identisk CSV. CSV i en gitignorerad mapp; markdown med tabeller före/efter genereras till docs/BALANCE.md, med en sammanfattning överst på svenska.
3. Regressionstestet i `npm run verify`: 12 matcher x 2400 ticks (4 spelminuter) på 4 workers med breda band (landandel vid minut 4 per svårighet inom +/-40 % kring uppmätt baslinje, 0 hängda matcher, ingen nuke över taken, samma seed ger samma hash). Anteckna antal kärnor i PROGRESS.md.
4. Mått: vinstprocent per svårighet och personlighet, median matchlängd, andel domination mot tidsgräns mot sist levande, landandel vid minut 5/10/15, öppningsdominans för skriptade strategier (turtle, nuke-rush, heli-rush; skriptade intent-producenter under tools/balance, 40 matcher vardera mot lika stark AI), helikopterräders framgång, nukes per match, snowball-index samt minut för första räd och första nuke.
5. Justera efter målen nedan. Justerbara familjer (en familj per pass, skäl loggas): prisstegring, inkomst, helikoptertak och last, SAM-Pk, nukepriser, samt vinstreglerna `WIN_LAND_SHARE`, `WIN_HOLD_TICKS`, `TIME_LIMIT_SKIRMISH_TICKS`, `TIME_LIMIT_WORLD_TICKS` och `OVERTIME_STEP_PCT`.
6. Kräver en justering ändrade KALIBRERINGSband i tidigare tester (M04:s expansionsband, M12:s raid-band, M09:s ekonomi): ändra bara bandet med skriftlig orsak och uppmätt effekt i docs/BALANCE.md. Rör aldrig determinism-, korrekthets-, hash- eller snapshot-tester annat än att golden hashes regenereras med orsak.

REGLER, TAL OCH GRÄNSSNITT
Mål (exakt):
  - Skirmish median matchlängd 8–12 min (tidsgränsen 12 min kapar övre delen); World median 25 +/-6 min (tidsgränsen 25 min).
  - >= 70 % av Skirmish-matcherna når ett avgörande (dominans eller sist levande, inte bara poäng vid tidsgräns). Går det inte att nå inom 2 pass: dokumentera det uppmätta värdet, sänk målet till >= 50 % och motivera.
  - Ingen skriptad öppning vinner > 60 % av 40 matcher mot lika stark AI.
  - Helikopterräder lyckas 25–55 %, mätt som AI-startade räder i fulla matcher vars LZ ligger inom en fiende-SAM:s radie (lyckad = når Landed och släpper last, samma definition som M12b:s raid-CLI). M12:s skriptade raid-band är en separat regression och får ändras bara med dokumenterad orsak i BALANCE.md.
- Alla tal bara i rules.ts/AI-datafilerna. Sim och AI förblir rena (lint-förbuden gäller; tools/balance får använda tid och trådar men får inte påverka simens resultat).
- Max 2 justeringspass i detta steg. Avvikelser från målen dokumenteras (orsak, vad som är kvar) hellre än jagas.
- Clean-room: ingen kod, inga namn, kartor eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Nya spelmekaniker, allianser, nya enhetstyper, UI-ändringar (M20a/b), ljud, prestandaarbete (M24a), World-balans utöver 20 kontrollmatcher, AI-omskrivningar utöver parametrar.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: verktyget och baslinjemätningen (committa rapporten som "före"), pass 1 och mätning, eventuellt pass 2. Alla långa körningar med run_in_background och loggfil.

ACCEPTANS
- ms/tick för 12-säten Skirmish-crop är uppmätt och rapporterat. 200-matchkörningen (`npm run verify:balance`) slutförs på <= 15 min på 4 kärnor, eller så redovisas uppmätt tid med faktor, antal kärnor och ärlig skalning. Körningen är reproducerbar för samma seeds och skriver docs/BALANCE.md med före/efter-tabeller.
- Målen ovan är uppfyllda, eller varje avvikelse är dokumenterad med uppmätta siffror och skäl.
- Regressionstestet (12 matcher x 2400 ticks, 4 workers) passerar i `npm run verify` inom verify-budgeten på 8 min; golden hashes regenererade med orsak noterad; determinism- och snapshot-tester opåverkade.
- Tabell över varje ändrat tal: gammalt värde, nytt värde, uppmätt effekt.

SLUT
Enligt CLAUDE.md: uppdatera docs/PROGRESS.md, DECISIONS.md, BALANCE.md (genererad rapport + din sammanfattning på svenska överst) och ARCHITECTURE.md (verktyget, verify:balance). Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara sedan på svenska: vad som gjordes, vilka mål som nåddes och inte, de viktigaste ändringarna i siffror, och hur jag läser rapporten.
```

**Efteråt gör du:**
- Merga PR:en (se Så använder du listan). Ett bra läge för en hälsokoll i en ny session (mallen "Hälsokoll") innan du fortsätter med M20a.
- Be Claude (eller öppna själv) visa sammanfattningen överst i docs/BALANCE.md. Spela sedan en Skirmish mot Hard och känn efter om tempot stämmer: luftlandsättningar runt minut 8–12 och nukes senare.

# Del 4 — Gränssnitt, finish och release (M20a–M25b)

Ett riktigt gränssnitt, visuell finish, ljud, svenska och tutorial, prestanda och spara/ladda, och till sist v1.0. Gates: M20b (spela en hel match), M21, M22, M24a, M24b och M25b.

## M20a — HUD, hotkeys och kommandon

| | |
|---|---|
| **Kräver** | M15b och M18 mergade |
| **Beräknad insats** | ~2,6 h agentarbete (1,5–4,5 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Ett riktigt HUD: topprad med guld, trupper, land %, timer och vinstmätare, topplista, nationsetiketter, frontpilar, ett `?`-hjälpöverlägg med alla genvägar och högerklick som fungerar likadant överallt. |

**Klistra in i en ny session:**

```text
Du bygger milestone M20a (HUD, hotkeys och kommandon) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md (inklusive genvägslistan från M15b), docs/ARCHITECTURE.md och, via indexet: befintlig HUD, etiketter, leaderboard och src/ui/toast.ts (M05, M10, M13b, M18), all inmatning och alla tangentbordsgenvägar (src/app/input.ts och src/ui), `pickGround` och kameran (M08), win-progress-läsfunktionen (M18), ownership-texturen, i18n (src/ui/i18n.ts), `window.__test`, Playwright-mönstret i e2e/.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M15b och M18 är mergade i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Skriv `git rev-parse origin/main` som merge-SHA för föregående prompt (nämn dess id) i milestone-tabellen i docs/PROGRESS.md.

MÅL
Gör 3D-vyn läsbar och spelet bekvämt med mus och tangentbord: berg får aldrig dölja det som spelar roll, och varje genväg och högerklick går genom ETT ställe. Vanilla TS + DOM, inga nya npm-paket.

GÖR
1. HUD: topprad (guld med +inkomst/s, trupper med tak-stapel och varning vid 80 %, land %, timer, win-progress-stapel via M18:s läsfunktion), leaderboard topp 5 + du, attackslider, hastighetskontroller, kontextpanel för strukturer (upgrade, delete, målläge för missil). Allt via t() med data-testid på varje element. HUD skriver till DOM bara när ett värde ändrats (max 10 Hz; strypningen läser fx-klockan, src/render/clock.ts, M02).
2. Poolade nationsetiketter (namn + trupper, max 32, tona och rensa efter zoom, ingen överlapp, inget utanför skärmen) och frontpilar för aktiva attacker (max 16). Utöka host-snapshotet (src/host) med aktiva attacker (id, ownerId, målägare, fronthörn) som typed-array-kopior och dokumentera i ARCHITECTURE.md; src/sim ändras inte.
3. Centralt genvägsregister `src/app/hotkeys.ts` (`registerHotkey({id, keys, labelKey, scope, run})`) där ALLA befintliga genvägar flyttas in (kameran, E exponeringsvy, H chase, hastighet, bygglägen m.fl.). Hjälpöverlägget `?` genereras ur registret.
4. Kommando-resolver `src/app/commandResolver.ts`: markering + mål => kommando (attack på mark, LaunchHeli från vald Factory, målläge för vald Silo, bygg på egen mark). Högerklick går via resolvern (M08:s inputstack), som bara körs när mode-stacken är tom. Behåll M10:s placeringsläge (högerklick/Esc poppar), M13b:s deploy-läge och M15b:s målläge oförändrade.

REGLER, TAL OCH GRÄNSSNITT
- UI skickar bara intents och läser sim via SimHost/SimView; inga regler dupliceras; src/sim ändras inte.
- Hårda tak: 32 etiketter, DOM-poolning (återanvänd element), ingen layout-thrash per frame. Varje ny sträng i BÅDA i18n-tabellerna (sv och en).
- Clean-room: ingen kod, inga namn eller assets från OpenFront.io eller något annat spel.

UTANFÖR OMFATTNING
Minimap, alerts (ersätter M15b:s hotpil), Tactical-vy, touch/radialmeny, layouttest vid 390x844 och spelgaten (alla M20b). Ljud (M22), inställningspanel och tutorial (M23), visuell finish (M21).

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: genvägsregister och hjälp, sedan resolvern, sedan HUD, sist etiketter och pilar. Screenshot per del.

ACCEPTANS
- Playwright: varje HUD-element har data-testid; efter 100 ticks är värdet lika med sim-värdet OCH ändrat sedan tick 0; leaderboardens ordning == simens landräkning i en fixtur där ordningen inte är trivial.
- Ingen DOM-skrivning i vila: en MutationObserver räknar 0 mutationer på HUD under 1 s utan ticks.
- Etiketter: i ett scenario med 40 kandidater är 8 <= synliga etiketter <= 32, inga bounding boxar överlappar, inga ligger utanför viewporten.
- Hjälp mot register: varje registerpost finns i `?`-överlägget och tvärtom; ett grep-test visar 0 `keydown`-lyssnare utanför input.ts och hotkeys.ts (testet måste gå rött om du lägger in en).
- Resolver: tabelltest (markering x mål => förväntat intent) täcker alla fyra kommandotyper plus ogiltigt mål (ger toast, inget intent); e2e: högerklick på mark med Factory vald skickar LaunchHeli-intent, och högerklick i placeringsläge avbryter läget utan något intent.
- Layout-bounding-box-test vid 1280x720 och 1920x1080: inga HUD-element överlappar, inget utanför viewporten, ingen horisontell scroll, och centrala 40 % x 40 % av skärmen är fria från HUD. Noll console errors.
- `npm run verify` grönt; test-tier-budgeten för spelscenen (<= 150k trianglar och <= 100 draw calls, summan av raderna i budgettabellen i docs/ARCHITECTURE.md) fortfarande uppfylld; dokumentera HUD:ens tillägg där.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: genvägsregistret, resolvern och HUD-modulerna. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, vad som avvek, och en kort "Så spelar du"-lista (HUD, `?`, högerklick).
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main") och gå vidare till M20b.
- Titta gärna i förhandsvisningen: tryck `?` för hjälp och högerklicka på mark. Är något i vägen eller oläsligt, beskriv det med mallen "Feedback efter en gate" (under Mallar i den här listan) i en ny session.

---

## M20b — Minimap, larm, taktisk vy och touch

| | |
|---|---|
| **Kräver** | M20a mergad |
| **Beräknad insats** | ~2,1 h agentarbete (1,3–3,7 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — spela en hel Skirmish-match (ca 12 min) mot Medium och en mot Hard på din riktiga dator och rapportera med mallen "Feedback efter en gate": roligt eller tråkigt, för lätt eller för svårt, och vad som saknades |
| **Du ser efteråt** | Minimap, varningar med kantindikatorer, en platt taktisk vy där berg aldrig döljer det viktiga och grundläggande touch. Enspelarspelet är funktionellt komplett. |

**Klistra in i en ny session:**

```text
Du bygger milestone M20b (Minimap, larm, taktisk vy och touch) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: HUD-modulerna, genvägsregistret (src/app/hotkeys.ts) och kommando-resolvern (src/app/commandResolver.ts) från M20a; M15b:s hotpil och dess e2e-scenario med inkommande missil; src/ui/toast.ts; terrängshadern (relief-uniform) och ownership-texturen; `flyTo` (M08); touch/pan/zoom-koden i kameran (M08).

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M20a är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M20a i milestonetabellen i docs/PROGRESS.md.

MÅL
Slutför användargränssnittet så att enspelarspelet är komplett och spelbart i en hel match. Inga nya npm-paket.

GÖR
1. Minimap: 2D-canvas (equirektangulär): ägarfärger från ownership-snapshoten, kamerans frustum (hanterar x-wrap), helikopter- och missilmarkörer, klick = `flyTo` dit. Uppdatera på händelse eller max 4 Hz (strypningen läser fx-klockan, src/render/clock.ts, M02).
2. Alerts i `src/ui/alerts.ts` med kantindikatorer: inkommande nuke (riktning + nedräkning), helikopter på väg in/förlorad, struktur under attack. Kön max 5, dedupe på (typ, subjekt). Ersätt M15b:s enkla hotpil med alert-systemet (flytta dess tester, motivera i DECISIONS.md). Exportera ren `threatLevel(view)` ur samma källor (M22 återanvänder den).
3. Vyväxel Cinematic/Tactical (knapp + hotkey i registret): Tactical = platta färger, tjocka gränser, reducerat relief via en uniform i terrängshadern (ingen ny shader-fork); gränser måste synas.
4. Touch: tryck = markera, långtryck (500 ms) = radialmeny med SAMMA kommandon som resolvern ger för högerklick, tvåfingers pan/zoom/rotera (återanvänd M08-koden). Touch-layout med mål >= 44 x 44 px.

REGLER, TAL OCH GRÄNSSNITT
- UI skickar bara intents; src/sim ändras inte. Varje ny sträng i BÅDA i18n-tabellerna. Hårda tak: kö 5, minimap-markörer 64.
- Clean-room: ingen kod, inga namn eller assets från andra spel.

UTANFÖR OMFATTNING
HUD, etiketter, pilar, genvägsregister, hjälpöverlägg och resolver (gjorda i M20a). Full mobilpolish (touch är bäst-möjligt), ljud (M22), tutorial och inställningspanel (M23), visuell finish (M21).

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: minimap, alerts, Tactical, touch. Screenshot per del. Spelgaten kräver mig, inte dig: bygg bara klart.

ACCEPTANS
- Minimap: pixlarna == ägare vid 10 samplade celler; efter att en cell bytt ägare i simen ändras dess minimap-pixel; klick flyttar kameran till <= 1 grad från klickpunkten (fx-klockan, src/render/clock.ts (M02), inte väggtid); frustum syns över datumgränsen.
- Alerts: i M15b:s skriptade scenario med inkommande missil visas en alert med rätt riktning och nedräkning (== simulerad ETA +/- 1 s simtid); 20 identiska händelser ger 1 alert; 8 olika ger 5 (kön kapas); heli-förlorad och struktur-under-attack utlöses i varsitt scenario.
- Tactical: skärmbilden skiljer sig från Cinematic (>= 2 % av pixlarna), två Tactical-renderingar är identiska, en känd gräns-cell skiljer sig i färg från båda sina grannar.
- Touch (Playwright hasTouch, isMobile): tryck markerar; långtryck öppnar radialmenyn, dess kommandon == resolverns; layout vid 390x844: inga överlapp, ingen horisontell scroll, alla interaktiva element (minst 10 räknade) >= 44 x 44 px; noll console errors.
- `npm run verify` grönt; test-tier-budgeten för spelscenen (<= 150k trianglar och <= 100 draw calls, summan av raderna i budgettabellen i docs/ARCHITECTURE.md) fortfarande uppfylld; dokumentera tillägget där.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: minimap, alerts/threatLevel, vyväxel, touch. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, vad som avvek, och en GATE-lista: spela Skirmish i ca 12 min mot Medium och en gång mot Hard; prova minimap-klick, Tactical, `?`, en inkommande missil, touch om du har pekskärm; rapportera roligt/tråkigt, för lätt/svårt och vad som saknades.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main") och öppna förhandsvisningen enligt docs/PREVIEW.md på din riktiga dator.
- Spela en hel Skirmish-match (ca 12 min) mot Medium och en mot Hard. Skicka sedan en rapport i en NY session med mallen "Feedback efter en gate" (under Mallar i den här listan): roligt eller tråkigt, för lätt eller för svårt, vad som saknades, läsbarhet av HUD och minimap.
- Naturlig paus: här är enspelarspelet komplett. Merga eventuell fix-PR innan M21. (Hoppar du över M20b, spela ändå en match mot Medium och en mot Hard och rapportera med samma mall; touch och minimap saknas då.)

---

## M21 — Visuell finish och liv i världen

| | |
|---|---|
| **Kräver** | M15b och M20b mergade |
| **Beräknad insats** | ~5,5 h agentarbete (3,5–8,7 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — öppna förhandsvisningen på din riktiga dator med `?perf=1` (Artifact: `#perf`, eller F2), spela några minuter, titta på nattsidan, kusterna, krusningarna och fartygen (om Claude hann bygga dem) och rapportera stil, FPS och renderersträng med mallen "Feedback efter en gate" |
| **Du ser efteråt** | Städer lyser på nattsidan, kusterna har skum, varje erövring sprider en krusning, spelet börjar med en filmisk fly-in och (om tiden räckte) seglar handelsfartyg mellan hamnar. |

**Klistra in i en ny session:**

```text
Du bygger milestone M21 (Visuell finish och liv i världen) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md, docs/BACKLOG.md och, via indexet: src/render/ (shader-moduler, terrain chunks, props, units, fx inklusive fx.config.ts och fx-klockan (src/render/clock.ts, M02), camera, quality), HUD/alerts/resultat-skärmen, pausmenyn, `src/app/prefs.ts` (M06) samt hur render-only outbox och `?test=1`-hooks (`__test.render/advance/state`) används i e2e.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M15b och M20b är mergade i main (eller att M20b redan står under Skipped i PROGRESS.md, eller att någon av mina inledande rader, de som står före texten 'Du bygger milestone', är `Hoppat över: M20b`; då skriver du en rad om det under Skipped i docs/PROGRESS.md, hoppar över delar som kräver minimap/larmsystemet och noterar det i docs/DECISIONS.md); annars stanna och säg det. Om någon av mina inledande rader (före 'Du bygger milestone') är `Endast tier 1–2`, stanna efter tier 2 och logga tier 3 i docs/BACKLOG.md. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M20b (om den är mergad) i milestonetabellen i docs/PROGRESS.md.

MÅL
Lyft utseendet från korrekt till njutbart utan att bryta tier-budgetarna. Allt tungt hör hemma i high-tier och ska gå att stänga av. Simen får inte röras.

GÖR (i tre tiers; gör tier för tier och kör `npm run verify` mellan dem)
Tier 1 (måste): (a) finputsa M10:s stadsljus (återanvänd dess instansdata; bygg inte ett nytt lager) och dag/natt-terminatorn; (b) havsskum längs kusten från bathymetrin; (c) krusning och puls vid erövring, flytande +guld-text, markering av cellen under muspekaren; (d) filmisk intro-fly-in (avbryts av klick/tangent; av i `?test=1` om inte `?intro=1`, registrera i Dev-panelen); (e) inställningen "Reducerad rörelse" (se nedan); (f) docs/ART.md (palett, formspråk, effektbudgetar per tier, hur man lägger till en effekt).
Tier 2: byggnads-scaffold som växer in och uppgraderingsblink; rotor-damm och landningspuffar; seger/förlust-kamera; slow-motion vid nukedetonation och helikopterkrasch (bara fx-klocka och kamera, aldrig simens tick-takt).
Tier 3 (STOPPREGEL: börja bara om verify är grönt efter tier 2 och du har arbetat mindre än ca 4 timmar; sluta annars och logga ogjorda punkter i docs/BACKLOG.md OCH en rad per punkt under Skipped i docs/PROGRESS.md): handelsfartyg (InstancedMesh, tak 40, mellan hamnpar med handel >= 40 celler isär, A* på ett grovt sjörutnät 256x128 härlett ur DeepSea/Shallows med x-wrap och handskrivna Suez/Panama-kanalkanter i en liten datafil, kölvatten; rent kosmetiska); molnskal (high-tier); animerade vågnormaler; mjuka solskuggor (high-tier). three r186 saknar PCFSoftShadowMap: använd ett shader-baserat horisonttest mot höjdtexturen eller PCFShadowMap och notera valet i DECISIONS.md; trupp-sprites längs fronter (instancerade, upp till 5 000).

Reducerad rörelse: nollar kameraskak och kraftiga blixtar; förvalt värde följer `prefers-reduced-motion`; sparas via `src/app/prefs.ts` (M06; skapa ingen ny wrapper). Reglaget ligger tills vidare som en kryssruta i pausmenyn (Esc) med data-testid `toggle-reduced-motion` (saknas pausmenyn: i Dev-panelen F2). M23a flyttar det till inställningspanelen.

REGLER, TAL OCH GRÄNSSNITT
- Kosmetik använder en separat kosmetisk RNG (egen ström seedad från matchens seed; simen läser den aldrig). All kosmetisk tid via fx-klockan (src/render/clock.ts, M02); skapa ingen ny klocka.
- Budgetar: spelscenen i test-tier: <= 150k trianglar och <= 100 draw calls (summan av raderna i budgettabellen i docs/ARCHITECTURE.md; dokumentera tillägget där); high-tier <=1,5M trianglar och <=250 draw calls i perf-scenen; partiklar max 20k.
- Läs bara snapshots och outbox. Ingen ändring i src/sim; golden hashes oförändrade. Varje ny sträng i BÅDA i18n-tabellerna.
- Clean-room: inga assets från andra spel. Inga konstfiler, allt procedurellt.

UTANFÖR OMFATTNING
Ljud (M22), inställningspanelen och översättning (M23a), tutorial (M23b), Worker-sim och kvalitetsregulator (M24a), nya mekaniker, krigsfartyg och transportbåtar (ingen sjöstrid i v1), väder, nya dataset.

ARBETSSÄTT
Enligt CLAUDE.md. En effekt i taget med en screenshot per effekt. Skriv vid varje tiers slut vilka punkter som är klara i docs/PROGRESS.md.

ACCEPTANS
- Tier-budgetarna klaras (renderer.info-test), inga GL-fel; sim-hash identisk med och utan kosmetik. Läcktest (taggat leak-test i e2e-skalet): viewport 320x180, 60 render-anrop (3 omgångar x 20) med effekterna aktiva, `heapDelta` <= 5 MB (median av 3) och `renderer.info.memory` (geometries/textures) oförändrat mellan första och sista omgången. Chromium startas med args som explicit array med `--js-flags=--expose-gc` och `--enable-precise-memory-info` som SEPARATA argument (M00:s heapDelta-självtest).
- Goldens (golden-regeln i CLAUDE.md) för varje levererad effekt bland: konstruktion, landningsdamm, SAM-rökspår, explosion, nedfall, krusning, nattljus, kölvatten. För VARJE golden renderas också samma vy med effekten avstängd (fx-klockan före start eller effektflagga) och regionen måste skilja sig >= 0,3 % av pixlarna (en effekt som inte ritar något ska fallera).
- Nattvyn har upplysta pixlar vid kända stadsceller (M10:s stadsljus, finputsade); samma vy med alla städer på nivå 0 har 0 upplysta där; nivå 3 ger fler upplysta pixlar än nivå 1.
- Reducerad rörelse: kameraskak-amplitud 0 (enhetstest) och en e2e som klickar kryssrutan och kontrollerar att den består efter omladdning och att skak blir 0.
- Om fartyg byggdes: inget fartyg på en landcell i ett 5-minuters sim-prov, minst 5 fartyg synliga efter 2 min med >= 2 handelspar, och ruttest Suez använder kanalkanterna (ett testfall där en landväg injiceras måste fallera).
- `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: nya fx-moduler och gränssnitt, DECISIONS.md för varje beslut. Spara ett kontaktark med effektbilderna som docs/shots/m21-contact-sheet.png. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes per tier, vad som loggades till BACKLOG.md, och en exakt lista över vad jag ska titta på (nattsida, kust, krusning, intro, fartyg om de finns) och vilka reglage som stänger av tunga effekter.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main") och titta på kontaktarket (en bild): på GitHub öppnar du PR:en, fliken Files changed, `docs/shots/m21-contact-sheet.png`. Eller be Claude: "Visa kontaktarket för mig".
- Öppna förhandsvisningen enligt docs/PREVIEW.md på din riktiga dator med `?perf=1` (Artifact: `#perf`, eller F2), spela några minuter och zooma in på nattsidan och en kust. Prova kryssrutan "Reducerad rörelse" i pausmenyn (Esc).
- Rapportera i en NY session med mallen "Feedback efter en gate" (under Mallar i den här listan): stil, FPS, renderersträng och vad som kostar för mycket eller ser fel ut. Ogjorda tier 3-punkter ligger i docs/BACKLOG.md och kan vänta.

---

## M22 — Procedurellt ljud

| | |
|---|---|
| **Kräver** | M21 mergad |
| **Beräknad insats** | ~4,1 h agentarbete (2,7–6,3 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — lyssna med hörlurar enligt Claudes lista (Claude kan inte höra) och rapportera med mallen "Feedback efter en gate" vad som är för högt, för lågt, för skarpt eller saknas |
| **Du ser efteråt** | Du hör rotorpuls, missiluppskjutning, SAM-vissling, rungande explosioner, sirener och en ambient musik som spänns upp när det är fara. Inga ljudfiler används, allt syntetiseras. |

**Klistra in i en ny session:**

```text
Du bygger milestone M22 (Procedurellt ljud) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md, docs/ART.md och, via indexet: sim-outboxens händelseunion i src/sim (lista ALLA typer), `threatLevel` och alerts i src/ui/alerts.ts (M20b), kameramodulen i src/render/camera/, den kosmetiska RNG:n och `src/app/prefs.ts` (M06), pausmenyn och e2e-hjälparna.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M21 är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M21 i milestonetabellen i docs/PROGRESS.md. Saknas src/ui/alerts.ts eller står M20b under Skipped i docs/PROGRESS.md (eller är någon av mina inledande rader, de som står före texten 'Du bygger milestone', `Hoppat över: M20b`): skriv en minimal `threatLevel(view)` i src/audio/threat.ts (samma signatur) och notera det i docs/DECISIONS.md.

MÅL
Ett komplett ljudlager utan en enda ljudfil. Du kan inte lyssna, så bygg allt som testbar funktion och lägg alla smakkonstanter i en fil jag kan justera efteråt. Inga nya npm-paket.

GÖR
1. `src/audio/`: WebAudio-motor med master-, sfx- och musikbussar, max 32 samtidiga röster (full: stjäl lägsta prioritet/äldsta), avståndsdämpning och panorering från kamera till händelsens världsposition, upplåsning (`resume()`) vid första klick/tangent. Varje nod skapas via motorns `track(node)`-hjälpare som räknar noder tills de stoppats/kopplats från (egen bokförning mot `ctx.currentTime`, inte bara `onended`); `audio.stats()` ger `{activeNodes, voices}` och exponeras i `__test`. Volym och mute: enkla reglage i pausmenyn (M23a bygger inställningspanelen), sparas via `src/app/prefs.ts` (M06; ingen ny wrapper). Motorn är en no-op utan fel om AudioContext eller storage saknas.
2. Effekter som rena funktioner `(ctx: BaseAudioContext, dest, params) => handle` (kan renderas offline): UI-tick, byggduns, rotorloop (filtrerat brus + LFO, tonhöjd efter fart/avstånd), missiluppskjutning, SAM-vissling, avvärjningsplopp, explosion (brusburst + lågpassvep + sub), nuke-siren, fångst-chirp, seger/förlust-stingers, ambient vind/hav efter kamerahöjd.
3. Generativ ambient musik (pad, seedad kosmetisk RNG) med ett spänningslager styrt av `threatLevel` från M20b (eller reservfunktionen i src/audio/threat.ts).
4. `mapping.ts`: en `Record` över hela outbox-unionen så att kompilatorn kräver en post per typ; tysta typer markeras uttryckligen med skäl.
5. `src/audio/audio.config.ts`: alla volymer, frekvenser, tider och prioriteter, kommenterade, så att "gör explosionen mörkare" blir en konstant.

REGLER, TAL OCH GRÄNSSNITT
- Ljud läser bara outbox/snapshots; ingen ändring i src/sim, sim-hash oförändrad; sim/ai/data importerar aldrig audio (lint).
- Brus från seedad kosmetisk RNG, aldrig Math.random. Max en rotorloop per helikopter inom hörbart avstånd och tak på samtidiga rotorer.
- Clean-room: inga ljud eller samples från andra spel. Inga ljudfiler.

UTANFÖR OMFATTNING
Röst/tal, samples, licensierad musik, inställningspanelens UI och översättningar (M23a), Worker-sim (M24a), nya mekaniker.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: motor och bussar, sedan effekterna en i taget med ett offline-test var, sist musik och mappning. Containern saknar ljudenhet.

ACCEPTANS
- OfflineAudioContext (Chromium via Playwright) för varje effekt: RMS över en tröskel du väljer och dokumenterar, peak <= 1,0, längd inom gränser, hash av kvantiserade samplingar lika vid två renderingar. Spektral tyngdpunkt: explosion < rotor < UI-tick. Självtest: en tyst buffer och en buffer med peak 1,5 underkänns av kontrollerna.
- Mapping: varje outbox-typ har en post (test). Stresstest med 300 händelser ger `audio.stats().voices` <= 32 hela tiden och > 0 någon gång. Efter 60 s snabbspolning (`__test.advance`, mock-klockan avancerad) är `activeNodes` tillbaka på baslinjen.
- e2e med mock-AudioContext injicerad via `addInitScript` som registrerar `resume()` och startade källnoder: första klicket => `resume()` exakt en gång; en nuke-händelse => minst en startad källa; med mute på => 0. Verklig `ctx.state` loggas utan assert. Mute/volym består efter omladdning; spelet fungerar utan AudioContext och utan storage; noll console errors (M00:s vitlista får innehålla exakt de kända ALSA/Pulse-varningarna om de förekommer, noterat i DECISIONS.md).
- `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: motor, `track`/`stats`, mapping och config. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, vad som avvek, och en exakt lyssningschecklista (vad jag gör i spelet för att höra varje ljud och hur jag beskriver problem så att du kan justera audio.config.ts).
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- Öppna förhandsvisningen enligt docs/PREVIEW.md, klicka en gång på sidan (webbläsare tillåter ljud först efter ett klick) och gå igenom Claudes lyssningschecklista med hörlurar.
- Rapportera i en NY session med mallen "Feedback efter en gate" (under Mallar i den här listan), till exempel "explosionen är för skarp" eller "rotorn hörs inte".

## M23a — Svenska, inställningar, krediter och hjälp

| | |
|---|---|
| **Kräver** | M20b och M22 mergade |
| **Beräknad insats** | ~2,3 h agentarbete (1,6–3,7 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Spelet går att byta mellan svenska och engelska direkt i menyn, det finns en inställningssida (kvalitet, volym, språk, kamerakänslighet, färgblindsäker palett, UI-skala, reducerad rörelse), en kreditskärm och en hjälpsida med förklarande diagram. |

**Klistra in i en ny session:**

```text
Du bygger milestone M23a (Svenska, inställningar, krediter och hjälp) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: src/ui/i18n.ts (tabellerna sv och en), meny och setup-skärm (M06), HUD och `?`-överlägget (M20a), kvalitetsmodulen och inställningen 'Reducerad rörelse' (M21), volymkontrollerna (M22), src/app/prefs.ts (M06), kameran (M08), ägarpaletten (palette LUT) i src/render/, devpanelen, CREDITS.md och docs/ASSETS.md.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M20b och M22 är mergade i main (M20b får saknas om någon av mina inledande rader, de som står före texten 'Du bygger milestone', är `Hoppat över: M20b`, eller om M20b står under Skipped i docs/PROGRESS.md); annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M22 i milestonetabellen i docs/PROGRESS.md.

MÅL
Spelet ska fungera fullt ut på svenska och engelska, ha en riktig inställningssida, en kreditskärm som hedrar alla licenser och en hjälpsida som förklarar terrängens betydelse. Tutorialen är M23b och ingår inte här.

GÖR
1. i18n är redan byggt sedan M05 (tabellerna sv och en, nya strängar i båda): detta är en kontroll, inte en omskrivning. Skriv paritetstest: identiska nyckelmängder, inga tomma värden, samma `{param}`-platshållare i båda språken per nyckel. Skriv ett skript/test som letar hårdkodade UI-strängar (textContent, innerHTML, title, aria-label, placeholder) i src/ui och src/app utanför t(); åtgärda träffarna, rena undantag får stå i en allow-list med motivering. Verifiera att landsnamn visas på valt UI-språk och att sökrutan hittar både "Sverige" och "Sweden" (M01/M06 har name_sv och name_en; fixa bara det som saknas).
2. Språkbyte i inställningarna utan omladdning (standard sv; valet sparas; `document.documentElement.lang` uppdateras).
3. Inställningspanel (öppnas från meny och pausmeny): kvalitetsnivå Låg/Medel/Hög (test-tier visas inte; M24a lägger till Auto), volym (M22:s API), språk, kamerakänslighet (multiplikator i M08:s kamera), färgblindsäker palett, UI-skala 0,8–1,5 via CSS-variabel, och 'Reducerad rörelse' (på/av, standard från prefers-reduced-motion; M21:s inställning). Allt sparas via `src/app/prefs.ts` (M06; `getPref`/`setPref`, redan med try/catch och minnesfallback): bygg ingen andra wrapper. Ogiltiga lagrade värden klampas eller ignoreras.
4. Färgblindsäker palett: byt palette LUT till en etablerad uppsättning (Okabe–Ito eller Paul Tol, utökad med ljushetsvarianter för fler ägare). Dokumentera metrik och trösklar i DECISIONS.md.
5. Kreditskärm som visar CREDITS.md (importera som rå text vid bygget): Natural Earth, Mapzen/USGS SRTM, NOAA ETOPO1, CC-BY-källorna i docs/ASSETS.md och three.js, plus text om omstridda gränser, fiktiv konflikt och att spelet är originalarbete. Nämn aldrig OpenFront eller andra spel vid namn i src/ (i18n, kredittext); sådana uttalanden hör hemma i README.md/docs/. Om docs/ASSETS.md saknar maskinläsbara rader `Attribution: <sträng>` (en per rad), lägg till dem.
6. Hjälpsida (från meny och pausmeny; `?`-överlägget från M20a oförändrat) som förklarar bergskostnad, helikopterns takhöjd (tjänstetak, Låg/Hög) och LOS/radarskugga med tre canvas-diagram ritade i kod. Diagrammen läser sina tal ur rules.ts, aldrig hårdkodat.

REGLER, TAL OCH GRÄNSSNITT
- UI läser snapshots/SimView och skickar intents; ingen ändring av sim-regler, golden hashes oförändrade.
- data-testid på alla nya interaktiva element; touch-mål >= 44 px i touch-layouten; varje ny sträng i både sv och en.
- Clean-room: ingen text, struktur eller namn från OpenFront.io eller andra spel.

UTANFÖR OMFATTNING
Tutorial (M23b), Auto-kvalitet och Worker (M24a), spara/ladda (M24b), fler språk än sv/en, release (M25a/b).

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: paritetstest och sökskript, inställningar och palett, krediter, hjälpsida. Screenshot per del.

ACCEPTANS
- Paritet: testet i punkt 1 är grönt och går rött om du tar bort en nyckel, tömmer ett värde eller ändrar en platshållare i ett språk (kontrollfall i testet).
- E2E: språkbyte ändrar HUD-, meny- och landsnamnstexter utan omladdning; sökning efter "Sverige" och "Sweden" ger samma land.
- Färgblindspalett: parvis färgseparation (ΔE enligt vald metrik) under simulerad protanopi, deuteranopi och tritanopi över dokumenterade trösklar för de första 8 ägarna (lägre dokumenterad tröskel för övriga); en medvetet dålig palett (två nära röda) måste få testet att falla.
- Reducerad rörelse: växlingen nollar kameraskakningens amplitud (enhetstest) och slås av/på i panelen; UI-skala 0,8–1,5 testas inklusive att 9 klampas till 1,5 och skräp ger 1,0; kamerakänslighet ändrar kameraförflyttningen proportionellt.
- Krediter: varje `Attribution:`-sträng i docs/ASSETS.md finns på kreditsidan; testet kräver minst en sådan rad och har ett kontrollfall där en saknad sträng upptäcks; Natural Earth, SRTM/Mapzen, ETOPO1 och three.js är obligatoriska i testet.
- Hjälpsidan: varje canvas ritar icke-tomt innehåll (minst N distinkta färger) och diagramfunktionerna får sina tal från rules.ts (enhetstest med mock-ctx).
- Med blockerad localStorage (addInitScript) fungerar inställningar och språkbyte; noll console errors i ett UX-skript genom meny, inställningar, språkbyte, krediter och hjälp.
- `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: settings-modulen, paletten och hjälpdiagrammen. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, vad som avvek, och en kort "Så spelar du"-lista (var inställningar, krediter och hjälp finns).
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main") och gå vidare till M23b.
- Titta gärna i förhandsvisningen: byt språk, prova färgblindpaletten och öppna hjälpsidan. Är något fel eller oläsligt, beskriv det med mallen "Feedback efter en gate" (under Mallar i den här listan) i en ny session.

---

## M23b — Tutorial

| | |
|---|---|
| **Kräver** | M23a mergad |
| **Beräknad insats** | ~1,6 h agentarbete (1,0–2,5 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | En guidad tutorial i sex steg som lär dig spelet och slutar med din första helikopterlandsättning över en bergsrygg; den kan hoppas över och startas om. |

**Klistra in i en ny session:**

```text
Du bygger milestone M23b (Tutorial) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: scenariotabellen src/sim/scenarios.ts (M13a, M15b: `?scenario=slice` / `#scenario-slice` med färdig fabrik och helikoptrar), intent-typerna och SimView (spawn, attack, bygg, LaunchHeli, SAM, DebugGive/debugIntents), devpanelen, HUD:ns data-testid (M20a), src/app/prefs.ts (M06), fx-klockan (src/render/clock.ts, M02), toast.ts och Playwright-mönstret i e2e/.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M23a är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M23a i milestonetabellen i docs/PROGRESS.md.

MÅL
En ny spelare ska förstå spelet på några minuter genom en skriptad mikromatch med fast seed som slutar med en helikopterlandsättning över en bergsrygg.

GÖR
1. Ren tillståndsmaskin `src/tutorial/machine.ts` med 6 steg: (1) välj startplats, (2) expandera, (3) bygg en stad, (4) försvara dig mot ett skriptat anfall, (5) placera en SAM, (6) helikopterlandsättning över bergsryggen (välj fabrik, välj landningszon på andra sidan, starta). Varje steg har ett slutvillkor över SimView eller en UI-händelse, en highlight-ring förankrad via data-testid, en ledtråd efter 20 s utan framsteg (fx-klockan, src/render/clock.ts, M02; skapa ingen ny klocka) och en alltid synlig "Hoppa över steg"-knapp. Försvarssteget använder den enklaste verifierbara försvarsmekanik som ARCHITECTURE.md/rules.ts erbjuder; angriparen följer ett fast skript i scenariot, inte AI.
2. Mikromatchen startas via samma mekanism som `?scenario=slice` (hash `#scenario-slice`): ett nytt scenario är en rad i src/sim/scenarios.ts (scenarioId 3 = tutorial; `git diff src/sim` får bara visa den filen). Registrera `?scenario=tutorial` (hash `#scenario-tutorial`, tolkas av src/app/params.ts) i devpanelen, plus en "Tutorial"-knapp i menyn och ett erbjudande vid första start) och går genom samma host/sim-kodväg som riktiga matcher. Seed, karta och bergsrygg är fasta.
3. Skyddsnät: får spelaren för lite guld för stegets åtgärd, eller saknas fabriken vid steg 6, ger tutorialen exakt det som behövs (plus liten marginal) via det befintliga loggade intentet `DebugGive`, som tutorial-scenariot gör tillåtet genom `debugIntents` (ingen ny tutorial-specifik acceptansregel i simen; beskriv i DECISIONS.md), aldrig genom att skriva state direkt, och visar en toast.
4. Hoppa över hela tutorialen och starta om (ny match, samma seed). Framsteg (senast klarade steg, klar-flagga) sparas via `src/app/prefs.ts` (M06) och styr bara erbjudandet vid första start och "Klar"-märket i menyn; själva mikromatchen börjar alltid om från steg 1.
5. Matcher från tutorial-scenariot får aldrig skriva över ett senare autospar (flagga `noAutosave`, används av M24b).
6. `window.__test.tutorial()` (bara med ?test=1) returnerar steg, ledtråd synlig och klar-flagga.

REGLER, TAL OCH GRÄNSSNITT
- Tutorial läser snapshots och skickar intents; ingen ändring av vanliga sim-regler, golden hashes för vanliga matcher oförändrade.
- Alla nya element har data-testid; alla strängar i både sv och en; touch-mål >= 44 px.
- Clean-room: ingen text, tutorialstruktur eller namn från OpenFront.io eller andra spel.

UTANFÖR OMFATTNING
Inställningar, krediter, hjälp (M23a), Worker och sparande (M24a/b), röstguide, nya mekaniker, fler språk.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: maskin + enhetstester, scenario, UI-ringar och ledtrådar, skyddsnät, e2e. Screenshot per steg.

ACCEPTANS
- E2E klarar alla 6 steg med skriptade inputs inom 120 s SPELTID (räkna ticks/fx-klockan, ingen väggklocka) och slutar med en landad helikopter med beachhead-celler ägda av spelaren; två körningar ger identisk hash och samma hash som en ren Node-replay av intent-loggen.
- Varje stegs highlight-mål finns i DOM (eller projiceras på skärmen) när steget är aktivt.
- Enhetstest per steg (6 st): en FEL åtgärd slutför INTE steget, en rätt åtgärd efteråt gör det (ingen softlock). Steg 6: en helikopter som skjuts ner eller aldrig landar slutför inte steget.
- Ledtråd: ingen vid 19,9 s, synlig vid 20,0 s, återställs av framsteg (stegad med fx-klockan via `__test.advance`). Skyddsnät: med 0 guld ger steget 3, 5 och 6 var och en rätt belopp en gång och går att slutföra. Hoppa-över-test: sex hopp i rad når slutläget utan fel och med giltigt state.
- Noll console errors i ett UX-skript genom menyn, tutorialen och omstart; fungerar med blockerad localStorage.
- `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: tillståndsmaskinen, scenariot och `__test.tutorial`. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, vad som avvek, och en kort "Så spelar du"-lista (starta tutorialen, hoppa över, starta om).
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main") och gå vidare till M24a.
- Kör tutorialen i förhandsvisningen från början till slut på svenska. Är något steg förvirrande eller fastnar du, beskriv det med mallen "Feedback efter en gate" (under Mallar i den här listan) i en ny session.

---

## M24a — Prestanda: Worker-sim, kvalitetsnivåer och perf-rapport

| | |
|---|---|
| **Kräver** | M21, M22 och M23a mergade |
| **Beräknad insats** | ~3,9 h agentarbete (2,2–6,4 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — öppna förhandsvisningen på din riktiga dator med `?perf=1` (Artifact: `#perf`, eller via F2-panelen), spela några minuter på Auto-kvalitet och tryck "Kopiera rapport"; skicka JSON-rapporten (med renderersträngen) med mallen "Feedback efter en gate" under Mallar. |
| **Du ser efteråt** | Jämnare spel, automatiskt vald kvalitetsnivå (Auto/Låg/Medel/Hög) och en kopierbar prestandarapport. |

**Klistra in i en ny session:**

```text
Du bygger milestone M24a (Prestanda: Worker-sim, kvalitetsnivåer och perf-rapport) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: src/host/ (SimHost inkl. `query`, MainThreadHost, aiDriver), render-adaptern och kvalitetstiers (src/render/quality), `src/ui/report.ts` (`showReport`) med ?perf=1-överlägget (`#perf`, M02) och perf-scenens JSON-schema (M08), settings-modulen (M23a), Node worker_threads-paritetstestet (M03), tests/perfguard.ts och scripts/shot.mjs (`heapDelta`).

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M21, M22 och M23a är mergade i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Skriv `git rev-parse origin/main` som merge-SHA för föregående prompt (nämn dess id) i milestone-tabellen i docs/PROGRESS.md.

MÅL
Spelet ska gå bra på riktig hårdvara. Sparformat, IndexedDB och webbläsarmatrisen är M24b.

GÖR
1. WorkerHost (src/host/): simen och aiDriver körs i en Web Worker (`new Worker(new URL(...), { type: 'module' })`) med överförbara buffertar, INGEN SharedArrayBuffer. Kommandon in, snapshots/diffs ut; buffertar returneras till workern och återanvänds (pool). `query(kind, args)` vidarebefordras som id-taggade request/response-meddelanden (svar matchas på id, fel och timeout avvisar löftet). Catch-up-tak 8 ticks/frame. Bakgrundsflik: pausa singleplayer-simen medan dokumentet är dolt och återuppta utan ikapp-burst (DECISIONS.md). Workern hämtar sin data med `siteUrl()` från src/app/paths.ts (ROOT_URL fungerar även i en Worker; aldrig `./data/`, `BASE_URL + ...` eller inledande `/`). Standard är Worker; `?host=main`/`?host=worker` (hash `#host-main`/`#host-worker`) finns som devpanel-lägen och överstyr även i `?test=1` (MainThreadHost är bara standard i testläget); `__test.advance/state` fungerar på båda hostarna, asynkront via `host.query("state")` (inför query-kinden `state`, som returnerar snapshot-hash och tick). Kastar Worker-konstruktionen eller uteblir handskakningen i 2 s: fall automatiskt tillbaka till MainThreadHost och visa `hostKind` i perf-rapporten och felskärmen.
2. Renderoptimering: frustum culling per sektor för instancerade objekt, markör-LOD på långt håll, ett mipmappat FÄRGlager för ägarskap (palettens färger till en render target med mipmaps; mipmappa ALDRIG ägar-id-texturen), texturminnesrapport och dispose-vägar: `renderer.dispose()` är synkron i WebGLRenderer r186 och släpper inte GL-kontexten, så anropa även `renderer.forceContextLoss()` och ta bort canvas vid nedmontering.
3. Automatisk kvalitetsregulator: ren klass med injicerbar frame-tid-källa; rullande fönster, steg ner vid ihållande långsamma frames, upp vid ihållande snabba, minsta vilotid och hysteres. Styr tier, DPR-tak, chunk-täthet, instanstak och bloom. Trösklar i en config-fil, motiverade i DECISIONS.md. Lägg Auto i M23a:s kvalitetsval (Auto/Låg/Medel/Hög).
4. Perf-rapport: bygg vidare på det befintliga `showReport` och M08:s schema (INGEN andra kopieringsknapp; knappen heter "Kopiera rapport") med fält för renderersträng, tier, hostKind, FPS medel/p95, tick-ms p50/p95, trianglar, draw calls, texturminne och heap; validera mot schemat.

REGLER, TAL OCH GRÄNSSNITT
- Ingen ändring av sim-regler; golden hashes oförändrade. sim/ai/data importerar aldrig worker- eller renderkod.
- Budgetar (räknare): high-tier <= 1,5M trianglar, <= 250 draw calls, texturminne <= 110 MB; spel-JS <= 1,2 MB gz, data <= 6 MB gz. Test-tierns tak från tidigare milestones gäller oförändrade.
- CPU-budgetar via `budgetMs` i tests/perfguard.ts, heap via `heapDelta`; aldrig SwiftShader-väggtid.
- Clean-room: ingen kod, inga namn eller assets från OpenFront.io eller andra spel.

UTANFÖR OMFATTNING
Sparformat, IndexedDB, export/import, browsers.yml och 8192-paketet (alla M24b), multiplayer (M26–M27), release (M25a/b), WebGPU, SharedArrayBuffer.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: WorkerHost med paritet, regulatorn, renderoptimering, rapporten. Screenshot efter renderdelen.

ACCEPTANS
- Samma seed och intents ger identiska hashar på WorkerHost och MainThreadHost, även i en match med AI-säten; query-paritet: ett uppskjutningsförhandsvisnings-query (`previewLaunch`, annars M15b:s `previewBlast`) ger samma svar på båda hostarna, och två samtidiga queries av olika kind matchas rätt på id. E2E som bootar `?test=1&host=worker` (hash `#test_host-worker`) och kräver att `hostKind` är worker och att Workern inte ger några 404 vid datahämtningen (även mot artifact/ via samma statiska server som `e2e/artifact.test.ts`).
- Med Worker blockerad (addInitScript som får `new Worker` att kasta) startar spelet på MainThreadHost och rapporten visar `hostKind: main`. Bakgrundsflik: med dokumentet dolt ökar tick inte; efter återupptagning aldrig mer än 8 ticks/frame. Buffertpoolen: antalet allokerade ArrayBuffers förblir <= poolstorleken över 500 snapshots.
- Regulatorn (enhetstest, injicerad källa): ihållande långsam källa stegar ner, snabb källa stegar upp, en källa som pendlar kring tröskeln ger högst ett byte, och minsta vilotiden hålls.
- Renderräknare: trianglar, draw calls och texturminne inom budget; 20 omstarter i rad ger varken "too many active WebGL contexts" eller växande `renderer.info.memory` (geometries/textures). Flimmertest med ett högfrekvent ägarmönster: två fjärr-zoom-frames förskjutna 1 px skiljer sig i < 2 % av ägarlagrets pixlar; kontrollkörning med mipmap avstängd skiljer sig tydligt mer (loggas).
- Heap (läckagetest, taggat leak-test i e2e-skalet): skriptad match på 2 minuters speltid via `__test.advance`; renderingen sker i en 320x180-viewport över 60 renderanrop (3 omgångar x 20), tröskel 5 MB (`heapDelta`, median av 3, uppvärmning exkluderad). Chromium startas med explicit args-ARRAY där `--js-flags=--expose-gc` och `--enable-precise-memory-info` är separata argument (M00). 20 AI-nationer, 4x: tick p95 <= `budgetMs(6)` i Node; worker-rundturen (Node worker_threads), median <= `budgetMs(10)` (loggas); kallstart loggas med hängvakt 30 s.
- JS gz och data gz inom budget (mät med ett litet skript, M25a bygger vidare); perf-JSON validerar mot schemat och ett exemplar med saknat obligatoriskt fält faller.
- `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; PROGRESS.md: en rad "FPS och renderersträng från användaren: väntar" och en tier-tuning-lista; ARCHITECTURE.md: WorkerHost-protokollet, regulatorn och rapportfälten. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, vad som avvek, och exakt vad jag ska göra på min riktiga dator (?perf=1, spela några minuter på Auto, "Kopiera rapport") och hur jag rapporterar tillbaka.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- På din riktiga dator: öppna förhandsvisningen med `?perf=1` (Artifact: `#perf`, eller via F2-panelen), spela några minuter på Auto-kvalitet, tryck "Kopiera rapport" och skicka rapporten med mallen "Feedback efter en gate" (under Mallar i den här listan) i en ny session. Claude för in FPS och renderersträng i docs/PROGRESS.md och justerar tierna.
- Starta M24b först när feedbackens fix-PR (om någon) är mergad.

---

## M24b — Spara/ladda och webbläsartester

| | |
|---|---|
| **Kräver** | M24a mergad |
| **Beräknad insats** | ~3,1 h agentarbete (1,8–5,2 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — "Fortsätt"-testet: spela några minuter, stäng fliken, öppna förhandsvisningen igen och tryck Fortsätt; testa Exportera (kopiera texten) och Importera (klistra in den igen); nedladdning fungerar inte i en Artifact. Rapportera med mallen "Feedback efter en gate" under Mallar om matchen återupptogs som du lämnade den. Titta också i GitHub-fliken Actions efter browsers-jobbet. |
| **Du ser efteråt** | En Fortsätt-knapp som tar upp matchen där du lämnade den, export och import av sparfiler, och en automatisk test av Chromium, Firefox och WebKit. |

**Klistra in i en ny session:**

```text
Du bygger milestone M24b (Spara/ladda och webbläsartester) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md och, via indexet: src/host/ (WorkerHost, MainThreadHost, aiDriver och dess serialiserbara AI-state), src/sim/serialize och hash, huvudmenyn och settings (M23a), src/app/prefs.ts (M06), fx-klockan (src/render/clock.ts, M02), .github/workflows/ci.yml, tools/bake och scripts/shot.mjs.

FÖRKONTROLL
Kontrollera i docs/PROGRESS.md och `git log` att M24a är mergad i main; annars stanna och säg det. Kör `npm ci && npm run verify:fast`; rött => stanna. Anteckna `git rev-parse origin/main` som merge-SHA för M24a i milestonetabellen i docs/PROGRESS.md.

MÅL
Matchen ska överleva att fliken stängs, och determinismen ska testas i tre webbläsare. Gör punkterna i ordning 1 till 4; punkt 4 är valfri och får lämnas under Next i docs/PROGRESS.md.

GÖR
1. Versionerat binärt sparformat: header (magic, formatversion, kart-/dataversion, seed, tick), typed arrays, PRNG-state, entitetstabeller (strukturer, helikoptrar, missiler, beachheads, attacker) OCH AI-state-blobben från aiDriver (minne + egen PRNG-ström), plus checksumma. Terräng sparas inte (byggs om från data). `host.save()`/`host.load(bytes)` på båda hostarna (WorkerHost serialiserar i workern och överför bufferten). `migrate(fromVersion)` med migreringskedja; okänd framtida version, fel magic, trunkerad fil och fel checksumma avvisas med ett begripligt felmeddelande utan krasch.
2. IndexedDB-autosave var 60:e sekund av singleplayer (all åtkomst i try/catch, timern läser fx-klockan, skapa ingen ny klocka; två platser så att en avbruten skrivning aldrig förstör senaste sparet; spara även vid pagehide/dold flik efter bästa förmåga). Finns M23b: tutorial-matcher (`noAutosave`) sparas aldrig. Eventuella val sparas via `src/app/prefs.ts` (M06). Fortsätt-knapp i menyn med land och sparåldern; Exportera och Importera alltid tillgängliga i menyn/inställningarna. Exportera försöker en nedladdning (Blob + `<a download>`) men visar ALLTID sparfilen även som gzip + base64-text i en markerbar textruta (samma `showReport`-modul; kopieringsknappen sitter i en klickhanterare, eftersom nedladdning och urklipp annars är blockerade i en Artifact). Importera: filväljare ELLER en textruta där användaren klistrar in texten. Är lagring blockerad: dölj Fortsätt, visa tydligt "Autospar är avstängt" och erbjud export.
3. GitHub Actions `.github/workflows/browsers.yml`: golden-hash-testerna på Chromium, Firefox och WebKit (`workflow_dispatch` + push till main, inte varje PR). Firefox/WebKit `continue-on-error` första gången; skriv i PROGRESS.md att resultat kan antecknas först när Actions har körts. Avvisas pushen för saknad `workflow`-behörighet: committa filen som `docs/ci/browsers.yml.txt`, pusha resten och berätta exakt hur jag lägger till den på GitHub.
4. Valfritt, sist, och bara om det ryms: 8192x4096-höjdpaket via tools/bake. Kräver Terrarium z5 (1024 tiles, ca 70 MB nedladdning; bekräfta att S3 är nåbart). Paketet räknas INTE in i data-taket 6 MB utan har eget tak <= 3 MB gz och en egen rad i `npm run budget` (dist-totalen höjs motsvarande, skriv i DECISIONS.md). Laddas lazy och bara när maxTextureSize >= 8192. Annars hoppa över punkten och skriv den under Next.

REGLER, TAL OCH GRÄNSSNITT
- Ingen ändring av sim-regler; golden hashes oförändrade. Sparformatet ändras bara via ny version + migrering.
- Alla nya strängar i både sv och en. data-testid på Fortsätt, Exportera, Importera.
- Clean-room: ingen kod, inga namn eller assets från OpenFront.io eller andra spel.

UTANFÖR OMFATTNING
Molnsparande, konton, flera sparplatser i UI, multiplayer-sparande (M26–M27), release (M25a/b), nya mekaniker.

ARBETSSÄTT
Enligt CLAUDE.md. Ordning: format + tester, host.save/load, IndexedDB och UI, browsers.yml, sist 8192-paketet.

ACCEPTANS
- Playwright: spara -> ladda -> fortsätt N ticks har samma hash som en rak körning, med AI-säten (så att AI-blobben måste vara med), på både WorkerHost och MainThreadHost (`?test=1&host=worker` respektive `host=main`; hash `#test_host-worker`/`#test_host-main`). Test: export till text och import från texten ger samma hash. Test: laddar man ett spar utan AI-blobben divergerar hashen (kontrollfall).
- Korrupt fil: alla enskilda bytesflippar av en fixtur, trunkering, fel magic och framtida version avvisas utan krasch och utan att nuvarande match påverkas.
- Migrering: en committad v1-fixtur laddas och ger förväntad hash (fångar oavsiktliga formatändringar); en syntetisk migrering 0->1 registrerad i testet bevisar kedjan.
- Fortsätt-flödet (e2e, fx-klockan): autosave efter 60 s, sidomladdning, Fortsätt återupptar med samma hash; med IndexedDB blockerad (addInitScript) är Fortsätt dold, export -> import ger samma hash och inga console errors.
- browsers.yml är giltig YAML (testet parsar den med `yaml`-paketet från M00:s CI-filtest och läser `.github/workflows/browsers.yml` eller `docs/ci/browsers.yml.txt`, den som finns) och kör samma hashtester; verify:fast och verify är oförändrat gröna.
- 8192-paketet (om byggt): ett test med maxTextureSize 4096 gör 0 nätverksanrop för paketet; gz-storleken <= 3 MB kontrolleras i bygget och `npm run budget` rapporterar totalen med och utan paketet (data-taket 6 MB gäller utan det).
- `npm run verify` grönt.

SLUT
Enligt CLAUDE.md; ARCHITECTURE.md: sparformatet, migreringsregeln och host.save/load; PROGRESS.md: att Firefox/WebKit-resultat väntar på Actions. Uppdatera förhandsvisningen enligt docs/PREVIEW.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, vad som avvek, och exakt hur jag testar Fortsätt, Exportera och Importera och hur jag rapporterar tillbaka.
```

**Efteråt gör du:**
- Merga PR:en (be samma session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main").
- Testa Fortsätt: spela några minuter, stäng fliken, öppna förhandsvisningen igen och tryck Fortsätt. Testa Exportera (kopiera texten) och Importera (klistra in den igen); nedladdning fungerar inte i en Artifact. Rapportera med mallen "Feedback efter en gate" (under Mallar i den här listan) i en ny session.
- Efter mergen: öppna fliken Actions i GitHub, kör browsers-jobbet vid behov (Run workflow) och klistra in om Firefox/WebKit blev gröna eller röda.
- Det är läge för en hälsokoll (se Mallar) innan du går vidare till M25a.

---

## M25a — Release-förberedelse: bygge, budgetar, deploy och README

| | |
|---|---|
| **Kräver** | M19 och M24b mergade |
| **Beräknad insats** | ~1,4 h agentarbete (0,9–2,3 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Ett produktionsbygge som är deployat enligt förhandsvisningsvägen i docs/PREVIEW.md (Claude berättar vem som kan öppna länken), begripliga felskärmar, README på svenska och engelska och en playtest-mall. Ingen versionstagg än; den kommer i M25b. |

**Klistra in i en ny session:**

```text
Du bygger milestone M25a (Release-förberedelse: bygge, budgetar, deploy och README) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md.
- docs/PREVIEW.md (vilken väg M00b valde: Netlify, Artifact eller lokalt; deploy följer EXAKT den), vite.config.ts, package.json, .github/workflows/ci.yml, docs/ASSETS.md, CREDITS.md, hjälp-överlägget (hotkeys, M20a).

FÖRKONTROLL
Är M19 och M24b mergade i main (docs/PROGRESS.md + `git log --oneline -15`)? Om inte: avbryt och berätta. Delar av M21 tier 3 som jag medvetet kapat och som står under Skipped i PROGRESS.md räknas som klara. Notera `git rev-parse origin/main` i milestone-tabellen. Kör `npm ci && npm run verify:fast`.

MÅL
Ett färdigt produktionsbygge med mätta budgetar, deploy, snälla felskärmar, dokumentation och licensrevision. Granskningen och taggen v1.0.0 tillhör M25b, inte denna prompt.

GÖR
1. Produktionsbygge: hashade assets, base `./` för alla förhandsvisningsvägar (beslutat i M00b; ingen VITE_BASE). `npm run budget` kontrollerar TRE tal var för sig: data (summa .bin.gz) <=6 MB, spel-JS gz <=1,2 MB, dist totalt <=9 MB; redovisa talen både med och utan det valfria 8192-paketet (M24b), som har eget tak <=3 MB gz och egen rad i `budget` utanför data-taket. Gränserna kan överstyras via miljövariabler så att testet kan tvinga fel. Playwright-smoke mot `vite preview` som nytt CI-steg.
2. Dataladdning via `data/manifest.json` (M01, M00b): om svaret (efter eventuell base64-avkodning) börjar med gzip-magic 1f 8b (värden avkodar inte) kör DecompressionStream, annars inte; checksummorna ska validera i båda fallen och för båda behållarna. Med base64-behållare blir datan ca 33 % större: kontrollera att varje fil ryms under 16 MB.
3. Deploy enligt PREVIEW.md. Netlify: återdeploy till den befintliga siten är tillåten; fråga mig bara före ny site, ändrad delning eller annan publik värd, och säg vem som kan öppna länken (en Netlify-site kan öppnas av alla med länken även om repot är privat). Artifact: kör uppdateringsproceduren i docs/PREVIEW.md (read, list, pack --prev, publicera i batcher); rapportera storleksgränserna. Lokalt: dokumentera `npm ci && npm run build && npm run preview` och ladda upp dist som CI-artefakt. Lägg `.github/workflows/pages.yml` med enbart `workflow_dispatch`, kommentar överst att det kräver publikt repo eller plan med privata Pages, och aktivera det INTE. Cloudflare Pages och Netlify Drop dokumenteras som alternativ. Avvisas push av `.github/workflows/*`: lägg filen som `docs/ci/<namn>.yml.txt` och förklara steg för steg hur jag lägger in den på GitHub.
4. Tre felskärmar (DOM, text på både sv och en, statiskt fallback-innehåll om t() inte hunnit laddas): WebGL2 saknas; `webglcontextlost` (preventDefault, overlay, återställ vid `webglcontextrestored` eller erbjud omladdning med autosave från M24b); global felgräns (`error`, `unhandledrejection`) med kraschrapport via `showReport` (version, userAgent, renderersträng, tick, seed, sim-hash, senaste 20 console-felen). Ingen telemetri och inga nätverksanrop.
5. Docs: README.md på svenska och engelska (spela, kontroller ur hjälp-överlägget, bygga från källkod), ARCHITECTURE.md-index uppdaterat, CHANGELOG.md, uttalande att spelet är originellt och inget kopierat från OpenFront.io eller annat spel, CREDITS.md komplett (varje post i docs/ASSETS.md finns där; skriptad kontroll). `scripts/license-audit.mjs`: listar beroenden med licens, fallerar på GPL/AGPL, och grep som fallerar på "openfront" (skiftlägesokänsligt) i src/, tools/, server/, e2e/ (inte docs/, README eller scripts/).
6. Lägg en ny sektion Playtest-mall i docs/PROMPT_TEMPLATE.md (skelettet ligger kvar): jag klistrar in en lista med fynd; varje fynd får reproduktion, förväntat beteende och scope-vakt; max 5 fynd per session.

REGLER, TAL OCH GRÄNSSNITT
- Inga sim-regeländringar; golden hashes oförändrade. Inga GPL/AGPL-beroenden, ingen OpenFront-härledd kod. Inga större versionsuppgraderingar.

UTANFÖR OMFATTNING
Granskningspass och tagg v1.0.0 (M25b). Multiplayer (M26a/b, M27), nya funktioner, balans, telemetri, konton, egen domän, WebGPU.

ARBETSSÄTT
Enligt CLAUDE.md. Milestone-specifikt: kör smoke och budget i bakgrunden mot ett färskt `npm run build`.

ACCEPTANS
- `npm ci && npm run verify && npm run build && npm run budget` gröna; budgettalen redovisade med och utan 8192-paketet (om det finns). `budget` med tvingat små gränser fallerar för var och en av de tre siffrorna (test).
- Produktionssmoke mot `vite preview`; produktionssmoken körs även mot artifact/ via samma statiska server som `e2e/artifact.test.ts`. Den gör: meny, välj land, `advance(1200)` ticks via __test (motsvarar 2 min speltid, ingen väggklocka) med AI, `?scenario=slice` där helikoptern når Landed och ger en brohuvudägare, ett kärnvapenavfyr (missil syns i snapshot), noll console errors och inga svar >=400 eller requestfailed.
- Test av gzip-vägen: transparent avkodning, rå gzip och base64-containern (via artifact:pack) ger samma checksummor; en korrumperad fil ger checksummefel.
- Tvingat WebGL-saknas (getContext -> null i addInitScript) visar fallback-skärmen; context loss (WEBGL_lose_context, annars syntetisk händelse, redovisa vilket) visar overlay; ett kastat fel visar kraschrapporten och inga nätverksanrop sker (page.on('request') är tomt efter felet).
- Licensrevisionen visar ingen GPL/AGPL; ett planterat GPL-paket i en fixtur och en planterad "OpenFront"-sträng fångas (test).
- Deploy-länk eller exakta manuella steg i docs/PROGRESS.md, inklusive vem som kan öppna den.

SLUT
Enligt CLAUDE.md (PROGRESS, DECISIONS, ARCHITECTURE-index). Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, mätta budgettal, avvikelser, länken och vem som kan öppna den, samt exakta steg jag måste göra själv.
```

**Efteråt gör du:**
- Merga PR:en enligt flödet i början av listan. Frågar Claude om delning: svara Nej (privat) om du inte vill att andra ska kunna öppna spelet; Netlify-länkar kan öppnas av alla som har länken.
- Öppna länken i docs/PREVIEW.md och kolla att menyn laddar. Starta sedan M25b i en NY session.

---

## M25b — Granskning och v1.0

| | |
|---|---|
| **Kräver** | M25a mergad |
| **Beräknad insats** | ~1,2 h agentarbete (0,7–1,8 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — spela en hel match i förhandsvisningen enligt docs/PREVIEW.md och rapportera med mallen "Feedback efter en gate" (hittade du något som krånglar, hur kändes det). |
| **Du ser efteråt** | Ett granskat v1.0 av enspelarspelet, en granskningsrapport (docs/REVIEW.md) och en versionstagg v1.0.0, eller en dokumenterad commit-SHA om taggen inte kan pushas. Delningsbar länk: Netlify = alla med länken; Artifact = bara om du själv delar det; lokalt = ingen. |

**Klistra in i en ny session:**

```text
Du bygger milestone M25b (Granskning och v1.0) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
Det här ska vara en HELT NY session. Läs bara tre saker: CLAUDE.md, docs/CHARTER.md och `git diff --stat <M00-merge-SHA>..origin/main`. Hämta M00-SHA:n genom att grep:a M00-raden i milestone-tabellen i docs/PROGRESS.md och läs inget annat där. Läs inte ARCHITECTURE.md, DECISIONS.md eller BACKLOG.md förrän du skrivit din första fyndlista (annars ankrar de dig); öppna sedan bara de källfiler diffstatistiken pekar på. Har du redan läst annat i den här sessionen: säg det och föreslå att jag startar om.

FÖRKONTROLL
Är M25a mergad i main (`git log --oneline -15`)? Om inte: avbryt och berätta. Notera `git rev-parse origin/main`. Kör `npm ci && npm run verify:fast`.

MÅL
En granskning med färska ögon av hela koden, och därefter v1.0.0.

GÖR
1. Granska sex kategorier och skriv för varje kommandot du använde och resultatet (även "0 fynd") i docs/REVIEW.md: (a) determinism-läckor (Math.random, Date.now, performance.now, Map/Set-iterationsordning, flyttal i hash, förbjudna API:er som når src/sim); (b) lagergränser (src/ai importerar bara SimView och src/sim/public.ts; sim importerar inte three/DOM); (c) död kod och oanvända exporter (`tsc --noUnusedLocals`, grep); (d) försvagade tester (`git log -p` på tröskelvärden, `.skip`, `.only`, vidgade toleranser, omgenererade goldens); (e) clean-room och licens (kör `scripts/license-audit.mjs`); (f) produktionsrisker (test-hooks utan ?test=1, hemligheter, nätverksanrop, felskärmar).
2. Varje fynd får id, allvar (P1 bryter spelet eller determinismen, P2 tydligt fel, P3 kosmetiskt), fil och status. Åtgärda P1/P2 som är lokala (högst ca 40 rader per fynd, ändrar inte sim-regler eller goldens) och lägg ett test för varje åtgärd som går att testa. Allt annat loggas i docs/BACKLOG.md med motivering. Läs DECISIONS.md först när du kontrollerar om ett fynd var ett medvetet beslut.
3. Uppdatera CHANGELOG.md och README om granskningen ändrar något synligt.

REGLER, TAL OCH GRÄNSSNITT
- Försvaga inget test, vidga ingen tolerans, regenerera inga goldens. Behöver ett fynd ändrad sim-regel eller golden: logga det, åtgärda det inte.

UTANFÖR OMFATTNING
Nya funktioner, balansändringar, refaktorering utanför fynden, multiplayer.

ARBETSSÄTT
Enligt CLAUDE.md. Granska först, åtgärda sedan; en commit per åtgärdat fynd.

ACCEPTANS
- docs/REVIEW.md har alla sex kategorier med kommando och resultat; varje fynd är åtgärdat (med test där det går) eller loggat i BACKLOG.md.
- `git diff origin/main --stat` visar inga ändrade golden-filer och inga borttagna asserts utan motivering i DECISIONS.md.
- Från ren klon: `npm ci && npm run verify && npm run build && npm run budget` och license-audit är gröna.

SLUT
Enligt CLAUDE.md. Öppna en DRAFT-PR. Svara på svenska: antal fynd per allvar, vad som åtgärdades och loggades, och att taggen kommer först efter min merge och min gate. Efter att jag skrivit "allt klart, tagga v1.0.0" i den här sessionen: `git fetch origin`, `git tag -a v1.0.0 origin/main -m "v1.0.0"`, `git push origin v1.0.0`. Fungerar inte tag-push: skriv SHA:n i docs/PROGRESS.md under Done och säg den till mig; då är v1.0 den commit-SHA:n.
```

**Efteråt gör du:**
1. Merga PR:en enligt flödet i början av listan.
2. Gate: spela en hel match i förhandsvisningen och skicka rapport med mallen "Feedback efter en gate" i en ny session (hoppa över om allt var bra). Hittar du fel: använd mallen Buggrapport eller Feedback efter en gate i en ny session.
3. Merga en eventuell fix-PR enligt flödet. Delningsbar länk: Netlify = alla med länken; Artifact = bara om du själv delar det; lokalt = ingen.
4. Först då: skriv till SAMMA session som gjorde granskningen "allt klart, tagga v1.0.0". Då taggar Claude v1.0.0. Online-spel (M26a, M26b, M27) är valfritt.

---

# Del 5 — Valfritt: onlinespel (M26a–M27)

Bara efter v1.0 (M25b mergad) och bara om du vill spela online med vänner. Det kräver ett hostingkonto och kostar pengar. Gate: M27.

## M26a — VALFRITT: multiplayer-grund — transport, relä och headless-server

| | |
|---|---|
| **Kräver** | M25b mergad. **VALFRI**: kör den här prompten först om du vill ha online-spel. Inget konto behövs för M26a (reläet körs bara lokalt i testerna); hostingkonto och beslut behövs först före M27. |
| **Beräknad insats** | ~3,2 h agentarbete (1,9–5,4 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | INGET nytt att spela: ingen lobby och ingen match med en vän. Claude visar testresultat (tre klienter får samma hash, en avsiktlig desync upptäcks, dåliga meddelanden avvisas, bandbredd mätt). Riktig onlinematch kräver M26b och M27. |

**Klistra in i en ny session:**

```text
Du bygger milestone M26a (VALFRITT: multiplayer-grund — transport, relä och headless-server) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (SimHost, Turn, Intent-kodeken).
- src/host/ (SimHost, MainThreadHost, LocalTransport), src/sim/{codec,serialize,hash}, src/data/ (laddare med fs-stöd i Node) och match header-typen {engineVersion, mapHash, seed, config, seats}.

FÖRKONTROLL
Är M25b (v1.0) mergad i main (docs/PROGRESS.md + `git log --oneline -15`)? Om inte: avbryt och berätta. Notera `git rev-parse origin/main` (jämförelsepunkt för `git diff <sha> -- src/sim`). Kör `npm ci && npm run verify:fast`.

MÅL
Grunden för deterministisk lockstep: en nätverksturn är ett sim-tick (100 ms), alla kör samma sim och jämför hashar. Alla klienter har hela världen (ingen fog of war, fusk möjligt); det är ett medvetet avvägande. Obs: en Claude Artifact blockerar WebSocket och anrop till andra servrar (se docs/PREVIEW.md), så onlinespel kan inte provspelas i en Artifact; klienten måste ligga på en riktig webbadress. Det här steget ger INGEN spelbar vänmatch; lobby, AI på servern och UI kommer i M26b.

GÖR
1. Klient: `RoomTransport`-gränssnitt med befintliga `LocalTransport` och nya `WebSocketTransport`; SimHost konsumerar Turn{n, intents[]}; kompakt, versionerad binär Turn-kodek byggd på Intent-kodeken; `inputDelayTurns` är transportens egenskap (Local: nuvarande värde oförändrat, WebSocket: 2); klienthash räknas varje turn och skickas. Serveradress via `?relay=` och bygge-variabel; standardvärdet är samma värd som sidan (`wss://${location.host}`).
2. server/ (Node 22 + `ws` 8.x; `npm view ws version`, pinna exakt; pinna även `@types/ws` 8.18.x som devDependency och notera båda i DECISIONS.md): rum i minnet, konfigurerbar turn-timer (`--turn-ms`, standard 100) som stämplar och sänder Turn inklusive tomma heartbeats, rate limit ca 20 Intents/s per klient, storleks- och schemakontroller (en klient får bara skicka Intents för sin egen plats), routing på engineVersion/mapHash med tydligt avvisningsskäl, Dockerfile (försök `docker build` om docker finns, annars skriv "overifierat").
3. Headless sim på servern (importerar src/sim och src/data). Serverns sim-hash är domare: avviker en klients hash var 10:e turn får den Desync{turn} och kopplas från (resync är M27); majoritetsjämförelsen loggas också.
4. `scripts/net-bandwidth.mjs`: 8 testklienter som skickar ca 2 Intents/s, mäter nedström per klient.
5. Hjälpare för injicerad desync får bara finnas i testklienten, aldrig i src/sim eller produktionsvägen.

REGLER, TAL OCH GRÄNSSNITT
- Inga regeländringar i src/sim: `git diff <sha> -- src/sim` tomt eller bara typexporter motiverade i DECISIONS.md. Behövs en ändring: stanna och fråga.
- Servern litar aldrig på klienten och får inte kunna krascha av dåliga meddelanden. Inga konton, matchmaking, telemetri. Clean-room.

UTANFÖR OMFATTNING
Lobby-UI, rumslänkar, AI-platser, pending-ghosts, Playwright med två kontexter (M26b). Snapshot-resync, återanslutning, serverdeploy, load/soak (M27).

ARBETSSÄTT
Enligt CLAUDE.md. Milestone-specifikt: kodek och transport först, sedan server, sedan test. Servertester använder `--turn-ms` nära 0 så att 3000 ticks inte tar 5 min väggklocka; längre körningar i bakgrunden med loggfil.

ACCEPTANS
- Kodekens rundtur är exakt; okänt versionsbyte avvisas.
- Server + 3 Node-klienter (inga AI-platser) spelar 3000 ticks och har identiska hashar vid varje 10:e turn och i slutet, lika med serverns. Kontrollkörning utan injektion ger noll Desync. Injicerad desync i en testklient upptäcks inom 10 turns, bara den klienten får Desync.
- Varje avvisning har ett testat skäl och servern lever efteråt (en ny klient går med och en match spelas klart): ogiltig binär, fel versionsbyte, för stort meddelande, 100 Intents på en sekund, fel engineVersion, fel mapHash, Intent för annans plats.
- Bandbreddsskriptet loggar nedström per klient vid 8 spelare, <=3 KB/s; med `--limit 0.1` fallerar det (test).
- `git diff <sha> -- src/sim` redovisat; enspelarläge och golden hashes oförändrade; `npm run verify` grönt (servertesterna ingår).

SLUT
Enligt CLAUDE.md; dokumentera Turn-flöde och protokoll i ARCHITECTURE.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, avvikelser, uppmätt bandbredd och att inget är spelbart än.
```

**Efteråt gör du:**
- Merga PR:en enligt flödet i början av listan. Du kan inte spela mot en vän än; det kräver M26b och M27.
- Om du vill fortsätta: starta M26b. Bestäm redan nu om du vill lägga servern online (M27 kräver konto hos Fly.io eller Hetzner och kostar pengar). Annars stannar du här; v1.0 fungerar som den är.

---

## M26b — VALFRITT: multiplayer — lobby och AI på servern

| | |
|---|---|
| **Kräver** | M26a mergad. **VALFRI**: bara om du vill ha online-spel. Inget konto behövs, men en match med en vän går först efter M27. |
| **Beräknad insats** | ~2,1 h agentarbete (1,3–3,6 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Nej |
| **Du ser efteråt** | Lobbyskärmen finns i koden men går inte att använda utan ett relä; det kör Claude bara i tester. Du har inget att prova förrän M27. |

**Klistra in i en ny session:**

```text
Du bygger milestone M26b (VALFRITT: multiplayer — lobby och AI på servern) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (Turn-flöde och protokoll från M26a, AI-driver).
- server/ (relä, rum, headless sim), src/host/aiDriver.ts, src/host/ (WebSocketTransport, SimHost), menyn/setup och flaggeneratorn (M06), e2e/ (konfig för webServer).

FÖRKONTROLL
Är M26a mergad i main (docs/PROGRESS.md + `git log --oneline -15`)? Om inte: avbryt och berätta. Notera `git rev-parse origin/main`. Kör `npm ci && npm run verify:fast`.

MÅL
Lobby och AI-platser ovanpå transporten från M26a, så att en match med flera klienter kan startas och spelas LOKALT mot ett lokalt relä. Det blir ingen match med en vän förrän servern ligger online i M27.

GÖR
1. Lobby i DOM: skapa rum (rumslänk `?room=KOD`, relä via `?relay=`), gå med, platser, färger/flaggor (flaggeneratorn), redo-knapp, AI-fyllnad, värd startar. Upp till 8 människor, resten AI enligt matchkonfigurationen. Lämnar värden stängs rummet med ett begripligt meddelande. Alla strängar via t() (sv och en).
2. AI-platser körs på servern: serverns aiDriver (eget PRNG-flöde) använder den headless simen och lägger AI-Intents i Turn-strömmen; klienterna konstruerar ingen aiDriver i flerspelarläge. Bekräfta eller motivera annat i docs/DECISIONS.md.
3. Optimistiska "pending"-ghosts i UI för egna Intents, borta när de tillämpats (T+2).
4. Registrera lobbyn i Dev-panelen så att jag inte behöver skriva i adressfältet.

REGLER, TAL OCH GRÄNSSNITT
- Inga regeländringar i src/sim (`git diff` mot M25b-mergens SHA från docs/PROGRESS.md (`git log main`) för src/sim tomt, annars stanna och fråga). Golden hashes och enspelarläget oförändrade.
- Inga konton, ingen matchmaking, inga topplistor, ingen telemetri. Clean-room.

UTANFÖR OMFATTNING
Resync, återanslutning, sen anslutning, AI-övertag vid frånkoppling, serverdeploy, load/soak (M27). Chatt, allianser, åskådare, fog of war.

ARBETSSÄTT
Enligt CLAUDE.md. Milestone-specifikt: Playwright startar det lokala reläet via `webServer` med snabb `--turn-ms`; vänta på `state().tick >= N` med generös timeout, assertera ingen väggklocka.

ACCEPTANS
- Playwright, två webbläsarkontexter: A skapar rum, B går med via länken, olika platser och färger, båda redo, värden startar (2 människor + 2 AI). A och B utfärdar olika Intents (till exempel A utvidgar, B bygger). Vid tick >=600 har båda samma sim-hash och samma landsummor; varje människas land är större än vid start och AI-platserna har vuxit (bevisar att AI-Intents går via servern).
- Test: klienterna har ingen aiDriver i flerspelarläge (räknare via __test, dokumenterad i ARCHITECTURE.md). En ghost syns direkt efter ett Intent och är borta efter tillämpning.
- Icke-värd kan inte starta; en nionde människa nekas med läsbart skäl; avvikande engineVersion visar ett läsbart fel.
- Paritetstest för sv/en-strängarna grönt. Enspelarbeteende och goldens oförändrade; `git diff` av src/sim mot M25b-mergens SHA redovisat; `npm run verify` grönt.

SLUT
Enligt CLAUDE.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, avvikelser, och vad jag måste bestämma eller skaffa före M27 (hostingleverantör, kostnad, konto). Påminn att priser bara kan kollas på leverantörens sida och att jag verifierar dem själv.
```

**Efteråt gör du:**
- Merga PR:en enligt flödet i början av listan. Lobbyskärmen finns i koden men går inte att använda utan ett relä; det kör Claude bara i tester. Du har inget att prova förrän M27.
- Läs Claudes lista över vad du behöver bestämma före M27 (konto, kostnad). Vill du inte ha online-spel stannar du här.

---

## M27 — VALFRITT: resync, återanslutning, AI-övertag och serverdeploy

| | |
|---|---|
| **Kräver** | M26b mergad. **VALFRI**: bara om du vill ha online-spel. Du behöver själv: ett konto hos Fly.io eller Hetzner (troligen med kreditkort), ett beslut om kostnad och en vän att testa med. |
| **Beräknad insats** | ~4,7 h agentarbete (2,9–8,5 h) |
| **Modell / effort** | Sonnet 5.5, medium |
| **Din gate** | Ja — följ docs/SERVER.md (konto, token, deploy), spela en match med en vän, stäng din flik en stund och öppna den igen, och rapportera med mallen "Feedback efter en gate". Stäng av servern efteråt om den kostar pengar. |
| **Du ser efteråt** | Vänner kan hoppa in och ut ur en pågående match, en frånkopplad spelare ersätts tillfälligt av AI, och (efter att du själv deployat) servern ligger på en publik adress som du delar som rumslänk. |

**Klistra in i en ny session:**

```text
Du bygger milestone M27 (VALFRITT: resync, återanslutning, AI-övertag och serverdeploy) i 3D-krigsspelet i det här repot. Svara mig på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
- CLAUDE.md, docs/CHARTER.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (Turn-flöde, protokoll, lobby).
- server/ (relä, rum, headless sim, Dockerfile), src/host/ (WebSocketTransport, SimHost), save/serialize-koden (M24b), docs/PREVIEW.md.

FÖRKONTROLL
Är M26b mergad i main (docs/PROGRESS.md + `git log --oneline -15`)? Om inte: avbryt och berätta. Notera `git rev-parse origin/main`. Kör `npm ci && npm run verify:fast`.

MÅL
Gör multiplayer robust och förbered att lägga servern online. Du har ingen åtkomst till mitt hostingkonto: allt som kräver konto verifieras högst till lokal `docker run`, och du skriver steg-för-steg-instruktioner jag kan följa utan förkunskaper.

GÖR
1. Resync: servern tar snapshot var 600:e tick (gzip); sen anslutning och återanslutning via snapshot + turn-svans; en klient i minoritet får resync i stället för att kastas ut.
2. Frånkoppling: efter ca 20 s tar AI över platsen (servern kör AI-Intents) och lämnar tillbaka den vid återanslutning; paus och hastighet skickas som host-/turn-kontrollmeddelanden i transportlagret (inte sim-Intents) och tillämpas av servern, utan ändring i src/sim; en klient som släpar för långt kickas eller ersätts av AI.
3. Deploy-filer: `fly.toml` (shared-cpu-1x, auto-stop), manuellt deploy-workflow med repo-secret `FLY_API_TOKEN` (avvisas push av `.github/workflows/*`: lägg som `docs/ci/<namn>.yml.txt` och förklara hur jag lägger in den), Hetzner-alternativ med docker-compose, hälso-endpoint, strukturerade loggar, pinnad version. Servern får testflaggan `--no-hash-check` bara för lasttester; Dockerfile och fly.toml sätter den aldrig (test).
4. `npm run loadtest` och `npm run soak` (flaggor `--clients`, `--minutes`) med lätta klienter som separata worker_threads; båda ligger UTANFÖR `npm run verify`, som bara får ett rökprov med 4 klienter utan tidsgräns.
5. docs/SERVER.md (svenska): kontoskapande, token, deploy, loggar, stoppa servern så den inte kostar, dela rumslänken. Priser: försök läsa leverantörens egna sidor, men fly.io och hetzner.com är troligen blockerade i molnet. Då skriver du prisuppgifterna som 'overifierat' med datum: Hetzner ungefär 4–6 EUR/mån plus ca 0,5 EUR för IPv4, exkl. moms, billigaste planerna kan vara slutsålda; Fly.io ungefär 2–6 USD/mån, kreditkort troligen krävs. Skriv i SERVER.md och i ditt slutsvar att jag själv kollar priset innan jag betalar.
6. Klienten måste ligga på en riktig webbadress (en Artifact blockerar WebSocket). Låt reläservern (samma Node-process och samma Docker-image/Fly-app) även servera `dist/` som statiska filer, så att sidan och `wss://` har samma värd och inget CORS- eller mixed-content-problem; `?relay=` är då standard `wss://${location.host}` (verifiera att `?relay=` även fungerar med `wss://`). Skriv i SERVER.md hur vänner öppnar `https://<app>.fly.dev/?room=KOD`. Netlify/Netlify Drop nämns bara som alternativ. Test: imagen svarar 200 på `/` och på relä-websocketen.

REGLER, TAL OCH GRÄNSSNITT
- Inga regeländringar i src/sim (`git diff <sha> -- src/sim` tomt, annars stanna och fråga). Goldens och enspelarläge oförändrade.
- Inga hemligheter i kod eller repo. Kör aldrig deploy eller `fly`-kommandon som kostar pengar eller kräver mitt konto. Inga proprietära SDK:er; bara Node + ws + Docker. Clean-room.

UTANFÖR OMFATTNING
Alliansdiplomati, chatt, matchmaking, topplistor, konton, fog of war, åskådare, egen domän, att utföra deployen åt mig.

ARBETSSÄTT
Enligt CLAUDE.md. Milestone-specifikt: resync först, sedan frånkoppling/AI, sedan deploy och docs. Lasttest och soak körs med run_in_background och loggfil.

ACCEPTANS
- Klient bortkopplad vid tick 1500 och återansluten vid 2200 slutar med samma hash som de andra; sen anslutning vid 3000 matchar; en injicerad desync (testklient) återhämtas inom 30 turns (motsvarar 3 s speltid; mäts i turns). En platsfrånkoppling över 20 s speltid ger AI-övertag som syns i Turn-strömmen och återlämnas.
- Lasttest (`npm run loadtest`, utanför verify): 32 klienter som separata worker_threads håller 100 ms turn-takt; jittergränsen 150 ms (p99 över >= 200 turns) är `budgetMs(150)` via perfguard, och med färre än 4 kärnor markeras testet overifierat och loggas bara. Uppmätt värde loggas tillsammans med antal kärnor; 50 ms redovisas som mål, inte som krav. Nedström <=3 KB/s per klient.
- `npm run soak -- --minutes 5` (4 klienter, i sessionen, utanför verify) visar <20 % RSS-ökning efter 60 s uppvärmning (median av sista tre mätningar mot första tre). Skriptet fallerar med en avsiktligt läckande servermock (test). Den 30-minuters körningen är ett dokumenterat kommando för min egen dator.
- Docker-imagen bygger och klarar integrationssviten via lokal `docker run` (saknas docker: markera overifierat och säg vad som kvarstår). `npm run verify` grönt (inklusive 4-klients rökprov); docs/SERVER.md komplett.

SLUT
Enligt CLAUDE.md. Öppna en DRAFT-PR. Svara på svenska: vad som gjordes, avvikelser, uppmätta jitter- och soak-värden, vilka priser som är overifierade, och en numrerad lista över exakt vad jag själv gör (konto, token, deploy, testa med en vän).
```

**Efteråt gör du:**
- Merga PR:en enligt flödet i början av listan.
- Följ `docs/SERVER.md` steg för steg: konto, token som repo-secret, deploy. Kolla priset på leverantörens sida innan du betalar. Fastnar du: klistra in felmeddelandet i en ny session.
- Prova med en vän: ni öppnar båda `https://<app>.fly.dev/?room=KOD` (servern serverar även själva spelet; en Artifact kan inte användas för online-spel). Rapportera sedan med mallen "Feedback efter en gate". Stäng av servern när ni är klara om den kostar pengar.

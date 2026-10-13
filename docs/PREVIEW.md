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
9. Det första du ska se är ett upplyst klot på svart bakgrund. Nere till höger finns en liten länk "Testsida (probe)". Den visar en tabell över vad miljön klarar. Klistra gärna in den tabellen i chatten.

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

I en Artifact når inte adressparametrar (`?x=y`) sidan, men ett rent ankare (`#...`) gör det. Därför skrivs varje adress med `?` också i ankarform. Grammatiken införs i M02 (då läser spelet ankaret). Tills dess ignorerar spelet ankaret; probe-sidan visar bara vad som kommer fram. Tillåtna tecken i ett ankare: A–Z a–z 0–9 - . _ ~

| Lokalt (dator) | I en Artifact (länken + ankare) | Anmärkning |
|----------------|----------------------------------|------------|
| `?test=1` | `#test-1` | testläge (fast bild, ingen animation) |
| `?perf=1` | `#perf-1` (om M02 också godtar kortformen `#perf` skrivs det här) | prestandaläge, kommer senare |
| `?seed=7` | `#seed-7` | |
| flera parametrar | skrivs efter varandra, regeln fastställs i M02 | |

17. Lägen i en Artifact nås alltså med länken + `#läge` (till exempel `https://claude.ai/artifact/H4jqcMBvTMi7udLais5btV#perf`) eller via Dev-panelen: F2 på dator, hörnknappen på telefon. Dev-panelen införs i M02.

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

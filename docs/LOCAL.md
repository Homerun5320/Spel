# Köra projektet på din egen dator (Windows, riktigt grafikkort)

Den här guiden är för dig som inte är programmerare. Den visar hur du får spelet och testerna att köra på din dator med ett riktigt grafikkort (RTX 5060) i stället för i molnet, där allt ritas av en långsam programvarurenderare (SwiftShader). Du får då riktiga bilder, riktig bildfrekvens och snabbare tester, och du kan skicka tillbaka en rapport som visar hur det går på din dator.

Allt här är skrivet och kontrollerat i en molnmiljö utan grafikkort. Lägesbrytaren och skripten är enhetstestade, men ingen har kört dem på ett riktigt grafikkort än. Avsnitt 9 listar vad som är otestat. Om något går fel är det inte ditt fel: kopiera felet och skicka det.

## 1. Vad du behöver (en gång)

1. **Node.js 22 LTS.** Gå till nodejs.org, välj knappen för LTS-versionen och kontrollera att det är version 22 (spelet kräver 22.13 eller nyare). Installera med standardvalen.
2. **Git för Windows.** Gå till git-scm.com, ladda ner och installera med standardvalen.
3. **Chrome eller Edge.** Edge finns redan i Windows. Testerna hittar en installerad Chrome eller Edge själva.
4. **Valfritt: Claude-appen** (Claude desktop) om du vill att en Claude-session ska arbeta direkt i mappen på din dator (avsnitt 8).

Starta om datorn om en ruta säger att miljövariabler har ändrats. Öppna sedan **PowerShell** (Start-menyn, skriv PowerShell). Kontrollera:

```
node --version
git --version
```

Den första ska visa v22 eller högre.

## 2. Hämta koden

Spelets kod ligger i ett privat GitHub-arkiv, så du loggar in första gången.

```
git clone https://github.com/Homerun5320/Spel
cd Spel
```

En inloggningsruta öppnas (Git Credential Manager): logga in med ditt GitHub-konto. Mappen Spel skapas där PowerShell stod (oftast din användarmapp). Föredrar du GitHub Desktop i stället för git på kommandoraden fungerar det lika bra (stegen står i `docs/PREVIEW.md`, avsnitt 8); öppna sedan en terminal i mappen.

Så länge arbetet inte är sammanfogat med huvudgrenen (main) ligger det på en egen gren. Byt till den:

```
git checkout claude/ecstatic-euler-s1wm2k
```

(Efter sammanfogningen behövs inget byte; då räcker `git pull`.) Vill du senare hämta nytt arbete: `git pull` i mappen Spel och därefter `npm ci` igen om filen package-lock.json ändrats.

## 3. Installera beroenden

I mappen Spel:

```
npm ci
```

Klagar PowerShell på att skript inte får köras: använd Kommandotolken (cmd) i stället för PowerShell för alla `npm`-kommandon. Det tar några minuter och kräver internet. Det installerar exakt de versioner projektet är byggt med. Varningar om "deprecated" kan du ignorera. Får du ett rött felmeddelande: kopiera hela texten och skicka den.

## 4. Spela och titta

```
npm run dev
```

Terminalen skriver en rad som `Local: http://localhost:5173/`. Öppna den adressen i Chrome eller Edge. Tryck **Spela** på startskärmen. F2 öppnar Dev-panelen, F3 visar renderer och bildfrekvens, och adressen `http://localhost:5173/?perf=1` (eller ankaret `#perf` efter adressen) visar prestandaöverlägget. Stoppa med Ctrl+C i PowerShell.

Kontrollera att F3 inte säger SwiftShader eller llvmpipe: då skulle webbläsaren rita med processorn i stället för grafikkortet. I Edge/Chrome ska inställningen "Använd grafikacceleration när den är tillgänglig" vara på (Inställningar, System).

## 5. Kör alla tester: `npm run verify:local`

```
npm run verify:local
```

Kommandot kör samma kontroller som molnet (`npm run verify`), men med grafikkortet:

- **gpu**: tar en skärmdump och skriver vilken renderer webbläsaren använde. Står det SwiftShader eller "software" i rapporten används inte grafikkortet.
- **typecheck** och **lint**: kodkontroller.
- **unit**: snabba tester utan webbläsare.
- **perf**: tester av räknetid. De går genom en kalibrering (perfguard) som anpassar gränserna efter hur snabb datorn är; din dator är snabbare än molnet.
- **e2e**: tester i webbläsaren (flera webbläsarfönster samtidigt, antalet väljs efter dina processorkärnor, högst 4) och därefter de som mäter minne och tid, ett i taget.

Under körningen skrivs det som pågår; varje steg har en rubrik som börjar med ===. Räkna med 5 till 15 minuter, första gången kan det ta längre. Rör inte datorn mer än nödvändigt medan det pågår: testerna öppnar osynliga webbläsare och mäter tid.

### Hur du läser slutet

Sist skrivs en tabell. Exempel:

```
PASS     browser and GPU check (one screenshot)   4 s
PASS     typecheck                               9 s
PASS     lint                                    9 s
PASS     unit tests                             40 s
PASS     perf tests                             10 s
PASS     e2e tests                         4 min 10 s
PASS     e2e tests that measure memory      15 s
wall time 6 min 30 s
RESULT: ALL STAGES PASSED
```

- **PASS** är bra. **ALL STAGES PASSED** betyder att allt gick igenom.
- **FAIL** på ett steg betyder att något brast. Loggen för steget ligger i mappen test-results (filer som heter verify-unit.log, verify-e2e.log och så vidare). Skicka rapporten och den loggen.
- **SKIPPED** betyder att webbläsarstegen hoppades över eftersom steget gpu föll (ingen webbläsare hittades, se avsnitt 7).
- Rader som börjar med `[golden] WARN` är **inte fel**. Facit-bilderna i projektet är tagna med programvarurenderaren och ett riktigt grafikkort ritar aldrig exakt samma pixlar. I det här läget varnar jämförelsen bara och bilderna du kan titta på hamnar i mappen test-results/golden (filerna som slutar på .actual.png och .diff.png). Reglerna för pixlar (ljusstyrka, kantkontrast, tomma bilder) gäller fortfarande och kan ge FAIL.

### Skicka rapporten

Efter körningen finns filen `test-results\local-report.txt`. Öppna den i Anteckningar, markera allt, kopiera och klistra in i chatten. Den innehåller dator, processor, grafikkortets renderer, tabellen och perf-raderna. Vill du ha spelets egen prestandarapport: öppna `http://localhost:5173/?perf=1`, spela en stund och tryck **Kopiera rapport** i överlägget (där finns också tiden för simuleringssteg och HUD per bildruta); klistra in den på samma sätt.

## 6. Mindre körningar

- Bara snabbkontrollen: `npm run verify:fast` (typecheck, lint, unit; under en minut).
- En skärmdump och renderern: `npm run shots:local` (det vanliga `npm run shots` är för molnsessionen och använder programvarurenderaren, se nedan). Raden `[shot] renderer:` i utskriften visar vilket grafikkort som användes; skärmdumpen hamnar i `test-results/shots/smoke.png`.

## 7. Om webbläsaren inte hittas eller fel webbläsare används

Skriptet letar efter Chrome eller Edge på de vanliga platserna. Om du har dem någon annanstans, eller vill välja själv, ange sökvägen innan kommandot (PowerShell):

```
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run verify:local
```

(I den gamla kommandotolken cmd heter det `set CHROME_PATH=...`.) Vill du i stället använda Playwrights egen webbläsare: `npx playwright-core install chromium` och ta bort CHROME_PATH (kräver att nedladdningen tillåts i din brandvägg; i molnet är den blockerad).

## 8. Starta en Claude Code-session i mappen

Så att Claude kan läsa rapporten och rätta saker direkt i din kopia:

1. Installera Claude Code: `npm install -g @anthropic-ai/claude-code` (eller följ Anthropics installationsguide om stegen har ändrats), eller öppna mappen Spel i Claude-appen.
2. I PowerShell: `cd` till mappen Spel och skriv `claude`. Logga in med ditt Claude-konto första gången.
3. Skriv till exempel: "Läs test-results\local-report.txt och förklara vad som felade". Claude följer reglerna i `CLAUDE.md`.

Ändringar som sessionen gör ligger bara på din dator tills du eller sessionen skickar dem till GitHub.

## 9. Kända begränsningar (läs gärna)

- **Otestat på riktigt grafikkort.** Ingen har kört lägesbrytaren LOCAL_GPU=1 mot ett riktigt grafikkort, och ingen har kört något av detta på Windows. Enhetstesterna visar att rätt Chromium-flaggor väljs, att webbläsarvägen och antalet processer väljs rätt och att jämförelsen med facit bara varnar. De visar inte att grafikdrivrutinen, headless-läget eller dina sökvägar fungerar.
- **Bildfacit.** De inbyggda facit-bilderna är SwiftShader-bilder (se ovan). Uppdatera dem aldrig härifrån: `UPDATE_GOLDENS=1` vägras i det här läget. Facit uppdateras bara i molnsessionen.
- **Tester kan misslyckas av skäl som bara finns hos dig**: exakta pixelregler som är skrivna för programvarurenderingen, två bilder som inte blir byte för byte lika på ett riktigt grafikkort, eller en sökväg som bara fungerar på Linux. Skicka rapporten så avgör Claude om det är ett fel i testet eller i spelet.
- **Tid och prestanda.** Alla gränser för räknetid går genom perfguard och påverkas inte av grafikkortet. Bildfrekvensen i spelet mäter du själv med F3 eller `?perf=1` (du såg tidigare 30 till 50 bilder per sekund i Artifact-förhandsvisningen).
- **Tester som hoppas över på Windows.** Testerna i `tests/hook.test.ts` kör ett bash-skript för molnsessionen och hoppas över (visas som skipped, inte FAIL) när bash saknas. De fem testfilerna som startar `npm`-skript som barnprocesser startar numera Node direkt och ska därför fungera även på Windows, men det är otestat där. Ett test i `tests/portableSpawn.test.ts` förbjuder `npm`, `npx` och oskyddad `bash` i barnprocesser.
- **Radslut.** Projektet tvingar LF-radslut vid utcheckning (filen `.gitattributes`), så att kontrollsummor stämmer på Windows. Har du klonat före den ändringen: ta bort mappen Spel och klona om (avsnitt 2), annars kan bake:check och några tester klaga på radslut.
- **Drivrutinens prestandatips.** Ett riktigt grafikkort skriver ofta varningen "GL Driver Message (OpenGL, Performance, ...): GPU stall due to ReadPixels" i webbläsarens konsol, eftersom testerna läser tillbaka pixlar med flit. I det här läget räknas den som en anteckning och inte som en varning. Står det i stället "Automatic fallback to software WebGL" används inte grafikkortet (steget gpu faller då, se avsnitt 5).
- **Antivirus och brandvägg** kan störa npm ci eller de osynliga webbläsarna. Tillåt Node.js och webbläsaren om en ruta frågar.
- Datorns kraft: i det här läget kör testsviten antalet processorkärnor delat med två webbläsare samtidigt, högst 4 (på 10 kärnor alltså 4). Vill du välja själv: sätt `$env:E2E_WORKERS = "2"` före kommandot.

Mer om det vanliga flödet (Artifact och lokalt) finns i `docs/PREVIEW.md`; reglerna för tester och tider i `docs/DECISIONS.md` (D144).

# Progress

Resume: Läs CLAUDE.md och docs/PROGRESS.md, kör git log -10 och npm run verify:fast, fortsätt vid första ej avbockade punkten.

## Now

### M00 Grundverktyg, arbetsavtal och WebGL-bevis

GÖR
- [ ] 0. Minimal CLAUDE.md + docs/PROGRESS.md, committa
- [ ] 1. Paket och verktyg (package.json, .nvmrc, .gitignore, tsconfig, lockfile, exakta pinnar, `rm -rf node_modules && npm ci`)
- [ ] 2. Mappskelett
- [ ] 3. ESLint flat config, gränsregler, determinismförbud, lint-självtest
- [ ] 4. Klient-spike (index.html, src/app/main.ts, src/render/spike.ts, ?test=1)
- [ ] 5. scripts/shot.mjs (+ shot.d.mts, analys, golden-regel, heapDelta)
- [ ] 6. tests/perfguard.ts + perf-projekt
- [ ] 7. e2e-tester (smoke, determinism, negativt)
- [ ] 8. npm-scripts (dev, build, preview, typecheck, lint, test, shots, verify:fast, verify)
- [ ] 9. .github/workflows/ci.yml (+ YAML-test)
- [ ] 10. SessionStart-hook
- [ ] 11. Dokument (CLAUDE.md utökad, ARCHITECTURE, PROGRESS, PROMPT_TEMPLATE, BACKLOG, DECISIONS, ASSETS, README, PREVIEW-stub)
- [ ] 12. docs/CHARTER.md ordagrant
- [ ] 13. Mått loggade i PROGRESS.md

ACCEPTANS
- [ ] `npm ci && npm run verify` avslutar med 0 från ren klon; `npm run verify:fast` avslutar med 0
- [ ] Smoke-skärmdump klarar alla assertioner i punkt 5; syntetiska tomma/brus/rutmönster-bilder underkänns
- [ ] Två renderingar i samma start är byte-identiska; mot golden gäller golden-regeln; avsiktligt tom canvas får smoke att fallera
- [ ] Lint-självtest: planterat Math.sin, Math.asin, Math.log2 eller three-import i src/sim fallerar, ren kod passerar
- [ ] perfguard- och heapDelta-testen passerar; CI-filtestet passerar (eller fallbacken använd och dokumenterad)
- [ ] CLAUDE.md < 200 rader och innehåller språkregeln, clean-room, merge-flödet, usage-regeln, tidsregeln, PROMPTLISTA-regeln (exakt en rad), 'Så spelar du'-regeln; PROGRESS.md innehåller resume-raden, Environment- och usage-tabellen
- [ ] Hook-skriptet verifierat enligt punkt 10

## Environment

(filled in below by the preflight)

## Done

## Next

## Known issues

## Skipped

## Usage

| date | after milestone | 5h % | week % | note |
|------|-----------------|------|--------|------|

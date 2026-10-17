# Prompt template

Skeleton for every milestone prompt. The section headings are Swedish on purpose; everything else in the repo is English.

```
[optional user lines, in any order, before the text "Du bygger milestone":
 Usage efter Mxx: 5h NN %, vecka NN %
 Hoppat över: Mxx
 Endast tier 1–2
 Kapa djupet: högst ett justeringspass]

Du bygger milestone Mxx (<title>) i 3D-krigsspelet i det här repot. Svara på svenska; kod, kommentarer, docs och commit-meddelanden på engelska.

LÄS FÖRST
<what to read: CLAUDE.md, docs/CHARTER.md, Now/Next in docs/PROGRESS.md, docs/ARCHITECTURE.md and only the files it points to>

FÖRKONTROLL
<required merged milestones, previous merge SHA (git rev-parse origin/main), environment checks; stop and tell the user if missing>

MÅL
<one paragraph: what the milestone proves or delivers>

GÖR
<numbered deliverables; first step writes GÖR and ACCEPTANS as a checklist under Now in docs/PROGRESS.md; commit and push at each checkpoint>

REGLER, TAL OCH GRÄNSSNITT
<rules, numbers (put tunables in src/sim/rules.ts), interfaces and test hooks>

UTANFÖR OMFATTNING
<what must not be built now>

ARBETSSÄTT
<small steps, npm run verify:fast often, npm run verify before the PR>

ACCEPTANS
<tickable, testable bullets; done = npm run verify green plus these>

SLUT
<update PROGRESS.md, DECISIONS.md, ARCHITECTURE.md; open a DRAFT PR; reply in Swedish with what was done, what deviated, what to test, and "Så spelar du">
```

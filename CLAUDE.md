# CLAUDE.md

Project rules for every session. Keep this file under 200 lines. Constitution: `docs/CHARTER.md`.

## Language
- Reply to the user in Swedish. Code, comments, identifiers, docs and commit messages are in English.
- Exceptions written in Swedish: `docs/PREVIEW.md`, `docs/SERVER.md` (later), `README.md` (bilingual) and the summary at the top of `docs/BALANCE.md` (later).
- Prompt section headings stay Swedish (see `docs/PROMPT_TEMPLATE.md`).

## Clean room (hard invariant)
- The genre is inspired by territory games in the style of OpenFront.io. NO code, names, maps, branding or assets are copied from it or from any other game. All formulas and numbers are our own.
- Zero binary game assets. The only committed binaries are golden PNG fixtures in `e2e/goldens/` and (from M01) baked data packs.
- Other hard invariants (determinism, purity boundary, one balance file, intents only, exact pins, i18n) are in `docs/CHARTER.md` section 2. If a prompt contradicts the charter, stop and ask the user.

## Read order
1. `docs/CHARTER.md`.
2. Now / Next in `docs/PROGRESS.md`.
3. `docs/ARCHITECTURE.md`: an INDEX of modules and public APIs that each milestone's last step keeps current.
4. Only the source files the index points to. Never read whole directories.

## Commands
- `npm ci` installs exactly the locked versions (Node >= 22.13, `.nvmrc` = 22).
- `npm run verify:fast` = typecheck + lint + vitest unit. The inner loop, target <= 60 s.
- `npm run verify` = typecheck + lint + `vitest run --project unit` + `vitest run --project perf --passWithNoTests` + `vitest run --project e2e` (headless WebGL2 shots and goldens). Sequential, never concurrent with another Chromium. Budget <= 8 min; if it grows, shard e2e and note it in `docs/DECISIONS.md`. `verify` is the only definition of done.
- Never run a bare `vitest run` (it would mix the projects).
- `npm test` = unit project, `npm run shots` = smoke screenshot into `test-results/shots/`, `npm run dev|build|preview` = Vite.
- `npm run artifact:pack` (after `npm run build`) = packs `dist` into the gitignored artifact folder for the Claude Artifact preview; options `-- --container=png|wasm|b64 --prev=<file> --probe`. Procedure in `docs/PREVIEW.md`.
- Runtime data and page addresses go through `siteUrl()` in `src/app/paths.ts`, never a hand-written relative or absolute data path and never `BASE_URL`.
- Commands that may exceed 2 minutes run with `run_in_background` and a log file.

## Working rules
- Write GÖR and ACCEPTANS as a tickable checklist under "Now" in `docs/PROGRESS.md` first, and tick items off.
- Commit and push WIP at every green sub-goal. If context or usage runs low, commit and write Now / Next.
- Never weaken or rewrite a test to make it pass. Never delete a test.
- No refactoring outside the deliverables.
- Do not change earlier milestones' tests, tolerances or goldens except where your change provably causes the difference (justify it in `docs/DECISIONS.md`).
- Ideas go to `docs/BACKLOG.md` instead of being built.
- Exact dependency pins, no `^` or `~`; never upgrade a dependency mid-milestone. A changed pin is explained in `docs/DECISIONS.md`.
- Docs may only mention files that exist or are created now; future files are marked "(later)".
- `PROMPTLISTA.md` in the repo root is the user's own prompt list: do not read it, do not change it, do not reference it.

## Time rule
- Never assert SwiftShader wall-clock time. CPU budgets use `tests/perfguard.ts` (`budgetMs(x)`, factor clamped to [0.5, 4] and logged). Never hard-code a ms limit without perfguard.
- Heap and memory asserts use `heapDelta(page, fn)` from `scripts/shot.mjs` (gc before/after, median of 3).
- GPU load is asserted through `renderer.info` counters (calls, triangles, textures), not time.
- `scripts/shot.mjs` logs times; its only hard limit is a 20 s hang guard.

## Test placement, perf and leak rules
- Lint rules apply to the source files in `src/sim`, `src/ai` and `src/data` but NOT to `**/*.test.ts`: all tests live in `tests/` (`tests/sim`, `tests/ai`, `*.perf.test.ts`) or `e2e/`, never next to the sources (vitest include: `tests/**/*.test.ts`, `tools/**/*.test.ts`).
- CPU-budget tests are named `*.perf.test.ts` and run in their own vitest project (pool forks, fileParallelism false, maxWorkers 1). The perf project must always have at least one test.
- Every perf assert uses the median of at least 5 measurements after 2 warm-ups. A p99 requirement applies only where it is stated explicitly, and then over at least 200 samples. `retry: 1` is allowed in the perf project only and is logged. Every budget states its statistic (median or p99).
- Leak tests (all heapDelta / memory measurements in later milestones) render in a 320x180 viewport over 60 render calls (3 rounds x 20), threshold 5 MB, median of 3, and are tagged `leak-test` in the e2e shell.
- Test mode `?test=1`: no rAF loop, fixed seed, DPR 1, 960x540 (override with `w`, `h`), MSAA off, preserveDrawingBuffer, `window.__test = { render(), info() }`. Hooks added by later milestones are listed in `docs/ARCHITECTURE.md`.

## Golden rule
- Goldens (`e2e/goldens/*.png`) are authoritative in the cloud session's `verify`.
- Two renders in one browser start must be byte-identical. Against a committed golden: pixelmatch threshold 0.1 and at most 0.2 % differing pixels (`GOLDEN_MAX_DIFF`, a fraction).
- Update goldens only with `UPDATE_GOLDENS=1`. A missing golden fails with "kör UPDATE_GOLDENS=1 och committa e2e/goldens/*.png".
- CI runs the golden comparison with `GOLDEN_COMPARE=warn` (actual/diff are uploaded as artifacts, the step does not fail); everything else fails CI as usual.
- Never loosen a tolerance silently.

## CI rule and workflow fallback
- `.github/workflows/ci.yml` triggers on `pull_request` (opened, reopened, synchronize, ready_for_review), `workflow_dispatch` and push to main; drafts are skipped; concurrency per ref with cancel-in-progress.
- If CI fails after the user marked the PR ready: read the job log with `get_job_logs`, fix, push, wait for the new run. Never merge red CI.
- If pushing `.github/workflows/*` is refused (the token often lacks `workflow` permission): remove the file from the unpushed commit, move it to `docs/ci/ci.yml.txt` (only when this fallback was used), recommit, push again, and never push `.github/workflows/*` after a refusal. Tell the user exactly how to add it on GitHub (Add file, Create new file, `.github/workflows/ci.yml`, paste) and say which case occurred in `docs/PROGRESS.md`.

## PR and merge flow
- Always open a DRAFT pull request; a draft cannot be merged.
- The user asks the SAME session: "Markera PR:en som redo, vänta på grön CI och squash-merga den till main", or does it on GitHub (Ready for review, green check, Squash and merge).
- If GitHub refuses draft PRs (private repo on a free plan): open an ordinary PR and say so on the FIRST line of the reply; the user then goes straight to Squash and merge.
- No tags and no SHAs cited from the branch (tag only after merge on main, if pushing tags works).
- If you cannot open a PR: push and give `https://github.com/Homerun5320/Spel/compare/main...<branch>?expand=1`.
- Record `git rev-parse origin/main` as the previous merge SHA in `docs/PROGRESS.md` at the start of a milestone.

## Replies
- Every reply after something playable or visible contains a short "Så spelar du" box (5-10 lines: what to click, keys so far) and the exact addresses in the form `docs/PREVIEW.md` specifies for the chosen path (Artifact: the link plus `#mode`, e.g. `#perf`; local / Netlify: `?param=value`), and always how the same mode is reached through the Dev panel (F2).
- A final reply states what was done, what deviated, and exactly what the user should test next.

## User lines
Any of the user's opening lines (those before the text "Du bygger milestone") may be:
- `Usage efter Mxx: 5h NN %, vecka NN %`: add it to the usage table in `docs/PROGRESS.md`.
- `Hoppat över: Mxx`: note it under Skipped in `docs/PROGRESS.md` and count the requirement as met; parts that depend on it are skipped and noted in `docs/DECISIONS.md`.
- `Endast tier 1–2`: stop in M21 after tier 2 and log tier 3 in `docs/BACKLOG.md`.
- `Kapa djupet: högst ett justeringspass`: applies to M19.
The lines may be stacked in any order.

## Compact instruction
When compacting the conversation keep: the current milestone id and branch, the exact state of the Now checklist, the last `verify` / `verify:fast` result, the list of files changed, open decisions, the user lines, and the commands above. Drop file dumps and logs.

## Environment (SwiftShader)
- The cloud container has no GPU: headless Chromium 141 renders WebGL2 in software (SwiftShader). Playwright 1.56.1 matches the installed `chromium-1194`; never upgrade Playwright.
- `scripts/shot.mjs` passes the Chromium switches as an explicit array; `--enable-precise-memory-info` must be its own argument (see `docs/CHARTER.md` section 6).
- Network: npm registry, raw.githubusercontent.com, S3 and `git ls-remote` are reachable; CDNs, github.com web/API and cdn.playwright.dev are blocked. Bundle everything.
- The SessionStart hook (`.claude/session-start.sh`) prints one health line and runs `npm ci` when needed; errors go to `.claude/hook.log`.

## Where things are
- `docs/CHARTER.md` constitution; `docs/ARCHITECTURE.md` module and API index; `docs/PROGRESS.md` state (Done / Now / Next / Known issues / Skipped, Environment, usage); `docs/DECISIONS.md`; `docs/BACKLOG.md`; `docs/ASSETS.md`; `docs/PROMPT_TEMPLATE.md`; `docs/PREVIEW.md` (Swedish preview guide and Artifact update procedure, M00b).
- Later: `docs/SERVER.md`, `docs/BALANCE.md`, `docs/ART.md`, `CREDITS.md` (all "(later)").

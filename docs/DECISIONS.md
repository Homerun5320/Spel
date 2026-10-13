# Decisions

Newest at the bottom. Each entry: what, why.

## M00

### D1 Dependency pins
All pins from the M00 prompt were verified with `npm view <pkg>@<version> version` before installing and none changed: three 0.186.1, @types/three 0.186.0, vite 8.3.4, vitest 5.0.4, typescript 6.0.2, @types/node 22.20.5, @types/pngjs 6.0.5, playwright-core 1.56.1, pixelmatch 8.0.0, fast-check 4.10.2, eslint 10.12.0.
Versions the prompt left open (latest at the time, exact, peer ranges checked): pngjs 7.0.0, yaml 2.9.1, tsx 4.23.15, typescript-eslint 8.71.2 (peer: eslint ^10, typescript <6.1.0), @eslint/js 10.0.1 (peer eslint ^10).
Added beyond the prompt's list: `globals` 17.13.0, because the ESLint config needs node + browser globals for `scripts/**/*.mjs`.
`playwright-core` 1.56.1 matches the installed chromium-1194 (1.56.0 would too). Never upgrade it.

### D2 Spike test view
Camera on the +z axis looking at the origin, distance 4, vertical fov = 2*asin(1/4) = 28.955 degrees, so the globe (radius 1) spans exactly the image height (diameter = 540 px; measured silhouette coverage 44.1 %). +x is to the right. Sun fixed at lon -40, lat 20: direction = (cos20*sin(-40), sin20, cos20*cos(-40)) = (-0.604, 0.342, 0.720), unit length. The lit half is the LEFT image half. (The prompt printed x as -0.49; that is inconsistent with its own formula and with unit length, the formula value is used.) Background is pure black.

### D3 Smoke thresholds
distinct colours >= 50; luma std (Rec. 709 luma, all pixels, 0..255) >= 20 (measured 57.6; flat canvas 0); |luma(centre) - luma(top-left corner)| >= 40 (measured 94); mean luma left half >= 1.15 x right half over pixels with luma > 2 (measured 1.52); silhouette (pixels differing > 4 in any channel from the corner pixel) covers 20-60 % (measured 44.1 %). Synthetic empty, noise and checkerboard images are rejected by unit tests.

### D4 Console allow-list
`ALLOWED_CONSOLE_WARNINGS` in `scripts/shot.mjs` is empty: no console warning or error appeared with Chromium 141 + SwiftShader. Any future entry needs an exact-text match and a justification here. Uncaught page errors count as console errors.

### D5 Chromium launch
Switches are the explicit array from the prompt. `--no-sandbox` is not passed by us: Playwright adds it itself when `chromiumSandbox` is false (the default), and Chromium starts fine as root in the container.

### D6 Goldens
`e2e/goldens/spike-test-view.png` was produced in the cloud session. `GOLDEN_MAX_DIFF` is a FRACTION (0.002 = 0.2 %). Mismatches write `test-results/golden/<name>.actual.png` and `.diff.png`. `GOLDEN_COMPARE=warn` logs instead of failing (also for a missing golden).

### D7 CI
Goldens are authoritative in the cloud session; CI sets `GOLDEN_COMPARE=warn` because a different SwiftShader build on GitHub runners may differ slightly. Everything else fails CI. CI uses the full chromium installed by `npx playwright-core install --with-deps chromium` via `CHROMIUM_PATH`.

### D8 E2E server
e2e starts a Vite DEV server programmatically (free port, HMR off) in `e2e/globalSetup.ts` and provides its URL as `inject('baseUrl')`. The e2e project is also serial (fileParallelism false, maxWorkers 1) so only one Chromium runs at a time.

### D9 verify
`verify` = typecheck + lint + `vitest run --project unit` + `vitest run --project perf --passWithNoTests` + `vitest run --project e2e`. Measured about 15 s in the cloud; no sharding needed. `verify:fast` = typecheck + lint + unit (about 6 s).

### D10 Lint details
The Math allow-list selector bans every other `Math.*` member including constants such as `Math.PI` (use a literal). `globalThis` is banned in src/sim and src/ai (it would bypass the global bans). `crypto` / `node:crypto` imports are banned in the pure folders. Boundary rules (imports, DOM globals) apply to src/sim, src/ai and src/data; determinism rules to src/sim and src/ai only; `**/*.test.ts` is exempt from both.

### D11 Spike behaviour
In normal mode the F3 overlay is shown by default and the sun drifts 12 degrees of longitude per second; in `?test=1` the overlay is hidden and nothing moves. Extra debug/test params: `blank=1` (empty canvas for the negative test), `seed=N`, `w=`/`h=` (canvas size in test mode, used by leak tests at 320x180). Styles and the `lang` attribute are set from JS on a wrapper div, not on `<html>` / `<body>`.

### D12 Perf project
`retry: 1` is set for the perf project; `tests/perf.setup.ts` logs it and warns about every retried test. `silent: false` at the root so perfguard factors, retries and shot metrics are visible for passing tests. perfguard reference: 5 M `Math.imul`/array-write iterations, REFERENCE_MS = 5.5 (median on the authoring sandbox); the per-process calibration is a warm-up plus the median of 3 timings.

### D13 CI file location
See `docs/PROGRESS.md` ("CI workflow") for which case occurred.

### D14 Lint bypass hardening and hook install detection
Determinism lint (`eslint.config.js`, src/sim and src/ai): `Math`, `Object` and `Reflect` may only appear as the object of a member expression. Destructuring, aliasing, assigning, passing, returning or wrapping them (`const { asin } = Math`, `const M = Math`, `(0, Math).sin`, `(Math as T).sin`) fails; a plain property read such as `x.Math` is fine. Allowed Math members must be non-computed (`Math[abs]` fails even if a variable is named abs). `Object.getOwnPropertyNames`, `Object.getOwnPropertySymbols`, `Reflect.ownKeys` and any computed member access on Object / Reflect are banned next to keys / values / entries. Every bypass has a case in `tests/lint.test.ts`. The rules guard against accidents, not against deliberate evasion such as `eval` or the `Function` constructor.
SessionStart hook: a missing hidden lockfile in node_modules (npm writes it last) counts as an incomplete install and triggers `npm ci` (90 s timeout). The report field is "npm ci körd denna session" (ja / nej). After a failed or timed-out `npm ci` the hook removes node_modules so that a half-written tree never looks complete and the next session retries. `tests/hook.test.ts` runs the real script against a stub npm.

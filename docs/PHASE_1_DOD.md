# Phase 1 Definition of Done — criterion by criterion

The Definition of Done is stated in [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md):

> The canonical machine-readable acceptance criteria are in `goals/roadmap.json`.
> Phase 1 additionally requires a public Vercel deployment, a clean production
> build, strict TypeScript, critical unit tests, 375 px validation, intentional
> failure states and manual comparison of at least one or two passes against an
> external trusted predictor. Results must be recorded, never assumed.

`docs/QUALITY_GATES.md` adds an evidence policy: a claim is acceptable only with
an observed command result, CI run, screenshot, PR URL, deployment URL or
structured manual record — and **missing external evidence is an unchecked item,
not a reason to lower the criterion.** This page applies that rule literally.
Two of the seven criteria are not met, and are marked as such.

Evidence below was captured on 2026-09-01 against commit `2dea6d4` plus this
branch's CI change.

## 1. Public Vercel deployment — ❌ NOT MET

No Vercel project is linked to this repository, and deploying requires account
ownership this repository does not have. `goals/roadmap.json` anticipates exactly
this: P1-07's prompt reads *"Deploy only when Vercel ownership is available;
never invent a URL or metrics."*

The application is deployment-ready and the procedure is written down in
[`DEPLOYMENT.md`](./DEPLOYMENT.md); it needs no private runtime key, no database
and no build-time secret. What is missing is the account, not the work.

**To close:** deploy, then record the URL here and in the README, and confirm it
in a signed-out browser.

## 2. Clean production build — ✅ MET

`npm run build` runs as its own required CI job on every pull request and every
push to `main` (`.github/workflows/ci.yml`, job `build`), gated behind lint,
typecheck and unit tests.

## 3. Strict TypeScript — ✅ MET

`tsconfig.json` sets `"strict": true` **and** `"noUncheckedIndexedAccess": true`,
which is stricter than the criterion asks for. `npm run typecheck` (`tsc --noEmit`)
runs in the `quality` CI job. `npm run lint` runs `eslint . --max-warnings=0`, so
a warning fails the build rather than accumulating.

## 4. Critical unit tests — ✅ MET

81 tests across 10 files, all passing. Coverage of the calculation and gateway
layer:

| File | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `lib/propagation.ts` | 100% | 100% | 100% | 100% |
| `lib/sun.ts` | 100% | 100% | 100% | 100% |
| `lib/launches.ts` | 100% | 95.55% | 100% | 100% |
| `lib/tle.ts` | 94.28% | 88.88% | 100% | 100% |
| `lib/passes.ts` | 89.09% | 78.72% | 100% | 95.91% |
| `app/api/tle/[group]/route.ts` | 100% | 90% | 100% | 100% |
| `app/api/launches/route.ts` | 100% | 87.5% | 100% | 100% |
| `app/api/astros/route.ts` | 95.83% | 87.5% | 100% | 95.45% |
| `app/api/apod/route.ts` | 94.28% | 95.12% | 100% | 96.55% |
| **Total** | **96.33%** | **90.38%** | **100%** | **98.5%** |

**Read that total narrowly.** `vitest.config.ts` restricts coverage to the nine
files above — the orbital mathematics and the upstream gateways. React components
and hooks are **not** in the denominator and are covered by end-to-end tests
instead, not by this percentage. A repository-wide number would be lower and would
mean something different.

Two honest gaps in this criterion:

- `lib/passes.ts` has the weakest branch coverage (78.72%) of any file in scope —
  which is notable given it holds the visibility gates.
- `lib/format.ts` has a dedicated test file but is absent from the coverage
  `include` list, so its coverage is neither measured nor thresholded. Tracked as
  a follow-up; the fix is a `vitest.config.ts` change outside this objective's
  allowed paths.

## 5. 375 px validation — ✅ MET

`playwright.config.ts` defines a `mobile-375` project pinned to a 375×812
viewport. `e2e/resilience.spec.ts` asserts `document.body.scrollWidth` never
exceeds the viewport width, including with all three upstream feeds broken —
the state most likely to overflow. Since this branch, the CI `e2e` matrix runs
both `mobile-375` and `desktop-chromium` on every pull request; previously only
the mobile project gated a merge.

## 6. Intentional failure states — ✅ MET

`e2e/resilience.spec.ts` (11 tests) drives each upstream into failure and into
emptiness, and asserts on the surface that **owns** the broken feed:

| Feed | Outage copy | Empty copy | Owning surface |
|---|---|---|---|
| TLE | "Orbital propagation unavailable" | "Acquiring ISS ephemeris" | `.globe-frame` |
| Launches | "Launch feed unavailable" | "No scheduled launches" | Upcoming-missions panel |
| Crew | "CREW DATA OFFLINE" | "0 HUMANS IN SPACE" | `.topbar` |

Each empty-state test also asserts the outage copy is *absent*, so the two states
cannot silently collapse into one another — an outage may not render as "nothing
to show". The suite additionally asserts no uncaught page errors and no
application console errors while a feed is failing.

## 7. Manual pass comparison against an external predictor — ❌ NOT MET

[`PASS_VALIDATION.md`](./PASS_VALIDATION.md) contains a complete record with real,
reproducible ORBITAL output: a fresh CelesTrak element set, a named observer, two
candidate passes with rise/peak/set times and azimuths, and the tolerance band to
judge agreement.

The reference column is empty. `docs/TEST_STRATEGY.md` is explicit — *"Do not mark
the Definition of Done item complete until real observations are entered"* — and
entering numbers from an external predictor is a human step. Producing them any
other way would make the comparison worthless.

**To close:** follow the checklist at the end of `PASS_VALIDATION.md`.

## Roadmap acceptance criteria

The canonical per-objective criteria live in `goals/roadmap.json`. Every Phase 1
objective was merged through its own pull request, each carrying two independent
`APPROVE` verdicts bound to the exact merged commit:

| Objective | PR | Title |
|---|---|---|
| P1-00 | [#24](https://github.com/MertArtun/orbital/pull/24) | Bootstrap reproducible toolchain |
| P1-01 | [#28](https://github.com/MertArtun/orbital/pull/28) | Resilient space-data gateways |
| P1-02 | [#29](https://github.com/MertArtun/orbital/pull/29) | Deterministic ISS propagation and ground track |
| P1-03 | [#30](https://github.com/MertArtun/orbital/pull/30) | Cinematic live ISS globe |
| P1-04 | [#31](https://github.com/MertArtun/orbital/pull/31) | Visible ISS pass prediction |
| P1-05 | [#33](https://github.com/MertArtun/orbital/pull/33) | Live launch mission-control panels |
| P1-06 | [#34](https://github.com/MertArtun/orbital/pull/34) | Resilience, accessibility and mobile gates |

Two roadmap-only pull requests ([#27](https://github.com/MertArtun/orbital/pull/27),
[#32](https://github.com/MertArtun/orbital/pull/32)) widened an objective's allowed
paths. Both were landed separately, before the objective that needed them, rather
than editing the boundary from inside the branch it was constraining.

## Summary

| # | Criterion | Status |
|---|---|---|
| 1 | Public Vercel deployment | ❌ needs account ownership |
| 2 | Clean production build | ✅ |
| 3 | Strict TypeScript | ✅ |
| 4 | Critical unit tests | ✅ |
| 5 | 375 px validation | ✅ |
| 6 | Intentional failure states | ✅ |
| 7 | Manual pass comparison | ❌ needs a human observation |

**5 of 7 met.** Both open items require something outside the repository — an
account and an observation. Neither can be closed by writing more code, and
neither is closed by describing it as closed.

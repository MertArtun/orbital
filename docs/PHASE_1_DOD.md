# Phase 1 Definition of Done — criterion by criterion

The Definition of Done is stated in [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md):

> The canonical machine-readable acceptance criteria are in `goals/roadmap.json`.
> Phase 1 additionally requires a public Vercel deployment, a clean production
> build, strict TypeScript, critical unit tests, 375 px validation, intentional
> failure states and manual comparison of at least one or two passes against an
> external trusted predictor. Results must be recorded, never assumed.

`docs/QUALITY_GATES.md` adds an evidence policy, quoted in full so it is not
softened in the summarising:

> A claim is acceptable only with an observed command result, CI run, screenshot,
> PR URL, deployment URL or structured manual record. Do not fabricate Lighthouse,
> FPS, external-pass accuracy, deployment or accessibility results. **Missing
> external evidence is a blocker or unchecked item, not a reason to lower the
> criterion.**

This page applies that rule literally. One of the seven criteria is not met and
is marked as such — an unchecked item rather than a blocker, because it does not
prevent the remaining work from proceeding, and it is recorded against the
objective in the goal ledger.

Evidence below was captured on 2026-09-01 against commit `2dea6d4` plus this
branch's CI change, with one exception that says so in place: section 1's
evidence is from the deployment on 2026-09-22 and is dated there.

## 1. Public Vercel deployment — ✅ MET

**https://langouste.vercel.app**

Deployed 2026-09-22 from this branch with `vercel --prod`. The repository still
carries no `vercel.json`: Vercel detects Next.js and the defaults are correct.

This section previously recorded an unresolved risk, and the deployment settles
it. CelesTrak refuses connections from GitHub Actions runners — the evidence is
in the header of `.github/workflows/update-fallback-tle.yml` — and nobody had
checked whether it also refuses Vercel's. **It does not.** The closure test this
page specified was the telemetry chip, on the grounds that a moving marker proves
nothing because it moves just as smoothly on a month-old element set. The chip
reads `TLE LOCK`, and `/api/tle/iss` on the deployment returns `"source":"live"`.

What that closes, precisely. The risk as stated was categorical — that a deployed
instance would time out "from every cold function" and serve the fixture
permanently. Two observations from two clients on two days falsify *every*, so the
categorical form is settled. A weaker residual is not, and was never the stated
risk: nothing here rules out regional or intermittent refusal, because these are
observations of one deployment reached from one network. The distinction is
between a settled risk and a settled claim about a risk, and this page is the one
that has to hold it.

The checks in [`DEPLOYMENT.md`](./DEPLOYMENT.md) were run against the live site
rather than assumed, driving the Playwright chromium this repository already
installs:

| Check | Observed |
|---|---|
| Telemetry chip | `TLE LOCK` — not `CACHED TLE`, not `REPO TLE` |
| Globe renders, marker moves | marker displaced over a 12 s window |
| Pass panel under geolocation | source reads `GPS` when granted, `CITY` when denied; passes render in both |
| Launch countdown | decrements between samples, never `T−--:--:--:--` |
| 375 px | `scrollWidth` equals `clientWidth`; no horizontal scrolling |
| Browser console | clean, desktop and 375 px |

One caveat worth stating rather than discovering: a first load can paint `REPO
TLE` for a moment before the upstream fetch resolves, then settle to `TLE LOCK`.
The first observation of this deployment caught exactly that and was re-checked
rather than recorded.

## 2. Clean production build — ✅ MET

`npm run build` runs as its own CI job on every pull request and every push to
`main` (`.github/workflows/ci.yml`, job `build`), gated behind lint, typecheck and
unit tests.

Calling it *required* would overstate it today: `main` has no branch protection
(`gh api repos/MertArtun/orbital/branches/main/protection` returns 404), so every
check is currently advisory and nothing mechanically prevents a merge past a red
build. `npm run setup:github -- --protect-main` is what makes them required, and
this release repairs the check names it requests so that command now names jobs
that actually report.

## 3. Strict TypeScript — ✅ MET

`tsconfig.json` sets `"strict": true` **and** `"noUncheckedIndexedAccess": true`,
which is stricter than the criterion asks for. `npm run typecheck` (`tsc --noEmit`)
runs in the `quality` CI job. `npm run lint` runs `eslint . --max-warnings=0`, so
a warning fails the build rather than accumulating.

## 4. Critical unit tests — ✅ MET

The unit suite covers the calculation and gateway layer, and it passes. Counts
and percentages are deliberately not written here.

Run `npm run test:coverage`. It prints the file count, the test count and a
per-file table in a few seconds, and `coverage/coverage-summary.json` carries
the same numbers as data.

`vitest.config.ts` restricts the coverage denominator to ten files — the
orbital mathematics (`propagation`, `passes`, `sun`, `tle`, `starlink`,
`launches`) and the four upstream gateways. CI fails below 80% of lines,
statements and functions and 70% of branches; every one of the ten currently
clears all four, and the totals sit well above them.

**Read whatever that command prints narrowly.** React components and hooks are
**not** in the denominator; they are covered by end-to-end tests instead. A
repository-wide number would be lower and would mean something different.

Two honest gaps in this criterion:

- `lib/passes.ts` has the weakest branch coverage of any file in scope — notable
  given it holds the visibility gates. The figure is in the command's output
  rather than here, for the reason the section above gives.
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

## 6. Intentional failure states — ✅ MET, with one documented exception

`e2e/resilience.spec.ts` drives each upstream into failure and into
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

**One state does collapse, and it is not covered above.** The crew chip conflates
*loading* with *outage*: `components/dashboard/TopBar.tsx` renders
`astros ? '… HUMANS IN SPACE' : 'CREW DATA OFFLINE'`, and `OrbitalDashboard.tsx`
passes it only `astros` and `source` — `useAstros`'s `isLoading` is computed but
never reaches it. A visitor whose first crew request is merely slow is told the
feed is offline, using the exact string `e2e/resilience.spec.ts` asserts for a
*failed* feed.

This violates the `CLAUDE.md` invariant that loading, stale, empty and error are
intentional UI states — a state that cannot be distinguished from another is not
intentional. Found by `qa-gatekeeper` on this objective by stubbing `/api/astros`
to succeed after four seconds and reading the top bar mid-flight. The launch panel and the
globe both separate the two states properly, so this is one surface of three.
Fixing it means passing `isLoading` through to `TopBar` and giving it distinct
copy, which is `components/**` and `hooks/**` — outside this objective's allowed
paths. Recorded as a follow-up rather than quietly left out of the description.

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

The canonical per-objective criteria live in `goals/roadmap.json`. Seven of the
eight Phase 1 objectives are merged; the eighth is this release. Each merged one
went through its own pull request carrying two independent `APPROVE` verdicts
bound to the exact commit that was merged:

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
| 1 | Public Vercel deployment | ✅ |
| 2 | Clean production build | ✅ |
| 3 | Strict TypeScript | ✅ |
| 4 | Critical unit tests | ✅ |
| 5 | 375 px validation | ✅ |
| 6 | Intentional failure states | ✅ except the crew chip's loading state |
| 7 | Manual pass comparison | ❌ needs a human observation |

**5 of 7 met.** Both open items require something outside the repository — an
account and an observation. Neither can be closed by writing more code, and
neither is closed by describing it as closed.

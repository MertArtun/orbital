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
permanently. Several independent fetches succeeded, including three with the edge
cache deliberately bypassed so that each one forced a real upstream request, and
that falsifies *every*. A weaker residual is not settled, and was never the stated
risk: nothing here rules out regional or intermittent refusal. Every one of these
observations is from 2026-09-22 and from one network, so what carries the argument
is that some cold invocations demonstrably reached CelesTrak — not elapsed time and
not geographic spread, neither of which this page has. The distinction is between a
settled risk and a settled claim about a risk, and this page is the one that has to
hold it.

The checks in [`DEPLOYMENT.md`](./DEPLOYMENT.md) were run against the live site
rather than assumed, driving the Playwright chromium this repository already
installs:

| Check | Observed |
|---|---|
| Telemetry chip | `TLE LOCK` — not `CACHED TLE`, not `REPO TLE` |
| Globe renders, marker moves | 4.44° N / 161.33° W → 1.43° N / 159.20° W over 60.0 s |
| Pass panel under geolocation | source reads `GPS` when granted, `CITY` when denied; passes render in both |
| Launch countdown | decrements between samples, never `T−--:--:--:--` |
| 375 px | `scrollWidth` equals `clientWidth`; no horizontal scrolling |
| Browser console | clean, desktop and 375 px |

Check 2 specifies a full minute, so it was run for one: the coordinates above are
sixty seconds apart, and the table records what was observed rather than a shorter
substitute.

One observation from the first check is left unexplained rather than smoothed over.
That load appeared to show `REPO TLE`, and an earlier draft of this section
explained it as a first-paint artifact that settles once the fetch resolves. That
explanation is false. The pre-resolution chip is `ACQUIRING`: `tleStatus` falls
through to it whenever the source is still `null`, and `useIssTracking` seeds the
source as `null` with no `fallbackData` and no persisted SWR cache to replay an
earlier value. `REPO TLE` requires a *resolved* envelope whose source is
`repository-fallback`.

So the reading was either a genuine fallback — that invocation really did serve the
committed fixture — or a misreading of `ACQUIRING`. Nothing was captured at the
time, so this page cannot say which, and it will not guess a second time. The
residual above therefore stands exactly as stated: intermittent fallback is **not
ruled out**, not observed. Had the fallback been confirmed, that sentence would have
had to say "observed" instead, which is why the weaker wording is deliberate rather
than an oversight.

## 2. Clean production build — ✅ MET

`npm run build` runs as its own CI job on every pull request and every push to
`main` (`.github/workflows/ci.yml`, job `build`), gated behind lint, typecheck and
unit tests.

Calling it *required* would overstate it today: `main` has no branch protection
(`gh api repos/MertArtun/orbital/branches/main/protection` returns 404), so every
check is currently advisory and nothing mechanically prevents a merge past a red
build. `npm run setup:github -- --protect-main` is what makes them required, and
P1-07 ([#36](https://github.com/MertArtun/orbital/pull/36)) repaired the check
names it requests, so that command now names jobs that actually report.

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

The canonical per-objective criteria live in `goals/roadmap.json`. All eight
Phase 1 objectives are merged; this release is P3-03, the last of Phase 3. Each
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
| P1-07 | [#36](https://github.com/MertArtun/orbital/pull/36) | Ship portfolio-ready MVP and deployment evidence |

Three roadmap-only pull requests ([#27](https://github.com/MertArtun/orbital/pull/27),
[#32](https://github.com/MertArtun/orbital/pull/32),
[#35](https://github.com/MertArtun/orbital/pull/35)) widened an objective's allowed
paths. Each was landed separately, before the objective that needed it, rather than
editing the boundary from inside the branch it was constraining.

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

**6 of 7 met.** The one open item requires something outside the repository — an
observation. It cannot be closed by writing more code, and it is not closed by
describing it as closed.

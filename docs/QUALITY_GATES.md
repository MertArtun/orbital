# Quality gates

## Every objective

- exact objective branch and allowed-path ownership check
- red/green evidence for every objective marked `tddRequired`, with red recorded before green
- ESLint with zero warnings
- strict TypeScript
- focused and related unit tests
- no tracked secrets and no destructive Git actions
- the first-load byte budget, via `node scripts/check-bundle-budget.mjs` after the build, in the local verification matrix and in CI's `build` job — exact for a given compressor, unlike the timings in `docs/perf/`, which are reported and never gated (ADR 0009). Raw byte counts reproduce anywhere; the gzip figures are a property of the zlib the runner ships, and there are now two runners — `.nvmrc` pins only Node's major version, so a patch bump can move the gated figure with no repository change. The spread between zlib versions has been measured at a fraction of a percent on one unchanged build, against kilobytes of headroom. It cannot flip the gate; it can make two green runs disagree on the number, which is worth knowing before anyone treats the figure as a fingerprint. The measured delta is deliberately not quoted here: it is a property of whichever two zlib versions happened to be installed on one machine on one day, so nothing regenerates it and nothing would notice it going stale.
- `npm run verify` guards the commit, not the files. `scripts/verify.mjs` records `HEAD` before the matrix and exits `Verification invalidated: Git HEAD changed while checks were running` if it moved; it captures no working-tree state, so a tracked file edited while the checks run is never detected and the report still records `passed: true`. `scripts/ship-pr.mjs` requires a clean tree and reruns the matrix before shipping, which narrows the window rather than closing it — the rerun has the same gap. A whole-tree digest is not a one-line fix: `restoreGeneratedNextEnv()` rewrites the generated `next-env.d.ts` during the run and would trip it. Found in P3-03 and left unfixed, because `scripts/**` was outside that objective's allowed paths.
- `qa-gatekeeper` plus `pr-reviewer` `APPROVE` verdicts bound to the exact current commit SHA
- current `origin/main` ancestry, linked roadmap issue when present, normal PR checks, squash merge and branch deletion

## Phase 1 final gate

```bash
npm run verify
npm run test:e2e -- --project=desktop-chromium
npm run test:e2e -- --project=mobile-375
git diff --check
```

Manual checks: current Chrome/Safari-class browser, geolocation allow/deny, reduced motion, all upstreams disabled, keyboard traversal, launch-pad focus, ISS telemetry action, clean console and public Vercel URL.

## Evidence policy

A claim is acceptable only with an observed command result, CI run, screenshot, PR URL, deployment URL or structured manual record. Do not fabricate Lighthouse, FPS, external-pass accuracy, deployment or accessibility results. Missing external evidence is a blocker or unchecked item, not a reason to lower the criterion.

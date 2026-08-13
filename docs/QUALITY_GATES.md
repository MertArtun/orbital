# Quality gates

## Every objective

- exact objective branch and allowed-path ownership check
- red/green evidence for every objective marked `tddRequired`, with red recorded before green
- ESLint with zero warnings
- strict TypeScript
- focused and related unit tests
- no tracked secrets and no destructive Git actions
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

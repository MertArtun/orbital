---
name: verify
description: Run ORBITAL quality gates and produce an evidence-based pass/fail report.
---
Run `npm run verify`. For a UI objective also run `npm run test:e2e -- --project=mobile-375` and inspect console errors. Map each acceptance criterion to observed evidence. Return PASS only when every required command exits zero and no blocking manual check remains. Do not fix code while acting as an independent gatekeeper; return actionable findings.

# Starter package validation record

This file separates checks actually executed while assembling the starter from checks that require the installed dependency graph, a browser, GitHub, or Vercel.

## Executed before packaging

- all tracked JSON parsed successfully
- all GitHub workflow and issue-template YAML parsed successfully
- every Node `.mjs` file passed `node --check`
- `scripts/init-repo.sh` passed `bash -n`; the texture generator passed Python bytecode compilation
- Claude agent/skill frontmatter and Markdown code fences were structurally checked
- application, test, and worker TypeScript passed a strict dependency-stub compile (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`)
- dependency-independent runtime smoke checks covered TLE parsing/rejection, solar geometry, launch normalization and coordinate bounds, countdowns, and formatting
- a clean extracted copy produced exactly three meaningful baseline commits with no untracked files
- roadmap IDs, branches, dependencies, and ordering were machine-validated
- autonomous dry-run left the local goal ledger byte-for-byte unchanged
- safety hooks rejected force push, tracked-work discard, forced branch/stash deletion, repository deletion, destructive GitHub API calls, Vercel deletion, and bulk `find -delete`
- automation smoke tests rejected stale review SHAs, incomplete verification matrices, missing RED/GREEN evidence, out-of-scope paths, non-conventional commits, fake merge completion, and work based on an unmerged objective

## Deferred to P1-00 and CI — since discharged

Everything above is a frozen record of what the assembly environment could and
could not verify. It could not reach the npm registry, so it claimed no real
dependency install, Next.js production build, Vitest result, Playwright result,
browser screenshot, Lighthouse score, GitHub PR, Vercel deployment or external
pass comparison.

P1-00 discharged that debt: `package-lock.json` was generated with a real npm
installation and committed in PR #24, and the baseline matrix below has run in
CI on every pull request since. The Vercel deployment was outstanding and is now
live at https://langouste.vercel.app, with its post-deploy checks run rather than
assumed. No Lighthouse report exists and none is planned: ADR 0009 explains why
a score cannot be produced honestly here, and gates bytes instead. The external
pass comparison remains outstanding and has a prepared record awaiting human
observation in `docs/PASS_VALIDATION.md`.

The baseline matrix P1-00 was created to run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
node scripts/doctor.mjs --ci
```

Subsequent objectives and GitHub CI repeat the relevant gates, including `npm run test:coverage` and the Playwright suite. Missing external evidence remains incomplete; the automation is not permitted to fabricate it.

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

## Intentionally deferred to P1-00 and CI

The assembly environment could not reach the npm registry, so it did **not** claim a real dependency install, Next.js production build, Vitest result, Playwright result, browser screenshot, Lighthouse score, GitHub PR, Vercel deployment, or Heavens-Above comparison.

The first roadmap objective exists specifically to generate `package-lock.json` with the user's npm installation and run the real baseline matrix:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
node scripts/doctor.mjs --ci
```

Subsequent objectives and GitHub CI repeat the relevant gates. Missing external evidence remains incomplete; the automation is not permitted to fabricate it.

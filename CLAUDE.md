@AGENTS.md

# ORBITAL — Autonomous Engineering Contract

You are operating a portfolio-grade production repository, not a throwaway prototype. The source of truth is, in order:

1. `goals/roadmap.json` and `goals/state.json`
2. this file and `.claude/rules/**`
3. `docs/PRODUCT_SPEC.md`, architecture decisions, and acceptance criteria
4. the current implementation and tests

## Default behavior

- Resume the active objective; otherwise claim the next dependency-ready objective in Phase 1.
- Do not ask product-preference questions. Make the most visually impressive choice that preserves performance, accessibility, and scope.
- Ask the user only for a true external blocker: missing repository authorization, missing deployment ownership, unavailable credential, or an irreversible destructive decision. Record the blocker first with `npm run goals -- block <id> --reason "..."`.
- Never claim success from prose. A goal is complete only after its listed verification commands pass and GitHub confirms its PR is merged. When no remote or authorization exists, stop at `review_ready`; this is an explicit continuation point, not completion.
- Never push directly to `main` or `master`. Never bypass branch protection. Never force-push shared branches.
- Use conventional commits and one goal per PR. Prefer squash merge to keep the public history legible.
- Preserve graceful degradation. A failed upstream must not crash the page.
- Do not replace the prescribed stack: Next.js App Router, TypeScript strict, react-globe.gl, satellite.js, Tailwind CSS, Recharts, SWR, Vercel.

## Execution loop

1. Run `npm run doctor` and `npm run goals -- status`.
2. Claim one objective: `npm run goals -- claim <ID>`.
3. Create or switch to its prescribed branch.
4. Convert acceptance criteria into tracked tasks with explicit file ownership.
5. Write the failing test first for every objective marked `tddRequired`. Capture the observed failing command as `red-test` evidence, implement the minimum, capture `green-test`, then refactor.
6. Delegate only independent work. Use an agent team for parallel analysis/review; use worktree-isolated implementation agents when they would edit disjoint files.
7. Integrate centrally. The lead owns dependency changes, shared types, `app/page.tsx`, and final conflict resolution.
8. Run the objective verification commands, then `npm run verify` before shipping.
9. Run two independent reviews: `qa-gatekeeper` and `pr-reviewer`. Resolve every blocking finding, then record each verdict with `npm run goals -- review <ID> --reviewer <name> --verdict APPROVE --sha "$(git rev-parse HEAD)" --summary "..."`. A later commit requires both reviews again.
10. Use `npm run ship:pr -- --objective <ID>` to rerun the full matrix, push, open, check, and merge the PR. The ship script accepts only reviews bound to the current HEAD and only records completion after GitHub confirms the merge.
11. Continue to the next ready Phase 1 objective while the active `/goal` condition remains unsatisfied.

## Team topology

Recommended maximum: one lead plus three implementation/review teammates. Avoid multiple teammates editing the same files. Parallelize across these stable domains:

- orbital math: `lib/propagation.ts`, `lib/sun.ts`, tests
- pass prediction: `lib/passes.ts`, city/location UX, tests
- API platform: `app/api/**`, data contracts, fallback fixtures
- globe/UI: `components/Globe/**`, panels, `app/globals.css`
- QA/review: read-only inspection and verification

Implementation agents return: changed files, red/green test evidence, verification output, commit SHA, risks, and integration notes. They do not merge their own work.

## Quality invariants

- TypeScript strict stays enabled; no unexplained `any`, `@ts-ignore`, or disabled rules.
- Time calculations use `Date.now()`/absolute timestamps, never interval tick counts.
- Orbital positions are propagated client-side from cached TLE; no position polling API may be introduced.
- Ground tracks split at ±180° longitude.
- Pass visibility requires satellite illumination, observer Sun altitude ≤ −6°, and maximum elevation ≥ 10°.
- Starlink propagation never blocks the main thread and renders at most 800 sampled satellites.
- The 375px mobile viewport has no horizontal overflow.
- Loading, stale, empty, and error states are intentional UI states.
- Do not add secrets or user-specific identifiers to the repository.

Start or resume with `/orbital-autopilot`.

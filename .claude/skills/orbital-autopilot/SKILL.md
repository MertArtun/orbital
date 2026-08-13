---
name: orbital-autopilot
description: Resume ORBITAL and autonomously complete dependency-ready roadmap objectives through TDD, independent review, PR, and GitHub-confirmed merge.
---
# ORBITAL autopilot

Execute, do not merely propose.

1. Run `npm run doctor` and `npm run goals -- status`. Resume the active objective; otherwise claim the next dependency-ready Phase 1 objective.
2. If dependencies are not installed, run `npm install --no-audit --no-fund`. Commit the generated lockfile only on the objective branch and within its allowed scope.
3. Fetch `origin/main` when available, create/switch to the exact roadmap branch from an up-to-date base, and never work directly on `main`.
4. Read the objective prompt, acceptance criteria, `allowedPaths`, `tddRequired`, verification commands, product spec, and relevant ADRs.
5. Ask `orbital-architect` for a read-only implementation map when the objective crosses more than one layer.
6. Create a task dependency graph. Every task states owner, allowed files, dependency, test-first requirement, and done evidence.
7. Delegate at most two disjoint implementation tasks. Use worktree-isolated agents; run `node scripts/prepare-worktree.mjs` in each worktree before tests. Keep dependency changes, shared types, `app/page.tsx`, and integration with the lead.
8. For every `tddRequired` objective, write the smallest meaningful failing test first. Immediately record the observed failure with `npm run goals -- evidence <ID> --kind red-test --value "<command + failure>"`. Implement the minimum, rerun, and record `green-test` evidence before refactoring.
9. Commit coherent changes with conventional messages. Reject or rework any patch outside the objective's allowed paths. Integrate centrally and keep the worktree clean.
10. Run every objective verification command, then `npm run verify -- --objective <ID>`. For UI objectives, run desktop/mobile Playwright and retain current screenshot artifacts.
11. Run `qa-gatekeeper` and `pr-reviewer` independently against the exact current HEAD. Resolve all blocking findings, rerun affected checks, then record structured approvals with `npm run goals -- review <ID> --reviewer <name> --verdict APPROVE --sha "$(git rev-parse HEAD)" --summary "..."`. A fix commit requires both reviews again.
12. Run `npm run ship:pr -- --objective <ID>`. Do not bypass GitHub checks. Only a GitHub-confirmed merged PR marks the objective complete and unlocks dependencies.
13. Continue while the active `/goal` condition is unmet. Stop only after the requested phase is complete or a hard external blocker/review-ready continuation point is recorded.

When a reversible product decision is ambiguous, choose the visually strongest option that preserves performance, accessibility, resilience, and objective scope. Document the decision in the PR; do not ask the user.

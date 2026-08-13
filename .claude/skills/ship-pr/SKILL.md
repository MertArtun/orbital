---
name: ship-pr
description: Enforce the objective boundary, verify the exact HEAD, push, create a complete PR, watch checks, squash merge, and synchronize roadmap state.
argument-hint: "<objective-id>"
---
# Ship one objective PR

Run `npm run ship:pr -- --objective $ARGUMENTS` only after the objective branch is ready.

The ship gate must prove all of the following rather than trusting prose:

1. The current branch exactly matches the roadmap branch and is not `main`/`master`.
2. Every committed path is covered by the objective's `allowedPaths` globs.
3. Every objective commit has a conventional subject.
4. Objectives marked `tddRequired` have chronological `red-test` then `green-test` evidence.
5. `qa-gatekeeper` and `pr-reviewer` both recorded `APPROVE` for the exact current `git rev-parse HEAD`; any later commit invalidates both approvals.
6. The objective-specific verification matrix and the repository baseline complete on the same unchanged HEAD.
7. The worktree is clean and `origin/main` is an ancestor of the branch before push.

Fill the PR body with user impact, architecture, acceptance mapping, commits, changed files, RED/GREEN evidence, observed commands, independent reviews, screenshots for UI work, failure behavior, and risks. Link the roadmap issue when present. Never use admin bypass or force push.

When the remote, GitHub CLI, or authorization is unavailable, record `review_ready` with exact continuation commands. `review_ready` is not a merge and must never unlock a dependent objective.

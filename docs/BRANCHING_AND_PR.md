# Branching and PR narrative

Each roadmap objective owns exactly one branch and public PR. The roadmap prescribes branch names and allowed path globs so the local goal ledger, CI and GitHub history agree. The ship gate rejects committed files outside that objective boundary, non-conventional subjects, stale review verdicts, incomplete objective verification, and branches not based on current `origin/main`.

## Commit shape

Use a few independently meaningful conventional commits. A strong logic objective often has:

1. `test: define visible ISS pass invariants`
2. `feat: implement observer pass prediction`
3. `refactor: isolate solar visibility gates`
4. `docs: record prediction validation procedure`

Do not split every file into a commit or hide unrelated cleanup in the feature.

## PR body

Explain user value, architecture, acceptance mapping, red/green commands, full verification, screenshots for UI work, stale/failure behavior, review verdicts and known approximation/risk. Link the objective ID in plain text. `setup:github` publishes deterministic roadmap issues, and the ship script adds `Closes #…` only when the matching issue exists and remains open.

## Merge

Require CI and resolved conversations. Before shipping, both independent reviewers must approve the exact current commit SHA; any fix commit invalidates prior approvals. Use squash merge and delete the objective branch. Do not use admin bypass. The local goal ledger is ignored and marks an objective complete only after querying GitHub and confirming the merged PR and merge SHA; the public record remains the PR and check suite.

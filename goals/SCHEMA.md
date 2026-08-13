# Goal state contract

`roadmap.json` is immutable, tracked product intent. `state.json` is an ignored local execution ledger seeded from `state.example.json` and must be changed through `node scripts/goals.mjs`.

Statuses: `pending` → `in_progress` → `verified` → `pr_open` → `complete`. A locally verified objective may enter `review_ready` when its remote or GitHub authorization is unavailable. A goal may enter `blocked` from any non-complete state; unblocking restores its previous state when possible.

Evidence entries always include `{ kind, value, at }`. Verification evidence also stores the verified Git commit SHA. Structured review evidence stores `{ reviewer, verdict, sha, summary }`; `scripts/ship-pr.mjs` accepts only `APPROVE` verdicts from every required reviewer for the exact current HEAD. A later commit therefore invalidates stale approvals. Other common kinds are `red-test`, `green-test`, `screenshot`, `pr`, `merge`, and `blocker`. Objectives marked `tddRequired` cannot ship without chronological red/green evidence. Do not store secrets, large command logs, or fabricated URLs.

`complete` is not a prose assertion: the goal CLI queries GitHub and records it only when the referenced PR is actually merged and its merge SHA matches. Dependencies are satisfied only by `complete` objectives. This prevents the next branch from being based on an unmerged PR.

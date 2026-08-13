---
name: review
description: Perform independent QA and code review against the active roadmap objective.
---
Read the active objective and diff from its merge base. Run `qa-gatekeeper` and `pr-reviewer` as independent agents. Consolidate duplicates without hiding disagreement. Resolve every blocking finding, rerun focused checks, then ask the reviewers to verify the resolution. Bind each final verdict to the exact reviewed commit. Record it with `npm run goals -- review <ID> --reviewer qa-gatekeeper --verdict APPROVE --sha "$(git rev-parse HEAD)" --summary "..."` and the corresponding `pr-reviewer` command. Any subsequent commit invalidates the approvals and requires re-review.

# Agent team discipline

Use a team only when at least two workstreams are independent and communication between them is useful. Keep the team to lead plus at most three teammates. Before spawning, define deliverable, owner, allowed paths, dependencies, verification, and return format. Do not assign the same path to multiple editors.

Read-only architect/reviewer teammates may share the main worktree. Editing agents should use isolated worktrees and return commit SHAs. The lead cherry-picks or integrates after review. Teammates must not modify shared goal state, merge PRs, change dependencies, or broaden scope without lead approval.

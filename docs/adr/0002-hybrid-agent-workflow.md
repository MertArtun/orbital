# ADR 0002: Hybrid agent teams and worktree-isolated implementers

**Status:** accepted

## Context

Parallel agents can accelerate independent work but overlapping edits create conflict noise and weaken accountability. Reviews benefit from communication; focused patches mostly need isolation.

## Decision

Use a single lead as integration/PR owner. Use an agent team for read-only architecture, QA and code review or clearly disjoint collaborative work. Use worktree-isolated subagents for implementation patches, with explicit allowed paths and returned commit SHAs. Limit concurrency to lead plus three teammates.

## Consequences

The workflow preserves independent review and speed while reducing merge conflict risk. It is resilient if experimental team support is unavailable because implementation roles can run sequentially as normal subagents.

# Agent Map

This repository supports both Claude Code subagents and experimental agent teams. The canonical agent definitions live in `.claude/agents/`.

## Operating model

| Role | Mutates code | Isolation | Primary responsibility |
|---|---:|---|---|
| `orbital-lead` | yes | main worktree | objective selection, integration, PR ownership |
| `orbital-architect` | no | shared | dependency graph, contracts, ADR consistency |
| `propagation-engineer` | yes | worktree | TLE parsing, SGP4 propagation, tracks, Sun state |
| `pass-prediction-engineer` | yes | worktree | 72-hour passes, visibility gates, location UX |
| `api-platform-engineer` | yes | worktree | server proxies, caching, stale/fallback behavior |
| `globe-visual-engineer` | yes | worktree | 3D globe, animation, glass UI, responsive polish |
| `starlink-performance-engineer` | yes | worktree | worker batching, sampling, time controls |
| `qa-gatekeeper` | no | shared | tests, accessibility, resilience, mobile checks |
| `pr-reviewer` | no | shared | independent code/security/performance review |
| `release-manager` | yes | worktree | CI, Vercel, release docs, portfolio evidence |

## Coordination rules

The lead creates a task graph before delegation. Every task has one owner and an explicit path boundary. Shared files (`package.json`, lockfile, shared types, root configuration, roadmap state) remain lead-owned unless reassigned in writing. Teammates must message the lead before crossing ownership boundaries.

Agent teams are reserved for work where participants need to compare findings or coordinate. A focused implementation that only needs to return a patch should use a worktree-isolated subagent. This hybrid model reduces merge conflicts while retaining independent review.

No agent may mark a goal complete directly by editing `goals/state.json`; use `npm run goals -- ...` so the audit trail remains structured.

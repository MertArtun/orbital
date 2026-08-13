# Claude Code setup

## Project files

- `CLAUDE.md`: always-loaded engineering contract.
- `.claude/settings.json`: lead agent, auto permission mode, team flag, allow/deny rules and hooks.
- `.claude/agents/*.md`: reusable project subagents/team roles.
- `.claude/rules/*.md`: global and path-scoped constraints.
- `.claude/skills/*/SKILL.md`: `/orbital-autopilot`, `/phase`, `/tdd`, `/verify`, `/review`, `/ship-pr`, `/resume`, `/visual-audit`.
- `goals/roadmap.json`: machine-readable objectives, dependencies, paths and acceptance.
- `goals/state.json`: local ignored run ledger.

## Modes

```bash
npm run claude:auto
npm run autopilot -- --phase phase-1 --once
npm run autopilot -- --phase phase-1
```

The default project agent has an `initialPrompt`, so a normal project session begins by resuming or claiming Phase 1. To inspect without executing, invoke the read-only `orbital-architect` agent explicitly.

## Hooks

- `SessionStart`: injects branch and active/next objective context.
- `PreToolUse/Bash`: blocks direct-main commits/pushes, force/destructive Git, remote-script piping, package publishing and likely secret staging.
- `TaskCompleted`: blocks task completion when the fast verification matrix fails.
- `Stop`: blocks premature exit while an objective is active; it yields only for a recorded blocker, review-ready handoff, open PR, or completed objective.

Hooks complement permissions; they are not a substitute for repository branch protection and CI.

## Agent teams versus subagents

Use agent teams for independent analysis/review that benefits from messaging. Use worktree-isolated subagents for patches. Keep at most three teammates plus the lead and never assign overlapping edit paths. Agent team support is experimental, so the workflow remains functional as sequential worktree subagents if teams are unavailable.

---
name: phase
description: Execute a specific roadmap phase in dependency order. Argument is a phase ID such as phase-1.
argument-hint: "<phase-id>"
---
Run `npm run autopilot -- --phase $ARGUMENTS` semantics inside the current interactive session: select only objectives in the requested phase, honor dependencies, and process them one at a time through branch, TDD, review, verification, PR, and merge. For an explicitly requested whole-roadmap run, mirror `npm run mission`; advance phases only after every objective in the current phase is GitHub-confirmed complete. Never begin a later objective from an unmerged base. At the phase boundary, run full verification and write an evidence summary to the phase PR/release notes.

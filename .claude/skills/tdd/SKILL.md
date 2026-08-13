---
name: tdd
description: Apply strict red-green-refactor to the requested behavior and preserve command evidence.
argument-hint: "<behavior or objective>"
---
Identify the narrow behavior in `$ARGUMENTS`. Write the smallest meaningful test at the correct seam. Run it and confirm the failure is caused by missing/incorrect behavior. Implement the minimum, rerun green, refactor, and rerun the focused plus related suite. Report the exact red and green commands. Never weaken existing assertions or coverage.

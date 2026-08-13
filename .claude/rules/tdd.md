---
paths:
  - "lib/**/*.ts"
  - "app/api/**/*.ts"
  - "hooks/**/*.ts"
---
# TDD protocol

For behavioral changes: write or modify the smallest failing test, run it and retain the red output, implement the minimum passing behavior, run green, then refactor and run the relevant suite again. A test that passes before implementation is not red evidence. Avoid snapshots for orbital logic. Mock network boundaries, not pure calculations. Regression fixes require a test that would fail on the previous code.

Record the exact command plus observed failure/success through `npm run goals -- evidence <ID> --kind red-test|green-test --value "..."`. The PR ship gate requires red before green for every roadmap objective marked `tddRequired`.

No `.skip`, `.only`, relaxed thresholds, broad type casts, or deleted assertions to pass a gate without an explicit documented reason.

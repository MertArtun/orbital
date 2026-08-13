---
paths:
  - "lib/propagation.ts"
  - "lib/passes.ts"
  - "lib/sun.ts"
  - "lib/*.test.ts"
---
# Orbital math rules

Use deterministic UTC dates in tests. Test physical invariants and boundary behavior rather than exact floating-point coordinates unless a trusted fixture establishes tolerance. Reject invalid satellite.js results. Longitudes are normalized to `[-180, 180)`. Split ground tracks whenever adjacent longitudes differ by more than 180 degrees.

A visible pass requires all three gates: maximum elevation ≥10°, satellite illuminated, observer Sun altitude ≤−6°. Keep the gate inputs observable in the result model so UI and tests can explain decisions. Document cylindrical-shadow or time-step approximations; do not describe them as authoritative astronomical photometry.

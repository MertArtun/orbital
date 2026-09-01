# Test strategy

## Test pyramid

1. **Pure unit tests:** TLE parser, propagation, longitude normalization, track splitting, solar geometry, pass aggregation, countdown formatting and launch normalization.
2. **Route/contract tests:** mocked upstream success/failure and cache/fallback semantics.
3. **Component/integration tests:** only where state transitions or accessibility are difficult to cover through E2E.
4. **Playwright:** first-screen smoke, console errors, API failures and empty responses, keyboard traversal and accessible names, pad/ISS interaction, layout stability and no overflow at 375 px. Geolocation allow/deny is **not** automated — the denial path exists in `components/panels/PassPanel.tsx` but nothing in `e2e/` grants or revokes the permission, so it stays a manual check in `QUALITY_GATES.md` until a test drives it. Listing it here as automated coverage would budget against a gate that does not exist.
5. **Manual validation:** compare at least one or two predicted visible passes with Heavens-Above using the same observer coordinates and an equivalent timestamp/TLE epoch.

## Orbital assertions

Prefer invariant ranges and tolerances over exact coordinates:

- latitude ∈ [−90, 90]
- longitude ∈ [−180, 180)
- ISS altitude and velocity remain physically plausible for the deterministic fixture
- pass start < peak < end and maximum elevation > 0
- every visible result satisfies all three gates
- no rendered ground-track segment contains a longitude jump >180°

Exact floating-point fixtures require a cited trusted reference and explicit tolerance.

## TDD evidence

For each behavior change, record the focused failing command as `red-test` evidence and the subsequent passing command as `green-test`. A regression test must fail against the previous implementation. Tests that passed before implementation do not count as red evidence.

## External comparison record

Record observer latitude/longitude, local time zone, TLE epoch, prediction timestamp, ORBITAL rise/peak/set and reference rise/peak/set. Note time-step resolution and expected tolerance. Do not mark the Definition of Done item complete until real observations are entered.

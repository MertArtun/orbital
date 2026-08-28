# ADR 0004: Fail loudly on unusable orbital elements

**Status:** accepted

## Context

ADR 0001 accepted client-side propagation and named "the need to guard malformed satellite records" as a consequence. That guard did not exist.

`lib/tle.ts` validates a record's shape — the `1 NNNNN` / `2 NNNNN` line prefixes and matching NORAD ids — but never its numbers. A truncated or corrupted CelesTrak response can therefore pass parsing with unparseable numeric fields, and `satellite.js` reports `error: 0` for the resulting element set rather than rejecting it. Propagation then returns `NaN` for latitude, longitude, altitude, speed and every ECI component.

Nothing downstream treats that as a failure. The telemetry panel renders `NaN°, NaN° · NaN km`, and the ground track hands `NaN` vertices to three.js, which floods the console with `computeBoundingSphere(): Computed radius is NaN`. The page does not crash, so the "malformed upstream data cannot crash the page" gate passes — but a screen of `NaN` is not an intentional state, and it is indistinguishable to the user from a bug in our own maths.

## Decision

A non-finite state is a propagation failure, not a position. Two independent guards enforce it:

1. `buildSatrec` rejects an element set whose SGP4 inputs (`no`, `ecco`, `inclo`, `nodeo`, `argpo`, `mo`, `bstar`) are not all finite, naming the offending elements. This fails fast, before any propagation work, and is the check the client hook surfaces when a cached TLE is unusable.
2. `propagateSatrec` rejects a computed state whose latitude, longitude, altitude, speed or ECI components are not finite. This covers a satrec that was valid when built but became unusable afterwards — `satellite.js` propagates such an element set to `NaN` rather than to the `null` it returns for a decayed orbit, so the `null` check alone does not catch it.

Both raise `PropagationError`, which callers already treat as recoverable: the client hook renders the message as an error state and keeps the last good position.

The guards are deliberately redundant, and each is pinned by a test that fails only when that specific guard is removed. Redundant defence that nothing tests is indistinguishable from dead code.

## Consequences

Positive: a corrupt TLE produces one honest error instead of a screen of `NaN`; three.js never receives `NaN` vertices; the failure names the elements that were unusable, which makes an upstream problem diagnosable from the UI.

Negative: two checks must be kept in step, and the element list is coupled to what SGP4 reads. A future `satellite.js` that validates its own inputs would make guard 1 redundant — the test that pins it is the signal for removing it.

Not addressed here: `lib/tle.ts` still accepts numerically corrupt records, so the repository fixture and the `/api/tle` cache can both hold one. Validating numbers at the parser boundary belongs to whichever objective owns that file.

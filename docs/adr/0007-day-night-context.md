# ADR 0007: Day/night context from the simulated clock, and an APOD card that can only fail quietly

**Status:** accepted

## Context

The globe renders a night-lights texture with no indication of where it is currently day, and the telemetry panel reports IN SUNLIGHT / EARTH SHADOW without saying why. Both matter to the product's one question — can you see the ISS? — because a visible pass is exactly the geometry where the station is lit while the ground beneath it is past civil twilight. P2-02 made the simulated clock canonical (ADR 0006), so any day/night rendering has to follow `at`, not wall-clock time. Separately, the product spec reserves an optional NASA APOD card for Phase 2, with the hard rule that its failure must never touch the MVP.

## Decision

- `lib/sun.ts` grows three pure functions on the existing solar model: `subsolarPoint` (declination and the Sun's hour angle from Greenwich), `terminatorCurve` (the Sun's horizon sampled per longitude; at the equinox the declination is held 0.01° off zero because the latitude-per-longitude form degenerates into a pair of meridians) and `nightPolygon` (that curve closed through whichever pole is in polar night, as a GeoJSON polygon the globe's polygon layer can digest). `satelliteSunState` reuses the cylindrical shadow test and adds the geocentric Sun altitude at the sub-satellite point; `describeSunState` turns the pair into one sentence.
- `hooks/useTerminator.ts` derives the geometry from the canonical `at` on the same cadence as the ground track — recomputed once the clock has moved a minute, behind a 200 ms trailing debounce — and is listed in the canonical-clock fitness test. The globe draws the night hemisphere as a translucent cap below the tracks, the terminator as a dashed line, and the subsolar point as an amber marker; the telemetry panel prints the sentence and the subsolar coordinates. The sentence is labelled as a model: no penumbra, refraction or ellipsoid, good to about a degree, which is the resolution it speaks in.
- The APOD card is lazy and optional by construction. `hooks/useApod` keeps its SWR key null until `components/panels/ApodPanel` has been scrolled within 200 px of the viewport, retries nothing (NASA's `DEMO_KEY` is rate limited and the card is not core), and the panel keeps one fixed-aspect media box through its deferred, loading, image, video, cached and unavailable states so a failure changes copy, not layout. Video days render an external link, never an embed. Images go through `next/image` with `unoptimized`, which is what lets an external https URL render without a `remotePatterns` change; the route already refuses anything that is not an absolute, credential-free https URL.

## Consequences

Positive: the globe answers "where is it day?" for any simulated instant, and the panel explains the visibility geometry in the words a first-time visitor needs. The APOD request never happens for a visitor who does not scroll, and its worst case is a quiet "unavailable" box of the same size, which `e2e/apod.spec.ts` proves alongside the intact globe and panels.

Negative: the night cap is a translucent overlay on a night-lights texture, not a lit/unlit texture blend — a day texture is out of scope for this objective and its download budget. The polygon layer rebuilds its geometry once a minute (and once per paused scrub), which is bounded but not free. The sun sentence is a model statement and is labelled as such; it must not be read as photometry.

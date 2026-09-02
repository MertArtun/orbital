# ADR 0005: Render Starlink as one particle layer fed by a Web Worker

**Status:** accepted

## Context

CelesTrak's Starlink group is roughly ten thousand records (1.8 MB of TLE text, about 600 KiB compressed on the wire). ADR 0001 keeps propagation in the browser, but 1 Hz SGP4 for thousands of satellites on the main thread would compete with the globe's render loop, and react-globe.gl's `pointsData` creates one object per datum, so even 800 points would mean 800 meshes re-digested every second.

## Decision

- The client requests `/api/tle/starlink` only after the user enables the layer (default off, no persistence). The route keeps its existing cache and stale-memory behaviour; no new upstream integration.
- `lib/starlink.ts` samples deterministically: stable sort by numeric NORAD id, then every `ceil(n / 800)`-th record, never more than `MAX_STARLINK_POINTS = 800`. Two visitors with the same element set see the same satellites, and the sample does not depend on the order CelesTrak returns.
- `workers/starlink.worker.ts` is a module worker constructed as `new Worker(new URL('../workers/starlink.worker.ts', import.meta.url), { type: 'module' })`. Turbopack compiles this to its worker-loader factory and emits a dedicated chunk; the raw `.ts` is also copied into `static/media` as an asset side-effect of `new URL`, which is harmless. The worker builds satrecs once (`init`) and answers each `propagate { at, seq }` with a transferred `Float32Array` of `[lat, lng, altKm]` triples. It never reads its own clock: `at` is an absolute epoch supplied by the caller, so the simulated-time control (P2-02) changes only what the hook sends.
- Two gates protect against malformed records, mirroring ADR 0004: `buildSatrec` failures are dropped and counted at init, and a per-satellite `try/catch` around propagation skips a satellite that throws or yields a non-finite value without writing into the buffer. The batch reports `count` and `skipped` so the UI can say what it is showing.
- The globe renders the fleet with `particlesData`: one datum, one `THREE.Points`, one buffer attribute rewrite per tick. No per-satellite objects.

## Consequences

Positive: the main thread does a buffer copy per second and nothing else. Measured on 2026-09-02 against the live CelesTrak group (10,725 records) with `lib/starlink.ts` under Node 26/V8 in a vitest process: the stride sample yields 767 satellites, `buildStarlinkFleet` takes 7.5 ms once, and `propagateFleet` takes 1.06 ms per tick (median of 50). That is the worker's CPU cost, on the same engine satellite.js runs in the browser; it is not a main-thread frame-time measurement, which is what the e2e long-task gate covers. The fleet is deterministic, capped, and each tick transfers `800 * 3 * 4 = 9.6 KB`.

Negative: one worker per enabled layer; a first-enable download of the whole group (2.1 MB of JSON, 590 KiB gzipped, measured on the same date) because the route contract is unchanged and the sample is taken inside the worker -- a route-side sample would cut that to about 150 KiB and is logged as a follow-up; and `next build` must be re-checked whenever satellite.js or Next.js is upgraded, because the worker path is the one place bundler behaviour is not covered by unit tests -- the e2e responsiveness gate is the guard. satellite.js stays pinned at 6.0.2; 7.x pulls Node-only WASM runtimes into the worker bundle and deadlocks the build.

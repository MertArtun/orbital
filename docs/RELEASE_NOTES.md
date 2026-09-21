# Release notes

What shipped, and the engineering decision behind each piece. Every objective is one merged pull request; the decisions that outlived their objective are recorded as ADRs, which is where the reasoning lives rather than here.

## Phase 1 — a deployable vertical slice

| Objective | PR | The decision, and why |
|---|---|---|
| Reproducible toolchain | [#24](https://github.com/MertArtun/orbital/pull/24) | Pin the toolchain before writing product code, so every later measurement has a fixed floor under it. |
| Resilient public-data gateways | [#28](https://github.com/MertArtun/orbital/pull/28) | Upstreams are proxied, never called from the browser, and every route returns a typed envelope that can say *stale* or *fallback* out loud — [ADR 0003](./adr/0003-resilient-data-layer.md). An outage may not render as an empty state. |
| Verified ISS propagation | [#29](https://github.com/MertArtun/orbital/pull/29) | Positions are propagated in the browser from a cached element set, not polled from an API — [ADR 0001](./adr/0001-client-side-propagation.md). Unusable elements fail loudly rather than producing a plausible wrong orbit — [ADR 0004](./adr/0004-propagation-failure-model.md). |
| Cinematic ISS globe | [#30](https://github.com/MertArtun/orbital/pull/30) | `react-globe.gl` behind a `ssr: false` dynamic import, so the 3D renderer never enters the server bundle or the first load. |
| 72-hour visible passes | [#31](https://github.com/MertArtun/orbital/pull/31) | Visibility is three gates, not one: the satellite lit, the observer in darkness, the maximum elevation high enough to clear the horizon. |
| Mission-control panels | [#33](https://github.com/MertArtun/orbital/pull/33) | Countdowns derive from `target - Date.now()`, never from a decrementing counter, so a backgrounded tab cannot drift. |
| Resilience and mobile gates | [#34](https://github.com/MertArtun/orbital/pull/34) | `e2e/resilience.spec.ts` breaks each upstream in turn and all three at once, and requires the surface that *owns* the broken feed to name the failure. |
| Portfolio-ready MVP | [#36](https://github.com/MertArtun/orbital/pull/36) | Ship the evidence with the product: gates, docs and a Definition of Done that names what is not met. |

## Phase 2 — the differentiators

| Objective | PR | The decision, and why |
|---|---|---|
| Reduced-motion marker fix | [#41](https://github.com/MertArtun/orbital/pull/41) | The marker attached on a render tick, so a reduced-motion visitor could wait forever. Attachment no longer depends on animation running at all. |
| Starlink layer | [#45](https://github.com/MertArtun/orbital/pull/45) | A deterministic sample of at most 800 satellites, propagated in a module Web Worker and transferred as one `Float32Array` per tick into a single `THREE.Points` — [ADR 0005](./adr/0005-starlink-worker-particle-layer.md). Thousands of meshes would have been the obvious approach and the wrong one. |
| ±90-minute simulated time | [#47](https://github.com/MertArtun/orbital/pull/47) | One clock, and every orbital consumer receives its instant as an argument — [ADR 0006](./adr/0006-simulated-clock.md). A source test enforces that nothing else reads the wall clock, because the failure mode is a scrub where half the scene moves. |
| Terminator, sunlight and APOD | [#48](https://github.com/MertArtun/orbital/pull/48) | The day/night boundary derives from the same simulated instant, and the APOD card is deferred until it is scrolled near, never retried, and keeps its dimensions when unavailable — [ADR 0007](./adr/0007-day-night-context.md). |
| Idle globe rotation | [#49](https://github.com/MertArtun/orbital/pull/49) | The globe turned only once the first fix arrived, so a cold start looked broken. The first frame now moves. |

## Phase 3 — showcase polish

| Objective | PR | The decision, and why |
|---|---|---|
| Shareable observer links | [#50](https://github.com/MertArtun/orbital/pull/50) | A link is an explicit observer that outranks browser geolocation, parsed strictly and rounded on the way out, so a link does not republish the GPS fix the browser handed us — [ADR 0008](./adr/0008-shared-observer-links.md), which also says plainly that four decimals is a judgement call and not a privacy guarantee. |
| Measured performance and accessibility | [#52](https://github.com/MertArtun/orbital/pull/52) | Bytes are gated, timings are reported, and neither is a score — [ADR 0009](./adr/0009-performance-measurement-policy.md). See below. |
| Final portfolio release | this release | Real screenshots, a README that describes the product that exists, and the byte budget moved into CI. |

## The decision that shaped Phase 3

A Lighthouse score could not be produced honestly here. A score is a weighted blend of timings that move with CPU contention and thermal state, so the same commit scores differently from itself — and the objective forbade an invented score. [ADR 0009](./adr/0009-performance-measurement-policy.md) split the problem instead:

- **Bytes gate.** `scripts/check-bundle-budget.mjs` reads the prerendered HTML, resolves the chunks it references, counts the document's inline bytes in the same total, and fails on a first-paint resource served from outside `/_next/static`. Deterministic, no browser, now enforced in CI on every pull request.
- **Timings report.** `scripts/measure-perf.mjs` drives the installed Playwright chromium over CDP against a real production server and writes a provenance-stamped JSON. It gates nothing, publishes min/median/max across repeats rather than an average, and brackets each run with the machine's load.
- **Accessibility is measured twice**, because the in-page sweep structurally cannot read a WebGL canvas. `e2e/contrast.spec.ts` composites stacked backgrounds and gates; `scripts/measure-ink-contrast.mjs` samples the pixel actually painted under each glyph stroke and reports.

The part worth carrying forward is in that ADR's failure list. Every gate above was wrong before it was right, and none of the corrections came from reading the code — each came from constructing the input that would make the check lie and running it. A byte budget with no floor passes when it measures nothing. A positive control that asks a directory answers with whatever files are lying in it. A dirty-tree flag was fixed three times and read `true` throughout. A gate invoked through a symlinked path exited 0 having run nothing.

The rule the phase earned: **a check that cannot fail is worse than no check, because it is trusted.** Its corollary, applied to this document as much as to the code: a figure nothing regenerates is checked by nothing, which is why the numbers live in [`docs/perf/`](./perf/) and [`docs/a11y/`](./a11y/) and not in this prose.

## Known and not met

- **No public deployment.** No demo URL appears anywhere in this repository, because there is nothing to verify against. Tracked in [`PHASE_1_DOD.md`](./PHASE_1_DOD.md).
- **Pass prediction has not been checked against an external predictor by a human.** The physics is unit-tested against invariants and the arithmetic is recorded in [`PASS_VALIDATION.md`](./PASS_VALIDATION.md), which is not the same as independent confirmation.
- **The byte gate has no unit test.** It is verified by mutation and by hand — weaker than a test, and it decays the moment someone edits it without repeating that work.

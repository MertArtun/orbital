# Product specification

## Product statement

ORBITAL is a single-page, portfolio-grade space dashboard whose first impression is a cinematic 3D night globe with the ISS moving in real time. It demonstrates product judgment, graphics integration, orbital computation, resilient public-data architecture, testing discipline and production delivery.

## Primary audience

Recruiters and developers evaluating a demo link with little context. The page must communicate within seconds that the data is live, the globe is interactive and the implementation is deeper than a visual mock.

## Phase 1 user journeys

1. A visitor opens the page and sees the globe fade/zoom into the current ISS orbit.
2. The ISS marker moves smoothly from locally propagated TLE data; past and future tracks are distinct.
3. Selecting the ISS reveals current altitude, velocity, coordinates and sunlight/shadow state.
4. The browser requests observer location. On denial/unavailability, a searchable embedded city list remains usable.
5. The visitor sees visible passes during the next 72 hours, including local time, duration, approach direction, maximum elevation and quality.
6. The next launch has a live absolute-time countdown; four more launches remain scannable. A pad action focuses the globe.
7. Any one or all upstream services may fail without causing a page-level crash.

## Non-goals for Phase 1

- Full orbital catalog or collision analysis
- Authoritative apparent-magnitude prediction
- User accounts, databases or private API keys
- CesiumJS, server-side position polling or expensive geocoding
- Starlink and simulated time before the MVP release gate

## Definition of Done

The canonical machine-readable acceptance criteria are in `goals/roadmap.json`. Phase 1 additionally requires a public Vercel deployment, a clean production build, strict TypeScript, critical unit tests, 375 px validation, intentional failure states and manual comparison of at least one or two passes against an external trusted predictor. Results must be recorded, never assumed.

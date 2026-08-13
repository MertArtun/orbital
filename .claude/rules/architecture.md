# Architecture boundaries

- Route handlers fetch and cache slow-changing upstream data; clients consume only local `/api/**` routes.
- Clients receive TLE once and propagate positions with satellite.js at 1Hz or against the simulated clock.
- Shared external contracts live in `lib/types.ts`; normalization and validation stay outside UI components.
- Dynamic import with `ssr: false` is mandatory for react-globe.gl.
- Keep server-only code out of client bundles. Do not import route fixtures through a client module.
- Every upstream integration has timeout, validation, stale/empty/error behavior, and a documented cache interval.
- Prefer pure functions around orbital calculations and thin hooks around scheduling/state.

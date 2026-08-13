# ADR 0001: Cache TLE server-side, propagate positions client-side

**Status:** accepted

## Context

Orbital elements change slowly, while the displayed position changes continuously. Polling a location API would create avoidable upstream load, visible network jitter and no cheap time simulation.

## Decision

Next.js route handlers fetch and cache TLE. The browser parses the selected records once and uses satellite.js to propagate the current or simulated timestamp. ISS updates at 1 Hz with visual interpolation. Ground tracks and pass windows use the same deterministic model.

## Consequences

Positive: smooth motion, few upstream calls, offline-like resilience, shared model for tracks/passes/time controls. Negative: browser CPU work, approximation tied to TLE freshness, and the need to guard malformed satellite records. Bulk Starlink work therefore moves to a Web Worker and is capped.

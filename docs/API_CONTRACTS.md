# API contracts and cache policy

All route responses except the optional APOD use a typed envelope:

```ts
type ApiEnvelope<T> =
  | { ok: true; data: T; source: 'live' | 'stale-memory' | 'repository-fallback'; fetchedAt: string; stale?: boolean }
  | { ok: false; data?: T; error: string; fetchedAt: string };
```

## `/api/tle/:group`

Groups: `iss`, `starlink`, `visual`. Upstream: CelesTrak GP endpoint with TLE format. Revalidation: 21,600 seconds. Invalid group returns 404. Empty/malformed TLE response is failure. Warm-memory fallback applies to every group; repository fixture applies only to ISS.

## `/api/launches`

Upstream: Launch Library 2 upcoming launches, ordered by `net`, recent previous launch hidden. Revalidation: 1,800 seconds. Normalized data includes provider, rocket, mission, pad/location, timestamp, status, coordinates, optional image and webcast.

## `/api/astros`

Upstream: Open Notify HTTP endpoint, called only from the server. Revalidation: 60 seconds. Warm-memory fallback is allowed. The UI must tolerate complete unavailability.

## `/api/apod`

Optional Phase 2 route. Upstream: NASA APOD with `NASA_API_KEY` or `DEMO_KEY`. Revalidation: 86,400 seconds. APOD failure must never affect core rendering.

## Contract tests

Mock `fetch` at the route/parser boundary. Cover success, non-2xx, timeout/abort, malformed body, empty normalized result, last-good response, repository ISS fallback and invalid route parameter. Do not make unit tests depend on live provider availability.

# API contracts and cache policy

Every route response, including APOD, uses a typed envelope:

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

`count` is derived from the records that survive validation, not from upstream's `number`, so the crew total can never contradict the list beside it. A `people` value that is not an array is an error, not an empty crew.

## `/api/apod`

Optional Phase 2 route. Upstream: NASA APOD with `NASA_API_KEY` or `DEMO_KEY`. Revalidation: 86,400 seconds. APOD failure must never affect core rendering.

Fields are normalized to `Apod` (`mediaType`, `hdUrl`, `copyright`) rather than forwarded raw. The primary `url` must be absolute `https` or the payload is rejected. `hdurl` is optional: an absent or insecure value becomes `hdUrl: null`, which is the same state a video day produces, so one bad optional field never costs a whole day's card. Accepted URLs are returned as the parser's `href` and credential-bearing URLs are dropped, so no raw upstream string reaches an image or link attribute.

The API key must never appear in a response. Only messages the route authors itself are returned; a raw `fetch` error is replaced with a generic message, because the request URL carries the key and some network errors quote it.

## Warm-memory limitations

Last-good state is per-process module memory. On Vercel each instance keeps its own, so a cold start has none and the fallback cannot be relied on as a durability guarantee — it smooths transient upstream failures within a warm instance. Only the ISS repository fixture survives a cold start.

## Contract tests

Implemented in `app/api/**/route.test.ts`. Mock `fetch` at the route/parser boundary. Cover success, non-2xx, timeout/abort, malformed body, empty normalized result, last-good response, repository ISS fallback and invalid route parameter. Do not make unit tests depend on live provider availability.

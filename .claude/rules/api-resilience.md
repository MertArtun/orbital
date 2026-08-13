---
paths:
  - "app/api/**/*.ts"
  - "lib/launches.ts"
  - "lib/tle.ts"
  - "public/data/fallback-tle.json"
---
# Data gateway rules

CelesTrak: server-side only, six-hour revalidation. Launch Library 2: server-side only, thirty-minute revalidation and no more upstream calls than required. Open Notify: server proxy because upstream is HTTP. APOD: daily cache and optional UI.

Validate status and shape before caching. Apply an abort timeout. Prefer a last-good in-memory response when warm; ISS additionally falls back to the repository fixture. Return a typed envelope indicating live/stale/fallback. Never let malformed records poison the full set. Never log secrets or entire large upstream payloads.

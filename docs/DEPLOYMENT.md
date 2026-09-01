# Deployment

ORBITAL deploys as a stock Next.js App Router application. There is no database,
no authentication, no build-time secret and **no private runtime API key**. A
fork can be deployed by someone who has never seen this repository before.

## What the application needs

| Requirement | Value |
|---|---|
| Node.js | 22 (pinned in `.nvmrc`; `package.json` engines require ≥ 22) |
| Build command | `npm run build` |
| Output | `.next` (framework default) |
| Install | `npm ci` |
| Required environment variables | **none** |

No `vercel.json` is committed because none is needed: Vercel detects Next.js and
the defaults above are already correct. Adding a configuration file that only
restates defaults is a file to maintain and a way to drift.

## Optional environment variables

Both are genuinely optional — the application is fully functional with neither.

| Variable | Effect if unset | When to set it |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `metadataBase` falls back to `http://localhost:3000`, so Open Graph and canonical URLs are relative to localhost | Set to the public origin once deployed, so link previews resolve |
| `NASA_API_KEY` | `app/api/apod/route.ts` falls back to NASA's public `DEMO_KEY` | Only if the Phase 2 APOD card hits `DEMO_KEY`'s shared per-IP rate limit |

`NASA_API_KEY` is a free key from api.nasa.gov. It is not required for anything
in Phase 1 — the APOD card is Phase 2 — and it is not a secret that gates the
build.

## Deploying to Vercel

```bash
npm i -g vercel
vercel link          # select or create the project
vercel --prod        # deploy
```

Or import the repository at vercel.com/new. Accept every detected default; do not
add environment variables.

Afterwards, set `NEXT_PUBLIC_SITE_URL` to the assigned origin and redeploy so
metadata resolves against the real host rather than localhost.

## Verify a deployment before claiming it works

`docs/QUALITY_GATES.md` requires observed evidence, not an assumption that a green
build means a working page. Check, in a signed-out browser:

1. The globe renders and the ISS marker **moves** when the page is left open for a
   minute. A static marker means propagation is not running.
2. The pass panel responds to allowing *and* denying geolocation.
3. The launch countdown decreases and does not read `T−--:--:--:--`.
4. At 375 px there is no horizontal scrolling.
5. The browser console is clean.

Then record the URL in `README.md` and in `docs/PHASE_1_DOD.md` criterion 1, and
tick the matching items in `docs/PORTFOLIO_CHECKLIST.md`.

## Upstream dependencies at runtime

All four are public and unauthenticated. Each route handler applies a timeout,
validates the response shape, and has a defined behaviour when the upstream is
unreachable.

| Route | Upstream | Revalidate | On failure |
|---|---|---|---|
| `/api/tle/[group]` | CelesTrak GP | 6 h | last-good, then the repository TLE fixture |
| `/api/launches` | Launch Library 2 | 30 min | last-good, else a typed error envelope |
| `/api/astros` | Open Notify | 60 s | last-good, else a typed error envelope |
| `/api/apod` | NASA APOD | 24 h | last-good, else a typed error envelope |

Open Notify is proxied server-side because its public endpoint is HTTP; a browser
on an HTTPS deployment would refuse the mixed-content request.

"Last-good" is per warm server instance and is therefore a best-effort cushion,
not a guarantee — a cold instance has nothing cached. Only the ISS route has a
committed fixture behind it, because it is the primary experience. The user-facing
consequence of each failure is defined in the UI and covered by
`e2e/resilience.spec.ts`.

### The ISS fixture needs refreshing by hand

`public/data/fallback-tle.json` is the last line of defence for the primary
experience, and SGP4 accuracy degrades as an element set ages. It must be
refreshed periodically:

```bash
npm run update:fallback-tle
```

This was meant to be automatic. `.github/workflows/update-fallback-tle.yml` has
its weekly schedule **disabled**, because CelesTrak does not accept connections
from GitHub Actions runners — every scheduled run since 2026-08-17 failed with a
connect timeout before the request was even sent. The workflow is kept as a
manual dispatch and the full diagnosis is in its header comment. Until the script
gains a fallback source, refreshing the fixture is a human task; the telemetry
panel's amber "REPO TLE" chip means a visitor is at least never shown fixture
data labelled as live.

## What a deployment does not give you

A green deployment is not evidence for the two open Phase 1 criteria. It closes
criterion 1 only after the checks above are actually run, and it does nothing for
criterion 7, which needs an external pass prediction entered by a human. See
[`PHASE_1_DOD.md`](./PHASE_1_DOD.md).

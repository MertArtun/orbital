# ADR 0008: A shared link is an explicit observer, parsed strictly and rounded on the way out

**Status:** accepted

## Context

The product's question is "can you see the ISS?", and the answer depends entirely on where the reader is standing. Until now that place could only be chosen in the session that asked: the panel requests browser geolocation, falls back to an embedded city list, and keeps the choice in React state. There was no way to send someone the answer for their own sky, and no way to reproduce a screenshot's pass list. Phase 3 adds shareable coordinates, which means the app now accepts a position from an untrusted string and hands one back.

## Decision

- `lib/shareLink.ts` owns both directions. `parseSharedObserver` accepts `lat`, `lng` and an optional `place`, and is deliberately stricter than `Number()`: a decimal-degrees regex rejects hex, `Infinity`, exponent forms, padded whitespace and trailing garbage, which `Number()` would all accept. Both coordinates are required — half a position is not a position, and completing it from the default would place the visitor somewhere nobody chose. Latitude is bounded to ±90, longitude to ±180 and then normalised, so a link cannot introduce the `+180` spelling that the rest of the codebase has eliminated.
- The `place` name is upstream text. It reaches React text nodes and an input `value` only, but it is stripped of angle brackets and control characters and capped at 48 characters anyway, so it can never read as markup wherever it is shown later and cannot push the panel apart. A name that sanitises away entirely becomes "Shared location".
- A restored location gets the id `shared-location`, never a city id: city ids resolve to the city's coordinates elsewhere, and a link that borrowed one would silently move the observer.
- Links are written with four decimals — about eleven metres. That is enough to point at a park and not enough to republish the GPS fix the browser handed us. Other query parameters and the fragment are dropped: what is shared is the location, not the sender's campaign parameters.
- A link outranks geolocation. When one is present the panel does not ask the browser for a position and will not let a request already in flight overwrite it: the visitor followed a link to a specific place, and a permission prompt that silently relocates them defeats the link. Choosing a city afterwards replaces it, as it always did.
- The one-time cinematic intro settles on the linked observer instead of the ISS when a link supplied one, so the recipient's first frame is their own sky. Under `prefers-reduced-motion` there is no camera tween at all, only a jump to the destination — the same rule the intro already followed, and one the P2-00 marker-attachment guard depends on. That jump must also happen in the same task as the first fix, because only then does it land inside three-globe's build-in spin, which is the window in which the guard can see the defect at all. The rule is enforced by a source-level test (`lib/globeIntro.test.ts`) rather than from a browser: deferring the call by the intro's own 200 ms hold is invisible to both browser-level assertions tried, since the marker can take longer to attach than the hold, and the attribute that reports the camera's target is written by a later React commit whose latency under load exceeds it.

## Consequences

Positive: a pass prediction is now reproducible and sendable, the parser's failure mode is the default city rather than a broken page, and the privacy cost of sharing is bounded by rounding rather than by trust. The copy control degrades honestly: where the clipboard API is unavailable or denied, the link is revealed for manual copying instead of failing silently.

Negative: the app now has a second source of truth for the observer (link and geolocation), and their precedence is a product decision encoded in the panel rather than in a type. Four decimals is a judgement call, not a privacy guarantee — anyone can still send their exact coordinates by editing the URL, which is their choice to make. The intro's focus depends on a value resolved one render after mount, so the animated path holds 200 ms for it and the reduced-motion path places the camera immediately and jumps a second time if a link resolves late; that is a coupling between the URL and the camera that did not exist before, and the asymmetry between the two paths is load-bearing rather than cosmetic.

## Update — P4-02: the link no longer resolves in a mount effect

"Resolved one render after mount" proved too optimistic. The link was parsed in a mount effect and passed down as dashboard state, and Next.js hydrates the App Router inside a transition, so that state update could be interrupted. On a slow main thread, the 1 Hz telemetry kept restarting the update until it expired, about 5 s later. By then the intro had already passed its 200 ms hold and settled on the station.

Measured on `main` with 1.5 CPUs, 4 of 16 runs of the linked-observer specs failed. Under 6× CDP CPU throttling, `e2e/intro.spec.ts` failed every run.

`useSharedObserver` now reads the address through `useSyncExternalStore`, with a `null` server snapshot. The server and hydration markups still agree. Because the client snapshot differs from the server's, React re-renders synchronously once hydration commits, which is before the client-only globe can mount. The first read is cached, so the link is still read once per visit; `e2e/share.spec.ts` fails if that cache is removed. The intro's 200 ms hold and the second jump under reduced motion stay in place as a fallback for a late value, but they no longer carry the common case.

# Portfolio release checklist

## Repository first impression

- [x] README opens with a real current desktop image, not a concept mock. — `public/screenshots/orbital-desktop.png`, recaptured from a production build; the README caption carries the timestamp, commit and element set, which is the one place they are maintained. It no longer claims corroboration with `PASS_VALIDATION.md`: that record was computed from an earlier element set, so the cards in the current image are not the cards it predicts.
- [x] Public demo and source links work in a signed-out browser. — [langouste.vercel.app](https://langouste.vercel.app) and this repository both load in a fresh Playwright chromium context, which carries no session.
- [ ] Description and topics mention Next.js, Three.js, orbital mechanics, TypeScript and testing.
- [x] PR history maps cleanly to roadmap objectives and uses squash merges. — one PR per objective. The non-objective PRs are #27/#32/#35, which widened an objective's allowed paths and were landed separately, and six `chore` PRs (#37, #38, #39, #40, #42, #46).
- [x] No generated secrets, local paths, fake metrics or unfinished placeholder claims. — the deployment URL is real and its checks were run ([langouste.vercel.app](https://langouste.vercel.app)); no Lighthouse score or accuracy figure appears anywhere, because neither has been measured. See `PHASE_1_DOD.md`.

## Demo proof

- [x] ISS visibly moves when the page is left open. — observed on the deployment over a full minute (4.44° N / 161.33° W → 1.43° N / 159.20° W), recorded in `PHASE_1_DOD.md` §1.
- [x] Past/future tracks are understandable without reading docs. — the globe carries a “−45 MIN / +45 MIN” legend.
- [x] GPS denial path works. — the post-deploy check exercised both branches against the live site (`GPS` when granted, `CITY` when denied, passes rendering in both — `PHASE_1_DOD.md` §1), and the tick records that manual check. `e2e/share.spec.ts` does drive the permission and set a real fix, but only to prove a shared link outranks it: **no spec asserts the `CITY` chip under denial or the `GPS` chip under grant**, so the user-visible outcome is still unasserted in CI.
- [x] Launch countdown is not drift-based. — `lib/format.ts` derives from `target − Date.now()`; pinned by `lib/format.test.ts` and an e2e tick assertion.
- [x] One simulated upstream outage is demonstrated or recorded. — `e2e/resilience.spec.ts` breaks each feed alone and all three at once.
- [x] 375 px screenshot has no overflow. — `public/screenshots/orbital-mobile-375.png`, and asserted in `e2e/resilience.spec.ts`.

## Engineering story

- [x] Architecture diagram explains cache-on-server / propagate-on-client. — README flowchart plus the `ARCHITECTURE.md` sequence diagram; both confirmed rendering on GitHub.
- [x] Critical calculations have deterministic TDD coverage. — ten modules enumerated in `vitest.config.ts`. Figures are not restated in any document; `npm run test:coverage` prints them and `coverage/coverage-summary.json` carries them as data.
- [x] Fallback strategy is visible in code and UI. — the telemetry panel renders TLE LOCK / CACHED TLE / REPO TLE from the envelope source.
- [x] Starlink performance decisions are measured when Phase 2 ships. — the sample is 767 of 10,725 live records, which is arithmetic rather than a measurement (`ceil(10725/800) = 14`, then `ceil(10725/14) = 767`). ADR 0005 records the timings themselves with the date, engine and aggregation that make them a record; they are not restated here, because a bare single number is the shape ADR 0009 argues against. `e2e/starlink.spec.ts` gates main-thread responsiveness with a self-baselined long-task budget on Chromium.
- [ ] Manual pass comparison contains actual coordinates/times and tolerance. — record prepared with real ORBITAL output and an empty reference column in `PASS_VALIDATION.md`; the comparison is a human step.
- [ ] Lighthouse evidence is from the deployed production build. — not planned; ADR 0009 explains why a score cannot be produced honestly here, and the byte budget is gated in CI instead.

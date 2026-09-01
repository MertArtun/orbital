# Portfolio release checklist

## Repository first impression

- [x] README opens with a real current desktop image, not a concept mock. — `public/screenshots/orbital-desktop.png`, from a production build at 2026-09-01T15:32Z against element set `26244.17592806`; its pass cards match `PASS_VALIDATION.md`.
- [ ] Public demo and source links work in a signed-out browser.
- [ ] Description and topics mention Next.js, Three.js, orbital mechanics, TypeScript and testing.
- [x] PR history maps cleanly to roadmap objectives and uses squash merges. — one PR per objective, plus #27/#32/#35 which widened an objective's allowed paths and were landed separately.
- [x] No generated secrets, local paths, fake metrics or unfinished placeholder claims. — no deployment URL, Lighthouse score or accuracy figure appears anywhere; see `PHASE_1_DOD.md`.

## Demo proof

- [ ] ISS visibly moves when the page is left open.
- [x] Past/future tracks are understandable without reading docs. — the globe carries a “−45 MIN / +45 MIN” legend.
- [ ] GPS denial path works. — implemented in `components/panels/PassPanel.tsx`, but **no automated test drives the permission**; it is a manual check, see `TEST_STRATEGY.md`.
- [x] Launch countdown is not drift-based. — `lib/format.ts` derives from `target − Date.now()`; pinned by `lib/format.test.ts` and an e2e tick assertion.
- [x] One simulated upstream outage is demonstrated or recorded. — `e2e/resilience.spec.ts` breaks each feed alone and all three at once.
- [x] 375 px screenshot has no overflow. — `public/screenshots/orbital-mobile-375.png`, and asserted in `e2e/resilience.spec.ts`.

## Engineering story

- [x] Architecture diagram explains cache-on-server / propagate-on-client. — README flowchart plus the `ARCHITECTURE.md` sequence diagram; both confirmed rendering on GitHub.
- [x] Critical calculations have deterministic TDD coverage. — nine modules enumerated in `vitest.config.ts`; per-file figures in `PHASE_1_DOD.md`.
- [x] Fallback strategy is visible in code and UI. — the telemetry panel renders TLE LOCK / CACHED TLE / REPO TLE from the envelope source.
- [ ] Starlink performance decisions are measured when Phase 2 ships. — not applicable yet; `workers/starlink.worker.ts` is an unwired stub.
- [ ] Manual pass comparison contains actual coordinates/times and tolerance. — record prepared with real ORBITAL output and an empty reference column in `PASS_VALIDATION.md`; the comparison is a human step.
- [ ] Lighthouse evidence is from the deployed production build.

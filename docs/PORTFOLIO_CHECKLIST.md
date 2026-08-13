# Portfolio release checklist

## Repository first impression

- [ ] README opens with a real current desktop image, not a concept mock.
- [ ] Public demo and source links work in a signed-out browser.
- [ ] Description and topics mention Next.js, Three.js, orbital mechanics, TypeScript and testing.
- [ ] PR history maps cleanly to roadmap objectives and uses squash merges.
- [ ] No generated secrets, local paths, fake metrics or unfinished placeholder claims.

## Demo proof

- [ ] ISS visibly moves when the page is left open.
- [ ] Past/future tracks are understandable without reading docs.
- [ ] GPS denial path works.
- [ ] Launch countdown is not drift-based.
- [ ] One simulated upstream outage is demonstrated or recorded.
- [ ] 375 px screenshot has no overflow.

## Engineering story

- [ ] Architecture diagram explains cache-on-server / propagate-on-client.
- [ ] Critical calculations have deterministic TDD coverage.
- [ ] Fallback strategy is visible in code and UI.
- [ ] Starlink performance decisions are measured when Phase 2 ships.
- [ ] Manual pass comparison contains actual coordinates/times and tolerance.
- [ ] Lighthouse evidence is from the deployed production build.

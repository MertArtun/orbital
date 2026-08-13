# Git and PR policy

- One roadmap objective per branch and PR. Branch format: `feat/P1-03-live-iss-globe` or the roadmap-specified value.
- Never commit on or push directly to `main`/`master`.
- Use conventional commits: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `ci:`, `chore:`.
- Commit meaningful increments: red test, implementation, polish/docs when each is independently coherent. Do not manufacture dozens of trivial commits.
- Open a draft PR once the vertical slice is coherent; fill the template with acceptance mapping and evidence.
- Require local verification, QA review, code review, CI, then squash merge and delete the branch.
- Never use `--admin`, force push, or disabled checks. If GitHub is unavailable, record `review_ready` and leave a clean branch with exact next commands.
- `goals/state.json` is local and ignored; update it only through `scripts/goals.mjs`. PRs and CI are the public audit trail.

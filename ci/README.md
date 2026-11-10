# Continuous integration

**Status: active.** The workflow lives at [`.github/workflows/tests.yml`](../.github/workflows/tests.yml) and runs automatically.

The `ci/tests.yml` reference copy that used to sit here has been deleted. It was kept because the automated connection could not create workflow files; a maintainer has since added the real file through the GitHub website. Keeping two copies risked someone editing the reference by mistake and seeing no effect.

## What runs, and when

| Trigger | When |
| --- | --- |
| `pull_request` | Any pull request, opened or updated |
| `push` → `main` | Every merge to the production branch |

Job **Unit, DOM and browser tests** runs on `ubuntu-latest`:

1. Check out the repository
2. Set up Node 22 (with npm cache)
3. `npm ci`
4. `npm test` — store and jsdom DOM tests (currently 42)
5. Install Playwright Chromium
6. `npm run test:e2e` — browser tests against a local static server (currently 43)
7. On failure only: upload `playwright-report/` and `test-results/` as an artifact

Typical duration is 1–2 minutes.

## Is it enforced?

**Not yet.** A successful run does not by itself block a merge, and `main` deploys to production on every push. To make the check mandatory:

1. Repository **Settings** → **Rules** → **Rulesets** (or **Branches** on older UI)
2. **New branch ruleset**, target `main`
3. Enable **Require status checks to pass before merging**
4. Add **Unit, DOM and browser tests**
5. Save

Until that is done, CI is advisory: it tells you about breakage, it does not prevent it.

## When it fails

Open the failing run in the **Actions** tab and expand the failed step.

- **`npm ci` fails** — `package-lock.json` is out of sync with `package.json`. Run `npm install` locally and commit the lockfile.
- **Unit or DOM tests fail** — reproducible locally with `npm test`.
- **Browser tests fail** — reproduce with `npm run test:e2e`. Download the uploaded artifact for screenshots, traces and the Playwright report.
- **Server won't start** — the Playwright config runs `python3 -m http.server 8000`, which is preinstalled on `ubuntu-latest`. A failure here usually means the port is already in use or the config changed.

## Action versions

Pinned to the current major tags, verified to exist on 2026-11-06:

| Action | Tag | Latest release |
| --- | --- | --- |
| `actions/checkout` | `v7` | 7.0.1 |
| `actions/setup-node` | `v7` | 7.1.0 |
| `actions/upload-artifact` | `v7` | 7.0.2 |

## Local checks before pushing

```sh
npm test              # unit + DOM, seconds
npm run test:e2e      # browser tests, needs Playwright's Chromium
npm run test:mutation # confirms the tests catch deliberate breakage
```

`npm run test:mutation` refuses to start when `js/store.js` or `js/app.js` has uncommitted changes, because a half-applied mutation looks identical to a dirty tree. Pass `ALLOW_DIRTY=1` for deliberate work in progress.

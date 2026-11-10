# Activating CI — step by step

**Why you have to do this one yourself:** the GitHub App this session authenticates as lacks `workflows` permission. I tested it — a normal file pushes fine, but `.github/workflows/tests.yml` is rejected:

```
! [remote rejected] ... (refusing to allow a GitHub App to create or update
workflow `.github/workflows/tests.yml` without `workflows` permission)
```

You are logged in as yourself in the browser, so the web editor works where I cannot.

**Time: about 3 minutes.** No local setup needed.

---

## Step 1 — Open the workflow file that already exists

The workflow is already written and committed at **`ci/tests.yml`**. You are copying it into the folder GitHub looks at.

1. Go to **https://github.com/Immanuel9567/e-commerce-proj**
2. Make sure the branch selector says **`main`**
3. Click the **`ci`** folder
4. Click **`tests.yml`**
5. On the right, click the **copy icon** above the file (or select all and copy)

---

## Step 2 — Create the workflow file

1. Go back to the **repository root** (click `e-commerce-proj` in the breadcrumb)
2. Click **Add file** → **Create new file**
3. In the filename box, type exactly:

   ```
   .github/workflows/tests.yml
   ```

   Typing the `/` characters creates the folders automatically. Do not paste a path that omits `.github` — GitHub will put it in the wrong place.

4. Click into the big text area and paste the contents you copied in Step 1.

---

## Step 3 — Commit it

1. Scroll to the bottom.
2. Commit message: `Activate CI test workflow`
3. Choose **Commit directly to the `main` branch**
4. Click **Commit changes**

---

## Step 4 — Watch it run

1. Click the **Actions** tab at the top of the repo.
2. You should see a run named **Tests** starting, triggered by your push to `main`.
3. Click it, then click the **Unit, DOM and browser tests** job to watch the steps.

It takes roughly **2–4 minutes**. You want the green check at the end.

### What you should see, in order

| Step | What it proves |
| --- | --- |
| Check out the repository | — |
| Set up Node | Node 22 |
| Install dependencies | `npm ci` works from the lockfile |
| Run unit and DOM tests | **41 tests pass** |
| Install Playwright Chromium | browser downloads on the runner |
| Run browser tests | **43 tests pass** |
| (skipped) Upload failure artifacts | only runs on failure |

---

## If it fails

**"Dependencies lock file is not found"** — you committed to a branch other than `main`, or the file landed at the wrong path. Check the file is at `.github/workflows/tests.yml`, not `.github/tests.yml` or `ci/tests.yml`.

**"Run browser tests" fails but unit tests pass** — almost always the static server. The config runs `python3 -m http.server 8000`, which is preinstalled on `ubuntu-latest`. If it fails, open the log and read the server line; the port may be occupied.

**Failure on `actions/checkout@v7` or similar** — the pin is wrong. All three are verified to exist as of 2026-11-06 (`checkout v7.0.1`, `setup-node v7.1.0`, `upload-artifact v7.0.2`).

**Red X on the whole workflow with "workflow file issue"** — a YAML error crept in during copy/paste. The most likely culprit is indentation. Re-copy from `ci/tests.yml` rather than retyping.

When it fails, the **Upload failure artifacts** step saves the Playwright report so you can download it from the run page.

---

## Step 5 — Make it a required check (recommended)

Green CI is only useful if it blocks bad merges.

1. **Settings** → **Branches** → **Add branch ruleset** (or **Add rule** on older UI)
2. Target: `main`
3. Enable **Require status checks to pass before merging**
4. Search for and select **Unit, DOM and browser tests**
5. Save

From then on, no merge to `main` reaches production without the tests passing.

---

## Step 6 — Remove the duplicate

`ci/tests.yml` now exists in two places. The copy at `ci/tests.yml` is documentation; `.github/workflows/tests.yml` is what actually runs.

**The risk:** someone edits `ci/tests.yml`, sees nothing change, and doesn't understand why.

Two options:

- **Keep both** and add a note at the top of `ci/tests.yml` saying it is a reference copy and the live file is `.github/workflows/tests.yml`. Safe, and the instructions in `ci/README.md` still make sense.
- **Delete `ci/tests.yml`** once the workflow is confirmed running, and update `ci/README.md` to point at the live file.

I'd do the second, but only after Step 4 shows green — not before.

---

## Why this matters before the domain

Right now every merge to `main` deploys straight to production with **no automated test run**. Once a domain points at the site, that means a broken merge reaches customers with nothing in the way.

Do this before you point `greencart` at Vercel.

# Contributor permissions

You do not own this project. It lives under the GitHub account **`Immanuel9567`** with the Vercel team that account controls. This document records what a **contributor** can and cannot do, the exact error each blocked action produces, and how to keep working within the rules.

Written 2026-11-06, after hitting several of these walls in practice.

---

## The short version

| Task | Can a contributor do it? |
| --- | --- |
| Push a branch, open a pull request | **Yes** |
| Run CI checks on a PR | **Yes** (automatic) |
| Merge your own pull request | Usually **no** — needs *write* role |
| Create or edit `.github/workflows/*` | **No** — needs *workflows* permission |
| Create a branch ruleset / require checks | **No** — admin only |
| Add a custom domain in Vercel | **No** — project owner only |
| Change DNS at the registrar | **No** — domain owner only |
| Change Vercel project settings | **No** |

Everything blocked is **configuration**. Everything in the repository is still yours to change through pull requests.

---

## GitHub: what actually happens

### Pushing branches and opening PRs — works

```bash
git push origin feature-branch
gh pr create --title "..." --body "..."
```

This is the normal path and nothing blocks it.

### Merging — usually blocked

```
Resource not accessible by integration
```

or, on a protected branch, the merge button is greyed out with *"You're not authorised to merge"*.

If you have the **write** role you can merge. If you have **triage** or **read**, you cannot. Ask the owner to either merge for you or grant **write**.

### Creating a workflow file — always blocked for the App

```
! [remote rejected] (refusing to allow a GitHub App to create or update
workflow `.github/workflows/tests.yml` without `workflows` permission)
```

**The workaround that works:** create the file through the GitHub **web UI** while logged in as yourself. Browser commits are attributed to your user account and are not subject to the App restriction. This was done successfully for `.github/workflows/tests.yml`.

### Reading repo settings — partly blocked

```bash
gh api repos/OWNER/REPO/branches/main/protection   # 403
gh api repos/OWNER/REPO/rulesets                   # returns []
gh api repos/OWNER/REPO/actions/permissions        # 403
```

An empty `rulesets` result means **no ruleset exists**, which is different from "I am not allowed to see them". If you need certainty, ask the owner to confirm in the GitHub UI: **Settings → Rules**.

### Reading CI logs — sometimes blocked

Fetching full run logs can fail with a connection error even though the API answers:

```
failed to get run log: ... EOF
```

You can still get **status and per-step conclusions**:

```bash
gh run list --limit 5
gh run view <run-id> --json status,conclusion,jobs
```

For the actual test output, open the run in the browser, or download the uploaded `playwright-results` artifact.

---

## Vercel: what a contributor cannot do

Custom domains are **project-level configuration**. A project contributor cannot add, remove or verify a domain — only the project owner (or a team member with sufficient role) can.

What that means concretely:

- **You cannot add `shopgreencart.com` to the project.** The owner must do it.
- **You cannot see the DNS records Vercel wants.** Those appear only on the domain card in the project settings. The owner must read them out or screenshot them.
- **You cannot change project settings**, including Deployment Protection.
- You **can** push code, and the preview and production deployments still happen normally.

### Two further reasons Vercel may refuse a domain

Even the owner can be blocked, and neither is a permissions problem:

1. **The domain is already attached to another Vercel account or project.** Vercel reports a conflict and asks for a TXT verification record at the losing side before transfer.
2. **The domain's nameservers point elsewhere** and Vercel cannot verify ownership until DNS is changed or a TXT record is added.

So "unavailable" on Vercel can mean *taken within Vercel*, or *owned by someone else entirely*. Those are different problems and the fix differs.

---

## Working inside the rules

1. **Do everything possible in pull requests.** Code, tests, docs, CI config files. A contributor's PR is the normal contribution path and needs no special rights.
2. **Handle workflow files in the browser.** Never expect `git push` to carry `.github/workflows/`.
3. **Ask the owner for specific actions, not vague access.** "Please add `shopgreencart.com` in Vercel → Settings → Domains and paste the two DNS records here" is more likely to be done than "please give me access".
4. **Never ask for credentials** — not passwords, tokens or 2FA codes. Ask for a role, or for the owner to perform the action.
5. **Verify rather than assume.** Branch state and PR state can disagree; check `gh pr view` and `origin/main` directly. A reported merge is not a merge until `main` contains the commit.

---

## What to ask the owner for

In priority order, and each is a one-time action:

| Request | Why | Effort |
| --- | --- | --- |
| Add `shopgreencart.com` in Vercel, paste the DNS records | Only they can; blocks the domain move | 2 minutes |
| Add the DNS records at the registrar | Only they can; blocks HTTPS | 2 minutes |
| **Require** the CI check via a branch ruleset | CI is currently advisory, not blocking | 2 minutes |
| Grant **write** on the repository | Lets you merge your own PRs instead of waiting | 1 minute |
| Grant **workflows** permission to the GitHub App, if the integration is under their control | Removes the browser workaround | Unknown |

Only the first two are strictly required to move the domain. The third is the one that protects production.

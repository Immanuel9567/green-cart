# Go-live: hosting and domain for GreenCart

A runbook for moving the storefront off the free `*.vercel.app` URL onto your own domain.

**Updated 2026-11-06.** Vercel's UI and IPs change; confirm every value on the domain card in **Project → Settings → Domains** before entering it at your registrar. The values below are Vercel's documented defaults, not a substitute for that card.

> **You do not own this project.** Adding a domain in Vercel and editing DNS both require the owner, not a contributor. The steps below are written so the owner can follow them directly, or hand you the two values in step 1.2. See [`CONTRIBUTOR-PERMISSIONS.md`](CONTRIBUTOR-PERMISSIONS.md).

> **Domain chosen: `shopgreencart.com`.** It is a compromise, not first choice — see [Why this domain](#why-this-domain).

---

## Before anything: decide what "live" means

These are two different launches, and confusing them is how shops take money they cannot fulfil.

| | **Live (public URL)** | **Live (taking orders and money)** |
| --- | --- | --- |
| Own domain, HTTPS | Required | Required |
| Anyone can visit | Yes | Yes |
| Customer can pay | **No** — checkout says "No payment will be collected." | Yes |
| You receive the order | **No** — saved in the customer's browser only | Yes, in a database you can read |
| Admin is private | **No** — no login, every visitor can open it | Yes |
| Test gate on deploy | **Yes** — CI is active | Yes |

**This runbook delivers the first column.** It is a real public presence on your own domain, safe to share. It is not a shop that can take money, and no amount of DNS work makes it one.

---

## Why this domain

`greencart.com` and the short variants were taken, and `shopgreencart.com` was what Vercel offered as available. That is a workable outcome, with two things to check before money changes hands:

- **Availability in Vercel is not the same as availability generally.** Vercel showing a domain as available means no *Vercel* account has it registered as a project domain — not that the name is unregistered. Confirm at a registrar that `shopgreencart.com` can actually be bought, and at what **renewal** price.
- **Check the trademark position.** "GreenCart" is an existing grocery brand in several markets. A `.com` that reads as a variant of someone else's mark is a risk worth five minutes of searching, not a lawyer — just to know where you stand.

`shopgreencart.com` is longer and has a "shop" prefix, which slightly reduces type-in traffic. It is unambiguous when spoken aloud, which `greencart`-with-a-number would not have been, so it is a reasonable trade.

---

## Part 1 — Point the domain at Vercel

### 1.1 Choose the address shape

Use **`www` as the address people type, with the apex redirecting to it.**

Vercel recommends this because the apex (`shopgreencart.com`) cannot hold a CNAME, so it must use a fixed IP. `www` can follow a CNAME, letting Vercel change IPs without you touching DNS again.

Register both the apex and `www`. Vercel redirects one to the other.

### 1.2 Get the values from Vercel, not from this document

1. Project → **Settings** → **Domains**
2. Click **Add**, enter your domain
3. Vercel shows the exact records it wants, with a copy button

Enter **those** values. Some projects get a project-specific CNAME (like `d1d4fc829fe7bc7c.vercel-dns-017.com`) instead of `cname.vercel-dns.com`. Using the generic value when yours is specific is a common way to lose an afternoon.

### 1.3 Add the records at your registrar

Typical Vercel values:

| Type | Host / Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | `76.76.21.21` | Auto / 3600 |
| CNAME | `www` | `cname.vercel-dns.com` | Auto / 3600 |

Notes that matter:

- **Delete any existing `A` record on `@` first.** If an old host's record stays alongside Vercel's, traffic splits randomly between them.
- **Never put an A record on `www`.** That is the single most common misconfiguration. `www` gets a CNAME.
- Some registrars auto-create a `www` A record when you add an apex A record. Find it and replace it with the CNAME.
- **Leave your nameservers at the registrar** unless you want Vercel to manage all DNS. Adding two records keeps MX (email) records untouched. Some registrar UIs silently mangle MX records when you edit apex DNS — check email still works afterwards if you use it on that domain.
- If you put Cloudflare in front, set the records to **DNS-only (grey cloud)** while Vercel issues the certificate. Proxying too early is a frequent verification failure.

### 1.4 Verify

DNS is usually live in minutes, occasionally up to 48 hours.

```bash
dig shopgreencart.com A +short          # expect 76.76.21.21
dig www.shopgreencart.com CNAME +short  # expect cname.vercel-dns.com.
```

Then check both domains show **Valid Configuration** in Vercel. HTTPS is issued automatically once DNS resolves.

In the browser: `http://shopgreencart.com` should redirect to `https://www.shopgreencart.com` with a valid padlock. Test in a private window so a cached redirect doesn't fool you.

### 1.5 Set the primary domain

In **Settings → Domains**, mark `www.shopgreencart.com` as primary and confirm the apex redirects to it. Check the URL stays on your domain rather than flipping back to `*.vercel.app`.

### 1.6 Common failures

| Symptom | Likely cause |
| --- | --- |
| "Invalid Configuration" | Conflicting A records, or the registrar added its own |
| `www` won't verify | An A record is on `www` instead of a CNAME |
| Certificate error | Cloudflare proxy on, or DNS not resolved yet |
| Works for you, not others | Propagation — check `whatsmydns.net`, not one resolver |
| Old site still appears | Old A record not deleted; traffic splitting |

---

## Part 2 — Hosting settings

### 2.1 Test gate — already done

CI is **active**. `.github/workflows/tests.yml` runs `npm test` (42 tests) and `npm run test:e2e` (43 tests) on every pull request and every push to `main`, and the first run passed.

**One thing still to do:** make it *enforced*. Repository → **Settings** → **Rules** → **Rulesets** → new ruleset on `main` → **Require status checks** → select **Unit, DOM and browser tests**. Without that, a red run does not stop a merge, and `main` deploys to production immediately. See [`ci/README.md`](../ci/README.md).

### 2.2 Deployment protection

Preview deployments get public URLs. Enable **Deployment Protection** for previews so draft work is not publicly reachable.

### 2.3 Caching and compression

Vercel's defaults are good. Leave them unless a specific problem forces otherwise.

---

## Part 3 — Gaps that matter once the site is public

None of these block pointing a domain at it. All of them matter once people can find it.

- **No privacy notice.** Checkout collects name, delivery address, city and email. Even stored only in the visitor's browser, you should say what you collect and why; some jurisdictions require it.
- **No terms, refund policy or contact page.** There is one HTML file. A shop without a way to contact you reads as abandoned or fraudulent.
- **The Admin tab is visible to every visitor** and has no login. It only edits that visitor's own browser data, so it is not a breach — but it looks unprofessional and invites confusion. Hiding it until real authentication exists is a small change.
- **No `robots.txt` or sitemap.** Harmless while this is a preview; needed when you want it found.
- **Images total 3.8 MB** across 14 files, several at 1024×1024 and 400–555 KB. Slow first paint on mobile data. Resizing to roughly 2× display size and re-encoding would cut most of it; Vercel does not optimise plain `<img>` files.
- **No uptime or error monitoring.** You will not know if it breaks until someone tells you.

---

## Part 4 — What blocks taking real orders

Not hosting. These:

1. **No shared data store.** Orders live in `localStorage`, per browser. A customer's order exists only on their device; you never see it. Biggest blocker, and not fixable with hosting config.
2. **No payment provider.** Checkout collects no card details and says so.
3. **No authentication.** Anyone can open Admin. Client-side checks are not a security boundary.
4. **No email.** No order confirmation reaches the customer.

Pointing a domain at the current build gives you a convincing storefront that cannot take an order — useful for showing people, dangerous to advertise as open.

---

## Rollback

Nothing here is destructive.

- **Wrong DNS:** edit or delete the two records. The `*.vercel.app` URL keeps working throughout.
- **Revert the domain:** remove it in Vercel → Settings → Domains, and point DNS back.
- **Old host still running:** keep it until the new domain has been verified for a few days.

Keep the registrar on a payment method you control, with 2FA on. A lapsed domain is far more disruptive than any of the above.

---

## Checklist

**Domain**
- [ ] Owner available — domain add and DNS both need them, not a contributor
- [ ] Confirmed this is a public-preview launch, not a shop taking orders
- [ ] Confirmed `shopgreencart.com` is buyable at a registrar, at a sane renewal price
- [ ] Checked `greencart` / `shopgreencart` for trademark conflicts
- [ ] Domain registered, registrar 2FA on
- [ ] Checked `greencart` for trademark conflicts
- [ ] Read the exact values from Vercel's domain card
- [ ] Old `A` record on `@` deleted
- [ ] `A @` → Vercel's IP added
- [ ] `CNAME www` → Vercel's target added (no A record on `www`)
- [ ] Cloudflare proxy disabled if applicable
- [ ] `dig` returns expected values for both hosts
- [ ] Both domains show **Valid Configuration**
- [ ] HTTPS padlock valid on the real domain
- [ ] `www` set as primary, apex redirects to it
- [ ] Checked in a private window, on a phone, on mobile data
- [ ] Email on the domain still works, if used

**Before announcing**
- [x] CI active and passing
- [ ] CI made a **required** status check
- [ ] Deployment protection on for previews
- [ ] Privacy notice added
- [ ] Contact route added
- [ ] Admin tab hidden or protected
- [ ] Images compressed
- [ ] Uptime monitoring configured

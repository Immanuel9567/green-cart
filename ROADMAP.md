# Storefront and admin roadmap

**Status: planning only.** This roadmap is based on [the original plan](.for%20agent/implementation%20roadmap.md) and the applicable guidance in [the skill catalogue](.for%20agent/Agent%20skills.txt). All future phases below are **not started**. Review and approve the scope and design of a phase before implementing it. The [mind map](MINDMAP.md) gives a visual overview.

## Where we are

The current site is a static HTML/CSS/JavaScript storefront with **a real, server-side card payment gateway** and a browser-local admin. Catalogue edits, cart and saved items, promotions, customers, stock and order references live in the current browser's storage. The admin is not access-controlled; data does not sync across browsers or devices.

What is real as of 2026-11-06:

- **Payments.** `api/initialize-payment.js` prices the order server-side and `api/verify-payment.js` confirms the charge with Paystack. A signed webhook covers the case where the browser disappears. The browser cannot set a price or declare a payment successful.
- **Money is in naira by default** with a USD switch; catalogue prices are stored in USD and converted for display only, at a pinned and dated rate.

What is **not** real, and must not be described as if it were:

- **A paid order is stored only in the buyer's browser.** There is no database, so the seller does not receive the order. The webhook logs the confirmed payment and reports `persisted: false`. Sales are recoverable from the Paystack dashboard and nowhere else.
- **Payments are off in the committed config.** `payments.publicKey` is empty, so the checkout refuses rather than pretending. Switching it on needs the owner's Paystack account (see [docs/PAYMENTS.md](docs/PAYMENTS.md)).
- **The admin is public** to anyone who knows the URL. It is out of the public nav for tidiness, not by way of security.
- Supabase is proposed in the source plan but is **not configured or integrated**. The missing database is the single biggest gap between this and a store that can be left unattended.

The source plan's schema → security → APIs → admin lists → forms → analytics sequence is retained below. The current local UI is a prototype to preserve and adapt, not proof that the future backend phases are complete.

## Progress log

Completed work that is **not** a roadmap phase, recorded so the current state is visible. Every phase below is still **not started**; this log does not move a phase forward. Details and verification live in [CHANGELOG.md](CHANGELOG.md).

| Date | Step | Where | Status |
| --- | --- | --- | --- |
| 2026-10-30 | Browser-local storefront, admin demo, promotions, local analytics, tests and docs | `js/`, `css/`, `index.html`, `tests/` | Done — not deployed on its own |
| 2026-10-30 | Dedicated reloadable product detail pages; simplified hero; checkout-inverse variant colors | `js/app.js`, `js/products.js` | Done |
| 2026-10-30 | Mobile bottom navigation pill, tap-highlight suppression, theme gradient notices | `css/style.css`, `js/app.js` | Done |
| 2026-11-05 | Percentage discounts round half up at the cent level; order status flow and refund eligibility enforced in the store and mirrored in the admin UI; jsdom DOM tests added to `npm test` | `js/store.js`, `js/app.js`, `tests/` | Done — not deployed; Playwright suite not run |
| 2026-11-05 | Working rules added: a roadmap progress log after every step, and a per-step check-in questionnaire that must mark a recommended option | `agent.md`, `AGENTS.md`, `ROADMAP.md` | Done — docs only |
| 2026-11-05 | All 14 built-in product images are now local generated assets; the 8 Unsplash hotlinks are gone and a test enforces local files | `js/products.js`, `assets/images/`, `tests/store.test.js` | Done — not deployed |
| 2026-11-05 | Playwright suite made runnable in the sandbox via an npm-shipped Chromium 153 and its libraries; fallback tests rewritten to force a real load failure | `README.md`, `tests/e2e/product-page.spec.js` | Done — full suite green, **38/38** |
| 2026-11-05 | PR #5 merged to `main` (`8ae06a5`); production deploy verified to serve local images and both fixes | — | Done — live at e-commerce-proj-umber.vercel.app |
| 2026-11-06 | Card payment gateway (`api/`), server-side pricing, signed webhook, naira/USD display currency, honest checkout, legal pages, SEO assets, `docs/PAYMENTS.md` | `api/`, `js/currency.js`, `js/payments.js`, `js/config.js`, `legal/`, `docs/PAYMENTS.md` | Done — **payments off until an owner public key is added** |
| 2026-11-06 | Buyer-facing order records still browser-only; webhook confirms payments but persists nothing | `api/paystack-webhook.js` | **Open** — needs the Phase 1 database |
| 2026-11-06 | Product images cut from 3.79 MB to 980 KB (−74%); gateway moved to plain Node HTTP so the webhook can verify signatures; dead currency conversion removed; contact details centralised with a placeholder guard | `assets/images/`, `api/_lib/http.js`, `js/contact.js`, `js/legal.js` | Done — 82 unit/DOM tests, 49 browser tests, 37/37 mutations |
| 2026-11-10 | **Search rewritten** as a relevance-ranked engine (`js/search.js`): weighted fields, accent folding, whole-word prefix matching, and a synonym table. "watch" now finds the chronograph, "headphones" the AURA, "coffee" the French press — all of which returned nothing before | `js/search.js`, `js/app.js`, `tests/search.test.js` | Done — 11 tests, verified in a browser |
| 2026-11-10 | **Shared store database** added: Postgres schema (`shop_state`, `orders`, `payment_events`), a Supabase SQL-over-HTTPS runner, an optimistic-concurrency document layer and integer-kobo orders | `db/` | Done — 32 tests against a real SQLite database |
| 2026-11-10 | **Admin authentication**: password → signed, expiring, HttpOnly/SameSite=Strict session token; every admin endpoint refuses an unauthenticated caller; login throttled | `api/admin-login.js`, `api/_lib/session.js`, `api/admin/` | Done — 17 tests incl. forged and foreign-secret tokens |
| 2026-11-10 | **Pay-on-delivery checkout**: shoppers can now complete an order. The server re-prices from its own catalogue, stores the order, and the admin panel reads it from the database instead of localStorage | `api/orders.js`, `js/sync.js`, `js/app.js`, `index.html` | Done — verified end to end across two browsers |
| 2026-11-10 | Honesty rules enforced end to end: no database ⇒ the order is reported as **not stored** and the shopper is told to keep the reference; a lost version race is reported, never silently clobbered | `js/sync.js`, `api/orders.js` | Done — tested |
| 2026-11-10 | Fixed in flight: SQL splitter swallowed every statement after an apostrophe in a comment (off-by-one on the `--` opener); Supabase result arrays were parsed in only one of two shapes, silently returning zero orders; admin order totals were double-converted (a $299 order displayed as ₦543,330,218) | `db/index.js`, `js/app.js` | Done — each has a regression test |
| 2026-11-10 | All suites green: **152** unit/DOM tests, **49** browser tests | `tests/` | Done |
| 2026-11-06 | Business contact details (email, WhatsApp, street address) still placeholders | `js/contact.js` | **Open** — owner must supply; legal pages show a red warning until then |
| 2026-11-05 | CI workflow prepared to run `npm test` and `npm run test:e2e` on PRs and pushes to `main` | `ci/tests.yml`, `ci/README.md` | **Blocked** — repo connection cannot write `.github/workflows/`; needs owner to move the file into place |
| 2026-11-05 | Products can be archived and restored instead of deleted; permanent deletion is archived-only and refused for products with past orders; admin status filter and a retired-product page added | `js/store.js`, `js/app.js`, `index.html`, `css/style.css`, `tests/` | Done — merged in PR #6 (`b01ac14`), verified live |
| 2026-11-05 | Production deploy verified for PR #6: archiving, discount, status/refund rules and local images all live | — | Done — Admin archive UI could not be clicked from here |
| 2026-11-05 | Repeatable mutation checks added (`npm run test:mutation`); 10 guarded rules verified as genuinely covered | `tests/mutation-check.js`, `package.json` | Done — 10/10 mutations caught |
| 2026-11-05 | CI activation handed off: browser-only instructions added for a maintainer, since the automated connection cannot write workflow files | `ci/README.md`, `README.md` | **Pending** — needs a maintainer to create `.github/workflows/tests.yml` |
| 2026-11-05 | Admin lists gained search, status filters and paging for products, inventory and orders, backed by an exported `paginate()`/`matchesQuery()` pair shaped like a server API | `js/store.js`, `js/app.js`, `index.html`, `css/style.css`, `tests/` | Done — client-side only; 30 unit/DOM tests, 40 browser tests, 14/14 mutations caught. A hollow low-stock assertion was caught and fixed |
| 2026-11-05 | Customers and Promotions joined the paged admin lists: name/email/city search on customers, status filters and search on promotions, both paged at 10 | `js/app.js`, `index.html`, `tests/` | Done — all five admin lists now consistent; 32 unit/DOM tests, 41 browser tests, 16/16 mutations caught |
| 2026-11-05 | Pager no longer drops keyboard focus to `<body>`: focus returns to the arrow used, else the other arrow, else the live status line, and now survives re-renders from archiving as well as paging | `js/app.js`, `tests/` | Done — 35 unit/DOM tests, 42 browser tests, 18/18 mutations caught |
| 2026-11-05 | Paging now announces the visible range through one persistent live region; the old `aria-live` sat inside the rebuilt pager and was verifiably destroyed on every page change. Mutation checks refuse to start from a dirty tree | `js/app.js`, `index.html`, `tests/` | Done — 37 unit/DOM tests, 43 browser tests, 20/20 mutations caught |
| 2026-11-05 | The five admin lists now share one renderer; the empty row's column count comes from the table itself and empty messages are escaped once | `js/app.js`, `tests/` | Done — 41 unit/DOM tests, 43 browser tests, 22/22 mutations caught |

| 2026-11-06 | Rebranded from V8's to GreenCart across the UI, page titles, package name and docs; storage key renamed with a one-way migration so carts and orders survive | `index.html`, `js/app.js`, `js/store.js`, `package.json`, `tests/` | Done — 42 unit/DOM tests, 43 browser tests, 24/24 mutations caught |
| 2026-11-06 | CI activated at `.github/workflows/tests.yml` and its first run passed; duplicate `ci/tests.yml` removed and `ci/README.md` rewritten; hosting/domain runbook added | `.github/workflows/tests.yml`, `ci/README.md`, `docs/GO-LIVE-HOSTING.md` | Done — **not enforced**: needs a branch ruleset requiring the check |

| 2026-11-06 | Unreadable saved data is reported in the admin instead of silently reverting to seed data; loading states deliberately not added because local reads are synchronous | `js/store.js`, `js/app.js`, `index.html`, `css/style.css`, `tests/` | Done — 44 unit/DOM tests, 44 browser tests, 27/27 mutations caught |
| 2026-11-06 | Contributor permissions documented: what a non-owner cannot do on GitHub and Vercel, and the workarounds that keep the work moving | `docs/CONTRIBUTOR-PERMISSIONS.md` | Done — docs only |

Deliberately **not** done yet, and still needing owner approval: the Supabase backend, authentication and roles, shared data, real payments and refunds, and server-side enforcement of the status and refund rules now modelled locally. The rules added on 2026-11-05 exist only in browser code; a real backend must re-implement and test them server-side in Phases 1–2.

## Decisions and approval gates

Before starting a phase, agree on its design, acceptance criteria, dependencies and rollout/rollback. Do not create a Supabase project, apply migrations, connect payment services or migrate customer data without the owner's approval.

- Confirm the Supabase project, region, environments, budget and who can access them. Decide how development, staging and production are isolated.
- Confirm whether products are physical, digital or both; the currencies, markets, taxes, delivery methods and refund/return policies. Do not infer these from the owner's location.
- Choose the payment provider and order/payment/refund state model; approve the fulfillment and customer-support workflows.
- Define team roles, invitations, account recovery, who can see customer information, and who may issue refunds or change roles.
- Decide what, if any, browser-local products or demo orders should be imported, with consent, a backup and a duplicate-handling plan. Previously generated but unsaved order references cannot be reconstructed.
- Review privacy, retention, deletion, audit-log, backup and incident-response requirements; decide whether historical orders are archived or retained immutably instead of deleted.

## Phase 0 — design and delivery plan

**Status: not started** · Depends on owner decisions above.

- [ ] Inventory the current data model and UX; identify which demo behavior must be retained, replaced or explicitly retired.
- [ ] Agree on architecture: Supabase Postgres, Auth and RLS for data access; server-side functions/endpoints for privileged or payment-related operations. Select any other services deliberately.
- [ ] Define entity relationships, role permissions, order/payment state transitions, error handling and a safe local-demo-to-backend migration plan.
- [ ] Break the approved design into small testable changes and document any dependencies, costs and operational risks.

**Acceptance:** the owner has approved an actionable design and phase order, with unresolved decisions recorded rather than guessed.

## Phase 1 — database, identity and authorization

**Status: not started** · Depends on Phase 0 approval.

- [ ] Create versioned, reviewable Postgres migrations and a rollback/restore procedure for profiles and roles, products, product variants, stock, orders and order-item snapshots. Plan customer, promotion and audit records as needed. Variants need stable SKUs, attributes such as size/color, prices and stock quantities.
- [ ] Define appropriate constraints, indexes and archival/soft-delete behavior. Keep historical order items and financial records auditable; do not hide or delete them merely because a product is archived.
- [ ] Configure Supabase Auth and server-controlled role assignments. Proposed roles are **admin**, **fulfillment** and **viewer**, alongside ordinary customers. A customer must never be able to grant themselves a staff role.
- [ ] Enable RLS and least-privilege policies on every exposed table. Anonymous users may read only published catalog information; customers may read only their own appropriately limited order information; staff receive only their approved permissions. Ordinary customers must not read other customers' orders or private inventory. Exact inventory counts, customer PII and audit logs are not public.
- [ ] Keep service-role keys and payment secrets on trusted servers only; never ship them in HTML, JavaScript, Git, logs or a public Vercel environment variable. Protect storage uploads as well as database rows.
- [ ] Write automated positive and negative tests for anonymous users, customers, each staff role and attempted role escalation.

**Acceptance:** migrations are reproducible in an approved non-production environment, authorization/RLS tests pass, and a security review confirms there is no client-side privilege boundary or exposed secret.

## Phase 2 — secure admin and commerce actions

**Status: not started** · Depends on Phase 1.

- [ ] Design and implement authenticated, validated server-side actions or APIs; authorize each operation by role, not just by whether the caller can open an admin page. Keep viewer access read-only and decide exact fulfillment permissions with the owner.
- [ ] Support paginated product CRUD, variants, prices, stock adjustments and product archiving; preserve order snapshots. Use concurrency-safe transactions and validation for stock and money.
- [ ] Implement allowed fulfillment transitions, initially considering Pending → Processing → Shipped → Delivered, with explicit cancellation, payment and refund rules. Reject illegal jumps on the server, not only in the UI.
- [ ] Maintain an audit trail for sensitive changes, including actor, action, time and target; avoid recording secrets or unnecessary personal information. Define failure behavior and retention.
- [ ] Introduce payment/refund actions only after a provider is approved. Calculate totals and prices server-side, use idempotency for orders/refunds, and verify signed provider webhooks. Never mark an actual payment or refund successful solely because a browser says so.

**Acceptance:** API/action tests cover authorization, invalid input, illegal state changes, audit events, stock races and payment webhook/idempotency behavior. Unauthorized or duplicate requests cannot change protected data.

## Phase 3 — shared admin shell and lists

**Status: not started** · Depends on the relevant Phase 2 APIs.

- [ ] Adapt the existing responsive admin to authenticated roles without discarding the current visual style or accessibility requirements. Evaluate a collapsible sidebar, breadcrumbs and profile controls against the approved design.
- [ ] Add reusable, accessible data tables with server-side pagination, search and filters, including loading, empty and error states.
  - Partly done 2026-11-05, ahead of Phase 1: all five admin tables — products, inventory, orders, customers and promotions — now search, filter and page against browser-local data through one shared renderer rather than five copies. Paging is keyboard-usable and screen-reader friendly: focus stays in the pager across page changes and re-renders, and each page change is announced through a live region that is never rebuilt. Paging is shaped like a server API (`page`, `pageCount`, `pageSize`, `total`, `start`) so a backend can take over the same contract. Loading and error states, reusable table components and true server-side behaviour still wait on the Phase 2 APIs.
- [ ] Connect product/inventory and order lists. Include order ID, customer, date, total and fulfillment status; identify low stock, initially using the source plan's **fewer than 5** threshold unless the owner chooses another value.
- [ ] Ensure role-restricted actions are absent or disabled as appropriate; the server remains the final authority.

**Acceptance:** approved users can work with real, paginated non-production data on desktop and mobile, while role boundaries and accessible controls are verified end to end.

## Phase 4 — product, order and customer details

**Status: not started** · Depends on Phases 2–3.

- [ ] Build validated product/variant forms, including a manageable size/color matrix, unique SKU, price, stock and image handling; show actionable validation errors.
- [ ] Provide order details, packing slip, tracking number and permitted fulfillment actions. Add explicit confirmations for archiving and any refund or other destructive operation.
- [ ] Show customers their own saved order references and current order status; allow authorized staff to access only the customer information needed for their duties.
- [ ] Replace local promotions with server-validated percentage/fixed codes and scheduled sales only after defining precedence, eligibility and audit behavior. Preserve the current non-stacking rule unless an approved design changes it.
- [ ] Handle payment, refund, inventory and network failures without suggesting money has moved when it has not.

**Acceptance:** forms and confirmations are tested against validation and authorization failures; an approved non-production order can be followed from creation through permitted fulfillment, with reliable status and reference history.

## Phase 5 — analytics and operations

**Status: not started** · Depends on trustworthy order, payment and inventory data from earlier phases.

- [ ] Agree on definitions for gross revenue, order count, average order value and low-stock count, including treatment of canceled/test orders, refunds, taxes, shipping and time zones.
- [ ] Add efficient, permission-aware database aggregations and a sales trend chart for approved ranges such as 24 hours, 7 days and 30 days; choose a library only if useful.
- [ ] Test totals against known fixtures and empty/large datasets. Explain when data is delayed or incomplete; do not label simulated sales as real revenue.
- [ ] Establish monitoring, error reporting, accessible support procedures, backup/restore tests, secret rotation and incident response.

**Acceptance:** dashboard numbers match independently checked fixtures, respect role and privacy rules, and operations owners can restore and troubleshoot the system.

## Phase 6 — production readiness and launch

**Status: not started** · Depends on acceptance of Phases 1–5 and explicit launch approval.

- [ ] Run security, accessibility, responsive, regression and end-to-end checks in a production-like environment; verify payment-provider test-mode and webhook behavior.
- [ ] Review Vercel and Supabase configuration, environment separation, domains, HTTPS, quotas, privacy disclosures and deployment protection. Never put privileged secrets in browser-exposed configuration.
- [ ] Rehearse data migration, backups and rollback; verify alerts and a named owner for operations. Obtain final sign-off before switching to real transactions.
- [ ] Launch incrementally, monitor errors and payments, and document the deployment, risks and recovery procedure in the changelog.

**Acceptance:** the owner approves a documented go/no-go checklist; real orders and payments are enabled only after security, payment and operational checks pass.

## Working agreement

Use [agent.md](agent.md) for skills, safety, test and changelog rules. Record each approved change and verification in [CHANGELOG.md](CHANGELOG.md). A completed phase requires passing its acceptance criteria and owner review; moving the checklist forward is not authorization to start the next phase.

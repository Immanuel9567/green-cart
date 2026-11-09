# Changelog

This file records meaningful repository changes and the checks that support them. See [agent.md](agent.md) for the required entry and handoff rules. Dates use the owner's local date; `Unreleased` means the work is not yet part of a named release.

## Unreleased — 2026-11-06 (fix pass)

### Fixed — the webhook would have rejected every real payment

- `api/paystack-webhook.js` read the signed bytes for the HMAC, then parsed
  `request.body` for the event. On a streamed request `request.body` is
  `undefined`, so **every genuine Paystack webhook would have failed** with "Body
  was not JSON" while looking correct in review. It now parses the bytes it just
  verified. Caught by testing over a real HTTP server with a real HMAC rather
  than only through an in-process mock.

### Fixed — the gateway depended on platform behaviour that was not in effect

- The endpoints used Vercel's convenience helpers (`request.body`,
  `response.status()`, `response.json()`) and a `module.exports.config =
  { api: { bodyParser: false } }` export to switch body parsing off. **Vercel does
  not read that export from `/api`** — it is a Next.js convention — and the
  documented opt-out is a project-wide `NODEJS_HELPERS=0`, which would have
  removed `response.status()`/`json()` from the other two endpoints as well. The
  configuration was therefore both useless and, if it had worked, self-defeating.
- All three endpoints now use plain Node HTTP through a new `api/_lib/http.js`,
  which reads the stream **before** ever touching `request.body` (reading it on
  Vercel invokes the parser and consumes the stream). They behave identically with
  the helpers on or off, need no `@vercel/node` dependency, and run on any Node
  host.
- Verified on a bare `node:http` server: unsigned webhook → 401, wrong signature →
  401, correctly signed → re-verified, `GET` on a POST endpoint → 405 with
  `Allow: POST`.

### Fixed — dead money code that could drift

- `js/currency.js` exported `toMinorUnits()`, a second implementation of
  "convert a price into a charge amount", used nowhere. Two implementations of
  money maths is how a store ends up charging a different figure from the one it
  displayed. Removed, with a note in `js/config.js` and `js/currency.js` saying the
  server alone converts amounts.

### Fixed — 3.8 MB of images on a mobile-first store

- Fourteen product photos were 1024–1254px JPEGs of 400–556 KB, served whole to
  every visitor on every load. Resized to 1000px (the detail page renders ~660 CSS
  px, so this is still sharp at 2×) and re-encoded at quality 84: **3.79 MB →
  980 KB, a 74% reduction**. Checked visually at `deviceScaleFactor: 2`, not just
  by file size. Originals kept outside the repo.

### Added — contact details with a warning that cannot be missed

- `js/contact.js` holds the business email, WhatsApp number, address and hours
  used by the legal pages and the footer. The legal pages render from it via
  `data-contact` hooks, so a number that is right on the contact page cannot be
  stale in the footer.
- While any required detail is still a placeholder the pages show a red banner
  **naming exactly what is missing** ("email address, street address, WhatsApp
  number"), and channels that do not exist are hidden rather than shown as empty
  rows. `tests/legal.test.js` asserts this, and the guard test **fails the moment
  real details are filled in** — verified by filling them in and watching three
  tests go red, so the suite cannot silently rubber-stamp a half-finished store.

### Verification — fix pass

- `npm test`: **82/82** (was 76). New `tests/legal.test.js` covers the warning,
  hidden channels, real details replacing placeholders, and the placeholder guard.
- Mutations: **37/37 caught** (was 34). New mutations cover the webhook parsing
  the wrong source, verification skipping the amount check, and the legal pages
  presenting as finished while details are missing.
- Endpoints exercised over real HTTP with a real HMAC signature, not only
  in-process.

## Unreleased — 2026-11-06 (later)

### Added — a real card payment gateway, honest until switched on

- **Server-side pricing.** The browser now sends `[{id, quantity}]` and the server prices the order from `js/products.js`. A tampered request cannot buy a ₦403,058 item for ₦100. `api/_lib/pricing.js` reuses the store's own `Store` class, so the discount and shipping rules have exactly one implementation rather than two that drift.
- **`POST /api/initialize-payment`** prices the bag, refuses unknown/oversized/out-of-stock lines, and asks Paystack for a transaction with the amount it computed. The quoted amount in kobo travels inside `metadata.expectedKobo`.
- **`POST /api/verify-payment`** is the only code allowed to say money moved. It re-checks with Paystack that the transaction succeeded, that the currency is NGN, and that the amount equals the quote. A cheaper transaction cannot settle an expensive order.
- **`POST /api/paystack-webhook`** is signature-checked (HMAC-SHA512, constant-time compare) and re-verifies the transaction rather than trusting the payload. Vercel's body parser is disabled for this endpoint, because a re-serialised body can never match the signature — a trap that would have silently rejected every real webhook.
- **Prices now display in naira by default**, with a header switch to US dollars. Catalogue prices stay in USD; conversion is display-only, so changing currency cannot change what an order is worth. Rate pinned at **₦1,348.02 per $1**, checked 2026-11-06 against exchangerate-api.

### Fixed — three ways the storefront was willing to lie

- **The favicon still showed the old brand's `V`.** It is an inline `data:` URI, so every text-based rebrand search missed it. Now `G`, plus a real `favicon.svg`.
- **Every order reference was minted `AURA-YYYY-XXXX`** — the old brand on every customer receipt. Now `GC-`. Default promotion `AURA15` → `GC15`; the theme storage key moved from `aura_theme` to `greencart_theme`, reading the legacy value once so an existing visitor keeps their choice.
- **Three fake payment buttons (`Apple Pay`, `Credit card`, `Crypto / BTC`) collected nothing** while the form said orders were placed. They are gone. One `Card` option remains, and with no public key configured the checkout states that payments are not switched on and **refuses to create an order** — verified in a real browser: the toast appears and `orders.length` stays 0.

### Added — go-live essentials

- `legal/shipping.html`, `privacy.html`, `terms.html`, `contact.html`, linked from the footer. Every unknown — delivery windows, return window, business name, address, contact channels — is marked `PLACEHOLDER — REPLACE BEFORE TAKING REAL ORDERS` in a red callout rather than invented.
- `robots.txt`, `sitemap.xml`, `favicon.svg`, canonical URL, Open Graph and Twitter metadata, `vercel.json` with security headers and `no-store` on `/api/*`.
- Admin removed from the public nav (reachable with `?admin=1`). This is convenience, not security: anyone with the URL can still open it. Stated as such in the code.

### Fixed — accessibility regression introduced by the new header control

- Adding the currency switch pushed the header to 366px inside a 320px viewport, breaking horizontal scroll on small phones. The theme switch keeps its symbol and its accessible name; its words move to a visually-hidden span below 480px. Re-measured at 320/360/390/420/480/680/820/1100/1440px: all `scrollWidth` values now equal the viewport.

### Verification — overhaul

- `npm test`: **76/76** (was 44). New: 12 checkout-honesty tests and 20 gateway tests. The gateway tests focus on refusal — forged webhook signatures, wrong currency, amount mismatch, pre-parsed bodies, missing secret key, out-of-stock lines — because a gateway that is generous with bad input is worse than one that is down.
- Playwright: **47/47**. New `currency.spec.js` covers the naira default, the switch, persistence across reload, and that a naira order is still recorded against the same dollar value.
- Mutations: **34/34 caught** (was 27). One survived on the first run — *"checkout proceeds even though payments are switched off"* — because the test counted orders, and removing the guard still produced zero orders via a different path. The test now asserts the provider is never contacted, which is the property that actually matters. Fixed rather than deleted.
- `docs/PAYMENTS.md` documents the Paystack account creation, which key may be public, where the secret key goes, how to test, and what is still missing.

### Still not real

- **A paid order is still recorded only in the buyer's browser.** The webhook confirms the payment to the server and reports `persisted: false`; it does not pretend to have saved an order. Sales are recoverable from the Paystack dashboard until a database exists (`ROADMAP.md` Phase 1–2).
- Payments remain **off in the committed config**: `payments.publicKey` is empty, so the checkout refuses. Switching it on needs the owner's Paystack account (see `docs/PAYMENTS.md`).

## Unreleased — 2026-11-06

### Fixed — unreadable saved data vanished without a word

- If the stored value was corrupt or the wrong shape, the shop **silently** reverted to seed data. Reproduced end to end: with one real order saved, corrupting the storage key and reloading left **0 orders**, no page error, and nothing on screen to suggest anything was wrong. The stored bytes were still present, so the data was recoverable while the UI implied it had never existed.
- `Store` now records `recovery = { reason, bytes }` when a key exists but does not parse, or parses to something that is not an object. A key that was never written stays silent — a first visit is not a problem, and conflating the two would show an error banner to every new visitor.
- The admin shows a `role="alert"` banner above the panels: *"Saved data could not be read. The catalogue and orders below are the built-in defaults, not your saved data (20 bytes stored). Nothing has been overwritten yet: saving any change will replace it."* It states the byte count so the claim is checkable, and does **not** claim the data was deleted, because it wasn't.

### On loading states, deliberately not built

- The Phase 3 table item asks for loading and error states. Error states now exist where failure is genuinely possible. **Loading states were not added**: local storage reads are synchronous, so there is no interval to show a spinner in, and inventing an artificial delay to make a skeleton visible would be theatre that also makes the app slower. Recorded in `ROADMAP.md` as waiting on the Phase 2 APIs rather than ticked off.

### Verification — recovery state

- `npm test`: **44/44**. The store test covers five cases — never written, unparseable, wrong shape, valid, and successfully migrated — and a DOM test covers the banner's wording, `role="alert"`, the byte count, dismissal, and that a re-render does not resurrect a dismissed banner.
- Playwright: **44/44**, with a browser test that saves a real order, corrupts the real key, reloads, confirms the order really is gone, checks the banner, confirms the stored bytes are untouched, dismisses it, then confirms a clean profile shows no banner.
- `npm run test:mutation`: **27/27 caught**. Three mutations target this: discarding unreadable data silently, mistaking a first visit for unreadable data, and never showing the banner.
- This work previously sat unmerged in PR #13 on a branch that was abandoned; it is rebuilt here on top of the GreenCart rename, including the `migratedFrom` interaction.

### Added — contributor permissions guide

- `docs/CONTRIBUTOR-PERMISSIONS.md`: what a repository **contributor** can and cannot do on GitHub and Vercel, the exact errors each blocked action produces, and the workarounds that stay inside the rules. Written because the person doing this work does not own the project.

### Changed — the brand is now GreenCart

- Renamed from **V8's** to **GreenCart** ahead of the domain purchase, so the address and every page agree. Seven places in `index.html` (title, brand logo and its `G` badge, aria-label, admin header kicker, footer, copyright), four `document.title` assignments in `js/app.js`, the `package.json` name, the README title and the mind map.
- The visible logo is `G GreenCart.` — the existing `.brand-dot` accent is kept, so the mark changes without changing the page's visual language.

### Changed — the storage key moved with the brand, without losing anyone's data

- `v8_store_v1` → **`greencart_store_v1`**. On boot, if the new key has never been written, the store copies any value found under a legacy key across and records `migratedFrom`. Carts, saved items and order history survive the rebrand.
- The old key is **not deleted**, so a rollback is possible.
- Once the new key exists it always wins: a stale legacy value cannot override current data. Both directions are covered by tests.
- `readRaw()` was added to `Store` so "never written" can be told apart from "written but unparseable" — the same distinction the unmerged recovery work needed.

### Changed — CI housekeeping

- **`ci/tests.yml` deleted.** The workflow is active at `.github/workflows/tests.yml` and the two copies were verified byte-identical first; keeping both risked someone editing the reference and seeing no effect.
- `ci/README.md` rewritten. It previously said the workflow was switched off and gave instructions to activate it — both now false. It documents the real state, the triggers, what runs, how to make the check **required**, and how to read a failure.
- **CI is active but not enforced.** No branch ruleset exists, so a red run does not block a merge, and `main` deploys to production on every push. Recorded in the README and the go-live runbook rather than left implied.
- Added `docs/GO-LIVE-HOSTING.md`: the domain and hosting runbook, in GreenCart's name.

### Verification — rebrand

- `npm test`: **42/42**. One new store test covers migration in both directions — legacy adopted when the new key is absent, current key preferred when both exist — and confirms the old key is left intact.
- Playwright: **43/43**. The one test that read `v8_store_v1` directly was updated to the new key, which is the only place a hardcoded key could have silently stopped asserting anything.
- `npm run test:mutation`: **24/24 caught**, including two new mutations — ignoring a legacy save, and letting a stale legacy save override current data.
- Rendered check in Chromium: title, logo, aria-label, footer and admin kicker all read GreenCart.

### Changed — the five admin lists share one renderer

- Products, Inventory, Orders, Customers and Promotions each repeated the same six steps: sync the filter pills, remember the matching items, paginate, choose an empty message, count columns for the empty row, and draw the pager. That is now `renderAdminList({ state, bodyId, pagerId, items, row, emptyMessage, label, spokenLabel, afterRender })` plus `syncFilterPills(selector, datasetKey, current)`. Each list supplies only its filter and its row markup.
- The empty row's `colspan` is now **read from the table's own `<thead>`** instead of being hard-coded per list, where it would silently drift when a column was added. Verified: products 6, orders 6, inventory 5, customers 5, promotions 5.
- Empty messages are now **plain text escaped once** inside the helper. Previously one list escaped its query into the message and the caller escaped the result, which is easy to get wrong in both directions. A hostile query now renders literally with no elements created and no double-escaping (`<img src=x onerror=alert(1)>` came back as text, not markup).
- Behaviour is unchanged: all five lists produce the same empty messages as before, checked side by side against the pre-refactor build. The `js/app.js` file grew slightly (1084 → 1123 lines) because the shared helper is documented, but the duplicated paging logic now appears once rather than five times.

### Verification — shared admin list renderer

- `npm test`: **41/41**. Three tests on the helper itself (column count derived per table, single escaping, page clamping) and one that pages a 25-item list through all three pages and asserts the **body contents** — items 1–10, then 11–20, then 21–25 — not just the pager text.
- Playwright: **43/43**, unchanged, which is the point of a refactor: the same browser tests pass without modification.
- `npm run test:mutation`: **22/22 caught**. Two new mutations target the helper: hard-coding the column count, and paginating the body incorrectly.
- **A real gap was found by the new mutations.** "A shrunk list keeps its old page" initially **survived**, and it was not an equivalent mutant: with it the table body showed page one's rows while the pager correctly said "Page 2". No jsdom test checked body contents after paging, so the pager text alone looked right. The new page-contents test kills it.

### Added — page changes are now announced to screen readers

- Paging changed the visible rows silently. The `aria-live` region sat **inside** the pager, whose `innerHTML` `renderPager` replaces on every render, so the live region was destroyed and recreated in the same task as its text change. Verified in Chromium by tagging the node: after one page change the original element no longer existed. A live region has to be in the DOM *before* its content changes to be announced reliably, so the existing markup was not working.
- Added one persistent `#adminListAnnouncer` (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`, visually hidden) outside every pager, updated in place. The `aria-live` on the pager status line was removed, since that element is rebuilt every time and a live region there is unreliable.
- Announcements read like "Showing 11–14 of 14 products in the catalogue, page 2 of 2". Products and Inventory both say "products" on screen, so the spoken label names the list — otherwise switching between them produced an identical message that would announce nothing.
- A repeated identical message is cleared and rewritten with a forced reflow first, because a live region receiving the same text twice usually stays silent.
- **Two gaps found while testing, both fixed.** An empty list returned before the announcement, leaving the previous list's range in the region as if it described this list; it now clears. And switching admin tabs only toggled panel visibility, so the region kept describing the list just left; the opened list is now re-rendered so its own range is announced.

### Added — the mutation checker refuses to start from a dirty tree

- `npm run test:mutation` now refuses to run when `js/store.js` or `js/app.js` has uncommitted changes, because a half-applied mutation looks exactly like a dirty working tree and starting from one makes the next failure impossible to attribute. This is the guard that would have caught the interrupted run that left a mutation in `js/store.js` earlier in this session.
- Deliberate work in progress is still runnable with `ALLOW_DIRTY=1`; that was needed immediately, since editing `js/app.js` and then checking mutations before committing is the normal loop. Each case is diffed against the state found at startup, not against git HEAD.

### Verification — announcements and the mutation guard

- `npm test`: **37/37**. Two new jsdom tests: the live region persists across a re-render (checked by tagging the node and confirming the same node survives with its state), carries the right ARIA attributes, and ends up empty for an empty list; plus the repeat-announcement path.
- Playwright: **43/43** in Chromium 153, with a browser test that pages, confirms the tagged live region is the same node afterwards, checks no `aria-live` remains inside the pager, checks inventory sounds different from products, and checks an empty list announces nothing.
- `npm run test:mutation`: **20/20 caught**. Two new mutations — removing the announcement, and destroying the live region — are both killed.

### Fixed — paging dropped keyboard focus to the page body

- Pressing **Enter** on a pager arrow moved to the next page but left focus on `<body>`, so a keyboard or screen-reader user lost their place and had to tab back through the whole page on **every** page change. Reproduced in Chromium before the fix: `activeElement` went from the Next button to `BODY`.
- The cause is that `renderPager` rebuilds the pager's `innerHTML`, destroying the focused button. Focus is now restored after the re-render.
- **Chosen behaviour**: focus returns to the arrow just used. If that arrow is now disabled — the usual case, since reaching the last page disables Next — it falls back to the other arrow, and then to the live status line. The status line got `tabindex="-1"` so it can receive focus without adding another stop to the tab order.
- **A second, wider bug was found while testing.** Focus restoration in the click handler alone did not cover re-renders triggered by anything else. Archiving products while sitting on page 2 clamps the reader back to page 1 and **still** dropped focus to `<body>`, because no pager click had occurred. Handling it inside `renderPager` covers both paths, since every list funnels through it.
- A mouse click behaves the same way. Chrome focuses a button on mousedown, so the click arrives with the button focused and focus stays in the pager. An earlier assertion of mine claimed a click should leave focus elsewhere; that was wrong about browsers, and the test was corrected rather than the code.

### Verification — pager focus

- `npm test`: **35/35**. Three new jsdom tests: the focus path in both directions with the disabled-arrow fallback, the status-line fallback when neither arrow is usable, and focus surviving a re-render caused by archiving rather than paging. The focus test was **confirmed to fail** with the fix temporarily disabled, so it is not passing by accident.
- Playwright: **42/42** in Chromium 153, with a new browser test that pages the product table with the keyboard, checks `activeElement` after each move, verifies focus never lands on the body, and covers the shrinking-list case.
- `npm run test:mutation`: **18/18 caught**. Two new mutations — removing the focus restoration, and making the fallback blur instead of focusing a usable control — are each killed by the focus tests.
- jsdom will not focus an element inside a `hidden` section, so these tests open the Admin panel first; without that they failed for a reason unrelated to the code.
- **An interrupted mutation run left a mutation in the source tree.** Stopping `npm run test:mutation` mid-run skipped its `finally` block, leaving `js/store.js` altered, and the next `npm test` failed for a reason nobody had caused on purpose. The checker now registers `SIGINT`, `SIGTERM`, `SIGHUP`, `exit` and `uncaughtException` handlers that restore the in-flight file. The restore itself was confirmed against a real interrupted run (a mutation was on disk when the signal was sent and the file came back pristine), though the precise exit path varies with timing, so this is a safety net rather than a guarantee against `SIGKILL`.
- After that interrupted run, one `npm test` invocation failed on the new focus test with "Page 2 of 1" — the signature of the unclamped-paging mutation, i.e. a mutation still in flight rather than a defect in the focus code. It did not reproduce in **6 consecutive full runs**, and the test passes in isolation and in the full suite.

### Added — customer and promotion lists join the paged admin

- Customers and Promotions now use the same search, filter and paging pattern as Products, Inventory and Orders, so all five admin lists behave consistently. This completes the list work approved after PR #8.
- **Customers** gained a search box matching **name, email and delivery city**, plus 10-row paging. City is not part of `getCustomers()`'s own shape, so it is read from the customer's orders and de-duplicated — the placeholder promises city search, so it had to actually work.
- **Promotions** gained a search box (code, discount text and status) and status filter pills — All, Active, Scheduled, Expired, Disabled — alongside paging. The pills keep `aria-pressed` in sync with the active filter.
- Filter and search changes reset to page one on both lists, and empty results explain themselves: "No customers yet.", "No customers match …", "No promotions are active right now.", "No expired promotions."
- Promotions paging is deliberately still client-side but server-shaped, like the other four lists.

### Verification — customer and promotion lists

- `npm test`: **32/32**. Two new jsdom tests drive a 12-customer list through paging, name/email/city search and the empty state, and take 13 promotions through status filtering, search and a status with no matches.
- Playwright: **41/41** in Chromium 153, with a new browser test that searches and pages promotions, toggles one off, and confirms it moves between the Active and Disabled filters.
- `npm run test:mutation`: **16/16 caught**. Two new mutations target this work — ignoring the promotion status filter, and dropping the customer name from search. The second **survived on the first run**, because the test searched by email and city but never by a name that an email could not match; it now searches `shopper 7` (the space makes an email match impossible) and the mutation is caught.

### Added — admin search, filters and paging

- The Products, Inventory and Orders admin tables can now be **searched, filtered and paged** instead of rendering every row at once. Customers and Promotions are unchanged.
- `js/store.js` gained two exported pure helpers: `paginate(items, page, pageSize)` returns `{ page, pageCount, pageSize, total, start, items }` and clamps out-of-range or non-numeric pages (page `99` of 25 items lands on the last page, `0` and `-5` land on the first, an empty list still reports one page); `matchesQuery(query, ...values)` matches case-insensitively on trimmed input and treats an empty query as "match everything". `ADMIN_PAGE_SIZE` is 10.
- Paging is deliberately **client-side but server-shaped**: a backend can later return the same object from a real endpoint without the renderers changing. True server-side pagination still needs the Phase 1–2 APIs, and the roadmap records that.
- Each list remembers its own query and page (`adminListState`), search and filter changes reset to page one, and a shared `renderPager()` draws "Showing 11–14 of 14 products · Page 2 of 2" with disabled arrows at the ends. Empty results say why: no products match the query, no orders with this status, nothing is out of stock, or everything is above the low-stock threshold.
- When a list is empty the pager is **hidden** rather than showing a second "nothing to show" line with dead arrows; the table’s own contextual message is the single thing to read.
- Orders gained status filter pills (all plus the six statuses) and inventory gained stock-level filters (all, needs attention, out of stock).
- Product ids are deliberately **not** searchable: every seed id starts with `aura-`, so including them made an id query match all 14 products.

### Verification — admin search, filters and paging

- `npm test`: **30/30** — 20 store tests and 10 jsdom DOM tests. New coverage: paging arithmetic and clamping, search across the fields an operator would type, product search resetting to page one, and order paging/filtering/search over a 23-order list.
- Playwright: **40/40** in Chromium 153, including a new browser test that pages the product table, searches it, filters inventory and checks an empty order list still renders a usable pager.
- `npm run test:mutation`: **14/14 caught** after adding four paging/search mutations (unclamped page, untruncated last page, whitespace-sensitive search, case-sensitive search). Each is killed by a named test.
- Two existing browser tests were updated, not weakened: they added a product and asserted its row was visible, which paging correctly moved to page two. They now locate the row through the search box — the same path an operator would use.
- One new assertion was found to be **hollow and was tightened**: the low-stock filter check counted rows, but the "everything is above the threshold" placeholder is itself a table row, so it passed when the filter returned nothing. The test now lowers AURA’s stock to 2, confirms it appears under **Low stock**, confirms the placeholder is gone, checks the out-of-stock message, then restores stock to 18.

### Added — repeatable mutation checks (restored)

- Added `npm run test:mutation` (`tests/mutation-check.js`): it breaks one guarded rule at a time in `js/store.js`, runs `npm test`, and reports whether the suite notices. Files are restored from the in-memory original in a `finally` block, and the script refuses to start if the baseline suite is already failing. A mutation that leaves every test green is reported as **SURVIVED**, because that behaviour is not genuinely covered.
- **Result: 10/10 mutations caught**, naming the specific failing test for each: dollar-level discount rounding, uncapped fixed discounts, missing status flow, cancellation without restock, early refunds, archived products leaking into the storefront, deleting products with past orders, archived products left in the bag, archived products counted in low stock, and unbounded bag quantities. The tree was verified unmodified afterwards and `npm test` still passed 25/25.
- This was previously written but never reached `main` — the branch holding it was reset before merging, so it is re-created here. It exists because a test in the archiving step initially passed for the wrong reason: `/archive/i` matched two different error messages, so removing the sales guard left the suite green.

### Documentation — CI handoff and production verification record

- CI activation is now a **handoff task for a maintainer**, because the automated connection cannot write workflow files and the owner is not in a position to do it. Added a short "action needed" note at the top of [`ci/README.md`](ci/README.md), a maintainer-task callout in the [README](README.md), and explicit click-by-click browser steps plus a terminal alternative (both requiring no local setup in the browser case). `ci/tests.yml` is already committed and present on `main`.
- Recorded the production verification that was performed but not previously logged: the live site at https://e-commerce-proj-umber.vercel.app/ serves the archiving implementation (`archiveProduct`, `restoreProduct`, `availableProducts`, `productHasSales`, and both deletion guards), the cent-level `promotionDiscount`, `ORDER_STATUS_FLOW` with restock-on-cancel and refund eligibility, 14 products with local images only, and a working `?product=aura-01` detail page. This confirms the PR #6 merge **is** deployed, contrary to the earlier "not re-verified" note.
- **Not verified live:** the Admin archive UI (filter pills, Archive/Restore buttons). Verifying it needs an authenticated interactive session, and the page-fetch tool used cannot click. The store logic those controls call is confirmed present.
- No application code changed in this step; `npm test` still passes **25/25** and no test behavior was touched.

### Added — product archiving replaces plain deletion

- Products can now be **archived** instead of deleted. Archiving stamps `archivedAt`, sets a derived `archived` flag, removes the product from the storefront grid, search, category counts, the featured hero, the inventory panel and the low-stock count, and removes it from bags and saved items. It stays in Admin under a new **Archived** filter and can be **restored** at any time with its stock, price and images intact.
- `Store` gained `availableProducts` (the storefront view) alongside `products` (the full Admin view). Bag reconciliation now ignores archived products, so an archived item cannot be checked out.
- Permanent deletion is now a deliberate two-step action: a product must be archived first, and **any product that appears in a past order is refused deletion outright** with a message pointing to archiving. This expresses the roadmap's "keep historical records auditable" rule in code. Unarchived, unsold products are never deleted by a single click.
- Admin products table gained a Status column, an Active/Archived/All filter, archived row styling, and context-dependent actions: active rows offer Edit and Archive; archived rows offer Restore and Delete permanently.
- An archived product's `?product=` URL now renders a **"No longer available"** page naming the product and linking back to the collection, instead of "Product not found". A bookmarked link or an old order reference no longer implies the product never existed.
- This supersedes the previous single-click Delete behaviour. Deleting a product that has sales is no longer possible at all, so its order snapshots and analytics stay inspectable.

### Verification — product archiving

- Five new business-logic tests and two new DOM tests were written first and failed against the old code as expected, then passed after implementation. One test I wrote initially passed for the wrong reason: `/archive/i` matched both the new "archive first" message and the sales-guard message, so it did not actually prove the sales rule. It now pins `/appears in past orders/`.
- **Mutation checks**: removing the sales guard fails exactly 1 test; removing the two-step rule fails exactly 2. Restored, all pass. This caught a genuinely hollow assertion before it shipped.
- Two implementation bugs were found and fixed during the work: archiving removed saved items but not bag items (`reconcileCart` did not exclude archived products), and my first design did not enforce the approved archive-before-delete ordering.
- `npm test` passed **25/25** (21 business-logic, 4 DOM) and `npm run test:e2e` passed **39/39** in Chromium 153. Two existing e2e tests that clicked a single click Delete were updated to the archive flow: the storefront one now archives and then deletes through the Archived filter, and the product-page one archives and expects "No longer available" instead of "Product not found".

### Added — continuous integration (prepared, not active)

- Prepared a CI workflow at [`ci/tests.yml`](ci/tests.yml): on every pull request and push to `main` it runs `npm ci`, `npm test`, `npx playwright install --with-deps chromium`, then `npm run test:e2e`, uploading `playwright-report/` and `test-results/` only when a step fails. GitHub-hosted `ubuntu-latest`, Node 22, npm caching, 15-minute timeout, read-only `contents` permission, actions pinned at `v7`.
- **It is not active and does not run.** GitHub requires the file at `.github/workflows/tests.yml`, but pushing that path was rejected: the GitHub App connection for this repository lacks the `workflows` permission (`refusing to allow a GitHub App to create or update workflow … without workflows permission`). The file was therefore committed as `ci/tests.yml` so the branch stays pushable, and [`ci/README.md`](ci/README.md) documents both ways to activate it (create the file through the GitHub web editor, or push with a token that has the `workflow` scope).
- No CI enforcement exists as a result. Green suites in PRs are still local runs until the file is moved into place.

### Verification — continuous integration

- Parsed the workflow with a YAML parser: valid, one `test` job, seven steps in the intended order, triggers `pull_request` and `push` to `main`.
- Confirmed `npm ci` succeeds from `package.json`/`package-lock.json` alone in a clean directory, then simulated the CI steps there with the working tree copied in: `npm test` passed **18/18** and `npm run test:e2e` passed **38/38** (43.5 s) against a clean install.
- Confirmed `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` exist at `v7` and still declare the `node-version`, `cache`, `name`, `path` and `retention-days` inputs used. The earlier `v4` pins were updated after checking, since `v7` is current.
- **Not verified:** any GitHub Actions run, because the workflow cannot be placed where GitHub looks for it with the current connection.

### Deployment — PR #5 merged and production verified

- **PR [#5](https://github.com/Immanuel9567/e-commerce-proj/pull/5) merged into `main`** as `8ae06a5` on 2026-11-05, covering 6 commits and 22 files (+848/−21). Mergeability was `MERGEABLE`/`CLEAN`; the Vercel preview check passed before merging. No CI workflows exist in the repository, so the green suites were local runs.
- Verified what is actually live at https://e-commerce-proj-umber.vercel.app/ rather than trusting the deploy status: the rendered storefront lists 14 products whose images all resolve to `assets/images/…` (the eight new files included) with **no** `images.unsplash.com` references remaining, and the deployed `js/store.js` contains both the `ORDER_STATUS_FLOW` rules and the cent-level `promotionDiscount` (`subtotalCents * percent + 50`).
- Vercel reported the `main` deployment as **success** (commit `8ae06a5`). This makes the previously merged product-detail and mobile-navigation work live as well.
- **Not independently confirmed:** direct byte-level fetch of the eight new JPEGs. Sandbox `curl` to Vercel is blocked and the page-fetch proxy returns HTTP 500 for binary content. The files are part of the same deployed commit that the live page and scripts come from, so a missing asset would have to be a Vercel static-serving fault; this was not tested from a normal browser network.
- Post-merge re-run on `main`: `npm test` **18/18** and `npm run test:e2e` **38/38** (43.4 s). A first `npm test` attempt reported 1 failure; the cause was `node_modules/jsdom` missing from the sandbox after the checkout, not the merged code. `npm install` restored it and the suite passed. Treat a `MODULE_NOT_FOUND` failure in `tests/ui.test.js` as a missing-install symptom, not a code defect.
- Note for future sandboxes: `/tmp` is cleared between sessions, so the Chromium and `al2023` library artifacts described in the README must be regenerated with `npm install --prefix /tmp/chromepkg @sparticuz/chromium` before running the browser suite.

### Fixed — stale image fallback test

- Rewrote the fallback test that the local-image change invalidated. It previously relied on `aura-05` pointing at Unsplash and being offline; it now fails the image request explicitly with `page.route('**/assets/images/prod_frenchpress.jpg', route => route.abort('failed'))` and still asserts the SVG category fallback renders and decodes.
- Added a second fallback test for the storefront grid: a broken product image degrades to the category art while the card, heading and price stay visible.
- Net effect: the suite guards the real fallback path again instead of passing or failing for reasons unrelated to the app.

### Verification — image fallback

- With the app's `error` handler disabled, both fallback tests **failed** as expected (detail page and storefront card). Restored, both passed.
- Full suite in real Chromium: **38 passed, 0 failed (43.1 s)** — the whole `npm run test:e2e` set, including the 14 built-in product pages, the checkout/status journey, inventory, promotions, six mobile widths, themes, tap-highlight and keyboard tests. `npm test` also passed **18/18**.
- Command used, in this sandbox only: `LD_LIBRARY_PATH=/tmp/al2023/lib PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npm run test:e2e`.

### Documentation — Playwright made runnable in the sandbox

- Documented how to run `npm run test:e2e` when Playwright's browser download is blocked: use the Chromium build and shared libraries shipped inside the `@sparticuz/chromium` npm package and point `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `LD_LIBRARY_PATH` at them. Verified with Chromium 153 on Debian 12. `@sparticuz/chromium` is **not** a project dependency; it was decompressed outside the repository.
- This closes the earlier "browser suite cannot run here" caveat for future changes in an equivalent sandbox; normal development should still use `npx playwright install chromium`.

### Verification — first full browser run

- **`npm run test:e2e` executed for the first time in this session: 36 passed, 1 failed (37 total, 49.3 s).** This supersedes the standing "Playwright not run" note in the entries above for the behavior those tests cover.
- The single failure was the pre-existing fallback test, not new work: `tests/e2e/product-page.spec.js:249` relied on `aura-05` pointing at a remote URL, so breaking its image was no longer possible by being offline. It was fixed in the following step (see "Fixed — stale image fallback test") by forcing a real load failure rather than weakening the assertion. The suite is now green.
- All 14 built-in product detail pages, the checkout/status journey (including the new `pending → processing → shipped` steps), inventory, promotions, mobile navigation, theme, tap-highlight and keyboard tests passed in real Chromium.

### Changed — all product images are local

- Replaced the 8 product images that hotlinked `images.unsplash.com` with locally generated assets in `assets/images/`: `prod_frenchpress.jpg`, `prod_keyboard.jpg`, `prod_desklamp.jpg`, `prod_fieldwatch.jpg`, `prod_runner.jpg`, `prod_charger.jpg`, `prod_iem.jpg` and `prod_flask.jpg`. All 14 built-in products now load from this repository, so the storefront no longer depends on a third-party image host or its availability, and the README's local-images claim is now accurate.
- New images follow the existing house style (square, single object, light studio background, no branding or text) and are smaller than the originals: 57–168 KB versus 443–568 KB for the pre-existing local files.
- `js/products.js` now exports `PRODUCTS`, `CATEGORIES` and `STORE_DATA` for Node, guarding the `window` assignment, so tests can inspect the catalogue.
- Added a regression test: every built-in product image must match `assets/images/…` **and** exist on disk. Re-introducing a remote URL fails the suite.

### Verification — local product images

- The new test failed as expected when an Unsplash URL was temporarily restored to `aura-14`, then passed after reverting. `npm test` passed **18/18** (14 business-logic, 4 DOM).
- Served the app on port 8000: all 14 files under `assets/images/` returned HTTP **200**, and the served `js/products.js` contains **0** `https://` references.
- DOM check of the rendered grid: 14 images, **14 local**, **0 remote**, 14 distinct files, hero image local, no script errors.
- Reviewed all 8 generated images visually before wiring them in: background, lighting, shadow and framing match the existing catalogue; no text or logos appear.
- **Not run:** Playwright. The images feed `tests/e2e/images.spec.js` and the product-page image/fallback tests, which must be run where Chromium is installed. No test asserts specific image URLs, but the fallback test behavior was not re-verified here.

### Documentation — questionnaire recommendations

- The mandatory per-step questionnaire in [agent.md](agent.md) and [AGENTS.md](AGENTS.md) must now mark a **Recommended** option on every question, with the reasoning in the option description and the message. Exactly one recommendation per question, based on repository state, risk, cost and the roadmap; the instruction to say so plainly when there is no basis is included so guidance is not invented.
- Documentation-only change: no application behavior, data or deployment changed.

### Documentation — workflow rules and roadmap progress log

- Added a **Progress log** table to [ROADMAP.md](ROADMAP.md) that records completed work separately from the phase checklists, back-filled with the storefront, product-page and mobile-UI work already on `main` plus the 2026-11-05 discount and order-status step. Finishing logged work still does **not** tick a phase box; all phases 0–6 remain **not started**.
- Added two mandatory working rules to [agent.md](agent.md) and surfaced them in [AGENTS.md](AGENTS.md): update the roadmap progress log after every completed step, and end every step by asking the owner a questionnaire about what to do next instead of continuing on your own initiative. The rules require stating what was verified, what was not run, and which decisions remain, and forbid offering to skip an approval gate or run destructive/remote operations.
- Documentation-only change: no application behavior, data or deployment changed.

### Verification — workflow rules

- Documentation relative links checked across `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `agent.md`, `AGENTS.md` and `MINDMAP.md`: **0 broken** after URL-decoding `%20`. `git diff --check` passed. `npm test` still passes **17/17**, unchanged by this step.

### Fixed — percentage discount rounding

- Percentage promotions now round the discount **at the cent level, half up**, instead of rounding the dollar figure before dividing (`js/store.js`, `promotionDiscount`). The old formula mis-rounded exact half-cent ties and resolved every one of them downward: 15% of `$4.10` gave `$0.61` (mathematically `0.615`) and 5% of `$20.10` gave `$1.01` (mathematically `1.005`), while 20% of `$4.10` correctly gave `$0.82`. The same subtotal therefore rounded in opposite directions depending on the percentage.
- Scope: in a full sweep of 13 common percentages across subtotals from `$0.01` to `$2,000.00`, **10,187 exact half-cent ties were rounded down** and 251,813 upward. There were **no** wrong answers outside exact ties, so ordinary prices the demo currently uses are unaffected; the fix changes results only where the true discount ends in half a cent. Receipts and analytics both read the same corrected value.

### Changed — order status and refund rules

- Order fulfilment now follows an explicit one-way flow in `js/store.js` (`ORDER_STATUS_FLOW`): `pending → processing → shipped → delivered`. Cancelling is allowed until delivery and is terminal; `refunded` is terminal. Illegal jumps, reversals, and edits to cancelled or refunded orders are rejected by the store, not only hidden in the UI. Previously any valid status string could be set from any state, so `pending → delivered` was a single dropdown change.
- A refund can now only be recorded for a **shipped or delivered** order, which matches what "Record refund" implies. Refunding a `pending`, `processing` or `cancelled` order is rejected with a specific message. This changes existing behavior: the demo previously allowed refunding a pending order.
- Cancelling an order now puts its items **back into local stock**, so cancellation no longer silently loses inventory. It runs once, because `cancelled` is terminal. Refunds deliberately do **not** restock, matching the documented limitation.
- Admin orders render only the legal next statuses (`js/app.js`), show a status badge instead of a dead dropdown once an order is terminal, and show "Record refund" only for shipped or delivered orders. Rejected actions still surface an error toast.
- `tests/e2e/storefront.spec.js` now walks `pending → processing → shipped` instead of jumping straight to shipped, so the existing checkout journey keeps testing the same end state under the new rule.

### Added — DOM-level tests

- Added `tests/ui.test.js` (jsdom) so `npm test` verifies rendered behavior without a browser: storefront rendering, admin status/refund controls, the discount displayed in the bag, and reloadable product links. `npm test` now runs `tests/store.test.js` **and** `tests/ui.test.js`.
- Added 5 business-logic tests to `tests/store.test.js` covering cent rounding, the status flow, cancel-restock, and refund eligibility.

### Verification

- Tests were written first and failed against the original code for the expected reasons: `0.61 !== 0.62` (rounding) and `Missing expected exception` (illegal status jump). To confirm the new tests genuinely catch the defects, the fix was temporarily reverted and the suite re-run: **4 tests failed**; with the fix restored, `npm test` passed **17/17** (13 business-logic, 4 DOM).
- Bug-driven changes to three of my own new tests were corrected during implementation, not worked around: `nextOrderStatuses` takes an order reference, a shipped-order refund message differed, and an expected total omitted the `$15` shipping charged below `$150`.
- A scripted DOM journey against the served app (`python3 -m http.server`, port 8000) verified: the `?product=` detail route renders and hides the storefront; `pending → delivered` and `pending → shipped` are blocked while `pending → processing → shipped → delivered` succeeds; `processing → pending` is blocked; a pending refund is blocked, a cancelled refund is blocked, and a delivered refund succeeds and then blocks further status changes; admin shows 0 status dropdowns and 0 refund buttons once orders are terminal; and the bag shows **−$0.62 (AURA15)** for 15% of `$4.10`. No script errors were reported.
- `node --check` passed on all changed scripts; `git diff --check` passed; `package.json` syntax validated.
- **Not run:** the Playwright suite (30 tests). This sandbox cannot download Playwright's browser and Chromium's native libraries are unavailable, so `npm run test:e2e` must be run where Chromium is installed. One e2e test was updated for the new flow and is unverified here.

### Known limitations

- The refund rule and status flow are enforced in browser-local code. They document intended behavior but are **not** a security boundary; a real backend must enforce the same rules server-side (see [roadmap](ROADMAP.md) Phases 2–4).
- Cancellation restocks local inventory; a refund leaves stock untouched and no money moves. Clearing browser storage still removes everything.
- Existing saved orders keep their current status; an order already marked `refunded` stays terminal, and one marked `cancelled` can no longer be refunded.

## Unreleased — 2026-10-30

### Added and changed — product details and hero

- Replaced the product quick-view modal with a responsive, full details page at a reloadable `?product=<id>` URL. Product images and titles in the collection, featured hero, saved items and bag now link to it, with normal keyboard, new-tab and browser-history behavior.
- Added product descriptions, prices, ratings and available specifications alongside finish, size, quantity, saved-item and bag controls. Availability reflects local inventory and bag changes; missing products have a clear return-to-collection state. Search, Home and Shop continue to work from a product page.
- Selected variants now use checkout's inverse theme colors: black with white text in light mode, and white with black text in dark mode. Removed the everyday-collection badge, headline, description and Explore CTA while retaining the featured image and metadata in a simplified hero.
- Updated the contributor guardrails and README. The URL does not synchronize local data: products created or edited in Admin still exist only in that browser. These changes have not been deployed to the public Vercel site.

### Verification — product details and hero

- The initial focused tests failed against the old hero and modal as expected. A later link test's ambiguous locator was corrected, and a 320px hero-metadata overlap was fixed.
- Headless Chromium intermittently failed to create a new tab after an unprevented trusted Ctrl/middle click. The stable test verifies the modified click is not intercepted and opens the actual link in another page; it passed 20 repeated runs. Native new-tab clicks also succeeded in individual runs but were unreliable in this sandbox.
- `npm test` passed **8/8** business-logic tests. `LD_LIBRARY_PATH=/tmp/al2023/lib:$LD_LIBRARY_PATH PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npm run test:e2e` passed **37/37** browser tests in sandbox Chromium, including all 14 built-in product links, variant checkout, search, history, new tabs, keyboard focus, stock, missing products, local-product links and cross-tab updates.
- Reviewed light/dark desktop and mobile screenshots and checked layout geometry from 320px to 1365px. JavaScript syntax, documentation links, duplicate DOM IDs and `git diff --check` passed. No physical-device or public-deployment test was performed.

### Fixed — blue tap highlight

- Disabled the browser's default tap-highlight overlay across the storefront and admin, including nested and dynamically rendered controls. The existing visible keyboard-focus indicator and subtle UI glow remain available.
- Updated the contributor guardrail so future changes preserve this behavior. This follow-up has not been deployed to the public Vercel site.

### Verification — blue tap highlight

- Before the fix, mobile Chromium emulation reported the browser's default blue `rgba(51, 181, 229, 0.4)` tap highlight and the new regression test failed as expected. After the fix, nested storefront/admin controls use a transparent tap highlight; simulated taps and keyboard focus were verified.
- `npm test` passed **8/8** business-logic tests. `LD_LIBRARY_PATH=/tmp/al2023/lib:$LD_LIBRARY_PATH PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npm run test:e2e` passed **22/22** browser tests using sandbox Chromium. No physical-device test was performed.
- JavaScript syntax checks and `git diff --check` passed.

### Changed — mobile navigation pill

- Changed the mobile bottom navigation from a full-width bar to a floating, rounded pill, with a pressed-style active tab and space for device safe areas. Desktop navigation remains unchanged.
- Reserved space below the page and raised other notifications so the pill does not obstruct the footer or overlap toast messages. Updated the agent guardrail to preserve the pill shape.
- This follow-up has not been deployed to the public Vercel site.

### Verification — mobile navigation pill

- The new pill-geometry check failed against the original full-width bar as expected. A theme-color check initially sampled too early and was corrected to wait for the style update.
- `npm test` passed **8/8** business-logic tests. `LD_LIBRARY_PATH=/tmp/al2023/lib:$LD_LIBRARY_PATH PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npm run test:e2e` passed **20/20** browser tests using sandbox Chromium.
- Checked the pill, touch targets, footer spacing, keyboard navigation and panel interactions from 320px to 680px; reviewed screenshots in light and dark themes. JavaScript syntax and `git diff --check` also passed.

### Changed — mobile UI follow-up

- Restored fixed, labeled bottom navigation on mobile while retaining the desktop top navigation. This supersedes the earlier removal of the bottom navigation; all six storefront sections remain available, with room for the bottom safe area.
- Removed the visible leading “Search” label while keeping an accessible label; the placeholder and search behavior remain unchanged.
- Kept mobile product cards in two columns, including narrow screens, and adjusted their contents to fit.
- Replaced theme-change toasts with borderless, theme-aware gradient messages that fade in and out at the top right on desktop and mobile. Other notifications retain their existing style.
- Updated the contributor guardrails and hosted-demo note to reflect the current navigation and deployment workflow. These UI changes have not been deployed to the public Vercel site in this follow-up.

### Verification — mobile UI follow-up

- Before implementation, the new targeted checks failed as expected for the old visible search label, top mobile navigation and missing theme notice. An additional 421px test exposed card-footer overflow and passed after the layout adjustment.
- `npm test` passed **8/8** business-logic tests. `LD_LIBRARY_PATH=/tmp/al2023/lib:$LD_LIBRARY_PATH PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npm run test:e2e` passed **19/19** browser tests using a sandbox-specific Chromium binary.
- Checked mobile navigation and two-column cards at 320, 390, 420, 421, 480 and 680 pixels, including panel interactions and overflow; checked theme feedback on mobile and desktop. Reviewed mobile/desktop screenshots, JavaScript syntax, documentation links and `git diff --check`.

### Added

- Rebuilt the storefront's browser-local state and admin demo for products, inventory, customers, orders and references, promotions and local analytics. New order references are saved in Account and reflect local status changes.
- Added percentage and fixed-amount discount codes plus scheduled automatic sales. Manual codes take precedence and discounts do not stack.
- Added local product images and fonts, Node business-logic tests, Playwright browser tests and local run/test instructions.

### Changed

- Refined responsive navigation and accessibility, themed sorting and notifications, cart scrolling, checkout/payment selection and admin tables to match the requested storefront behavior. Checkout fields start blank and order completion offers a return home.
- Removed the requested hints, header cart/wishlist icons, bottom navigation and embossed brand text; labeled icons and replaced hover pop effects with a subtle glow.

### Documentation

- Added a planning-only [roadmap](ROADMAP.md), [mind map](MINDMAP.md), [agent/contributor instructions](agent.md), [agent discovery pointer](AGENTS.md) and this changelog, using the recoverable guidance in `.for agent`. No roadmap implementation phase has been started.

### Deployment

- Created the `e-commerce-proj` Vercel project and linked the GitHub repository. The public production demo is https://e-commerce-proj-umber.vercel.app/; Vercel reported it **READY** and **PROMOTED** from session-branch commit `88a0372abf0cb369e821debfa12418f7149ae050`. `main` was not changed. The project's configured production branch is `main`; future deployments from it can replace the demo until this work is merged.
- The first production API request was rejected because Vercel requires initial project settings that the connector could not provide. A Git-triggered deployment initialized and published the project instead. The public project domain was accessible without a login; the generated deployment-specific URL was protected by Vercel sign-in.

### Verification

- `npm test` passed **8/8** business-logic tests.
- `LD_LIBRARY_PATH=/tmp/al2023/lib:$LD_LIBRARY_PATH PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npm run test:e2e` passed **9/9** browser tests in this sandbox. Other environments can use Playwright's installed Chromium as described in the README.
- `node --check` passed for the application scripts and unit test; the documentation's relative links and `git diff --check` passed.
- An external page fetch loaded the public site with 14 rendered products, and the hosted CSS and application scripts were reachable. An external image metadata service fetched all six locally hosted JPEGs successfully. Vercel's deployment file-tree API returned 404; direct sandbox `curl` access to Vercel was blocked by network restrictions, so interactive browser tests were run locally rather than against the public domain.

### Known limitations

- This is a local-storage demo: admin access is unrestricted and data is not shared across browsers/devices. Do not enter real customer or payment information.
- Checkout and refunds do not move money; cancellation/refund does not automatically restock. References generated by the old checkout without saved orders cannot be recovered.
- Supabase, authenticated authorization, a payment provider and real fulfillment are not integrated. See the roadmap before considering production use.

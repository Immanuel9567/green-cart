# GreenCart storefront

A storefront with a shared store database and a password-protected admin area. Run it from the project directory:

```sh
npm start
```

Open `http://localhost:8000`. Shoppers browse, search, save items and check out with **pay on delivery**. The owner opens `/?admin=1`, signs in with the store password, and sees real orders.

**The shop works with no configuration at all**, but a customer's order then stays on the customer's own device. Connecting a database is what makes orders reach the owner — see **[docs/GOING-LIVE.md](docs/GOING-LIVE.md)** for the step-by-step version, including the Supabase account and the two environment variables.

Search ranks by relevance over the title, category, specs and description, folds accents, and expands common words: "watch" finds the chronograph, "headphones" the AURA, "coffee" the French press. See `js/search.js`.

All product images are served from `assets/images/` in this repository, so the storefront does not depend on a third-party image host. `tests/store.test.js` fails if a built-in product points at a remote URL or a missing file.

Product images and titles open a full details page at a reloadable URL such as `/?product=aura-01`. When the database is connected, a product added in the admin is visible to every visitor at the same link. Without it, a locally added product stays on that browser and the link shows "Product not found" elsewhere.

## Hosting

The storefront is deployed on Vercel from `main`. The intended public address is **https://shopgreencart.com** (see [docs/GO-LIVE-HOSTING.md](docs/GO-LIVE-HOSTING.md) for the DNS records and who has to add them).

**Card payments are off until an owner supplies a Paystack public key.** Pay on delivery works without one, and the checkout says plainly which methods are available. Turning card payments on is documented step by step in **[docs/PAYMENTS.md](docs/PAYMENTS.md)**.

Three things are true today and are not hidden in the UI:

- **Without `SUPABASE_*` set, an order stays on the buyer's device.** The checkout says so to the customer, the admin panel reads `Local preview`, and the order endpoint answers `persisted: false` rather than pretending to store it.
- **The admin is password-protected** (`ADMIN_PASSWORD`). It is out of the public nav and the server refuses every admin request without a signed session. There is one password, not a user system.
- **The legal pages are placeholders.** `legal/` ships with delivery windows and return periods marked for replacement, and the business contact details live in **`js/contact.js`** — one file that feeds the legal pages and the footer. The pages show a red banner naming whatever is still missing, and `tests/legal.test.js` fails once those details are filled in, so the site cannot quietly present itself as finished.

Prices are stored in US dollars and displayed in naira by default, converted at a rate pinned in `js/config.js` with the date it was checked. Conversion never changes a stored price or an order total.

Promotions can be percentage or fixed-amount codes, or automatic sales with optional start and end dates. Discounts apply to the subtotal, not shipping; a manually applied code takes precedence over automatic sales, which do not stack.

## Important limitations

- **There are no customer accounts.** "Account" shows the orders placed in that browser; there is no login, no saved address, and no order lookup by email.
- **No emails are sent.** The customer sees their reference on screen and nothing else arrives.
- **Stock is per product, not per variant.** A product has one stock number, not one per colour and size.
- **Refunds are recorded, not returned.** A refund advances the order's status; the money must be returned through Paystack's dashboard.
- **Checkout now takes real card payments** when configured, but the resulting order is stored only in the buyer's browser. The payment gateway (`api/`) is real and server-verified; the order system behind it is not built. Refunds recorded in the admin only change a local status; a real refund must be issued from the Paystack dashboard.
- The price a customer is charged is computed by the server from `js/products.js`, never sent by the browser. See `api/_lib/pricing.js`.
- Every admin table — Products, Inventory, Orders, Customers and Promotions — **searches, filters and pages** 10 rows at a time, paging is keyboard-usable (focus stays on the pager instead of jumping to the top of the page), and each page change is announced to screen readers; the pager shows the visible range and total. Paging is client-side but returns a server-shaped result (`page`, `pageCount`, `total`), so a real API can replace it without rewriting the tables.
- Products are retired by **archiving**, not deleting. Archiving removes a product from the storefront, search, inventory and low-stock counts, and from bags and saved items, but keeps it in Admin under the **Archived** filter with every past order intact, and it can be restored. Permanent deletion is a two-step action available only on archived products, and it is refused outright for any product that appears in a past order.
- The earlier checkout generated reference codes without saving orders. Those past codes cannot be recovered from the old application; new orders retain the same reference in Account and Admin.
- A production deployment needs authenticated, role-restricted server/database access, shared storage, a payment provider and verified payment/refund events. Client-side access controls and local storage are not a security boundary.

## Tests

```sh
npm install
npm test
npx playwright install chromium
npm run test:e2e
```

The end-to-end tests start a local static server automatically. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can be set to use an existing Chromium binary.

When Playwright's own browser download is blocked but Node packages are reachable, a sandbox can still run the suite with a Chromium build plus its shared libraries shipped on npm: `@sparticuz/chromium` (not a project dependency). Decompress `bin/chromium.br` to an executable and `bin/al2023.tar.br` to a directory, then run:

```sh
LD_LIBRARY_PATH=/path/to/al2023/lib PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run test:e2e
```

This was verified with Chromium 153 in a Debian 12 sandbox; it does not replace a normal Playwright browser install for day-to-day use.

> **Maintainer task (about one minute, no setup):** CI is written but switched off, because the connection that pushes this repo cannot write to `.github/workflows/`. To turn it on, copy the contents of [`ci/tests.yml`](ci/tests.yml) into a new file at `.github/workflows/tests.yml` using GitHub's **Add file → Create new file** button. Step-by-step instructions are in [`ci/README.md`](ci/README.md). Until then, run both suites locally before opening a pull request.

`npm run test:mutation` checks the tests themselves (22 rules today, including paging, search, status filters, pager focus and screen-reader announcements). It refuses to start if `js/store.js` or `js/app.js` has uncommitted changes, since those may be a leftover mutation; pass `ALLOW_DIRTY=1` for deliberate work in progress: it breaks one business rule at a time and reports whether the suite notices. A rule whose mutation leaves every test green is reported as **SURVIVED**, meaning it is not genuinely covered. Run it after adding or changing a guarded rule.

`npm test` runs two suites and needs no browser:

- `tests/store.test.js` — business logic (stock, promotions, checkout, order status flow, refunds, archiving).
- `tests/ui.test.js` — DOM smoke tests that load the real `index.html` in [jsdom](https://github.com/jsdom/jsdom) and check that products, admin order controls and the bag render correctly. jsdom does not apply layout or CSS, so use `npm run test:e2e` for visual and input behavior.

## Project documentation

- [Roadmap](ROADMAP.md) and [mind map](MINDMAP.md) — proposed future work and approval gates. No roadmap implementation phase has started.
- [Agent and contributor instructions](agent.md) — relevant skills, guardrails, verification and mandatory changelog rules. [AGENTS.md](AGENTS.md) is the discovery pointer.
- [Changelog](CHANGELOG.md) — completed changes, verification and known limitations.
- [Original planning materials](.for%20agent/) — the source roadmap and skill catalogue.

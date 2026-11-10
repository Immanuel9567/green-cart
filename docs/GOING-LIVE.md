# Making the shop actually work

This is the step-by-step version of getting GreenCart from "a website" to "a shop
that takes orders and shows them to you". It is written to be followed in order,
and each step says what stops working if you skip it.

Two things are deliberately out of scope here and are covered at the end:
taking card payments, and pointing your own domain at the site.

---

## What works right now, with no setup

- The storefront: browsing, search, categories, sorting, saved items, the bag,
  promo codes, dark mode, and the naira/dollar switch.
- Checkout with **pay on delivery**. An order is created, stock is reduced, and
  the customer gets a reference.
- The admin panel: products, inventory, promotions, customers, order history and
  the analytics overview.

## What does NOT work until you do step 2

**A customer's order stays on the customer's own device.** You will never see it.
The admin panel is empty for you, and it says `Local preview` in the bottom-left
corner to tell you so. This is the single most important limitation, and the site
is honest about it: after an order, the customer is told their order was saved on
their device only.

That is what step 2 fixes.

---

## Step 1 — Set an admin password (5 minutes)

The admin panel can read every order and change every price, so it is behind a
password.

1. Open your Vercel project → **Settings** → **Environment Variables**.
2. Add a variable:
   - **Name:** `ADMIN_PASSWORD`
   - **Value:** a long password you do not use anywhere else
   - Apply it to **Production**, **Preview** and **Development**.
3. Redeploy (Vercel → Deployments → ⋯ → Redeploy).

**Check it worked:** open `https://your-site/?admin=1`, click **Admin**, and you
should get a password box. Before this step you get a message saying the admin
area is not configured — which is the correct, honest answer.

> Why a password and not customer accounts? There are no customer accounts, and
> this does not add any. A shop with one owner needs one door.

---

## Step 2 — Connect a database (15 minutes) — **this is the important one**

This is what makes orders reach you and makes your catalogue edits visible on
every device.

### 2a. Create the database

1. Go to <https://supabase.com> and create a free account.
2. **New project**. Pick any name and a region near you (for Nigeria,
   `eu-central-1` or `eu-west-2` are sensible). Save the database password
   somewhere safe — you will not need it for this setup, but losing it is
   annoying later.
3. Wait for the project to finish provisioning (a couple of minutes).

### 2b. Get the two values

In your Supabase project:

- Go to **Project Settings** → **API**.
- Copy **Project URL** — it looks like `https://abcdefgh.supabase.co`.
- Copy the **service_role** secret key (under "Project API keys"). It is a long
  string starting with `eyJ`. **Not** the `anon` key — the anon key cannot write.

### 2c. Add them to Vercel

Add these two environment variables (same place as step 1):

| Name | Value |
| --- | --- |
| `SUPABASE_SQL_URL` | `https://YOUR-PROJECT.supabase.co/rest/v1/rpc/sql` |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key from 2b |

Note the `/rest/v1/rpc/sql` on the end of the URL — a bare project URL will not
work.

The `service_role` key bypasses the database's row-level security. It is a
**server-only** secret: never put it in `js/config.js`, never paste it into a
browser console, never commit it.

Then redeploy.

### 2d. Create the tables

The first request to any admin or order endpoint runs the schema automatically —
`db/schema.sql` is idempotent, so it can run on every cold start without touching
data. You do not need to paste SQL anywhere.

**Check it worked:**

1. Open `https://your-site/?admin=1`, sign in.
2. The bottom-left corner should now read **Shared store** instead of
   `Local preview`.
3. Place a test order from a different browser (or a phone). It should appear
   under **Admin → Orders**.

If it still says `Local preview`, one of the two variables is missing or the URL
is wrong. The Orders tab will say which.

---

## Step 3 — Check your store details before taking real money

These are deliberately left as placeholders, and the site tells you so in a red
banner on the legal pages. Fill them in before you take real orders:

- **Contact details** — `js/contact.js`. Until it is filled, the footer hides the
  contact link rather than offering a dead one, and every legal page shows a red
  "PLACEHOLDER" banner.
- **`legal/shipping.html`** — delivery times, delivery fees, and the returns
  window. These are promises to customers; the site currently marks them with
  `___`.
- **`legal/terms.html`** and **`legal/privacy.html`** — the same.

The tests *fail* if you fill in contact details without removing the warning, so
you cannot accidentally ship a page that looks finished and isn't.

---

## Step 4 — Card payments (only when you have a Paystack account)

Pay on delivery already lets people order. Card payments are a separate, larger
job and need an account you have to open yourself.

1. Create a Paystack account and complete their business verification.
2. In Paystack → **Settings** → **API Keys & Webhooks**, copy the **secret key**
   (`sk_test_…` while testing, `sk_live_…` when you are ready to take real money).
3. Add it to Vercel as `PAYSTACK_SECRET_KEY`.
4. Copy the **public key** (`pk_test_…` / `pk_live_…`) and put it in
   `js/config.js` under `payments.publicKey`.
5. Add the webhook URL in Paystack: `https://your-domain/api/paystack-webhook`.

Test with Paystack's test card before switching to live keys:

| Field | Value |
| --- | --- |
| Card number | `4084 0840 8408 4081` |
| Expiry | any future date |
| CVV | `408` |
| PIN | `0000` |
| OTP | `123456` |

`docs/PAYMENTS.md` explains how the gateway decides an order is paid.

---

## Step 5 — Your own domain

1. Buy `shopgreencart.com` from any registrar. (`.ng` domains are only sold by
   NiRA-accredited registrars and Vercel does not sell them.)
2. In Vercel → **Settings** → **Domains**, add the domain.
3. At your registrar, add the records Vercel shows you. Typically:
   - `A` record for `@` → `76.76.21.21`
   - `CNAME` record for `www` → `cname.vercel-dns.com`
4. Wait for DNS to propagate. Vercel will show a green tick when it has.

---

## Things that are still not built

Being explicit so nothing here is a surprise later:

- **Customer accounts.** "Account" shows the orders placed in that browser only.
  There is no login, no saved addresses, no order tracking by email.
- **Automatic refunds.** A refund is recorded against the order; the money has to
  be returned through Paystack's dashboard.
- **Email.** No order confirmations are sent. The customer sees their reference
  on screen and can screenshot it.
- **Product variants and stock per variant.** A product has one stock number, not
  one per colour and size.
- **Roles.** There is one owner password. Everyone who has it has full access.

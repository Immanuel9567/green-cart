# Taking real payments on GreenCart

Everything in this file is written for a **contributor**, not the project owner.
Some steps need the owner because they involve a bank account, a legal business
name, and money. Those are marked **OWNER** and come with the exact words you
can paste into a message.

Read the last section first if you only read one: [What is still missing](#what-is-still-missing).

---

## What is already built

The gateway is in this repository and it is enforced server-side:

| File | What it does |
| --- | --- |
| `api/initialize-payment.js` | Prices the bag **from the server's own catalogue** and starts a Paystack transaction |
| `api/verify-payment.js` | Asks Paystack whether the charge really succeeded, in the right currency, for the right amount |
| `api/paystack-webhook.js` | Signature-checked server-to-server confirmation, for when the browser disappears |
| `api/_lib/pricing.js` | The shared pricing rules, reused by the browser so the two can never drift |
| `api/_lib/http.js` | Plain Node HTTP helpers, so the endpoints do not depend on any platform's body parser |
| `js/payments.js` | The browser side: initialize → provider popup → verify |
| `js/config.js` | The one switch: a public key and two endpoints |

Two rules are enforced in code and covered by tests:

1. **The browser never says how much to charge.** It sends `[{id, quantity}]`;
   the server looks the price up. A tampered browser cannot buy a ₦403,058 item
   for ₦100.
2. **The browser never says the payment worked.** Only a signed, re-verified
   server response can mark an order paid. If the server cannot confirm, the
   order is recorded as `unverified` — never as `paid`.

Payments are **off until a public key is present**. With it absent, the
checkout says so plainly and refuses to create an order.

---

## Why the endpoints use plain Node HTTP

Vercel adds `request.body`, `response.status()` and `response.json()` to functions.
This gateway deliberately does **not** use them, and there is no `@vercel/node`
dependency. Two reasons:

1. **The webhook needs the original bytes.** `request.body` is a lazy getter that
   parses the body when read. A Paystack webhook is signed with an HMAC over the
   exact bytes sent, so a parsed-and-re-serialised body can never match. Reading
   the stream first is the only correct order.
2. **The opt-out is project-wide.** The documented way to remove those helpers is
   a `NODEJS_HELPERS=0` environment variable, which would also strip
   `response.status()`/`json()` from the other two endpoints. Per-file `config`
   exports are a Next.js convention; Vercel does not read them from `/api`.

The endpoints therefore run unchanged on any Node host, and the trade-off is
recorded in `api/_lib/http.js` so it is not "tidied up" later.

## Step 1 — create the Paystack account (OWNER)

Paystack is a Nigerian payment provider: it takes cards, bank transfers and USSD,
and settles into a Nigerian bank account. Stripe does not settle directly to
Nigerian businesses, which is why Paystack is the right choice here.

**The account must be in the owner's name**, because the money settles into the
owner's bank account and the business must be verifiable.

1. Go to **https://paystack.com** and choose **Create a free account**.
2. Sign up with the owner's work email address.
3. Verify the email by clicking the link Paystack sends.
4. Paystack asks for business details:
   - Business name (the registered name, or the trading name if not registered)
   - Country: **Nigeria**
   - Business type: **Starter Business / Individual** is accepted to begin
   - Website: **https://shopgreencart.com**
5. Add the **settlement bank account**: a Nigerian bank account in the business
   or owner's name. This is where the money lands. It cannot be someone else's
   account.

> If the business is not yet registered with the CAC, Paystack can still start
> an account with lower limits. Registering the business later raises the
> limits. Do not guess a CAC number.

### Message to send the owner

> I've built the card payment system for GreenCart and it's tested and
> deployed. To switch it on I need two things you can only get from your own
> Paystack account:
>
> 1. Create a Paystack account at https://paystack.com using your business
>    details and your settlement bank account.
> 2. When you're in, go to **Settings → API Keys & Webhooks** and send me:
>    - the **Public Key** (starts with `pk_`)
>    - the **Secret Key** (starts with `sk_`) — send this privately, never in a
>      public issue or group chat
>
> Do **not** send the secret key if you're not comfortable sharing it. You can
> add it to Vercel yourself instead — I've written the steps below.

---

## Step 2 — the two keys, and which one may be public

This distinction is the whole security model, so it is worth being precise:

| Key | Starts with | Where it lives | Safe to publish? |
| --- | --- | --- | --- |
| Public key | `pk_live_` / `pk_test_` | `js/config.js`, in every browser | **Yes.** It can start a payment; it cannot move money or read transactions |
| Secret key | `sk_live_` / `sk_test_` | Vercel environment variable only | **Never.** It can refund, transfer and read every transaction |

There is no secret key in this repository, and the test suite fails the build if
one ever appears (`tests/payments.test.js`, "the committed config ships no
payment keys and no secrets").

---

## Step 3 — put the keys in place

### The public key (a one-line change, any contributor can do it)

In `js/config.js`, find `payments.publicKey` and paste the **public** key:

```js
payments: {
  provider: 'paystack',
  publicKey: 'pk_live_xxxxxxxxxxxxxxxxxxxxx',   // <- here
  initializeUrl: '/api/initialize-payment',
  verifyUrl: '/api/verify-payment',
  ...
}
```

Start with `pk_test_` and a Paystack test card, and only switch to `pk_live_`
after a real test purchase succeeds end to end.

### The secret key (OWNER, in the Vercel dashboard)

The secret key must never be committed. It goes into Vercel's environment:

1. Open the Vercel project → **Settings** → **Environment Variables**.
2. Add, for **Production** (and Preview if wanted):
   - Name: `PAYSTACK_SECRET_KEY`
   - Value: the `sk_live_...` key
3. Save, then **Redeploy** — environment variables only take effect on a new
   deployment.

A contributor cannot do this step: adding environment variables needs project
admin rights. If you see "You don't have permission to access this resource",
that is why — ask the owner, do not work around it.

### The webhook (OWNER)

1. Paystack dashboard → **Settings** → **API Keys & Webhooks** → **Webhook URL**.
2. Set it to: `https://shopgreencart.com/api/paystack-webhook`
3. Save. Paystack sends a test event; the endpoint answers `200`.

The endpoint rejects anything without a valid signature, so a wrong URL being
discovered by someone else is not a way to create fake orders.

---

## Step 4 — verify it works before going live

Use Paystack **test mode** first. Test mode needs no real money.

1. Put the `pk_test_...` key in `js/config.js` and `sk_test_...` in Vercel.
2. Deploy.
3. On the live site, add a product to the bag, check out, and pay with
   Paystack's test card:
   - Card: `4084 0840 8408 4081`
   - CVV: `408`
   - Expiry: any future date
   - PIN: `0000`
   - OTP: `123456`
4. Confirm all four:
   - Paystack dashboard shows the transaction as **success**
   - The success screen appears **and says the payment was confirmed**
   - The order's payment status is `paid` (Admin → Orders → View details)
   - The order reference matches the one in the Paystack dashboard

If Paystack shows success but the site says "still being confirmed", the
verification step is failing — check `PAYSTACK_SECRET_KEY` is set on the
deployment and that the deployment was redeployed after adding it.

---

## Step 5 — going live

1. Owner completes Paystack business verification (they will ask for ID, CAC
   documents if registered, and sometimes a bank statement). This can take a
   few days. **Payouts stay disabled until this is done**, even though
   collections may work.
2. Replace `pk_test_` with `pk_live_` in `js/config.js` and commit.
3. Replace the Vercel `PAYSTACK_SECRET_KEY` with the live key and redeploy.
4. Do one real purchase with a small item, then refund it from the Paystack
   dashboard to confirm the settlement account works.

---

## What is still missing

The payment gateway is real, but **a paid order is still only recorded in the
shopper's own browser**. That is the honest state of this repository, and it is
the single biggest remaining gap:

- **You will not see the order.** It is in the customer's `localStorage`. The
  webhook confirms the payment to the server, but there is no database to store
  it in, so `api/paystack-webhook.js` logs the confirmed payment and reports
  `persisted: false` rather than pretending it saved anything.
- **The buyer sees their order**, in Account → Your orders, on the device they
  used. Clearing browser data loses it.

To close this you need a database. In order of least work:

1. **Vercel Postgres / Supabase** — add an `orders` table keyed by the payment
   reference, have the webhook insert into it (idempotently), and give the admin
   a read-only list. This is Phase 1–2 in `ROADMAP.md`.
2. **Paystack dashboard as the interim ledger** — for the first weeks, sales are
   visible in Paystack itself, with the customer's email and the items in the
   transaction metadata. It is not a substitute for an order system, but it
   means no money is unaccounted for while the database is built.

Until one of those exists, treat the site as **taking real payments with
browser-only order records**, and reconcile against the Paystack dashboard
daily. That is an honest description; it is not a finished store.

### Also required before taking real money

- A refund policy, terms of service, and a contact page that actually reaches
  someone. Card networks require these. The pages exist; the **details do not**.
  Fill in `js/contact.js` — it holds the email, WhatsApp number and address used
  by the legal pages and the footer, and the pages show a red warning naming
  whatever is still a placeholder.
- A privacy notice: you now collect names, addresses and emails.
- Someone to answer support email within a day, or disputes will be opened.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Checkout says payments are not switched on | `payments.publicKey` is empty in `js/config.js` | Paste the public key |
| "Card payments are not configured on this deployment yet" | `PAYSTACK_SECRET_KEY` missing in Vercel | Owner adds it, then redeploys |
| "Paystack refused to start this payment: Invalid key" | Secret key is a test key on a live deployment, or vice versa | Match the key pair to the deployment |
| Order saved but "still being confirmed" forever | Verification endpoint failing | Check the secret key and redeploy; check the Vercel function logs |
| Amount charged does not match the site | The USD→NGN rate in `js/config.js` is stale | Re-pin `currency.ngnPerUsd` and its `rateChecked` date |
| Webhook returns 401 | Webhook URL is right but body was altered in transit | Confirm HTTPS and that the URL is exactly `/api/paystack-webhook` |

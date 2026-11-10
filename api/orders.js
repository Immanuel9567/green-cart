// POST /api/orders
//
// A shopper's browser has just completed a checkout and asks the server to record
// the order so the owner can see it.
//
// THE HARD PART: A BROWSER CAN LIE
// It can claim a reference that does not exist, a total of one naira, or someone
// else's order. So this endpoint does not trust the shape of the request — it
// re-prices the order from the server's own catalogue via `api/_lib/pricing.js`,
// exactly as `initialize-payment` does, and stores the server's figures. The
// browser's numbers are used only to be checked against, never to be believed.
//
// WHAT IT WILL NOT DO
//  - It will not mark an order paid. Only `verify-payment` (which talks to the
//    provider) or a pay-on-delivery choice can set a payment status, and
//    pay-on-delivery is explicitly `unverified`/`none`, never `paid`.
//  - It will not fail silently. If the database is not configured the response
//    says so, so the browser can show the reference and tell the customer their
//    order still needs to reach the shop.
//
// WHEN THERE IS NO DATABASE
// That is the normal state until SUPABASE_* is set. The endpoint returns 503 with
// `persisted: false`, and the browser keeps the order locally and says so. It must
// never answer 200 `persisted: true` for an order nothing stored.

const { readJson, send, rejectMethod } = require('./_lib/http');
const { isConfigured, createRunner, migrate } = require('../db');
const { insertOrder } = require('../db/orders');
const { priceOrder, toKobo, QuoteError, NGN_PER_USD } = require('./_lib/pricing');

// A reference minted by the browser. Validated so an arbitrary string cannot be
// used as a key, but not trusted for anything else.
const REFERENCE_PATTERN = /^GC-[A-Za-z0-9-]{4,64}$/;

function badRequest(response, message) {
  return send(response, 400, { success: false, message });
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') return rejectMethod(response, 'POST');

  const body = await readJson(request);
  if (!body || typeof body !== 'object') {
    return badRequest(response, 'The request body could not be read.');
  }

  const reference = String(body.reference || '').trim();
  if (!REFERENCE_PATTERN.test(reference)) {
    return badRequest(response, 'That order reference is not valid.');
  }

  // Re-price from the server's catalogue. `lines` is [{ id, quantity }] and
  // anything unknown, out of stock, or fractional is refused by priceOrder.
  if (!Array.isArray(body.lines) || !body.lines.length) {
    return badRequest(response, 'An order must contain at least one item.');
  }
  let priced;
  try {
    priced = priceOrder({ lines: body.lines, promo: body.promo });
  } catch (error) {
    if (error instanceof QuoteError) return send(response, error.status, { success: false, message: error.message });
    throw error;
  }

  if (!priced.totals.total || priced.totals.total <= 0) {
    return badRequest(response, 'This order has no payable total.');
  }

  const customer = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const email = String(customer.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return badRequest(response, 'A valid email address is required.');
  }
  const name = String(customer.name || '').trim();
  const address = String(customer.address || '').trim();
  const city = String(customer.city || '').trim();
  if (!name || !address || !city) {
    return badRequest(response, 'Delivery details are required.');
  }

  // Pay-on-delivery is the only method this endpoint accepts. A card order is
  // recorded by the webhook after the provider confirms it, never by the browser.
  const method = String(body.method || 'pay-on-delivery');
  if (method !== 'pay-on-delivery') {
    return send(response, 400, {
      success: false,
      message: 'Card orders are recorded when the payment is confirmed, not by the browser.'
    });
  }

  if (!isConfigured()) {
    // Honest answer: the order was NOT stored. The browser keeps it locally and
    // shows the customer their reference.
    return send(response, 503, {
      success: false,
      persisted: false,
      reference,
      message: 'The shop is not connected to its shared database yet, so this order could not be recorded centrally.'
    });
  }

  const run = createRunner();
  await migrate(run);

  const result = await insertOrder(run, {
    reference,
    status: 'pending',
    // Pay on delivery: nothing has been paid, and this endpoint is not allowed to
    // claim otherwise.
    paymentStatus: 'none',
    paymentProvider: '',
    customerName: name,
    customerEmail: email,
    customerAddress: address,
    customerCity: city,
    // The SERVER's figures, not the browser's.
    amountKobo: toKobo(priced.totals.total),
    usdTotalCents: Math.round(priced.totals.total * 100),
    ngnPerUsd: NGN_PER_USD,
    promoCode: priced.totals.promotion ? priced.totals.promotion.code : '',
    items: priced.items.map(item => ({
      id: item.id,
      title: item.title,
      price: item.price,
      quantity: item.quantity
    }))
  });

  return send(response, result.created ? 201 : 200, {
    success: true,
    persisted: true,
    reference: result.reference,
    alreadyRecorded: !result.created
  });
};

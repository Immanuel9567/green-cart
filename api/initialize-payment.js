// POST /api/initialize-payment
//
// Called by the checkout when the shopper presses "Place order". Its job is to
// turn a bag the browser claims it has into a single, server-computed amount
// that Paystack will charge.
//
// The browser never says how much to charge. It says WHAT it wants to buy, and
// this endpoint prices it from the repository's own catalogue. If the browser
// and the server disagree about the price, the server wins and the browser is
// told what the real total is.

const { priceOrder, toKobo, QuoteError } = require('./_lib/pricing');
const { readJson, send, rejectMethod } = require('./_lib/http');

const PAYSTACK_API = 'https://api.paystack.co';

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

// A reference that is unique per attempt and safe to show a customer.
function newReference() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `GC-${stamp}-${random}`;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') return rejectMethod(response, 'POST');

  const secretKey = readEnv('PAYSTACK_SECRET_KEY');
  if (!secretKey) {
    // Refusing is the honest answer. Charging without a key is impossible, and
    // pretending otherwise would create an order nobody can pay for.
    return send(response, 503, {
      success: false,
      message: 'Card payments are not configured on this deployment yet.'
    });
  }

  const body = await readJson(request);
  if (body === undefined) {
    return send(response, 400, { success: false, message: 'The request body was not valid JSON.' });
  }
  if (!body || typeof body !== 'object') {
    return send(response, 400, { success: false, message: 'The request body could not be read.' });
  }

  const { lines, promo, email, customer } = body;

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (typeof email !== 'string' || !emailPattern.test(email.trim())) {
    return send(response, 400, { success: false, message: 'A valid email address is required to take payment.' });
  }

  let priced;
  try {
    priced = priceOrder({ lines, promo });
  } catch (error) {
    if (error instanceof QuoteError) {
      return send(response, error.status, { success: false, message: error.message });
    }
    throw error;
  }

  if (!priced.totals.total || priced.totals.total <= 0) {
    return send(response, 400, { success: false, message: 'This order has no payable total.' });
  }

  const reference = newReference();
  const amount = toKobo(priced.totals.total);

  const payload = {
    email: email.trim().toLowerCase(),
    amount,
    currency: 'NGN',
    reference,
    // Everything needed to reconcile the payment later, and nothing sensitive.
    // No card data ever reaches this server: Paystack collects it.
    metadata: {
      store: 'GreenCart',
      items: priced.items.map(item => ({ id: item.id, title: item.title, quantity: item.quantity })),
      usdTotal: priced.totals.total,
      usdSubtotal: priced.totals.subtotal,
      // The quoted charge, in kobo. verify-payment compares the real charge
      // against this, so a reference for a cheaper transaction cannot settle
      // a more expensive order.
      expectedKobo: amount,
      promo: priced.totals.promotion ? priced.totals.promotion.code : '',
      customer: customer && typeof customer === 'object'
        ? { name: String(customer.name || '').slice(0, 120), city: String(customer.city || '').slice(0, 120) }
        : {}
    }
  };

  let paystackResponse;
  try {
    paystackResponse = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (_) {
    return send(response, 502, {
      success: false,
      message: 'Could not reach Paystack. No payment was taken; please try again.'
    });
  }

  let result;
  try {
    result = await paystackResponse.json();
  } catch (_) {
    return send(response, 502, { success: false, message: 'Paystack sent a response that could not be read.' });
  }

  if (!paystackResponse.ok || !result || result.status !== true) {
    return send(response, 502, {
      success: false,
      // Paystack's own message is usually the useful one ("Invalid key",
      // "Currency not supported by merchant"). Pass it through.
      message: (result && result.message) || 'Paystack refused to start this payment.'
    });
  }

  return send(response, 200, {
    success: true,
    reference: result.data.reference,
    accessCode: result.data.access_code,
    amount,
    currency: 'NGN',
    usdTotal: priced.totals.total,
    items: priced.items
  });
};

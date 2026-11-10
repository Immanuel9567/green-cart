// POST /api/paystack-webhook
//
// The belt to verify-payment's braces.
//
// A shopper can pay and then close the tab before the browser's callback runs.
// The money has moved; the order would never be recorded. Paystack therefore
// also calls this endpoint directly, server to server, and this is the more
// trustworthy of the two paths: there is no browser involved at all.
//
// Security: every request carries an x-paystack-signature header, which is an
// HMAC-SHA512 of the raw body keyed with the Paystack secret key. If the
// signature does not match, the request is discarded. Without this check
// anyone could POST a fake "payment succeeded" to this URL.

const crypto = require('node:crypto');
const { readRawBody, send, rejectMethod } = require('./_lib/http');

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') return rejectMethod(response, 'POST');

  const secretKey = readEnv('PAYSTACK_SECRET_KEY');
  if (!secretKey) {
    // Without a key there is no way to prove a request came from Paystack, so
    // nothing may be trusted. Answer 503 so Paystack retries later.
    return send(response, 503, { success: false, message: 'Webhook is not configured.' });
  }

  // The signature is computed over the EXACT bytes Paystack sent. Re-serialising
  // a parsed body would change key order and whitespace and break the match, so
  // the raw bytes are read first and then parsed here. See api/_lib/http.js for
  // why this endpoint uses no platform body-parsing helpers.
  let rawBody;
  try {
    rawBody = await readRawBody(request);
  } catch (_) {
    return send(response, 400, { success: false, message: 'The request body could not be read.' });
  }

  const signature = String(request.headers['x-paystack-signature'] || '');
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');

  // Constant-time comparison: a timing difference here would let an attacker
  // discover the expected signature byte by byte.
  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const authentic = signatureBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!authentic) {
    return send(response, 401, { success: false, message: 'Signature mismatch.' });
  }

  // Parse the bytes that were actually signed. `request.body` must not be used
  // here: on a streamed request it is undefined, which would reject every real
  // webhook, and on Vercel reading it would have consumed the stream already.
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (_) {
    return send(response, 400, { success: false, message: 'Body was not JSON.' });
  }

  // Only charge successes matter here. Every other event is acknowledged so
  // Paystack stops retrying it — an unanswered webhook is retried for days.
  if (!event || event.event !== 'charge.success' || !event.data) {
    return send(response, 200, { success: true, ignored: true });
  }

  const transaction = event.data;

  // Re-verify rather than trusting the payload: the signature proves Paystack
  // sent it, but re-checking the transaction catches a replayed or edited body
  // and confirms the amount at the same moment the order is fulfilled.
  let verification;
  try {
    const verifiedResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(transaction.reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    verification = await verifiedResponse.json();
  } catch (_) {
    // Ask for a retry rather than acknowledging something unconfirmed.
    return send(response, 502, { success: false, message: 'Could not re-verify the transaction.' });
  }

  if (!verification || verification.status !== true || !verification.data || verification.data.status !== 'success') {
    return send(response, 200, { success: true, confirmed: false });
  }

  // A real store records the order in a database here, idempotently keyed by
  // reference, so a webhook retry cannot create a duplicate order. This
  // repository has no database yet (see docs/PAYMENTS.md), so the honest
  // behaviour is to log the confirmed payment and report that persistence is
  // not wired up — never to claim an order was saved when it was not.
  const confirmed = {
    reference: verification.data.reference,
    amountKobo: Number(verification.data.amount),
    currency: verification.data.currency,
    paidAt: verification.data.paid_at || null,
    customer: verification.data.customer ? verification.data.customer.email : null
  };

  console.log('[paystack-webhook] confirmed payment', JSON.stringify(confirmed));

  return send(response, 200, {
    success: true,
    confirmed: true,
    reference: confirmed.reference,
    persisted: false,
    note: 'Payment confirmed. Order persistence is not configured on this deployment.'
  });
};

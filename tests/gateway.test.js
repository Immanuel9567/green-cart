// Tests for the server-side payment gateway in api/.
//
// The gateway is the only component trusted with money, so the tests here focus
// on refusal: wrong prices, wrong amounts, forged webhooks, missing keys. A
// gateway that is generous with bad input is worse than one that is down.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');

const { priceOrder, toKobo, koboToUsd, koboToNaira, QuoteError, NGN_PER_USD } = require(
  path.join(__dirname, '..', 'api', '_lib', 'pricing.js')
);
const initialize = require(path.join(__dirname, '..', 'api', 'initialize-payment.js'));
const verify = require(path.join(__dirname, '..', 'api', 'verify-payment.js'));
const webhook = require(path.join(__dirname, '..', 'api', 'paystack-webhook.js'));

// A stand-in for Node's http.ServerResponse. The endpoints use standard Node
// HTTP only (api/_lib/http.js), so the test double must too: `end()` with a
// string body and `setHeader`. No Vercel helpers are assumed anywhere, which is
// the whole point of that module.
function mockResponse() {
  const response = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(key, value) { response.headers[key] = value; return response; },
    end(chunk) {
      if (typeof chunk === 'string') {
        try { response.body = JSON.parse(chunk); } catch (_) { response.body = chunk; }
      }
      return response;
    }
  };
  return response;
}

// A request whose body arrives as a stream, the way a real POST does.
function mockRequest(body, { method = 'POST', headers = {} } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')];
  return {
    method,
    headers,
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: chunks[index++] };
        }
      };
    }
  };
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
function restore() {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
}

test('the server prices an order from its own catalogue, not from the request', () => {
  const priced = priceOrder({ lines: [{ id: 'aura-01', quantity: 1 }] });
  assert.equal(priced.totals.total, 299);
  assert.equal(priced.items[0].price, 299);
  // A request cannot smuggle in a price of its own: the line only carries an id
  // and a quantity, and the price is read from js/products.js.
  const withBogusPrice = priceOrder({ lines: [{ id: 'aura-01', quantity: 1, price: 1 }] });
  assert.equal(withBogusPrice.totals.total, 299);
});

test('an unknown, fractional, negative or oversized quantity is refused', () => {
  assert.throws(() => priceOrder({ lines: [{ id: 'does-not-exist', quantity: 1 }] }), /no longer available/);
  assert.throws(() => priceOrder({ lines: [{ id: 'aura-01', quantity: 0 }] }), /whole quantity/);
  assert.throws(() => priceOrder({ lines: [{ id: 'aura-01', quantity: -3 }] }), /whole quantity/);
  assert.throws(() => priceOrder({ lines: [{ id: 'aura-01', quantity: 1.5 }] }), /whole quantity/);
  assert.throws(() => priceOrder({ lines: [{ id: 'aura-01', quantity: 100 }] }), /99/);
  assert.throws(() => priceOrder({ lines: [] }), /No items/);
  assert.throws(() => priceOrder({ lines: 'nope' }), /No items/);
});

test('asking for more than the shelf holds is refused', () => {
  // aura-01 has 18 in stock; 19 must fail.
  assert.throws(() => priceOrder({ lines: [{ id: 'aura-01', quantity: 19 }] }), /does not have that many left/);
});

test('the promotion comes from the catalogue too, and a bad code is simply not applied', () => {
  const withPromo = priceOrder({ lines: [{ id: 'aura-01', quantity: 1 }], promo: 'GC15' });
  assert.equal(withPromo.totals.discount, 44.85);
  assert.equal(withPromo.totals.total, 254.15);

  const withBadPromo = priceOrder({ lines: [{ id: 'aura-01', quantity: 1 }], promo: 'FREESTUFF999' });
  assert.equal(withBadPromo.totals.discount, 0);
  assert.equal(withBadPromo.totals.total, 299);
});

test('dollars become kobo through naira, not directly', () => {
  // This is the mistake worth a test: 299 * 100 = 29900 would charge ₦299.
  assert.equal(toKobo(299), 40305798);
  assert.equal(koboToNaira(40305798), 403057.98);
  assert.equal(koboToUsd(40305798), 299);
  assert.ok(NGN_PER_USD > 1000, 'the rate is naira per dollar, not the reverse');
});

test('initialize refuses politely without a secret key', async () => {
  delete process.env.PAYSTACK_SECRET_KEY;
  const response = mockResponse();
  await initialize(mockRequest({ lines: [{ id: 'aura-01', quantity: 1 }], email: 'a@b.co' }), response);
  assert.equal(response.statusCode, 503);
  assert.match(response.body.message, /not configured/i);
  restore();
});

test('initialize demands a valid email before touching Paystack', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, json: async () => ({ status: true, data: {} }) }; };
  for (const email of ['', 'nope', 'a@b', '   ']) {
    const response = mockResponse();
    await initialize(mockRequest({ lines: [{ id: 'aura-01', quantity: 1 }], email }), response);
    assert.equal(response.statusCode, 400, `email "${email}" must be rejected`);
  }
  assert.equal(called, false, 'Paystack must not be contacted without a valid email');
  restore();
});

test('initialize sends Paystack the server-computed amount in kobo', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
  let sent = null;
  global.fetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return {
      ok: true,
      json: async () => ({ status: true, data: { reference: init.body.reference, access_code: 'ac_1' } })
    };
  };
  const response = mockResponse();
  await initialize(
    mockRequest({ lines: [{ id: 'aura-01', quantity: 1 }], email: 'ada@example.com', customer: { name: 'Ada', city: 'PH' } }),
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(sent.url, 'https://api.paystack.co/transaction/initialize');
  assert.equal(sent.auth, 'Bearer sk_test_x');
  assert.equal(sent.body.amount, 40305798);
  assert.equal(sent.body.currency, 'NGN');
  assert.equal(sent.body.email, 'ada@example.com');
  assert.match(sent.body.reference, /^GC-/);
  // The quoted amount travels with the transaction so verification can compare.
  assert.equal(sent.body.metadata.expectedKobo, 40305798);
  assert.equal(sent.body.metadata.usdTotal, 299);
  restore();
});

test('initialize relays a Paystack refusal instead of inventing success', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
  global.fetch = async () => ({ ok: false, json: async () => ({ status: false, message: 'Invalid key' }) });
  const response = mockResponse();
  await initialize(mockRequest({ lines: [{ id: 'aura-01', quantity: 1 }], email: 'a@b.co' }), response);
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /Invalid key/);
  restore();
});

test('initialize refuses an unpurchasable quantity before contacting Paystack', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, json: async () => ({ status: true, data: {} }) }; };

  // 500 is refused as an invalid quantity (400) — the cap of 99 is checked
  // before stock. 20 is a plausible request that simply exceeds the shelf, and
  // that must be a conflict (409) because the catalogue, not the request, is
  // what rules it out.
  const tooMany = mockResponse();
  await initialize(mockRequest({ lines: [{ id: 'aura-01', quantity: 500 }], email: 'a@b.co' }), tooMany);
  assert.equal(tooMany.statusCode, 400);

  const tooFewLeft = mockResponse();
  await initialize(mockRequest({ lines: [{ id: 'aura-01', quantity: 20 }], email: 'a@b.co' }), tooFewLeft);
  assert.equal(tooFewLeft.statusCode, 409);
  assert.match(tooFewLeft.body.message, /does not have that many left/);

  assert.equal(called, false, 'Paystack must not be contacted for an unpurchasable order');
  restore();
});

test('verify refuses a failed transaction', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ status: true, data: { status: 'failed', reference: 'R1', currency: 'NGN', amount: 100 } })
  });
  const response = mockResponse();
  await verify(mockRequest({ reference: 'R1' }), response);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /not successful/);
  restore();
});

test('verify refuses a payment in the wrong currency', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ status: true, data: { status: 'success', reference: 'R2', currency: 'USD', amount: 29900 } })
  });
  const response = mockResponse();
  await verify(mockRequest({ reference: 'R2' }), response);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /currency/);
  restore();
});

test('verify refuses an amount that does not match the quote', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      status: true,
      data: {
        status: 'success', reference: 'R3', currency: 'NGN',
        amount: 100, // someone paid ₦1 for a ₦403,058 order
        metadata: { expectedKobo: 40305798 }
      }
    })
  });
  const response = mockResponse();
  await verify(mockRequest({ reference: 'R3' }), response);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /did not match/);
  restore();
});

test('verify confirms a genuine, correctly-priced payment', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      status: true,
      data: {
        status: 'success', reference: 'R4', currency: 'NGN',
        amount: 40305798, paid_at: '2026-11-06T10:00:00Z', channel: 'card',
        metadata: { expectedKobo: 40305798 }
      }
    })
  });
  const response = mockResponse();
  await verify(mockRequest({ reference: 'R4' }), response);
  assert.equal(response.body.success, true);
  assert.equal(response.body.reference, 'R4');
  assert.equal(response.body.usdTotal, 299);
  restore();
});

test('verify refuses an unknown reference and a missing one', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
  global.fetch = async () => ({ ok: true, json: async () => ({ status: false, message: 'Transaction not found' }) });
  const notFound = mockResponse();
  await verify(mockRequest({ reference: 'nope' }), notFound);
  assert.equal(notFound.body.success, false);

  const missing = mockResponse();
  await verify(mockRequest({}), missing);
  assert.equal(missing.statusCode, 400);
  restore();
});

// --- webhook ---------------------------------------------------------------

function signedRequest(body, secret) {
  const raw = JSON.stringify(body);
  return mockRequest(raw, {
    headers: { 'x-paystack-signature': crypto.createHmac('sha512', secret).update(raw).digest('hex') }
  });
}

test('the webhook rejects an unsigned or forged request', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_real';
  const payload = { event: 'charge.success', data: { reference: 'W1' } };

  const unsigned = mockRequest(payload);
  const a = mockResponse();
  await webhook(unsigned, a);
  assert.equal(a.statusCode, 401);

  const forged = signedRequest(payload, 'sk_test_attacker');
  const b = mockResponse();
  await webhook(forged, b);
  assert.equal(b.statusCode, 401);
  restore();
});

test('the webhook accepts a correctly signed event and re-verifies it', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_real';
  let verified = false;
  global.fetch = async () => {
    verified = true;
    return {
      ok: true,
      json: async () => ({
        status: true,
        data: { status: 'success', reference: 'W2', amount: 40305798, currency: 'NGN', customer: { email: 'a@b.co' } }
      })
    };
  };
  const response = mockResponse();
  await webhook(signedRequest({ event: 'charge.success', data: { reference: 'W2' } }, 'sk_test_real'), response);
  assert.equal(verified, true, 'the payload is never trusted on its own');
  assert.equal(response.body.confirmed, true);
  assert.equal(response.body.reference, 'W2');
  // The repository has no database, so it must not claim an order was saved.
  assert.equal(response.body.persisted, false);
  restore();
});

test('the webhook acknowledges unrelated events without acting on them', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_real';
  let called = false;
  global.fetch = async () => { called = true; };
  const response = mockResponse();
  await webhook(signedRequest({ event: 'customeridentification.success', data: {} }, 'sk_test_real'), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ignored, true);
  assert.equal(called, false);
  restore();
});

test('a pre-parsed body is refused rather than silently failing every signature', async () => {
  // This is the production trap: if Vercel parses the JSON before the handler
  // runs, the original bytes are gone and no signature can ever match. The
  // endpoint must say so loudly instead of rejecting every real webhook forever.
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_real';
  const response = mockResponse();
  await webhook({
    method: 'POST',
    body: { event: 'charge.success', data: { reference: 'W3' } }, // parsed object, no stream
    headers: { 'x-paystack-signature': 'whatever' }
  }, response);
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /could not be read/);
  restore();
});

test('the webhook does not rely on any platform-specific body parser setting', () => {
  // Vercel does not read a `config` export from an /api function; the documented
  // opt-out is a project-wide NODEJS_HELPERS=0, which would break the other
  // endpoints. So the endpoint must work with the helpers LEFT ON. This asserts
  // it defines no such config and reads the stream itself.
  assert.equal(webhook.config, undefined);
  assert.equal(Array.isArray(webhook.bodyParser), false);
});

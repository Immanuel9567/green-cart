// Tests for the new API endpoints: admin login, admin orders, admin state and
// the public order recorder.
//
// HOW THESE RUN
// Each handler is a plain Node function taking (request, response). These tests
// build a real req/res pair over a real HTTP server, so the body reading, the
// status codes and the headers are exercised the way they will be in production —
// not by calling the handler with a fake object and reading its return value.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.ADMIN_PASSWORD = 'a-long-test-password';
delete process.env.ADMIN_SESSION_SECRET;

const login = require('../api/admin-login');
const adminOrders = require('../api/admin/orders');
const adminState = require('../api/admin/state');
const publicOrders = require('../api/orders');
const session = require('../api/_lib/session');

// Serve one handler and make one request against it.
async function call(handler, { method = 'GET', body, headers = {}, url = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      Promise.resolve(handler(request, response)).catch(reject);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
      const request = http.request({
        hostname: '127.0.0.1',
        port,
        path: url,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          server.close();
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }
          resolve({ status: response.statusCode, headers: response.headers, body: json, text });
        });
      });
      request.on('error', error => { server.close(); reject(error); });
      if (payload) request.write(payload);
      request.end();
    });
  });
}

// ------------------------------------------------------------------- the login

test('the right password returns a usable token', async () => {
  login.resetThrottle();
  const response = await call(login, { method: 'POST', body: { password: 'a-long-test-password' } });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(response.body.token, 'a token is returned');
  // The cookie must be unreadable by JavaScript.
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Strict/);
  // And the token must actually verify.
  assert.equal(session.verifyToken(response.body.token).valid, true);
});

test('a wrong password is refused with a 401', async () => {
  login.resetThrottle();
  const response = await call(login, { method: 'POST', body: { password: 'wrong' } });
  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
  assert.equal(response.headers['set-cookie'], undefined, 'no cookie is set on failure');
});

test('a missing password is refused the same way as a wrong one', async () => {
  login.resetThrottle();
  const empty = await call(login, { method: 'POST', body: {} });
  const missing = await call(login, { method: 'POST', body: null });
  assert.equal(empty.status, 401);
  assert.equal(missing.status, 400);
  // The important part: neither reveals whether a password was expected.
  assert.doesNotMatch(JSON.stringify(empty.body), /expected|configured/i);
});

test('login refuses GET', async () => {
  const response = await call(login, { method: 'GET' });
  assert.equal(response.status, 405);
});

test('a tampered token does not verify', () => {
  const { token } = session.issueToken();
  const [payload, signature] = token.split('.');
  // Change one character of the signature.
  const flipped = signature.slice(0, -1) + (signature.slice(-1) === 'A' ? 'B' : 'A');
  assert.equal(session.verifyToken(`${payload}.${flipped}`).valid, false);
  // Change the payload to extend the expiry.
  const forged = Buffer.from(JSON.stringify({ sub: 'owner', iat: 0, exp: 9999999999 }), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(session.verifyToken(`${forged}.${signature}`).valid, false, 'a forged payload is rejected');
});

test('an expired token does not verify', () => {
  const { token } = session.issueToken(-10); // expired ten seconds ago
  const result = session.verifyToken(token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired');
});

test('a malformed token is rejected, not crashed on', () => {
  for (const bad of ['', 'nonsense', 'a.b.c', null, undefined, 42]) {
    assert.doesNotThrow(() => session.verifyToken(bad));
    assert.equal(session.verifyToken(bad).valid, false);
  }
});

// ------------------------------------------------------------ guarding the admin

test('the admin endpoints refuse an unauthenticated caller', async () => {
  for (const handler of [adminOrders, adminState]) {
    const response = await call(handler, { method: 'GET' });
    assert.equal(response.status, 401, `${handler.name} must refuse a caller with no token`);
    assert.equal(response.body.success, false);
  }
});

test('the admin endpoints refuse a forged token', async () => {
  const response = await call(adminOrders, {
    method: 'GET',
    headers: { Authorization: 'Bearer not-a-real-token' }
  });
  assert.equal(response.status, 401);
});

test('the admin endpoints refuse a token signed with a different secret', async () => {
  // A token minted with another password must not unlock this deployment.
  const saved = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'a-completely-different-password';
  const foreign = session.issueToken().token;
  process.env.ADMIN_PASSWORD = saved;

  const response = await call(adminOrders, { method: 'GET', headers: { Authorization: `Bearer ${foreign}` } });
  assert.equal(response.status, 401, 'a token from another password is worthless here');
});

test('a valid token gets past authentication', async () => {
  // No database is configured in the tests, so the honest answer is 503 — which
  // proves the request got PAST authentication and then reached the database
  // check. A 401 here would mean the token was rejected.
  const { token } = session.issueToken();
  const response = await call(adminOrders, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 503);
  assert.match(response.body.message, /database is not configured/i);
});

// ------------------------------------------------------- without an admin password

test('with no admin password configured, every admin endpoint refuses to work', async () => {
  const saved = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  try {
    const loginResponse = await call(login, { method: 'POST', body: { password: 'anything' } });
    assert.equal(loginResponse.status, 503, 'login cannot work without a configured password');

    const ordersResponse = await call(adminOrders, { method: 'GET' });
    assert.equal(ordersResponse.status, 503);
    assert.match(ordersResponse.body.message, /ADMIN_PASSWORD/);
  } finally {
    process.env.ADMIN_PASSWORD = saved;
  }
});

// ------------------------------------------------------- the public order recorder

test('a card order cannot be recorded by the browser', async () => {
  const response = await call(publicOrders, {
    method: 'POST',
    body: { reference: 'GC-2026-ABCD12', method: 'card', lines: [{ id: 'aura-01', quantity: 1 }], customer: { name: 'A', address: 'B', city: 'C', email: 'a@b.co' } }
  });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /webhook|confirmed/i);
});

test('an order for an item that does not exist is refused', async () => {
  const response = await call(publicOrders, {
    method: 'POST',
    body: { reference: 'GC-2026-ABCD12', method: 'pay-on-delivery', lines: [{ id: 'not-a-product', quantity: 1 }], customer: { name: 'A', address: 'B', city: 'C', email: 'a@b.co' } }
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.success, false);
});

test('a malformed reference is refused before anything else happens', async () => {
  for (const reference of ['', 'hai', '../../etc/passwd', 'DROP TABLE orders']) {
    const response = await call(publicOrders, {
      method: 'POST',
      body: { reference, method: 'pay-on-delivery', lines: [{ id: 'aura-01', quantity: 1 }], customer: { name: 'A', address: 'B', city: 'C', email: 'a@b.co' } }
    });
    assert.equal(response.status, 400, `"${reference}" must be refused`);
  }
});

test('an order with no delivery details is refused', async () => {
  const response = await call(publicOrders, {
    method: 'POST',
    body: { reference: 'GC-2026-ABCD12', method: 'pay-on-delivery', lines: [{ id: 'aura-01', quantity: 1 }], customer: { name: '', address: '', city: '', email: 'nope' } }
  });
  assert.equal(response.status, 400);
});

test('without a database the order is reported as NOT stored', async () => {
  // This is the honesty test. A 200 with persisted:true here would tell a shopper
  // their order was received when nothing recorded it.
  const response = await call(publicOrders, {
    method: 'POST',
    body: {
      reference: 'GC-2026-ABCD12',
      method: 'pay-on-delivery',
      lines: [{ id: 'aura-01', quantity: 1 }],
      customer: { name: 'Ada', address: '1 Road', city: 'Port Harcourt', email: 'ada@example.com' }
    }
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.persisted, false, 'never claim to have stored what was not stored');
  assert.equal(response.body.reference, 'GC-2026-ABCD12', 'the reference is still returned so the customer can quote it');
});

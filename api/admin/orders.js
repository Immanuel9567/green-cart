// /api/admin/orders
//
// GET  — the owner's order list, newest first, plus the overview totals.
// PATCH — move one order along its fulfilment path.
//
// WHY THE LOGIC IS HERE RATHER THAN IN THE BROWSER
// The admin panel used to read localStorage, which meant the owner saw only the
// orders placed in their own browser and a shopper's order never arrived. This
// endpoint is the fix: the owner reads real orders from the database.
//
// WHY THE TRANSITION IS CHECKED SERVER-SIDE
// A browser can be made to send any status. `advanceOrder` re-reads the current
// status and refuses an illegal jump, so "pending -> delivered" cannot be done by
// posting the right JSON. Hiding the button is not the same as refusing the call.

const { readJson, send, rejectMethod } = require('../_lib/http');
const { isConfigured, createRunner, migrate } = require('../../db');
const { listOrders, advanceOrder, summarise } = require('../../db/orders');
const session = require('../_lib/session');

function unauthorised(response) {
  // One message for every failure. The caller is not told whether the password is
  // missing, the token expired, or the signature was wrong.
  return send(response, 401, { success: false, message: 'Sign in to the admin area to continue.' });
}

function unavailable(response) {
  return send(response, 503, {
    success: false,
    message: 'The shared database is not configured on this deployment, so orders cannot be read or changed.'
  });
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'PATCH') {
    return rejectMethod(response, 'GET, PATCH');
  }

  if (!session.isConfigured()) {
    return send(response, 503, {
      success: false,
      message: 'The admin area is not configured on this deployment. Set ADMIN_PASSWORD to enable it.'
    });
  }
  if (!session.authenticate(request)) return unauthorised(response);

  // The order list is the one thing that must not pretend to work: if there is no
  // database, every request would return an empty list, and an empty list is
  // indistinguishable from a shop with no sales. Refuse instead.
  if (!isConfigured()) return unavailable(response);

  const run = createRunner();
  await migrate(run);

  if (request.method === 'GET') {
    const url = String(request.url || '');
    const limitMatch = url.match(/[?&]limit=(\d+)/);
    const limit = limitMatch ? Number(limitMatch[1]) : 50;
    const [orders, totals] = await Promise.all([listOrders(run, { limit }), summarise(run)]);
    return send(response, 200, { success: true, orders, totals });
  }

  // PATCH: { reference, status }
  const body = await readJson(request);
  if (!body || typeof body !== 'object') {
    return send(response, 400, { success: false, message: 'The request body could not be read.' });
  }
  if (!body.reference || !body.status) {
    return send(response, 400, { success: false, message: 'Send both a reference and a status.' });
  }

  try {
    const result = await advanceOrder(run, body.reference, String(body.status));
    return send(response, 200, { success: true, ...result });
  } catch (error) {
    // A refused transition is the caller's error, not a server fault. A missing
    // order is a 404; an illegal jump is a 409.
    const status = /could not be found/i.test(error.message) ? 404 : 409;
    return send(response, status, { success: false, message: error.message });
  }
};

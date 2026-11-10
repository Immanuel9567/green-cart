// Orders, as the server sees them.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
// An order is a financial record. Once written, its money never changes: a
// product changing price tomorrow must not alter what a customer was charged
// today. That is why `items` is a frozen snapshot and why `placeOrder` here has
// no update path for amounts at all. A status may advance; the money may not.
//
// WHY THERE IS NO DELETE
// An order that can be deleted is an order that can be deleted to hide a
// problem. Cancelling is a status; it is not a delete.

// Money is stored in integer minor units so no amount is ever a float. The
// schema enforces the same rule with CHECK constraints; this is the same guard
// at the point of writing, so the error is readable rather than a SQL error.
function toMinor(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('An amount must be a finite number.');
  return Math.round(number);
}

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
const PAYMENT_STATUSES = ['none', 'paid', 'unverified', 'refunded'];

// A one-way fulfilment path. An order may only move to a listed next status.
// Cancelling is allowed until delivery.
const STATUS_FLOW = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
  refunded: []
};

function nextStatuses(current) {
  return [...(STATUS_FLOW[current] || [])];
}

function normaliseInput(order) {
  if (!order || typeof order !== 'object') throw new Error('An order must be an object.');
  const reference = String(order.reference || '').trim();
  if (!reference) throw new Error('An order needs a reference.');
  if (!ORDER_STATUSES.includes(order.status || 'pending')) throw new Error('That is not a valid order status.');
  if (!PAYMENT_STATUSES.includes(order.paymentStatus || 'none')) throw new Error('That is not a valid payment status.');
  return {
    reference,
    status: order.status || 'pending',
    paymentStatus: order.paymentStatus || 'none',
    paymentProvider: String(order.paymentProvider || ''),
    paidAt: order.paidAt || null,
    customerName: String(order.customerName || '').slice(0, 160),
    customerEmail: String(order.customerEmail || '').slice(0, 200).toLowerCase(),
    customerAddress: String(order.customerAddress || '').slice(0, 300),
    customerCity: String(order.customerCity || '').slice(0, 160),
    amountKobo: toMinor(order.amountKobo || 0),
    usdTotalCents: toMinor(order.usdTotalCents || 0),
    ngnPerUsd: order.ngnPerUsd == null ? null : Number(order.ngnPerUsd),
    promoCode: String(order.promoCode || '').slice(0, 40),
    // The snapshot. Only known fields are kept, so a tampered browser cannot
    // smuggle extra columns into the record.
    items: (Array.isArray(order.items) ? order.items : []).slice(0, 200).map(item => ({
      id: String(item.id || '').slice(0, 120),
      title: String(item.title || '').slice(0, 200),
      price: Number(item.price) || 0,
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
      selectedColor: String(item.selectedColor || '').slice(0, 40),
      selectedSize: String(item.selectedSize || '').slice(0, 40)
    }))
  };
}

// Does this error mean a unique constraint was violated? The caller must not
// guess WHICH one: see insertOrder.
function isUniqueViolation(error) {
  const message = String((error && error.message) || '');
  const code = String((error && error.code) || '');
  return code === '23505' || /UNIQUE constraint failed|duplicate key value/i.test(message);
}

// Record an order.
//
// Returns { created: boolean, reference, reason? }. `created: false` with
// reason 'already-recorded' is the NORMAL outcome of a webhook retry, not a
// failure, and must not be treated as one.
async function insertOrder(run, input) {
  const order = normaliseInput(input);
  try {
    await run(
      `INSERT INTO orders (
        reference, status, payment_status, payment_provider, paid_at,
        customer_name, customer_email, customer_address, customer_city,
        amount_kobo, usd_total_cents, ngn_per_usd, promo_code, items
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.reference, order.status, order.paymentStatus, order.paymentProvider, order.paidAt,
        order.customerName, order.customerEmail, order.customerAddress, order.customerCity,
        order.amountKobo, order.usdTotalCents, order.ngnPerUsd, order.promoCode,
        JSON.stringify(order.items)
      ]
    );
    return { created: true, reference: order.reference };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A duplicate is only benign if it is THIS order already recorded. Ask the
    // database rather than parsing the constraint name out of an error string:
    // SQLite names whichever index it happened to check first, so the text is
    // not a reliable way to tell "same order twice" from "two orders collided".
    const existing = await run('SELECT reference FROM orders WHERE reference = ?', [order.reference]);
    if (existing.rows.length) {
      return { created: false, reference: order.reference, reason: 'already-recorded' };
    }
    throw error;
  }
}

async function getOrder(run, reference) {
  const result = await run('SELECT * FROM orders WHERE reference = ?', [String(reference)]);
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items };
}

// Newest first, for the owner's order list. `limit` is clamped so a caller
// cannot ask for the whole table by accident.
async function listOrders(run, options = {}) {
  // Number(...) || 50 treats an explicit 0 as "not supplied", which would return
  // the whole table. Check for absence instead of falsiness.
  const requested = options.limit === undefined || options.limit === null ? 50 : Math.floor(Number(options.limit));
  const limit = Number.isFinite(requested) ? Math.min(200, Math.max(1, requested)) : 50;
  const result = await run(
    // `id` is the tie-break, not `created_at` alone: several orders can be created
    // in the same instant, and without a second key their order within that
    // instant is whatever the database happens to return. "Newest first" has to
    // be deterministic, or the owner's list reshuffles on every refresh.
    'SELECT id, reference, created_at, status, payment_status, customer_name, customer_email, customer_city, amount_kobo, usd_total_cents, promo_code, items FROM orders ORDER BY id DESC LIMIT ?',
    [limit]
  );
  return result.rows.map(row => ({
    ...row,
    items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items
  }));
}

// Move an order along its fulfilment path.
//
// Reads the current status first and checks the transition in code, so an
// illegal jump is refused with a readable message rather than being silently
// accepted by the database.
async function advanceOrder(run, reference, nextStatus) {
  const order = await getOrder(run, reference);
  if (!order) throw new Error('This order could not be found.');
  const allowed = nextStatuses(order.status);
  if (!allowed.includes(nextStatus)) {
    throw new Error(`An order that is ${order.status} cannot become ${nextStatus}.`);
  }
  await run('UPDATE orders SET status = ? WHERE reference = ?', [nextStatus, String(reference)]);
  return { reference: String(reference), status: nextStatus };
}

// Totals for the owner's overview. Computed in SQL so it does not degrade into
// loading every order into memory.
async function summarise(run) {
  const result = await run(
    `SELECT
       COUNT(*) AS order_count,
       COALESCE(SUM(CASE WHEN status IN ('cancelled', 'refunded') THEN 0 ELSE amount_kobo END), 0) AS revenue_kobo
     FROM orders`
  );
  const row = result.rows[0] || {};
  const count = Number(row.order_count) || 0;
  const revenueKobo = Number(row.revenue_kobo) || 0;
  return {
    orderCount: count,
    revenueKobo,
    revenueNaira: revenueKobo / 100,
    averageKobo: count ? Math.round(revenueKobo / count) : 0
  };
}

module.exports = {
  insertOrder,
  getOrder,
  listOrders,
  advanceOrder,
  summarise,
  nextStatuses,
  normaliseInput,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  STATUS_FLOW
};

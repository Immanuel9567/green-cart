// Tests for db/state.js and db/orders.js — the shared storefront document and
// the order records.
//
// These run against a real SQLite database built from the real schema, through
// the same runner interface production uses. The value of testing this way is
// that the constraints in db/schema.sql are actually enforced: a test that skips
// the database would not notice that a negative amount is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const db = require('../db');
const { readDocument, writeDocument, validateDocument, DOCUMENT_ID } = require('../db/state');
const { insertOrder, getOrder, listOrders, advanceOrder, summarise, nextStatuses } = require('../db/orders');

function freshRunner() {
  const connection = new DatabaseSync(':memory:');
  for (const statement of db.statements(db.sqliteSchema())) connection.exec(statement);
  return { connection, run: db.sqliteRunner(connection) };
}

const emptyDoc = () => ({ products: [], orders: [], promotions: [], wishlist: [], cart: [] });
const docWith = count => ({ ...emptyDoc(), products: Array.from({ length: count }, (_, i) => ({ id: `p-${i}` })) });

const sampleOrder = (overrides = {}) => ({
  reference: 'GC-2026-TEST01',
  paymentStatus: 'paid',
  paymentProvider: 'paystack',
  customerName: 'Ada Test',
  customerEmail: 'ADA@Example.com',
  customerAddress: '1 Test Road',
  customerCity: 'Port Harcourt',
  amountKobo: 40305800,
  usdTotalCents: 29900,
  ngnPerUsd: 1348.02,
  items: [{ id: 'aura-01', title: 'AURA ANC Over-Ear', price: 299, quantity: 1 }],
  ...overrides
});

// ------------------------------------------------------------- the shop document

test('a shop that has never saved reads as empty, not as an error', async () => {
  const { run } = freshRunner();
  assert.equal(await readDocument(run), null, 'no document is a normal first-run state');
});

test('the document round-trips through the database intact', async () => {
  const { run } = freshRunner();
  const doc = { ...emptyDoc(), products: [{ id: 'a', title: 'Object', price: 12.5 }], promotions: [{ code: 'GC15', percent: 15 }] };
  const write = await writeDocument(run, doc, 0);
  assert.equal(write.written, true);
  assert.equal(write.version, 1);

  const read = await readDocument(run);
  assert.deepEqual(read.doc.products, doc.products, 'the catalogue survives exactly');
  assert.deepEqual(read.doc.promotions, doc.promotions, 'promotions survive exactly');
  assert.equal(read.version, 1);
});

test('a stale write is rejected rather than silently overwriting', async () => {
  // THE POINT OF THIS TEST: two devices, one document.
  const { run } = freshRunner();
  await writeDocument(run, docWith(1), 0);          // device A saves, version 1

  const deviceB = await readDocument(run);          // device B reads version 1
  const first = await writeDocument(run, docWith(2), deviceB.version);
  assert.equal(first.written, true, 'the first writer wins');
  assert.equal(first.version, 2);

  // Device B now tries to save again carrying the version it already used.
  const second = await writeDocument(run, docWith(9), deviceB.version);
  assert.equal(second.written, false, 'a stale write must be refused');
  assert.equal(second.reason, 'conflict');
  assert.equal(second.version, 2, 'and it is told the current version');

  const final = await readDocument(run);
  assert.equal(final.doc.products.length, 2, 'the losing write did not damage the document');
});

test('two devices racing to create the first document cannot both win', async () => {
  const { run } = freshRunner();
  const a = await writeDocument(run, docWith(1), 0);
  const b = await writeDocument(run, docWith(5), 0);
  assert.equal(a.written, true);
  assert.equal(b.written, false, 'the second creator is told it lost');
  assert.equal(b.reason, 'conflict');
  assert.equal((await readDocument(run)).doc.products.length, 1, 'the winner is what is stored');
});

test('a malformed document is refused before it can reach the database', async () => {
  const { run } = freshRunner();
  for (const bad of [null, 'text', [], 42]) {
    const result = await writeDocument(run, bad, 0);
    assert.equal(result.written, false, `${JSON.stringify(bad)} must be refused`);
    assert.equal(result.reason, 'invalid');
  }
  assert.equal(await readDocument(run), null, 'nothing was written');
});

test('validation catches a document with the wrong shape', () => {
  assert.match(validateDocument({ products: 'not a list' }), /products.*list/i);
  assert.match(validateDocument({ orders: {} }), /orders.*list/i);
  assert.match(validateDocument({ customerStatuses: [] }), /customerStatuses/i);
  assert.equal(validateDocument({ products: [], orders: [], promotions: [], wishlist: [], cart: [] }), null, 'a good document passes');
  assert.equal(validateDocument({}), null, 'an empty document is a valid starting point');
});

test('only one document can ever exist', async () => {
  const { connection, run } = freshRunner();
  await writeDocument(run, docWith(1), 0);
  assert.throws(
    () => connection.prepare("INSERT INTO shop_state (id, doc) VALUES ('other', '{}')").run(),
    /CHECK|UNIQUE|PRIMARY/i
  );
  assert.equal((await readDocument(run)).doc.products.length, 1);
});

// --------------------------------------------------------------------- orders

test('an order is recorded with its money and its frozen line items', async () => {
  const { run } = freshRunner();
  const result = await insertOrder(run, sampleOrder());
  assert.deepEqual(result, { created: true, reference: 'GC-2026-TEST01' });

  const order = await getOrder(run, 'GC-2026-TEST01');
  assert.equal(order.amount_kobo, 40305800, 'the charge is stored in integer kobo');
  assert.equal(order.usd_total_cents, 29900, 'the authored figure is stored too');
  assert.equal(Number(order.ngn_per_usd), 1348.02, 'and the rate that linked them');
  assert.equal(order.payment_status, 'paid');
  assert.equal(order.customer_email, 'ada@example.com', 'the email is normalised to lowercase');
  const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
  assert.equal(items[0].title, 'AURA ANC Over-Ear');
  assert.equal(items[0].price, 299, 'the price paid is copied into the order');
});

test('recording the same order twice does not duplicate it', async () => {
  // This is the normal case for a payment webhook retry, not an error.
  const { run } = freshRunner();
  const first = await insertOrder(run, sampleOrder());
  const second = await insertOrder(run, sampleOrder());
  assert.equal(first.created, true);
  assert.deepEqual(second, { created: false, reference: 'GC-2026-TEST01', reason: 'already-recorded' });
  assert.equal((await listOrders(run)).length, 1, 'there is still exactly one order');
});

test('a duplicate is judged by the reference, not by the error text', async () => {
  // Two DIFFERENT orders are allowed to exist; only a repeated reference is a
  // retry. This is what the version that parsed constraint names got wrong.
  const { run } = freshRunner();
  await insertOrder(run, sampleOrder({ reference: 'GC-A' }));
  await insertOrder(run, sampleOrder({ reference: 'GC-B' }));
  const orders = await listOrders(run);
  assert.equal(orders.length, 2, 'two distinct references are two distinct orders');
});

test('an illegal status jump is refused', async () => {
  const { run } = freshRunner();
  await insertOrder(run, sampleOrder());
  await advanceOrder(run, 'GC-2026-TEST01', 'processing');
  await assert.rejects(
    () => advanceOrder(run, 'GC-2026-TEST01', 'delivered'),
    /cannot become delivered/,
    'an order must be shipped before it is delivered'
  );
  assert.equal((await getOrder(run, 'GC-2026-TEST01')).status, 'processing', 'the refusal changed nothing');
});

test('the fulfilment path is one-way and named explicitly', () => {
  assert.deepEqual(nextStatuses('pending'), ['processing', 'cancelled']);
  assert.deepEqual(nextStatuses('delivered'), [], 'a delivered order has nowhere to go');
  assert.deepEqual(nextStatuses('cancelled'), []);
  assert.deepEqual(nextStatuses('nonsense'), [], 'an unknown status offers nothing');
});

test('revenue excludes cancelled and refunded orders', async () => {
  const { run } = freshRunner();
  await insertOrder(run, sampleOrder({ reference: 'GC-PAID', amountKobo: 100000 }));
  await insertOrder(run, sampleOrder({ reference: 'GC-CANCELLED', amountKobo: 500000, status: 'cancelled' }));
  await insertOrder(run, sampleOrder({ reference: 'GC-REFUNDED', amountKobo: 900000, status: 'refunded' }));
  const summary = await summarise(run);
  assert.equal(summary.orderCount, 3, 'all three orders exist');
  assert.equal(summary.revenueKobo, 100000, 'only the live order counts toward revenue');
  assert.equal(summary.revenueNaira, 1000);
});

test('the database refuses money that cannot exist', async () => {
  const { run } = freshRunner();
  await assert.rejects(
    () => insertOrder(run, sampleOrder({ amountKobo: -1 })),
    /CHECK|constraint/i,
    'a negative charge must not be storable'
  );
});

test('the list is newest first and its limit is clamped', async () => {
  const { run } = freshRunner();
  for (let i = 0; i < 5; i += 1) {
    await insertOrder(run, sampleOrder({ reference: `GC-${i}` }));
  }
  assert.equal((await listOrders(run)).length, 5);
  assert.equal((await listOrders(run, { limit: 2 })).length, 2, 'the limit is honoured');
  assert.equal((await listOrders(run, { limit: 99999 })).length, 5, 'an absurd limit is clamped, not obeyed');
  assert.equal((await listOrders(run, { limit: 0 })).length, 1, 'zero becomes one, never everything');
});

test('orders cannot be quietly deleted', () => {
  // There is no delete function, and this asserts that on purpose: if one is
  // ever added, this test should fail so the decision is made deliberately.
  const api = require('../db/orders');
  assert.equal(api.deleteOrder, undefined, 'an order that can be deleted can hide a problem');
  assert.equal(api.updateAmount, undefined, 'an order\'s money must never be editable');
});

test('a missing order reads as null rather than throwing', async () => {
  const { run } = freshRunner();
  assert.equal(await getOrder(run, 'GC-NOPE'), null);
});

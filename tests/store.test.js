const test = require('node:test');
const assert = require('node:assert/strict');
const { Store, STORE_STATE_KEY } = require('../js/store.js');

class MemoryStorage {
  constructor(values = {}) { this.values = { ...values }; }
  getItem(key) { return this.values[key] ?? null; }
  setItem(key, value) { this.values[key] = String(value); }
}

const seed = [
  { id: 'one', title: 'Object One', category: 'audio', price: 100, stock: 3, description: 'A first object', colors: ['#111111', '#ffffff'], sizes: ['Small', 'Large'], badge: 'New' },
  { id: 'two', title: 'Object Two', category: 'living', price: 50, stock: 8, description: 'A second object', colors: ['#111111'], sizes: ['Standard'] }
];
const fixedDate = () => new Date('2026-10-30T12:00:00Z');
const makeStore = (storage = new MemoryStorage()) => new Store(seed, storage, fixedDate);
const details = { name: 'Ada Customer', address: '1 Main Street', city: 'Ibadan', email: 'ADA@example.com', paymentMethod: 'Credit Card' };

test('migrates old bag and wishlist and reconciles quantities with stock', () => {
  const storage = new MemoryStorage({
    aura_cart: JSON.stringify([{ id: 'one', quantity: 99, selectedColor: '#111111', selectedSize: 'Small' }, { id: 'missing', quantity: 2 }]),
    aura_wishlist: JSON.stringify(['one', 'missing'])
  });
  const store = makeStore(storage);
  assert.equal(store.getCartCount(), 3);
  assert.deepEqual([...store.wishlist], ['one']);
  store.toggleWishlist('two');
  assert.ok(storage.getItem(STORE_STATE_KEY));
  assert.deepEqual([...makeStore(storage).wishlist], ['one', 'two']);
});

test('product changes persist, and retiring a product removes it from bags and saved items', () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  const product = store.saveProduct({ title: 'Desk lamp', category: 'living', price: '42.50', stock: '2', description: 'A lamp', tags: ['New', 'Desk'], image: '' });
  store.addToCart(product.id);
  store.toggleWishlist(product.id);
  store.saveProduct({ ...product, title: 'Desk light', price: '45', stock: '1', tags: ['Updated'] });
  const reloaded = makeStore(storage);
  assert.equal(reloaded.products.find(item => item.id === product.id).title, 'Desk light');
  assert.equal(reloaded.getCartTotals().subtotal, 45);
  // Archiving clears the bag and saved items; permanent deletion takes two steps.
  assert.throws(() => reloaded.deleteProduct(product.id), /Archive this product before deleting/);
  reloaded.archiveProduct(product.id);
  assert.equal(reloaded.cart.length, 0);
  assert.equal(reloaded.wishlist.size, 0);
  assert.equal(makeStore(storage).availableProducts.some(item => item.id === product.id), false);
  // It stays in the catalogue so it can be restored, until it is deleted explicitly.
  assert.equal(makeStore(storage).products.some(item => item.id === product.id), true);
  reloaded.deleteProduct(product.id);
  assert.equal(makeStore(storage).products.some(item => item.id === product.id), false);
});

test('stock is shared across variants and inventory edits reconcile the bag', () => {
  const store = makeStore();
  store.addToCart('one', 2, { color: '#111111', size: 'Small' });
  store.addToCart('one', 1, { color: '#ffffff', size: 'Large' });
  assert.throws(() => store.addToCart('one'), /available/);
  assert.throws(() => store.updateCartQty(0, 1), /available/);
  store.updateStock('one', 2);
  assert.equal(store.getCartCount(), 2);
  assert.equal(store.cart.length, 1);
  store.updateStock('one', 0);
  assert.equal(store.cart.length, 0);
  assert.equal(store.products[0].inStock, false);
  assert.throws(() => store.updateStock('one', -1), /whole number/);
});

test('promotions respect their schedule and active state in cart totals', () => {
  const store = makeStore();
  store.addPromotion({ code: 'save20', percent: '20', start: '2026-10-29', end: '2026-10-31' });
  store.addPromotion({ code: 'future', percent: '10', start: '2026-11-01', end: '' });
  store.addToCart('one');
  store.applyPromo('save20');
  assert.equal(store.getCartTotals().discount, 20);
  assert.equal(store.getCartTotals().total, 95);
  assert.throws(() => store.applyPromo('future'), /not active/);
  store.togglePromotion('SAVE20');
  assert.equal(store.getCartTotals().discount, 0);
  assert.throws(() => store.applyPromo('SAVE20'), /not active/);
  store.deletePromotion('SAVE20');
  assert.equal(store.state.appliedPromo, '');
  assert.throws(() => store.addPromotion({ code: 'bad', percent: 10, start: '2026-11-02', end: '2026-11-01' }), /date range/);
});

test('checkout persists the same reference, order snapshots and inventory atomically', () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  store.addToCart('one', 2);
  store.applyPromo('GC15');
  const order = store.placeOrder(details);
  assert.match(order.reference, /^GC-2026-/);
  assert.equal(order.customer.email, 'ada@example.com');
  assert.equal(order.total, 170);
  assert.equal(store.products[0].stock, 1);
  assert.equal(store.cart.length, 0);
  const reloaded = makeStore(storage);
  assert.equal(reloaded.orders[0].reference, order.reference);
  assert.equal(reloaded.orders[0].items[0].title, 'Object One');
  assert.equal(reloaded.getAnalytics().revenue, 170);
  assert.equal(reloaded.getAnalytics().topProducts[0].quantity, 2);
  assert.equal(reloaded.getCustomers()[0].orders[0].reference, order.reference);
  // 'one' has been sold, so it is retired by archiving rather than deleted.
  reloaded.archiveProduct('one');
  assert.deepEqual(reloaded.availableProducts.map(product => product.id), ['two']);
  assert.equal(reloaded.orders[0].items[0].title, 'Object One');
});

test('status, customer history and recorded refunds feed analytics consistently', () => {
  const store = makeStore();
  store.addToCart('one');
  const order = store.placeOrder(details);
  store.updateOrderStatus(order.reference, 'processing');
  store.updateOrderStatus(order.reference, 'shipped');
  assert.equal(store.orders[0].status, 'shipped');
  store.setCustomerStatus('ada@example.com', 'blocked');
  store.addToCart('two');
  assert.throws(() => store.placeOrder(details), /blocked/);
  store.refundOrder(order.reference);
  assert.equal(store.orders[0].status, 'refunded');
  assert.equal(store.getAnalytics().revenue, 0);
  assert.equal(store.getAnalytics().orderCount, 0);
  assert.equal(store.getCustomers()[0].spent, 0);
  assert.throws(() => store.refundOrder(order.reference), /cannot be refunded/);
  assert.throws(() => store.updateOrderStatus(order.reference, 'delivered'), /cannot be updated/);
});

test('a storage failure does not partially change the order, bag or stock', () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  store.addToCart('one');
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.placeOrder(details), /could not be saved/);
  assert.equal(store.orders.length, 0);
  assert.equal(store.cart.length, 1);
  assert.equal(store.products[0].stock, 3);
});

test('fixed vouchers and automatic sales choose the best active sale unless a code is applied', () => {
  const store = makeStore();
  store.addPromotion({ code: 'TENPERCENT', type: 'percent', value: 10, automatic: true });
  store.addPromotion({ code: 'AUTOSALE', type: 'amount', value: 25, automatic: true, start: '2026-10-01', end: '2026-10-31' });
  store.addPromotion({ code: 'FUTURESALE', type: 'amount', value: 90, automatic: true, start: '2026-11-01' });
  store.addToCart('one');
  assert.equal(store.getCartTotals().promotion.code, 'AUTOSALE');
  assert.equal(store.getCartTotals().discount, 25);
  assert.equal(store.getCartTotals().total, 90);
  store.applyPromo('GC15');
  assert.equal(store.getCartTotals().promotion.code, 'GC15');
  assert.equal(store.getCartTotals().discount, 15);
  store.togglePromotion('GC15');
  assert.equal(store.getCartTotals().promotion.code, 'AUTOSALE');
  store.addPromotion({ code: 'VOUCHER', type: 'amount', value: 150 });
  store.applyPromo('VOUCHER');
  assert.equal(store.getCartTotals().discount, 100);
  assert.equal(store.getCartTotals().total, 15);
});

test('percentage discounts round half a cent up consistently at the cent level', () => {
  // 4.10 * 15% is exactly 0.615, and 20.10 * 5% is exactly 1.005. Both are exact
  // half-cent ties, so both must round up by the same rule. The old formula
  // rounded the dollar figure instead of the cents, so it rounded both down.
  const percentStore = new Store([{ id: 'tie', title: 'Tie Product', category: 'audio', price: 4.10, stock: 10 }], new MemoryStorage(), fixedDate);
  percentStore.addPromotion({ code: 'FIFTEEN', type: 'percent', value: 15 });
  percentStore.addToCart('tie');
  percentStore.applyPromo('FIFTEEN');
  assert.equal(percentStore.getCartTotals().discount, 0.62);
  assert.equal(percentStore.promotionDiscount({ type: 'percent', percent: 15 }, 4.10), 0.62);
  assert.equal(percentStore.promotionDiscount({ type: 'percent', percent: 5 }, 20.10), 1.01);

  // Ordinary values must not move.
  assert.equal(percentStore.promotionDiscount({ type: 'percent', percent: 15 }, 100), 15);
  assert.equal(percentStore.promotionDiscount({ type: 'percent', percent: 10 }, 45.55), 4.56);
  assert.equal(percentStore.promotionDiscount({ type: 'percent', percent: 33 }, 19.99), 6.6);
  // A discount can never exceed the subtotal.
  assert.equal(percentStore.promotionDiscount({ type: 'percent', percent: 100 }, 12.34), 12.34);
});

test('order status follows the fulfilment path and rejects illegal jumps and reversals', () => {
  const store = makeStore();
  store.addToCart('one');
  const order = store.placeOrder(details);
  assert.equal(order.status, 'pending');

  assert.throws(() => store.updateOrderStatus(order.reference, 'delivered'), /pending to processing/);
  assert.equal(store.orders[0].status, 'pending');

  store.updateOrderStatus(order.reference, 'processing');
  assert.throws(() => store.updateOrderStatus(order.reference, 'pending'), /processing to shipped/);
  store.updateOrderStatus(order.reference, 'shipped');
  store.updateOrderStatus(order.reference, 'delivered');
  assert.throws(() => store.updateOrderStatus(order.reference, 'shipped'), /delivered/);

  // Cancelling is only legal before dispatch, and is terminal.
  store.addToCart('one');
  const second = store.placeOrder(details);
  store.updateOrderStatus(second.reference, 'cancelled');
  assert.throws(() => store.updateOrderStatus(second.reference, 'processing'), /cancelled/);
  assert.throws(() => store.refundOrder(second.reference), /cannot be refunded/);

  // shipped -> cancelled stays legal so an undeliverable parcel can be stopped.
  store.addToCart('one');
  const third = store.placeOrder(details);
  store.updateOrderStatus(third.reference, 'processing');
  store.updateOrderStatus(third.reference, 'shipped');
  store.updateOrderStatus(third.reference, 'cancelled');
  assert.equal(store.orders.find(item => item.reference === third.reference).status, 'cancelled');

  assert.throws(() => store.updateOrderStatus(order.reference, 'teleported'), /valid order status/);
  store.addToCart('one');
  const fourth = store.placeOrder(details);
  assert.deepEqual(store.nextOrderStatuses(fourth.reference), ['processing', 'cancelled']);
  assert.deepEqual(store.nextOrderStatuses(order.reference), []);
});

test('cancelling an order restocks its items exactly once', () => {
  const store = makeStore();
  store.addToCart('one', 2);
  const order = store.placeOrder(details);
  assert.equal(store.products[0].stock, 1);
  store.updateOrderStatus(order.reference, 'cancelled');
  assert.equal(store.products[0].stock, 3);
  assert.throws(() => store.updateOrderStatus(order.reference, 'processing'), /cancelled/);
  assert.equal(store.products[0].stock, 3);
});

test('refunded orders cannot move status and require a delivered or shipped order', () => {
  const store = makeStore();
  store.addToCart('one');
  const order = store.placeOrder(details);
  // Refunding something never dispatched is not a fulfilment action.
  assert.throws(() => store.refundOrder(order.reference), /shipped or delivered/);
  store.updateOrderStatus(order.reference, 'processing');
  store.updateOrderStatus(order.reference, 'shipped');
  store.refundOrder(order.reference);
  assert.equal(store.orders[0].status, 'refunded');
  assert.throws(() => store.updateOrderStatus(order.reference, 'delivered'), /cannot be updated/);
});

test('the refund rule keeps analytics and customers consistent for shipped orders', () => {
  const store = makeStore();
  store.addToCart('one', 2);
  store.applyPromo('GC15');
  const order = store.placeOrder(details);
  assert.equal(order.total, 170);
  store.updateOrderStatus(order.reference, 'processing');
  store.updateOrderStatus(order.reference, 'shipped');
  store.refundOrder(order.reference);
  assert.equal(store.orders[0].refundAmount, 170);
  assert.equal(store.getAnalytics().revenue, 0);
  assert.equal(store.getCustomers()[0].spent, 0);
  // A refund is terminal and must not restock by itself.
  assert.equal(store.products[0].stock, 1);
  assert.throws(() => store.updateOrderStatus(order.reference, 'delivered'), /cannot be updated/);
});

test('every built-in product image is a local file that exists', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const { PRODUCTS } = require('../js/products.js');
  const root = path.join(__dirname, '..');
  assert.equal(PRODUCTS.length, 14);
  for (const product of PRODUCTS) {
    assert.match(product.image, /^assets\/images\/[\w.-]+\.(jpg|png|webp)$/, `${product.id} must use a local asset, got ${product.image}`);
    assert.ok(fs.existsSync(path.join(root, product.image)), `${product.id} image is missing: ${product.image}`);
  }
});

test('archiving hides a product from the storefront while keeping it in admin', () => {
  const store = makeStore();
  store.archiveProduct('two');
  assert.equal(store.products.length, 2, 'admin still sees both');
  assert.deepEqual(store.availableProducts.map(product => product.id), ['one']);
  assert.equal(store.products.find(product => product.id === 'two').archived, true);
  assert.ok(store.products.find(product => product.id === 'two').archivedAt);
  store.restoreProduct('two');
  assert.deepEqual(store.availableProducts.map(product => product.id).sort(), ['one', 'two']);
  assert.equal(store.products.find(product => product.id === 'two').archived, false);
});

test('archiving clears the bag and saved items and frees the stock check', () => {
  const store = makeStore();
  store.addToCart('two', 2);
  store.toggleWishlist('two');
  store.archiveProduct('two');
  assert.equal(store.cart.length, 0);
  assert.equal(store.wishlist.size, 0);
  assert.throws(() => store.addToCart('two'), /no longer available/);
  // Restoring does not quietly return items to the bag.
  store.restoreProduct('two');
  assert.equal(store.cart.length, 0);
  assert.equal(store.wishlist.size, 0);
});

test('a product that has sales cannot be permanently deleted', () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  store.addToCart('one');
  const order = store.placeOrder(details);
  // Pins the sales rule specifically, not merely "archive first".
  assert.throws(() => store.deleteProduct('one'), /appears in past orders/);
  assert.equal(store.products.some(product => product.id === 'one'), true);
  // The order and its snapshot are untouched by the refusal.
  assert.equal(store.orders[0].items[0].title, 'Object One');
  assert.equal(store.getAnalytics().topProducts[0].id, 'one');

  // Archiving the same product is allowed and leaves analytics intact.
  store.archiveProduct('one');
  assert.equal(store.products.find(product => product.id === 'one').archived, true);
  assert.throws(() => store.deleteProduct('one'), /appears in past orders/);
  assert.equal(store.getAnalytics().revenue, 115);
  assert.equal(store.getAnalytics().topProducts[0].id, 'one');
  assert.equal(store.orders[0].reference, order.reference);
});

test('a product with no sales can still be archived and then permanently deleted', () => {
  const store = makeStore();
  const draft = store.saveProduct({ title: 'Draft object', category: 'living', price: '10', stock: '1', description: 'Not sold yet' });
  // An unsold product is only blocked by the two-step rule.
  assert.throws(() => store.deleteProduct(draft.id), /Archive this product before deleting/);
  store.archiveProduct(draft.id);
  store.deleteProduct(draft.id);
  assert.equal(store.products.some(product => product.id === draft.id), false);
});

test('archived products are excluded from low stock but active ones are counted', () => {
  const store = makeStore();
  store.updateStock('one', 2); // below 5
  store.updateStock('two', 1); // below 5
  assert.equal(store.getAnalytics().lowStock, 2);
  store.archiveProduct('one');
  assert.equal(store.getAnalytics().lowStock, 1, 'archived stock no longer needs reordering');
});

test('admin list paging walks pages and clamps out-of-range requests', () => {
  const { paginate } = require('../js/store.js');
  const items = Array.from({ length: 25 }, (_, index) => ({ id: index + 1 }));
  const first = paginate(items, 1, 10);
  assert.equal(first.page, 1);
  assert.equal(first.pageCount, 3);
  assert.equal(first.total, 25);
  assert.deepEqual(first.items.map(item => item.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(paginate(items, 3, 10).items.map(item => item.id), [21, 22, 23, 24, 25]);
  // Asking beyond the end returns the last page, not an empty table.
  assert.equal(paginate(items, 99, 10).page, 3);
  assert.equal(paginate(items, 0, 10).page, 1);
  assert.equal(paginate(items, -5, 10).page, 1);
  // An empty list still reports one page so the controls do not divide by zero.
  const empty = paginate([], 4, 10);
  assert.equal(empty.page, 1);
  assert.equal(empty.pageCount, 1);
  assert.deepEqual(empty.items, []);
  // A page size larger than the list is allowed.
  assert.equal(paginate(items, 1, 100).pageCount, 1);
});

test('admin list search matches the fields an operator would type', () => {
  const { matchesQuery } = require('../js/store.js');
  // matchesQuery(query, ...searchableValues)
  assert.equal(matchesQuery('aura', 'AURA ANC Over-Ear'), true, 'search is case-insensitive');
  assert.equal(matchesQuery('ANC', 'AURA ANC Over-Ear'), true);
  assert.equal(matchesQuery('  over-ear  ', 'AURA ANC Over-Ear'), true, 'surrounding spaces are ignored');
  assert.equal(matchesQuery('watch', 'AURA ANC Over-Ear'), false);
  assert.equal(matchesQuery('', 'AURA ANC Over-Ear'), true, 'an empty query matches everything');
  assert.equal(matchesQuery('   ', 'AURA ANC Over-Ear'), true);
  assert.equal(matchesQuery('x', null), false);
  // Extra searchable values (email, status, category) are matched too.
  assert.equal(matchesQuery('ada@example.com', 'Ada Customer', 'ada@example.com'), true);
  assert.equal(matchesQuery('delivered', 'REF-1', 'Delivered'), true);
});

test('a save written under the old brand key is adopted, not discarded', () => {
  const legacy = {
    products: seed,
    cart: [{ id: 'one', quantity: 2, selectedSize: 'Small', selectedColor: '#111111' }],
    orders: [{ reference: 'LEGACY-1', total: 200, status: 'processing', createdAt: '2026-10-01T10:00:00.000Z', customer: { name: 'Ada', email: 'ada@example.com', address: '1 St', city: 'Ibadan' }, items: [] }],
    wishlist: ['two']
  };
  const storage = new MemoryStorage({ v8_store_v1: JSON.stringify(legacy) });
  const store = new Store(seed, storage, fixedDate);

  assert.equal(store.migratedFrom, 'v8_store_v1', 'it reports which key it adopted');
  assert.equal(store.cart.length, 1, 'the cart survives the rebrand');
  assert.equal(store.cart[0].quantity, 2);
  assert.equal(store.orders.length, 1, 'order history survives');
  assert.deepEqual(store.state.wishlist, ['two'], 'saved items survive');

  // Copied to the new key, leaving the old value intact as a fallback.
  assert.ok(storage.getItem(STORE_STATE_KEY), 'the new key is written');
  assert.ok(storage.getItem('v8_store_v1'), 'the old key is not destroyed');

  // A fresh visitor has nothing to migrate.
  assert.equal(makeStore().migratedFrom, undefined);

  // Once the new key exists it wins; a stale legacy value cannot override it.
  const both = new MemoryStorage({
    v8_store_v1: JSON.stringify({ cart: [{ id: 'one', quantity: 9 }] }),
    [STORE_STATE_KEY]: JSON.stringify({ cart: [], orders: [], products: seed })
  });
  const prefersNew = new Store(seed, both, fixedDate);
  assert.equal(prefersNew.cart.length, 0, 'the current key wins over the legacy one');
});

test('an unreadable saved state is reported instead of silently discarded', () => {
  // A key that was never written is a first visit, not a problem.
  assert.equal(makeStore().recovery, null, 'a first visit reports nothing');

  // A value that exists but does not parse is real data that is now unreadable.
  const corrupt = makeStore(new MemoryStorage({ [STORE_STATE_KEY]: '{"products": [broken' }));
  assert.ok(corrupt.recovery, 'corrupt saved data is reported');
  assert.equal(corrupt.recovery.reason, 'unreadable');
  assert.equal(corrupt.recovery.bytes, '{"products": [broken'.length);
  assert.equal(corrupt.products.length, seed.length, 'it falls back to seed data as before');

  // A parsed value of the wrong shape also counts: the shop would otherwise look
  // normal while every saved collection was silently missing.
  const wrongShape = makeStore(new MemoryStorage({ [STORE_STATE_KEY]: '"just a string"' }));
  assert.ok(wrongShape.recovery, 'a non-object saved state is reported');
  assert.equal(wrongShape.recovery.reason, 'unexpected shape');

  // Valid saved data reports nothing.
  const storage = new MemoryStorage();
  const healthy = new Store(seed, storage, fixedDate);
  healthy.addToCart('one');
  const reopened = new Store(seed, storage, fixedDate);
  assert.equal(reopened.recovery, null, 'readable saved data reports nothing');
  assert.equal(reopened.cart.length, 1, 'and the data really was read');

  // A legacy key that migrates successfully is readable data, not a problem.
  const migrated = new Store(seed, new MemoryStorage({ v8_store_v1: JSON.stringify({ orders: [] }) }), fixedDate);
  assert.equal(migrated.migratedFrom, 'v8_store_v1');
  assert.equal(migrated.recovery, null, 'a successful migration is not a recovery case');
});

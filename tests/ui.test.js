// DOM-level smoke tests. These boot the real index.html with jsdom so that the
// rendered storefront, admin tables and checkout wiring are verified without a
// browser. Playwright still covers layout, CSS and real input in tests/e2e.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function loadPage() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  virtualConsole.on('error', (...args) => errors.push(args.join(' ')));
  // jsdom does not fetch remote images or fonts; keep CSS/script loading local only.
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1/',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => null;
    }
  });
  const { window } = dom;
  const inject = file => {
    const script = window.document.createElement('script');
    script.textContent = fs.readFileSync(path.join(root, file), 'utf8');
    window.document.body.appendChild(script);
  };
  inject('js/config.js');
  inject('js/currency.js');
  inject('js/products.js');
  inject('js/store.js');
  inject('js/payments.js');
  inject('js/app.js');
  // Top-level `const` bindings are not placed on `window`, so expose the public
  // handles the tests need through a small bridge.
  const bridge = window.document.createElement('script');
  bridge.textContent = 'window.AppStore = AppStore; window.renderAdminOrders = renderAdminOrders; window.renderCartDrawer = renderCartDrawer; window.renderAdminProducts = renderAdminProducts; window.renderAdminOrders = renderAdminOrders; window.renderAdminInventory = renderAdminInventory; window.adminListState = adminListState; window.renderProductPage = renderProductPage; window.getFilteredProducts = getFilteredProducts; window.renderAdminCustomers = renderAdminCustomers; window.renderAdminDiscounts = renderAdminDiscounts; window.restorePagerFocus = restorePagerFocus; window.announceListChange = announceListChange; window.renderAdminList = renderAdminList; window.renderAdminRecovery = renderAdminRecovery; window.renderAdminPanel = renderAdminPanel;';
  window.document.body.appendChild(bridge);
  return { window, document: window.document, errors, close: () => window.close() };
}

test('the storefront renders products, categories and empty account state', () => {
  const page = loadPage();
  try {
    const { document, errors } = page;
    assert.deepEqual(errors, [], `expected no script errors, got: ${errors.join(' | ')}`);
    // Each card links the image and the title, so count distinct products instead.
    const ids = new Set([...document.querySelectorAll('#productGrid a[data-product-link]')].map(link => link.dataset.productLink));
    assert.equal(ids.size, 14, 'one card per built-in product');
    assert.equal(document.querySelectorAll('.cat-pill').length, 6);
    assert.match(document.getElementById('resultsCount').textContent, /Showing 14 objects/);
    assert.equal(document.getElementById('navCartBadge').textContent, '0');
    // The store opens in naira, so the featured $299 converts at the pinned rate.
    assert.match(document.getElementById('featuredPrice').textContent, /^₦403,058$/);
    page.window.GreenCartCurrency.set('USD');
    page.window.renderProductGrid();
    assert.match(document.getElementById('featuredPrice').textContent, /^\$299\.00$/);
  } finally {
    page.close();
  }
});

test('admin order controls only offer legal next statuses and refunds', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const store = window.AppStore;
    store.addToCart('aura-01');
    const order = store.placeOrder({ name: 'Ada Customer', address: '1 Main Street', city: 'Ibadan', email: 'ada@example.com', paymentMethod: 'Credit Card' });
    window.renderAdminOrders();

    const selectFor = reference => document.querySelector(`[data-admin-action="order-status"][data-reference="${reference}"]`);
    const refundFor = reference => document.querySelector(`[data-admin-action="refund"][data-reference="${reference}"]`);

    // Pending: only Processing and Cancelled, and no refund yet.
    const options = [...selectFor(order.reference).querySelectorAll('option')].map(option => option.value);
    assert.deepEqual(options, ['pending', 'processing', 'cancelled']);
    assert.equal(refundFor(order.reference), null, 'a pending order must not offer a refund');

    store.updateOrderStatus(order.reference, 'processing');
    store.updateOrderStatus(order.reference, 'shipped');
    window.renderAdminOrders();
    assert.deepEqual([...selectFor(order.reference).querySelectorAll('option')].map(option => option.value), ['shipped', 'delivered', 'cancelled']);
    assert.ok(refundFor(order.reference), 'a shipped order can be refunded');

    // Cancelled is terminal: a badge replaces the dropdown and no refund is offered.
    store.updateOrderStatus(order.reference, 'cancelled');
    window.renderAdminOrders();
    assert.equal(selectFor(order.reference), null);
    assert.equal(refundFor(order.reference), null);
    assert.match(document.getElementById('adminOrderBody').textContent, /Cancelled/);

    // Refunded is terminal too.
    store.addToCart('aura-01');
    const second = store.placeOrder({ name: 'Ada Customer', address: '1 Main Street', city: 'Ibadan', email: 'ada@example.com', paymentMethod: 'Credit Card' });
    store.updateOrderStatus(second.reference, 'processing');
    store.updateOrderStatus(second.reference, 'shipped');
    store.refundOrder(second.reference);
    window.renderAdminOrders();
    assert.equal(selectFor(second.reference), null);
    assert.match(document.getElementById('adminOrderBody').textContent, /Refunded/);
  } finally {
    page.close();
  }
});

test('a checkout with a half-cent promotion discount shows the rounded total', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const store = window.AppStore;
    // Force a 4.10 subtotal so 15% lands exactly on half a cent (0.615 -> 0.62).
    store.saveProduct({ id: 'aura-14', title: 'Minimalist Matte Thermal Flask', category: 'living', price: 4.10, stock: 5, description: 'Rounding probe' });
    store.addToCart('aura-14');
    store.applyPromo('GC15');
    // Rounding to the cent only exists in USD; the store now opens in naira,
    // where prices render as whole naira and a half cent is not representable.
    window.GreenCartCurrency.set('USD');
    window.renderCartDrawer();
    assert.match(document.getElementById('cartDiscount').textContent.trim(), /^−\$0\.62/);
    const totals = store.getCartTotals();
    assert.equal(totals.discount, 0.62);
    assert.equal(totals.shipping, 15, 'shipping is unchanged by the rounding fix');
    assert.equal(totals.total, 18.48);
  } finally {
    page.close();
  }
});

test('built-in products still expose reloadable detail links', () => {
  const page = loadPage();
  try {
    const { document } = page;
    const links = [...document.querySelectorAll('#productGrid a[data-product-link]')].map(anchor => anchor.getAttribute('href'));
    assert.ok(links.every(href => /^\?product=aura-\d{2}$/.test(href)), `unexpected hrefs: ${links.join(', ')}`);
    assert.ok(links.includes('?product=aura-01'));
    assert.ok(links.includes('?product=aura-14'));
  } finally {
    page.close();
  }
});

test('admin lists archived products separately and only offers legal actions', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const store = window.AppStore;
    const rowFor = title => Array.from(document.querySelectorAll('#adminProductBody tr')).find(row => row.textContent.includes(title));

    window.renderAdminProducts();
    // Active filter is the default: archived products are hidden from it.
    assert.match(document.getElementById('adminProductBody').textContent, /AURA ANC Over-Ear/);
    assert.equal(document.querySelectorAll('[data-product-filter="active"].active').length, 1);
    assert.ok(document.querySelector('[data-admin-action="archive-product"]'), 'active rows offer Archive');
    assert.equal(document.querySelector('[data-admin-action="delete-product"]'), null, 'active rows must not offer permanent delete');

    store.archiveProduct('aura-01');
    window.renderAdminProducts();
    assert.equal(rowFor('AURA ANC Over-Ear'), undefined, 'archived is hidden under the Active filter');

    document.querySelector('[data-product-filter="archived"]').click();
    assert.match(document.getElementById('adminProductBody').textContent, /AURA ANC Over-Ear/);
    assert.match(document.getElementById('adminProductBody').textContent, /Archived/);
    assert.ok(document.querySelector('[data-admin-action="restore-product"]'), 'archived rows offer Restore');
    assert.ok(document.querySelector('[data-admin-action="delete-product"]'), 'archived rows offer permanent delete');
    assert.equal(document.querySelector('[data-admin-action="archive-product"]'), null);

    document.querySelector('[data-product-filter="all"]').click();
    // "All" is paged: page one shows the first 10 of 14, and the pager says so.
    assert.equal(document.querySelectorAll('#adminProductBody tr').length, 10, 'first page holds one page of rows');
    assert.match(document.getElementById('adminProductPager').textContent, /Showing 1.10 of 14 products/);
    assert.match(document.getElementById('adminProductPager').textContent, /Page 1 of 2/);
  } finally {
    page.close();
  }
});

test('an archived product leaves the storefront and shows a retired detail page', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const store = window.AppStore;
    // aura-01 is the featured hero product, so this exercises the fallback too.
    store.archiveProduct('aura-01');

    const ids = window.getFilteredProducts().map(product => product.id);
    assert.equal(ids.includes('aura-01'), false, 'archived product is not in the catalogue');
    assert.equal(ids.length, 13);

    window.renderProductPage('aura-01');
    const text = document.getElementById('productPageContent').textContent;
    assert.match(text, /No longer available/);
    assert.match(text, /AURA ANC Over-Ear/);
    assert.doesNotMatch(text, /Product not found/, 'a retired item is not the same as a missing one');

    // Restoring puts it back.
    store.restoreProduct('aura-01');
    assert.equal(window.getFilteredProducts().map(product => product.id).includes('aura-01'), true);
  } finally {
    page.close();
  }
});

test('admin product search narrows results and resets to the first page', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    window.renderAdminProducts();
    // Walk to page two, then search: the search must come back to page one.
    document.querySelector('[data-page-target="products"][data-page-delta="1"]').click();
    assert.match(document.getElementById('adminProductPager').textContent, /Page 2 of 2/);
    const search = document.getElementById('adminProductSearch');
    search.value = 'aura';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.match(document.getElementById('adminProductPager').textContent, /Page 1 of 1/);
    const titles = [...document.querySelectorAll('#adminProductBody tr td[data-label="Product"] strong')].map(node => node.textContent);
    assert.ok(titles.length > 0, 'search returns matches');
    assert.ok(titles.every(title => /aura/i.test(title)), `unexpected matches: ${titles.join(', ')}`);

    // A query with no matches shows the message, not an empty table.
    search.value = 'zzzz';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.match(document.getElementById('adminProductBody').textContent, /No products match/);
    assert.equal(document.getElementById('adminProductPager').hidden, true);
  } finally {
    page.close();
  }
});

test('admin order filters and paging work on a list long enough to page', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const store = window.AppStore;
    // 23 orders: enough for three pages. Raise stock so the loop is not bounded
    // by the seed quantity.
    store.updateStock('aura-01', 100);
    for (let index = 0; index < 23; index++) {
      store.addToCart('aura-01');
      const order = store.placeOrder({ name: `Buyer ${index}`, address: `${index} Main St`, city: 'Ibadan', email: `buyer${index}@example.com`, paymentMethod: 'Apple Pay' });
      if (index % 5 === 0) { store.updateOrderStatus(order.reference, 'processing'); }
    }
    window.renderAdminOrders();
    assert.match(document.getElementById('adminOrderPager').textContent, /Showing 1.10 of 23 orders/);
    assert.match(document.getElementById('adminOrderPager').textContent, /Page 1 of 3/);
    document.querySelector('[data-page-target="orders"][data-page-delta="1"]').click();
    assert.match(document.getElementById('adminOrderPager').textContent, /Showing 11.20 of 23 orders/);
    document.querySelector('[data-page-target="orders"][data-page-delta="1"]').click();
    assert.match(document.getElementById('adminOrderPager').textContent, /Showing 21.23 of 23 orders/);
    assert.equal(document.querySelector('[data-page-target="orders"][data-page-delta="1"]').disabled, true, 'Next is disabled on the last page');

    // Status filter narrows the list and returns to page one.
    document.querySelector('[data-order-filter="processing"]').click();
    assert.match(document.getElementById('adminOrderPager').textContent, /of 5 orders/);
    assert.match(document.getElementById('adminOrderPager').textContent, /Page 1 of 1/);
    assert.equal(document.querySelectorAll('#adminOrderBody tr').length, 5);

    // Filters compose, so clear the status filter before searching across all orders.
    document.querySelector('[data-order-filter="all"]').click();
    const search = document.getElementById('adminOrderSearch');
    search.value = 'buyer7@example.com';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.match(document.getElementById('adminOrderPager').textContent, /of 1 order/);
    assert.match(document.getElementById('adminOrderBody').textContent, /Buyer 7/);
  } finally {
    page.close();
  }
});

test('admin inventory filters by stock level and keeps the summary accurate', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const store = window.AppStore;
    store.updateStock('aura-01', 0);   // out of stock
    store.updateStock('aura-02', 2);   // low stock
    store.updateStock('aura-03', 40);  // healthy
    window.renderAdminInventory();

    document.querySelector('[data-inventory-filter="out"]').click();
    let rows = [...document.querySelectorAll('#adminInventoryBody tr')].map(row => row.textContent).join(' ');
    assert.match(rows, /AURA ANC Over-Ear/);
    assert.doesNotMatch(rows, /Bauhaus Chronograph Mono/);

    document.querySelector('[data-inventory-filter="low"]').click();
    rows = [...document.querySelectorAll('#adminInventoryBody tr')].map(row => row.textContent).join(' ');
    assert.match(rows, /Bauhaus Chronograph Mono/);
    assert.doesNotMatch(rows, /AURA ANC Over-Ear/, 'out of stock is not counted as merely low');

    document.querySelector('[data-inventory-filter="all"]').click();
    const search = document.getElementById('adminInventorySearch');
    search.value = 'chronograph';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    rows = [...document.querySelectorAll('#adminInventoryBody tr')].map(row => row.textContent).join(' ');
    assert.match(rows, /Bauhaus Chronograph Mono/);
    assert.doesNotMatch(rows, /CloudPure Seamless Runner/);
  } finally {
    page.close();
  }
});

test('admin customer search and paging work on a long customer list', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const store = window.AppStore;
    store.updateStock('aura-01', 100);
    for (let index = 0; index < 12; index++) {
      store.addToCart('aura-01');
      store.placeOrder({ name: `Shopper ${index}`, address: `${index} Market Rd`, city: index % 2 ? 'Lagos' : 'Abuja', email: `shopper${index}@example.com`, paymentMethod: 'Card' });
    }
    window.renderAdminCustomers();

    assert.match(document.getElementById('adminCustomerPager').textContent, /Showing 1.10 of 12 customers/);
    assert.match(document.getElementById('adminCustomerPager').textContent, /Page 1 of 2/);
    assert.equal(document.querySelectorAll('#adminCustomerBody tr').length, 10);

    document.querySelector('[data-page-target="customers"][data-page-delta="1"]').click();
    assert.match(document.getElementById('adminCustomerPager').textContent, /Showing 11.12 of 12 customers/);

    // Search matches name, email and city, and resets to page one.
    const search = document.getElementById('adminCustomerSearch');
    search.value = 'shopper3@';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelectorAll('#adminCustomerBody tr').length, 1);
    assert.match(document.getElementById('adminCustomerBody').textContent, /Shopper 3/);
    assert.match(document.getElementById('adminCustomerPager').textContent, /Page 1 of 1/);

    // Name alone, with a space that the email cannot match, so this fails if
    // name drops out of the searchable fields.
    search.value = 'shopper 7';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelectorAll('#adminCustomerBody tr').length, 1);
    assert.match(document.getElementById('adminCustomerBody').textContent, /Shopper 7/);

    // City is searchable too.
    search.value = 'abuja';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.match(document.getElementById('adminCustomerBody').textContent, /Shopper 0/);

    // A miss says so instead of leaving an empty table.
    search.value = 'nobody-here';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.match(document.getElementById('adminCustomerBody').textContent, /No customers match/);
    assert.equal(document.getElementById('adminCustomerPager').hidden, true, 'no pager when nothing matches');
  } finally {
    page.close();
  }
});

test('admin promotion status filters and paging work together', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const store = window.AppStore;
    const base = store.promotions.length;
    // Enough promotions to fill more than one page, across several statuses.
    for (let index = 0; index < 12; index++) {
      store.addPromotion({ code: `BULK${index}`, type: 'percent', percent: 10 + index });
    }
    store.addPromotion({ code: 'OFFLINE', type: 'percent', percent: 15 });
    window.renderAdminDiscounts();
    const offline = store.promotions.find(promo => promo.code === 'OFFLINE');
    store.togglePromotion('OFFLINE');
    window.renderAdminDiscounts();

    assert.match(document.getElementById('adminPromoPager').textContent, new RegExp(`of ${base + 13} promotions`));
    assert.match(document.getElementById('adminPromoPager').textContent, /Page 1 of 2/);

    // Filtering by status narrows the list and returns to page one.
    document.querySelector('[data-promo-filter="disabled"]').click();
    assert.equal(document.querySelector('[data-promo-filter="disabled"]').getAttribute('aria-pressed'), 'true');
    assert.match(document.getElementById('adminPromoBody').textContent, /OFFLINE/);
    assert.doesNotMatch(document.getElementById('adminPromoBody').textContent, /BULK1\b/);
    assert.match(document.getElementById('adminPromoPager').textContent, /Page 1 of 1/);

    // A status with nothing in it explains itself.
    document.querySelector('[data-promo-filter="expired"]').click();
    assert.match(document.getElementById('adminPromoBody').textContent, /No expired promotions/);
    assert.equal(document.getElementById('adminPromoPager').hidden, true);

    // Search on top of "all" matches the code.
    document.querySelector('[data-promo-filter="all"]').click();
    const search = document.getElementById('adminPromoSearch');
    search.value = 'bulk7';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelectorAll('#adminPromoBody tr').length, 1);
    assert.match(document.getElementById('adminPromoBody').textContent, /BULK7/);
    assert.ok(offline);
  } finally {
    page.close();
  }
});

test('paging keeps keyboard focus on the pager instead of dropping it to the body', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    // jsdom refuses to focus an element inside a hidden section, so the admin
    // panel has to be open for these assertions to mean anything.
    document.querySelector('[data-tab="admin"]').click();
    document.querySelector('[data-admin="products"]').click();
    window.renderAdminProducts();
    document.querySelector('[data-product-filter="all"]').click();

    const next = () => document.querySelector('[data-page-target="products"][data-page-delta="1"]');
    const prev = () => document.querySelector('[data-page-target="products"][data-page-delta="-1"]');
    assert.equal(next().disabled, false, '14 products means a second page exists');

    // Enter on Next moves to the last page; Next is then disabled, so focus
    // must fall back to Previous rather than to <body>.
    next().focus();
    assert.equal(document.activeElement, next(), 'focus is on Next before activating');
    next().click();
    assert.match(document.getElementById('adminProductPager').textContent, /Page 2 of 2/);
    assert.equal(next().disabled, true);
    assert.notEqual(document.activeElement, document.body, 'focus is not dropped to the body');
    assert.equal(document.activeElement, prev(), 'focus falls back to Previous, which is still usable');

    // Going back the other way falls forward to Next.
    prev().focus();
    prev().click();
    assert.match(document.getElementById('adminProductPager').textContent, /Page 1 of 2/);
    assert.equal(prev().disabled, true);
    assert.equal(document.activeElement, next(), 'focus falls forward to Next');

    // A click that did not have focus must not steal it.
    const elsewhere = document.getElementById('adminProductSearch');
    elsewhere.focus();
    next().click();
    assert.equal(document.activeElement, elsewhere, 'focus stays where the user left it');
    assert.match(document.getElementById('adminProductPager').textContent, /Page 2 of 2/, 'but the page still changed');
  } finally {
    page.close();
  }
});

test('focus fallback reaches the status line when both arrows are unavailable', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    document.querySelector('[data-tab="admin"]').click();
    document.querySelector('[data-admin="products"]').click();
    // Narrow to a single page so neither arrow can be used after paging.
    const search = document.getElementById('adminProductSearch');
    search.value = 'flask';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));

    const pager = document.getElementById('adminProductPager');
    assert.match(pager.textContent, /Page 1 of 1/);
    assert.equal(pager.querySelector('[data-page-delta="1"]').disabled, true);
    assert.equal(pager.querySelector('[data-page-delta="-1"]').disabled, true);
    const status = pager.querySelector('.admin-pager-status');
    assert.equal(status.getAttribute('tabindex'), '-1', 'the status line is focusable programmatically only');
    window.restorePagerFocus(pager, '1');
    assert.equal(document.activeElement, status, 'focus parks on the live status line when both arrows are unusable');
  } finally {
    page.close();
  }
});

test('focus survives a re-render caused by an action other than paging', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    document.querySelector('[data-tab="admin"]').click();
    document.querySelector('[data-admin="products"]').click();
    window.renderAdminProducts();

    // Sit on the last page, then shrink the list from elsewhere, exactly as
    // archiving several products would. The page clamps back to 1 and both
    // arrows become unusable, so focus must land on the live status line
    // rather than falling to <body>.
    const next = () => document.querySelector('[data-page-target="products"][data-page-delta="1"]');
    next().focus();
    next().click();
    assert.match(document.getElementById('adminProductPager').textContent, /Page 2 of 2/);
    assert.equal(document.activeElement, document.querySelector('[data-page-target="products"][data-page-delta="-1"]'));

    ['aura-01', 'aura-02', 'aura-03', 'aura-04', 'aura-05'].forEach(id => window.AppStore.archiveProduct(id));
    window.renderAdminProducts();
    const pager = document.getElementById('adminProductPager');
    assert.match(pager.textContent, /of 9 products/);
    assert.match(pager.textContent, /Page 1 of 1/);
    assert.notEqual(document.activeElement, document.body, 'focus did not fall to the body');
    assert.equal(document.activeElement.className, 'admin-pager-status');
  } finally {
    page.close();
  }
});

test('page changes are announced through one live region that is never replaced', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    document.querySelector('[data-tab="admin"]').click();
    document.querySelector('[data-admin="products"]').click();
    window.renderAdminProducts();
    document.querySelector('[data-product-filter="all"]').click();

    const announcer = document.getElementById('adminListAnnouncer');
    assert.ok(announcer, 'the live region exists');
    assert.equal(announcer.getAttribute('aria-live'), 'polite');
    assert.equal(announcer.getAttribute('role'), 'status');
    assert.equal(announcer.getAttribute('aria-atomic'), 'true');
    assert.match(announcer.textContent, /Showing 1.10 of 14 products in the catalogue, page 1 of 2/);

    // The region must survive re-renders: a live region created and changed in
    // the same task is not announced. The pager containers are rebuilt, so the
    // announcer has to live outside them.
    announcer.dataset.probe = 'original';
    document.querySelector('[data-page-target="products"][data-page-delta="1"]').click();
    const same = document.getElementById('adminListAnnouncer');
    assert.equal(same, announcer, 'it is the same node, not a rebuilt one');
    assert.equal(same.dataset.probe, 'original', 'and it kept its state, so it was never replaced');
    assert.match(same.textContent, /Showing 11.14 of 14 products in the catalogue, page 2 of 2/);

    // No aria-live survives inside the pager, where it would be destroyed.
    assert.equal(document.querySelectorAll('#adminProductPager [aria-live]').length, 0);

    // Products and inventory both say "products" on screen; the announcement
    // names the list so a tab switch is never a silently identical message.
    document.querySelector('[data-admin="inventory"]').click();
    document.querySelector('[data-inventory-filter="all"]').click();
    assert.match(announcer.textContent, /products in inventory/);
  } finally {
    page.close();
  }
});

test('a repeated announcement is re-sent rather than swallowed', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const announcer = document.getElementById('adminListAnnouncer');
    window.announceListChange('products', 'Showing 1–10 of 10 things, page 1 of 1');
    assert.equal(announcer.textContent, 'Showing 1–10 of 10 things, page 1 of 1');
    // Same text again: a live region that receives identical content usually
    // stays silent, so the helper clears it first and writes it back.
    window.announceListChange('products', 'Showing 1–10 of 10 things, page 1 of 1');
    assert.equal(announcer.textContent, 'Showing 1–10 of 10 things, page 1 of 1');
    // A different message is written straight through.
    window.announceListChange('orders', 'Showing 1–10 of 10 orders, page 1 of 1');
    assert.equal(announcer.textContent, 'Showing 1–10 of 10 orders, page 1 of 1');
  } finally {
    page.close();
  }
});

test('the shared admin list helper derives the empty row column count from the table', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const state = { key: 'products', query: '', page: 1, items: [] };
    const rows = [];
    window.renderAdminList({
      state,
      bodyId: 'adminProductBody',
      pagerId: 'adminProductPager',
      items: [],
      label: 'products',
      row: item => `<tr><td>${item}</td></tr>`,
      emptyMessage: 'Nothing here.'
    });
    const cell = document.querySelector('#adminProductBody td[colspan]');
    const headers = document.querySelector('#adminProductBody').closest('table').querySelectorAll('thead th').length;
    assert.ok(cell, 'an empty row is rendered');
    assert.equal(cell.getAttribute('colspan'), String(headers), 'the colspan matches the real column count');
    assert.equal(cell.textContent, 'Nothing here.');
    assert.equal(document.getElementById('adminProductPager').hidden, true, 'no pager when there is nothing to page');
    assert.equal(rows.length, 0);

    // A table with a genuinely different column count gets its own number, so
    // the value is not hard-coded per list. (Orders also has 6, so it would
    // prove nothing; inventory has 5.)
    window.renderAdminList({
      state: { key: 'inventory', query: '', page: 1, items: [] },
      bodyId: 'adminInventoryBody',
      pagerId: 'adminInventoryPager',
      items: [],
      label: 'products',
      row: () => '',
      emptyMessage: 'Nothing here.'
    });
    const inventoryCell = document.querySelector('#adminInventoryBody td[colspan]');
    const inventoryHeaders = document.querySelector('#adminInventoryBody').closest('table').querySelectorAll('thead th').length;
    assert.equal(inventoryCell.getAttribute('colspan'), String(inventoryHeaders));
    assert.notEqual(inventoryCell.getAttribute('colspan'), cell.getAttribute('colspan'), 'inventory (5) differs from products (6)');
  } finally {
    page.close();
  }
});

test('the shared helper escapes empty messages exactly once', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    window.renderAdminList({
      state: { key: 'products', query: '', page: 1, items: [] },
      bodyId: 'adminProductBody',
      pagerId: 'adminProductPager',
      items: [],
      label: 'products',
      row: () => '',
      emptyMessage: 'No products match “<img src=x onerror=alert(1)>”.'
    });
    const cell = document.querySelector('#adminProductBody td[colspan]');
    // Shown literally, and never parsed as markup.
    assert.equal(cell.textContent, 'No products match “<img src=x onerror=alert(1)>”.');
    assert.equal(cell.querySelector('img'), null, 'no element was created from the query');
    // Escaped once, not twice: double-escaping would show &lt; instead of <.
    assert.doesNotMatch(cell.textContent, /&lt;|&amp;lt;/);
  } finally {
    page.close();
  }
});

test('the helper keeps the page in range when the list shrinks', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const state = { key: 'products', query: '', page: 3, items: [1, 2, 3, 4, 5] };
    window.renderAdminList({
      state,
      bodyId: 'adminProductBody',
      pagerId: 'adminProductPager',
      items: [1, 2, 3, 4, 5],
      label: 'products',
      row: item => `<tr><td>${item}</td></tr>`,
      emptyMessage: 'Nothing here.'
    });
    assert.equal(state.page, 1, 'an out-of-range page is clamped back into range');
    assert.equal(document.querySelectorAll('#adminProductBody tr').length, 5);
    assert.match(document.getElementById('adminProductPager').textContent, /Page 1 of 1/);
  } finally {
    page.close();
  }
});

test('the helper renders the rows belonging to the current page, not always the first page', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    const items = Array.from({ length: 25 }, (_, index) => `Item ${index + 1}`);
    const state = { key: 'products', query: '', page: 1, items };
    const render = () => window.renderAdminList({
      state,
      bodyId: 'adminProductBody',
      pagerId: 'adminProductPager',
      items,
      label: 'products',
      row: item => `<tr><td>${item}</td></tr>`,
      emptyMessage: 'Nothing here.'
    });

    render();
    let shown = [...document.querySelectorAll('#adminProductBody tr')].map(row => row.textContent);
    assert.equal(shown.length, 10);
    assert.equal(shown[0], 'Item 1', 'page one starts at the first item');
    assert.match(document.getElementById('adminProductPager').textContent, /Page 1 of 3/);

    // Page two must show items 11-20. Without this the body could keep showing
    // page one while the pager claimed to be on page two, and the pager text
    // alone would still look correct.
    state.page = 2;
    render();
    shown = [...document.querySelectorAll('#adminProductBody tr')].map(row => row.textContent);
    assert.equal(shown.length, 10);
    assert.equal(shown[0], 'Item 11', 'page two starts at item 11');
    assert.equal(shown[9], 'Item 20');
    assert.match(document.getElementById('adminProductPager').textContent, /Page 2 of 3/);

    // And the last page is the remainder, not a full page.
    state.page = 3;
    render();
    shown = [...document.querySelectorAll('#adminProductBody tr')].map(row => row.textContent);
    assert.equal(shown.length, 5);
    assert.equal(shown[0], 'Item 21');
    assert.match(document.getElementById('adminProductPager').textContent, /Showing 21.25 of 25/);
  } finally {
    page.close();
  }
});

test('the admin says so when saved data could not be read', () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    document.querySelector('[data-tab="admin"]').click();
    const banner = document.getElementById('adminRecovery');

    // A healthy store is quiet.
    assert.equal(window.AppStore.recovery, null);
    window.renderAdminRecovery();
    assert.equal(banner.hidden, true, 'no banner when saved data read fine');

    // Simulate what a corrupt saved value produces at boot.
    window.AppStore.recovery = { reason: 'unreadable', bytes: 20 };
    window.renderAdminRecovery();
    assert.equal(banner.hidden, false, 'the banner appears');
    assert.equal(banner.getAttribute('role'), 'alert', 'it is announced as an alert');
    const text = banner.textContent;
    assert.match(text, /could not be read/i);
    assert.match(text, /built-in defaults, not your saved data/i, 'it says the data below is not theirs');
    assert.match(text, /20 bytes/, 'it reports how much is stored, so the size is checkable');
    assert.match(text, /Nothing has been overwritten/i, 'it says the data is still there, which is true');

    // Dismissing hides it for this view without touching the stored value.
    document.getElementById('adminRecoveryDismiss').click();
    assert.equal(banner.hidden, true, 'dismiss hides the banner');
    assert.equal(window.AppStore.recovery.dismissed, true, 'and records the dismissal');

    // Rendering again must not bring it back.
    window.renderAdminRecovery();
    assert.equal(banner.hidden, true, 'a re-render does not resurrect a dismissed banner');
  } finally {
    page.close();
  }
});

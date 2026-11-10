const { test, expect } = require('@playwright/test');

async function load(page, path = '/', { currency = 'USD' } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://images.unsplash.com/**', route => route.abort());
  // These tests assert dollar arithmetic (a cent-scale rounding bug, a $17
  // discount). Pinning USD keeps that readable; the shipped naira default and
  // the currency switch are covered in currency.spec.js.
  await page.addInitScript(code => {
    try { window.localStorage.setItem('greencart_currency_v1', code); } catch (_) { }
  }, currency);
  await page.goto(path);
}

// Admin is deliberately absent from the public nav, so only the tests that
// drive the admin ask for it.
// Stand in for a real payment provider so the purchase journey can be tested
// end to end without taking a payment. This injects the public key and verify
// URL that js/config.js deliberately ships empty, then answers the browser the
// way a real verification server would.
async function stubPayments(page, { confirmed = true } = {}) {
  await page.addInitScript(({ confirmed }) => {
    window.GREENCART_CONFIG = {
      payments: { publicKey: 'pk_test_e2e' }
    };
    window.__charges = [];
    window.PaystackPop = {
      setup(options) {
        return {
          openIframe() {
            window.__charges.push({ amount: options.amount, currency: options.currency, email: options.email });
            Promise.resolve().then(() => options.callback({ reference: 'PSK-E2E' }));
          }
        };
      }
    };
  }, { confirmed });
  // The server prices the order before anything is charged.
  await page.route('**/api/initialize-payment', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        reference: 'PSK-E2E',
        amount: 40305798,
        currency: 'NGN',
        usdTotal: 299,
        items: body.lines || []
      })
    });
  });
  await page.route('**/api/verify-payment', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(confirmed
        ? { success: true, reference: body.reference || 'PSK-E2E', amountKobo: 40305798 }
        : { success: false, message: 'Not confirmed by the provider.' })
    });
  });
}

async function loadAdmin(page) {
  await load(page, '/?admin=1');
}

async function addFirstProduct(page) {
  await page.locator('.product-card').first().getByRole('button', { name: 'Add to bag' }).click();
}

async function openBag(page) {
  await page.locator('[data-tab="cart"]').click();
  await expect(page.locator('#cartDrawer')).toHaveClass(/open/);
}

test('sort menu follows each theme, sorts correctly and has keyboard support', async ({ page }) => {
  await load(page);
  await expect(page.locator('.site-nav')).not.toHaveCSS('position', 'fixed');
  await expect(page.locator('.site-header svg')).toHaveCount(0);
  await page.locator('#sortTrigger').click();
  await expect(page.locator('#sortMenu')).toBeVisible();
  const lightMenu = await page.locator('#sortMenu').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(lightMenu).not.toBe('rgb(255, 255, 255)');
  await page.getByRole('option', { name: 'Price: low to high' }).click();
  await expect(page.locator('.product-card').first().locator('.price-current')).toHaveText('$48.00');
  await page.locator('#themeToggleBtn').click();
  await expect(page.locator('#themeNotice')).toHaveText('Dark mode enabled');
  await expect(page.locator('#themeNotice')).toHaveClass(/visible/);
  await expect(page.locator('#themeNotice')).toHaveCSS('opacity', '1');
  await page.locator('#sortTrigger').click();
  const darkMenu = await page.locator('#sortMenu').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(darkMenu).not.toBe(lightMenu);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sortLabel')).toHaveText('Top rated');
  await expect(page.locator('#sortMenu')).toBeHidden();
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  await expect(page.locator('#themeToggleLabel')).toHaveText('Light mode');
});

test('only the bag scrolls while open and the page position is restored', async ({ page }) => {
  await load(page);
  for (let index = 0; index < 8; index++) {
    await page.locator('.product-card').nth(index).getByRole('button', { name: 'Add to bag' }).click();
  }
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);
  await openBag(page);
  await expect(page.locator('body')).toHaveClass(/scroll-locked/);
  const backgroundTop = await page.locator('#catalogSection').evaluate(el => el.getBoundingClientRect().top);
  await page.mouse.move(100, 500);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(100);
  expect(await page.locator('#catalogSection').evaluate(el => el.getBoundingClientRect().top)).toBe(backgroundTop);
  const items = page.locator('#cartItemsList');
  await items.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => items.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.locator('#cartCloseBtn').click();
  await expect(page.locator('body')).not.toHaveClass(/scroll-locked/);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(1);
});

test('checkout saves reference and status to account, inventory, analytics and customers', async ({ page }) => {
  await load(page, '/?admin=1');
  await stubPayments(page);
  await page.reload();
  await addFirstProduct(page);
  await openBag(page);
  await page.locator('#checkoutTriggerBtn').click();
  for (const id of ['checkoutName', 'checkoutAddress', 'checkoutCity', 'checkoutEmail']) {
    await expect(page.locator(`#${id}`)).toHaveValue('');
    await expect(page.locator(`#${id}`)).not.toHaveAttribute('placeholder');
  }
  const card = page.getByRole('radio', { name: 'Card' });
  await expect(card).toHaveAttribute('aria-checked', 'true');
  // The fake Apple Pay / Credit card / Crypto buttons are gone; there is one
  // real payment path and nothing that pretends to be another one.
  await expect(page.getByRole('radio')).toHaveCount(1);
  await page.locator('#checkoutName').fill('Ada Customer');
  await page.locator('#checkoutAddress').fill('1 Main Street');
  await page.locator('#checkoutCity').fill('Ibadan');
  await page.locator('#checkoutEmail').fill('ada@example.com');
  await page.locator('#confirmPayBtn').click();
  await expect(page.locator('#orderSuccessScreen')).toBeVisible();
  const reference = (await page.locator('#orderTrackingNum').textContent()).trim();
  expect(reference).toMatch(/^GC-\d{4}-/);
  await expect(page.locator('#continueShoppingBtn')).toHaveText('Return to Home');
  await page.locator('#continueShoppingBtn').click();
  await page.locator('[data-tab="profile"]').click();
  await expect(page.locator('#profileOrders')).toContainText(reference);
  await expect(page.locator('#profileOrders')).toContainText('Pending');
  await page.locator('#profileCloseBtn').click();
  await page.reload();
  await page.locator('[data-tab="profile"]').click();
  await expect(page.locator('#profileOrders')).toContainText(reference);
  await page.locator('#profileCloseBtn').click();
  await page.locator('[data-tab="admin"]').click();
  await expect(page.locator('#analyticsRevenue')).toHaveText('$299.00');
  await expect(page.locator('#analyticsOrders')).toHaveText('1');
  await expect(page.locator('#analyticsTopProducts')).toContainText('AURA ANC Over-Ear');
  await page.locator('[data-admin="inventory"]').click();
  await expect(page.locator('[data-stock-id="aura-01"]')).toHaveValue('17');
  await page.locator('[data-admin="orders"]').click();
  await expect(page.locator('#adminOrderBody')).toContainText(reference);
  await page.getByRole('button', { name: 'View details' }).click();
  await expect(page.locator('#orderDetails')).toContainText('1 Main Street');
  await expect(page.locator('#orderDetails')).toContainText('Card');
  // Fulfilment is a one-way path: pending -> processing -> shipped.
  await page.locator('[data-admin-action="order-status"]').selectOption('processing');
  await expect(page.locator('#orderDetails')).toContainText('Processing');
  await page.locator('[data-admin-action="order-status"]').selectOption('shipped');
  await expect(page.locator('#orderDetails')).toContainText('Shipped');
  await page.locator('[data-admin="customers"]').click();
  await expect(page.locator('#adminCustomerBody')).toContainText('ada@example.com');
  await page.getByRole('button', { name: 'View history' }).click();
  await expect(page.locator('#customerHistory')).toContainText(reference);
  await expect(page.locator('#customerHistory')).toContainText('1 Main Street');
  await expect(page.locator('#customerHistory')).toContainText('Shipped');
  await page.locator('[data-admin="orders"]').click();
  await page.getByRole('button', { name: 'Record refund' }).click();
  await expect(page.locator('#confirmMessage')).toContainText('No payment will be returned');
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#adminOrderBody')).toContainText('Refunded');
  await page.locator('[data-admin="analytics"]').click();
  await expect(page.locator('#analyticsRevenue')).toHaveText('$0.00');
  await page.locator('#adminCloseBtn').click();
  await page.locator('[data-tab="profile"]').click();
  await expect(page.locator('#profileOrders')).toContainText(reference);
  await expect(page.locator('#profileOrders')).toContainText('Refunded');
});

test('dark checkout selection is white with black text', async ({ page }) => {
  await load(page);
  await page.locator('#themeToggleBtn').click();
  await addFirstProduct(page);
  await openBag(page);
  await page.locator('#checkoutTriggerBtn').click();
  const selected = page.getByRole('radio', { name: 'Card' });
  await expect(selected).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(selected).toHaveCSS('color', 'rgb(0, 0, 0)');
  // Arrow keys used to move between the three fake methods. One real method
  // remains, so arrow keys must simply leave it selected rather than error.
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await expect(selected).toHaveAttribute('aria-checked', 'true');
});

test('admin products, low stock and scheduled promotions work in the storefront', async ({ page }) => {
  await load(page, '/?admin=1');
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="products"]').click();
  await page.locator('#addProductBtn').click();
  await page.locator('#productName').fill('Desk lamp <special>');
  await page.locator('#productCategory').selectOption('living');
  await page.locator('#productPrice').fill('80');
  await page.locator('#productStock').fill('2');
  await page.locator('#productTags').fill('Desk, New');
  await page.locator('#productDescription').fill('A small desk lamp.');
  await page.locator('#adminProductForm button[type="submit"]').click();
  // The products table is paged now, so locate the new row through search.
  await page.locator('#adminProductSearch').fill('Desk lamp');
  const row = page.locator('#adminProductBody tr').filter({ hasText: 'Desk lamp <special>' });
  await expect(row).toBeVisible();
  await expect(row.locator('special')).toHaveCount(0);
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#productPrice').fill('85');
  await page.locator('#adminProductForm button[type="submit"]').click();
  await expect(row).toContainText('$85.00');
  await page.locator('[data-admin="inventory"]').click();
  // Inventory is paged too, so narrow it down before asserting on the row.
  await page.locator('#adminInventorySearch').fill('Desk lamp');
  const inventoryRow = page.locator('#adminInventoryBody tr').filter({ hasText: 'Desk lamp <special>' });
  await expect(inventoryRow).toContainText('Low stock');
  await page.locator('[data-admin="discounts"]').click();
  await page.locator('#addPromoBtn').click();
  await page.locator('#promoCode').fill('SAVE20');
  await page.locator('#promoPercent').fill('20');
  await page.locator('#adminPromoForm button[type="submit"]').click();
  await expect(page.locator('#adminPromoBody')).toContainText('SAVE20');
  await page.locator('#adminCloseBtn').click();
  await page.locator('#searchInput').fill('Desk lamp <special>');
  const card = page.locator('.product-card').filter({ hasText: 'Desk lamp <special>' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Save Desk lamp/ }).click();
  await card.getByRole('button', { name: 'Add to bag' }).click();
  await openBag(page);
  await page.locator('#promoInput').fill('save20');
  await page.locator('#promoApplyBtn').click();
  await expect(page.locator('#cartDiscount')).toContainText('$17.00');
  await expect(page.locator('#cartTotal')).toHaveText('$83.00');
  await page.locator('#promoRemoveBtn').click();
  await expect(page.locator('#cartDiscountRow')).toBeHidden();
  await expect(page.locator('#cartTotal')).toHaveText('$100.00');
  await page.locator('#cartCloseBtn').click();
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="products"]').click();
  await page.locator('#adminProductSearch').fill('Desk lamp');
  const lampRow = page.locator('#adminProductBody tr').filter({ hasText: 'Desk lamp <special>' });
  await lampRow.getByRole('button', { name: 'Archive' }).click();
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#adminProductBody')).not.toContainText('Desk lamp <special>');
  // Permanent deletion is a separate, archived-only step.
  await page.locator('[data-product-filter="archived"]').click();
  await page.locator('#adminProductBody tr').filter({ hasText: 'Desk lamp <special>' }).getByRole('button', { name: 'Delete permanently' }).click();
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#adminProductBody')).not.toContainText('Desk lamp <special>');
  await page.locator('[data-product-filter="active"]').click();
  await page.locator('#adminCloseBtn').click();
  await expect(page.locator('#navCartBadge')).toHaveText('0');
  await page.locator('[data-tab="wishlist"]').click();
  await expect(page.locator('#wishlistItemsList')).toContainText('Nothing saved yet');
  await page.reload();
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="discounts"]').click();
  await expect(page.locator('#adminPromoBody')).toContainText('SAVE20');
});

test('mobile navigation, admin and checkout remain usable without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, '/?admin=1');
  await stubPayments(page);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('[data-tab="admin"]').click();
  await expect(page.locator('#adminModal')).toBeVisible();
  await page.locator('[data-admin="discounts"]').click();
  await expect(page.locator('#admin-discounts')).toBeVisible();
  await page.locator('#adminCloseBtn').click();
  await addFirstProduct(page);
  await openBag(page);
  await page.locator('#checkoutTriggerBtn').click();
  await expect(page.locator('#checkoutForm')).toBeVisible();
  const bounds = await page.locator('#checkoutModal').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  const reference = await completeCheckoutFromOpenForm(page);
  await expect(page.locator('#orderTrackingNum')).toHaveText(reference);
});

async function completeCheckoutFromOpenForm(page) {
  await page.locator('#checkoutName').fill('Mobile Customer');
  await page.locator('#checkoutAddress').fill('2 Main Street');
  await page.locator('#checkoutCity').fill('Ibadan');
  await page.locator('#checkoutEmail').fill('mobile@example.com');
  await page.locator('#confirmPayBtn').click();
  await expect(page.locator('#orderSuccessScreen')).toBeVisible();
  return (await page.locator('#orderTrackingNum').textContent()).trim();
}

test('search has an accessible label without a visible leading label', async ({ page }) => {
  await load(page);
  const search = page.getByRole('searchbox', { name: 'Search' });
  await expect(search).toBeVisible();
  await expect(page.locator('label[for="searchInput"]')).toHaveClass(/visually-hidden/);
  await search.fill('chronograph');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.locator('#searchClearBtn').click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.product-card')).toHaveCount(14);
});

for (const width of [320, 390, 420, 421, 480, 680]) {
  test(`mobile navigation and two-column products fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await load(page);
    const nav = page.locator('.site-nav');
    await expect(nav).toHaveCSS('position', 'fixed');
    const navBox = await nav.boundingBox();
    expect(navBox.x).toBeGreaterThanOrEqual(10);
    expect(width - navBox.x - navBox.width).toBeGreaterThanOrEqual(10);
    expect(navBox.y).toBeGreaterThan(700);
    expect(844 - navBox.y - navBox.height).toBeGreaterThanOrEqual(10);
    expect(844 - navBox.y - navBox.height).toBeLessThanOrEqual(32);
    const radius = await nav.evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius));
    expect(radius).toBeGreaterThanOrEqual(navBox.height / 2);
    // Admin is deliberately absent from the public nav, so the bottom bar has five
    // items. Every one of them still has to meet the 44px touch target.
    for (const name of ['Home', 'Shop', 'Saved', 'Bag', 'Account']) {
      const button = nav.getByRole('button', { name: new RegExp(`^${name}\\b`) });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(navBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(navBox.x + navBox.width + 0.5);
      const dimensions = await button.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    }
    const cards = await page.locator('.product-card').evaluateAll(elements => elements.slice(0, 4).map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, width: rect.width };
    }));
    expect(cards).toHaveLength(4);
    expect(cards[0].y).toBeCloseTo(cards[1].y, 0);
    expect(cards[1].x).toBeGreaterThan(cards[0].x);
    expect(cards[2].y).toBeGreaterThan(cards[0].y);
    expect(cards[2].y).toBeCloseTo(cards[3].y, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const overflow = await page.locator('.product-card').evaluateAll(elements => elements.flatMap(card => {
      const outer = card.getBoundingClientRect();
      return Array.from(card.querySelectorAll('.wishlist-btn, .product-title, .stars, .rating-count, .card-bottom, .add-cart-btn'))
        .filter(element => {
          const box = element.getBoundingClientRect();
          return box.left < outer.left - 1 || box.right > outer.right + 1 || element.scrollWidth > element.clientWidth + 1;
        }).map(element => element.className);
    }));
    expect(overflow).toEqual([]);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    const footer = await page.locator('.footer-content').boundingBox();
    expect(footer.y + footer.height).toBeLessThan(navBox.y);
  });
}

test('mobile navigation pill follows both themes and supports keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page);
  const nav = page.locator('.site-nav');
  const home = nav.getByRole('button', { name: 'Home' });
  await expect(home).toHaveAttribute('aria-current', 'page');
  expect(await home.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
  const lightBackground = await nav.evaluate(element => getComputedStyle(element).backgroundColor);
  await home.focus();
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('button', { name: 'Shop' })).toBeFocused();
  await page.locator('#themeToggleBtn').click();
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  await expect.poll(() => nav.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(lightBackground);
  expect(await nav.evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThanOrEqual((await nav.boundingBox()).height / 2);
});

test('mobile bottom navigation opens all storefront panels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, '/?admin=1');
  const nav = page.locator('.site-nav');
  await nav.getByRole('button', { name: 'Shop' }).click();
  await expect(nav.getByRole('button', { name: 'Shop' })).toHaveAttribute('aria-current', 'page');
  for (const [button, panel, close] of [
    ['Saved', '#wishlistModal', '#wishlistCloseBtn'],
    [/^Bag\b/, '#cartDrawer', '#cartCloseBtn'],
    ['Account', '#profileModal', '#profileCloseBtn'],
    ['Admin', '#adminModal', '#adminCloseBtn']
  ]) {
    await nav.getByRole('button', { name: button }).click();
    await expect(page.locator(panel)).toHaveClass(/open/);
    await page.locator(close).click();
    await expect(page.locator(panel)).not.toHaveClass(/open/);
  }
});

for (const [layout, width, height] of [['desktop', 1280, 800], ['mobile', 390, 844]]) {
  test(`theme changes show a fading borderless gradient at the top right on ${layout}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await load(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const notice = page.locator('#themeNotice');
    await page.locator('#themeToggleBtn').click();
    await expect(notice).toHaveText('Dark mode enabled');
    await expect(notice).toHaveClass(/visible/);
    await expect.poll(() => notice.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0.95);
    const dark = await notice.evaluate(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { background: style.backgroundImage, border: style.borderTopWidth, transition: style.transitionProperty, top: rect.top, right: rect.right };
    });
    expect(dark.background).toContain('linear-gradient');
    expect(dark.border).toBe('0px');
    expect(dark.transition).toContain('opacity');
    expect(dark.top).toBeGreaterThanOrEqual(0);
    expect(dark.top).toBeLessThan(50);
    expect(dark.right).toBeCloseTo(width, 0);
    await page.locator('#themeToggleBtn').click();
    await expect(notice).toHaveText('Light mode enabled');
    expect(await notice.evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe(dark.background);
    await expect(notice).not.toHaveClass(/visible/, { timeout: 5000 });
    await expect.poll(() => notice.evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThan(0.05);
  });
}

test('admin search, status filters and paging work in a real browser', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadAdmin(page);
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="products"]').click();

  // Products: 14 active products page 10 at a time.
  await page.locator('[data-product-filter="all"]').click();
  await expect(page.locator('#adminProductPager')).toContainText('Showing 1–10 of 14 products');
  await expect(page.locator('#adminProductPager')).toContainText('Page 1 of 2');
  await page.locator('[data-page-target="products"][data-page-delta="1"]').click();
  await expect(page.locator('#adminProductPager')).toContainText('Showing 11–14 of 14 products');
  await expect(page.locator('[data-page-target="products"][data-page-delta="1"]')).toBeDisabled();

  // Search returns to page one and narrows the rows.
  await page.locator('#adminProductSearch').fill('flask');
  await expect(page.locator('#adminProductPager')).toContainText('Page 1 of 1');
  await expect(page.locator('#adminProductBody tr')).toHaveCount(1);
  await expect(page.locator('#adminProductBody')).toContainText('Minimalist Matte Thermal Flask');

  // A query with no matches states so rather than showing an empty table.
  await page.locator('#adminProductSearch').fill('zzzz');
  await expect(page.locator('#adminProductBody')).toContainText('No products match');
  await page.locator('#adminProductSearch').fill('');
  await page.locator('[data-product-filter="active"]').click();

  // Inventory: search and stock filters.
  await page.locator('[data-admin="inventory"]').click();
  await page.locator('#adminInventorySearch').fill('chronograph');
  await expect(page.locator('#adminInventoryBody tr')).toHaveCount(1);
  await expect(page.locator('#adminInventoryBody')).toContainText('Bauhaus Chronograph Mono');
  await page.locator('#adminInventorySearch').fill('');
  // Seed stock is all >= 5, so the low filter starts empty. Create a real
  // low-stock item first, otherwise this would assert against the "everything
  // is above the threshold" placeholder row and pass for the wrong reason.
  await page.locator('[data-inventory-filter="all"]').click();
  const auraRow = page.locator('#adminInventoryBody tr').filter({ hasText: 'AURA ANC Over-Ear' });
  await auraRow.locator('input').fill('2');
  await auraRow.getByRole('button', { name: 'Save stock' }).click();
  await page.locator('[data-inventory-filter="low"]').click();
  await expect(page.locator('#adminInventoryBody')).toContainText('AURA ANC Over-Ear');
  await expect(page.locator('#adminInventoryBody')).not.toContainText('above the low-stock threshold');
  await page.locator('[data-inventory-filter="out"]').click();
  await expect(page.locator('#adminInventoryBody')).toContainText('Nothing is out of stock');
  await page.locator('[data-inventory-filter="all"]').click();
  await auraRow.locator('input').fill('18');
  await auraRow.getByRole('button', { name: 'Save stock' }).click();

  // Orders: an empty list still renders a usable pager.
  await page.locator('[data-admin="orders"]').click();
  // With no orders the table's own empty message stands alone: no pager, no dead arrows.
  await expect(page.locator('#adminOrderPager')).toBeHidden();
});

test('admin customer and promotion lists search, filter and page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadAdmin(page);
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="customers"]').click();

  // No orders yet on a fresh profile, so the list is empty and says so once.
  await expect(page.locator('#adminCustomerBody')).toContainText('No customers yet');
  await expect(page.locator('#adminCustomerPager')).toBeHidden();

  await page.locator('[data-admin="discounts"]').click();
  await expect(page.locator('#adminPromoBody tr')).not.toHaveCount(0);
  await expect(page.locator('#adminPromoFilter')).toBeVisible();

  // Create a promotion, then find it through search rather than by row order.
  await page.locator('#addPromoBtn').click();
  await page.locator('#promoCode').fill('PAGESEARCH');
  await page.locator('#promoPercent').fill('12');
  await page.locator('#adminPromoForm button[type="submit"]').click();
  await page.locator('#adminPromoSearch').fill('pagesearch');
  await expect(page.locator('#adminPromoBody tr')).toHaveCount(1);
  await expect(page.locator('#adminPromoBody')).toContainText('PAGESEARCH');

  // Disabling it moves it out of the "Active" filter and into "Disabled".
  await page.locator('#adminPromoSearch').fill('');
  await page.locator('#adminPromoBody tr').filter({ hasText: 'PAGESEARCH' }).getByRole('button', { name: 'Disable' }).click();
  await page.locator('[data-promo-filter="active"]').click();
  await expect(page.locator('#adminPromoBody')).not.toContainText('PAGESEARCH');
  await page.locator('[data-promo-filter="disabled"]').click();
  await expect(page.locator('#adminPromoBody')).toContainText('PAGESEARCH');
  await expect(page.locator('[data-promo-filter="disabled"]')).toHaveAttribute('aria-pressed', 'true');

  // A filter with nothing in it explains itself and hides the pager.
  await page.locator('[data-promo-filter="expired"]').click();
  await expect(page.locator('#adminPromoBody')).toContainText('No expired promotions');
  await expect(page.locator('#adminPromoPager')).toBeHidden();
  await page.locator('[data-promo-filter="all"]').click();
});

test('keyboard users can page the admin lists without losing focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadAdmin(page);
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="products"]').click();
  // Active, not All: archiving below has to actually shrink the visible list,
  // and the All filter keeps archived products in view.
  await page.locator('[data-product-filter="active"]').click();

  const focused = () => page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el.tagName, delta: el.dataset.pageDelta || null, text: (el.textContent || '').trim() };
  });

  // Activating Next with the keyboard keeps focus in the pager: the control
  // just used is now disabled on the last page, so Previous takes over.
  await page.locator('[data-page-target="products"][data-page-delta="1"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#adminProductPager')).toContainText('Page 2 of 2');
  let active = await focused();
  expect(active.tag).toBe('BUTTON');
  expect(active.text).toBe('Previous');
  expect(active.delta).toBe('-1');

  // And back the other way, falling forward to Next.
  await page.keyboard.press('Enter');
  await expect(page.locator('#adminProductPager')).toContainText('Page 1 of 2');
  active = await focused();
  expect(active.tag).toBe('BUTTON');
  expect(active.text).toBe('Next');
  expect(active.delta).toBe('1');

  // Focus never lands on the body during either move.
  const onBody = await page.evaluate(() => document.activeElement === document.body);
  expect(onBody).toBe(false);

  // A mouse click behaves the same way. Chrome focuses a button on mousedown,
  // so the click arrives with the button already focused; the point of the
  // assertion is that focus stays in the pager rather than falling to <body>.
  await page.locator('[data-page-target="products"][data-page-delta="1"]').click();
  await expect(page.locator('#adminProductPager')).toContainText('Page 2 of 2');
  const afterClick = await focused();
  expect(afterClick.tag).toBe('BUTTON');
  expect(afterClick.text).toBe('Previous');

  // A re-render from something other than the pager (archiving products shrinks
  // the list under the reader) must not drop focus to the body either.
  await page.evaluate(() => {
    ['aura-01', 'aura-02', 'aura-03', 'aura-04', 'aura-05'].forEach(id => AppStore.archiveProduct(id));
    renderAdminProducts();
  });
  await expect(page.locator('#adminProductPager')).toContainText('Page 1 of 1');
  const afterShrink = await focused();
  expect(afterShrink.tag).not.toBe('BODY');
  expect(afterShrink.text).toBe('Showing 1–9 of 9 products');

  // And a single-page list parks focus on the status line rather than nowhere.
  await page.locator('#adminProductSearch').fill('flask');
  await expect(page.locator('#adminProductPager')).toContainText('Page 1 of 1');
  const parked = await page.evaluate(() => {
    document.querySelector('#adminProductPager .admin-pager-status').focus();
    return document.activeElement.className;
  });
  expect(parked).toBe('admin-pager-status');
});

test('paging announces the new range through a live region that survives re-renders', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadAdmin(page);
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="products"]').click();
  await page.locator('[data-product-filter="all"]').click();

  const announcer = page.locator('#adminListAnnouncer');
  await expect(announcer).toHaveAttribute('aria-live', 'polite');
  await expect(announcer).toHaveAttribute('role', 'status');
  await expect(announcer).toContainText('Showing 1–10 of 14 products in the catalogue, page 1 of 2');

  // Mark the node, page, and confirm it is the same element afterwards: a live
  // region that is rebuilt and changed in one task is not announced.
  await page.evaluate(() => { document.getElementById('adminListAnnouncer').dataset.probe = 'kept'; });
  await page.locator('[data-page-target="products"][data-page-delta="1"]').click();
  await expect(announcer).toContainText('Showing 11–14 of 14 products in the catalogue, page 2 of 2');
  expect(await page.evaluate(() => document.getElementById('adminListAnnouncer').dataset.probe)).toBe('kept');

  // Nothing inside a rebuilt pager carries aria-live any more.
  expect(await page.locator('#adminProductPager [aria-live]').count()).toBe(0);

  // Inventory sounds different from products, so switching lists is announced.
  await page.locator('[data-admin="inventory"]').click();
  await page.locator('[data-inventory-filter="all"]').click();
  await expect(announcer).toContainText('products in inventory');

  // An empty list announces nothing rather than a misleading "showing 0".
  await page.locator('[data-admin="orders"]').click();
  await expect(page.locator('#adminOrderPager')).toBeHidden();
  const text = await announcer.textContent();
  expect(text.trim()).toBe('');
});

test('corrupt saved data is reported in the admin instead of vanishing silently', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadAdmin(page);

  // Save something real, so the loss below is observed rather than assumed.
  const before = await page.evaluate(() => {
    AppStore.updateStock('aura-01', 30);
    AppStore.addToCart('aura-01');
    AppStore.placeOrder({ name: 'Real Buyer', address: '1 St', city: 'Lagos', email: 'real@example.com', paymentMethod: 'Card' });
    return AppStore.orders.length;
  });
  expect(before).toBeGreaterThan(0);

  // Corrupt the real key and reload, as a half-written value would.
  await page.evaluate(() => localStorage.setItem('greencart_store_v1', '{"products": [broken json'));
  await page.reload();

  // The order is genuinely gone: this is data loss, not a display quirk.
  expect(await page.evaluate(() => AppStore.orders.length)).toBe(0);

  await page.locator('[data-tab="admin"]').click();
  const banner = page.locator('#adminRecovery');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('role', 'alert');
  await expect(banner).toContainText('could not be read');
  await expect(banner).toContainText('built-in defaults, not your saved data');
  // The stored bytes are still there; the banner must not claim they were deleted.
  expect(await page.evaluate(() => localStorage.getItem('greencart_store_v1'))).toBe('{"products": [broken json');

  await page.locator('#adminRecoveryDismiss').click();
  await expect(banner).toBeHidden();

  // A clean profile shows no banner at all.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('[data-tab="admin"]').click();
  await expect(page.locator('#adminRecovery')).toBeHidden();
});

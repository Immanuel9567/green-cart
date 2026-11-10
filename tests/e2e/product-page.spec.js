const { test, expect } = require('@playwright/test');

// Stand in for a real payment provider. The public key and verify URL are
// injected because js/config.js deliberately ships them empty.
async function stubPayments(page) {
  await page.addInitScript(() => {
    window.GREENCART_CONFIG = {
      payments: { publicKey: 'pk_test_e2e' }
    };
    window.PaystackPop = {
      setup(options) {
        return { openIframe() { Promise.resolve().then(() => options.callback({ reference: 'PSK-E2E' })); } };
      }
    };
  });
  await page.route('**/api/initialize-payment', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, reference: 'PSK-E2E', amount: 40305798, currency: 'NGN' })
  }));
  await page.route('**/api/verify-payment', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, reference: 'PSK-E2E', amountKobo: 40305798 })
  }));
}

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

test('homepage removes the requested hero copy while keeping the featured image', async ({ page }) => {
  await load(page);
  for (const text of ['THE EVERYDAY COLLECTION', 'Objects made for the way you live.', 'Thoughtful design, considered details, and a little more beauty in the everyday.', 'Explore the collection']) {
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  }
  await expect(page.locator('.hero-product-img')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /Considered essentials/ })).toBeVisible();
  await page.locator('.hero-product-link').click();
  await expect(page).toHaveURL(/product=aura-01/);
  await expect(page.locator('#productPage')).toBeVisible();
});

test('product links open a full page with a reloadable URL and browser history', async ({ page }) => {
  await load(page);
  const first = page.locator('.product-card').first();
  const imageLink = first.getByRole('link', { name: 'View AURA ANC Over-Ear' });
  await expect(imageLink).toHaveAttribute('href', /product=aura-01/);
  await imageLink.click();
  await expect(page).toHaveURL(/product=aura-01/);
  await expect(page.locator('#productPage')).toBeVisible();
  await expect(page.locator('#catalogSection')).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'AURA ANC Over-Ear' })).toBeVisible();
  await expect(page.locator('#productPage')).toContainText('Precision-engineered acoustic architecture');
  await expect(page.locator('#productPage')).toContainText('Battery Life');
  await expect(page.locator('#productPage')).toContainText('45 Hours');
  await expect(page.locator('.modal.open')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'AURA ANC Over-Ear' })).toBeVisible();
  await page.goBack();
  await expect(page.locator('#catalogSection')).toBeVisible();
  await expect(page).not.toHaveURL(/product=/);
});

test('variants invert with the theme and the selected choices go into the bag', async ({ page }) => {
  await load(page, '/?product=aura-02');
  const colors = page.locator('#productColorSwatches .color-swatch');
  const sizes = page.locator('#productSizePills .size-pill');
  await expect(colors.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(sizes.first()).toHaveAttribute('aria-pressed', 'true');
  await colors.nth(1).click();
  await sizes.nth(1).click();
  await expect(colors.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(colors.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(sizes.nth(1)).toHaveAttribute('aria-pressed', 'true');
  for (const selected of [colors.nth(1), sizes.nth(1)]) {
    await expect(selected).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(selected).toHaveCSS('color', 'rgb(255, 255, 255)');
  }
  await page.locator('#themeToggleBtn').click();
  for (const selected of [colors.nth(1), sizes.nth(1)]) {
    await expect(selected).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(selected).toHaveCSS('color', 'rgb(0, 0, 0)');
  }
  await page.locator('#productQtyPlus').click();
  await expect(page.locator('#productQtyValue')).toHaveText('2');
  await page.locator('#productAddToCart').click();
  await expect(page.locator('#cartDrawer')).toHaveClass(/open/);
  const item = page.locator('#cartItemsList .cart-item').first();
  await expect(item).toContainText('42mm');
  await expect(item).toContainText('#f1f5f9');
  await expect(item.locator('.qty-value')).toHaveText('2');
  await page.locator('#cartCloseBtn').click();
  await expect(page.locator('#productPage')).toBeVisible();
  await expect(page.locator('#productSizePills .size-pill').nth(1)).toHaveAttribute('aria-pressed', 'true');
});

test('a missing or out-of-stock product is handled without a broken page', async ({ page }) => {
  await load(page, '/?product=missing-item');
  await expect(page.locator('#productPage')).toContainText('Product not found');
  await page.getByRole('link', { name: /Back to collection/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalogSection')).toBeVisible();
  await expect(page.locator('#collectionTitle')).toBeFocused();
  await page.goto('/?admin=1&product=aura-02');
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="inventory"]').click();
  const row = page.locator('#adminInventoryBody tr').filter({ hasText: 'Bauhaus Chronograph Mono' });
  await row.locator('input').fill('0');
  await row.getByRole('button', { name: 'Save stock' }).click();
  await page.locator('#adminCloseBtn').click();
  await expect(page.locator('#productAddToCart')).toBeDisabled();
  await expect(page.locator('#productAddToCart')).toHaveText('Out of stock');
});

test('search and home navigation work from a product page', async ({ page }) => {
  await load(page, '/?product=aura-01');
  const search = page.locator('#searchInput');
  await search.fill('chrono');
  await expect(search).toBeFocused();
  await search.pressSequentially('graph');
  await expect(page).not.toHaveURL(/product=/);
  await expect(page.locator('#catalogSection')).toBeVisible();
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card')).toContainText('Bauhaus Chronograph Mono');
  await page.goBack();
  await expect(page.locator('#productPage')).toBeVisible();
  await page.locator('[data-tab="shop"]').click();
  await expect(page).toHaveURL(/#catalogSection$/);
  await expect(page.locator('#catalogSection')).toBeVisible();
  await page.goBack();
  await page.locator('[data-tab="home"]').click();
  await expect(page).not.toHaveURL(/product=/);
  await expect(page.locator('#catalogSection')).toBeVisible();
  await page.goBack();
  await page.locator('#brandLogo').click();
  await expect(page).not.toHaveURL(/product=/);
  await expect(page.locator('#catalogSection')).toBeVisible();
});

for (const width of [320, 390]) {
  test(`product detail is usable on a ${width}px mobile display`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await load(page, '/?product=aura-03');
    await expect(page.getByRole('heading', { level: 1, name: 'Obsidian Low-Top Sneaker' })).toBeVisible();
    await expect(page.locator('#productPage img')).toBeVisible();
    await page.getByRole('button', { name: 'US 9', exact: true }).click();
    await expect(page.getByRole('button', { name: 'US 9', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.site-nav')).toHaveCSS('position', 'fixed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('product links support keyboard activation, new tabs, and forward navigation', async ({ page, context }) => {
  await load(page);
  const title = page.locator('.product-card').nth(1).getByRole('link', { name: 'Bauhaus Chronograph Mono', exact: true });
  const modifierAllowed = await title.evaluate(link => {
    let allowed = false;
    document.addEventListener('click', event => { allowed = !event.defaultPrevented; event.preventDefault(); }, { once: true });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    return allowed;
  });
  expect(modifierAllowed).toBe(true);
  const href = await title.getAttribute('href');
  const newPage = await context.newPage();
  await load(newPage, new URL(href, page.url()).href);
  await expect(newPage).toHaveURL(/product=aura-02/);
  await expect(newPage.getByRole('heading', { level: 1, name: 'Bauhaus Chronograph Mono' })).toBeVisible();
  await expect(page.locator('#catalogSection')).toBeVisible();
  await newPage.close();
  await page.locator('.product-card').nth(1).locator('.product-img-frame').focus();
  await page.keyboard.press('Tab');
  await expect(title).toBeFocused();
  await expect(title).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/product=aura-02/);
  await expect(page.locator('#productPageTitle')).toBeFocused();
  await page.goBack();
  await expect(page.locator('#catalogSection')).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name: 'Bauhaus Chronograph Mono' })).toBeVisible();
});

test('saved items and bag links open details and availability follows bag changes', async ({ page }) => {
  await load(page, '/?admin=1');
  const first = page.locator('.product-card').first();
  await first.getByRole('button', { name: /Save AURA ANC/ }).click();
  await page.locator('[data-tab="wishlist"]').click();
  await page.locator('#wishlistItemsList').getByRole('link', { name: 'AURA ANC Over-Ear', exact: true }).click();
  await expect(page).toHaveURL(/product=aura-01/);
  await expect(page.locator('#wishlistModal')).not.toHaveClass(/open/);
  await expect(page.locator('#productSaveBtn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-tab="wishlist"]').click();
  await page.locator('#wishlistItemsList').getByRole('button', { name: 'Remove' }).click();
  await page.locator('#wishlistCloseBtn').click();
  await expect(page.locator('#productSaveBtn')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="inventory"]').click();
  const row = page.locator('#adminInventoryBody tr').filter({ hasText: 'AURA ANC Over-Ear' });
  await row.locator('input').fill('2');
  await row.getByRole('button', { name: 'Save stock' }).click();
  await page.locator('#adminCloseBtn').click();
  await page.locator('#productQtyPlus').click();
  await page.locator('#productAddToCart').click();
  await expect(page.locator('#productAddToCart')).toBeDisabled();
  await page.locator('#cartCloseBtn').click();
  await expect(page.locator('#productSaveBtn')).toBeFocused();
  await page.locator('[data-tab="cart"]').click();
  await page.locator('#cartItemsList').getByRole('button', { name: /Remove AURA ANC/ }).click();
  await page.locator('#cartCloseBtn').click();
  await expect(page.locator('#productAddToCart')).toBeEnabled();
  await page.locator('#productAddToCart').click();
  await page.locator('#cartItemsList').getByRole('link', { name: 'AURA ANC Over-Ear', exact: true }).click();
  await expect(page.locator('#cartDrawer')).not.toHaveClass(/open/);
  await expect(page.locator('#productPageTitle')).toBeVisible();
});

test('local admin products have reloadable details without implying they exist on another device', async ({ page, browser }) => {
  await load(page, '/?admin=1');
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="products"]').click();
  await page.locator('#addProductBtn').click();
  await page.locator('#productName').fill('Desk lamp <special>');
  await page.locator('#productCategory').selectOption('living');
  await page.locator('#productPrice').fill('85');
  await page.locator('#productStock').fill('2');
  await page.locator('#productDescription').fill('A small desk lamp.');
  await page.locator('#adminProductForm button[type="submit"]').click();
  await page.locator('#adminCloseBtn').click();
  await page.locator('#searchInput').fill('Desk lamp <special>');
  await page.getByRole('link', { name: 'Desk lamp <special>', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Desk lamp <special>' })).toBeVisible();
  await expect(page.locator('#productPage special')).toHaveCount(0);
  await expect(page.locator('#productPage')).toContainText('A small desk lamp.');
  await expect(page.locator('#productSpecsHeading')).toHaveCount(0);
  const productUrl = page.url();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Desk lamp <special>' })).toBeVisible();
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto(productUrl);
  await expect(otherPage.getByRole('heading', { level: 1, name: /Product not found/ })).toBeVisible();
  await otherContext.close();
});

test('product details reflect changes from another tab without losing variant focus', async ({ page, context }) => {
  // The driving tab needs admin access; the observed tab is a shopper's view.
  await load(page, '/?admin=1&product=aura-02');
  const other = await context.newPage();
  await load(other, '/?product=aura-02');
  const selected = other.locator('#productSizePills .size-pill').nth(1);
  await selected.click();
  await expect(selected).toBeFocused();
  await page.locator('#productSaveBtn').click();
  await expect(other.locator('#productSaveBtn')).toHaveAttribute('aria-pressed', 'true');
  await expect(other.locator('#productSizePills .size-pill').nth(1)).toBeFocused();
  await expect(other.locator('#productSizePills .size-pill').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="inventory"]').click();
  const row = page.locator('#adminInventoryBody tr').filter({ hasText: 'Bauhaus Chronograph Mono' });
  await row.locator('input').fill('0');
  await row.getByRole('button', { name: 'Save stock' }).click();
  await expect(other.locator('#productAddToCart')).toBeDisabled();
  await expect(other.locator('#productAddToCart')).toHaveText('Out of stock');
  await page.locator('[data-admin="products"]').click();
  const productRow = page.locator('#adminProductBody tr').filter({ hasText: 'Bauhaus Chronograph Mono' });
  // Retiring a product is an archive step; a sold or active product cannot be
  // deleted outright, so the open detail page reports it as retired.
  await productRow.getByRole('button', { name: 'Archive' }).click();
  await page.locator('#confirmAccept').click();
  await expect(other.getByRole('heading', { level: 1, name: /No longer available/ })).toBeFocused();
  await other.close();
});

test('failed product images use the existing category fallback on detail pages', async ({ page }) => {
  // Break the image for real. Built-in products now use local files that always
  // load, so the request must be failed explicitly to exercise the fallback.
  await page.route('**/assets/images/prod_frenchpress.jpg', route => route.abort('failed'));
  await load(page, '/?product=aura-05');
  const image = page.locator('#productPage .product-detail-img');
  await expect(image).toHaveAttribute('src', /^data:image\/svg\+xml,/);
  // The fallback is the living-room shape for this product's category.
  const source = await image.getAttribute('src');
  expect(decodeURIComponent(source)).toContain('viewBox="0 0 200 200"');
  expect(await image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
});

test('a broken image on the storefront falls back without hiding the product', async ({ page }) => {
  await page.route('**/assets/images/prod_flask.jpg', route => route.abort('failed'));
  await load(page);
  const card = page.locator('.product-card').filter({ hasText: 'Minimalist Matte Thermal Flask' });
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml,/);
  await expect(card.getByRole('heading', { level: 2 })).toHaveText(/Thermal Flask/);
});

test('featured hero metadata stays legible without overlapping on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await load(page);
  const price = await page.locator('.hero-price-chip').boundingBox();
  const specification = await page.locator('.hero-spec-pill').boundingBox();
  expect(price.x + price.width).toBeLessThan(specification.x);
  await page.locator('.hero-price-chip').click();
  await expect(page).toHaveURL(/product=aura-01/);
});

test('a detail-page purchase retains the chosen variant through checkout and returns home', async ({ page }) => {
  await stubPayments(page);
  await load(page, '/?product=aura-03');
  await page.locator('#productColorSwatches .color-swatch').nth(1).click();
  await page.getByRole('button', { name: 'US 9', exact: true }).click();
  await page.locator('#productAddToCart').click();
  await expect(page.locator('body')).toHaveClass(/scroll-locked/);
  await page.locator('#checkoutTriggerBtn').click();
  await page.locator('#checkoutName').fill('Ada Customer');
  await page.locator('#checkoutAddress').fill('1 Main Street');
  await page.locator('#checkoutCity').fill('Ibadan');
  await page.locator('#checkoutEmail').fill('ada@example.com');
  await page.locator('#confirmPayBtn').click();
  // Checkout is asynchronous now (charge, then server verification, then the
  // order is saved). Wait for the success screen instead of reading storage
  // mid-flight and racing the save.
  await expect(page.locator('#orderSuccessScreen')).toBeVisible();
  const reference = (await page.locator('#orderTrackingNum').textContent()).trim();
  const item = await page.evaluate(() => JSON.parse(localStorage.getItem('greencart_store_v1')).orders[0].items[0]);
  expect(item.selectedSize).toBe('US 9');
  expect(item.selectedColor).toBe('#f8fafc');
  await page.locator('#continueShoppingBtn').click();
  await expect(page).not.toHaveURL(/product=/);
  await expect(page.locator('body')).not.toHaveClass(/scroll-locked/);
  await page.locator('[data-tab="profile"]').click();
  await expect(page.locator('#profileOrders')).toContainText(reference);
});

test('every built-in product has a directly loadable detail page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page);
  const products = await page.locator('.product-card').evaluateAll(cards => cards.map(card => ({ id: card.dataset.id, title: card.querySelector('.product-title').textContent })));
  expect(products).toHaveLength(14);
  for (const product of products) {
    await page.goto(`/?product=${encodeURIComponent(product.id)}`);
    await expect(page.locator('#productPageTitle')).toHaveText(product.title);
    await expect(page.locator('#productAddToCart')).toBeVisible();
  }
  expect(errors).toEqual([]);
});
